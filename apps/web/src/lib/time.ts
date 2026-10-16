import { addDays, addMonths, endOfMonth, format } from 'date-fns';
import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz';

/** All appointment times are displayed in the branch's timezone, not the browser's. */
export function branchTime(iso: string | Date, tz: string, pattern = 'HH:mm') {
  return formatInTimeZone(typeof iso === 'string' ? new Date(iso) : iso, tz, pattern);
}

/** YYYY-MM-DD of "today" in the branch timezone. */
export function todayIn(tz: string) {
  return formatInTimeZone(new Date(), tz, 'yyyy-MM-dd');
}

/** UTC instant for a branch-local date + minute of day. */
export function zonedInstant(date: string, minuteOfDay: number, tz: string): Date {
  const hh = String(Math.floor(minuteOfDay / 60)).padStart(2, '0');
  const mm = String(minuteOfDay % 60).padStart(2, '0');
  return fromZonedTime(`${date}T${hh}:${mm}:00`, tz);
}

/** Minute of day (branch-local) for an instant. */
export function minuteOfDay(iso: string | Date, tz: string) {
  const z = toZonedTime(typeof iso === 'string' ? new Date(iso) : iso, tz);
  return z.getHours() * 60 + z.getMinutes();
}

export function localDate(iso: string | Date, tz: string) {
  return formatInTimeZone(typeof iso === 'string' ? new Date(iso) : iso, tz, 'yyyy-MM-dd');
}

export function shiftDate(date: string, days: number) {
  const [y, m, d] = date.split('-').map(Number);
  return format(addDays(new Date(y, m - 1, d), days), 'yyyy-MM-dd');
}

export function weekStart(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const dow = (dt.getDay() + 6) % 7; // Monday-based
  return format(addDays(dt, -dow), 'yyyy-MM-dd');
}

export function dayLabel(date: string, pattern = 'EEE d MMM') {
  const [y, m, d] = date.split('-').map(Number);
  return format(new Date(y, m - 1, d), pattern);
}

export function dowOf(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

export const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
export const parseHhmm = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
};

/** Same day of month `n` months later (clamped to the month's last day), as yyyy-MM-dd. */
export function shiftMonth(date: string, n: number) {
  const [y, m, d] = date.split('-').map(Number);
  return format(addMonths(new Date(y, m - 1, d), n), 'yyyy-MM-dd');
}

/** Monday-start weeks covering the whole month of `date` (5 or 6 rows of 7 dates). */
export function monthGrid(date: string) {
  const [y, m] = date.split('-').map(Number);
  const first = format(new Date(y, m - 1, 1), 'yyyy-MM-dd');
  const last = format(endOfMonth(new Date(y, m - 1, 1)), 'yyyy-MM-dd');
  const start = weekStart(first);
  const days: string[] = [];
  for (let d = start; d <= last || days.length % 7; d = shiftDate(d, 1)) days.push(d);
  return days;
}
