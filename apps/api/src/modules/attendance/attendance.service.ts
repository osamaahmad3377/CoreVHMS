import { Injectable } from '@nestjs/common';
import { Prisma, type StaffAttendance } from '@prisma/client';
import { ATTENDANCE_MAX_SHIFT_HOURS, type AttendanceEditInput, type AttendanceRangeQuery, type AttendanceRecordInput, type AttendanceRegisterInput } from '@vcms/shared';
import { AuditService, diff } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { forbidden, notFound, ruleViolation } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { dayOfWeekOf, localParts, zonedToUtc } from '../../common/time/tz';

/** Where someone is with a given day, compared with their roster. */
export type AttendanceStatus = 'IN' | 'ON_BREAK' | 'DONE' | 'NOT_IN_YET' | 'ABSENT' | 'ON_LEAVE' | 'DAY_OFF' | 'UPCOMING' | 'NOT_TRACKED' | 'PRESENT';

export interface DayEvaluation {
  status: AttendanceStatus;
  /** Rostered shifts that day (branch-local minutes). */
  slots: { startMinute: number; endMinute: number }[];
  rosteredMinutes: number;
  workedMinutes: number;
  /** Minutes after the rostered start (beyond the grace period) — for someone not in yet, how late they are so far. */
  lateMinutes: number;
  /** Minutes before the rostered end (beyond the grace period) that the last shift ended. */
  earlyMinutes: number;
  onLeave: boolean;
}

const MIN = 60_000;

/** Minutes actually worked in one shift: clock in → clock out (or now), less breaks (including one still running). */
export function workedMinutes(r: Pick<StaffAttendance, 'clockInAt' | 'clockOutAt' | 'breakStartedAt' | 'breakMinutes'>, now: Date): number {
  const end = r.clockOutAt ?? now;
  const runningBreak = !r.clockOutAt && r.breakStartedAt ? Math.max(0, now.getTime() - r.breakStartedAt.getTime()) / MIN : 0;
  return Math.max(0, Math.round((end.getTime() - r.clockInAt.getTime()) / MIN - r.breakMinutes - runningBreak));
}

/**
 * Compares one person's clock records for one branch-local day with their roster. Pure, so the rules are easy to test:
 * late = first clock-in more than `grace` minutes after the first rostered start; absent = rostered, not on leave, no
 * clock-in and the rostered day is over. Days before the clinic started recording attendance (`trackedFrom`) are never
 * absent — they are NOT_TRACKED.
 */
export function evaluateDay(input: {
  date: string;
  tz: string;
  now: Date;
  grace: number;
  slots: { startMinute: number; endMinute: number }[];
  onLeave: boolean;
  records: (Pick<StaffAttendance, 'clockInAt' | 'clockOutAt' | 'breakStartedAt' | 'breakMinutes'> & { source?: StaffAttendance['source'] })[];
  /** First day attendance was recorded at the clinic (branch-local date). */
  trackedFrom?: string;
}): DayEvaluation {
  const { date, tz, now, grace, onLeave } = input;
  const slots = [...input.slots].sort((a, b) => a.startMinute - b.startMinute);
  const records = [...input.records].sort((a, b) => a.clockInAt.getTime() - b.clockInAt.getTime());
  const rosteredMinutes = slots.reduce((n, s) => n + (s.endMinute - s.startMinute), 0);
  const worked = records.reduce((n, r) => n + workedMinutes(r, now), 0);
  const start = slots.length ? zonedToUtc(date, slots[0].startMinute, tz) : null;
  const end = slots.length ? zonedToUtc(date, Math.max(...slots.map((s) => s.endMinute)), tz) : null;
  const minsAfter = (a: Date, b: Date) => Math.round((a.getTime() - b.getTime()) / MIN);
  const base = { slots, rosteredMinutes, workedMinutes: worked, onLeave, lateMinutes: 0, earlyMinutes: 0 };

  if (records.length) {
    const open = records.find((r) => !r.clockOutAt);
    const late = start ? minsAfter(records[0].clockInAt, start) : 0;
    const last = records[records.length - 1];
    const early = end && !open && last.clockOutAt ? minsAfter(end, last.clockOutAt) : 0;
    return {
      ...base,
      // Ticked in the register (no clock times of their own): simply present.
      status: open ? (open.breakStartedAt ? 'ON_BREAK' : 'IN') : records.every((r) => r.source === 'REGISTER') ? 'PRESENT' : 'DONE',
      lateMinutes: late > grace ? late : 0,
      earlyMinutes: early > grace ? early : 0,
    };
  }
  if (onLeave) return { ...base, status: 'ON_LEAVE' };
  if (!start || !end) return { ...base, status: 'DAY_OFF' };
  if (localParts(now, tz).date < date) return { ...base, status: 'UPCOMING' };
  if (input.trackedFrom && date < input.trackedFrom) return { ...base, status: 'NOT_TRACKED' };
  if (now >= end) return { ...base, status: 'ABSENT' };
  const late = minsAfter(now, start);
  return { ...base, status: 'NOT_IN_YET', lateMinutes: late > grace ? late : 0 };
}

