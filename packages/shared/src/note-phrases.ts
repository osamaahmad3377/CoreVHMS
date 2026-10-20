import { z } from 'zod';

/** The note fields that offer quick picks. */
export const NOTE_PHRASE_FIELDS = ['presentingComplaint', 'history', 'subjective', 'objective', 'assessment', 'plan', 'followUpInstructions'] as const;
export type NotePhraseField = (typeof NOTE_PHRASE_FIELDS)[number];

export const NOTE_PHRASE_FIELD_LABELS: Record<NotePhraseField, string> = {
  presentingComplaint: 'Presenting complaint',
  history: 'Past history',
  subjective: 'History — what the client tells you',
  objective: 'Examination findings',
  assessment: 'Assessment',
  plan: 'Plan',
  followUpInstructions: 'Instructions for the client',
};

export const notePhraseSchema = z.object({
  field: z.enum(NOTE_PHRASE_FIELDS),
  /**
   * Phrases that share a group are choices of one question ("Appetite": eating normally / eating less / not
   * eating); picking one replaces the others. Phrases without a group can be combined freely.
   */
  groupName: z.string().trim().max(40).nullish().transform((v) => v || null),
  /** What the button says. */
  label: z.string().trim().min(1, 'Enter the button text').max(60),
  /** What is added to the note; the button text when left empty. */
  text: z.string().trim().max(300).nullish().transform((v) => v || null),
  sortOrder: z.number().int().min(0).max(100000).optional(),
  isActive: z.boolean().optional(),
});
export type NotePhraseInput = z.infer<typeof notePhraseSchema>;
export const notePhraseUpdateSchema = notePhraseSchema.partial();

interface Seed {
  group?: string;
  label: string;
  text?: string;
}

/**
 * A starting set of everyday observations for a new clinic's quick picks. They contain no doses or treatment
 * schedules; each clinic can change, add and remove them in Settings → Quick note phrases.
 */
