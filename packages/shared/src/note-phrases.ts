/** The consultation note fields (as used by past records). */
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
