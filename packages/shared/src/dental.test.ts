import { DENTAL_PROCEDURES, dentitionForSpecies, teethFor, toothInfo, worstStage } from './dental';
import { addMonthsIso, dayBeforeIso, wellnessPlanSchema, wellnessSchedule } from './schemas/wellness';

describe('dental chart reference', () => {
  it('has the right number of teeth for each dentition', () => {
    expect(teethFor('CANINE')).toHaveLength(42);
    expect(teethFor('CANINE', true)).toHaveLength(28);
    expect(teethFor('FELINE')).toHaveLength(30);
    expect(teethFor('FELINE', true)).toHaveLength(26);
    expect(teethFor('EQUINE')).toHaveLength(44);
    expect(teethFor('EQUINE', true)).toHaveLength(24);
  });

  it('names teeth by Triadan number', () => {
    expect(toothInfo('CANINE', '108')).toMatchObject({ type: 'premolar', upper: true, right: true, short: 'P4', name: 'Upper right fourth premolar (108)' });
    expect(toothInfo('CANINE', '309')).toMatchObject({ type: 'molar', upper: false, right: false, short: 'M1' });
    expect(toothInfo('CANINE', '204')).toMatchObject({ type: 'canine', short: 'C' });
    expect(toothInfo('CANINE', '604')).toMatchObject({ deciduous: true, short: 'c', name: 'Upper left baby canine (604)' });
    // Cats have no upper first premolar and no lower first or second premolars.
    expect(toothInfo('FELINE', '105')).toBeNull();
    expect(toothInfo('FELINE', '306')).toBeNull();
    expect(toothInfo('FELINE', '309')).not.toBeNull();
    expect(toothInfo('EQUINE', '105')?.name).toContain('wolf tooth');
    expect(toothInfo('CANINE', '111')).toBeNull();
  });

  it('suggests a dentition from the species', () => {
    expect(dentitionForSpecies('Dog')).toBe('CANINE');
    expect(dentitionForSpecies('Cat')).toBe('FELINE');
    expect(dentitionForSpecies('Donkey')).toBe('EQUINE');
    expect(dentitionForSpecies('Mare', 'EQUINE')).toBe('EQUINE');
    expect(dentitionForSpecies('Parrot')).toBeNull();
  });

  it('knows which procedures remove a tooth', () => {
    expect(DENTAL_PROCEDURES.filter((p) => p.removesTooth).map((p) => p.code)).toEqual(['X', 'XS', 'WOLF']);
    expect(worstStage([{ pdStage: 1 }, { pdStage: null }, { pdStage: 3 }])).toBe(3);
    expect(worstStage([])).toBeNull();
  });
});

describe('wellness plan schedule', () => {
  it('adds months, clamping to the end of the month', () => {
    expect(addMonthsIso('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsIso('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonthsIso('2026-11-15', 2)).toBe('2027-01-15');
    expect(addMonthsIso('2026-03-01', 12)).toBe('2027-03-01');
    expect(dayBeforeIso('2027-03-01')).toBe('2027-02-28');
  });

  it('bills up front once, or monthly with the joining fee on the first payment', () => {
    const base = { startDate: '2026-01-31', months: 12, priceMinor: 1_200_000, monthlyPriceMinor: 110_000, joiningFeeMinor: 50_000 };
    expect(wellnessSchedule({ ...base, billing: 'UPFRONT' })).toEqual([{ seq: 1, dueDate: '2026-01-31', amountMinor: 1_250_000 }]);
    const monthly = wellnessSchedule({ ...base, billing: 'MONTHLY' });
    expect(monthly).toHaveLength(12);
    expect(monthly[0]).toEqual({ seq: 1, dueDate: '2026-01-31', amountMinor: 160_000 });
    expect(monthly[1]).toEqual({ seq: 2, dueDate: '2026-02-28', amountMinor: 110_000 });
    expect(monthly[11].dueDate).toBe('2026-12-31');
  });

  it('needs something included and no duplicate items', () => {
    expect(wellnessPlanSchema.safeParse({ name: 'Empty', priceMinor: 100 }).success).toBe(false);
    expect(wellnessPlanSchema.safeParse({ name: 'Discount only', priceMinor: 100, serviceDiscountBp: 1000 }).success).toBe(true);
    const id = '00000000-0000-4000-8000-000000000001';
    const twice = wellnessPlanSchema.safeParse({ name: 'Twice', priceMinor: 100, items: [{ kind: 'SERVICE', serviceId: id, quantity: 1 }, { kind: 'SERVICE', serviceId: id, quantity: 2 }] });
    expect(twice.success).toBe(false);
  });
});
