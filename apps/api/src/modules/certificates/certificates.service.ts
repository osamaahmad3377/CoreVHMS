import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CERTIFICATE_KIND_INFO,
  VERIFICATION_ALPHABET,
  certificateLayoutSchema,
  defaultCertificateLayout,
  fillPlaceholders,
  formatVerificationCode,
  formatWeight,
  issuePermissionFor,
  normaliseVerificationCode,
  type CertificateKind,
  type CertificateListQuery,
  type CertificateVaccinationRow,
  type CertificateVerification,
  type IssueCertificateInput,
} from '@vcms/shared';
import { randomInt } from 'node:crypto';
import { AuditService } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { CounterService, formatNumber } from '../../common/counter/counter.service';
import { sha256 } from '../../common/crypto/crypto';
import { forbidden, notFound, ruleViolation } from '../../common/http/errors';
import { pageArgs, paginated } from '../../common/http/pagination';
import { PrismaService } from '../../common/prisma/prisma.service';
import { appUrl } from '../../common/tenancy/hosts';
import { resolveTimezone } from '../../common/time/branch-timezone';
import { localParts } from '../../common/time/tz';
import { orgUnits } from '../../common/units/org-units';
import { patientNo } from '../patients/patients.service';

export const certificateNo = (n: number) => formatNumber('CERT', n);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-11-05" → "5 Nov 2026" (dates on certificates are plain calendar days). */
export const dayText = (day: string | null | undefined) => {
  if (!day || !/^\d{4}-\d{2}-\d{2}/.test(day)) return day ?? '';
  const [y, m, d] = day.slice(0, 10).split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};
const dayOf = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : '');
const SEX: Record<string, string> = { MALE: 'Male', FEMALE: 'Female', MALE_NEUTERED: 'Male (neutered)', FEMALE_SPAYED: 'Female (spayed)', UNKNOWN: 'Unknown' };

