import { createClientSchema, createPatientSchema, updateClientSchema, weightSchema } from './index';

const uuid = '3f0e7a52-58a4-4b8e-9d0c-1f2a3b4c5d6e';

describe('form-friendly schemas', () => {
  it('turns empty selects and inputs into null instead of failing', () => {
    const r = createPatientSchema.parse({
      ownerId: uuid,
      name: 'Bruno',
      speciesId: uuid,
      breedId: '',
      primaryBranchId: '',
      initialWeightKg: '',
      dateOfBirth: '',
      colour: '',
    });
    expect(r.breedId).toBeNull();
    expect(r.primaryBranchId).toBeNull();
    expect(r.initialWeightKg).toBeNull();
    expect(r.dateOfBirth).toBeNull();
    expect(r.colour).toBeNull();
  });

  it('keeps undefined (PATCH: leave unchanged) distinct from null (clear)', () => {
    const r = updateClientSchema.parse({ email: '' });
    expect(r.email).toBeNull();
    expect('notes' in r ? r.notes : undefined).toBeUndefined();
  });

  it('requires one name for individuals (surname optional) and a contact method', () => {
    expect(createClientSchema.safeParse({ type: 'INDIVIDUAL', mobilePhone: '0300 1234567' }).success).toBe(false);
    expect(createClientSchema.safeParse({ type: 'INDIVIDUAL', firstName: 'Bilal', mobilePhone: '0300 1234567' }).success).toBe(true);
    expect(createClientSchema.safeParse({ type: 'INDIVIDUAL', lastName: 'Ali' }).success).toBe(false);
    expect(createClientSchema.safeParse({ type: 'FARM', organizationName: 'Green Farm', mobilePhone: '0300 1234567' }).success).toBe(true);
    const bad = createClientSchema.safeParse({ type: 'INDIVIDUAL', firstName: 'Bilal', mobilePhone: '0300-abc', email: 'bilal@' });
    expect(bad.success).toBe(false);
    const messages = bad.success ? [] : bad.error.issues.map((i) => i.message);
    expect(messages).toContain('Enter a mobile number like 0300 1234567');
    expect(messages).toContain('Email looks incomplete — e.g. name@gmail.com');
  });

  it('rejects invalid weights and body condition scores', () => {
    expect(weightSchema.safeParse({ weightKg: 0 }).success).toBe(false);
    expect(weightSchema.safeParse({ weightKg: 5, bodyConditionScore: 12 }).success).toBe(false);
    expect(weightSchema.parse({ weightKg: '4.25', bodyConditionScore: '' }).bodyConditionScore).toBeNull();
  });
});
