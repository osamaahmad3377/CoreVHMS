import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { dentalProcedure, enumLabel, formatWeight, type Diary, type DiaryEntry, type SerologyTestInput, type SerologyTestView } from '@vcms/shared';
import { AuditService } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { notFound, ruleViolation } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { resolveTimezone } from '../../common/time/branch-timezone';
import { localParts } from '../../common/time/tz';
import { orgUnits } from '../../common/units/org-units';
import { patientNo } from '../patients/patients.service';

const SEX: Record<string, string> = { MALE: 'Male', FEMALE: 'Female', MALE_NEUTERED: 'Male (neutered)', FEMALE_SPAYED: 'Female (spayed)', UNKNOWN: 'Unknown' };
const dayOf = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const isoDay = (s: string | null | undefined) => (s ? new Date(`${s}T00:00:00.000Z`) : null);

function ageText(dob: Date | null, at: string) {
  if (!dob) return null;
  const [y1, m1, d1] = dayOf(dob)!.split('-').map(Number);
  const [y2, m2, d2] = at.split('-').map(Number);
  const months = Math.max(0, (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0));
  if (months < 1) return 'Under 1 month';
  if (months < 24) return `${months} month${months === 1 ? '' : 's'}`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return `${years} years${rest ? ` ${rest} months` : ''}`;
}

const view = (t: Prisma.SerologyTestGetPayload<object>): SerologyTestView => ({
  id: t.id,
  status: t.status,
  plannedFor: dayOf(t.plannedFor),
  sampleDate: dayOf(t.sampleDate),
  laboratory: t.laboratory,
  reference: t.reference,
  resultValue: t.resultValue == null ? null : Number(t.resultValue),
  resultUnit: t.resultUnit,
  outcome: t.outcome,
  validFrom: dayOf(t.validFrom),
  validUntil: dayOf(t.validUntil),
  notes: t.notes,
  recordedByName: t.recordedByName,
  voidedReason: t.voidedReason,
});

/**
 * The pet diary (health book) of a patient, and its rabies antibody test records. The diary is read from records the
 * clinic already keeps — nothing is typed into it — so it can never disagree with the patient's record.
 */
