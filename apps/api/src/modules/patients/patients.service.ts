import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  AlertInput,
  CreatePatientInput,
  IdentifierInput,
  PatientListQuery,
  UpdatePatientInput,
  WeightInput,
} from '@vcms/shared';
import { AuditService, diff } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { CounterService, formatNumber } from '../../common/counter/counter.service';
import { conflict, notFound, ruleViolation } from '../../common/http/errors';
import { orderBy, pageArgs, paginated } from '../../common/http/pagination';
import { PrismaService } from '../../common/prisma/prisma.service';
import { phoneSearchDigits } from '../../common/util/phone';
import type { ScopedTx } from '../../common/prisma/tenant-extension';

export const patientNo = (n: number) => formatNumber('P', n);

const listInclude = {
  species: { select: { id: true, name: true, category: true } },
  breed: { select: { id: true, name: true } },
  ownerships: {
    where: { endedAt: null, isPrimary: true },
    include: { client: { select: { id: true, displayName: true, number: true, mobilePhone: true } } },
  },
  alerts: { where: { isActive: true }, select: { id: true, severity: true, title: true, type: true } },
} satisfies Prisma.PatientInclude;

type ListRow = Prisma.PatientGetPayload<{ include: typeof listInclude }>;

export function shapePatientSummary(p: ListRow) {
  const owner = p.ownerships[0]?.client;
  return {
    id: p.id,
    number: p.number,
    patientNo: patientNo(p.number),
    name: p.name,
    status: p.status,
    sex: p.sex,
    dateOfBirth: p.dateOfBirth,
    dobEstimated: p.dobEstimated,
    species: p.species,
    breed: p.breed?.name ?? p.breedText,
    colour: p.colour,
    latestWeightKg: p.latestWeightKg ? Number(p.latestWeightKg) : null,
    photoAttachmentId: p.photoAttachmentId,
    owner: owner ? { id: owner.id, displayName: owner.displayName, mobilePhone: owner.mobilePhone } : null,
    alerts: p.alerts,
  };
}

