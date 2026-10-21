import { addRepeat, intervalFromDays, repeatLabel, repeatSummary } from './care-repeat';
import { careItemSchema } from './schemas/comms';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const iso = (x: Date) => x.toISOString().slice(0, 10);

describe('care repeats', () => {
  it('adds days, weeks, months and years on the calendar', () => {
    expect(iso(addRepeat(d('2026-10-21'), 3, 'DAY'))).toBe('2026-10-24');
    expect(iso(addRepeat(d('2026-10-21'), 2, 'WEEK'))).toBe('2026-11-04');
    expect(iso(addRepeat(d('2026-10-21'), 1, 'MONTH'))).toBe('2026-11-21');
    expect(iso(addRepeat(d('2027-01-31'), 1, 'MONTH'))).toBe('2027-02-28'); // last day of a shorter month
    expect(iso(addRepeat(d('2028-02-29'), 1, 'YEAR'))).toBe('2029-02-28');
    expect(iso(addRepeat(d('2026-11-15'), 3, 'MONTH'))).toBe('2027-02-15'); // across the year end
  });

  it('describes the repeat in plain words', () => {
    expect(repeatLabel(1, 'WEEK')).toBe('Every week');
    expect(repeatLabel(3, 'MONTH')).toBe('Every 3 months');
    expect(repeatLabel(0, 'DAY')).toBeNull();
    expect(repeatSummary({ every: 2, unit: 'WEEK', times: 1 })).toBe('Every 2 weeks, 1 more time');
    expect(repeatSummary({ every: 1, unit: 'MONTH', until: '2027-03-01' })).toBe('Every month, until 2027-03-01');
    expect(intervalFromDays(365)).toEqual({ every: 1, unit: 'YEAR' });
    expect(intervalFromDays(14)).toEqual({ every: 2, unit: 'WEEK' });
    expect(intervalFromDays(10)).toEqual({ every: 10, unit: 'DAY' });
  });

  it('validates the repeat when adding an item', () => {
    const base = { patientId: '00000000-0000-4000-8000-000000000000', kind: 'VACCINATION', title: 'Booster', dueDate: '2026-10-21' };
    expect(careItemSchema.safeParse({ ...base, repeatEvery: 2, repeatUnit: 'WEEK', repeatTimes: 3 }).success).toBe(true);
    expect(careItemSchema.safeParse({ ...base, repeatEvery: 2 }).success).toBe(false); // no unit
    expect(careItemSchema.safeParse({ ...base, repeatEvery: 1, repeatUnit: 'MONTH', repeatTimes: 2, repeatUntil: '2027-01-01' }).success).toBe(false); // both ends
    expect(careItemSchema.safeParse({ ...base, repeatEvery: 1, repeatUnit: 'MONTH', repeatUntil: '2026-10-01' }).success).toBe(false); // ends before it starts
    expect(careItemSchema.safeParse({ ...base, repeatEvery: 0 }).success).toBe(true); // never repeat
  });
});
