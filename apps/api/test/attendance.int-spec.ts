import { evaluateDay } from '../src/modules/attendance/attendance.service';
import { closeApp, karachi, prisma, registerOrg, staff } from './helpers';

const TZ = 'Asia/Karachi';
/** A Karachi calendar date `days` ago. */
const pastDate = (days: number) => new Date(Date.now() + 5 * 3600_000 - days * 86400_000).toISOString().slice(0, 10);

async function rostered(org: Awaited<ReturnType<typeof registerOrg>>, role = 'nurse') {
  const s = await staff(org, role);
  const hours = await org.owner.call('put', `/schedules/working-hours/${s.membershipId}`, {
    branchId: org.branchId,
    slots: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startMinute: 9 * 60, endMinute: 17 * 60 })),
  });
  expect(hours.status).toBe(200);
  return s;
}

describe('Staff attendance', () => {
  afterAll(closeApp);

  it('works out late, left early, absent, on leave and day off against the roster', () => {
    const date = '2026-03-10';
    const slots = [{ startMinute: 9 * 60, endMinute: 17 * 60 }];
    const now = new Date(karachi('2026-03-11', '12:00'));
    const rec = (inAt: string, outAt: string | null, breakMinutes = 0) => ({ clockInAt: new Date(karachi(date, inAt)), clockOutAt: outAt ? new Date(karachi(date, outAt)) : null, breakStartedAt: null as Date | null, breakMinutes });
    const day = (records: ReturnType<typeof rec>[], extra: Partial<Parameters<typeof evaluateDay>[0]> = {}) =>
      evaluateDay({ date, tz: TZ, now, grace: 10, slots, onLeave: false, records, ...extra });

    expect(day([rec('09:08', '17:00', 30)])).toMatchObject({ status: 'DONE', lateMinutes: 0, earlyMinutes: 0, workedMinutes: 7 * 60 + 22, rosteredMinutes: 480 });
    expect(day([rec('09:25', '16:30')])).toMatchObject({ lateMinutes: 25, earlyMinutes: 30 });
    expect(day([])).toMatchObject({ status: 'ABSENT' });
    expect(day([], { onLeave: true })).toMatchObject({ status: 'ON_LEAVE' });
    expect(day([], { slots: [] })).toMatchObject({ status: 'DAY_OFF', rosteredMinutes: 0 });
    // Same day, 09:30: not in yet and 30 minutes late so far; 08:55: not in yet, not late.
    expect(day([], { now: new Date(karachi(date, '09:30')) })).toMatchObject({ status: 'NOT_IN_YET', lateMinutes: 30 });
    expect(day([], { now: new Date(karachi(date, '08:55')) })).toMatchObject({ status: 'NOT_IN_YET', lateMinutes: 0 });
    expect(day([], { now: new Date(karachi('2026-03-09', '12:00')) })).toMatchObject({ status: 'UPCOMING' });
    // Before the clinic started recording attendance, a missing clock-in is not an absence.
    expect(day([], { trackedFrom: '2026-03-11' })).toMatchObject({ status: 'NOT_TRACKED' });
    expect(day([], { trackedFrom: date })).toMatchObject({ status: 'ABSENT' });
    // Still on shift at 12:00 (on a break since 11:45): 3 hours in, 15 minutes of break so far.
    const open = { ...rec('09:00', null), breakStartedAt: new Date(karachi(date, '11:45')) };
    expect(day([open], { now: new Date(karachi(date, '12:00')) })).toMatchObject({ status: 'ON_BREAK', workedMinutes: 165 });
  });

  it('staff clock themselves in and out, with breaks', async () => {
    const org = await registerOrg();
    const nurse = await rostered(org);

    const before = await nurse.client.get('/attendance/me');
    expect(before.status).toBe(200);
    expect(before.body.open).toBeNull();

    const inn = await nurse.client.post('/attendance/clock-in', { note: 'Early start' });
    expect(inn.status).toBe(200);
    expect(inn.body).toMatchObject({ membershipId: nurse.membershipId, branchId: org.branchId, source: 'SELF', note: 'Early start' });
    expect((await nurse.client.post('/attendance/clock-in', {})).body.error.code).toBe('ALREADY_CLOCKED_IN');

    expect((await nurse.client.post('/attendance/break/end', {})).body.error.code).toBe('NOT_ON_BREAK');
    expect((await nurse.client.post('/attendance/break/start', {})).status).toBe(200);
    expect((await nurse.client.get('/attendance/me')).body.open).toMatchObject({ id: inn.body.id, branchName: 'Main Clinic' });
    expect((await nurse.client.post('/attendance/break/start', {})).body.error.code).toBe('ALREADY_ON_BREAK');
    // Pretend the break started 20 minutes ago.
    await prisma().staffAttendance.update({ where: { id: inn.body.id }, data: { clockInAt: new Date(Date.now() - 2 * 3600_000), breakStartedAt: new Date(Date.now() - 20 * 60_000) } });

    // Clocking out while on a break ends the break too.
    const out = await nurse.client.post('/attendance/clock-out', { note: 'Dentist' });
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ breakStartedAt: null, note: 'Early start · Dentist' });
    expect(out.body.breakMinutes).toBeGreaterThanOrEqual(20);
    expect((await nurse.client.post('/attendance/clock-out', {})).body.error.code).toBe('NOT_CLOCKED_IN');

    const me = await nurse.client.get('/attendance/me');
    expect(me.body.open).toBeNull();
    expect(me.body.today).toMatchObject({ status: 'DONE' });
    expect(me.body.today.records).toHaveLength(1);
    expect(me.body.today.workedMinutes).toBeGreaterThanOrEqual(99);

    const history = await nurse.client.get(`/attendance/me/history?from=${pastDate(6)}&to=${pastDate(0)}`);
    expect(history.status).toBe(200);
    expect(history.body.members).toHaveLength(1);
    expect(history.body.members[0].days).toHaveLength(7);

    const actions = (await prisma().auditEvent.findMany({ where: { organizationId: org.orgId, entityId: inn.body.id }, select: { action: true } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['attendance.clock_in', 'attendance.break_start', 'attendance.clock_out']));

    // Only managers see everyone's attendance.
    expect((await nurse.client.get(`/attendance?from=${pastDate(0)}&to=${pastDate(0)}`)).status).toBe(403);
    expect((await nurse.client.call('put', '/attendance/settings', { graceMinutes: 0 })).status).toBe(403);
  });

  it('managers see the roster picture, add forgotten shifts, correct and remove them with a reason', async () => {
    const org = await registerOrg();
    const nurse = await rostered(org);
    const [late, absent, leave] = [pastDate(3), pastDate(2), pastDate(1)];
    const lv = await org.owner.post('/schedules/leave', { membershipId: nurse.membershipId, type: 'SICK', startsAt: karachi(leave, '00:00'), endsAt: karachi(pastDate(0), '00:00') });
    expect(lv.status).toBe(201);

    // Forgot to clock: the manager adds the shift (a reason is required).
    expect((await org.owner.post('/attendance', { membershipId: nurse.membershipId, clockInAt: karachi(late, '09:20'), clockOutAt: karachi(late, '17:00') })).status).toBe(400);
    const add = await org.owner.post('/attendance', { membershipId: nurse.membershipId, clockInAt: karachi(late, '09:20'), clockOutAt: karachi(late, '17:00'), breakMinutes: 30, reason: 'Forgot to clock in' });
    expect(add.status).toBe(201);
    expect(add.body).toMatchObject({ source: 'MANAGER', editReason: 'Forgot to clock in' });

    // Overlapping, future, out-before-in and break-longer-than-shift are refused.
    const again = await org.owner.post('/attendance', { membershipId: nurse.membershipId, clockInAt: karachi(late, '16:00'), clockOutAt: karachi(late, '18:00'), reason: 'Dup' });
    expect(again.body.error.code).toBe('SHIFT_OVERLAP');
    const future = new Date(Date.now() + 3 * 3600_000).toISOString();
    expect((await org.owner.post('/attendance', { membershipId: nurse.membershipId, clockInAt: future, reason: 'x' })).body.error.code).toBe('FUTURE_TIME');
    expect((await org.owner.post('/attendance', { membershipId: nurse.membershipId, clockInAt: karachi(absent, '17:00'), clockOutAt: karachi(absent, '09:00'), reason: 'x' })).status).toBe(400);
    expect((await org.owner.post('/attendance', { membershipId: nurse.membershipId, clockInAt: karachi(absent, '09:00'), clockOutAt: karachi(absent, '10:00'), breakMinutes: 60, reason: 'x' })).body.error.code).toBe('BREAK_TOO_LONG');

    const r = await org.owner.get(`/attendance?from=${late}&to=${leave}`);
    expect(r.status).toBe(200);
    expect(r.body.graceMinutes).toBe(10);
    const row = r.body.members.find((m: any) => m.membershipId === nurse.membershipId);
    expect(row.days.map((d: any) => d.status)).toEqual(['DONE', 'ABSENT', 'ON_LEAVE']);
    expect(row.days[0]).toMatchObject({ lateMinutes: 20, workedMinutes: 7 * 60 + 10 });
    expect(row.days[2].leaveType).toBe('SICK');
    expect(row.totals).toMatchObject({ rosteredDays: 2, presentDays: 1, lateDays: 1, absentDays: 1, leaveDays: 1, workedMinutes: 430, rosteredMinutes: 960 });
    // Days before the first shift recorded in the clinic don't count.
    const earlier = await org.owner.get(`/attendance?from=${pastDate(5)}&to=${late}`);
    expect(earlier.body.trackedFrom).toBe(late);
    const erow = earlier.body.members.find((m: any) => m.membershipId === nurse.membershipId);
    expect(erow.days.map((d: any) => d.status)).toEqual(['NOT_TRACKED', 'NOT_TRACKED', 'DONE']);
    expect(erow.totals).toMatchObject({ rosteredDays: 1, absentDays: 0 });

    // A stricter grace period changes nothing here; a looser one forgives the 20 minutes.
    expect((await org.owner.call('put', '/attendance/settings', { graceMinutes: 30 })).body).toEqual({ graceMinutes: 30 });
    expect((await org.owner.get(`/attendance?from=${late}&to=${late}`)).body.members.find((m: any) => m.membershipId === nurse.membershipId).days[0].lateMinutes).toBe(0);

    // Corrections need a reason and are audited with the old and new times.
    expect((await org.owner.patch(`/attendance/${add.body.id}`, { clockInAt: karachi(late, '09:00') })).status).toBe(400);
    const fixed = await org.owner.patch(`/attendance/${add.body.id}`, { clockInAt: karachi(late, '09:00'), reason: 'Was at the door at 9' });
    expect(fixed.status).toBe(200);
    expect(new Date(fixed.body.clockInAt).toISOString()).toBe(karachi(late, '09:00'));
    const audit = await prisma().auditEvent.findFirst({ where: { organizationId: org.orgId, entityId: add.body.id, action: 'attendance.corrected' } });
    expect(audit?.summary).toContain('Was at the door at 9');
    expect(audit?.changes).toMatchObject({ clockInAt: { from: karachi(late, '09:20'), to: karachi(late, '09:00') } });

    expect((await org.owner.call('delete', `/attendance/${add.body.id}`)).status).toBe(400);
    expect((await org.owner.call('delete', `/attendance/${add.body.id}?reason=${encodeURIComponent('Entered twice')}`)).status).toBe(204);
    expect(await prisma().staffAttendance.count({ where: { id: add.body.id } })).toBe(0);
    expect(await prisma().auditEvent.count({ where: { organizationId: org.orgId, entityId: add.body.id, action: 'attendance.removed' } })).toBe(1);

    // A manager can't open a second shift for someone already clocked in.
    expect((await nurse.client.post('/attendance/clock-in', {})).status).toBe(200);
    const second = await org.owner.post('/attendance', { membershipId: nurse.membershipId, clockInAt: karachi(absent, '09:00'), reason: 'x' });
    expect(second.body.error.code).toBe('ALREADY_CLOCKED_IN');
  });

  it('fills in the register with ticks: rostered hours, untick to remove, a reason to remove a real clock-in', async () => {
    const org = await registerOrg();
    const nurse = await rostered(org);
    const off = await staff(org, 'receptionist'); // no roster
    const d = pastDate(2);
    const tick = (body: Record<string, unknown>) => org.owner.post('/attendance/register', { membershipId: nurse.membershipId, date: d, present: true, ...body });

    const t = await tick({});
    expect(t.status).toBe(200);
    expect(t.body).toEqual({ changed: true });
    expect((await tick({})).body).toEqual({ changed: false }); // already ticked
    const day = (await org.owner.get(`/attendance?from=${d}&to=${d}`)).body.members.find((m: any) => m.membershipId === nurse.membershipId).days[0];
    expect(day).toMatchObject({ status: 'PRESENT', workedMinutes: 480, lateMinutes: 0 });
    expect(day.records[0]).toMatchObject({ source: 'REGISTER', editReason: 'Ticked present in the register' });
    expect(new Date(day.records[0].clockInAt).toISOString()).toBe(karachi(d, '09:00'));

    // Not rostered: the times must be entered instead. Future days can't be ticked.
    expect((await org.owner.post('/attendance/register', { membershipId: off.membershipId, date: d, present: true })).body.error.code).toBe('NOT_ROSTERED');
    expect((await tick({ date: pastDate(-2) })).body.error.code).toBe('FUTURE_TIME');
    // Only managers fill in the register.
    expect((await nurse.client.post('/attendance/register', { membershipId: nurse.membershipId, date: d, present: true })).status).toBe(403);

    // Untick a register mark: no reason needed.
    expect((await tick({ present: false })).body).toEqual({ changed: true });
    expect(await prisma().staffAttendance.count({ where: { membershipId: nurse.membershipId } })).toBe(0);
    expect(await prisma().auditEvent.count({ where: { organizationId: org.orgId, action: { in: ['attendance.register_present', 'attendance.register_absent'] } } })).toBe(2);

    // Untick a day the nurse clocked themselves: a reason is needed.
    await nurse.client.post('/attendance/clock-in', {});
    const today = pastDate(0);
    expect((await tick({ date: today, present: false })).body.error.code).toBe('REASON_REQUIRED');
    expect((await tick({ date: today, present: false, reason: 'Clocked in by mistake' })).body).toEqual({ changed: true });
    expect((await nurse.client.get('/attendance/me')).body.open).toBeNull();
  });

  it('keeps each clinic’s attendance to itself', async () => {
    const a = await registerOrg();
    const b = await registerOrg();
    const nurse = await rostered(a);
    const day = pastDate(2);
    const rec = await a.owner.post('/attendance', { membershipId: nurse.membershipId, clockInAt: karachi(day, '09:00'), clockOutAt: karachi(day, '17:00'), reason: 'Paper timesheet' });
    expect(rec.status).toBe(201);

    expect((await b.owner.patch(`/attendance/${rec.body.id}`, { breakMinutes: 0, reason: 'x' })).status).toBe(404);
    expect((await b.owner.call('delete', `/attendance/${rec.body.id}?reason=x`)).status).toBe(404);
    expect((await b.owner.post('/attendance', { membershipId: nurse.membershipId, clockInAt: karachi(day, '09:00'), reason: 'x' })).status).toBe(404);
    expect((await b.owner.get(`/attendance?from=${day}&to=${day}&branchId=${a.branchId}`)).status).toBe(404);
    const own = await b.owner.get(`/attendance?from=${day}&to=${day}`);
    expect(own.body.members.some((m: any) => m.membershipId === nurse.membershipId)).toBe(false);
  });
});
