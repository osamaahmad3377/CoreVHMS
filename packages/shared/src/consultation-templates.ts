import { z } from 'zod';

/**
 * Consultation template questions: each consultation template (Settings → Consultation templates) can carry the
 * questions a vet asks the owner, the answers to tap and what each answer writes in the note, plus usual diagnoses
 * and advice to offer. The guided consultation starts by choosing a template.
 *
 * The starter questions below are added once per clinic. They save typing — they are not clinical guidance: no
 * doses, schedules or decisions. Vaccinations and parasite control have their own module (preventive care).
 */

/** Icons a template can show (drawn by the web app). */
export const TEMPLATE_ICONS = ['stethoscope', 'soup', 'paw', 'ear', 'eye', 'bone', 'battery', 'wind', 'bandage', 'droplets', 'recheck', 'pen', 'heart', 'brain', 'thermometer', 'tooth', 'baby', 'scissors', 'cow', 'file'] as const;
export type TemplateIcon = (typeof TEMPLATE_ICONS)[number];

const text = (max: number) => z.string().trim().max(max);
const required = (max: number, message: string) => z.string().trim().min(1, message).max(max);

export const templateAnswerSchema = z.object({
  /** What the button says. */
  label: required(60, 'Enter the answer'),
  /** What it writes in the note; nothing when empty. */
  text: text(300).default(''),
});

export const templateQuestionSchema = z.object({
  ask: required(120, 'Enter the question'),
  /** Several answers can be chosen (which legs, which signs). */
  multi: z.boolean().default(false),
  answers: z.array(templateAnswerSchema).min(1, 'Add at least one answer').max(12),
});

export interface TemplateQuestionRow {
  id: string;
  ask: string;
  multi: boolean;
  sortOrder: number;
  answers: { id: string; label: string; text: string; sortOrder: number }[];
}

export interface StarterTemplate {
  name: string;
  /** Existing template names these questions belong to (e.g. the demo "Lameness" template). */
  aliases?: string[];
  icon: TemplateIcon;
  presentingComplaint: string;
  /** The examination buttons of the template, in order (any names; standard ones suggested). */
  examSystems?: string[];
  questions: z.input<typeof templateQuestionSchema>[];
  diagnoses?: string[];
  advice: string[];
}

type Q = z.input<typeof templateQuestionSchema>;
const q = (ask: string, answers: [string, string][], multi = false): Q => ({ ask, multi, answers: answers.map(([label, t]) => ({ label, text: t })) });

const SINCE = q('Since when?', [
  ['Today', 'Started today'],
  ['2–3 days', 'Started 2–3 days ago'],
  ['About a week', 'Going on for about a week'],
  ['Longer', 'Going on for more than a week'],
]);
const EATING = q('Eating?', [
  ['Normal', 'Eating normally'],
  ['Less', 'Eating less than usual'],
  ['Not eating', 'Not eating'],
  ['More', 'Eating more than usual'],
]);
const DRINKING = q('Drinking?', [
  ['Normal', 'Drinking normally'],
  ['More', 'Drinking more than usual'],
  ['Less', 'Drinking less than usual'],
]);
const ENERGY = q('Energy?', [
  ['Normal', 'Normal energy'],
  ['Quieter', 'Quieter than usual'],
  ['Very weak', 'Very weak / lethargic'],
]);
const SIDE = q('Which side?', [
  ['Left', 'Left side'],
  ['Right', 'Right side'],
  ['Both', 'Both sides'],
]);

/**
 * The examination buttons used when a template lists none — the same standard body systems as the classic note.
 * A template's own list replaces them: the clinic adds, removes and orders buttons per template.
 */
export const STANDARD_EXAM_SYSTEMS = ['General appearance', 'Eyes', 'Ears', 'Oral cavity & teeth', 'Lymph nodes', 'Cardiovascular', 'Respiratory', 'Abdomen', 'Musculoskeletal', 'Neurological', 'Skin & coat'];

