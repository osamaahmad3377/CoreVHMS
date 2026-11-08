/**
 * How a dental visit runs, step by step: the wording of each step, the pre-anaesthetic and oral examination, the
 * anaesthetic risk grade, the usual dental diagnoses (AVDC terms) and after-care advice. Words and lists only —
 * nothing clinical is decided here: no doses or schedules.
 */
import { DENTAL_STARTER_TEMPLATES, STARTER_TEMPLATE_QUESTIONS, type Dentition } from '@vcms/shared';

/** The starter dental templates' short diagnosis lists, replaced in a dental visit by the professional list below. */
export const STARTER_DENTAL_DX = new Set([...DENTAL_STARTER_TEMPLATES, ...STARTER_TEMPLATE_QUESTIONS.filter((t) => t.kind === 'DENTAL')].flatMap((t) => t.diagnoses ?? []));

/** The examination of a dental visit: the mouth awake first, then the pre-anaesthetic check. */
export const DENTAL_EXAM_SYSTEMS = ['Oral cavity & teeth', 'Gums', 'Breath', 'Face & jaw', 'Mandibular lymph nodes', 'Cardiovascular', 'Respiratory', 'General appearance'];

/** Anaesthetic risk (ASA physical status), recorded before a dental under anaesthetic. */
export const ASA_GRADES = [
  { value: 'I', label: 'ASA I', hint: 'Healthy' },
  { value: 'II', label: 'ASA II', hint: 'Mild disease' },
  { value: 'III', label: 'ASA III', hint: 'Severe disease' },
  { value: 'IV', label: 'ASA IV', hint: 'Life-threatening disease' },
  { value: 'V', label: 'ASA V', hint: 'Not expected to survive without the procedure' },
] as const;

export const asaText = (v: string | undefined) => {
  const g = ASA_GRADES.find((x) => x.value === v);
  return g ? `Anaesthetic risk: ${g.label} (${g.hint.toLowerCase()}).` : '';
};

/** The usual dental diagnoses to tap (after those the dental chart suggests). */
export function dentalDiagnosisList(dentition: Dentition | null | undefined): string[] {
  if (dentition === 'EQUINE') {
    return ['Sharp enamel points', 'Hooks / ramps', 'Wave mouth', 'Step mouth', 'Wolf teeth', 'Retained deciduous caps', 'Diastema with food packing', 'Fractured cheek tooth', 'Periapical infection (tooth root abscess)', 'Periodontal disease', 'EOTRH'];
  }
  return [
    'Periodontal disease — stage 1 (gingivitis)',
    'Periodontal disease — stage 2',
    'Periodontal disease — stage 3',
    'Periodontal disease — stage 4',
    'Uncomplicated crown fracture',
    'Complicated crown fracture (pulp exposed)',
    'Tooth resorption',
    'Tooth root abscess (periapical disease)',
    'Persistent deciduous teeth',
    'Malocclusion',
    'Dental caries',
    'Enamel hypoplasia',
    ...(dentition === 'FELINE' ? ['Feline chronic gingivostomatitis'] : ['Stomatitis']),
    'Oronasal fistula',
    'Oral mass',
    'Dentigerous cyst',
  ];
}

/** After-care and home-care advice after a dental (to tap in Owner advice). */
export const DENTAL_ADVICE = [
  'Offer soft food for the next few days, then go back to the usual food slowly',
  'No bones, antlers or hard chews until the recheck',
  'Give the pain relief exactly as prescribed',
  'He/she may be sleepy tonight after the anaesthetic — keep him/her warm and quiet',
  'Start brushing the teeth daily with a pet toothpaste once the mouth has healed',
  'Come back if there is bleeding, swelling of the face, or he/she stops eating',
];

/** The wording of each step in a dental visit (other steps keep theirs). */
export const DENTAL_STEP_TEXT: Partial<Record<string, { title?: (n: string) => string; hint: string }>> = {
  history: { hint: 'Ask about the mouth, eating and any previous anaesthetic. Tap the answers; the history is written for you.' },
  measure: { title: (n) => `Measure ${n} before the anaesthetic`, hint: 'Weigh for the anaesthetic doses, and record temperature, heart rate and breathing rate.' },
  exam: { title: (n) => `Examine ${n}: mouth and pre-anaesthetic check`, hint: 'The mouth while awake — breath, gums, face and jaw — then heart, lungs and general health. Grade the anaesthetic risk.' },
  tests: { hint: 'Pre-anaesthetic blood tests, and dental X-rays (also ordered from a tooth on the chart). Skip if none are needed.' },
  dx: { hint: 'The dental chart’s findings are suggested first. Tap to add, then tap the label to say how sure you are.' },
  treat: { hint: 'Tap the dental services done; add pain relief and any other medicines.' },
  advice: { hint: 'Home care, soft food and the dental recheck.' },
};
