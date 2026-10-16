import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Admission, AdmissionOutcome, CprStatus, PatientCondition, Prisma } from '@prisma/client';
import { AuditService, diff } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { CounterService, formatNumber } from '../../common/counter/counter.service';
import { conflict, notFound, ruleViolation } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { ScopedTx } from '../../common/prisma/tenant-extension';
import { stableUuid } from '../../common/util/stable-uuid';
import { ChargeCaptureService } from '../billing/charge-capture.service';
import { TreatmentsService } from './treatments.service';

export const admissionNo = (n: number) => formatNumber('HOSP', n);
const DAY = 86400_000;

const detailInclude = {
  patient: {
    select: {
      id: true, name: true, number: true, sex: true, dateOfBirth: true, latestWeightKg: true, status: true, speciesId: true,
      species: { select: { name: true, category: true } }, breed: { select: { name: true } },
      alerts: { where: { isActive: true }, select: { id: true, type: true, severity: true, title: true } },
    },
  },
  client: { select: { id: true, displayName: true, mobilePhone: true } },
  ward: { select: { id: true, name: true, type: true, dailyService: { select: { name: true, priceMinor: true } } } },
  cage: { select: { id: true, name: true } },
  responsibleClinician: { select: { id: true, user: { select: { name: true } } } },
} satisfies Prisma.AdmissionInclude;

type Detail = Prisma.AdmissionGetPayload<{ include: typeof detailInclude }>;

export function shapeAdmission(a: Detail) {
  return {
    ...a,
    admissionNo: admissionNo(a.number),
    patient: { ...a.patient, latestWeightKg: a.patient.latestWeightKg === null ? null : Number(a.patient.latestWeightKg) },
    responsibleClinician: a.responsibleClinician ? { id: a.responsibleClinician.id, name: a.responsibleClinician.user.name } : null,
    daysInHospital: Math.max(1, Math.ceil(((a.dischargedAt ?? new Date()).getTime() - a.admittedAt.getTime()) / DAY)),
  };
}

@Injectable()
export class AdmissionsService {
  private readonly log = new Logger(AdmissionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly counters: CounterService,
    private readonly charges: ChargeCaptureService,
    private readonly treatments: TreatmentsService,
  ) {}

  // ── Daily charges ──

  /**
   * One charge per started 24 hours of stay, at the daily rate of the patient's ward. Idempotent:
   * each day has a stable source id, so running this again never bills a day twice.
   */
  async captureDayCharges(tx: ScopedTx, a: Pick<Admission, 'id' | 'admittedAt' | 'wardId' | 'clientId' | 'patientId' | 'encounterId' | 'branchId'>, until: Date) {
    if (!a.wardId) return 0;
    const ward = await tx.ward.findUnique({ where: { id: a.wardId }, include: { dailyService: true } });
    const svc = ward?.dailyService;
    if (!svc || !svc.isActive || svc.priceMinor <= 0) return 0;
    const days = Math.max(1, Math.ceil((until.getTime() - a.admittedAt.getTime()) / DAY));
    const tax = await this.charges.taxFor(tx, svc.taxRateId);
    let created = 0;
    for (let d = 1; d <= days; d++) {
      const sourceId = stableUuid(`admission-day:${a.id}:${d}`);
      if (await tx.charge.findFirst({ where: { sourceType: 'HospitalDay', sourceId } })) continue;
      await this.charges.capture(tx, {
        sourceType: 'HospitalDay',
        sourceId,
        clientId: a.clientId,
        patientId: a.patientId,
        encounterId: a.encounterId,
        branchId: a.branchId,
        kind: 'SERVICE',
        serviceId: svc.id,
        description: `${svc.name} — day ${d} (${ward!.name})`,
        quantity: 1,
        unitPriceMinor: svc.priceMinor,
        taxRateBasisPoints: tax,
      });
      created++;
    }
    return created;
  }

  // ── Admission lifecycle ──

  private async validateLocation(wardId?: string | null, cageId?: string | null) {
    if (cageId && !wardId) throw ruleViolation('WARD_REQUIRED', 'Choose the ward for this cage');
    const ward = wardId ? await this.prisma.db.ward.findUnique({ where: { id: wardId } }) : null;
    if (wardId && (!ward || !ward.isActive)) throw notFound('Ward');
    if (cageId) {
      const cage = await this.prisma.db.cage.findUnique({ where: { id: cageId } });
      if (!cage || cage.wardId !== wardId || !cage.isActive) throw ruleViolation('INVALID_CAGE', 'Cage not found in this ward');
      if (await this.prisma.db.admission.findFirst({ where: { cageId, status: 'ADMITTED' } })) throw conflict('This cage is already occupied');
    }
    return ward;
  }

