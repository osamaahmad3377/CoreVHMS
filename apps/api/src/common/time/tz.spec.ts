import { addDays, dayOfWeekOf, localDateOnly, localDayBounds, localParts, zonedToUtc } from './tz';

describe('timezone helpers', () => {
  it('converts Karachi local time (UTC+5, no DST) to UTC', () => {
    expect(zonedToUtc('2026-03-10', 9 * 60, 'Asia/Karachi').toISOString()).toBe('2026-03-10T04:00:00.000Z');
  });

  it('handles Sydney daylight saving (AEDT +11 in January, AEST +10 in July)', () => {
    expect(zonedToUtc('2026-01-15', 9 * 60, 'Australia/Sydney').toISOString()).toBe('2026-01-14T22:00:00.000Z');
    expect(zonedToUtc('2026-07-15', 9 * 60, 'Australia/Sydney').toISOString()).toBe('2026-07-14T23:00:00.000Z');
  });

  it('returns local wall-clock parts', () => {
    const p = localParts(new Date('2026-07-14T23:30:00Z'), 'Australia/Sydney');
    expect(p).toMatchObject({ date: '2026-07-15', dayOfWeek: 3, minuteOfDay: 9 * 60 + 30 });
  });

  it('computes local day bounds across the DST change day (Sydney, 5 Apr 2026 has 25 hours)', () => {
    const b = localDayBounds(new Date('2026-04-05T03:00:00Z'), 'Australia/Sydney');
    expect(b.date).toBe('2026-04-05');
    expect((b.end.getTime() - b.start.getTime()) / 3600_000).toBe(25);
  });

  it('gives the weekday of a calendar date', () => {
    expect(dayOfWeekOf('2026-10-14')).toBe(3);
  });
});

describe('date-only helpers', () => {
  it('uses the local calendar date, not the UTC one, just after local midnight', () => {
    // 01:30 on 17 Oct in Karachi is still 16 Oct in UTC.
    expect(localDateOnly(new Date('2026-10-16T20:30:00Z'), 'Asia/Karachi').toISOString()).toBe('2026-10-17T00:00:00.000Z');
    expect(localDateOnly(new Date('2026-10-16T20:30:00Z'), 'UTC').toISOString()).toBe('2026-10-16T00:00:00.000Z');
  });

  it('adds whole days to a date-only value', () => {
    expect(addDays(new Date('2026-10-17T00:00:00Z'), 365).toISOString()).toBe('2027-10-17T00:00:00.000Z');
  });
});
