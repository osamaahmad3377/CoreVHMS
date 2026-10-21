/**
 * Repeating care items (vaccinations, deworming, checks): "every N days / weeks / months / years", with an
 * optional end (a number of further doses, or a last date). Shared by the API (scheduling the next dose when
 * one is given) and the web app (labels and the "next due" preview), so both count dates the same way.
 */
export const CARE_REPEAT_UNITS = ['DAY', 'WEEK', 'MONTH', 'YEAR'] as const;
export type CareRepeatUnit = (typeof CARE_REPEAT_UNITS)[number];

const UNIT_WORD: Record<CareRepeatUnit, [string, string]> = { DAY: ['day', 'days'], WEEK: ['week', 'weeks'], MONTH: ['month', 'months'], YEAR: ['year', 'years'] };

/** "Every week", "Every 3 months". */
export function repeatLabel(every: number | null | undefined, unit: CareRepeatUnit | null | undefined): string | null {
  if (!every || !unit) return null;
  const [one, many] = UNIT_WORD[unit];
  return every === 1 ? `Every ${one}` : `Every ${every} ${many}`;
}

/** The interval in words with its end: "Every 2 weeks, 3 more times" / "Every month, until 1 Mar 2027". */
export function repeatSummary(r: { every?: number | null; unit?: CareRepeatUnit | null; times?: number | null; until?: string | null }, fmt: (d: string) => string = (d) => d): string | null {
  const base = repeatLabel(r.every, r.unit);
  if (!base) return null;
  if (r.times) return `${base}, ${r.times} more time${r.times === 1 ? '' : 's'}`;
  if (r.until) return `${base}, until ${fmt(r.until)}`;
  return base;
}

/**
 * A calendar date (UTC midnight) plus the interval. Months and years keep the day of the month, falling back
 * to the month's last day (31 Jan + 1 month = 28/29 Feb).
 */
export function addRepeat(date: Date, every: number, unit: CareRepeatUnit): Date {
  if (unit === 'DAY' || unit === 'WEEK') return new Date(date.getTime() + every * (unit === 'WEEK' ? 7 : 1) * 86_400_000);
  const months = unit === 'YEAR' ? every * 12 : every;
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + months;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(date.getUTCDate(), last)));
}

/** Days → the plainest interval ("365" → every 1 year, "14" → every 2 weeks), for a protocol's schedule. */
export function intervalFromDays(days: number): { every: number; unit: CareRepeatUnit } {
  if (days % 365 === 0) return { every: days / 365, unit: 'YEAR' };
  if (days % 7 === 0) return { every: days / 7, unit: 'WEEK' };
  return { every: days, unit: 'DAY' };
}
