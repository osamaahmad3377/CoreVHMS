import { z } from 'zod';
import { optDate, optText, reqText } from './common';

/** Longest single shift that can be recorded (catches a forgotten clock-out a week later). */
export const ATTENDANCE_MAX_SHIFT_HOURS = 24;
/** Longest period the day-by-day summary covers in one request. */
export const ATTENDANCE_MAX_RANGE_DAYS = 92;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a date');
const breakMinutes = z.coerce.number().int().min(0).max(720);

/** Clocking in or out yourself: an optional note ("left early — dentist"). */
export const attendanceClockSchema = z.object({ note: optText(300) });
export type AttendanceClockInput = z.infer<typeof attendanceClockSchema>;

export const attendanceDayQuery = z.object({ date: isoDate, branchId: z.string().uuid().optional() });

export const attendanceRangeQuery = z
  .object({ from: isoDate, to: isoDate, branchId: z.string().uuid().optional(), membershipId: z.string().uuid().optional() })
  .refine((q) => q.to >= q.from, { path: ['to'], message: 'The last day must be on or after the first day' })
  .refine((q) => (Date.parse(q.to) - Date.parse(q.from)) / 86400_000 < ATTENDANCE_MAX_RANGE_DAYS, {
    path: ['to'],
    message: `Choose ${ATTENDANCE_MAX_RANGE_DAYS} days or fewer`,
  });
export type AttendanceRangeQuery = z.infer<typeof attendanceRangeQuery>;

const shiftLengthOk = (inAt?: Date | null, outAt?: Date | null) =>
  !inAt || !outAt || outAt.getTime() - inAt.getTime() <= ATTENDANCE_MAX_SHIFT_HOURS * 3600_000;

/** A manager adds a shift someone forgot to clock (or from a paper timesheet). The reason goes in the audit log. */
export const attendanceRecordSchema = z
  .object({
    membershipId: z.string().uuid(),
    clockInAt: z.coerce.date(),
    clockOutAt: optDate(),
    breakMinutes: breakMinutes.default(0),
    note: optText(300),
    reason: reqText(300),
  })
  .refine((v) => !v.clockOutAt || v.clockOutAt > v.clockInAt, { path: ['clockOutAt'], message: 'Clock out must be after clock in' })
  .refine((v) => shiftLengthOk(v.clockInAt, v.clockOutAt), { path: ['clockOutAt'], message: `A shift can be at most ${ATTENDANCE_MAX_SHIFT_HOURS} hours` });
export type AttendanceRecordInput = z.infer<typeof attendanceRecordSchema>;

/** A manager corrects a shift. Omitted fields stay as they are; clockOutAt null re-opens the shift. */
export const attendanceEditSchema = z
  .object({
    clockInAt: z.coerce.date().optional(),
    clockOutAt: optDate(),
    breakMinutes: breakMinutes.optional(),
    note: optText(300),
    reason: reqText(300),
  })
  .refine((v) => !v.clockInAt || !v.clockOutAt || v.clockOutAt > v.clockInAt, { path: ['clockOutAt'], message: 'Clock out must be after clock in' })
  .refine((v) => shiftLengthOk(v.clockInAt, v.clockOutAt), { path: ['clockOutAt'], message: `A shift can be at most ${ATTENDANCE_MAX_SHIFT_HOURS} hours` });
export type AttendanceEditInput = z.infer<typeof attendanceEditSchema>;

export const attendanceRemoveSchema = z.object({ reason: reqText(300) });

export const attendanceSettingsSchema = z.object({ graceMinutes: z.coerce.number().int().min(0).max(120) });
export type AttendanceSettingsInput = z.infer<typeof attendanceSettingsSchema>;

/**
 * Tick or untick someone in the attendance register for a day. Ticking records their rostered hours; unticking removes
 * that day's shifts (a reason is needed when they clocked in themselves).
 */
export const attendanceRegisterSchema = z.object({
  membershipId: z.string().uuid(),
  date: isoDate,
  present: z.boolean(),
  reason: optText(300),
});
export type AttendanceRegisterInput = z.infer<typeof attendanceRegisterSchema>;