export const DEFAULT_NOTE_PHRASES: Record<NotePhraseField, Seed[]> = {
  presentingComplaint: [
    'Vomiting', 'Diarrhoea', 'Not eating', 'Itching / scratching', 'Limping', 'Cough', 'Sneezing / runny nose', 'Lethargy (very quiet)', 'Fever', 'Wound / injury', 'Lump / swelling', 'Eye problem',
    'Ear problem', 'Skin problem', 'Difficulty passing urine', 'Bleeding', 'Hit by a vehicle', 'Routine check-up', 'Vaccination', 'Pregnancy check',
  ].map((label) => ({ label })),
  history: [
    { label: 'Vaccinations up to date', text: 'Vaccinations up to date.' }, { label: 'Not vaccinated', text: 'Not vaccinated.' }, { label: 'Dewormed recently', text: 'Dewormed recently.' },
    { label: 'Similar problem before', text: 'Has had a similar problem before.' }, { label: 'On long-term medicine', text: 'On long-term medicine.' }, { label: 'Had surgery before', text: 'Has had surgery before.' },
    { label: 'Known allergy', text: 'Has a known allergy.' }, { label: 'Neutered / spayed', text: 'Neutered / spayed.' }, { label: 'No previous illness', text: 'No previous illness.' },
  ],
  subjective: [
    { group: 'Since when', label: 'Since today', text: 'Since today.' }, { group: 'Since when', label: '2 days', text: 'For 2 days.' }, { group: 'Since when', label: '3 days', text: 'For 3 days.' },
    { group: 'Since when', label: 'A week', text: 'For about a week.' }, { group: 'Since when', label: '2 weeks', text: 'For about 2 weeks.' }, { group: 'Since when', label: 'A month or more', text: 'For a month or more.' },
    { group: 'Eating', label: 'Eating normally', text: 'Eating normally.' }, { group: 'Eating', label: 'Eating less', text: 'Eating less than usual.' }, { group: 'Eating', label: 'Not eating', text: 'Not eating.' },
    { group: 'Drinking', label: 'Drinking normally', text: 'Drinking normally.' }, { group: 'Drinking', label: 'Drinking more', text: 'Drinking more than usual.' }, { group: 'Drinking', label: 'Not drinking', text: 'Not drinking.' },
    { group: 'Energy', label: 'Normal', text: 'Energy normal.' }, { group: 'Energy', label: 'Quiet', text: 'Quieter than usual.' }, { group: 'Energy', label: 'Very weak', text: 'Very weak.' },
    { group: 'Vomiting', label: 'None', text: 'No vomiting.' }, { group: 'Vomiting', label: 'Once', text: 'Vomited once.' }, { group: 'Vomiting', label: 'Repeatedly', text: 'Vomiting repeatedly.' },
    { group: 'Stools', label: 'Normal', text: 'Stools normal.' }, { group: 'Stools', label: 'Loose', text: 'Loose stools.' }, { group: 'Stools', label: 'Watery', text: 'Watery stools.' }, { group: 'Stools', label: 'Blood in stool', text: 'Blood in the stool.' },
    { group: 'Urine', label: 'Normal', text: 'Passing urine normally.' }, { group: 'Urine', label: 'Straining', text: 'Straining to pass urine.' }, { group: 'Urine', label: 'More often', text: 'Passing urine more often.' }, { group: 'Urine', label: 'Blood in urine', text: 'Blood in the urine.' },
    { label: 'Eats home food', text: 'Eats home-cooked food.' }, { label: 'Scavenges / ate rubbish', text: 'May have eaten rubbish.' }, { label: 'Lives outdoors', text: 'Lives outdoors.' },
    { label: 'Other pets at home', text: 'Other pets at home.' }, { label: 'Other pets also sick', text: 'Other pets at home are also unwell.' }, { label: 'Itching', text: 'Itching a lot.' }, { label: 'Coughing', text: 'Coughing.' }, { label: 'Limping', text: 'Limping.' },
  ],
  objective: [
    { group: 'Behaviour', label: 'Bright and alert', text: 'Bright and alert.' }, { group: 'Behaviour', label: 'Dull', text: 'Dull and depressed.' }, { group: 'Behaviour', label: 'Collapsed', text: 'Collapsed / unresponsive.' },
    { group: 'Hydration', label: 'Well hydrated', text: 'Well hydrated.' }, { group: 'Hydration', label: 'Mild dehydration', text: 'Mild dehydration.' }, { group: 'Hydration', label: 'Moderate dehydration', text: 'Moderate dehydration.' }, { group: 'Hydration', label: 'Severe dehydration', text: 'Severe dehydration.' },
    { group: 'Gums', label: 'Pink', text: 'Gums pink.' }, { group: 'Gums', label: 'Pale', text: 'Gums pale.' }, { group: 'Gums', label: 'Yellow', text: 'Gums yellow.' }, { group: 'Gums', label: 'Red', text: 'Gums red.' },
    { group: 'Heart', label: 'Normal', text: 'Heart sounds normal.' }, { group: 'Heart', label: 'Murmur', text: 'Heart murmur heard.' },
    { group: 'Lungs', label: 'Normal', text: 'Lung sounds normal.' }, { group: 'Lungs', label: 'Wheeze / crackles', text: 'Abnormal lung sounds.' },
    { group: 'Abdomen', label: 'Soft', text: 'Abdomen soft, not painful.' }, { group: 'Abdomen', label: 'Painful', text: 'Abdomen painful.' }, { group: 'Abdomen', label: 'Bloated', text: 'Abdomen bloated.' },
    { label: 'Swollen lymph nodes', text: 'Lymph nodes enlarged.' }, { label: 'Skin redness', text: 'Skin red and irritated.' }, { label: 'Hair loss', text: 'Patchy hair loss.' }, { label: 'Fleas / ticks', text: 'Fleas / ticks seen.' },
    { label: 'Ear discharge', text: 'Discharge in the ear.' }, { label: 'Eye discharge', text: 'Discharge from the eye.' }, { label: 'Dental tartar', text: 'Dental tartar present.' }, { label: 'Wound', text: 'Wound present.' }, { label: 'Lump', text: 'Lump found.' }, { label: 'Lame on exam', text: 'Lameness seen on examination.' },
  ],
  assessment: [
    'Gastroenteritis', 'Dietary indiscretion', 'Parvovirus suspected', 'Skin allergy', 'Skin infection', 'Ear infection (otitis)', 'Respiratory infection', 'Urinary tract problem', 'Wound / injury',
    'Fracture suspected', 'Dental disease', 'Parasites (worms / fleas / ticks)', 'Tick fever suspected', 'Eye problem', 'Heat stress', 'Healthy — routine check', 'Waiting for test results',
  ].map((label) => ({ label })),
  plan: [
    'Blood test', 'Urine test', 'Stool test', 'X-ray', 'Ultrasound', 'Drip (fluids)', 'Injection given', 'Medicine prescribed', 'Wound cleaned and dressed', 'Special / bland diet', 'Rest',
    'Admit to hospital', 'Surgery planned', 'Vaccination given', 'Deworming given', 'Referral', 'Recheck in 3 days', 'Recheck in 1 week', 'Recheck in 2 weeks',
  ].map((label) => ({ label })),
  followUpInstructions: [
    { label: 'Medicine with food', text: 'Give the medicine with food.' }, { label: 'Finish the course', text: 'Finish the whole course of medicine.' }, { label: 'Small light meals', text: 'Feed small, light meals.' },
    { label: 'Plenty of water', text: 'Give plenty of fresh water.' }, { label: 'Rest', text: 'Keep resting for a few days.' }, { label: 'Keep wound clean', text: 'Keep the wound clean and dry.' }, { label: 'Keep away from other animals', text: 'Keep away from other animals until better.' },
    { label: 'Come back if not eating', text: 'Come back if not eating.' }, { label: 'Come back if vomiting continues', text: 'Come back if the vomiting continues.' }, { label: 'Come back if worse', text: 'Come back at once if it gets worse.' }, { label: 'Bring for recheck', text: 'Bring for a recheck as booked.' },
  ],
};

