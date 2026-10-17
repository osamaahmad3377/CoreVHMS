import { checkVital, vitalsSchema } from './index';

describe('vital sign plausibility', () => {
  it('explains an out-of-range value in plain words and suggests the missing decimal point', () => {
    const r = vitalsSchema.safeParse({ temperatureC: 398 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]).toMatchObject({ path: ['temperatureC'], message: 'Temperature must be between 25 and 46 °C' });
    expect(checkVital('temperatureC', '398')).toEqual({ message: 'Temperature must be between 25 and 46 °C', suggestion: 39.8 });
    expect(checkVital('temperatureC', '39.8')).toBeNull();
    expect(checkVital('heartRate', '12.5')?.message).toBe('Heart rate must be a whole number');
  });
});
