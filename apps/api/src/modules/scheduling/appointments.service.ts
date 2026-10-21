import { Injectable } from '@nestjs/common';
import { AppointmentStatus, Prisma } from '@prisma/client';
import type { CreateAppointmentInput, RescheduleAppointmentInput } from '@vcms/shared';
import { randomUUID } from 'node:crypto';
import { AuditService, diff } from '../../common/audit/audit.service';
import { ClientEvents } from '../../common/events/client-events';
import { RequestContext } from '../../common/context/request-context';
import { CounterService, formatNumber } from '../../common/counter/counter.service';
import { conflict, forbidden, notFound, ruleViolation } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { dayOfWeekOf, localDayBounds, localParts, zonedToUtc } from '../../common/time/tz';
import { EncountersService } from '../clinical/encounters.service';

export const appointmentNo = (n: number) => formatNumber('A', n);

const ACTIVE: AppointmentStatus[] = ['BOOKED', 'CONFIRMED', 'CHECKED_IN', 'IN_CONSULTATION'];
const SLOT_STEP_MIN = 15;

export const appointmentInclude = {
  client: { select: { id: true, displayName: true, mobilePhone: true } },
  patient: {
    select: {
      id: true,
      name: true,
      number: true,
      status: true,
      species: { select: { name: true } },
      alerts: { where: { isActive: true }, select: { id: true, severity: true, title: true, type: true } },
    },
  },
  appointmentType: { select: { id: true, name: true, color: true, category: true, durationMinutes: true } },
  clinician: { select: { id: true, user: { select: { name: true } } } },
  resources: { where: { active: true }, include: { resource: { select: { id: true, name: true, type: true } } } },
  encounter: { select: { id: true, status: true } },
  // Linked work records from the grooming and field-visit modules (shown as shortcuts on the appointment).
  groomingJob: { select: { id: true, status: true } },
  fieldVisit: { select: { id: true, status: true } },
  triage: {
    orderBy: { assessedAt: 'desc' },
    take: 1,
    select: { id: true, priority: true, presentingComplaint: true, assessedAt: true, assessedByName: true },
  },
} satisfies Prisma.AppointmentInclude;

type Row = Prisma.AppointmentGetPayload<{ include: typeof appointmentInclude }>;

export function shapeAppointment(a: Row) {
  return {
    id: a.id,
    number: a.number,
    appointmentNo: appointmentNo(a.number),
    branchId: a.branchId,
    startsAt: a.startsAt,
    endsAt: a.endsAt,
    status: a.status,
    source: a.source,
    priority: a.priority,
    reason: a.reason,
    notes: a.notes,
    isOverbooked: a.isOverbooked,
    recurrenceGroupId: a.recurrenceGroupId,
    followUpOfId: a.followUpOfId,
    checkedInAt: a.checkedInAt,
    startedAt: a.startedAt,
    completedAt: a.completedAt,
    cancelledAt: a.cancelledAt,
    cancelReason: a.cancelReason,
    client: a.client,
    patient: a.patient,
    appointmentType: a.appointmentType,
    clinician: a.clinician ? { id: a.clinician.id, name: a.clinician.user.name } : null,
    resources: a.resources.map((r) => r.resource),
    encounter: a.encounter,
    groomingJob: a.groomingJob,
    fieldVisit: a.fieldVisit,
    triage: a.triage[0] ?? null,
  };
}