const STARTERS: StarterTemplate[] = [
  {
    name: 'Vomiting / diarrhoea',
    icon: 'soup',
    presentingComplaint: 'Vomiting / diarrhoea',
    questions: [
      SINCE,
      q('Vomiting?', [
        ['None', 'No vomiting'],
        ['Once', 'Vomited once'],
        ['A few times', 'Vomiting a few times a day'],
        ['Many times', 'Vomiting many times a day'],
      ]),
      q('Diarrhoea?', [
        ['No', 'No diarrhoea'],
        ['Yes', 'Has diarrhoea'],
        ['With blood', 'Diarrhoea with blood'],
      ]),
      EATING,
      DRINKING,
      ENERGY,
      q('Ate something unusual?', [
        ['No', 'Not known to have eaten anything unusual'],
        ['Maybe', 'May have eaten something unusual'],
        ['Yes', 'Ate something unusual'],
      ]),
    ],
    examSystems: ['Abdomen', 'General appearance', 'Oral cavity & teeth'],
    diagnoses: ['Gastroenteritis', 'Dietary indiscretion', 'Gastritis', 'Intestinal parasites', 'Foreign body (suspected)', 'Pancreatitis (suspected)'],
    advice: ['Give small, bland meals for the next few days', 'Keep fresh water available at all times', 'Come back at once if vomiting continues, there is blood, or the animal becomes weak'],
  },
  {
    name: 'Skin / itching',
    icon: 'paw',
    presentingComplaint: 'Skin problem / itching',
    questions: [
      SINCE,
      q('How itchy?', [
        ['Mild', 'Mildly itchy'],
        ['Moderate', 'Moderately itchy'],
        ['Severe', 'Severely itchy, keeps the owner awake'],
      ]),
      q(
        'Where?',
        [
          ['Ears', 'ears'],
          ['Paws', 'paws'],
          ['Belly', 'belly'],
          ['Back / tail', 'back and tail'],
          ['All over', 'all over'],
        ],
        true,
      ),
      q('Flea control?', [
        ['Up to date', 'Flea control up to date'],
        ['Overdue', 'Flea control overdue'],
        ['None used', 'No flea control used'],
      ]),
      q('Other pets or people itchy?', [
        ['No', 'No other pets or people itchy'],
        ['Yes', 'Other pets or people at home are itchy'],
      ]),
      q('Recent change of food?', [
        ['No', 'No recent change of food'],
        ['Yes', 'Food changed recently'],
      ]),
    ],
    examSystems: ['Skin & coat', 'Ears'],
    diagnoses: ['Flea allergy dermatitis', 'Atopic dermatitis', 'Bacterial skin infection (pyoderma)', 'Fungal skin infection', 'Mange (mites)', 'Hot spot'],
    advice: ['Treat all pets at home for fleas', 'Wash the bedding in hot water', 'Stop licking and scratching — use a cone if needed'],
  },
  {
    name: 'Ear problem',
    icon: 'ear',
    presentingComplaint: 'Ear problem',
    questions: [
      SINCE,
      SIDE,
      q(
        'What do you notice?',
        [
          ['Scratching', 'scratching the ear'],
          ['Head shaking', 'head shaking'],
          ['Smell', 'bad smell'],
          ['Discharge', 'discharge'],
          ['Pain', 'pain when touched'],
        ],
        true,
      ),
      q('Had this before?', [
        ['First time', 'First time with this problem'],
        ['Before', 'Has had ear problems before'],
      ]),
    ],
    examSystems: ['Ears', 'Skin & coat'],
    diagnoses: ['Otitis externa', 'Ear mites', 'Foreign body in ear', 'Aural haematoma'],
    advice: ['Use the ear drops exactly as shown and finish the course', 'Do not put cotton buds into the ear canal', 'Come back if the ear gets more painful or swollen'],
  },
  {
    name: 'Eye problem',
    icon: 'eye',
    presentingComplaint: 'Eye problem',
    questions: [
      SINCE,
      SIDE,
      q(
        'What do you notice?',
        [
          ['Discharge', 'discharge'],
          ['Redness', 'redness'],
          ['Squinting', 'squinting'],
          ['Cloudy', 'cloudy eye'],
          ['Rubbing', 'rubbing the eye'],
        ],
        true,
      ),
    ],
    examSystems: ['Eyes'],
    diagnoses: ['Conjunctivitis', 'Corneal ulcer', 'Dry eye (KCS)', 'Foreign body in eye', 'Cherry eye'],
    advice: ['Stop rubbing — use a cone', 'Clean discharge gently with damp cotton wool', 'Come back at once if the eye becomes cloudy or more painful'],
  },
  {
    name: 'Limping / pain',
    aliases: ['Lameness'],
    icon: 'bone',
    presentingComplaint: 'Limping / pain',
    questions: [
      SINCE,
      q(
        'Which leg?',
        [
          ['Front left', 'front left leg'],
          ['Front right', 'front right leg'],
          ['Back left', 'back left leg'],
          ['Back right', 'back right leg'],
          ['Not sure', 'leg not clear'],
        ],
        true,
      ),
      q('How did it start?', [
        ['Suddenly', 'Started suddenly'],
        ['Slowly', 'Came on slowly'],
      ]),
      q('Known injury?', [
        ['No', 'No known injury'],
        ['Yes', 'Known injury'],
        ['Not sure', 'Not sure about an injury'],
      ]),
      q('Uses the leg?', [
        ['Normally', 'Uses the leg normally at rest'],
        ['A little', 'Puts some weight on the leg'],
        ['Not at all', 'Not using the leg at all'],
      ]),
    ],
    examSystems: ['Musculoskeletal', 'Neurological'],
    diagnoses: ['Soft tissue injury (sprain)', 'Cruciate ligament injury', 'Fracture (suspected)', 'Arthritis', 'Paw / nail injury'],
    advice: ['Rest: short walks on the lead only', 'No running, jumping or stairs for now', 'Come back if the limp gets worse or the leg swells'],
  },
  {
    name: 'Not eating / tired',
    icon: 'battery',
    presentingComplaint: 'Not eating / lethargic',
    questions: [
      SINCE,
      EATING,
      DRINKING,
      ENERGY,
      q('Vomiting or diarrhoea?', [
        ['No', 'No vomiting or diarrhoea'],
        ['Vomiting', 'Some vomiting'],
        ['Diarrhoea', 'Some diarrhoea'],
      ]),
      q('Losing weight?', [
        ['No', 'No weight loss noticed'],
        ['Yes', 'Owner has noticed weight loss'],
        ['Not sure', 'Owner not sure about weight loss'],
      ]),
      q('Ticks seen recently?', [
        ['No', 'No ticks seen'],
        ['Yes', 'Ticks seen recently'],
      ]),
    ],
    examSystems: ['General appearance', 'Oral cavity & teeth', 'Lymph nodes', 'Abdomen'],
    diagnoses: ['Fever of unknown cause', 'Tick-borne disease (suspected)', 'Dental disease', 'Kidney disease (suspected)', 'Gastroenteritis'],
    advice: ['Offer small amounts of soft, tasty food', 'Watch how much he/she drinks and passes urine', 'Come back if still not eating tomorrow'],
  },
  {
    name: 'Cough / breathing',
    icon: 'wind',
    presentingComplaint: 'Coughing / breathing problem',
    questions: [
      SINCE,
      q('Cough?', [
        ['None', 'No cough'],
        ['Dry', 'Dry cough'],
        ['Moist', 'Moist cough'],
        ['Gagging', 'Coughing with gagging'],
      ]),
      q('Breathing?', [
        ['Normal', 'Breathing normally at rest'],
        ['Fast', 'Breathing fast at rest'],
        ['Difficult', 'Difficulty breathing'],
      ]),
      q('Exercise?', [
        ['Normal', 'Normal exercise'],
        ['Tires quickly', 'Tires quickly on walks'],
      ]),
      q('Recently with other animals?', [
        ['No', 'No recent contact with other animals'],
        ['Yes', 'Recent contact with other animals (park, boarding, grooming)'],
      ]),
    ],
    examSystems: ['Respiratory', 'Cardiovascular', 'General appearance'],
    diagnoses: ['Kennel cough', 'Upper respiratory infection', 'Pneumonia (suspected)', 'Heart disease (suspected)', 'Feline asthma'],
    advice: ['Walk with a harness, not a collar', 'Keep away from other animals until better', 'Come back at once if breathing becomes fast or difficult'],
  },
  {
    name: 'Wound / injury',
    icon: 'bandage',
    presentingComplaint: 'Wound / injury',
    questions: [
      q('When did it happen?', [
        ['Today', 'Happened today'],
        ['Yesterday', 'Happened yesterday'],
        ['Few days ago', 'Happened a few days ago'],
      ]),
      q('How?', [
        ['Fight / bite', 'Caused by a fight or bite'],
        ['Accident', 'Caused by an accident'],
        ['Not known', 'Cause not known'],
      ]),
      q('Bleeding?', [
        ['Stopped', 'Bleeding has stopped'],
        ['Still bleeding', 'Still bleeding'],
      ]),
    ],
    examSystems: ['Skin & coat', 'Musculoskeletal', 'General appearance'],
    diagnoses: ['Bite wound', 'Laceration', 'Abscess', 'Road traffic injury'],
    advice: ['Keep the wound clean and dry', 'Stop licking — use a cone', 'Come back if there is swelling, pus or a bad smell'],
  },
  {
    name: 'Urine problem',
    icon: 'droplets',
    presentingComplaint: 'Urinary problem',
    questions: [
      SINCE,
      q(
        'What do you notice?',
        [
          ['Straining', 'straining to pass urine'],
          ['Going often', 'passing urine often'],
          ['Blood', 'blood in the urine'],
          ['Accidents', 'accidents in the house'],
          ['Not passing urine', 'NOT passing urine'],
        ],
        true,
      ),
      DRINKING,
    ],
    examSystems: ['Abdomen', 'General appearance'],
    diagnoses: ['Cystitis (bladder infection)', 'Bladder stones (suspected)', 'Urethral obstruction', 'Urinary incontinence'],
    advice: ['Keep fresh water available at all times', 'Make sure he/she passes urine — come at once if not', 'Finish the full course of medicine'],
  },
  {
    name: 'Recheck / follow-up',
    icon: 'recheck',
    presentingComplaint: 'Recheck',
    questions: [
      q('How is it since last time?', [
        ['Better', 'Better since the last visit'],
        ['Same', 'No change since the last visit'],
        ['Worse', 'Worse since the last visit'],
        ['All better', 'Fully recovered'],
      ]),
      q('Medicines given?', [
        ['As told', 'Medicines given as instructed'],
        ['Some missed', 'Some doses missed'],
        ['Stopped early', 'Owner stopped the medicines early'],
        ['None given', 'No medicines were given'],
      ]),
      q('Any side effects?', [
        ['None', 'No side effects noticed'],
        ['Vomiting', 'Vomiting since starting the medicine'],
        ['Diarrhoea', 'Diarrhoea since starting the medicine'],
        ['Other', 'Other side effects (see notes)'],
      ]),
    ],
    advice: ['Continue the treatment as before', 'The treatment can now be stopped', 'Come back if the problem returns'],
  },
  {
    name: 'General consultation',
    icon: 'stethoscope',
    presentingComplaint: '',
    questions: [SINCE, EATING, DRINKING, ENERGY],
    advice: ['Come back if things get worse'],
  },
];

/**
 * The starter questions: attached to the clinic's template of the same name (or alias), or added as a new template.
 * Each starter's examination list is its key body systems first, then the rest of the standard ones.
 */
export const STARTER_TEMPLATE_QUESTIONS: StarterTemplate[] = STARTERS.map((t) => ({
  ...t,
  examSystems: [...(t.examSystems ?? []), ...STANDARD_EXAM_SYSTEMS.filter((s) => !(t.examSystems ?? []).includes(s))],
}));

/** The owner's answers as sentences: "Started 2–3 days ago. Vomiting a few times a day. Where: paws, belly." */
export function answersToText(reason: { questions: TemplateQuestionRow[] }, answers: Record<string, string[]>) {
  const out: string[] = [];
  for (const question of reason.questions) {
    const picked = (answers[question.id] ?? []).map((label) => question.answers.find((a) => a.label === label)?.text).filter((t): t is string => !!t && !!t.trim());
    if (!picked.length) continue;
    out.push(question.multi ? `${question.ask.replace(/\?$/, '')}: ${picked.join(', ')}` : picked[0]);
  }
  return out.map((s) => (/[.!?]$/.test(s) ? s : `${s}.`)).join(' ');
}