  private async clinician(membershipId?: string | null) {
    if (!membershipId) return null;
    const m = await this.prisma.db.membership.findUnique({ where: { id: membershipId } });
    if (!m || m.status !== 'ACTIVE') throw ruleViolation('INVALID_CLINICIAN', 'Clinician not found');
    return m.id;
  }

  /** Urgent task for the responsible clinician plus an alert note on the hospital record. */
  private async escalation(tx: ScopedTx, a: Pick<Admission, 'id' | 'organizationId' | 'branchId' | 'patientId' | 'clientId' | 'encounterId' | 'responsibleClinicianId' | 'number'>, reason: string) {
    const ctx = RequestContext.require();
    await tx.hospitalNote.create({ data: { organizationId: a.organizationId, admissionId: a.id, type: 'ALERT', text: reason, authorId: ctx.userId!, authorName: ctx.userName ?? 'Unknown' } });
    await tx.task.create({
      data: {
        organizationId: a.organizationId,
        branchId: a.branchId,
        type: 'HOSPITAL_ALERT',
        title: `Inpatient alert ${admissionNo(a.number)}: ${reason}`.slice(0, 200),
        dueAt: new Date(),
        patientId: a.patientId,
        clientId: a.clientId,
        encounterId: a.encounterId,
        assigneeId: a.responsibleClinicianId,
        createdById: ctx.userId,
        createdByName: ctx.userName,
      },
    });
  }

  async admit(input: {
    patientId: string;
    encounterId?: string | null;
    wardId?: string | null;
    cageId?: string | null;
    reason: string;
    diagnosis?: string | null;
    condition: PatientCondition;
    cprStatus: CprStatus;
    isolation: boolean;
    feedingInstructions?: string | null;
    responsibleClinicianId?: string | null;
    expectedDischargeAt?: Date | null;
  }) {
    const ctx = RequestContext.require();
    const patient = await this.prisma.db.patient.findUnique({ where: { id: input.patientId } });
    if (!patient) throw notFound('Patient');
    if (patient.status !== 'ACTIVE') throw ruleViolation('PATIENT_NOT_ACTIVE', 'Only active patients can be admitted');
    const owner = await this.prisma.db.patientOwnership.findFirst({ where: { patientId: patient.id, endedAt: null, isPrimary: true } });
    if (!owner) throw ruleViolation('NO_OWNER', 'The patient has no current owner');
    if (await this.prisma.db.admission.findFirst({ where: { patientId: patient.id, status: 'ADMITTED' } })) throw conflict(`${patient.name} is already in hospital`);
    if (input.encounterId) {
      const e = await this.prisma.db.encounter.findUnique({ where: { id: input.encounterId } });
      if (!e || e.patientId !== patient.id) throw ruleViolation('INVALID_ENCOUNTER', 'Consultation does not belong to this patient');
    }
    const ward = await this.validateLocation(input.wardId, input.cageId);
    const clinicianId = (await this.clinician(input.responsibleClinicianId)) ?? (await this.prisma.db.membership.findFirst({ where: { userId: ctx.userId!, organizationId: ctx.organizationId! } }))?.id ?? null;
    try {
      const id = await this.prisma.db.$transaction(async (tx) => {
        const number = await this.counters.next(tx, 'admission');
        const a = await tx.admission.create({
          data: {
            ...input,
            organizationId: ctx.organizationId!,
            branchId: ward?.branchId ?? ctx.branchId!,
            number,
            clientId: owner.clientId,
            responsibleClinicianId: clinicianId,
            admittedById: ctx.userId!,
            admittedByName: ctx.userName ?? 'Unknown',
          },
        });
        await this.captureDayCharges(tx, a, new Date());
        if (a.condition === 'CRITICAL') await this.escalation(tx, a, 'Admitted in critical condition');
        await this.audit.record({ action: 'admission.created', entityType: 'Patient', entityId: patient.id, summary: `${admissionNo(number)}: ${input.reason}` }, tx);
        return a.id;
      });
      return this.get(id);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw conflict('The patient or cage is already taken by another admission');
      throw e;
    }
  }