@Injectable()
export class PatientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly counters: CounterService,
  ) {}

  async list(q: PatientListQuery) {
    const where: Prisma.PatientWhereInput = {
      status: q.status === 'ALL' ? { not: 'MERGED' } : q.status,
      speciesId: q.speciesId,
      primaryBranchId: q.branchId,
      ownerships: q.ownerId ? { some: { clientId: q.ownerId, endedAt: null } } : undefined,
    };
    if (q.q) where.OR = this.searchClauses(q.q);
    const [rows, total] = await Promise.all([
      this.prisma.db.patient.findMany({
        where,
        include: listInclude,
        ...pageArgs(q),
        orderBy: orderBy(q.sort, ['name', 'number', 'createdAt', 'dateOfBirth'], { name: 'asc' }),
      }),
      this.prisma.db.patient.count({ where }),
    ]);
    return paginated(rows.map(shapePatientSummary), total, q);
  }

  searchClauses(term: string): Prisma.PatientWhereInput[] {
    const t = term.trim();
    const clauses: Prisma.PatientWhereInput[] = [
      { name: { contains: t, mode: 'insensitive' } },
      { identifiers: { some: { value: { contains: t.replace(/\s/g, ''), mode: 'insensitive' } } } },
      {
        ownerships: {
          some: { endedAt: null, client: { displayName: { contains: t, mode: 'insensitive' } } },
        },
      },
    ];
    const num = /^p-?0*(\d+)$/i.exec(t) ?? (/^\d{1,9}$/.test(t) ? [t, t] : null);
    if (num) clauses.push({ number: Number(num[1]) });
    const phone = phoneSearchDigits(t);
    if (phone) clauses.push({ ownerships: { some: { endedAt: null, client: { phoneDigits: { contains: phone } } } } });
    return clauses;
  }

  async get(id: string) {
    const p = await this.prisma.db.patient.findUnique({
      where: { id },
      include: {
        species: true,
        breed: true,
        identifiers: { orderBy: { createdAt: 'asc' } },
        alerts: { orderBy: [{ isActive: 'desc' }, { severity: 'desc' }, { createdAt: 'desc' }] },
        weights: { orderBy: { measuredAt: 'desc' }, take: 50 },
        ownerships: {
          include: {
            client: {
              select: { id: true, displayName: true, number: true, mobilePhone: true, email: true, status: true, balanceMinor: true },
            },
          },
          orderBy: [{ endedAt: { sort: 'desc', nulls: 'first' } }, { startedAt: 'desc' }],
        },
      },
    });
    if (!p) throw notFound('Patient');
    this.audit.recordAsync({ action: 'patient.viewed', entityType: 'Patient', entityId: id });
    const mergedInto = p.mergedIntoId
      ? await this.prisma.db.patient.findUnique({ where: { id: p.mergedIntoId }, select: { id: true, name: true } })
      : null;
    return {
      ...p,
      patientNo: patientNo(p.number),
      latestWeightKg: p.latestWeightKg ? Number(p.latestWeightKg) : null,
      weights: p.weights.map((w) => ({ ...w, weightKg: Number(w.weightKg) })),
      owner: p.ownerships.find((o) => o.isPrimary && !o.endedAt)?.client ?? null,
      coOwners: p.ownerships.filter((o) => !o.isPrimary && !o.endedAt).map((o) => ({ ownershipId: o.id, ...o.client })),
      ownershipHistory: p.ownerships.filter((o) => o.endedAt || o.isPrimary),
      mergedInto,
    };
  }

  /** Validates that referenced catalogue rows belong to this organization and match each other. */
  private async validateRefs(input: { speciesId?: string; breedId?: string | null; primaryBranchId?: string | null }, currentSpeciesId?: string) {
    const speciesId = input.speciesId ?? currentSpeciesId;
    if (input.speciesId) {
      const s = await this.prisma.db.species.findUnique({ where: { id: input.speciesId } });
      if (!s) throw ruleViolation('INVALID_SPECIES', 'Species does not exist');
    }
    if (input.breedId) {
      const b = await this.prisma.db.breed.findUnique({ where: { id: input.breedId } });
      if (!b || b.speciesId !== speciesId) throw ruleViolation('INVALID_BREED', 'Breed does not belong to the selected species');
    }
    if (input.primaryBranchId) {
      const br = await this.prisma.db.branch.findUnique({ where: { id: input.primaryBranchId } });
      if (!br) throw ruleViolation('INVALID_BRANCH', 'Branch does not exist');
    }
  }

  private async activeClient(id: string) {
    const c = await this.prisma.db.client.findUnique({ where: { id }, select: { id: true, status: true, displayName: true } });
    if (!c) throw ruleViolation('INVALID_OWNER', 'Owner does not exist');
    if (c.status !== 'ACTIVE') throw ruleViolation('OWNER_INACTIVE', 'The selected owner is archived or merged');
    return c;
  }

  async create(input: CreatePatientInput) {
    const ctx = RequestContext.require();
    await this.activeClient(input.ownerId);
    await this.validateRefs(input);
    const { ownerId, identifiers, initialWeightKg, ...data } = input;
    try {
      return await this.prisma.db.$transaction(async (tx) => {
        const number = await this.counters.next(tx, 'patient');
        const patient = await tx.patient.create({
          data: {
            ...data,
            organizationId: ctx.organizationId!,
            number,
            primaryBranchId: data.primaryBranchId ?? ctx.branchId ?? null,
            latestWeightKg: initialWeightKg ?? null,
            createdById: ctx.userId,
          },
        });
        await tx.patientOwnership.create({
          data: { organizationId: ctx.organizationId!, patientId: patient.id, clientId: ownerId, isPrimary: true },
        });
        if (identifiers.length) {
          await tx.patientIdentifier.createMany({
            data: identifiers.map((i) => ({ ...i, value: normalizeIdentifier(i.value), patientId: patient.id, organizationId: ctx.organizationId! })),
          });
        }
        if (initialWeightKg) {
          await tx.weightRecord.create({
            data: {
              organizationId: ctx.organizationId!,
              patientId: patient.id,
              weightKg: initialWeightKg,
              recordedById: ctx.userId,
              recordedByName: ctx.userName,
            },
          });
        }
        await this.audit.record(
          { action: 'patient.created', entityType: 'Patient', entityId: patient.id, summary: `${patientNo(number)} ${patient.name}` },
          tx,
        );
        return { ...patient, patientNo: patientNo(number) };
      });
    } catch (e) {
      throw this.identifierConflict(e);
    }
  }

  private identifierConflict(e: unknown) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const target = String(e.meta?.target ?? '');
      if (target.includes('value')) return conflict('That identifier (microchip/tag) is already registered to another patient');
    }
    return e;
  }

  async update(id: string, input: UpdatePatientInput) {
    const before = await this.prisma.db.patient.findUnique({ where: { id } });
    if (!before) throw notFound('Patient');
    if (before.status === 'MERGED') throw ruleViolation('PATIENT_MERGED', 'This patient was merged into another record');
    await this.validateRefs(input, before.speciesId);
    if (input.speciesId && input.speciesId !== before.speciesId && input.breedId === undefined) {
      input.breedId = null; // breed no longer valid for the new species
    }
    return this.prisma.db.$transaction(async (tx) => {
      const after = await tx.patient.update({ where: { id }, data: input });
      await this.audit.record(
        { action: 'patient.updated', entityType: 'Patient', entityId: id, summary: after.name, changes: diff(before, after, Object.keys(input)) },
        tx,
      );
      return after;
    });
  }

  // ── Identifiers ──
  async addIdentifier(patientId: string, input: IdentifierInput) {
    await this.mustBeEditable(patientId);
    try {
      return await this.prisma.db.$transaction(async (tx) => {
        const i = await tx.patientIdentifier.create({
          data: { ...input, value: normalizeIdentifier(input.value), patientId, organizationId: RequestContext.orgId() },
        });
        await this.audit.record(
          { action: 'patient.identifier_added', entityType: 'Patient', entityId: patientId, summary: `${input.type} ${i.value}` },
          tx,
        );
        return i;
      });
    } catch (e) {
      throw this.identifierConflict(e);
    }
  }

  async removeIdentifier(patientId: string, identifierId: string) {
    return this.prisma.db.$transaction(async (tx) => {
      const i = await tx.patientIdentifier.findFirst({ where: { id: identifierId, patientId } });
      if (!i) throw notFound('Identifier');
      await tx.patientIdentifier.delete({ where: { id: identifierId } });
      await this.audit.record(
        { action: 'patient.identifier_removed', entityType: 'Patient', entityId: patientId, summary: `${i.type} ${i.value}` },
        tx,
      );
    });
  }

  // ── Weight ──
  async addWeight(patientId: string, input: WeightInput) {
    await this.mustBeEditable(patientId);
    const ctx = RequestContext.require();
    return this.prisma.db.$transaction(async (tx) => {
      const w = await tx.weightRecord.create({
        data: {
          organizationId: ctx.organizationId!,
          patientId,
          weightKg: input.weightKg,
          bodyConditionScore: input.bodyConditionScore ?? null,
          bcsScale: Number(input.bcsScale),
          measuredAt: input.measuredAt ?? new Date(),
          notes: input.notes,
          recordedById: ctx.userId,
          recordedByName: ctx.userName,
        },
      });
      await this.refreshLatestWeight(tx, patientId);
      await this.audit.record(
        { action: 'patient.weight_recorded', entityType: 'Patient', entityId: patientId, summary: `${input.weightKg} kg` },
        tx,
      );
      return { ...w, weightKg: Number(w.weightKg) };
    });
  }

  private async refreshLatestWeight(tx: ScopedTx, patientId: string) {
    const latest = await tx.weightRecord.findFirst({ where: { patientId }, orderBy: { measuredAt: 'desc' } });
    await tx.patient.update({ where: { id: patientId }, data: { latestWeightKg: latest?.weightKg ?? null } });
  }

  // ── Alerts ──
  async addAlert(patientId: string, input: AlertInput) {
    await this.mustBeEditable(patientId);
    const ctx = RequestContext.require();
    return this.prisma.db.$transaction(async (tx) => {
      const a = await tx.patientAlert.create({
        data: { ...input, patientId, organizationId: ctx.organizationId!, createdById: ctx.userId, createdByName: ctx.userName },
      });
      await this.audit.record(
        { action: 'patient.alert_added', entityType: 'Patient', entityId: patientId, summary: `${input.severity} ${input.type}: ${input.title}` },
        tx,
      );
      return a;
    });
  }

  async updateAlert(patientId: string, alertId: string, input: Partial<AlertInput>) {
    return this.prisma.db.$transaction(async (tx) => {
      const before = await tx.patientAlert.findFirst({ where: { id: alertId, patientId } });
      if (!before) throw notFound('Alert');
      const after = await tx.patientAlert.update({
        where: { id: alertId },
        data: {
          ...input,
          resolvedAt: input.isActive === false && before.isActive ? new Date() : input.isActive ? null : undefined,
        },
      });
      await this.audit.record(
        {
          action: input.isActive === false ? 'patient.alert_resolved' : 'patient.alert_updated',
          entityType: 'Patient',
          entityId: patientId,
          summary: after.title,
          changes: diff(before, after, Object.keys(input)),
        },
        tx,
      );
      return after;
    });
  }

  // ── Status changes ──
  async recordDeath(patientId: string, input: { deceasedAt: Date; causeOfDeath?: string | null; euthanasia: boolean; aftercare?: string | null }) {
    if (input.deceasedAt > new Date()) throw ruleViolation('FUTURE_DATE', 'Date of death cannot be in the future');
    return this.prisma.db.$transaction(async (tx) => {
      const p = await tx.patient.findUnique({ where: { id: patientId } });
      if (!p) throw notFound('Patient');
      if (p.status !== 'ACTIVE') throw ruleViolation('NOT_ACTIVE', 'Only active patients can be recorded as deceased');
      const after = await tx.patient.update({
        where: { id: patientId },
        data: { status: 'DECEASED', deceasedAt: input.deceasedAt, causeOfDeath: input.causeOfDeath, euthanasia: input.euthanasia, aftercare: input.aftercare },
      });
      await this.audit.record(
        { action: 'patient.deceased', entityType: 'Patient', entityId: patientId, summary: input.euthanasia ? 'Euthanasia' : 'Death recorded' },
        tx,
      );
      return after;
    });
  }

  async archive(patientId: string, reason: string) {
    return this.prisma.db.$transaction(async (tx) => {
      const p = await tx.patient.findUnique({ where: { id: patientId } });
      if (!p) throw notFound('Patient');
      if (p.status === 'MERGED' || p.status === 'ARCHIVED') throw ruleViolation('NOT_ARCHIVABLE', 'Patient is already archived or merged');
      const after = await tx.patient.update({ where: { id: patientId }, data: { status: 'ARCHIVED', archivedAt: new Date(), archivedReason: reason } });
      await this.audit.record({ action: 'patient.archived', entityType: 'Patient', entityId: patientId, summary: reason }, tx);
      return after;
    });
  }

  async restore(patientId: string) {
    return this.prisma.db.$transaction(async (tx) => {
      const p = await tx.patient.findUnique({ where: { id: patientId } });
      if (!p) throw notFound('Patient');
      if (!['ARCHIVED', 'TRANSFERRED'].includes(p.status)) throw ruleViolation('NOT_RESTORABLE', 'Only archived or transferred patients can be restored');
      const after = await tx.patient.update({ where: { id: patientId }, data: { status: 'ACTIVE', archivedAt: null, archivedReason: null } });
      await this.audit.record({ action: 'patient.restored', entityType: 'Patient', entityId: patientId }, tx);
      return after;
    });
  }

  /** Changes legal ownership, preserving the previous ownership period in history. */
  async transferOwnership(patientId: string, newOwnerId: string, reason: string, effectiveAt?: Date | null) {
    const newOwner = await this.activeClient(newOwnerId);
    const at = effectiveAt ?? new Date();
    return this.prisma.db.$transaction(async (tx) => {
      const p = await tx.patient.findUnique({ where: { id: patientId } });
      if (!p) throw notFound('Patient');
      if (p.status === 'MERGED') throw ruleViolation('PATIENT_MERGED', 'This patient was merged into another record');
      const current = await tx.patientOwnership.findFirst({ where: { patientId, isPrimary: true, endedAt: null } });
      if (current?.clientId === newOwnerId) throw ruleViolation('SAME_OWNER', 'This client is already the owner');
      if (current) await tx.patientOwnership.update({ where: { id: current.id }, data: { endedAt: at, endReason: reason } });
      // A co-owner becoming the primary owner: close the co-ownership row.
      await tx.patientOwnership.updateMany({
        where: { patientId, clientId: newOwnerId, isPrimary: false, endedAt: null },
        data: { endedAt: at, endReason: 'Became primary owner' },
      });
      await tx.patientOwnership.create({
        data: { organizationId: RequestContext.orgId(), patientId, clientId: newOwnerId, isPrimary: true, startedAt: at },
      });
      await this.audit.record(
        {
          action: 'patient.ownership_transferred',
          entityType: 'Patient',
          entityId: patientId,
          summary: `To ${newOwner.displayName}: ${reason}`,
          changes: { ownerId: { from: current?.clientId ?? null, to: newOwnerId } },
        },
        tx,
      );
      return { ok: true };
    });
  }

  async addCoOwner(patientId: string, clientId: string) {
    const client = await this.activeClient(clientId);
    await this.mustBeEditable(patientId);
    return this.prisma.db.$transaction(async (tx) => {
      const existing = await tx.patientOwnership.findFirst({ where: { patientId, clientId, endedAt: null } });
      if (existing) throw conflict('This client is already an owner of the patient');
      const o = await tx.patientOwnership.create({
        data: { organizationId: RequestContext.orgId(), patientId, clientId, isPrimary: false },
      });
      await this.audit.record({ action: 'patient.coowner_added', entityType: 'Patient', entityId: patientId, summary: client.displayName }, tx);
      return o;
    });
  }

  async removeCoOwner(patientId: string, ownershipId: string) {
    return this.prisma.db.$transaction(async (tx) => {
      const o = await tx.patientOwnership.findFirst({ where: { id: ownershipId, patientId, isPrimary: false, endedAt: null } });
      if (!o) throw notFound('Co-owner');
      await tx.patientOwnership.update({ where: { id: ownershipId }, data: { endedAt: new Date(), endReason: 'Co-owner removed' } });
      await this.audit.record({ action: 'patient.coowner_removed', entityType: 'Patient', entityId: patientId }, tx);
    });
  }

  /** Possible duplicate registrations: same identifier, or same owner + species + similar name. */
  async findDuplicates(input: { name?: string; ownerId?: string; speciesId?: string; identifiers?: string[]; excludeId?: string }) {
    const out = new Map<string, { id: string; name: string; patientNo: string; reasons: string[] }>();
    const add = (p: { id: string; name: string; number: number }, reason: string) => {
      if (p.id === input.excludeId) return;
      const r = out.get(p.id) ?? { id: p.id, name: p.name, patientNo: patientNo(p.number), reasons: [] };
      if (!r.reasons.includes(reason)) r.reasons.push(reason);
      out.set(p.id, r);
    };
    const values = (input.identifiers ?? []).map(normalizeIdentifier).filter(Boolean);
    if (values.length) {
      const rows = await this.prisma.db.patientIdentifier.findMany({ where: { value: { in: values } }, include: { patient: true } });
      rows.forEach((r) => add(r.patient, `Identifier ${r.value} already registered`));
    }
    if (input.ownerId && input.name) {
      const rows = await this.prisma.db.patient.findMany({
        where: {
          status: { not: 'MERGED' },
          speciesId: input.speciesId,
          ownerships: { some: { clientId: input.ownerId, endedAt: null } },
          name: { equals: input.name.trim(), mode: 'insensitive' },
        },
      });
      rows.forEach((p) => add(p, 'Same owner, species and name'));
    }
    return [...out.values()];
  }

  async setPhoto(patientId: string, attachmentId: string | null) {
    await this.mustBeEditable(patientId);
    if (attachmentId) {
      const a = await this.prisma.db.attachment.findUnique({ where: { id: attachmentId } });
      if (!a || a.deletedAt || a.entityType !== 'Patient' || a.entityId !== patientId || !a.mimeType.startsWith('image/')) {
        throw ruleViolation('INVALID_PHOTO', 'Upload an image for this patient first');
      }
    }
    await this.prisma.db.patient.update({ where: { id: patientId }, data: { photoAttachmentId: attachmentId } });
    await this.audit.record({ action: 'patient.photo_updated', entityType: 'Patient', entityId: patientId });
    return { photoAttachmentId: attachmentId };
  }

  async mustExist(id: string) {
    const p = await this.prisma.db.patient.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!p) throw notFound('Patient');
    return p;
  }

  async mustBeEditable(id: string) {
    const p = await this.prisma.db.patient.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!p) throw notFound('Patient');
    if (p.status === 'MERGED') throw ruleViolation('PATIENT_MERGED', 'This patient was merged into another record');
    return p;
  }
}

export function normalizeIdentifier(v: string): string {
  return v.replace(/\s+/g, '').toUpperCase();
}