/** What a button adds to the note. */
export const phraseText = (p: { label: string; text?: string | null }) => (p.text?.trim() ? p.text.trim() : p.label);

/** True when the note already contains the phrase (the button then shows as selected). */
export const hasPhrase = (current: string, text: string) => !!text && current.includes(text);

/** Adds a phrase at the end: after a full stop it continues the sentence run, otherwise it is added to the list with a comma. */
export function addPhrase(current: string, text: string): string {
  const base = current.trimEnd();
  if (!base) return text;
  if (current.endsWith('\n')) return `${current}${text}`;
  return `${base}${/[.!?:;]$/.test(base) ? ' ' : ', '}${text}`;
}

/** Takes a phrase out again and tidies the commas and spaces it leaves behind. */
export function removePhrase(current: string, text: string): string {
  const i = current.indexOf(text);
  if (!text || i < 0) return current;
  return (current.slice(0, i) + current.slice(i + text.length))
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/,\s*,/g, ',')
    .replace(/^[\s,;]+/, '')
    .replace(/[\s,;]+$/, '')
    .replace(/ +\n/g, '\n');
}

/**
 * Taps a button: adds the phrase, or removes it if already there. For a button in a group (a one-answer
 * question like "Eating"), the other answers of that group are removed first.
 */
export function togglePhrase(current: string, phrase: { label: string; text?: string | null; groupName?: string | null }, siblings: { label: string; text?: string | null }[]): string {
  const text = phraseText(phrase);
  if (hasPhrase(current, text)) return removePhrase(current, text);
  let next = current;
  if (phrase.groupName) for (const s of siblings) if (phraseText(s) !== text) next = removePhrase(next, phraseText(s));
  return addPhrase(next, text);
}