@Injectable()
export class DiaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async today() {
    return localParts(new Date(), await resolveTimezone(this.prisma)).date;
  }

  async diary(patientId: string): Promise<Diary> {
    const db = this.prisma.db;
    const ctx = RequestContext.require();
    const p = await db.patient.findUnique({
      where: { id: patientId },
      include: {
        species: { select: { name: true } },
        breed: { select: { name: true } },
        identifiers: { orderBy: [{ type: 'asc' }, { createdAt: 'asc' }] },
        ownerships: { where: { endedAt: null }, orderBy: [{ isPrimary: 'desc' }, { startedAt: 'asc' }], take: 1, include: { client: { include: { addresses: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }], take: 1 } } } } },
      },
    });
    if (!p || p.status === 'MERGED') throw notFound('Patient');
    const today = await this.today();
    const tz = await resolveTimezone(this.prisma);
    const units = await orgUnits(this.prisma);
    const org = await this.prisma.raw.organization.findUniqueOrThrow({ where: { id: ctx.organizationId! } });
    const branch = ctx.branchId ? await db.branch.findUnique({ where: { id: ctx.branchId } }) : null;
    const place = (o: { addressLine1?: string | null; addressLine2?: string | null; city?: string | null; postcode?: string | null } | null | undefined) =>
      o ? [o.addressLine1, o.addressLine2, [o.city, o.postcode].filter(Boolean).join(' ')].filter(Boolean).join(', ') || null : null;

    const [weight, care, administrations, surgeries, dental, tests] = await Promise.all([
      db.weightRecord.findFirst({ where: { patientId }, orderBy: { measuredAt: 'desc' } }),
      db.careItem.findMany({ where: { patientId, status: 'COMPLETED' }, orderBy: { completedAt: 'asc' }, take: 500 }),
      db.medicationAdministration.findMany({ where: { patientId, status: 'GIVEN' }, include: { product: { select: { name: true } } }, orderBy: { administeredAt: 'asc' }, take: 500 }),
      db.surgery.findMany({ where: { patientId, status: 'COMPLETED' }, orderBy: { completedAt: 'asc' }, take: 200 }),
      db.dentalChart.findMany({ where: { patientId, status: 'SIGNED' }, include: { procedures: { orderBy: { createdAt: 'asc' } } }, orderBy: { signedAt: 'asc' }, take: 100 }),
      db.serologyTest.findMany({ where: { patientId, status: { not: 'VOIDED' } }, orderBy: [{ sampleDate: 'asc' }, { plannedFor: 'asc' }] }),
    ]);

    // When the next dose is due: the item that follows each completed one.
    const next = care.length
      ? await db.careItem.findMany({ where: { previousItemId: { in: care.map((c) => c.id) }, status: { in: ['DUE', 'DEFERRED'] } }, select: { previousItemId: true, dueDate: true, deferredUntil: true } })
      : [];
    const givenOn = (d: Date | null) => (d ? localParts(d, tz).date : '');
    const entry = (c: (typeof care)[number]): DiaryEntry => {
      const n = next.find((x) => x.previousItemId === c.id);
      return {
        id: c.id,
        date: givenOn(c.completedAt),
        title: c.title,
        detail: c.productName,
        batch: c.batchNumber,
        validUntil: n ? dayOf(n.deferredUntil ?? n.dueDate) : null,
        by: c.givenElsewhere ? 'Given elsewhere' : c.completedByName,
        givenElsewhere: c.givenElsewhere,
      };
    };
    const isRabies = (c: (typeof care)[number]) => c.kind === 'VACCINATION' && /rabies/i.test(`${c.title} ${c.productName ?? ''}`);
    const linked = new Set(care.map((c) => c.administrationId).filter(Boolean) as string[]);

    const completed = tests.filter((t) => t.status === 'COMPLETED').map(view);
    const planned = tests.filter((t) => t.status === 'PLANNED').map(view);
    const procedures: DiaryEntry[] = [
      ...surgeries.map((s) => ({ id: s.id, date: givenOn(s.completedAt), title: s.procedure, detail: null, batch: null, validUntil: null, by: s.completedByName })),
      ...dental.flatMap((c) =>
        c.procedures.map((pr) => ({ id: pr.id, date: givenOn(c.signedAt ?? c.examinedAt), title: `Dental: ${dentalProcedure(pr.code)?.label ?? pr.code}`, detail: pr.tooth ? `Tooth ${pr.tooth}` : null, batch: null, validUntil: null, by: c.signedByName ?? c.clinicianName })),
      ),
    ].sort((a, b) => a.date.localeCompare(b.date));
    const owner = p.ownerships[0]?.client ?? null;

    return {
      generatedOn: today,
      clinic: { name: org.name, legalName: org.legalName, phone: branch?.phone ?? org.phone, email: branch?.email ?? org.email, website: org.website, address: place(branch?.addressLine1 ? branch : org), branch: branch?.name ?? null },
      patient: {
        id: p.id,
        name: p.name,
        patientNo: patientNo(p.number),
        species: p.species.name,
        breed: p.breed?.name ?? p.breedText ?? null,
        sex: SEX[p.sex] ?? p.sex,
        dateOfBirth: dayOf(p.dateOfBirth),
        dobEstimated: p.dobEstimated,
        age: ageText(p.dateOfBirth, today),
        colour: p.colour,
        markings: p.markings,
        weight: weight ? formatWeight(Number(weight.weightKg), units.weight) : p.latestWeightKg != null ? formatWeight(Number(p.latestWeightKg), units.weight) : null,
        weightDate: weight ? givenOn(weight.measuredAt) : null,
        bloodType: p.bloodType,
        desexed: p.sex === 'MALE_NEUTERED' || p.sex === 'FEMALE_SPAYED',
        photoAttachmentId: p.photoAttachmentId,
        registeredOn: givenOn(p.createdAt),
      },
      owner: owner ? { name: owner.displayName, phone: owner.mobilePhone, email: owner.email, address: owner.addresses[0] ? [owner.addresses[0].line1, owner.addresses[0].line2, owner.addresses[0].city, owner.addresses[0].postcode].filter(Boolean).join(', ') : null } : null,
      identifiers: p.identifiers.map((i) => ({ type: i.type, typeLabel: enumLabel(i.type), value: i.value, issuedAt: dayOf(i.issuedAt), notes: i.notes })),
      rabies: care.filter(isRabies).map(entry),
      serology: completed,
      futureTests: planned,
      vaccinations: care.filter((c) => c.kind === 'VACCINATION' && !isRabies(c)).map(entry),
      deworming: care.filter((c) => c.kind === 'DEWORMING').map(entry),
      tickFlea: care.filter((c) => c.kind === 'PARASITE_PREVENTION').map(entry),
      treatments: administrations
        .filter((a) => !linked.has(a.id))
        .map((a) => ({ id: a.id, date: givenOn(a.administeredAt), title: a.product.name, detail: `${Number(a.dose)} ${a.doseUnit}, ${a.route}`, batch: a.batchNumber, validUntil: null, by: a.administeredByName })),
      procedures,
    };
  }

  // ── Antibody tests ──

  private async patientOrThrow(patientId: string) {
    const p = await this.prisma.db.patient.findUnique({ where: { id: patientId }, select: { id: true, name: true, status: true } });
    if (!p || p.status === 'MERGED') throw ruleViolation('INVALID_PATIENT', 'Patient not found');
    return p;
  }

  private data(input: SerologyTestInput) {
    const done = input.status === 'COMPLETED';
    return {
      status: input.status,
      plannedFor: input.status === 'PLANNED' ? isoDay(input.plannedFor) : null,
      sampleDate: done ? isoDay(input.sampleDate) : null,
      laboratory: done ? input.laboratory || null : null,
      reference: done ? input.reference || null : null,
      resultValue: done && input.resultValue != null ? new Prisma.Decimal(input.resultValue) : null,
      resultUnit: input.resultUnit || 'IU/mL',
      outcome: done ? (input.outcome ?? null) : null,
      validFrom: done ? isoDay(input.validFrom) : null,
      validUntil: done ? isoDay(input.validUntil) : null,
      notes: input.notes || null,
    };
  }

  async record(patientId: string, input: SerologyTestInput) {
    const ctx = RequestContext.require();
    const p = await this.patientOrThrow(patientId);
    const id = await this.prisma.db.$transaction(async (tx) => {
      const t = await tx.serologyTest.create({ data: { organizationId: ctx.organizationId!, patientId, recordedById: ctx.userId!, recordedByName: ctx.userName ?? 'Unknown', ...this.data(input) } });
      await this.audit.record({ action: input.status === 'PLANNED' ? 'serology.planned' : 'serology.recorded', entityType: 'SerologyTest', entityId: t.id, summary: `${p.name}: rabies antibody test${input.status === 'PLANNED' ? ` planned for ${input.plannedFor}` : ` — ${input.outcome?.toLowerCase()}`}` }, tx);
      return t.id;
    });
    return view((await this.prisma.db.serologyTest.findUniqueOrThrow({ where: { id } })));
  }

  /** A planned test can be changed, or completed with its result; a recorded result can only be voided. */
  async update(id: string, input: SerologyTestInput) {
    const ctx = RequestContext.require();
    const t = await this.prisma.db.serologyTest.findUnique({ where: { id }, include: { patient: { select: { name: true } } } });
    if (!t) throw notFound('Test');
    if (t.status !== 'PLANNED') throw ruleViolation('NOT_PLANNED', 'A recorded result can’t be changed — void it and record it again');
    await this.prisma.db.$transaction(async (tx) => {
      await tx.serologyTest.update({ where: { id }, data: { ...this.data(input), recordedById: ctx.userId!, recordedByName: ctx.userName ?? 'Unknown' } });
      await this.audit.record({ action: input.status === 'COMPLETED' ? 'serology.recorded' : 'serology.planned', entityType: 'SerologyTest', entityId: id, summary: `${t.patient.name}: rabies antibody test ${input.status === 'COMPLETED' ? `recorded — ${input.outcome?.toLowerCase()}` : `planned for ${input.plannedFor}`}` }, tx);
    });
    return view(await this.prisma.db.serologyTest.findUniqueOrThrow({ where: { id } }));
  }

  async void(id: string, reason: string) {
    const ctx = RequestContext.require();
    const t = await this.prisma.db.serologyTest.findUnique({ where: { id }, include: { patient: { select: { name: true } } } });
    if (!t) throw notFound('Test');
    if (t.status === 'VOIDED') throw ruleViolation('ALREADY_VOIDED', 'This test is already voided');
    await this.prisma.db.$transaction(async (tx) => {
      await tx.serologyTest.update({ where: { id }, data: { status: 'VOIDED', voidedAt: new Date(), voidedByName: ctx.userName ?? 'Unknown', voidedReason: reason } });
      await this.audit.record({ action: 'serology.voided', entityType: 'SerologyTest', entityId: id, summary: `${t.patient.name}: ${reason}` }, tx);
    });
    return { ok: true };
  }

  async list(patientId: string) {
    await this.patientOrThrow(patientId);
    const rows = await this.prisma.db.serologyTest.findMany({ where: { patientId }, orderBy: [{ createdAt: 'desc' }] });
    return rows.map((t) => ({ ...view(t), voidedAt: t.voidedAt, voidedByName: t.voidedByName }));
  }
}