  /** Who is in hospital now, by ward and cage, with what is overdue or due soon. */
  async flowboard(branchId?: string) {
    const now = new Date();
    const soon = new Date(now.getTime() + 2 * 3600_000);
    const [admissions, wards] = await Promise.all([
      this.prisma.db.admission.findMany({ where: { status: 'ADMITTED', branchId }, include: detailInclude, orderBy: { admittedAt: 'asc' } }),
      this.prisma.db.ward.findMany({ where: { isActive: true, branchId }, include: { cages: { where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] } }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    ]);
    const ids = admissions.map((a) => a.id);
    const [overdue, dueSoon, lastVitals, surgeries] = await Promise.all([
      this.prisma.db.treatmentTask.groupBy({ by: ['admissionId'], where: { admissionId: { in: ids }, status: 'DUE', dueAt: { lt: now } }, _count: true }),
      this.prisma.db.treatmentTask.groupBy({ by: ['admissionId'], where: { admissionId: { in: ids }, status: 'DUE', dueAt: { gte: now, lt: soon } }, _count: true }),
      this.prisma.db.vitalSign.groupBy({ by: ['admissionId'], where: { admissionId: { in: ids } }, _max: { recordedAt: true } }),
      this.prisma.db.surgery.findMany({ where: { admissionId: { in: ids }, status: { in: ['SCHEDULED', 'PRE_OP', 'IN_PROGRESS', 'RECOVERY'] } }, select: { id: true, admissionId: true, procedure: true, status: true, scheduledAt: true } }),
    ]);
    const count = (rows: { admissionId: string; _count: number }[], id: string) => rows.find((r) => r.admissionId === id)?._count ?? 0;
    const cards = admissions.map((a) => ({
      ...shapeAdmission(a),
      overdueTasks: count(overdue, a.id),
      dueSoonTasks: count(dueSoon, a.id),
      lastVitalsAt: lastVitals.find((v) => v.admissionId === a.id)?._max.recordedAt ?? null,
      surgery: surgeries.find((s) => s.admissionId === a.id) ?? null,
    }));
    return {
      generatedAt: now,
      summary: { inpatients: cards.length, critical: cards.filter((c) => c.condition === 'CRITICAL').length, overdueTasks: cards.reduce((n, c) => n + c.overdueTasks, 0) },
      wards: wards.map((w) => ({ id: w.id, name: w.name, type: w.type, cages: w.cages.map((c) => ({ id: c.id, name: c.name, admissionId: cards.find((x) => x.cageId === c.id)?.id ?? null })) })),
      admissions: cards,
    };
  }

  async list(q: { status?: string; patientId?: string; page: number; pageSize: number }) {
    const where: Prisma.AdmissionWhereInput = { status: (q.status as any) || undefined, patientId: q.patientId };
    const [rows, total] = await Promise.all([
      this.prisma.db.admission.findMany({ where, include: detailInclude, orderBy: { admittedAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.db.admission.count({ where }),
    ]);
    return { data: rows.map(shapeAdmission), meta: { page: q.page, pageSize: q.pageSize, total } };
  }

  async get(id: string) {
    const a = await this.prisma.db.admission.findUnique({
      where: { id },
      include: {
        ...detailInclude,
        notes: { orderBy: { createdAt: 'desc' } },
        surgeries: { select: { id: true, number: true, procedure: true, status: true, scheduledAt: true }, orderBy: { scheduledAt: 'desc' } },
      },
    });
    if (!a) throw notFound('Admission');
    return { ...shapeAdmission(a), notes: a.notes, surgeries: a.surgeries.map((s) => ({ ...s, surgeryNo: formatNumber('SURG', s.number) })) };
  }

  private async open(id: string) {
    const a = await this.prisma.db.admission.findUnique({ where: { id } });
    if (!a) throw notFound('Admission');
    if (a.status !== 'ADMITTED') throw ruleViolation('NOT_ADMITTED', 'This patient is no longer in hospital');
    return a;
  }

  async update(id: string, input: { condition?: PatientCondition; cprStatus?: CprStatus; diagnosis?: string | null; isolation?: boolean; feedingInstructions?: string | null; responsibleClinicianId?: string | null; expectedDischargeAt?: Date | null }) {
    const before = await this.open(id);
    if (input.responsibleClinicianId) await this.clinician(input.responsibleClinicianId);
    await this.prisma.db.$transaction(async (tx) => {
      const after = await tx.admission.update({ where: { id }, data: input });
      if (input.condition && input.condition !== before.condition) {
        const ctx = RequestContext.require();
        await tx.hospitalNote.create({ data: { organizationId: before.organizationId, admissionId: id, type: 'PROGRESS', text: `Condition changed from ${before.condition.toLowerCase()} to ${input.condition.toLowerCase()}`, authorId: ctx.userId!, authorName: ctx.userName ?? 'Unknown' } });
        if (input.condition === 'CRITICAL') await this.escalation(tx, after, 'Condition changed to critical');
      }
      await this.audit.record({ action: 'admission.updated', entityType: 'Admission', entityId: id, changes: diff(before, after, Object.keys(input)) }, tx);
    });
    return this.get(id);
  }

  async move(id: string, wardId: string, cageId?: string | null) {
    const a = await this.open(id);
    if (a.cageId && a.cageId === cageId) return this.get(id);
    const ward = await this.validateLocation(wardId, cageId);
    try {
      await this.prisma.db.$transaction(async (tx) => {
        // Days so far are charged at the old ward's rate before the move.
        await this.captureDayCharges(tx, a, new Date());
        await tx.admission.update({ where: { id }, data: { wardId, cageId: cageId ?? null } });
        await this.audit.record({ action: 'admission.moved', entityType: 'Admission', entityId: id, summary: `to ${ward!.name}` }, tx);
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw conflict('This cage is already occupied');
      throw e;
    }
    return this.get(id);
  }

  async addNote(id: string, type: 'PROGRESS' | 'HANDOVER', text: string) {
    const a = await this.open(id);
    const ctx = RequestContext.require();
    return this.prisma.db.$transaction(async (tx) => {
      const n = await tx.hospitalNote.create({ data: { organizationId: a.organizationId, admissionId: id, type, text, authorId: ctx.userId!, authorName: ctx.userName ?? 'Unknown' } });
      await this.audit.record({ action: `admission.${type.toLowerCase()}_note`, entityType: 'Admission', entityId: id }, tx);
      return n;
    });
  }

  async escalate(id: string, reason: string) {
    const a = await this.open(id);
    await this.prisma.db.$transaction(async (tx) => {
      await this.escalation(tx, a, reason);
      await this.audit.record({ action: 'admission.escalated', entityType: 'Admission', entityId: id, summary: reason }, tx);
    });
    return this.get(id);
  }

  async discharge(id: string, input: { outcome: AdmissionOutcome; dischargeSummary: string; homeCareInstructions?: string | null; followUpAt?: Date | null }) {
    const ctx = RequestContext.require();
    const a = await this.open(id);
    const now = new Date();
    await this.prisma.db.$transaction(async (tx) => {
      await this.captureDayCharges(tx, a, now);
      await tx.treatmentOrder.updateMany({ where: { admissionId: id, status: 'ACTIVE' }, data: { status: 'COMPLETED', stoppedAt: now, stoppedByName: ctx.userName, stopReason: 'Patient discharged' } });
      await tx.treatmentTask.updateMany({ where: { admissionId: id, status: 'DUE' }, data: { status: 'CANCELLED' } });
      await tx.admission.update({
        where: { id },
        data: { status: 'DISCHARGED', outcome: input.outcome, dischargeSummary: input.dischargeSummary, homeCareInstructions: input.homeCareInstructions, followUpAt: input.followUpAt, dischargedAt: now, dischargedById: ctx.userId, dischargedByName: ctx.userName },
      });
      if (input.outcome === 'DECEASED' || input.outcome === 'EUTHANASED') {
        await tx.patient.update({ where: { id: a.patientId }, data: { status: 'DECEASED', deceasedAt: now } });
        await this.audit.record({ action: 'patient.deceased', entityType: 'Patient', entityId: a.patientId, summary: `${input.outcome.toLowerCase()} in hospital (${admissionNo(a.number)})` }, tx);
      }
      if (input.followUpAt) {
        await tx.task.create({
          data: { organizationId: a.organizationId, branchId: a.branchId, type: 'RECHECK', title: `Post-discharge check (${admissionNo(a.number)})`, dueAt: input.followUpAt, patientId: a.patientId, clientId: a.clientId, assigneeId: a.responsibleClinicianId, createdById: ctx.userId, createdByName: ctx.userName },
        });
      }
      await this.audit.record({ action: 'admission.discharged', entityType: 'Patient', entityId: a.patientId, summary: `${admissionNo(a.number)}: ${input.outcome.toLowerCase().replace('_', ' ')}` }, tx);
    });
    return this.get(id);
  }

  /** Admitted in error: only possible before any treatment has been recorded. Pending day charges are waived. */
  async cancel(id: string, reason: string) {
    const a = await this.open(id);
    if (await this.prisma.db.treatmentTask.count({ where: { admissionId: id, status: { in: ['DONE', 'SKIPPED'] } } })) {
      throw ruleViolation('HAS_TREATMENTS', 'Treatments have been recorded for this stay — discharge it instead');
    }
    await this.prisma.db.$transaction(async (tx) => {
      const days = Math.max(1, Math.ceil((Date.now() - a.admittedAt.getTime()) / DAY));
      const dayIds = Array.from({ length: days }, (_, i) => stableUuid(`admission-day:${id}:${i + 1}`));
      await this.charges.waiveForSource(tx, 'HospitalDay', dayIds, 'Admission cancelled');
      await tx.treatmentOrder.updateMany({ where: { admissionId: id, status: 'ACTIVE' }, data: { status: 'STOPPED', stopReason: 'Admission cancelled' } });
      await tx.treatmentTask.updateMany({ where: { admissionId: id, status: 'DUE' }, data: { status: 'CANCELLED' } });
      await tx.admission.update({ where: { id }, data: { status: 'CANCELLED', cancelReason: reason } });
      await this.audit.record({ action: 'admission.cancelled', entityType: 'Patient', entityId: a.patientId, summary: `${admissionNo(a.number)}: ${reason}` }, tx);
    });
    return this.get(id);
  }

  /** Current hospital/surgery status for the patient banner. */
  async patientStatus(patientId: string) {
    const [admission, surgery] = await Promise.all([
      this.prisma.db.admission.findFirst({ where: { patientId, status: 'ADMITTED' }, include: { ward: { select: { name: true } }, cage: { select: { name: true } } } }),
      this.prisma.db.surgery.findFirst({ where: { patientId, status: { in: ['PRE_OP', 'IN_PROGRESS', 'RECOVERY'] } }, select: { id: true, number: true, status: true, procedure: true } }),
    ]);
    return {
      admission: admission && { id: admission.id, admissionNo: admissionNo(admission.number), condition: admission.condition, cprStatus: admission.cprStatus, ward: admission.ward?.name ?? null, cage: admission.cage?.name ?? null, admittedAt: admission.admittedAt },
      surgery: surgery && { ...surgery, surgeryNo: formatNumber('SURG', surgery.number) },
    };
  }

  // ── Background upkeep ──

  /**
   * Hourly: extends scheduled treatment tasks, completes orders past their end time and records daily
   * charges for every open stay. Runs per organisation in its own tenant context.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async hourly() {
    if (process.env.NODE_ENV === 'test') return;
    const orgs = await this.prisma.raw.admission.groupBy({ by: ['organizationId'], where: { status: 'ADMITTED' } });
    for (const { organizationId } of orgs) {
      try {
        await RequestContext.runAs({ organizationId, userName: 'System' }, () => this.upkeep());
      } catch (e) {
        this.log.error(`Hospital upkeep failed for ${organizationId}: ${(e as Error).message}`);
      }
    }
  }

  /** Upkeep for the current organisation (also exposed for tests). */
  async upkeep(now = new Date()) {
    const admissions = await this.prisma.db.admission.findMany({ where: { status: 'ADMITTED' }, include: { orders: { where: { status: 'ACTIVE' } } } });
    let tasks = 0;
    let charges = 0;
    for (const a of admissions) {
      await this.prisma.db.$transaction(async (tx) => {
        for (const o of a.orders) {
          if (o.endAt && o.endAt <= now) await tx.treatmentOrder.update({ where: { id: o.id }, data: { status: 'COMPLETED' } });
          else tasks += await this.treatments.ensureTasks(tx, o, now);
        }
        charges += await this.captureDayCharges(tx, a, now);
      });
    }
    return { admissions: admissions.length, tasks, charges };
  }
}
