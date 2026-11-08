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
  /** The kind of appointment type made for it (Consultation when not given), and its usual length. */
  kind?: 'CONSULTATION' | 'FOLLOW_UP' | 'SURGERY' | 'DENTAL' | 'DIAGNOSTICS' | 'EMERGENCY';
  durationMinutes?: number;
  /** The library version that added it (1 when not given): later versions only add what is new to them. */
  addedIn?: number;
  /** Questions used by existing appointment types (e.g. the dental procedures): no appointment type of its own. */
  noType?: boolean;
  /** Only for this kind of animal (e.g. horses). */
  speciesCategory?: string;
}

type Q = z.input<typeof templateQuestionSchema>;
const q = (ask: string, answers: [string, string][], multi = false): Q => ({ ask, multi, answers: answers.map(([label, t]) => ({ label, text: t })) });

const SINCE = q('Since when?', [
  ['Today', 'Started today'],
  ['1–3 days', 'Started 1–3 days ago'],
  ['4–7 days', 'Going on for 4–7 days'],
  ['1–4 weeks', 'Going on for 1–4 weeks'],
  ['Over a month', 'Going on for more than a month'],
]);
const COURSE = q('Getting better or worse?', [
  ['Better', 'Getting better'],
  ['Same', 'No change'],
  ['Worse', 'Getting worse'],
  ['Comes and goes', 'Comes and goes'],
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
const BEFORE = q('Had this before?', [
  ['First time', 'First time with this problem'],
  ['Before', 'Has had this problem before'],
  ['Often', 'Has this problem often'],
]);
const TREATED = q('Any treatment given at home?', [
  ['None', 'No treatment given before the visit'],
  ['Home remedy', 'Home remedy given (see notes)'],
  ['Medicine', 'Medicine already given (see notes)'],
]);
const PARASITES = q('Worm and flea treatment?', [
  ['Up to date', 'Worm and flea treatment up to date'],
  ['Overdue', 'Worm and flea treatment overdue'],
  ['Never', 'No worm or flea treatment given'],
  ['Not sure', 'Not sure about worm and flea treatment'],
]);
const VACCINES = q('Vaccinations?', [
  ['Up to date', 'Vaccinations up to date'],
  ['Overdue', 'Vaccinations overdue'],
  ['Never', 'Never vaccinated'],
  ['Not sure', 'Not sure about vaccinations'],
]);
const LIFESTYLE = q('Lives where?', [
  ['Indoors', 'Lives indoors'],
  ['Outdoors', 'Lives outdoors'],
  ['Both', 'Goes indoors and outdoors'],
]);
const DIET = q('Diet?', [
  ['Dry food', 'Eats dry food'],
  ['Wet food', 'Eats wet food'],
  ['Home cooked', 'Eats home-cooked food'],
  ['Mixed', 'Eats a mixed diet'],
]);

/**
 * The examination buttons used when a template lists none — the same standard body systems as the classic note.
 * A template's own list replaces them: the clinic adds, removes and orders buttons per template.
 */
export const STANDARD_EXAM_SYSTEMS = ['General appearance', 'Eyes', 'Ears', 'Oral cavity & teeth', 'Lymph nodes', 'Cardiovascular', 'Respiratory', 'Abdomen', 'Musculoskeletal', 'Neurological', 'Skin & coat'];

const STARTERS: StarterTemplate[] = [
  // ── Problems ──
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
      q('What comes up?', [
        ['Food', 'Vomiting food'],
        ['Froth / bile', 'Vomiting froth or yellow bile'],
        ['Blood', 'Blood in the vomit'],
        ['Nothing', 'Retching but nothing comes up'],
      ]),
      q('Diarrhoea?', [
        ['No', 'No diarrhoea'],
        ['Soft', 'Soft stools'],
        ['Watery', 'Watery diarrhoea'],
        ['With blood', 'Diarrhoea with blood'],
        ['With mucus', 'Diarrhoea with mucus'],
      ]),
      EATING,
      DRINKING,
      ENERGY,
      q('Ate something unusual?', [
        ['No', 'Not known to have eaten anything unusual'],
        ['Maybe', 'May have eaten something unusual'],
        ['Yes', 'Ate something unusual (see notes)'],
      ]),
      q('Recent change of food?', [
        ['No', 'No recent change of food'],
        ['Yes', 'Food changed recently'],
      ]),
      PARASITES,
    ],
    examSystems: ['Abdomen', 'General appearance', 'Oral cavity & teeth'],
    diagnoses: ['Acute gastroenteritis', 'Dietary indiscretion', 'Gastritis', 'Intestinal parasites', 'Foreign body (suspected)', 'Pancreatitis (suspected)', 'Parvovirus (suspected)', 'Colitis'],
    advice: [
      'Give small, bland meals for the next few days, then go back to the usual food slowly',
      'Keep fresh water available at all times',
      'Do not give any human medicines',
      'Come back at once if vomiting continues, there is blood, or he/she becomes weak',
    ],
  },
  {
    name: 'Skin / itching',
    icon: 'paw',
    presentingComplaint: 'Skin problem / itching',
    questions: [
      SINCE,
      q('How itchy?', [
        ['Not itchy', 'Not itchy'],
        ['Mild', 'Mildly itchy'],
        ['Moderate', 'Moderately itchy'],
        ['Severe', 'Severely itchy, keeps the owner awake'],
      ]),
      q(
        'Where?',
        [
          ['Ears', 'ears'],
          ['Face', 'face'],
          ['Paws', 'paws'],
          ['Armpits / belly', 'armpits and belly'],
          ['Back / tail', 'back and tail'],
          ['All over', 'all over'],
        ],
        true,
      ),
      q(
        'What do you see?',
        [
          ['Redness', 'redness'],
          ['Hair loss', 'hair loss'],
          ['Scabs', 'scabs'],
          ['Dandruff', 'dandruff'],
          ['Bad smell', 'bad smell'],
          ['Lumps', 'lumps'],
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
      q('Worse at a time of year?', [
        ['No', 'No seasonal pattern'],
        ['Yes', 'Worse at certain times of the year'],
        ['First time', 'First episode'],
      ]),
    ],
    examSystems: ['Skin & coat', 'Ears', 'Lymph nodes'],
    diagnoses: ['Flea allergy dermatitis', 'Atopic dermatitis', 'Food allergy (suspected)', 'Bacterial skin infection (pyoderma)', 'Fungal skin infection', 'Mange (mites)', 'Hot spot (acute moist dermatitis)', 'Ringworm (suspected)'],
    advice: [
      'Treat all pets at home for fleas, and keep it up all year',
      'Wash the bedding in hot water',
      'Stop licking and scratching — use a cone if needed',
      'Bathe only with the shampoo given, as shown',
      'Come back if the skin gets worse or new sores appear',
    ],
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
          ['Swollen flap', 'swollen ear flap'],
          ['Head tilt', 'head tilt'],
        ],
        true,
      ),
      q('Discharge colour?', [
        ['None', 'No discharge'],
        ['Brown / waxy', 'Brown, waxy discharge'],
        ['Yellow / pus', 'Yellow discharge (pus)'],
        ['Black / dry', 'Black, dry discharge'],
        ['Bloody', 'Bloody discharge'],
      ]),
      BEFORE,
      q('Swimming or bathing recently?', [
        ['No', 'No swimming or bathing recently'],
        ['Yes', 'Swimming or bathing recently'],
      ]),
      TREATED,
    ],
    examSystems: ['Ears', 'Skin & coat', 'Neurological'],
    diagnoses: ['Otitis externa', 'Otitis media (suspected)', 'Ear mites', 'Foreign body in ear (grass seed)', 'Aural haematoma', 'Allergic ear disease'],
    advice: [
      'Use the ear drops exactly as shown and finish the course',
      'Do not put cotton buds into the ear canal',
      'Keep water out of the ears until the recheck',
      'Come back if the ear gets more painful or swollen, or the head tilts',
    ],
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
          ['Swollen eyelid', 'swollen eyelid'],
          ['Third eyelid showing', 'third eyelid showing'],
        ],
        true,
      ),
      q('Discharge?', [
        ['None', 'No discharge'],
        ['Watery', 'Watery discharge'],
        ['Thick / yellow', 'Thick, yellow or green discharge'],
      ]),
      q('Known injury?', [
        ['No', 'No known injury'],
        ['Yes', 'Known injury to the eye'],
        ['Not sure', 'Not sure about an injury'],
      ]),
      q('Sight?', [
        ['Normal', 'Sees normally'],
        ['Bumping into things', 'Bumping into things'],
      ]),
    ],
    examSystems: ['Eyes', 'Neurological'],
    diagnoses: ['Conjunctivitis', 'Corneal ulcer', 'Dry eye (KCS)', 'Foreign body in eye', 'Cherry eye', 'Entropion', 'Uveitis (suspected)', 'Glaucoma (suspected)'],
    advice: [
      'Stop rubbing — use a cone',
      'Clean discharge gently with damp cotton wool',
      'Give the eye medicine exactly as shown; wait a few minutes between different drops',
      'Come back at once if the eye becomes cloudy, more painful or will not open',
    ],
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
      q('Worse when?', [
        ['After rest', 'Stiffer after rest'],
        ['After exercise', 'Worse after exercise'],
        ['All the time', 'Same all the time'],
      ]),
      q('Pain signs?', [
        ['None', 'No obvious signs of pain'],
        ['Cries / yelps', 'Cries or yelps when touched'],
        ['Licking the leg', 'Licking the leg'],
        ['Won’t jump / climb', 'Will not jump or climb stairs'],
      ]),
      TREATED,
    ],
    examSystems: ['Musculoskeletal', 'Neurological'],
    diagnoses: ['Soft tissue injury (sprain / strain)', 'Cruciate ligament injury', 'Fracture (suspected)', 'Osteoarthritis', 'Paw / nail injury', 'Hip dysplasia', 'Patellar luxation', 'Intervertebral disc disease (suspected)'],
    advice: [
      'Rest: short walks on the lead only until the recheck',
      'No running, jumping or stairs for now',
      'Do not give human pain medicines — they can be poisonous to pets',
      'Come back if the limp gets worse or the leg swells',
    ],
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
        ['Both', 'Vomiting and diarrhoea'],
      ]),
      q('Losing weight?', [
        ['No', 'No weight loss noticed'],
        ['Yes', 'Owner has noticed weight loss'],
        ['Not sure', 'Owner not sure about weight loss'],
      ]),
      q('Urine?', [
        ['Normal', 'Passing urine normally'],
        ['More', 'Passing more urine than usual'],
        ['Less', 'Passing less urine than usual'],
      ]),
      q('Ticks seen recently?', [
        ['No', 'No ticks seen'],
        ['Yes', 'Ticks seen recently'],
      ]),
      VACCINES,
    ],
    examSystems: ['General appearance', 'Oral cavity & teeth', 'Lymph nodes', 'Abdomen'],
    diagnoses: ['Fever of unknown cause', 'Tick-borne disease (suspected)', 'Dental disease', 'Kidney disease (suspected)', 'Liver disease (suspected)', 'Gastroenteritis', 'Anaemia (suspected)'],
    advice: [
      'Offer small amounts of soft, tasty food, warmed slightly',
      'Watch how much he/she eats, drinks and passes urine',
      'Keep him/her warm and quiet',
      'Come back if still not eating tomorrow, or sooner if weaker',
    ],
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
        ['Honking', 'Honking cough'],
        ['Gagging', 'Coughing with gagging'],
      ]),
      q('When does it cough?', [
        ['Exercise', 'Coughs with exercise or excitement'],
        ['At night', 'Coughs mostly at night'],
        ['Drinking', 'Coughs after drinking'],
        ['Any time', 'Coughs at any time'],
      ]),
      q('Breathing?', [
        ['Normal', 'Breathing normally at rest'],
        ['Fast', 'Breathing fast at rest'],
        ['Difficult', 'Difficulty breathing'],
        ['Open mouth', 'Breathing with the mouth open'],
      ]),
      q('Nose discharge or sneezing?', [
        ['No', 'No nose discharge or sneezing'],
        ['Sneezing', 'Sneezing'],
        ['Discharge', 'Discharge from the nose'],
      ]),
      q('Exercise?', [
        ['Normal', 'Normal exercise'],
        ['Tires quickly', 'Tires quickly on walks'],
        ['Faints / collapses', 'Has fainted or collapsed'],
      ]),
      q('Recently with other animals?', [
        ['No', 'No recent contact with other animals'],
        ['Yes', 'Recent contact with other animals (park, boarding, grooming)'],
      ]),
      VACCINES,
    ],
    examSystems: ['Respiratory', 'Cardiovascular', 'General appearance', 'Lymph nodes'],
    diagnoses: ['Kennel cough (infectious tracheobronchitis)', 'Upper respiratory infection', 'Cat flu', 'Pneumonia (suspected)', 'Heart disease (suspected)', 'Collapsing trachea', 'Feline asthma', 'Lungworm (suspected)'],
    advice: [
      'Walk with a harness, not a collar',
      'Keep away from other animals until better',
      'Keep him/her in a warm, smoke-free room',
      'Come back at once if breathing becomes fast or difficult, or the gums turn blue or pale',
    ],
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
        ['Not known', 'Not known when it happened'],
      ]),
      q('How?', [
        ['Fight / bite', 'Caused by a fight or bite'],
        ['Road accident', 'Hit by a vehicle'],
        ['Fall', 'Caused by a fall'],
        ['Sharp object', 'Cut by a sharp object'],
        ['Not known', 'Cause not known'],
      ]),
      q(
        'Where?',
        [
          ['Head / neck', 'head and neck'],
          ['Body', 'body'],
          ['Leg / paw', 'leg or paw'],
          ['Tail', 'tail'],
        ],
        true,
      ),
      q('Bleeding?', [
        ['None', 'No bleeding'],
        ['Stopped', 'Bleeding has stopped'],
        ['Still bleeding', 'Still bleeding'],
      ]),
      q('Licking or chewing it?', [
        ['No', 'Not licking the wound'],
        ['Yes', 'Licking or chewing the wound'],
      ]),
      ENERGY,
      VACCINES,
    ],
    examSystems: ['Skin & coat', 'Musculoskeletal', 'General appearance', 'Respiratory'],
    diagnoses: ['Bite wound', 'Laceration', 'Abscess', 'Road traffic injury', 'Degloving injury', 'Puncture wound'],
    advice: [
      'Keep the wound clean and dry',
      'Stop licking — use a cone',
      'Keep the dressing clean and dry; do not remove it yourself',
      'Come back if there is swelling, pus or a bad smell',
    ],
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
          ['Small amounts', 'passing small amounts'],
          ['Blood', 'blood in the urine'],
          ['Accidents', 'accidents in the house'],
          ['Licking', 'licking the genitals'],
          ['Not passing urine', 'NOT passing urine'],
        ],
        true,
      ),
      q('When did he/she last pass urine?', [
        ['Today', 'Passed urine today'],
        ['Yesterday', 'Last passed urine yesterday'],
        ['Not sure', 'Not sure when urine was last passed'],
      ]),
      DRINKING,
      EATING,
      DIET,
      BEFORE,
    ],
    examSystems: ['Abdomen', 'General appearance'],
    diagnoses: ['Cystitis (bladder infection)', 'Idiopathic cystitis (cats)', 'Bladder stones (suspected)', 'Urethral obstruction', 'Urinary incontinence', 'Kidney disease (suspected)', 'Diabetes (suspected)'],
    advice: [
      'Keep fresh water available at all times; offer wet food if possible',
      'Make sure he/she passes urine — come at once if not',
      'Finish the full course of medicine',
      'Bring a fresh urine sample to the recheck if asked',
    ],
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
        ['Hard to give', 'Medicines hard to give'],
        ['None given', 'No medicines were given'],
      ]),
      q('Any side effects?', [
        ['None', 'No side effects noticed'],
        ['Vomiting', 'Vomiting since starting the medicine'],
        ['Diarrhoea', 'Diarrhoea since starting the medicine'],
        ['Not eating', 'Eating less since starting the medicine'],
        ['Other', 'Other side effects (see notes)'],
      ]),
      EATING,
      ENERGY,
    ],
    advice: ['Continue the treatment as before', 'The treatment can now be stopped', 'Come back if the problem returns'],
  },
  {
    name: 'General consultation',
    icon: 'stethoscope',
    presentingComplaint: '',
    questions: [SINCE, COURSE, EATING, DRINKING, ENERGY, TREATED],
    advice: ['Come back if things get worse'],
  },

  // ── Added in the second library ──
  {
    name: 'Wellness check',
    aliases: ['Wellness examination (companion)', 'Annual health check', 'Health check'],
    icon: 'heart',
    presentingComplaint: 'Wellness check',
    kind: 'CONSULTATION',
    durationMinutes: 20,
    addedIn: 2,
    questions: [
      q('Any concerns today?', [
        ['None', 'No concerns from the owner'],
        ['Yes', 'Owner has some concerns (see notes)'],
      ]),
      EATING,
      DRINKING,
      ENERGY,
      DIET,
      LIFESTYLE,
      VACCINES,
      PARASITES,
      q('Neutered?', [
        ['Yes', 'Neutered'],
        ['No', 'Not neutered'],
      ]),
    ],
    examSystems: STANDARD_EXAM_SYSTEMS,
    diagnoses: ['Healthy — no problems found', 'Overweight', 'Dental disease', 'Skin lump found'],
    advice: ['Keep up the regular worm and flea treatment', 'Keep a healthy weight: weigh the food and limit treats', 'Brush the teeth regularly', 'Book the next health check'],
  },
  {
    name: 'Puppy / kitten first visit',
    aliases: ['Puppy visit', 'Kitten visit', 'New puppy', 'New kitten'],
    icon: 'baby',
    presentingComplaint: 'First visit — new puppy / kitten',
    kind: 'CONSULTATION',
    durationMinutes: 20,
    addedIn: 2,
    questions: [
      q('Where from?', [
        ['Breeder', 'From a breeder'],
        ['Pet shop', 'From a pet shop'],
        ['Rescue', 'From a rescue'],
        ['Found / stray', 'Found as a stray'],
      ]),
      q('How long at home?', [
        ['A few days', 'At home for a few days'],
        ['1–2 weeks', 'At home for 1–2 weeks'],
        ['Longer', 'At home for longer than 2 weeks'],
      ]),
      VACCINES,
      q('Wormed?', [
        ['Yes', 'Wormed before'],
        ['No', 'Not wormed yet'],
        ['Not sure', 'Not sure about worming'],
      ]),
      DIET,
      EATING,
      q('Toilet?', [
        ['Normal', 'Normal stools and urine'],
        ['Diarrhoea', 'Has diarrhoea'],
      ]),
      q('Owner’s questions?', [
        ['Feeding', 'Asked about feeding'],
        ['Training', 'Asked about training and toilet training'],
        ['Neutering', 'Asked about neutering'],
        ['Microchip', 'Asked about a microchip'],
      ], true),
    ],
    examSystems: ['General appearance', 'Eyes', 'Ears', 'Oral cavity & teeth', 'Cardiovascular', 'Respiratory', 'Abdomen', 'Skin & coat', 'Musculoskeletal'],
    diagnoses: ['Healthy — no problems found', 'Intestinal parasites', 'Ear mites', 'Umbilical hernia', 'Heart murmur (puppy / kitten)', 'Retained testicle'],
    advice: [
      'Finish the full course of vaccinations before meeting unknown animals',
      'Worm regularly as advised by the clinic',
      'Feed a complete puppy / kitten food in small meals',
      'Start gentle handling and toilet training now',
      'Ask us about neutering and a microchip',
    ],
  },
  {
    name: 'Senior check',
    aliases: ['Senior pet check', 'Geriatric check'],
    icon: 'heart',
    presentingComplaint: 'Senior health check',
    kind: 'CONSULTATION',
    durationMinutes: 20,
    addedIn: 2,
    questions: [
      EATING,
      DRINKING,
      q('Weight?', [
        ['Same', 'No change in weight noticed'],
        ['Losing', 'Losing weight'],
        ['Gaining', 'Gaining weight'],
      ]),
      q('Mobility?', [
        ['Normal', 'Moves normally'],
        ['Stiff', 'Stiff, especially after rest'],
        ['Struggles', 'Struggles with stairs or jumping'],
      ]),
      q('Toilet?', [
        ['Normal', 'Normal toilet habits'],
        ['Accidents', 'Accidents in the house'],
        ['More urine', 'Passing more urine'],
      ]),
      q('Behaviour?', [
        ['Normal', 'Normal behaviour'],
        ['Confused', 'Seems confused at times'],
        ['Sleeps more', 'Sleeps more than before'],
        ['Night waking', 'Restless at night'],
      ]),
      q('Breath or teeth?', [
        ['Fine', 'No concerns with teeth or breath'],
        ['Bad breath', 'Bad breath'],
        ['Chews on one side', 'Chews on one side or drops food'],
      ]),
      q('Lumps found?', [
        ['No', 'No lumps found by the owner'],
        ['Yes', 'Owner has found lumps (see notes)'],
      ]),
    ],
    examSystems: STANDARD_EXAM_SYSTEMS,
    diagnoses: ['Osteoarthritis', 'Dental disease', 'Kidney disease (suspected)', 'Heart disease (suspected)', 'Hyperthyroidism (suspected)', 'Cognitive dysfunction', 'Cataracts / lens changes'],
    advice: ['Keep him/her slim to protect the joints', 'Short, regular walks are better than long ones', 'Soft bedding in a warm, draught-free place', 'Regular health checks and blood tests help find problems early'],
  },
  {
    name: 'Dental check',
    aliases: ['Dental', 'Dental problem', 'Teeth problem'],
    icon: 'tooth',
    presentingComplaint: 'Dental problem',
    kind: 'DENTAL',
    durationMinutes: 20,
    addedIn: 2,
    questions: [
      SINCE,
      q(
        'What do you notice?',
        [
          ['Bad breath', 'bad breath'],
          ['Drooling', 'drooling'],
          ['Dropping food', 'dropping food'],
          ['Chewing on one side', 'chewing on one side'],
          ['Pawing at the mouth', 'pawing at the mouth'],
          ['Bleeding gums', 'bleeding gums'],
          ['Swollen face', 'swollen face'],
        ],
        true,
      ),
      EATING,
      q('Teeth brushed?', [
        ['Daily', 'Teeth brushed daily'],
        ['Sometimes', 'Teeth brushed sometimes'],
        ['Never', 'Teeth never brushed'],
      ]),
      q('Chews on hard things?', [
        ['No', 'Does not chew hard objects'],
        ['Bones / antlers', 'Chews bones or antlers'],
        ['Stones / toys', 'Chews stones or hard toys'],
      ]),
      q('Dental cleaning before?', [
        ['Never', 'No dental cleaning before'],
        ['Yes', 'Has had a dental cleaning before'],
      ]),
    ],
    examSystems: ['Oral cavity & teeth', 'Lymph nodes', 'General appearance'],
    diagnoses: ['Periodontal disease', 'Dental tartar', 'Gingivitis', 'Fractured tooth', 'Tooth root abscess', 'Retained baby teeth', 'Feline resorptive lesion (FORL)'],
    advice: ['Brush the teeth daily with a pet toothpaste', 'Avoid bones, antlers and stones — they break teeth', 'A dental cleaning under anaesthetic is recommended', 'Come back if the face swells or he/she stops eating'],
  },
  {
    name: 'Lump / mass',
    aliases: ['Lump', 'Mass', 'Swelling'],
    icon: 'thermometer',
    presentingComplaint: 'Lump / swelling',
    kind: 'CONSULTATION',
    addedIn: 2,
    questions: [
      q('When first noticed?', [
        ['This week', 'First noticed this week'],
        ['This month', 'First noticed this month'],
        ['Months ago', 'First noticed months ago'],
      ]),
      q('Changing?', [
        ['Same size', 'Staying the same size'],
        ['Growing slowly', 'Growing slowly'],
        ['Growing fast', 'Growing fast'],
        ['Getting smaller', 'Getting smaller'],
      ]),
      q('How many?', [
        ['One', 'One lump'],
        ['A few', 'A few lumps'],
        ['Many', 'Many lumps'],
      ]),
      q(
        'What is it like?',
        [
          ['Soft', 'soft'],
          ['Firm', 'firm'],
          ['Painful', 'painful'],
          ['Hot', 'hot'],
          ['Bleeding / open', 'bleeding or open'],
          ['Itchy', 'itchy'],
        ],
        true,
      ),
      EATING,
      ENERGY,
    ],
    examSystems: ['Skin & coat', 'Lymph nodes', 'General appearance', 'Abdomen'],
    diagnoses: ['Lipoma (suspected)', 'Abscess', 'Sebaceous cyst', 'Mammary mass', 'Mast cell tumour (suspected)', 'Haematoma', 'Mass — cause not yet known'],
    advice: ['Measure the lump and note any change in size', 'A needle sample (FNA) helps tell what the lump is', 'Stop licking — use a cone if needed', 'Come back if it grows quickly, bleeds or opens'],
  },
  {
    name: 'Seizure / neurological',
    aliases: ['Seizure', 'Fits', 'Neurological problem'],
    icon: 'brain',
    presentingComplaint: 'Seizure / neurological signs',
    kind: 'CONSULTATION',
    durationMinutes: 20,
    addedIn: 2,
    questions: [
      q(
        'What happened?',
        [
          ['Seizure / fit', 'seizure (fit)'],
          ['Collapse', 'collapse'],
          ['Wobbly', 'wobbly walking'],
          ['Head tilt', 'head tilt'],
          ['Circling', 'circling'],
          ['Weak legs', 'weak legs'],
        ],
        true,
      ),
      q('How many episodes?', [
        ['Once', 'One episode'],
        ['A few', 'A few episodes'],
        ['Many / clusters', 'Many episodes or clusters'],
      ]),
      q('How long did it last?', [
        ['Under 2 minutes', 'Lasted less than 2 minutes'],
        ['2–5 minutes', 'Lasted 2–5 minutes'],
        ['Over 5 minutes', 'Lasted more than 5 minutes'],
        ['Still ongoing', 'Signs still ongoing'],
      ]),
      q('After the episode?', [
        ['Normal quickly', 'Back to normal quickly'],
        ['Confused', 'Confused or blind for a while after'],
        ['Not back to normal', 'Not back to normal'],
      ]),
      q('Possible poison?', [
        ['No', 'No known access to poisons'],
        ['Maybe', 'May have had access to poisons'],
        ['Yes', 'Known access to a poison (see notes)'],
      ]),
      BEFORE,
    ],
    examSystems: ['Neurological', 'General appearance', 'Eyes', 'Cardiovascular'],
    diagnoses: ['Idiopathic epilepsy', 'Seizure — cause not yet known', 'Poisoning (suspected)', 'Vestibular disease', 'Intervertebral disc disease (suspected)', 'Low blood sugar (suspected)'],
    advice: [
      'During a fit: keep hands away from the mouth and move furniture away',
      'Write down the date, time and length of every episode, and film one if you can',
      'Keep him/her away from stairs and water',
      'Come at once if a fit lasts more than 5 minutes or fits come one after another',
    ],
  },
  {
    name: 'Behaviour problem',
    aliases: ['Behaviour'],
    icon: 'brain',
    presentingComplaint: 'Behaviour problem',
    kind: 'CONSULTATION',
    durationMinutes: 30,
    addedIn: 2,
    questions: [
      q(
        'What is the problem?',
        [
          ['Aggression', 'aggression'],
          ['Fear / anxiety', 'fear or anxiety'],
          ['Barking / noise', 'excessive barking or noise'],
          ['Destroying things', 'destroying things'],
          ['Toilet in the house', 'going to the toilet in the house'],
          ['Pulling / jumping', 'pulling on the lead or jumping up'],
        ],
        true,
      ),
      q('Towards whom?', [
        ['Family', 'Towards family members'],
        ['Strangers', 'Towards strangers'],
        ['Other animals', 'Towards other animals'],
        ['Not aggressive', 'Not aggressive'],
      ]),
      SINCE,
      q('Any recent change at home?', [
        ['No', 'No recent changes at home'],
        ['New person / pet', 'New person or pet at home'],
        ['Moved house', 'Moved house recently'],
        ['Owner away more', 'Owner away from home more'],
      ]),
      q('Left alone?', [
        ['Rarely', 'Rarely left alone'],
        ['A few hours', 'Left alone for a few hours a day'],
        ['Most of the day', 'Left alone most of the day'],
      ]),
      q('Neutered?', [
        ['Yes', 'Neutered'],
        ['No', 'Not neutered'],
      ]),
    ],
    examSystems: ['General appearance', 'Neurological', 'Musculoskeletal', 'Oral cavity & teeth'],
    diagnoses: ['Separation-related problem', 'Fear-related aggression', 'Anxiety', 'House-soiling', 'Pain-related behaviour change'],
    advice: [
      'Never punish — reward the behaviour you want',
      'Keep a diary of when the problem happens and what came before it',
      'Give daily exercise and things to chew and play with',
      'A trainer or behaviourist we recommend can help',
    ],
  },
  {
    name: 'Post-op check',
    aliases: ['Post-operative check', 'Stitches check', 'Suture removal'],
    icon: 'scissors',
    presentingComplaint: 'Post-operative check',
    kind: 'FOLLOW_UP',
    addedIn: 2,
    questions: [
      q('How is he/she since the surgery?', [
        ['Well', 'Doing well since the surgery'],
        ['Quiet', 'Quieter than usual since the surgery'],
        ['Unwell', 'Not well since the surgery'],
      ]),
      EATING,
      q('The wound?', [
        ['Looks fine', 'Owner says the wound looks fine'],
        ['Red / swollen', 'Wound red or swollen'],
        ['Discharge', 'Discharge from the wound'],
        ['Opened', 'Wound has opened'],
      ]),
      q('Licking the wound?', [
        ['No', 'Not licking the wound'],
        ['Yes', 'Licking the wound'],
      ]),
      q('Cone worn?', [
        ['Always', 'Wearing the cone at all times'],
        ['Sometimes', 'Wearing the cone some of the time'],
        ['No', 'Not wearing the cone'],
      ]),
      q('Medicines given?', [
        ['As told', 'Medicines given as instructed'],
        ['Some missed', 'Some doses missed'],
        ['None given', 'No medicines were given'],
      ]),
    ],
    examSystems: ['General appearance', 'Skin & coat', 'Abdomen'],
    diagnoses: ['Healing well', 'Wound infection', 'Wound breakdown', 'Seroma', 'Suture reaction'],
    advice: ['Keep the wound clean and dry — no bathing or swimming', 'Keep the cone on until the wound has healed', 'Lead walks only until the vet says otherwise', 'Come back if the wound opens, swells or has discharge'],
  },
  {
    name: 'Pre-surgery check',
    aliases: ['Pre-anaesthetic check', 'Pre-op check'],
    icon: 'scissors',
    presentingComplaint: 'Pre-surgery check',
    kind: 'SURGERY',
    addedIn: 2,
    questions: [
      q('Fasted as asked?', [
        ['Yes', 'Fasted as instructed'],
        ['No', 'Has eaten today'],
        ['Not sure', 'Not sure if fasted'],
      ]),
      q('Unwell recently?', [
        ['No', 'No recent illness'],
        ['Yes', 'Recent illness (see notes)'],
      ]),
      q('Medicines now?', [
        ['None', 'No current medicines'],
        ['Yes', 'On medicines (see notes)'],
      ]),
      q('Anaesthetic before?', [
        ['Never', 'No anaesthetic before'],
        ['No problems', 'Anaesthetic before with no problems'],
        ['Had problems', 'Problems with an anaesthetic before'],
      ]),
      q('Consent form signed?', [
        ['Yes', 'Consent form signed'],
        ['Not yet', 'Consent form not yet signed'],
      ]),
      q('Contact number for today?', [
        ['Confirmed', 'Contact number for today confirmed'],
        ['Not yet', 'Contact number not confirmed'],
      ]),
    ],
    examSystems: ['General appearance', 'Cardiovascular', 'Respiratory', 'Oral cavity & teeth', 'Abdomen'],
    diagnoses: ['Fit for anaesthetic', 'Fit for anaesthetic — higher risk (see notes)', 'Not fit for anaesthetic today'],
    advice: ['We will call you when he/she is awake', 'Bring a clean, warm bed for the journey home', 'Offer a small meal tonight, unless told otherwise'],
  },
  {
    name: 'Emergency',
    aliases: ['Emergency assessment', 'Urgent case'],
    icon: 'thermometer',
    presentingComplaint: 'Emergency',
    kind: 'EMERGENCY',
    durationMinutes: 30,
    addedIn: 2,
    questions: [
      q(
        'What happened?',
        [
          ['Hit by a vehicle', 'hit by a vehicle'],
          ['Collapse', 'collapse'],
          ['Breathing problem', 'breathing problem'],
          ['Bleeding', 'heavy bleeding'],
          ['Poisoning', 'possible poisoning'],
          ['Bloated belly', 'bloated belly'],
          ['Birth problem', 'problem giving birth'],
        ],
        true,
      ),
      q('When?', [
        ['Just now', 'Happened within the last hour'],
        ['Today', 'Happened earlier today'],
        ['Yesterday or before', 'Happened yesterday or before'],
      ]),
      q('Conscious?', [
        ['Alert', 'Alert'],
        ['Dull', 'Dull but responds'],
        ['Not responding', 'Not responding'],
      ]),
      q('Breathing?', [
        ['Normal', 'Breathing normally'],
        ['Fast / hard', 'Breathing fast or hard'],
        ['Very slow', 'Breathing very slowly'],
      ]),
      q('Poison or medicine eaten?', [
        ['No', 'No known poison or medicine eaten'],
        ['Yes', 'Poison or medicine eaten (see notes — bring the pack)'],
      ]),
    ],
    examSystems: ['General appearance', 'Cardiovascular', 'Respiratory', 'Neurological', 'Abdomen', 'Musculoskeletal'],
    diagnoses: ['Road traffic injury', 'Shock', 'Poisoning (suspected)', 'Gastric dilatation-volvulus (bloat)', 'Heatstroke', 'Respiratory distress', 'Dystocia (difficult birth)'],
    advice: ['He/she needs to stay in the hospital for treatment and monitoring', 'We will call you with updates', 'Bring any packets of what he/she may have eaten'],
  },
];

