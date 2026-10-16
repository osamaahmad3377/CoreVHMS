import { ageInMonths, effectiveInterval, flagValue, selectInterval } from './lab-flags';

// Illustrative limits only — not clinical reference values.
const base = { sex: null, ageMinMonths: null, ageMaxMonths: null, criticalLow: null, criticalHigh: null, source: 'test' };

describe('lab flags', () => {
  it('flags low/high/critical against the interval', () => {
    const i = { low: 10, high: 20, criticalLow: 5, criticalHigh: 30 };
    expect(flagValue(15, i)).toBe('NORMAL');
    expect(flagValue(9.9, i)).toBe('LOW');
    expect(flagValue(20.1, i)).toBe('HIGH');
    expect(flagValue(5, i)).toBe('CRITICAL_LOW');
    expect(flagValue(31, i)).toBe('CRITICAL_HIGH');
    expect(flagValue(15, null)).toBeNull();
  });

  it('supports one-sided intervals', () => {
    expect(flagValue(3, { low: null, high: 2, criticalLow: null, criticalHigh: null })).toBe('HIGH');
    expect(flagValue(1, { low: null, high: 2, criticalLow: null, criticalHigh: null })).toBe('NORMAL');
  });

  it('selects the most specific interval by sex and age', () => {
    const generic = { ...base, low: 1, high: 2 };
    const female = { ...base, sex: 'FEMALE', low: 3, high: 4 };
    const juvenile = { ...base, ageMinMonths: 0, ageMaxMonths: 6, low: 5, high: 6 };
    const all = [generic, female, juvenile];
    expect(selectInterval(all, { sex: 'MALE_NEUTERED', ageMonths: 36 })).toBe(generic);
    expect(selectInterval(all, { sex: 'FEMALE_SPAYED', ageMonths: 36 })).toBe(female);
    expect(selectInterval(all, { sex: 'MALE', ageMonths: 3 })).toBe(juvenile);
    expect(selectInterval([juvenile], { sex: 'MALE', ageMonths: 36 })).toBeNull();
  });

  it('inherits critical limits from a broader interval when the specific one lacks them', () => {
    const generic = { ...base, low: 3, high: 6, criticalLow: 2, criticalHigh: 8 };
    const female = { ...base, sex: 'FEMALE', low: 4, high: 7 };
    const eff = effectiveInterval([generic, female], { sex: 'FEMALE_SPAYED', ageMonths: 60 })!;
    expect(eff).toMatchObject({ low: 4, high: 7, criticalLow: 2, criticalHigh: 8 });
    expect(flagValue(1.5, eff)).toBe('CRITICAL_LOW');
  });

  it('computes age in whole months', () => {
    expect(ageInMonths(new Date('2024-01-15'), new Date('2026-01-14'))).toBe(23);
    expect(ageInMonths(new Date('2024-01-15'), new Date('2026-01-15'))).toBe(24);
    expect(ageInMonths(null)).toBeNull();
  });
});