interface Resolved {
  branch: { id: string; timezone: string };
  type: { id: string; durationMinutes: number; requiresClinician: boolean; name: string };
  clinician: { id: string; name: string } | null;
  resourceIds: string[];
}

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly counters: CounterService,
    private readonly encounters: EncountersService,
    private readonly events: ClientEvents,
  ) {}

  async list(q: { from: Date; to: Date; branchId?: string; clinicianId?: string; patientId?: string; clientId?: string; status?: string }) {
    if (q.to.getTime() - q.from.getTime() > 62 * 86400_000) throw ruleViolation('RANGE_TOO_LARGE', 'Choose a range of at most 62 days');
    const statuses = q.status?.split(',').filter((s): s is AppointmentStatus => Object.keys(AppointmentStatus).includes(s));
    const rows = await this.prisma.db.appointment.findMany({
      where: {
        startsAt: { lt: q.to },
        endsAt: { gt: q.from },
        branchId: q.branchId,
        clinicianId: q.clinicianId,
        patientId: q.patientId,
        clientId: q.clientId,
        status: statuses?.length ? { in: statuses } : undefined,
      },
      include: appointmentInclude,
      orderBy: { startsAt: 'asc' },
      take: 2000,
    });
    return rows.map(shapeAppointment);
  }

  async get(id: string) {
    const a = await this.prisma.db.appointment.findUnique({ where: { id }, include: appointmentInclude });
    if (!a) throw notFound('Appointment');
    return shapeAppointment(a);
  }

  // ── Validation ──

  private async resolve(input: {
    branchId: string;
    appointmentTypeId: string;
    clinicianId?: string | null;
    resourceIds?: string[];
    deferClinician?: boolean;
  }): Promise<Resolved> {
    const branch = await this.prisma.db.branch.findUnique({ where: { id: input.branchId } });
    if (!branch || !branch.isActive) throw ruleViolation('INVALID_BRANCH', 'Branch does not exist or is inactive');
    const type = await this.prisma.db.appointmentType.findUnique({ where: { id: input.appointmentTypeId } });
    if (!type || !type.isActive) throw ruleViolation('INVALID_TYPE', 'Appointment type does not exist or is inactive');
    let clinician: Resolved['clinician'] = null;
    if (input.clinicianId) {
      const m = await this.prisma.db.membership.findUnique({
        where: { id: input.clinicianId },
        include: { user: { select: { name: true } }, branches: true },
      });
      if (!m || m.status !== 'ACTIVE' || !m.isClinician) throw ruleViolation('INVALID_CLINICIAN', 'Selected clinician is not an active clinician');
      if (!m.branches.some((b) => b.branchId === branch.id)) throw ruleViolation('INVALID_CLINICIAN', 'Clinician does not work at this branch');
      clinician = { id: m.id, name: m.user.name };
    } else if (type.requiresClinician && !input.deferClinician) {
      throw ruleViolation('CLINICIAN_REQUIRED', `${type.name} appointments need a clinician`);
    }
    const resourceIds = [...new Set(input.resourceIds ?? [])];
    if (resourceIds.length) {
      const count = await this.prisma.db.resource.count({ where: { id: { in: resourceIds }, branchId: branch.id, isActive: true } });
      if (count !== resourceIds.length) throw ruleViolation('INVALID_RESOURCE', 'One or more rooms/resources are invalid for this branch');
    }
    return { branch: { id: branch.id, timezone: branch.timezone }, type, clinician, resourceIds };
  }

  private async resolveParties(clientId: string, patientId?: string | null) {
    const client = await this.prisma.db.client.findUnique({ where: { id: clientId }, select: { id: true, status: true } });
    if (!client || client.status !== 'ACTIVE') throw ruleViolation('INVALID_CLIENT', 'Client does not exist or is not active');
    if (patientId) {
      const p = await this.prisma.db.patient.findUnique({
        where: { id: patientId },
        include: { ownerships: { where: { endedAt: null }, select: { clientId: true } } },
      });
      if (!p) throw ruleViolation('INVALID_PATIENT', 'Patient does not exist');
      if (p.status !== 'ACTIVE') throw ruleViolation('PATIENT_NOT_ACTIVE', `Cannot book for a patient whose status is ${p.status.toLowerCase()}`);
      if (!p.ownerships.some((o) => o.clientId === clientId)) throw ruleViolation('PATIENT_NOT_OWNED', 'This patient does not belong to the selected client');
    }
  }

  /**
   * Checks leave, working hours and overlaps. Overlaps are also enforced by a database
   * exclusion constraint, so concurrent requests cannot double-book.
   */
  private async checkSlot(
    r: Resolved,
    startsAt: Date,
    endsAt: Date,
    opts: { allowOverbook: boolean; allowOutsideHours: boolean; excludeId?: string; patientId?: string | null },
  ) {
    if (r.clinician) {
      const leave = await this.prisma.db.staffLeave.findFirst({
        where: { membershipId: r.clinician.id, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
      });
      if (leave) throw ruleViolation('CLINICIAN_ON_LEAVE', `${r.clinician.name} is on leave at that time`);

      if (!opts.allowOutsideHours) {
        const start = localParts(startsAt, r.branch.timezone);
        const end = localParts(new Date(endsAt.getTime() - 1), r.branch.timezone);
        const hours = await this.prisma.db.workingHours.findMany({
          where: { membershipId: r.clinician.id, branchId: r.branch.id, dayOfWeek: start.dayOfWeek },
        });
        const endMinute = end.minuteOfDay + 1;
        const within = start.date === end.date && hours.some((h) => h.startMinute <= start.minuteOfDay && h.endMinute >= endMinute);
        if (!within) {
          throw ruleViolation('OUTSIDE_WORKING_HOURS', `${r.clinician.name} is not working at this time`, {
            canOverride: true,
          });
        }
      }

      if (!opts.allowOverbook) {
        const clash = await this.prisma.db.appointment.findFirst({
          where: {
            clinicianId: r.clinician.id,
            isOverbooked: false,
            status: { in: ACTIVE },
            startsAt: { lt: endsAt },
            endsAt: { gt: startsAt },
            id: opts.excludeId ? { not: opts.excludeId } : undefined,
          },
          include: { patient: { select: { name: true } } },
        });
        if (clash) {
          // Booking the same animal twice is usually a duplicate, so say so plainly.
          const samePatient = !!opts.patientId && clash.patientId === opts.patientId;
          const message = samePatient
            ? `${clash.patient!.name} is already booked at this time (${appointmentNo(clash.number)} with ${r.clinician.name})`
            : `${r.clinician.name} already has ${appointmentNo(clash.number)}${clash.patient ? ` (${clash.patient.name})` : ''} at that time`;
          throw conflict(message, { code: 'CLINICIAN_BUSY', appointmentId: clash.id, samePatient, canOverride: true });
        }
      }
    }
    if (r.resourceIds.length) {
      const clash = await this.prisma.db.appointmentResource.findFirst({
        where: {
          resourceId: { in: r.resourceIds },
          active: true,
          startsAt: { lt: endsAt },
          endsAt: { gt: startsAt },
          appointmentId: opts.excludeId ? { not: opts.excludeId } : undefined,
        },
        include: { resource: { select: { name: true } } },
      });
      if (clash) throw conflict(`${clash.resource.name} is already booked at that time`, { code: 'RESOURCE_BUSY' });
    }
  }

  // ── Create ──

  async create(input: CreateAppointmentInput) {
    const ctx = RequestContext.require();
    const r = await this.resolve(input);
    await this.resolveParties(input.clientId, input.patientId);
    if (input.followUpOfId) {
      const prev = await this.prisma.db.appointment.findUnique({ where: { id: input.followUpOfId } });
      if (!prev) throw ruleViolation('INVALID_FOLLOW_UP', 'Original appointment not found');
    }
    const duration = input.durationMinutes ?? r.type.durationMinutes;
    const occurrences = input.repeat ? input.repeat.occurrences : 1;
    const groupId = occurrences > 1 ? randomUUID() : null;
    const slots = Array.from({ length: occurrences }, (_, i) => {
      const startsAt = new Date(input.startsAt.getTime() + i * (input.repeat?.everyWeeks ?? 0) * 7 * 86400_000);
      return { startsAt, endsAt: new Date(startsAt.getTime() + duration * 60_000) };
    });
    if (slots[0].startsAt.getTime() < Date.now() - 24 * 3600_000 && input.source !== 'WALK_IN') {
      throw ruleViolation('PAST_DATE', 'Appointments cannot be booked more than a day in the past');
    }

    // Validate every occurrence up front so a recurring series is all-or-nothing.
    const problems: { startsAt: Date; message: string }[] = [];
    for (const s of slots) {
      try {
        await this.checkSlot(r, s.startsAt, s.endsAt, { allowOverbook: input.allowOverbook, allowOutsideHours: input.allowOutsideHours, patientId: input.patientId });
      } catch (e: any) {
        if (occurrences === 1) throw e;
        problems.push({ startsAt: s.startsAt, message: e?.response?.message ?? e.message });
      }
    }
    if (problems.length) throw conflict(`${problems.length} of ${occurrences} occurrences cannot be booked`, { code: 'SERIES_CONFLICT', problems });

    const created = await this.prisma.db.$transaction(async (tx) => {
      const ids: string[] = [];
      for (const s of slots) {
        const number = await this.counters.next(tx, 'appointment');
        const a = await tx.appointment.create({
          data: {
            organizationId: ctx.organizationId!,
            branchId: r.branch.id,
            number,
            clientId: input.clientId,
            patientId: input.patientId ?? null,
            appointmentTypeId: r.type.id,
            clinicianId: r.clinician?.id ?? null,
            startsAt: s.startsAt,
            endsAt: s.endsAt,
            source: input.source,
            reason: input.reason,
            notes: input.notes,
            isOverbooked: input.allowOverbook,
            recurrenceGroupId: groupId,
            followUpOfId: input.followUpOfId ?? null,
            createdById: ctx.userId,
            resources: r.resourceIds.length
              ? { create: r.resourceIds.map((resourceId) => ({ resourceId, startsAt: s.startsAt, endsAt: s.endsAt })) }
              : undefined,
          },
        });
        ids.push(a.id);
        await this.audit.record(
          {
            action: 'appointment.booked',
            entityType: 'Appointment',
            entityId: a.id,
            summary: `${appointmentNo(number)} ${r.type.name} ${s.startsAt.toISOString()}${input.allowOverbook ? ' (overbooked)' : ''}${input.allowOutsideHours ? ' (outside working hours)' : ''}`,
          },
          tx,
        );
      }
      return ids;
    });
    // The client hears about it (walk-ins are already at the desk; a series is confirmed once, with its first visit).
    if (input.source !== 'WALK_IN' && slots[0].startsAt.getTime() > Date.now()) await this.events.emit({ type: 'APPOINTMENT_BOOKED', appointmentId: created[0] });
    const rows = await this.prisma.db.appointment.findMany({ where: { id: { in: created } }, include: appointmentInclude, orderBy: { startsAt: 'asc' } });
    const shaped = rows.map(shapeAppointment);
    return occurrences > 1 ? { series: shaped } : shaped[0];
  }

  // ── Reschedule / edit ──

  async reschedule(id: string, input: RescheduleAppointmentInput) {
    const a = await this.prisma.db.appointment.findUnique({ where: { id }, include: { resources: { where: { active: true } } } });
    if (!a) throw notFound('Appointment');
    if (!['BOOKED', 'CONFIRMED', 'CHECKED_IN'].includes(a.status)) {
      throw ruleViolation('NOT_EDITABLE', `A ${a.status.toLowerCase().replace('_', ' ')} appointment cannot be changed`);
    }
    if (input.patientId) await this.resolveParties(a.clientId, input.patientId);
    const r = await this.resolve({
      branchId: a.branchId,
      appointmentTypeId: input.appointmentTypeId ?? a.appointmentTypeId,
      clinicianId: input.clinicianId === undefined ? a.clinicianId : input.clinicianId,
      resourceIds: input.resourceIds ?? a.resources.map((x) => x.resourceId),
    });
    const startsAt = input.startsAt ?? a.startsAt;
    const duration = input.durationMinutes ?? (input.appointmentTypeId ? r.type.durationMinutes : (a.endsAt.getTime() - a.startsAt.getTime()) / 60_000);
    const endsAt = new Date(startsAt.getTime() + duration * 60_000);
    const timeChanged = startsAt.getTime() !== a.startsAt.getTime() || endsAt.getTime() !== a.endsAt.getTime();
    const overbook = input.allowOverbook || (a.isOverbooked && !timeChanged && r.clinician?.id === a.clinicianId);
    await this.checkSlot(r, startsAt, endsAt, { allowOverbook: overbook, allowOutsideHours: input.allowOutsideHours, excludeId: id, patientId: input.patientId === undefined ? a.patientId : input.patientId });

    await this.prisma.db.$transaction(async (tx) => {
      const after = await tx.appointment.update({
        where: { id },
        data: {
          startsAt,
          endsAt,
          clinicianId: r.clinician?.id ?? null,
          appointmentTypeId: r.type.id,
          patientId: input.patientId === undefined ? undefined : input.patientId,
          reason: input.reason,
          notes: input.notes,
          isOverbooked: overbook,
          // a time change resets confirmation
          status: timeChanged && a.status === 'CONFIRMED' ? 'BOOKED' : undefined,
          confirmedAt: timeChanged && a.status === 'CONFIRMED' ? null : undefined,
        },
      });
      await tx.appointmentResource.updateMany({ where: { appointmentId: id }, data: { active: false } });
      await tx.appointmentResource.deleteMany({ where: { appointmentId: id } });
      if (r.resourceIds.length) {
        await tx.appointmentResource.createMany({ data: r.resourceIds.map((resourceId) => ({ appointmentId: id, resourceId, startsAt, endsAt })) });
      }
      await this.audit.record(
        {
          action: timeChanged ? 'appointment.rescheduled' : 'appointment.updated',
          entityType: 'Appointment',
          entityId: id,
          summary: appointmentNo(a.number),
          changes: diff(a, after, ['startsAt', 'endsAt', 'clinicianId', 'appointmentTypeId', 'patientId', 'reason', 'notes', 'isOverbooked']),
        },
        tx,
      );
    });
    if (timeChanged && startsAt.getTime() > Date.now()) await this.events.emit({ type: 'APPOINTMENT_RESCHEDULED', appointmentId: id });
    return this.get(id);
  }

  // ── Status workflow ──

  async transition(id: string, action: string, reason?: string | null) {
    const ctx = RequestContext.require();
    const perms = ctx.permissions;
    const a = await this.prisma.db.appointment.findUnique({ where: { id } });
    if (!a) throw notFound('Appointment');
    const now = new Date();
    const need = (...p: string[]) => {
      if (!p.some((x) => perms.has(x))) throw forbidden();
    };
    const from = (...s: AppointmentStatus[]) => {
      if (!s.includes(a.status)) {
        throw ruleViolation('INVALID_TRANSITION', `Cannot ${action.replace('-', ' ')} an appointment that is ${a.status.toLowerCase().replace('_', ' ')}`);
      }
    };

    let data: Prisma.AppointmentUncheckedUpdateInput = {};
    let encounterId: string | null = null;
    switch (action) {
      case 'confirm':
        need('appointments.write', 'appointments.checkin');
        from('BOOKED');
        data = { status: 'CONFIRMED', confirmedAt: now };
        break;
      case 'check-in':
        need('appointments.checkin');
        from('BOOKED', 'CONFIRMED');
        data = { status: 'CHECKED_IN', checkedInAt: now };
        break;
      case 'start':
        need('clinical.write');
        from('BOOKED', 'CONFIRMED', 'CHECKED_IN');
        if (!a.patientId) throw ruleViolation('NO_PATIENT', 'Add a patient to the appointment before starting a consultation');
        data = { status: 'IN_CONSULTATION', startedAt: now, checkedInAt: a.checkedInAt ?? now };
        // An unassigned appointment (typically a walk-in) is taken by the clinician who starts it.
        if (!a.clinicianId && ctx.membershipId) {
          const me = await this.prisma.db.membership.findUnique({ where: { id: ctx.membershipId }, select: { id: true, status: true, isClinician: true } });
          if (me?.status === 'ACTIVE' && me.isClinician) {
            data.clinicianId = me.id;
            // Taking the patient alongside the clinician's own bookings must not trip the no-overlap constraint.
            if (!a.isOverbooked) {
              const clash = await this.prisma.db.appointment.findFirst({
                where: { clinicianId: me.id, isOverbooked: false, status: { notIn: ['CANCELLED', 'NO_SHOW'] }, startsAt: { lt: a.endsAt }, endsAt: { gt: a.startsAt }, id: { not: a.id } },
                select: { id: true },
              });
              if (clash) data.isOverbooked = true;
            }
            a.clinicianId = me.id; // the encounter opened below inherits it
          }
        }
        break;
      case 'complete':
        need('clinical.write', 'appointments.checkin');
        from('CHECKED_IN', 'IN_CONSULTATION');
        data = { status: 'COMPLETED', completedAt: now };
        break;
      case 'cancel':
        need('appointments.write');
        from('BOOKED', 'CONFIRMED', 'CHECKED_IN');
        if (!reason) throw ruleViolation('REASON_REQUIRED', 'A cancellation reason is required');
        data = { status: 'CANCELLED', cancelledAt: now, cancelReason: reason };
        break;
      case 'no-show':
        need('appointments.write', 'appointments.checkin');
        from('BOOKED', 'CONFIRMED');
        if (a.startsAt > now) throw ruleViolation('NOT_YET_DUE', 'An appointment can only be marked as a no-show after its start time');
        data = { status: 'NO_SHOW' };
        break;
      case 'revert':
        need('appointments.checkin');
        from('CHECKED_IN', 'NO_SHOW');
        data = { status: 'BOOKED', checkedInAt: null };
        break;
      default:
        throw ruleViolation('INVALID_ACTION', 'Unknown action');
    }

    await this.prisma.db.$transaction(async (tx) => {
      await tx.appointment.update({ where: { id }, data });
      const releases = ['CANCELLED', 'NO_SHOW'].includes(String(data.status));
      await tx.appointmentResource.updateMany({ where: { appointmentId: id }, data: { active: !releases } });
      if (action === 'start') encounterId = await this.encounters.ensureForAppointment(tx, a);
      if (action === 'complete') await this.encounters.completeForAppointment(tx, a.id);
      await this.audit.record(
        { action: `appointment.${action.replace('-', '_')}`, entityType: 'Appointment', entityId: id, summary: [appointmentNo(a.number), reason].filter(Boolean).join(': ') },
        tx,
      );
    });
    if (action === 'cancel' && a.startsAt.getTime() > Date.now()) await this.events.emit({ type: 'APPOINTMENT_CANCELLED', appointmentId: id });
    const result = await this.get(id);
    return { ...result, encounterId: encounterId ?? result.encounter?.id ?? null };
  }

  /**
   * Cancellation by the client through the portal: only their own booked/confirmed appointments, and
   * only up to the clinic's notice period. Releases rooms/theatres like a staff cancellation.
   */
  async cancelByClient(id: string, clientId: string, reason: string, minHoursNotice: number) {
    const a = await this.prisma.db.appointment.findUnique({ where: { id } });
    if (!a || a.clientId !== clientId) throw notFound('Appointment');
    if (!['BOOKED', 'CONFIRMED'].includes(a.status)) throw ruleViolation('INVALID_TRANSITION', 'This appointment can no longer be cancelled online');
    if (a.startsAt.getTime() < Date.now() + minHoursNotice * 3600_000) throw ruleViolation('TOO_LATE', `Online cancellation closes ${minHoursNotice} hours before the appointment. Please call the clinic.`);
    await this.prisma.db.$transaction(async (tx) => {
      await tx.appointment.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: `Cancelled by client: ${reason}` } });
      await tx.appointmentResource.updateMany({ where: { appointmentId: id }, data: { active: false } });
      await this.audit.record({ action: 'appointment.cancelled_by_client', entityType: 'Appointment', entityId: id, summary: `${appointmentNo(a.number)}: ${reason}` }, tx);
    });
  }

  // ── Availability ──

  /** Free start times per clinician for a branch-local date and appointment type. */
  async availability(q: { branchId: string; date: string; appointmentTypeId: string; clinicianId?: string }) {
    const branch = await this.prisma.db.branch.findUnique({ where: { id: q.branchId } });
    if (!branch) throw notFound('Branch');
    const type = await this.prisma.db.appointmentType.findUnique({ where: { id: q.appointmentTypeId } });
    if (!type) throw notFound('Appointment type');
    const tz = branch.timezone;
    const dow = dayOfWeekOf(q.date);
    const dayStart = zonedToUtc(q.date, 0, tz);
    const dayEnd = zonedToUtc(q.date, 1440, tz);
    const clinicians = await this.prisma.db.membership.findMany({
      where: {
        id: q.clinicianId,
        status: 'ACTIVE',
        isClinician: true,
        branches: { some: { branchId: branch.id } },
        workingHours: { some: { branchId: branch.id, dayOfWeek: dow } },
      },
      include: {
        user: { select: { name: true } },
        workingHours: { where: { branchId: branch.id, dayOfWeek: dow }, orderBy: { startMinute: 'asc' } },
        leave: { where: { startsAt: { lt: dayEnd }, endsAt: { gt: dayStart } } },
        appointments: {
          where: { status: { in: ACTIVE }, isOverbooked: false, startsAt: { lt: dayEnd }, endsAt: { gt: dayStart } },
          select: { startsAt: true, endsAt: true },
        },
      },
      orderBy: { user: { name: 'asc' } },
    });
    const now = Date.now();
    const duration = type.durationMinutes * 60_000;
    return clinicians.map((c) => {
      const busy = [...c.leave, ...c.appointments].map((b) => [b.startsAt.getTime(), b.endsAt.getTime()] as const);
      const slots: string[] = [];
      for (const h of c.workingHours) {
        for (let m = h.startMinute; m + type.durationMinutes <= h.endMinute; m += SLOT_STEP_MIN) {
          const start = zonedToUtc(q.date, m, tz).getTime();
          const end = start + duration;
          if (start < now) continue;
          if (busy.some(([bs, be]) => bs < end && be > start)) continue;
          slots.push(new Date(start).toISOString());
        }
      }
      return { clinicianId: c.id, name: c.user.name, slots };
    });
  }

  // ── Front desk ──

  async queue(branchId: string) {
    const branch = await this.prisma.db.branch.findUnique({ where: { id: branchId } });
    if (!branch) throw notFound('Branch');
    const { start, end, date } = localDayBounds(new Date(), branch.timezone);
    const rows = await this.prisma.db.appointment.findMany({
      where: { branchId, startsAt: { gte: start, lt: end } },
      include: appointmentInclude,
      orderBy: { startsAt: 'asc' },
    });
    const PRIORITY_RANK: Record<string, number> = { RESUSCITATION: 0, EMERGENT: 1, URGENT: 2, LESS_URGENT: 3, NON_URGENT: 4 };
    const now = Date.now();
    const shaped = rows.map((r) => {
      const s = shapeAppointment(r);
      const effectivePriority = s.triage?.priority ?? s.priority;
      return {
        ...s,
        effectivePriority,
        waitingMinutes: s.checkedInAt && s.status === 'CHECKED_IN' ? Math.floor((now - s.checkedInAt.getTime()) / 60000) : null,
      };
    });
    const waiting = shaped
      .filter((s) => s.status === 'CHECKED_IN')
      .sort(
        (a, b) =>
          (PRIORITY_RANK[a.effectivePriority ?? 'NON_URGENT'] ?? 5) - (PRIORITY_RANK[b.effectivePriority ?? 'NON_URGENT'] ?? 5) ||
          (a.checkedInAt?.getTime() ?? 0) - (b.checkedInAt?.getTime() ?? 0),
      );
    // Finished visits whose client still has work not yet invoiced get a "Bill" button at the front desk.
    const done = shaped.filter((s) => ['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(s.status));
    const doneClients = [...new Set(done.filter((s) => s.status === 'COMPLETED').map((s) => s.client.id))];
    const pending = doneClients.length
      ? await this.prisma.db.charge.groupBy({ by: ['clientId'], where: { clientId: { in: doneClients }, status: 'PENDING' }, _count: { _all: true } })
      : [];
    const unbilled = new Map(pending.map((p) => [p.clientId, p._count._all]));
    return {
      date,
      timezone: branch.timezone,
      expected: shaped.filter((s) => s.status === 'BOOKED' || s.status === 'CONFIRMED'),
      waiting,
      inConsultation: shaped.filter((s) => s.status === 'IN_CONSULTATION'),
      done: done.map((s) => ({ ...s, unbilledCharges: s.status === 'COMPLETED' ? (unbilled.get(s.client.id) ?? 0) : 0 })),
      stats: {
        total: shaped.filter((s) => s.status !== 'CANCELLED').length,
        averageWaitMinutes: waiting.length ? Math.round(waiting.reduce((n, w) => n + (w.waitingMinutes ?? 0), 0) / waiting.length) : 0,
        noShows: shaped.filter((s) => s.status === 'NO_SHOW').length,
      },
    };
  }

  /** Registers an unbooked arrival. Walk-ins are allowed outside rosters and alongside bookings. */
  async walkIn(input: {
    branchId: string;
    clientId: string;
    patientId: string;
    appointmentTypeId: string;
    clinicianId?: string | null;
    reason?: string | null;
    priority?: 'RESUSCITATION' | 'EMERGENT' | 'URGENT' | 'LESS_URGENT' | 'NON_URGENT';
  }) {
    const ctx = RequestContext.require();
    // A walk-in may arrive before a clinician is assigned, so the type's clinician requirement is deferred.
    const r = await this.resolve({ ...input, clinicianId: input.clinicianId ?? null, resourceIds: [], deferClinician: true });
    const type = r.type;
    await this.resolveParties(input.clientId, input.patientId);
    const startsAt = new Date(Math.floor(Date.now() / 60_000) * 60_000);
    const endsAt = new Date(startsAt.getTime() + type.durationMinutes * 60_000);
    const id = await this.prisma.db.$transaction(async (tx) => {
      const number = await this.counters.next(tx, 'appointment');
      const a = await tx.appointment.create({
        data: {
          organizationId: ctx.organizationId!,
          branchId: input.branchId,
          number,
          clientId: input.clientId,
          patientId: input.patientId,
          appointmentTypeId: type.id,
          clinicianId: r?.clinician?.id ?? null,
          startsAt,
          endsAt,
          status: 'CHECKED_IN',
          checkedInAt: startsAt,
          source: 'WALK_IN',
          priority: input.priority ?? null,
          reason: input.reason,
          isOverbooked: true,
          createdById: ctx.userId,
        },
      });
      await this.audit.record(
        { action: 'appointment.walk_in', entityType: 'Appointment', entityId: a.id, summary: `${appointmentNo(number)}${input.priority ? ` priority ${input.priority}` : ''}` },
        tx,
      );
      return a.id;
    });
    return this.get(id);
  }
}