/** The starter library version. Version 2 improved the first eleven templates and added common visit types. */
export const TEMPLATE_LIBRARY_VERSION = 2;

/** A short, stable fingerprint of a text (FNV-1a), to compare a clinic's template with a starter one. */
function fingerprint(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
export const questionsFingerprint = (questions: { ask: string; multi?: boolean; answers: { label: string; text?: string | null }[] }[]) =>
  fingerprint(JSON.stringify(questions.map((x) => [x.ask.trim(), !!x.multi, x.answers.map((a) => [a.label.trim(), (a.text ?? '').trim()])])));
export const listFingerprint = (list: string[] | null | undefined) => fingerprint(JSON.stringify((list ?? []).map((s) => s.trim())));

/**
 * Fingerprints of the first library's templates: a clinic template that still matches them was never changed, so a
 * newer library may improve it. Anything the clinic edited keeps the clinic's version.
 */
export const STARTER_V1_FINGERPRINTS: Record<string, { questions: string; diagnoses: string; advice: string; examSystems: string }> = {
  'Vomiting / diarrhoea': { questions: '0ea6690b', diagnoses: 'a0812973', advice: 'cd73a1b8', examSystems: '86961e11' },
  'Skin / itching': { questions: '7ad8b860', diagnoses: '7e8f7495', advice: '68bfa1a7', examSystems: 'eb5f64ad' },
  'Ear problem': { questions: '474a1dd5', diagnoses: '5dfdf7fd', advice: '18173b75', examSystems: '0e2863c5' },
  'Eye problem': { questions: '939a4ede', diagnoses: '07c73936', advice: '1e028e8a', examSystems: '74fab329' },
  'Limping / pain': { questions: 'bd3d8751', diagnoses: 'a4ed6238', advice: '9d850557', examSystems: '95d94ed7' },
  'Not eating / tired': { questions: '7138c79e', diagnoses: 'ee7c9c50', advice: '77eac0e3', examSystems: 'd0040261' },
  'Cough / breathing': { questions: '7335c7bb', diagnoses: 'c4ece5ba', advice: '5cd9f81b', examSystems: '58636987' },
  'Wound / injury': { questions: 'ee12c58c', diagnoses: '344cd166', advice: 'fb76b2aa', examSystems: '609a8c71' },
  'Urine problem': { questions: 'f3090b50', diagnoses: '01bd2ba2', advice: '6c20b394', examSystems: '0b94c029' },
  'Recheck / follow-up': { questions: '297b441d', diagnoses: '741638a5', advice: 'b1297e7c', examSystems: '2833ff15' },
  'General consultation': { questions: '2347dbd5', diagnoses: '741638a5', advice: 'd092ed16', examSystems: '2833ff15' },
};

/**
 * Questions for the dental procedures (which are appointment types in the Dental category): added with dental, not
 * with the general library, and used by the procedure types instead of making types of their own.
 */
export const DENTAL_STARTER_TEMPLATES: StarterTemplate[] = [
  {
    name: 'Dental procedure',
    icon: 'tooth',
    presentingComplaint: 'Dental treatment',
    noType: true,
    questions: [
      q(
        'Why the dental treatment?',
        [
          ['Found at a check-up', 'Dental disease found at a check-up'],
          ['Bad breath', 'bad breath'],
          ['Broken tooth', 'broken tooth'],
          ['Loose tooth', 'loose tooth'],
          ['Painful mouth', 'painful mouth'],
          ['Swollen face', 'swollen face'],
        ],
        true,
      ),
      q('Fasted as asked?', [
        ['Yes', 'Fasted as instructed'],
        ['Has eaten', 'Has eaten today'],
        ['Not sure', 'Not sure if fasted'],
      ]),
      q(
        'Health problems?',
        [
          ['None', 'no known health problems'],
          ['Heart', 'heart problem'],
          ['Kidney', 'kidney problem'],
          ['Liver', 'liver problem'],
          ['Diabetes', 'diabetes'],
          ['Other', 'other health problem (see notes)'],
        ],
        true,
      ),
      q('Medicines now?', [
        ['None', 'No current medicines'],
        ['Yes', 'On medicines (see notes)'],
      ]),
      q('Anaesthetic before?', [
        ['Never', 'No anaesthetic before'],
        ['No problems', 'Anaesthetic before with no problems'],
        ['Had problems', 'Problems with an anaesthetic before'],
      ]),
      q('Teeth brushed at home?', [
        ['Daily', 'Teeth brushed daily'],
        ['Sometimes', 'Teeth brushed sometimes'],
        ['Never', 'Teeth never brushed'],
      ]),
      EATING,
      q('Estimate and consent agreed?', [
        ['Yes', 'Estimate and consent agreed with the owner'],
        ['Not yet', 'Estimate and consent not yet agreed'],
      ]),
    ],
    examSystems: ['Oral cavity & teeth', 'Cardiovascular', 'Respiratory', 'General appearance', 'Lymph nodes'],
    diagnoses: ['Periodontal disease', 'Dental tartar', 'Fractured tooth', 'Tooth root abscess', 'Tooth resorption', 'Retained baby teeth', 'Oral mass'],
    advice: [
      'Offer soft food tonight and for the next few days, as advised',
      'No bones, antlers or hard chews until the recheck',
      'Give the pain relief exactly as prescribed',
      'Start brushing the teeth daily once the mouth has healed',
      'Come back if there is bleeding, swelling of the face, or he/she stops eating',
    ],
  },
  {
    name: 'Horse dental',
    icon: 'tooth',
    presentingComplaint: 'Horse dental',
    noType: true,
    speciesCategory: 'EQUINE',
    questions: [
      q('Last dental check?', [
        ['Within a year', 'Last dental check within a year'],
        ['Over a year', 'Last dental check more than a year ago'],
        ['Never', 'No dental check before'],
        ['Not known', 'Last dental check not known'],
      ]),
      q(
        'What do you notice?',
        [
          ['Dropping feed', 'dropping feed (quidding)'],
          ['Weight loss', 'weight loss'],
          ['Slow eating', 'slow eating'],
          ['Head tossing', 'head tossing'],
          ['Fighting the bit', 'fighting the bit'],
          ['Bad smell', 'bad smell from the mouth'],
          ['Swollen face', 'swelling of the face'],
          ['Nose discharge (one side)', 'discharge from one nostril'],
        ],
        true,
      ),
      q('Feed?', [
        ['Grazing', 'Mostly grazing'],
        ['Hay', 'Mostly hay'],
        ['Hard feed', 'Hard feed'],
        ['Mixed', 'Mixed feed'],
      ]),
      q('Ridden?', [
        ['Yes', 'Ridden'],
        ['No', 'Not ridden'],
      ]),
      q('Sedation before?', [
        ['Never', 'No sedation before'],
        ['No problems', 'Sedated before with no problems'],
        ['Had problems', 'Problems with sedation before'],
      ]),
      EATING,
    ],
    examSystems: ['Oral cavity & teeth', 'General appearance', 'Lymph nodes', 'Respiratory'],
    diagnoses: ['Sharp enamel points', 'Hooks / ramps', 'Wolf teeth', 'Diastema with food packing', 'Fractured cheek tooth', 'Periodontal disease', 'EOTRH'],
    advice: [
      'Offer soaked or soft feed for a few days if the mouth is sore',
      'Ride without a bit until the vet says otherwise',
      'Book the next dental check as advised by the clinic',
      'Come back if dropping feed or weight loss starts again',
    ],
  },
];

/** The starter template for a template or appointment type name (its own name or an alias). */
export function starterFor(name: string) {
  const n = name.trim().toLowerCase();
  return [...STARTER_TEMPLATE_QUESTIONS, ...DENTAL_STARTER_TEMPLATES].find((t) => t.name.toLowerCase() === n || (t.aliases ?? []).some((a) => a.toLowerCase() === n));
}

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
