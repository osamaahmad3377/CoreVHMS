import { DEFAULT_NOTE_PHRASES, NOTE_PHRASE_FIELDS, addPhrase, hasPhrase, notePhraseSchema, phraseText, removePhrase, togglePhrase } from './note-phrases';

describe('note phrase text', () => {
  it('uses the label when no text is set', () => {
    expect(phraseText({ label: 'Vomiting' })).toBe('Vomiting');
    expect(phraseText({ label: 'Quiet', text: 'Quieter than usual.' })).toBe('Quieter than usual.');
    expect(phraseText({ label: 'X', text: '   ' })).toBe('X');
  });

  it('adds phrases as a list or as sentences', () => {
    expect(addPhrase('', 'Vomiting')).toBe('Vomiting');
    expect(addPhrase('Vomiting', 'Diarrhoea')).toBe('Vomiting, Diarrhoea');
    expect(addPhrase('Not eating.', 'Vomited once.')).toBe('Not eating. Vomited once.');
    expect(addPhrase('Line one\n', 'Line two')).toBe('Line one\nLine two');
  });

  it('removes phrases and tidies what is left', () => {
    expect(removePhrase('A, B, C', 'B')).toBe('A, C');
    expect(removePhrase('A, B', 'A')).toBe('B');
    expect(removePhrase('A, B', 'B')).toBe('A');
    expect(removePhrase('Not eating. Vomited once.', 'Not eating.')).toBe('Vomited once.');
    expect(removePhrase('Typed by hand, Vomiting', 'Vomiting')).toBe('Typed by hand');
    expect(removePhrase('nothing here', 'missing')).toBe('nothing here');
  });

  it('toggles, and a grouped answer replaces the other answers of its group', () => {
    const eating = [{ label: 'Eating normally', text: 'Eating normally.' }, { label: 'Eating less', text: 'Eating less than usual.' }, { label: 'Not eating', text: 'Not eating.' }];
    const pick = (cur: string, i: number) => togglePhrase(cur, { ...eating[i], groupName: 'Eating' }, eating);
    let note = 'Quiet since morning.';
    note = pick(note, 2);
    expect(note).toBe('Quiet since morning. Not eating.');
    expect(hasPhrase(note, 'Not eating.')).toBe(true);
    note = pick(note, 1);
    expect(note).toBe('Quiet since morning. Eating less than usual.');
    note = pick(note, 1);
    expect(note).toBe('Quiet since morning.');
    // Ungrouped buttons combine.
    expect(togglePhrase('Vomiting', { label: 'Diarrhoea' }, [])).toBe('Vomiting, Diarrhoea');
  });
});

describe('note phrase settings', () => {
  it('has a starter set for every field, with no duplicate buttons and nothing that looks like a dose', () => {
    for (const f of NOTE_PHRASE_FIELDS) {
      const keys = DEFAULT_NOTE_PHRASES[f].map((p) => `${p.group ?? ''}|${p.label}`);
      expect(keys.length).toBeGreaterThan(5);
      expect(new Set(keys).size).toBe(keys.length);
      for (const p of DEFAULT_NOTE_PHRASES[f]) expect(`${p.label} ${p.text ?? ''}`).not.toMatch(/\b\d+(\.\d+)?\s?(mg|ml|mcg|iu)\b/i);
    }
  });

  it('validates a new phrase', () => {
    expect(notePhraseSchema.safeParse({ field: 'plan', label: ' Rest ' }).data).toMatchObject({ label: 'Rest', groupName: null, text: null });
    expect(notePhraseSchema.safeParse({ field: 'plan', label: '' }).success).toBe(false);
    expect(notePhraseSchema.safeParse({ field: 'nope', label: 'x' }).success).toBe(false);
  });
});
