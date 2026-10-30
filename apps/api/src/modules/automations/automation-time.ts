import { localParts, zonedToUtc } from '../../common/time/tz';

/** The next time it is `hour`:00 in the clinic's time zone (today if still ahead), skipping the given weekdays. */
export function nextAt(hour: number, skipDays: number[], tz: string, from = new Date()) {
  const local = localParts(from, tz);
  const [y, m, day] = local.date.split('-').map(Number);
  let d = day;
  if (local.minuteOfDay >= hour * 60) d += 1;
  for (let i = 0; i < 8; i++) {
    const date = new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10);
    if (!skipDays.includes(new Date(`${date}T00:00:00Z`).getUTCDay())) return zonedToUtc(date, hour * 60, tz);
  }
  return zonedToUtc(new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10), hour * 60, tz);
}
