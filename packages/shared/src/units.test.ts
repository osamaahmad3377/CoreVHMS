import { checkVital, vitalRangeMessage } from './schemas/clinical';
import { formatTemperature, formatWeight, temperatureIn, temperatureToC, unitsOf, weightIn, weightToKg } from './units';

describe('weight and temperature units', () => {
  it('reads the clinic’s units, falling back to kg and °C', () => {
    expect(unitsOf({ weightUnit: 'lb', temperatureUnit: 'F' })).toEqual({ weight: 'lb', temperature: 'F' });
    expect(unitsOf({ weightUnit: 'stone', temperatureUnit: null })).toEqual({ weight: 'kg', temperature: 'C' });
    expect(unitsOf(null)).toEqual({ weight: 'kg', temperature: 'C' });
  });

  it('converts weights both ways without drifting', () => {
    expect(weightIn(10, 'lb')).toBe(22.05);
    expect(weightIn('18.5', 'kg')).toBe(18.5);
    expect(weightToKg(22.05, 'lb')).toBe(10.002);
    expect(weightToKg(40, 'kg')).toBe(40);
    // Typed in pounds, stored in kg, shown in pounds again: the same number.
    for (const lb of [0.5, 4.4, 12.3, 55, 88.75, 1200]) expect(weightIn(weightToKg(lb, 'lb'), 'lb')).toBeCloseTo(lb, 2);
    expect(weightIn(null, 'lb')).toBeNull();
  });

  it('converts temperatures both ways without drifting', () => {
    expect(temperatureIn(38.5, 'F')).toBe(101.3);
    expect(temperatureIn(38.5, 'C')).toBe(38.5);
    expect(temperatureToC(101.3, 'F')).toBe(38.5);
    // Every reading a thermometer shows in °F comes back exactly.
    for (let f = 95; f <= 107; f = Math.round((f + 0.1) * 10) / 10) expect(temperatureIn(temperatureToC(f, 'F'), 'F')).toBe(f);
  });

  it('formats for people', () => {
    expect(formatWeight(18.5, 'kg')).toBe('18.5 kg');
    expect(formatWeight(18.5, 'lb')).toBe('40.8 lb');
    expect(formatWeight(0.45, 'kg')).toBe('0.45 kg');
    expect(formatWeight(450, 'lb')).toBe('992 lb');
    expect(formatWeight(null, 'lb')).toBe('—');
    expect(formatTemperature(38.6, 'C')).toBe('38.6 °C');
    expect(formatTemperature(38.6, 'F')).toBe('101.5 °F');
  });

  it('checks typed vitals in the clinic’s units', () => {
    const us = { weight: 'lb', temperature: 'F' } as const;
    expect(checkVital('temperatureC', '101.5', us)).toBeNull();
    expect(checkVital('temperatureC', '1015', us)).toEqual({ message: 'Temperature must be between 77 and 114.8 °F', suggestion: 101.5 });
    expect(checkVital('temperatureC', '101.5')?.message).toBe('Temperature must be between 25 and 46 °C');
    expect(checkVital('weightKg', '9000', us)).toBeNull();
    expect(vitalRangeMessage('weightKg', us)).toBe('Weight must be between 0.01 and 11023 lb');
  });
});
