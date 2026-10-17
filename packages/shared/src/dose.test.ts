import { FREQUENCIES, calculateDose, compareToRange, courseQuantity, findFrequency, ownerAmount, ownerInstructions, ownerLabelText } from './dose';

// Arithmetic tests only; numbers are illustrative, not clinical recommendations.
describe('dose calculation', () => {
  it('converts a per-kg dose into tablets and rounds to the nearest quarter', () => {
    const r = calculateDose({ weightKg: 12.4, doseValue: 5, doseUnit: 'mg/kg', strengthValue: 50, strengthUnit: 'mg', dispensingUnit: 'tablet', increment: 0.25 });
    if (!r.ok) throw new Error(r.error);
    expect(r.rawAmount).toBe(1.24);
    expect(r.amount).toBe(1.25);
    expect(r.deliveredDose).toBe(62.5);
    expect(r.deliveredPerKg).toBe(5.0403);
    expect(r.steps[0]).toBe('5 mg/kg × 12.4 kg = 62 mg');
  });

  it('handles liquids with mL increments and mass unit conversion (mcg → mg)', () => {
    const r = calculateDose({ weightKg: 4, doseValue: 250, doseUnit: 'mcg/kg', strengthValue: 1, strengthUnit: 'mg', dispensingUnit: 'mL', increment: 0.1 });
    if (!r.ok) throw new Error(r.error);
    expect(r.rawAmount).toBe(1); // 1000 mcg = 1 mg = 1 mL
    expect(r.amount).toBe(1);
  });

  it('supports doses written directly in dispensing units and per-animal doses', () => {
    const a = calculateDose({ doseValue: 2, doseUnit: 'tablet', dispensingUnit: 'tablet', increment: 0.5 });
    expect(a.ok && a.amount).toBe(2);
    const b = calculateDose({ doseValue: 100, doseUnit: 'mg/animal', strengthValue: 50, strengthUnit: 'mg', dispensingUnit: 'capsule', increment: 1 });
    expect(b.ok && b.amount).toBe(2);
  });

  it('refuses unsafe or impossible calculations', () => {
    expect(calculateDose({ doseValue: 5, doseUnit: 'mg/kg', strengthValue: 50, strengthUnit: 'mg', dispensingUnit: 'tablet', increment: 0.5 })).toMatchObject({ ok: false });
    expect(calculateDose({ weightKg: 10, doseValue: 5, doseUnit: 'IU/kg', strengthValue: 50, strengthUnit: 'mg', dispensingUnit: 'mL', increment: 0.1 })).toMatchObject({ ok: false });
    expect(calculateDose({ weightKg: 0.2, doseValue: 1, doseUnit: 'mg/kg', strengthValue: 50, strengthUnit: 'mg', dispensingUnit: 'tablet', increment: 0.5 })).toMatchObject({ ok: false });
    expect(calculateDose({ weightKg: 10, doseValue: 5, doseUnit: 'mg/kg', dispensingUnit: 'tablet', increment: 1 })).toMatchObject({ ok: false });
  });

  it('rounds down/up when requested', () => {
    const base = { weightKg: 10, doseValue: 3.6, doseUnit: 'mg/kg', strengthValue: 10, strengthUnit: 'mg', dispensingUnit: 'mL', increment: 0.5 };
    expect((calculateDose({ ...base, rounding: 'down' }) as any).amount).toBe(3.5);
    expect((calculateDose({ ...base, rounding: 'up' }) as any).amount).toBe(4);
  });

  it('compares delivered dose against a reference range across mass units', () => {
    expect(compareToRange(5.04, 'mg/kg', 2, 5, 'mg/kg')).toBe('ABOVE');
    expect(compareToRange(250, 'mcg/kg', 0.2, 0.3, 'mg/kg')).toBe('WITHIN');
    expect(compareToRange(1, 'IU/kg', 1, 2, 'mg/kg')).toBe('INCOMPATIBLE');
  });

  it('computes course quantities rounded up', () => {
    expect(courseQuantity(1.25, 2, 7, 0.25)).toBe(17.5);
    expect(courseQuantity(0.3, 3, 5, 1)).toBe(5);
  });
});

describe('owner label text', () => {
  it('writes the label in plain words without Latin abbreviations', () => {
    expect(ownerInstructions({ amount: 1, unit: 'tablet', route: 'PO', frequencyCode: 'BID', durationDays: 7 })).toBe('Give 1 tablet by mouth 2 times a day for 7 days.');
    expect(ownerInstructions({ amount: 1.5, unit: 'tablet', route: 'PO', frequencyCode: 'SID', durationDays: 1 })).toBe('Give 1½ tablets by mouth once a day for 1 day.');
    expect(ownerInstructions({ amount: 2.5, unit: 'mL', route: 'SC', frequencyCode: 'ONCE', durationDays: 3 })).toBe('Give 2.5 mL under the skin once only.');
    expect(ownerAmount(0.5, 'tablet')).toBe('½ tablet');
    for (const f of FREQUENCIES) expect(ownerInstructions({ route: 'PO', frequencyCode: f.code })).not.toMatch(/\b(SID|BID|TID|QID|EOD|PRN|PO)\b/);
  });

  it('cleans older label text', () => {
    expect(ownerLabelText('Give SC twice daily (BID) for 7 days.')).toBe('Give under the skin 2 times a day for 7 days.');
    expect(ownerLabelText('Give by mouth Twice daily (bid)')).toBe('Give by mouth 2 times a day');
  });

  it('resolves frequencies from codes and stored labels', () => {
    expect(findFrequency('BID')?.perDay).toBe(2);
    expect(findFrequency('Twice daily (BID)')?.code).toBe('BID');
    expect(findFrequency('2 times a day (BID)')?.code).toBe('BID');
    expect(findFrequency('Once weekly')?.code).toBe('WEEKLY');
  });
});