function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to; d = new Date(d.getTime() + 86400_000)) out.push(d.toISOString().slice(0, 10));
  return out;
}
const nextDate = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86400_000).toISOString().slice(0, 10);

const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
const isOverlap = (e: unknown) => e instanceof Error && /23P01|exclusion constraint|_no_overlap/.test(e.message);

/**
 * Staff attendance: everyone clocks themselves in and out (with breaks) at the branch they are working at; managers
 * see who is in, late or absent against the roster, a summary for payroll, and correct mistakes (always with a reason,
 * kept in the audit log).
 */
@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── Settings ──

  async settings() {
    const org = await this.prisma.raw.organization.findUniqueOrThrow({ where: { id: RequestContext.orgId() }, select: { attendanceGraceMinutes: true } });
    return { graceMinutes: org.attendanceGraceMinutes };
  }

  async saveSettings(graceMinutes: number) {
    const id = RequestContext.orgId();
    await this.prisma.raw.$transaction(async (tx) => {
      const before = await tx.organization.findUniqueOrThrow({ where: { id }, select: { attendanceGraceMinutes: true } });
      await tx.organization.update({ where: { id }, data: { attendanceGraceMinutes: graceMinutes } });
      await this.audit.record(
        { action: 'organization.attendance_updated', entityType: 'Organization', entityId: id, changes: diff(before, { attendanceGraceMinutes: graceMinutes }) },
        tx,
      );
    });
    return this.settings();
  }

  // ── Clocking yourself in and out ──

  private me() {
    const ctx = RequestContext.require();
    if (!ctx.membershipId) throw forbidden('Open a clinic first');
    return { membershipId: ctx.membershipId, branchId: ctx.branchId };
  }

  private async branch(branchId?: string) {
    const id = branchId ?? RequestContext.get()?.branchId;
    if (!id) throw ruleViolation('NO_BRANCH', 'Select a branch first');
    // Scoped lookup: the branch must belong to this clinic.
    const b = await this.prisma.db.branch.findUnique({ where: { id }, select: { id: true, name: true, timezone: true } });
    if (!b) throw notFound('Branch');
    return b;
  }

  private openShift(membershipId: string) {
    return this.prisma.db.staffAttendance.findFirst({ where: { membershipId, clockOutAt: null } });
  }

  /** Your shift right now and today's picture, for the clock button. */
  async status() {
    const { membershipId } = this.me();
    const branch = await this.branch();
    const open = await this.openShift(membershipId);
    const today = localParts(new Date(), branch.timezone).date;
    const day = await this.range({ from: today, to: today, branchId: branch.id, membershipId });
    const openBranch = open && open.branchId !== branch.id ? await this.prisma.db.branch.findUnique({ where: { id: open.branchId }, select: { name: true } }) : null;
    return {
      open: open ? { ...open, branchName: openBranch?.name ?? branch.name, workedMinutes: workedMinutes(open, new Date()) } : null,
      today: day.members[0]?.days[0] ?? null,
      branch: { id: branch.id, name: branch.name },
    };
  }

  async clockIn(note?: string | null) {
    const { membershipId } = this.me();
    const branch = await this.branch();
    const m = await this.prisma.db.membership.findUnique({ where: { id: membershipId }, include: { user: { select: { name: true } }, branches: true } });
    if (!m) throw notFound('Staff member');
    if (!m.branches.some((b) => b.branchId === branch.id)) throw ruleViolation('NO_BRANCH_ACCESS', 'You do not work at this branch');
    if (await this.openShift(membershipId)) throw ruleViolation('ALREADY_CLOCKED_IN', 'You are already clocked in');
    try {
      return await this.prisma.db.$transaction(async (tx) => {
        const r = await tx.staffAttendance.create({
          data: { organizationId: RequestContext.orgId(), membershipId, branchId: branch.id, clockInAt: new Date(), note: note ?? null, source: 'SELF' },
        });
        await this.audit.record({ action: 'attendance.clock_in', entityType: 'StaffAttendance', entityId: r.id, summary: `${m.user.name} at ${branch.name}` }, tx);
        return r;
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw ruleViolation('ALREADY_CLOCKED_IN', 'You are already clocked in');
      if (isOverlap(e)) throw ruleViolation('SHIFT_OVERLAP', 'A shift is already recorded for you at this time. Ask your manager to check your attendance.');
      throw e;
    }
  }

  async clockOut(note?: string | null) {
    const { membershipId } = this.me();
    const open = await this.openShift(membershipId);
    if (!open) throw ruleViolation('NOT_CLOCKED_IN', 'You are not clocked in');
    const now = new Date();
    return this.prisma.db.$transaction(async (tx) => {
      const r = await tx.staffAttendance.update({
        where: { id: open.id },
        data: {
          clockOutAt: now,
          breakStartedAt: null,
          breakMinutes: open.breakMinutes + this.runningBreak(open, now),
          note: note ? (open.note ? `${open.note} · ${note}` : note) : open.note,
        },
      });
      await this.audit.record({ action: 'attendance.clock_out', entityType: 'StaffAttendance', entityId: r.id, summary: `${Math.floor(workedMinutes(r, now) / 60)}h ${workedMinutes(r, now) % 60}m worked` }, tx);
      return r;
    });
  }

  private runningBreak(r: StaffAttendance, now: Date) {
    return r.breakStartedAt ? Math.max(0, Math.round((now.getTime() - r.breakStartedAt.getTime()) / MIN)) : 0;
  }

  async startBreak() {
    const { membershipId } = this.me();
    const open = await this.openShift(membershipId);
    if (!open) throw ruleViolation('NOT_CLOCKED_IN', 'You are not clocked in');
    if (open.breakStartedAt) throw ruleViolation('ALREADY_ON_BREAK', 'You are already on a break');
    return this.prisma.db.$transaction(async (tx) => {
      const r = await tx.staffAttendance.update({ where: { id: open.id }, data: { breakStartedAt: new Date() } });
      await this.audit.record({ action: 'attendance.break_start', entityType: 'StaffAttendance', entityId: r.id }, tx);
      return r;
    });
  }

  async endBreak() {
    const { membershipId } = this.me();
    const open = await this.openShift(membershipId);
    if (!open?.breakStartedAt) throw ruleViolation('NOT_ON_BREAK', 'You are not on a break');
    const mins = this.runningBreak(open, new Date());
    return this.prisma.db.$transaction(async (tx) => {
      const r = await tx.staffAttendance.update({ where: { id: open.id }, data: { breakStartedAt: null, breakMinutes: open.breakMinutes + mins } });
      await this.audit.record({ action: 'attendance.break_end', entityType: 'StaffAttendance', entityId: r.id, summary: `${mins} min break` }, tx);
      return r;
    });
  }

  /** Your own attendance over a period (always the branch you are signed in to). */
  myHistory(q: Pick<AttendanceRangeQuery, 'from' | 'to'>) {
    const { membershipId } = this.me();
    return this.range({ ...q, membershipId });
  }

  // ── Everyone's attendance ──

  /**
   * Day-by-day attendance for the staff at a branch (or one person): roster, leave, clock records and status per
   * day, plus totals for the period. A day is the branch-local date of clock-in.
   */
  async range(q: AttendanceRangeQuery) {
    const branch = await this.branch(q.branchId);
    const tz = branch.timezone;
    const now = new Date();
    const { graceMinutes } = await this.settings();
    const from = zonedToUtc(q.from, 0, tz);
    const to = zonedToUtc(nextDate(q.to), 0, tz);
    const members = await this.prisma.db.membership.findMany({
      where: {
        id: q.membershipId,
        OR: [{ status: 'ACTIVE', branches: { some: { branchId: branch.id } } }, { attendance: { some: { branchId: branch.id, clockInAt: { gte: from, lt: to } } } }],
      },
      include: {
        user: { select: { name: true } },
        workingHours: { where: { branchId: branch.id } },
        leave: { where: { startsAt: { lt: to }, endsAt: { gt: from } } },
        attendance: { where: { branchId: branch.id, clockInAt: { gte: from, lt: to } }, orderBy: { clockInAt: 'asc' } },
      },
      orderBy: [{ isClinician: 'desc' }, { user: { name: 'asc' } }],
    });
    const dates = datesBetween(q.from, q.to);
    const today = localParts(now, tz).date;
    // Before the first clock-in anywhere in the clinic nobody was recording attendance, so those days are not absences.
    const first = await this.prisma.db.staffAttendance.findFirst({ orderBy: { clockInAt: 'asc' }, select: { clockInAt: true } });
    const trackedFrom = first ? localParts(first.clockInAt, tz).date : today;

    return {
      from: q.from,
      to: q.to,
      today,
      trackedFrom,
      graceMinutes,
      branch: { id: branch.id, name: branch.name, timezone: tz },
      members: members.map((m) => {
        const days = dates.map((date) => {
          const dayStart = zonedToUtc(date, 0, tz);
          const dayEnd = zonedToUtc(nextDate(date), 0, tz);
          const dow = dayOfWeekOf(date);
          const records = m.attendance.filter((r) => r.clockInAt >= dayStart && r.clockInAt < dayEnd);
          const leave = m.leave.find((l) => l.startsAt < dayEnd && l.endsAt > dayStart) ?? null;
          const ev = evaluateDay({
            date,
            tz,
            now,
            grace: graceMinutes,
            slots: m.workingHours.filter((h) => h.dayOfWeek === dow).map((h) => ({ startMinute: h.startMinute, endMinute: h.endMinute })),
            onLeave: !!leave,
            records,
            trackedFrom,
          });
          return { date, ...ev, leaveType: leave?.type ?? null, records: records.map((r) => ({ ...r, workedMinutes: workedMinutes(r, now) })) };
        });
        const past = days.filter((d) => d.date <= today && d.date >= trackedFrom);
        const totals = {
          rosteredDays: past.filter((d) => d.slots.length && !d.onLeave).length,
          presentDays: past.filter((d) => d.records.length).length,
          lateDays: past.filter((d) => d.records.length && d.lateMinutes > 0).length,
          earlyDays: past.filter((d) => d.earlyMinutes > 0).length,
          absentDays: past.filter((d) => d.status === 'ABSENT').length,
          leaveDays: past.filter((d) => d.onLeave && !d.records.length).length,
          workedMinutes: past.reduce((n, d) => n + d.workedMinutes, 0),
          rosteredMinutes: past.filter((d) => !d.onLeave).reduce((n, d) => n + d.rosteredMinutes, 0),
        };
        return { membershipId: m.id, name: m.user.name, jobTitle: m.jobTitle, isClinician: m.isClinician, days, totals };
      }),
    };
  }

  // ── Manager corrections ──

  private async member(membershipId: string) {
    // Scoped lookup: the staff member must belong to this clinic.
    const m = await this.prisma.db.membership.findUnique({ where: { id: membershipId }, include: { user: { select: { name: true } } } });
    if (!m) throw notFound('Staff member');
    return m;
  }

  private notInFuture(...dates: (Date | null | undefined)[]) {
    const limit = Date.now() + MIN; // a minute of clock skew
    if (dates.some((d) => d && d.getTime() > limit)) throw ruleViolation('FUTURE_TIME', 'Clock times cannot be in the future');
  }

  private async write<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (isUniqueViolation(e)) throw ruleViolation('ALREADY_CLOCKED_IN', 'This person is already clocked in. Clock them out first, or give this shift a clock-out time.');
      if (isOverlap(e)) throw ruleViolation('SHIFT_OVERLAP', 'This overlaps another shift recorded for this person');
      throw e;
    }
  }

  async add(input: AttendanceRecordInput) {
    const m = await this.member(input.membershipId);
    const branch = await this.branch();
    this.notInFuture(input.clockInAt, input.clockOutAt);
    if (input.clockOutAt && input.breakMinutes >= (input.clockOutAt.getTime() - input.clockInAt.getTime()) / MIN) {
      throw ruleViolation('BREAK_TOO_LONG', 'The break is longer than the shift');
    }
    return this.write(() =>
      this.prisma.db.$transaction(async (tx) => {
        const r = await tx.staffAttendance.create({
          data: {
            organizationId: RequestContext.orgId(),
            membershipId: m.id,
            branchId: branch.id,
            clockInAt: input.clockInAt,
            clockOutAt: input.clockOutAt ?? null,
            breakMinutes: input.breakMinutes,
            note: input.note ?? null,
            source: 'MANAGER',
            editedById: RequestContext.require().userId,
            editReason: input.reason,
          },
        });
        await this.audit.record(
          { action: 'attendance.added', entityType: 'StaffAttendance', entityId: r.id, summary: `${m.user.name}: ${input.reason}`, changes: diff(null, r, ['clockInAt', 'clockOutAt', 'breakMinutes', 'note']) },
          tx,
        );
        return r;
      }),
    );
  }

  /**
   * The attendance register: ticking someone present for a day records their rostered hours (one shift per rostered
   * slot); unticking removes that day's shifts. Removing a shift they clocked themselves needs a reason.
   */
  async register(input: AttendanceRegisterInput) {
    const m = await this.member(input.membershipId);
    const branch = await this.branch();
    const tz = branch.timezone;
    if (input.date > localParts(new Date(), tz).date) throw ruleViolation('FUTURE_TIME', 'The register can only be filled in up to today');
    const dayStart = zonedToUtc(input.date, 0, tz);
    const dayEnd = zonedToUtc(nextDate(input.date), 0, tz);
    const existing = await this.prisma.db.staffAttendance.findMany({ where: { membershipId: m.id, branchId: branch.id, clockInAt: { gte: dayStart, lt: dayEnd } } });
    const userId = RequestContext.require().userId;

    if (input.present) {
      if (existing.length) return { changed: false };
      const slots = await this.prisma.db.workingHours.findMany({
        where: { membershipId: m.id, branchId: branch.id, dayOfWeek: dayOfWeekOf(input.date) },
        orderBy: { startMinute: 'asc' },
      });
      if (!slots.length) throw ruleViolation('NOT_ROSTERED', `${m.user.name} is not rostered on this day. Add the shift with its times instead.`);
      const reason = input.reason ?? 'Ticked present in the register';
      return this.write(() =>
        this.prisma.db.$transaction(async (tx) => {
          for (const slot of slots) {
            const r = await tx.staffAttendance.create({
              data: {
                organizationId: RequestContext.orgId(),
                membershipId: m.id,
                branchId: branch.id,
                clockInAt: zonedToUtc(input.date, slot.startMinute, tz),
                clockOutAt: zonedToUtc(input.date, slot.endMinute, tz),
                source: 'REGISTER',
                editedById: userId,
                editReason: reason,
              },
            });
            await this.audit.record(
              { action: 'attendance.register_present', entityType: 'StaffAttendance', entityId: r.id, summary: `${m.user.name}: ${input.date}`, changes: diff(null, r, ['clockInAt', 'clockOutAt']) },
              tx,
            );
          }
          return { changed: true };
        }),
      );
    }

    if (!existing.length) return { changed: false };
    if (existing.some((r) => r.source === 'SELF') && !input.reason) {
      throw ruleViolation('REASON_REQUIRED', `${m.user.name} clocked in themselves that day. Give a reason to remove it.`);
    }
    const reason = input.reason ?? 'Unticked in the register';
    await this.prisma.db.$transaction(async (tx) => {
      await tx.staffAttendance.deleteMany({ where: { id: { in: existing.map((r) => r.id) } } });
      for (const r of existing) {
        await this.audit.record(
          {
            action: 'attendance.register_absent',
            entityType: 'StaffAttendance',
            entityId: r.id,
            summary: `${m.user.name}: ${input.date} — ${reason}`,
            changes: diff(r, { clockInAt: null, clockOutAt: null }, ['clockInAt', 'clockOutAt']),
          },
          tx,
        );
      }
    });
    return { changed: true };
  }

  async edit(id: string, input: AttendanceEditInput) {
    const before = await this.prisma.db.staffAttendance.findUnique({ where: { id }, include: { membership: { select: { user: { select: { name: true } } } } } });
    if (!before) throw notFound('Attendance record');
    const clockInAt = input.clockInAt ?? before.clockInAt;
    const clockOutAt = input.clockOutAt === undefined ? before.clockOutAt : input.clockOutAt;
    this.notInFuture(clockInAt, clockOutAt);
    if (clockOutAt && clockOutAt <= clockInAt) throw ruleViolation('OUT_BEFORE_IN', 'Clock out must be after clock in');
    if (clockOutAt && clockOutAt.getTime() - clockInAt.getTime() > ATTENDANCE_MAX_SHIFT_HOURS * 3600_000) {
      throw ruleViolation('SHIFT_TOO_LONG', `A shift can be at most ${ATTENDANCE_MAX_SHIFT_HOURS} hours`);
    }
    // Closing a shift that is on a break folds the running break into the total.
    const closing = !!clockOutAt && !before.clockOutAt;
    let breakMinutes = input.breakMinutes ?? before.breakMinutes;
    if (closing && before.breakStartedAt && input.breakMinutes === undefined) {
      breakMinutes += Math.max(0, Math.round((clockOutAt!.getTime() - before.breakStartedAt.getTime()) / MIN));
    }
    if (clockOutAt && breakMinutes >= (clockOutAt.getTime() - clockInAt.getTime()) / MIN) throw ruleViolation('BREAK_TOO_LONG', 'The break is longer than the shift');
    const breakStartedAt = clockOutAt ? null : before.breakStartedAt && before.breakStartedAt >= clockInAt ? before.breakStartedAt : null;

    return this.write(() =>
      this.prisma.db.$transaction(async (tx) => {
        const r = await tx.staffAttendance.update({
          where: { id },
          data: {
            clockInAt,
            clockOutAt,
            breakMinutes,
            breakStartedAt,
            note: input.note === undefined ? before.note : input.note,
            editedById: RequestContext.require().userId,
            editReason: input.reason,
          },
        });
        await this.audit.record(
          {
            action: 'attendance.corrected',
            entityType: 'StaffAttendance',
            entityId: id,
            summary: `${before.membership.user.name}: ${input.reason}`,
            changes: diff(before, r, ['clockInAt', 'clockOutAt', 'breakMinutes', 'note']),
          },
          tx,
        );
        return r;
      }),
    );
  }

  async remove(id: string, reason: string) {
    const r = await this.prisma.db.staffAttendance.findUnique({ where: { id }, include: { membership: { select: { user: { select: { name: true } } } } } });
    if (!r) throw notFound('Attendance record');
    await this.prisma.db.$transaction(async (tx) => {
      await tx.staffAttendance.delete({ where: { id } });
      await this.audit.record(
        {
          action: 'attendance.removed',
          entityType: 'StaffAttendance',
          entityId: id,
          summary: `${r.membership.user.name}: ${reason}`,
          changes: diff(r, { clockInAt: null, clockOutAt: null, breakMinutes: null }, ['clockInAt', 'clockOutAt', 'breakMinutes']),
        },
        tx,
      );
    });
  }
}