function ageText(dob: Date | null, at: string) {
  if (!dob) return '';
  const [y1, m1, d1] = dayOf(dob).split('-').map(Number);
  const [y2, m2, d2] = at.split('-').map(Number);
  let months = (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
  if (months < 0) months = 0;
  if (months < 24) return `${months} month${months === 1 ? '' : 's'}`;
  return `${Math.floor(months / 12)} years`;
}

const listInclude = {
  patient: { select: { id: true, name: true, number: true, species: { select: { name: true } } } },
  membership: { select: { id: true, jobTitle: true, user: { select: { name: true } } } },
} satisfies Prisma.CertificateInclude;
type Row = Prisma.CertificateGetPayload<{ include: typeof listInclude }>;

/**
 * Issuing, listing, revoking and verifying certificates. Everything printed is worked out when the certificate is
 * issued (from the records, what the issuer typed and the template) and kept with it, so a certificate always prints
 * the same — later changes to the patient, staff record or template never alter it.
 */
@Injectable()
export class CertificatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly counters: CounterService,
  ) {}

  private async today() {
    return localParts(new Date(), await resolveTimezone(this.prisma)).date;
  }

  /** Staff certificates are for people with the staff permission; patient ones for anyone who can read certificates. */
  private visibleSubjects(): ('PATIENT' | 'STAFF')[] {
    const p = RequestContext.require().permissions;
    return [...(p.has('certificates.read') ? (['PATIENT'] as const) : []), ...(p.has('certificates.staff') ? (['STAFF'] as const) : [])];
  }

  private shape(c: Row) {
    const status = c.status === 'REVOKED' ? 'REVOKED' : c.validUntil && dayOf(c.validUntil) < new Date().toISOString().slice(0, 10) ? 'EXPIRED' : 'VALID';
    return {
      id: c.id,
      certificateNo: certificateNo(c.number),
      kind: c.kind,
      kindLabel: CERTIFICATE_KIND_INFO[c.kind].label,
      subject: c.subject,
      title: c.title,
      subjectName: c.subjectName,
      patient: c.patient ? { id: c.patient.id, name: c.patient.name, patientNo: patientNo(c.patient.number), species: c.patient.species.name } : null,
      membership: c.membership ? { id: c.membership.id, name: c.membership.user.name, jobTitle: c.membership.jobTitle } : null,
      issuedAt: c.issuedAt,
      validUntil: c.validUntil ? dayOf(c.validUntil) : null,
      issuedByName: c.issuedByName,
      status: c.status,
      state: status as 'VALID' | 'EXPIRED' | 'REVOKED',
      revokedAt: c.revokedAt,
      revokedByName: c.revokedByName,
      revokedReason: c.revokedReason,
      verificationCode: formatVerificationCode(c.verificationCode),
      templateName: c.templateName,
    };
  }

  async list(q: CertificateListQuery) {
    const subjects = this.visibleSubjects();
    const today = await this.today();
    const where: Prisma.CertificateWhereInput = {
      subject: q.subject ? (subjects.includes(q.subject) ? q.subject : { in: [] }) : { in: subjects },
      kind: q.kind,
      patientId: q.patientId,
      membershipId: q.membershipId,
      ...(q.status === 'REVOKED'
        ? { status: 'REVOKED' }
        : q.status === 'EXPIRED'
          ? { status: 'ISSUED', validUntil: { lt: new Date(`${today}T00:00:00.000Z`) } }
          : q.status === 'ISSUED'
            ? { status: 'ISSUED', OR: [{ validUntil: null }, { validUntil: { gte: new Date(`${today}T00:00:00.000Z`) } }] }
            : {}),
      ...(q.q
        ? {
            AND: [
              {
                OR: [
                  { subjectName: { contains: q.q, mode: 'insensitive' } },
                  { title: { contains: q.q, mode: 'insensitive' } },
                  ...(/^\d+$/.test(q.q.replace(/^CERT-?/i, '')) ? [{ number: Number(q.q.replace(/^CERT-?/i, '')) }] : []),
                  { verificationCode: normaliseVerificationCode(q.q) },
                ],
              },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.certificate.findMany({ where, include: listInclude, orderBy: { issuedAt: 'desc' }, ...pageArgs(q) }),
      this.prisma.db.certificate.count({ where }),
    ]);
    return paginated(rows.map((r) => this.shape(r)), total, q);
  }

  async get(id: string) {
    const c = await this.prisma.db.certificate.findUnique({ where: { id }, include: { ...listInclude, template: { select: { id: true, name: true } } } });
    if (!c || !this.visibleSubjects().includes(c.subject)) throw notFound('Certificate');
    const replacedBy = await this.prisma.db.certificate.findUnique({ where: { replacesId: c.id }, select: { id: true, number: true } });
    const replaces = c.replacesId ? await this.prisma.db.certificate.findUnique({ where: { id: c.replacesId }, select: { id: true, number: true } }) : null;
    return {
      ...this.shape(c),
      inputs: c.inputs as unknown as Record<string, string>,
      data: c.data as unknown as { fields: Record<string, string>; table: CertificateVaccinationRow[] },
      layout: c.layout,
      contentHash: c.contentHash,
      verifyUrl: this.verifyUrl(c.verificationCode),
      encounterId: c.encounterId,
      templateId: c.templateId,
      replacedBy: replacedBy ? { id: replacedBy.id, certificateNo: certificateNo(replacedBy.number) } : null,
      replaces: replaces ? { id: replaces.id, certificateNo: certificateNo(replaces.number) } : null,
    };
  }

  private verifyUrl(code: string) {
    return `${appUrl()}/verify/${code}`;
  }

  // ── What goes on a certificate ──

  private async patientRecord(patientId: string) {
    const p = await this.prisma.db.patient.findUnique({
      where: { id: patientId },
      include: {
        species: { select: { name: true } },
        breed: { select: { name: true } },
        identifiers: { orderBy: { createdAt: 'asc' } },
        farm: { select: { name: true } },
        ownerships: { where: { endedAt: null }, orderBy: [{ isPrimary: 'desc' }, { startedAt: 'asc' }], take: 1, include: { client: { include: { addresses: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }], take: 1 } } } } },
      },
    });
    if (!p || p.status === 'MERGED') throw ruleViolation('INVALID_PATIENT', 'Patient not found');
    return p;
  }

  private async staffRecord(membershipId: string) {
    const m = await this.prisma.db.membership.findUnique({ where: { id: membershipId }, include: { user: { select: { name: true, isSystemAccount: true } }, branches: { include: { branch: { select: { name: true } } } } } });
    if (!m || m.user.isSystemAccount) throw ruleViolation('INVALID_STAFF', 'Staff member not found');
    return m;
  }

  /** Completed vaccinations on record, newest first, with when each is next due. */
  private async vaccinations(patientId: string) {
    const done = await this.prisma.db.careItem.findMany({ where: { patientId, kind: 'VACCINATION', status: 'COMPLETED' }, orderBy: { completedAt: 'desc' }, take: 200 });
    const next = done.length
      ? await this.prisma.db.careItem.findMany({ where: { previousItemId: { in: done.map((d) => d.id) }, status: { in: ['DUE', 'DEFERRED'] } }, select: { previousItemId: true, dueDate: true, deferredUntil: true } })
      : [];
    const tz = await resolveTimezone(this.prisma);
    return done.map((d) => {
      const n = next.find((x) => x.previousItemId === d.id);
      return {
        id: d.id,
        vaccine: d.title,
        product: d.productName ?? '',
        batch: d.batchNumber ?? '',
        givenOn: d.completedAt ? localParts(d.completedAt, tz).date : '',
        nextDue: n ? dayOf(n.deferredUntil ?? n.dueDate) : '',
        givenBy: d.givenElsewhere ? 'Given elsewhere' : (d.completedByName ?? ''),
      };
    });
  }

  /** Suggested answers for the issue form, from the records. */
  async prefill(kind: CertificateKind, subjectId: string) {
    const info = CERTIFICATE_KIND_INFO[kind];
    const today = await this.today();
    const inputs: Record<string, string> = Object.fromEntries(info.inputs.filter((i) => i.default).map((i) => [i.key, i.default!]));
    for (const key of ['examDate', 'completedOn']) if (info.inputs.some((i) => i.key === key)) inputs[key] = today;
    let validUntil: string | null = info.validityDays ? dayOf(new Date(Date.parse(`${today}T00:00:00Z`) + info.validityDays * 86400_000)) : null;
    let vaccinations: Awaited<ReturnType<CertificatesService['vaccinations']>> = [];

    if (info.subject === 'PATIENT') {
      const p = await this.patientRecord(subjectId);
      vaccinations = await this.vaccinations(p.id);
      const chip = p.identifiers.find((i) => i.type === 'MICROCHIP');
      if (kind === 'MICROCHIP' && chip) {
        inputs.microchip = chip.value;
        if (chip.issuedAt) inputs.implantDate = dayOf(chip.issuedAt);
      }
      if (kind === 'RABIES_VACCINATION') {
        const r = vaccinations.find((v) => /rabies/i.test(`${v.vaccine} ${v.product}`)) ?? null;
        if (r) {
          inputs.vaccine = r.product || r.vaccine;
          inputs.batch = r.batch;
          inputs.vaccinationDate = r.givenOn;
          if (r.nextDue) validUntil = r.nextDue;
        }
      }
      if (kind === 'STERILISATION') {
        if (p.sex === 'FEMALE_SPAYED') inputs.procedure = 'spayed (ovariohysterectomy)';
        if (p.sex === 'MALE_NEUTERED') inputs.procedure = 'castrated (neutered)';
      }
      if (kind === 'DEATH' && p.deceasedAt) {
        inputs.dateOfDeath = localParts(p.deceasedAt, await resolveTimezone(this.prisma)).date;
        inputs.manner = p.euthanasia ? 'humane euthanasia' : 'natural death';
        if (p.causeOfDeath) inputs.cause = p.causeOfDeath;
        if (p.aftercare) inputs.aftercare = p.aftercare;
      }
      if (kind === 'LIVESTOCK_HEALTH' && p.farm) inputs.farm = p.farm.name;
    } else {
      const m = await this.staffRecord(subjectId);
      const joined = dayOf(m.joinedAt ?? m.createdAt);
      if (kind === 'EXPERIENCE') {
        inputs.fromDate = joined;
        inputs.toDate = today;
      }
    }
    return { inputs, validUntil, vaccinations };
  }

  private async build(input: IssueCertificateInput, number: number, code: string, issuedDay: string, strict = true) {
    const ctx = RequestContext.require();
    const info = CERTIFICATE_KIND_INFO[input.kind];
    const units = await orgUnits(this.prisma);
    const org = await this.prisma.raw.organization.findUniqueOrThrow({ where: { id: ctx.organizationId! } });
    const branch = ctx.branchId ? await this.prisma.db.branch.findUnique({ where: { id: ctx.branchId } }) : null;
    const me = ctx.membershipId ? await this.prisma.db.membership.findUnique({ where: { id: ctx.membershipId } }) : null;
    const address = (o: { addressLine1?: string | null; addressLine2?: string | null; city?: string | null; postcode?: string | null } | null) =>
      o ? [o.addressLine1, o.addressLine2, [o.city, o.postcode].filter(Boolean).join(' ')].filter(Boolean).join(', ') : '';

    const f: Record<string, string> = {
      'clinic.name': org.brandName ?? org.name,
      'clinic.address': address(branch?.addressLine1 ? branch : org),
      'clinic.phone': branch?.phone ?? org.phone ?? '',
      'clinic.email': branch?.email ?? org.email ?? '',
      'branch.name': branch?.name ?? '',
      'certificate.number': certificateNo(number),
      'certificate.issuedAt': dayText(issuedDay),
      'certificate.validUntil': input.validUntil ? dayText(input.validUntil) : '',
      'certificate.validity': input.validUntil ? `Valid until ${dayText(input.validUntil)}` : '',
      'certificate.code': formatVerificationCode(code),
      'certificate.verifyUrl': this.verifyUrl(code),
      'certificate.remarks': (input.inputs.remarks ?? '').trim(),
      'issuer.name': ctx.userName ?? '',
      'issuer.jobTitle': me?.jobTitle ?? '',
      'issuer.registration': me?.professionalRegistration ?? '',
    };
    for (const i of info.inputs) {
      const raw = (input.inputs[i.key] ?? '').trim() || i.default || '';
      f[`input.${i.key}`] = i.type === 'date' ? dayText(raw) : raw;
    }

    let subjectName = '';
    let clientId: string | null = null;
    let table: CertificateVaccinationRow[] = [];
    if (info.subject === 'PATIENT') {
      const p = await this.patientRecord(input.patientId!);
      const owner = p.ownerships[0]?.client ?? null;
      const chip = p.identifiers.find((i) => i.type === 'MICROCHIP');
      const tag = p.identifiers.find((i) => i.type !== 'MICROCHIP');
      subjectName = p.name;
      clientId = owner?.id ?? null;
      Object.assign(f, {
        'patient.name': p.name,
        'patient.number': patientNo(p.number),
        'patient.species': p.species.name,
        'patient.breed': p.breed?.name ?? p.breedText ?? '',
        'patient.sex': SEX[p.sex] ?? p.sex,
        'patient.dateOfBirth': p.dateOfBirth ? `${dayText(dayOf(p.dateOfBirth))}${p.dobEstimated ? ' (estimated)' : ''}` : '',
        'patient.age': ageText(p.dateOfBirth, issuedDay),
        'patient.colour': [p.colour, p.markings].filter(Boolean).join(', '),
        'patient.microchip': chip?.value ?? '',
        'patient.tag': tag?.value ?? '',
        'patient.weight': p.latestWeightKg != null ? formatWeight(Number(p.latestWeightKg), units.weight) : '',
        'owner.name': owner?.displayName ?? '',
        'owner.address': owner?.addresses[0] ? [owner.addresses[0].line1, owner.addresses[0].line2, owner.addresses[0].city].filter(Boolean).join(', ') : '',
        'owner.phone': owner?.mobilePhone ?? '',
      });
      if (info.table === 'VACCINATIONS') {
        const all = await this.vaccinations(p.id);
        const chosen = input.vaccinationIds?.length ? all.filter((v) => input.vaccinationIds!.includes(v.id)) : all;
        if (input.vaccinationIds?.length && chosen.length !== new Set(input.vaccinationIds).size) throw ruleViolation('INVALID_VACCINATION', 'One or more vaccinations are not on this patient’s record');
        if (!chosen.length && strict) throw ruleViolation('NO_VACCINATIONS', 'This patient has no vaccinations on record yet');
        table = chosen.map((v) => ({ vaccine: v.vaccine, product: v.product, batch: v.batch, givenOn: dayText(v.givenOn), nextDue: dayText(v.nextDue), givenBy: v.givenBy }));
      }
    } else {
      const m = await this.staffRecord(input.membershipId!);
      subjectName = m.user.name;
      Object.assign(f, {
        'staff.name': m.user.name,
        'staff.jobTitle': m.jobTitle ?? 'a member of staff',
        'staff.registration': m.professionalRegistration ?? '',
        'staff.joinedAt': dayText(dayOf(m.joinedAt ?? m.createdAt)),
        'staff.branches': m.branches.map((b) => b.branch.name).join(', '),
      });
    }
    f['certificate.title'] = input.kind === 'PATIENT_CUSTOM' || input.kind === 'STAFF_CUSTOM' ? f['input.heading'] || info.title : info.title;
    f['certificate.statement'] = fillPlaceholders(info.statement, f);
    return { fields: f, table, subjectName, clientId };
  }

  private async template(kind: CertificateKind, templateId: string | null | undefined) {
    if (templateId) {
      const t = await this.prisma.db.certificateTemplate.findUnique({ where: { id: templateId } });
      if (!t || t.kind !== kind || !t.isActive) throw ruleViolation('INVALID_TEMPLATE', 'Choose an active template for this kind of certificate');
      return { id: t.id, name: t.name, layout: t.layout };
    }
    const d = await this.prisma.db.certificateTemplate.findFirst({ where: { kind, isDefault: true, isActive: true } });
    if (d) return { id: d.id, name: d.name, layout: d.layout };
    return { id: null, name: 'Built-in design', layout: defaultCertificateLayout(kind) };
  }

  private async newCode() {
    for (let i = 0; i < 5; i++) {
      const code = Array.from({ length: 12 }, () => VERIFICATION_ALPHABET[randomInt(VERIFICATION_ALPHABET.length)]).join('');
      if (!(await this.prisma.raw.certificate.findUnique({ where: { verificationCode: code }, select: { id: true } }))) return code;
    }
    throw new Error('Could not make a unique verification code');
  }

  async issue(input: IssueCertificateInput) {
    const ctx = RequestContext.require();
    const info = CERTIFICATE_KIND_INFO[input.kind];
    if (!ctx.permissions.has(issuePermissionFor(input.kind))) throw forbidden(`You can’t issue ${info.subject === 'STAFF' ? 'staff' : 'patient'} certificates`);
    const today = await this.today();
    if (input.validUntil && input.validUntil < today) throw ruleViolation('DATE_PASSED', 'The valid-until date has passed');
    const tpl = await this.template(input.kind, input.templateId);
    const layout = certificateLayoutSchema.parse(tpl.layout);
    if (input.encounterId && info.subject === 'PATIENT') {
      const e = await this.prisma.db.encounter.findUnique({ where: { id: input.encounterId }, select: { patientId: true } });
      if (!e || e.patientId !== input.patientId) throw ruleViolation('INVALID_ENCOUNTER', 'That consultation is for another patient');
    }
    const old = input.replacesId ? await this.prisma.db.certificate.findUnique({ where: { id: input.replacesId } }) : null;
    if (input.replacesId) {
      if (!old || old.status !== 'ISSUED') throw ruleViolation('NOT_REPLACEABLE', 'Only a certificate that is still valid can be replaced');
      if (old.kind !== input.kind || old.patientId !== (input.patientId ?? null) || old.membershipId !== (input.membershipId ?? null)) {
        throw ruleViolation('NOT_REPLACEABLE', 'A replacement is the same kind of certificate, for the same patient or person');
      }
    }
    const code = await this.newCode();

    const id = await this.prisma.db.$transaction(async (tx) => {
      const number = await this.counters.next(tx, 'certificate');
      const built = await this.build(input, number, code, today);
      const data = { fields: built.fields, table: built.table };
      const contentHash = sha256(JSON.stringify({ number, kind: input.kind, data, issuedOn: today, code }));
      const c = await tx.certificate.create({
        data: {
          organizationId: ctx.organizationId!,
          branchId: ctx.branchId ?? null,
          number,
          kind: input.kind,
          subject: info.subject,
          templateId: tpl.id,
          templateName: tpl.name,
          patientId: info.subject === 'PATIENT' ? input.patientId! : null,
          clientId: built.clientId,
          membershipId: info.subject === 'STAFF' ? input.membershipId! : null,
          encounterId: input.encounterId ?? null,
          subjectName: built.subjectName,
          title: built.fields['certificate.title'],
          inputs: input.inputs,
          data: data as unknown as Prisma.InputJsonValue,
          layout: layout as unknown as Prisma.InputJsonValue,
          verificationCode: code,
          contentHash,
          validUntil: input.validUntil ? new Date(`${input.validUntil}T00:00:00.000Z`) : null,
          issuedById: ctx.userId!,
          issuedByName: ctx.userName ?? 'Unknown',
          replacesId: old?.id ?? null,
        },
      });
      if (old) {
        await tx.certificate.update({ where: { id: old.id }, data: { status: 'REVOKED', revokedAt: new Date(), revokedByName: ctx.userName ?? 'Unknown', revokedReason: `Replaced by ${certificateNo(number)}` } });
        await this.audit.record({ action: 'certificate.revoked', entityType: 'Certificate', entityId: old.id, summary: `${certificateNo(old.number)} replaced by ${certificateNo(number)}` }, tx);
      }
      await this.audit.record(
        { action: 'certificate.issued', entityType: 'Certificate', entityId: c.id, summary: `${certificateNo(number)} ${built.fields['certificate.title']} — ${built.subjectName}` },
        tx,
      );
      return c.id;
    });
    return this.get(id);
  }

  /** Exactly what would be printed, without issuing anything (the issue form's preview). */
  async preview(input: IssueCertificateInput) {
    const ctx = RequestContext.require();
    if (!ctx.permissions.has(issuePermissionFor(input.kind))) throw forbidden('You can’t issue this kind of certificate');
    const subject = CERTIFICATE_KIND_INFO[input.kind].subject;
    if (subject === 'PATIENT' ? !input.patientId : !input.membershipId) throw ruleViolation('NO_SUBJECT', subject === 'PATIENT' ? 'Choose the patient' : 'Choose the staff member');
    const tpl = await this.template(input.kind, input.templateId);
    const built = await this.build(input, 0, 'PREVIEW00000', await this.today(), false);
    built.fields['certificate.number'] = 'Not issued yet';
    built.fields['certificate.code'] = 'PREV-IEW0-0000';
    return { fields: built.fields, table: built.table, layout: certificateLayoutSchema.parse(tpl.layout), templateName: tpl.name };
  }

  async revoke(id: string, reason: string) {
    const ctx = RequestContext.require();
    const c = await this.prisma.db.certificate.findUnique({ where: { id } });
    if (!c || !this.visibleSubjects().includes(c.subject)) throw notFound('Certificate');
    if (!ctx.permissions.has(issuePermissionFor(c.kind))) throw forbidden('You can’t revoke this certificate');
    if (c.status === 'REVOKED') throw ruleViolation('ALREADY_REVOKED', 'This certificate is already revoked');
    await this.prisma.db.$transaction(async (tx) => {
      await tx.certificate.update({ where: { id }, data: { status: 'REVOKED', revokedAt: new Date(), revokedByName: ctx.userName ?? 'Unknown', revokedReason: reason } });
      await this.audit.record({ action: 'certificate.revoked', entityType: 'Certificate', entityId: id, summary: `${certificateNo(c.number)}: ${reason}` }, tx);
    });
    return this.get(id);
  }

  /** The public check behind the QR code: is this certificate genuine, and is it still valid? */
  async verify(raw: string): Promise<CertificateVerification> {
    const code = normaliseVerificationCode(raw);
    if (code.length !== 12) return { found: false };
    const c = await this.prisma.raw.certificate.findUnique({
      where: { verificationCode: code },
      include: {
        organization: { select: { name: true, brandName: true } },
        patient: { select: { name: true, species: { select: { name: true } }, breed: { select: { name: true } }, breedText: true } },
        client: { select: { displayName: true } },
        membership: { select: { jobTitle: true } },
      },
    });
    if (!c) return { found: false };
    const replacedBy = await this.prisma.raw.certificate.findUnique({ where: { replacesId: c.id }, select: { number: true } });
    const today = new Date().toISOString().slice(0, 10);
    const shortName = (n: string) => {
      const parts = n.trim().split(/\s+/);
      return parts.length > 1 ? `${parts.slice(0, -1).join(' ')} ${parts[parts.length - 1][0]}.` : n;
    };
    return {
      found: true,
      status: c.status === 'REVOKED' ? 'REVOKED' : c.validUntil && dayOf(c.validUntil) < today ? 'EXPIRED' : 'VALID',
      number: certificateNo(c.number),
      title: c.title,
      kindLabel: CERTIFICATE_KIND_INFO[c.kind].label,
      issuedAt: c.issuedAt.toISOString(),
      validUntil: c.validUntil ? dayOf(c.validUntil) : null,
      clinic: c.organization.brandName ?? c.organization.name,
      subject: c.patient
        ? `${c.patient.name} — ${[c.patient.species.name, c.patient.breed?.name ?? c.patient.breedText].filter(Boolean).join(', ')}`
        : `${c.subjectName}${c.membership?.jobTitle ? ` — ${c.membership.jobTitle}` : ''}`,
      owner: c.client ? shortName(c.client.displayName) : null,
      issuedBy: c.issuedByName,
      revokedAt: c.revokedAt?.toISOString() ?? null,
      revokedReason: c.status === 'REVOKED' ? c.revokedReason : null,
      replacedBy: replacedBy ? certificateNo(replacedBy.number) : null,
      contentHash: c.contentHash,
    };
  }
}
