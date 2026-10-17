import { allergyConflicts, allergyMatches } from './allergy';

// Matching logic only. The drug family here is test data typed onto the product, as a clinic would.
const amoxicillin = { name: 'Amoxicillin 250 mg tablets', genericName: 'Amoxicillin', activeIngredients: ['amoxicillin'], drugClass: 'Penicillins' };
const allergy = (substance: string | null, title = 'Allergy') => ({ type: 'ALLERGY', title, substance });

describe('allergy matching', () => {
  it('matches the substance against the product name and ingredients, ignoring case', () => {
    expect(allergyMatches([allergy('AMOXICILLIN')], amoxicillin)).toHaveLength(1);
    expect(allergyConflicts([allergy('amoxicillin')], { ...amoxicillin, drugClass: null })[0].via).toBe('name');
  });

  it('matches a drug family, with or without the plural', () => {
    for (const s of ['Penicillin', 'penicillins', 'PENICILLINS']) {
      const [c] = allergyConflicts([allergy(s)], amoxicillin);
      expect(c).toMatchObject({ via: 'class', term: 'Penicillins' });
    }
    expect(allergyMatches([allergy(null, 'Penicillin allergy')], amoxicillin)).toHaveLength(1);
    expect(allergyMatches([allergy('NSAID')], { name: 'Meloxicam oral suspension', drugClass: 'NSAIDs' })).toHaveLength(1);
  });

  it('accepts several families separated by commas', () => {
    expect(allergyMatches([allergy('beta-lactam')], { ...amoxicillin, drugClass: 'Penicillins, Beta-lactams' })).toHaveLength(1);
  });

  it('does not match unrelated medicines or non-allergy alerts', () => {
    expect(allergyMatches([allergy('Penicillin')], { name: 'Meloxicam oral suspension', activeIngredients: ['meloxicam'], drugClass: 'NSAIDs' })).toEqual([]);
    expect(allergyMatches([{ type: 'BEHAVIOUR', title: 'Penicillin', substance: 'Penicillin' }], amoxicillin)).toEqual([]);
    // Without a family on the product, a family allergy cannot be recognised: the data has to be set up.
    expect(allergyMatches([allergy('Penicillin')], { ...amoxicillin, drugClass: null })).toEqual([]);
  });
});
