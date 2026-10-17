import { Injectable } from '@nestjs/common';
import type { LeaveType, ResourceType } from '@prisma/client';
import type { AppointmentTypeInput, WorkingHoursInput } from '@vcms/shared';
import { AuditService, diff } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { notFound, ruleViolation } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';

/** Configuration for scheduling: appointment types, bookable resources, rosters and leave. */
@Injectable()
export class ScheduleConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── Appointment types ──
  listTypes(includeInactive = false) {
    return this.prisma.db.appointmentType.findMany({
      where: includeInactive ? {} : { isActive: true },
      // The linked service is what gets charged; its price is the one to show when booking.
      include: { service: { select: { id: true, code: true, name: true, priceMinor: true, isActive: true } } },
      orderBy: [{ isActive: 'desc' }, { category: 'asc' }, { name: 'asc' }],
    });
  }

  private async assertService(serviceId?: string | null) {
    if (serviceId && !(await this.prisma.db.service.findUnique({ where: { id: serviceId } }))) throw notFound('Service');
  }

  async createType(input: AppointmentTypeInput) {
    await this.assertService(input.serviceId);
    return this.prisma.db.$transaction(async (tx) => {
      const t = await tx.appointmentType.create({ data: { ...input, organizationId: RequestContext.orgId() } });
      await this.audit.record({ action: 'appointment_type.created', entityType: 'AppointmentType', entityId: t.id, summary: t.name }, tx);
      return t;
    });
  }

  async updateType(id: string, input: Partial<AppointmentTypeInput>) {
    await this.assertService(input.serviceId);
    return this.prisma.db.$transaction(async (tx) => {
      const before = await tx.appointmentType.findUnique({ where: { id } });
      if (!before) throw notFound('Appointment type');
      const after = await tx.appointmentType.update({ where: { id }, data: input });
      await this.audit.record(
        { action: 'appointment_type.updated', entityType: 'AppointmentType', entityId: id, summary: after.name, changes: diff(before, after, Object.keys(input)) },
        tx,
      );
      return after;
    });
  }

  // ── Resources ──
  listResources(branchId?: string, includeInactive = false) {
    return this.prisma.db.resource.findMany({
      where: { branchId, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
      include: { branch: { select: { id: true, name: true } } },
    });
  }

  async createResource(input: { branchId: string; name: string; type: ResourceType; isActive?: boolean }) {
    const branch = await this.prisma.db.branch.findUnique({ where: { id: input.branchId } });
    if (!branch) throw ruleViolation('INVALID_BRANCH', 'Branch does not exist');
    return this.prisma.db.$transaction(async (tx) => {
      const r = await tx.resource.create({ data: { ...input, organizationId: RequestContext.orgId() } });
      await this.audit.record({ action: 'resource.created', entityType: 'Resource', entityId: r.id, summary: r.name }, tx);
      return r;
    });
  }

  async updateResource(id: string, input: Partial<{ name: string; type: ResourceType; isActive: boolean }>) {
    return this.prisma.db.$transaction(async (tx) => {
      const before = await tx.resource.findUnique({ where: { id } });
      if (!before) throw notFound('Resource');
      const after = await tx.resource.update({ where: { id }, data: { name: input.name, type: input.type, isActive: input.isActive } });
      await this.audit.record({ action: 'resource.updated', entityType: 'Resource', entityId: id, changes: diff(before, after, Object.keys(input)) }, tx);
      return after;
    });
  }

  // ── Working hours & leave ──
  private async clinicianMembership(membershipId: string) {
    const m = await this.prisma.db.membership.findUnique({ where: { id: membershipId }, include: { user: { select: { name: true } }, branches: true } });
    if (!m) throw notFound('Staff member');
    return m;
  }

  async getWorkingHours(membershipId: string) {
    await this.clinicianMembership(membershipId);
    return this.prisma.db.workingHours.findMany({ where: { membershipId }, orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }] });
  }

  /** Replaces a staff member's weekly pattern for one branch. */
  async setWorkingHours(membershipId: string, input: WorkingHoursInput) {
    const m = await this.clinicianMembership(membershipId);
    if (!m.branches.some((b) => b.branchId === input.branchId)) {
      throw ruleViolation('NO_BRANCH_ACCESS', 'This staff member does not have access to that branch');
    }
    // A person cannot be rostered at two branches at the same time.
    const others = await this.prisma.db.workingHours.findMany({ where: { membershipId, branchId: { not: input.branchId } } });
    for (const s of input.slots) {
      const clash = others.find((o) => o.dayOfWeek === s.dayOfWeek && o.startMinute < s.endMinute && o.endMinute > s.startMinute);
      if (clash) throw ruleViolation('ROSTER_CLASH', 'These hours overlap with hours at another branch');
    }
    return this.prisma.db.$transaction(async (tx) => {
      const before = await tx.workingHours.findMany({ where: { membershipId, branchId: input.branchId } });
      await tx.workingHours.deleteMany({ where: { membershipId, branchId: input.branchId } });
      if (input.slots.length) {
        await tx.workingHours.createMany({
          data: input.slots.map((s) => ({ ...s, membershipId, branchId: input.branchId, organizationId: RequestContext.orgId() })),
        });
      }
      await this.audit.record(
        {
          action: 'roster.updated',
          entityType: 'Membership',
          entityId: membershipId,
          summary: m.user.name,
          changes: { slots: { from: before.map(fmtSlot), to: input.slots.map(fmtSlot) } },
        },
        tx,
      );
      return tx.workingHours.findMany({ where: { membershipId }, orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }] });
    });
  }

  listLeave(from: Date, to: Date, membershipId?: string) {
    return this.prisma.db.staffLeave.findMany({
      where: { membershipId, startsAt: { lt: to }, endsAt: { gt: from } },
      include: { membership: { select: { id: true, user: { select: { name: true } } } } },
      orderBy: { startsAt: 'asc' },
    });
  }

  async addLeave(input: { membershipId: string; type: LeaveType; startsAt: Date; endsAt: Date; reason?: string | null }) {
    const m = await this.clinicianMembership(input.membershipId);
    const booked = await this.prisma.db.appointment.count({
      where: { clinicianId: input.membershipId, status: { notIn: ['CANCELLED', 'NO_SHOW', 'COMPLETED'] }, startsAt: { lt: input.endsAt }, endsAt: { gt: input.startsAt } },
    });
    return this.prisma.db.$transaction(async (tx) => {
      const l = await tx.staffLeave.create({ data: { ...input, organizationId: RequestContext.orgId(), createdById: RequestContext.require().userId } });
      await this.audit.record(
        { action: 'leave.added', entityType: 'Membership', entityId: input.membershipId, summary: `${m.user.name}: ${input.type} ${input.startsAt.toISOString().slice(0, 10)}–${input.endsAt.toISOString().slice(0, 10)}` },
        tx,
      );
      return { ...l, affectedAppointments: booked };
    });
  }

  async removeLeave(id: string) {
    const l = await this.prisma.db.staffLeave.findUnique({ where: { id } });
    if (!l) throw notFound('Leave');
    await this.prisma.db.$transaction(async (tx) => {
      await tx.staffLeave.delete({ where: { id } });
      await this.audit.record({ action: 'leave.removed', entityType: 'Membership', entityId: l.membershipId }, tx);
    });
  }

  /** Clinicians with their weekly hours and leave for a branch — the roster view. */
  async roster(branchId: string, from: Date, to: Date) {
    const members = await this.prisma.db.membership.findMany({
      where: { status: 'ACTIVE', branches: { some: { branchId } } },
      include: {
        user: { select: { name: true } },
        workingHours: { orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }] },
        leave: { where: { startsAt: { lt: to }, endsAt: { gt: from } }, orderBy: { startsAt: 'asc' } },
      },
      orderBy: [{ isClinician: 'desc' }, { user: { name: 'asc' } }],
    });
    return members.map((m) => ({
      membershipId: m.id,
      name: m.user.name,
      jobTitle: m.jobTitle,
      isClinician: m.isClinician,
      workingHours: m.workingHours,
      leave: m.leave,
    }));
  }
}

const fmtSlot = (s: { dayOfWeek: number; startMinute: number; endMinute: number }) =>
  `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][s.dayOfWeek]} ${hhmm(s.startMinute)}-${hhmm(s.endMinute)}`;
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
