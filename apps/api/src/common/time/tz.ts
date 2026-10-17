/**
 * Timezone helpers built on Intl (no extra dependency). All persisted times are UTC;
 * branch-local wall-clock times are only used for working hours and "today" boundaries.
 */
const fmtCache = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export interface LocalParts {
  date: string; // YYYY-MM-DD
  year: number;
  month: number;
  day: number;
  dayOfWeek: number; // 0 = Sunday
  minuteOfDay: number;
}

export function localParts(instant: Date, tz: string): LocalParts {
  const parts = Object.fromEntries(formatter(tz).formatToParts(instant).map((p) => [p.type, p.value]));
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    year,
    month,
    day,
    dayOfWeek: WEEKDAYS[parts.weekday],
    minuteOfDay: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/** Offset (minutes) of `tz` from UTC at the given instant. */
function offsetMinutes(instant: Date, tz: string): number {
  const p = Object.fromEntries(formatter(tz).formatToParts(instant).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
}

/** Converts a branch-local date (YYYY-MM-DD) and minute-of-day into a UTC instant (DST-safe). */
export function zonedToUtc(date: string, minuteOfDay: number, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, Math.floor(minuteOfDay / 60), minuteOfDay % 60);
  let utc = guess - offsetMinutes(new Date(guess), tz) * 60000;
  // second pass handles instants that cross a DST transition
  utc = guess - offsetMinutes(new Date(utc), tz) * 60000;
  return new Date(utc);
}

/** UTC bounds [start, end) of the branch-local calendar day containing `instant`. */
export function localDayBounds(instant: Date, tz: string): { start: Date; end: Date; date: string } {
  const { date } = localParts(instant, tz);
  const start = zonedToUtc(date, 0, tz);
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return { start, end: zonedToUtc(next, 0, tz), date };
}

export function dayOfWeekOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Branch-local calendar date of `instant`, as a date-only value (UTC midnight — how Postgres `date`
 * columns round-trip). Use this instead of `toISOString().slice(0, 10)`, which is the UTC date and a
 * day off near local midnight (e.g. 01:00 in Karachi is still yesterday in UTC).
 */
export function localDateOnly(instant: Date, tz: string): Date {
  return new Date(`${localParts(instant, tz).date}T00:00:00.000Z`);
}

/** A date-only value (UTC midnight) moved by whole calendar days. */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86400_000);
}

/** A date-only input (yyyy-MM-dd parsed as UTC midnight) normalised to its calendar date. */
export const dateOnlyInput = (d: Date) => new Date(d.toISOString().slice(0, 10));
