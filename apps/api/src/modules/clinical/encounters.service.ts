import { Injectable } from '@nestjs/common';
import { Appointment, EncounterType, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { CounterService, formatNumber } from '../../common/counter/counter.service';
import { notFound, ruleViolation } from '../../common/http/errors';
import { orderBy, pageArgs, paginated } from '../../common/http/pagination';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { ScopedTx } from '../../common/prisma/tenant-extension';

export const encounterNo = (n: number) => formatNumber('E', n);

const CATEGORY_TO_TYPE: Record<string, EncounterType> = {
  EMERGENCY: 'EMERGENCY',
  FOLLOW_UP: 'FOLLOW_UP',
  VACCINATION: 'VACCINATION',
  FIELD_VISIT: 'FIELD_VISIT',
};

const listInclude = {
  patient: {
    select: {
      id: true,
      name: true,
      number: true,
      species: { select: { name: true } },
      alerts: { where: { isActive: true }, select: { id: true, severity: true, title: true, type: true } },
    },
  },
  client: { select: { id: true, displayName: true } },
  clinician: { select: { id: true, user: { select: { name: true } } } },
  notes: { where: { status: { not: 'SUPERSEDED' } }, select: { id: true, status: true } },
  diagnoses: { select: { id: true, term: true, type: true } },
} satisfies Prisma.EncounterInclude;

export type EncounterHook = (tx: ScopedTx, encounterId: string) => Promise<void>;

@Injectable()
export class EncountersService {
  private readonly completedHooks: EncounterHook[] = [];

  /** Billing registers here to capture the consultation fee when a consultation is completed. */
  registerCompletedHook(h: EncounterHook) {
    this.completedHooks.push(h);
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly counters: CounterService,
  ) {}

  async list(q: {
    page: number;
    pageSize: number;
    q?: string;
    sort?: string;
    status: string;
    patientId?: string;
    clinicianId?: string;
    mine?: boolean;
    from?: Date;
    to?: Date;
  }) {
    const ctx = RequestContext.require();
    const where: Prisma.EncounterWhereInput = {
      status: q.status === 'ALL' ? undefined : (q.status as any),
      patientId: q.patientId,
      clinicianId: q.mine ? ctx.membershipId : q.clinicianId,
      startedAt: q.from || q.to ? { gte: q.from, lt: q.to } : undefined,
      ...(q.q
        ? {
            OR: [
              { patient: { name: { contains: q.q, mode: 'insensitive' } } },
              { client: { displayName: { contains: q.q, mode: 'insensitive' } } },
              { chiefComplaint: { contains: q.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.encounter.findMany({ where, include: listInclude, ...pageArgs(q), orderBy: orderBy(q.sort, ['startedAt', 'number'], { startedAt: 'desc' }) }),
      this.prisma.db.encounter.count({ where }),
    ]);
    return paginated(
      rows.map((e) => ({
        id: e.id,
        number: e.number,
        encounterNo: encounterNo(e.number),
        type: e.type,
        status: e.status,
        chiefComplaint: e.chiefComplaint,
        startedAt: e.startedAt,
        completedAt: e.completedAt,
        patient: e.patient,
        client: e.client,
        clinician: e.clinician ? { id: e.clinician.id, name: e.clinician.user.name } : null,
        noteStatus: e.notes.length === 0 ? 'NONE' : e.notes.every((n) => n.status === 'SIGNED') ? 'SIGNED' : 'UNSIGNED',
        diagnoses: e.diagnoses,
      })),
      total,
      q,
    );
  }

  async get(id: string) {
    const e = await this.prisma.db.encounter.findUnique({
      where: { id },
      include: {
        patient: {
          include: {
            species: true,
            breed: { select: { name: true } },
            alerts: { where: { isActive: true }, orderBy: { severity: 'desc' } },
            ownerships: { where: { endedAt: null, isPrimary: true }, include: { client: { select: { id: true, displayName: true, mobilePhone: true } } } },
          },
        },
        client: { select: { id: true, displayName: true, mobilePhone: true } },
        clinician: { select: { id: true, user: { select: { name: true } } } },
        appointment: { select: { id: true, number: true, status: true, reason: true, appointmentType: { select: { name: true } } } },
        notes: { orderBy: [{ createdAt: 'asc' }, { version: 'asc' }] },
        vitals: { orderBy: { recordedAt: 'desc' } },
        diagnoses: { orderBy: { createdAt: 'asc' } },
        tasks: { orderBy: { dueAt: 'asc' } },
      },
    });
    if (!e) throw notFound('Encounter');
    this.audit.recordAsync({ action: 'encounter.viewed', entityType: 'Encounter', entityId: id });
    const p = e.patient;
    return {
      ...e,
      encounterNo: encounterNo(e.number),
      clinician: e.clinician ? { id: e.clinician.id, name: e.clinician.user.name } : null,
      patient: {
        id: p.id,
        name: p.name,
        patientNo: formatNumber('P', p.number),
        status: p.status,
        sex: p.sex,
        dateOfBirth: p.dateOfBirth,
        dobEstimated: p.dobEstimated,
        deceasedAt: p.deceasedAt,
        species: { id: p.species.id, name: p.species.name, category: p.species.category },
        breed: p.breed?.name ?? p.breedText,
        latestWeightKg: p.latestWeightKg ? Number(p.latestWeightKg) : null,
        photoAttachmentId: p.photoAttachmentId,
        owner: p.ownerships[0]?.client ?? null,
        alerts: p.alerts,
      },
      vitals: e.vitals.map(numericVitals),
    };
  }

  private async clinicianFor(clinicianId?: string | null) {
    const ctx = RequestContext.require();
    const id = clinicianId ?? ctx.membershipId;
    if (!id) return null;
    const m = await this.prisma.db.membership.findUnique({ where: { id } });
    if (!m || m.status !== 'ACTIVE') throw ruleViolation('INVALID_CLINICIAN', 'Clinician is not an active staff member');
    return clinicianId || m.isClinician ? m.id : null;
  }

  /** Opens an encounter without an appointment (walk-in consult, phone advice, field visit). */
  async start(input: { patientId: string; appointmentId?: string | null; type: EncounterType; chiefComplaint?: string | null; clinicianId?: string | null }) {
    const ctx = RequestContext.require();
    const patient = await this.prisma.db.patient.findUnique({
      where: { id: input.patientId },
      include: { ownerships: { where: { endedAt: null, isPrimary: true } } },
    });
    if (!patient) throw notFound('Patient');
    if (patient.status !== 'ACTIVE') throw ruleViolation('PATIENT_NOT_ACTIVE', `Cannot start a consultation for a ${patient.status.toLowerCase()} patient`);
    const owner = patient.ownerships[0];
    if (!owner) throw ruleViolation('NO_OWNER', 'The patient has no current owner');
    const clinicianId = await this.clinicianFor(input.clinicianId);
    if (input.appointmentId) {
      const appt = await this.prisma.db.appointment.findUnique({ where: { id: input.appointmentId }, include: { encounter: true } });
      if (!appt || appt.patientId !== patient.id) throw ruleViolation('INVALID_APPOINTMENT', 'Appointment does not belong to this patient');
      if (appt.encounter) return this.get(appt.encounter.id);
    }
    const id = await this.prisma.db.$transaction(async (tx) => {
      const number = await this.counters.next(tx, 'encounter');
      const e = await tx.encounter.create({
        data: {
          organizationId: ctx.organizationId!,
          branchId: ctx.branchId!,
          number,
          patientId: patient.id,
          clientId: owner.clientId,
          appointmentId: input.appointmentId ?? null,
          clinicianId,
          type: input.type,
          chiefComplaint: input.chiefComplaint,
          createdById: ctx.userId,
        },
      });
      if (input.appointmentId) {
        await tx.appointment.update({
          where: { id: input.appointmentId },
          data: { status: 'IN_CONSULTATION', startedAt: new Date() },
        });
      }
      await this.audit.record({ action: 'encounter.started', entityType: 'Encounter', entityId: e.id, summary: `${encounterNo(number)} ${patient.name}` }, tx);
      return e.id;
    });
    return this.get(id);
  }

  /** Called when an appointment is started from the calendar/front desk. */
  async ensureForAppointment(tx: ScopedTx, appt: Appointment): Promise<string> {
    const existing = await tx.encounter.findUnique({ where: { appointmentId: appt.id } });
    if (existing) return existing.id;
    const ctx = RequestContext.require();
    const owner = await tx.patientOwnership.findFirst({ where: { patientId: appt.patientId!, endedAt: null, isPrimary: true } });
    const type = await tx.appointmentType.findUnique({ where: { id: appt.appointmentTypeId } });
    const number = await this.counters.next(tx, 'encounter');
    const e = await tx.encounter.create({
      data: {
        organizationId: ctx.organizationId!,
        branchId: appt.branchId,
        number,
        patientId: appt.patientId!,
        clientId: owner?.clientId ?? appt.clientId,
        appointmentId: appt.id,
        clinicianId: appt.clinicianId ?? (await this.clinicianFor(null)),
        type: CATEGORY_TO_TYPE[type?.category ?? ''] ?? 'CONSULTATION',
        chiefComplaint: appt.reason,
        createdById: ctx.userId,
      },
    });
    await this.audit.record({ action: 'encounter.started', entityType: 'Encounter', entityId: e.id, summary: encounterNo(number) }, tx);
    return e.id;
  }

  async completeForAppointment(tx: ScopedTx, appointmentId: string) {
    const e = await tx.encounter.findUnique({ where: { appointmentId } });
    if (e && e.status === 'OPEN') {
      await tx.encounter.update({ where: { id: e.id }, data: { status: 'COMPLETED', completedAt: new Date() } });
      for (const h of this.completedHooks) await h(tx, e.id);
      await this.audit.record({ action: 'encounter.completed', entityType: 'Encounter', entityId: e.id }, tx);
    }
  }

  async update(id: string, input: { chiefComplaint?: string | null; type?: EncounterType; clinicianId?: string | null }) {
    const e = await this.prisma.db.encounter.findUnique({ where: { id } });
    if (!e) throw notFound('Encounter');
    if (e.status !== 'OPEN') throw ruleViolation('ENCOUNTER_CLOSED', 'This consultation is closed');
    const clinicianId = input.clinicianId !== undefined ? await this.clinicianFor(input.clinicianId) : undefined;
    return this.prisma.db.$transaction(async (tx) => {
      const after = await tx.encounter.update({ where: { id }, data: { chiefComplaint: input.chiefComplaint, type: input.type, clinicianId } });
      await this.audit.record({ action: 'encounter.updated', entityType: 'Encounter', entityId: id }, tx);
      return after;
    });
  }

  async complete(id: string) {
    const e = await this.prisma.db.encounter.findUnique({ where: { id }, include: { notes: true } });
    if (!e) throw notFound('Encounter');
    if (e.status !== 'OPEN') throw ruleViolation('ENCOUNTER_CLOSED', 'This consultation is already closed');
    const unsigned = e.notes.filter((n) => n.status === 'DRAFT' || n.status === 'REVIEWED').length;
    await this.prisma.db.$transaction(async (tx) => {
      await tx.encounter.update({ where: { id }, data: { status: 'COMPLETED', completedAt: new Date() } });
      for (const h of this.completedHooks) await h(tx, id);
      if (e.appointmentId) {
        await tx.appointment.updateMany({
          where: { id: e.appointmentId, status: { in: ['CHECKED_IN', 'IN_CONSULTATION'] } },
          data: { status: 'COMPLETED', completedAt: new Date() },
        });
      }
      await this.audit.record(
        { action: 'encounter.completed', entityType: 'Encounter', entityId: id, summary: unsigned ? `${unsigned} unsigned note(s) remain` : undefined },
        tx,
      );
    });
    return { ok: true, unsignedNotes: unsigned };
  }

  /** Cancels an encounter opened by mistake. Not allowed once anything has been signed. */
  async cancel(id: string, reason: string) {
    const e = await this.prisma.db.encounter.findUnique({ where: { id }, include: { notes: true } });
    if (!e) throw notFound('Encounter');
    if (e.status !== 'OPEN') throw ruleViolation('ENCOUNTER_CLOSED', 'This consultation is already closed');
    if (e.notes.some((n) => n.status === 'SIGNED' || n.status === 'SUPERSEDED')) {
      throw ruleViolation('HAS_SIGNED_NOTES', 'A consultation with signed notes cannot be cancelled');
    }
    await this.prisma.db.$transaction(async (tx) => {
      await tx.encounter.update({ where: { id }, data: { status: 'CANCELLED', completedAt: new Date() } });
      await this.audit.record({ action: 'encounter.cancelled', entityType: 'Encounter', entityId: id, summary: reason }, tx);
    });
    return { ok: true };
  }
}

export function numericVitals<T extends Record<string, any>>(v: T) {
  const out: Record<string, any> = { ...v };
  for (const k of ['temperatureC', 'weightKg', 'capillaryRefillSec', 'hydrationPercent']) {
    if (out[k] !== null && out[k] !== undefined) out[k] = Number(out[k]);
  }
  return out as T;
}
