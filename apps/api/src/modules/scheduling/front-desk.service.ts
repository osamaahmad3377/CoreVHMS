import { Injectable } from '@nestjs/common';
import type { TriageInput } from '@vcms/shared';
import { AuditService } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { notFound, ruleViolation } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';

/** Triage assessments and the waiting list. */
@Injectable()
export class FrontDeskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Records a triage assessment. The priority is chosen by staff, never computed automatically. */
  async triage(input: TriageInput) {
    const ctx = RequestContext.require();
    const patient = await this.prisma.db.patient.findUnique({ where: { id: input.patientId } });
    if (!patient) throw notFound('Patient');
    if (input.appointmentId) {
      const a = await this.prisma.db.appointment.findUnique({ where: { id: input.appointmentId } });
      if (!a || a.patientId !== input.patientId) throw ruleViolation('INVALID_APPOINTMENT', 'Appointment does not belong to this patient');
    }
    return this.prisma.db.$transaction(async (tx) => {
      const t = await tx.triageAssessment.create({
        data: { ...input, organizationId: ctx.organizationId!, assessedById: ctx.userId!, assessedByName: ctx.userName ?? 'Unknown' },
      });
      if (input.appointmentId) await tx.appointment.update({ where: { id: input.appointmentId }, data: { priority: input.priority } });
      await this.audit.record(
        { action: 'triage.recorded', entityType: 'Patient', entityId: input.patientId, summary: `${input.priority}: ${input.presentingComplaint}` },
        tx,
      );
      return { ...t, temperatureC: t.temperatureC ? Number(t.temperatureC) : null, capillaryRefillSec: t.capillaryRefillSec ? Number(t.capillaryRefillSec) : null };
    });
  }

  async triageHistory(patientId: string) {
    const rows = await this.prisma.db.triageAssessment.findMany({ where: { patientId }, orderBy: { assessedAt: 'desc' }, take: 50 });
    return rows.map((t) => ({ ...t, temperatureC: t.temperatureC ? Number(t.temperatureC) : null, capillaryRefillSec: t.capillaryRefillSec ? Number(t.capillaryRefillSec) : null }));
  }

  // ── Waitlist ──

  async listWaitlist(branchId?: string) {
    return this.prisma.db.waitlistEntry.findMany({
      where: { status: 'WAITING', branchId },
      include: {
        client: { select: { id: true, displayName: true, mobilePhone: true } },
        patient: { select: { id: true, name: true } },
        appointmentType: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async addToWaitlist(input: {
    branchId: string;
    clientId: string;
    patientId?: string | null;
    appointmentTypeId?: string | null;
    preferredClinicianId?: string | null;
    earliestDate?: Date | null;
    latestDate?: Date | null;
    notes?: string | null;
  }) {
    const ctx = RequestContext.require();
    if (!(await this.prisma.db.branch.findUnique({ where: { id: input.branchId } }))) throw ruleViolation('INVALID_BRANCH', 'Branch not found');
    const client = await this.prisma.db.client.findUnique({ where: { id: input.clientId } });
    if (!client || client.status !== 'ACTIVE') throw ruleViolation('INVALID_CLIENT', 'Client not found');
    if (input.patientId) {
      const own = await this.prisma.db.patientOwnership.findFirst({ where: { patientId: input.patientId, clientId: input.clientId, endedAt: null } });
      if (!own) throw ruleViolation('PATIENT_NOT_OWNED', 'This patient does not belong to the selected client');
    }
    if (input.appointmentTypeId && !(await this.prisma.db.appointmentType.findUnique({ where: { id: input.appointmentTypeId } }))) {
      throw ruleViolation('INVALID_TYPE', 'Appointment type not found');
    }
    if (input.preferredClinicianId && !(await this.prisma.db.membership.findUnique({ where: { id: input.preferredClinicianId } }))) {
      throw ruleViolation('INVALID_CLINICIAN', 'Clinician not found');
    }
    return this.prisma.db.$transaction(async (tx) => {
      const w = await tx.waitlistEntry.create({ data: { ...input, organizationId: ctx.organizationId!, createdById: ctx.userId } });
      await this.audit.record({ action: 'waitlist.added', entityType: 'Client', entityId: input.clientId, summary: input.notes ?? undefined }, tx);
      return w;
    });
  }

  async closeWaitlist(id: string, status: 'BOOKED' | 'REMOVED') {
    const w = await this.prisma.db.waitlistEntry.findUnique({ where: { id } });
    if (!w) throw notFound('Waitlist entry');
    return this.prisma.db.$transaction(async (tx) => {
      const after = await tx.waitlistEntry.update({ where: { id }, data: { status } });
      await this.audit.record({ action: `waitlist.${status.toLowerCase()}`, entityType: 'Client', entityId: w.clientId }, tx);
      return after;
    });
  }
}
