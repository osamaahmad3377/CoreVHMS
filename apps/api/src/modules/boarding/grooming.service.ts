import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { z } from 'zod';
import type { groomingJobSchema, updateGroomingSchema } from '@vcms/shared';
import { AuditService, diff } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { CounterService, formatNumber } from '../../common/counter/counter.service';
import { conflict, notFound, ruleViolation } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { ScopedTx } from '../../common/prisma/tenant-extension';
import { localDayBounds } from '../../common/time/tz';
import { ChargeCaptureService } from '../billing/charge-capture.service';

export const groomingNo = (n: number) => formatNumber('GRM', n, 5);

const include = {
  patient: {
    select: {
      id: true, name: true, number: true, sex: true,
      species: { select: { name: true } }, breed: { select: { name: true } }, breedText: true,
      alerts: { where: { isActive: true }, select: { id: true, type: true, severity: true, title: true } },
    },
  },
  client: { select: { id: true, displayName: true, mobilePhone: true } },
  groomer: { select: { id: true, user: { select: { name: true } } } },
  appointment: { select: { id: true, number: true, startsAt: true, status: true } },
  services: { orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.GroomingJobInclude;
type Job = Prisma.GroomingJobGetPayload<{ include: typeof include }>;

const shape = (j: Job) => ({
  ...j,
  groomingNo: groomingNo(j.number),
  groomer: j.groomer ? { id: j.groomer.id, name: j.groomer.user.name } : null,
  totalMinor: j.services.reduce((n, s) => n + s.priceMinor, 0),
});

/** Grooming jobs: check-in from a booked grooming appointment (or walk-in), services, ready, collected, billing. */
@Injectable()
export class GroomingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly counters: CounterService,
    private readonly charges: ChargeCaptureService,
  ) {}

  /** The day's grooming: jobs plus booked grooming appointments not yet checked in. */
  async board(branchId: string, date?: string) {
    const branch = await this.prisma.db.branch.findUnique({ where: { id: branchId } });
    if (!branch) throw notFound('Branch');
    const at = date ? new Date(`${date}T12:00:00Z`) : new Date();
    const { start, end } = localDayBounds(at, branch.timezone);
    const [jobs, appointments] = await Promise.all([
      this.prisma.db.groomingJob.findMany({
        where: { branchId, OR: [{ createdAt: { gte: start, lt: end } }, { appointment: { startsAt: { gte: start, lt: end } } }, { status: { in: ['WAITING', 'IN_PROGRESS', 'READY'] }, createdAt: { lt: start } }] },
        include,
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.db.appointment.findMany({
        where: { branchId, startsAt: { gte: start, lt: end }, appointmentType: { category: 'GROOMING' }, status: { in: ['BOOKED', 'CONFIRMED', 'CHECKED_IN'] }, groomingJob: null },
        include: { patient: { select: { id: true, name: true, species: { select: { name: true } } } }, client: { select: { id: true, displayName: true, mobilePhone: true } }, appointmentType: { select: { name: true } }, clinician: { select: { id: true, user: { select: { name: true } } } } },
        orderBy: { startsAt: 'asc' },
      }),
    ]);
    return {
      jobs: jobs.map(shape),
      booked: appointments.map((a) => ({ id: a.id, startsAt: a.startsAt, reason: a.reason, type: a.appointmentType.name, patient: a.patient, client: a.client, staff: a.clinician ? { id: a.clinician.id, name: a.clinician.user.name } : null })),
    };
  }

  async list(q: { patientId?: string; clientId?: string }) {
    const rows = await this.prisma.db.groomingJob.findMany({ where: { patientId: q.patientId, clientId: q.clientId }, include, orderBy: { createdAt: 'desc' }, take: 100 });
    return rows.map(shape);
  }

  async get(id: string) {
    const j = await this.prisma.db.groomingJob.findUnique({ where: { id }, include });
    if (!j) throw notFound('Grooming job');
    const charges = await this.prisma.db.charge.findMany({ where: { sourceType: 'GroomingJobService', sourceId: { in: j.services.map((s) => s.id) } }, select: { id: true, sourceId: true, status: true } });
    return { ...shape(j), charges };
  }

  private async groomer(id?: string | null) {
    if (!id) return null;
    const m = await this.prisma.db.membership.findUnique({ where: { id } });
    if (!m || m.status !== 'ACTIVE') throw ruleViolation('INVALID_STAFF', 'Staff member not found');
    return m.id;
  }

  private async services(ids: string[]) {
    if (!ids.length) return [];
    const rows = await this.prisma.db.service.findMany({ where: { id: { in: ids }, isActive: true } });
    if (rows.length !== new Set(ids).size) throw ruleViolation('INVALID_SERVICE', 'One or more services were not found or are inactive');
    return ids.map((id) => rows.find((r) => r.id === id)!);
  }

  async create(input: z.infer<typeof groomingJobSchema>) {
    const ctx = RequestContext.require();
    let patientId = input.patientId ?? null;
    let clientId: string | null = null;
    let branchId = input.branchId ?? ctx.branchId ?? null;
    let groomerId = await this.groomer(input.groomerId);
    let instructions = input.instructions ?? null;
    if (input.appointmentId) {
      const a = await this.prisma.db.appointment.findUnique({ where: { id: input.appointmentId }, include: { groomingJob: true } });
      if (!a) throw notFound('Appointment');
      if (a.groomingJob) throw conflict('This appointment is already checked in for grooming');
      if (['CANCELLED', 'NO_SHOW', 'COMPLETED'].includes(a.status)) throw ruleViolation('APPOINTMENT_CLOSED', `This appointment is ${a.status.toLowerCase().replace('_', ' ')}`);
      if (!a.patientId) throw ruleViolation('NO_PATIENT', 'Add the animal to the appointment first');
      if (patientId && patientId !== a.patientId) throw ruleViolation('PATIENT_MISMATCH', 'The animal does not match the appointment');
      patientId = a.patientId;
      clientId = a.clientId;
      branchId = a.branchId;
      groomerId = groomerId ?? a.clinicianId;
      instructions = instructions ?? a.reason;
    }
    const patient = await this.prisma.db.patient.findUnique({ where: { id: patientId! }, include: { ownerships: { where: { endedAt: null, isPrimary: true } } } });
    if (!patient || patient.status !== 'ACTIVE') throw ruleViolation('INVALID_PATIENT', 'Animal not found or not active');
    clientId = clientId ?? patient.ownerships[0]?.clientId ?? null;
    if (!clientId) throw ruleViolation('NO_OWNER', 'This animal has no current owner');
    if (!branchId) throw ruleViolation('NO_BRANCH', 'Select a branch first');
    const services = await this.services(input.serviceIds);
    return this.prisma.db.$transaction(async (tx) => {
      const number = await this.counters.next(tx, 'grooming');
      const j = await tx.groomingJob.create({
        data: {
          organizationId: ctx.organizationId!,
          branchId,
          number,
          patientId: patient.id,
          clientId: clientId!,
          appointmentId: input.appointmentId ?? null,
          groomerId,
          instructions,
          createdByName: ctx.userName,
          services: { create: services.map((s) => ({ organizationId: ctx.organizationId!, serviceId: s.id, description: s.name, priceMinor: s.priceMinor })) },
        },
        include,
      });
      if (input.appointmentId) await tx.appointment.updateMany({ where: { id: input.appointmentId, status: { in: ['BOOKED', 'CONFIRMED'] } }, data: { status: 'CHECKED_IN', checkedInAt: new Date() } });
      await this.audit.record({ action: 'grooming.checked_in', entityType: 'Patient', entityId: patient.id, summary: `${groomingNo(number)}${services.length ? ` — ${services.map((s) => s.name).join(', ')}` : ''}` }, tx);
      return shape(j);
    });
  }

  private async job(id: string) {
    const j = await this.prisma.db.groomingJob.findUnique({ where: { id }, include: { services: true } });
    if (!j) throw notFound('Grooming job');
    return j;
  }

  async update(id: string, input: z.infer<typeof updateGroomingSchema>) {
    const before = await this.job(id);
    if (['COLLECTED', 'CANCELLED'].includes(before.status)) throw ruleViolation('JOB_CLOSED', 'This grooming job is closed');
    if (input.groomerId !== undefined) await this.groomer(input.groomerId);
    return this.prisma.db.$transaction(async (tx) => {
      const after = await tx.groomingJob.update({ where: { id }, data: input, include });
      await this.audit.record({ action: 'grooming.updated', entityType: 'Patient', entityId: before.patientId, summary: groomingNo(before.number), changes: diff(before, after, Object.keys(input)) }, tx);
      return shape(after);
    });
  }

  private async captureService(tx: ScopedTx, j: { id: string; number: number; clientId: string; patientId: string; branchId: string }, line: { id: string; serviceId: string; description: string; priceMinor: number }) {
    const svc = await tx.service.findUnique({ where: { id: line.serviceId } });
    return this.charges.capture(tx, {
      sourceType: 'GroomingJobService',
      sourceId: line.id,
      clientId: j.clientId,
      patientId: j.patientId,
      branchId: j.branchId,
      kind: 'SERVICE',
      serviceId: line.serviceId,
      description: `${line.description} (${groomingNo(j.number)})`,
      quantity: 1,
      unitPriceMinor: line.priceMinor,
      taxRateBasisPoints: await this.charges.taxFor(tx, svc?.taxRateId),
    });
  }

  async addService(id: string, serviceId: string, priceMinor?: number | null) {
    const j = await this.job(id);
    if (['COLLECTED', 'CANCELLED'].includes(j.status)) throw ruleViolation('JOB_CLOSED', 'This grooming job is closed');
    const [svc] = await this.services([serviceId]);
    return this.prisma.db.$transaction(async (tx) => {
      const line = await tx.groomingJobService.create({ data: { organizationId: j.organizationId, jobId: id, serviceId, description: svc.name, priceMinor: priceMinor ?? svc.priceMinor } });
      // Work already finished: bill the extra straight away.
      if (j.status === 'READY') await this.captureService(tx, j, line);
      await this.audit.record({ action: 'grooming.service_added', entityType: 'Patient', entityId: j.patientId, summary: `${groomingNo(j.number)}: ${svc.name}` }, tx);
      return line;
    });
  }

  async removeService(id: string, lineId: string) {
    const j = await this.job(id);
    const line = j.services.find((s) => s.id === lineId);
    if (!line) throw notFound('Service line');
    if (['COLLECTED', 'CANCELLED'].includes(j.status)) throw ruleViolation('JOB_CLOSED', 'This grooming job is closed');
    const charge = await this.prisma.db.charge.findFirst({ where: { sourceType: 'GroomingJobService', sourceId: lineId } });
    if (charge && charge.status === 'INVOICED') throw ruleViolation('ALREADY_INVOICED', 'This service has been invoiced; issue a credit note instead');
    return this.prisma.db.$transaction(async (tx) => {
      if (charge) await this.charges.waiveForSource(tx, 'GroomingJobService', [lineId], 'Removed from grooming job');
      await tx.groomingJobService.delete({ where: { id: lineId } });
      await this.audit.record({ action: 'grooming.service_removed', entityType: 'Patient', entityId: j.patientId, summary: `${groomingNo(j.number)}: ${line.description}` }, tx);
      return { removed: true };
    });
  }

  async transition(id: string, action: 'start' | 'ready' | 'collected' | 'cancel' | 'reopen', reason?: string | null) {
    const j = await this.job(id);
    const allowed: Record<typeof action, string[]> = { start: ['WAITING'], ready: ['IN_PROGRESS', 'WAITING'], collected: ['READY'], cancel: ['WAITING', 'IN_PROGRESS'], reopen: ['READY'] };
    if (!allowed[action].includes(j.status)) throw ruleViolation('INVALID_TRANSITION', `Cannot ${action} a job that is ${j.status.toLowerCase().replace('_', ' ')}`);
    if (action === 'ready' && !j.services.length) throw ruleViolation('NO_SERVICES', 'Add the services performed before marking the job ready');
    if (action === 'cancel' && !reason) throw ruleViolation('REASON_REQUIRED', 'Give a reason for cancelling');
    const now = new Date();
    const data =
      action === 'start' ? { status: 'IN_PROGRESS' as const, startedAt: now }
      : action === 'ready' ? { status: 'READY' as const, readyAt: now, startedAt: j.startedAt ?? now }
      : action === 'collected' ? { status: 'COLLECTED' as const, collectedAt: now }
      : action === 'cancel' ? { status: 'CANCELLED' as const, cancelledAt: now, cancelReason: reason }
      : { status: 'IN_PROGRESS' as const, readyAt: null };
    return this.prisma.db.$transaction(async (tx) => {
      if (action === 'ready') for (const line of j.services) await this.captureService(tx, j, line);
      const after = await tx.groomingJob.update({ where: { id }, data, include });
      if (j.appointmentId && action === 'collected') await tx.appointment.updateMany({ where: { id: j.appointmentId, status: { in: ['BOOKED', 'CONFIRMED', 'CHECKED_IN', 'IN_CONSULTATION'] } }, data: { status: 'COMPLETED', completedAt: now } });
      if (j.appointmentId && action === 'cancel') await tx.appointment.updateMany({ where: { id: j.appointmentId, status: { in: ['BOOKED', 'CONFIRMED', 'CHECKED_IN'] } }, data: { status: 'CANCELLED', cancelledAt: now, cancelReason: `Grooming cancelled: ${reason}` } });
      await this.audit.record({ action: `grooming.${action}`, entityType: 'Patient', entityId: j.patientId, summary: `${groomingNo(j.number)}${reason ? `: ${reason}` : ''}` }, tx);
      return shape(after);
    });
  }
}
