import { nextAt } from './automation-time';

describe('nextAt (wait until a time of day, clinic time)', () => {
  const tz = 'Asia/Karachi'; // UTC+5
  it('is later today when the hour is still ahead', () => {
    expect(nextAt(10, [], tz, new Date('2026-10-26T03:00:00Z')).toISOString()).toBe('2026-10-26T05:00:00.000Z'); // 08:00 → 10:00
  });
  it('is tomorrow when the hour has passed', () => {
    expect(nextAt(10, [], tz, new Date('2026-10-26T06:00:00Z')).toISOString()).toBe('2026-10-27T05:00:00.000Z'); // 11:00 → next day 10:00
  });
  it('skips closed days', () => {
    // Fri 30 Oct 2026, 12:00 local → Saturday and Sunday skipped → Monday 2 Nov 10:00.
    expect(nextAt(10, [0, 6], tz, new Date('2026-10-30T07:00:00Z')).toISOString()).toBe('2026-11-02T05:00:00.000Z');
  });
});
