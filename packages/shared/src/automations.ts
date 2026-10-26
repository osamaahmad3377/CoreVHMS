import { z } from 'zod';

/**
 * Automations: "When something happens → only if … → then do these steps". The clinic builds its own workflows
 * (Settings → Automations) on top of the built-in client notifications.
 */

// ───────────────────────────── Triggers ─────────────────────────────

export const AUTOMATION_TRIGGERS = [
  'APPOINTMENT_BOOKED',
  'APPOINTMENT_RESCHEDULED',
  'APPOINTMENT_CANCELLED',
  'APPOINTMENT_UPCOMING',
  'APPOINTMENT_COMPLETED',
  'APPOINTMENT_NO_SHOW',
  'LAB_RESULTS_READY',
  'PATIENT_DISCHARGED',
  'PAYMENT_RECEIVED',
  'VACCINATION_GIVEN',
  'CARE_DUE',
  'CLIENT_REGISTERED',
  'PET_BIRTHDAY',
] as const;
export type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number];

export type TriggerGroup = 'Appointments' | 'Clinical' | 'Money' | 'Clients & pets';

export interface TriggerInfo {
  label: string;
  /** "When …" sentence. */
  when: string;
  group: TriggerGroup;
  /** Happens at a time worked out from a date (checked every few minutes), not at a moment in the app. */
  timed?: 'HOURS_BEFORE' | 'DAYS_BEFORE' | 'ON_DAY';
  variables: string[];
  /** Conditions that make sense for this trigger. */
  conditions: AutomationConditionField[];
}

const CLIENT_VARS = ['clientName', 'clinicName', 'clinicPhone'];
const APPT_VARS = [...CLIENT_VARS, 'petName', 'species', 'appointmentTime', 'appointmentDate', 'appointmentType', 'branchName', 'vetName'];
const APPT_CONDS: AutomationConditionField[] = ['species', 'branch', 'appointmentType', 'contact'];

export const TRIGGER_INFO: Record<AutomationTrigger, TriggerInfo> = {
  APPOINTMENT_BOOKED: { label: 'Appointment booked', when: 'an appointment is booked', group: 'Appointments', variables: APPT_VARS, conditions: [...APPT_CONDS, 'source'] },
  APPOINTMENT_RESCHEDULED: { label: 'Appointment moved', when: 'an appointment is moved to another time', group: 'Appointments', variables: APPT_VARS, conditions: APPT_CONDS },
  APPOINTMENT_CANCELLED: { label: 'Appointment cancelled', when: 'an appointment is cancelled', group: 'Appointments', variables: APPT_VARS, conditions: APPT_CONDS },
  APPOINTMENT_UPCOMING: { label: 'Before an appointment', when: 'an appointment is coming up', group: 'Appointments', timed: 'HOURS_BEFORE', variables: APPT_VARS, conditions: APPT_CONDS },
  APPOINTMENT_COMPLETED: { label: 'Visit finished', when: 'a visit is finished', group: 'Appointments', variables: APPT_VARS, conditions: APPT_CONDS },
  APPOINTMENT_NO_SHOW: { label: 'Missed appointment', when: 'a client misses an appointment', group: 'Appointments', variables: APPT_VARS, conditions: APPT_CONDS },
  LAB_RESULTS_READY: { label: 'Lab results ready', when: 'lab or X-ray results are released', group: 'Clinical', variables: [...CLIENT_VARS, 'petName', 'species', 'testNames'], conditions: ['species', 'branch', 'contact'] },
  PATIENT_DISCHARGED: { label: 'Animal goes home', when: 'an animal is discharged home from the hospital', group: 'Clinical', variables: [...CLIENT_VARS, 'petName', 'species', 'homeCare', 'followUpDate'], conditions: ['species', 'branch', 'contact'] },
  VACCINATION_GIVEN: { label: 'Vaccination given', when: 'a vaccination is given here', group: 'Clinical', variables: [...CLIENT_VARS, 'petName', 'species', 'vaccineName', 'givenDate', 'nextDueDate'], conditions: ['species', 'contact'] },
  CARE_DUE: { label: 'Vaccination or care due', when: 'a vaccination or other care is due', group: 'Clinical', timed: 'DAYS_BEFORE', variables: [...CLIENT_VARS, 'petName', 'species', 'careName', 'dueDate'], conditions: ['species', 'contact'] },
  PAYMENT_RECEIVED: { label: 'Payment received', when: 'a payment is received', group: 'Money', variables: [...CLIENT_VARS, 'amount', 'receiptNumber', 'paymentDate', 'balance'], conditions: ['amountAtLeast', 'branch', 'contact'] },
  CLIENT_REGISTERED: { label: 'New client', when: 'a new client is registered', group: 'Clients & pets', variables: CLIENT_VARS, conditions: ['branch', 'contact'] },
  PET_BIRTHDAY: { label: 'Pet’s birthday', when: 'it is a pet’s birthday', group: 'Clients & pets', timed: 'ON_DAY', variables: [...CLIENT_VARS, 'petName', 'species', 'age'], conditions: ['species', 'contact'] },
};

/** What each {{variable}} means, for the message editor. */
export const AUTOMATION_VARIABLES: Record<string, { label: string; example: string }> = {
  clientName: { label: 'Client name', example: 'Bilal Ahmad' },
  clinicName: { label: 'Clinic name', example: 'Happy Paws Clinic' },
  clinicPhone: { label: 'Clinic phone', example: '042 3576 1234' },
  petName: { label: 'Pet name', example: 'Tiger' },
  species: { label: 'Species', example: 'Dog' },
  appointmentTime: { label: 'Appointment date & time', example: 'Tue 28 Oct, 10:30' },
  appointmentDate: { label: 'Appointment date', example: 'Tue 28 Oct' },
  appointmentType: { label: 'Appointment type', example: 'Consultation' },
  branchName: { label: 'Branch', example: 'Lahore — Gulberg' },
  vetName: { label: 'Vet', example: 'Dr. Asad Khan' },
  testNames: { label: 'Tests', example: 'Complete blood count' },
  homeCare: { label: 'Home care', example: 'Rest for 3 days' },
  followUpDate: { label: 'Check-up date', example: '2 Nov 2026' },
  vaccineName: { label: 'Vaccine', example: 'Rabies booster' },
  givenDate: { label: 'Date given', example: '26 Oct 2026' },
  nextDueDate: { label: 'Next due', example: '26 Oct 2027' },
  careName: { label: 'Care due', example: 'Rabies booster' },
  dueDate: { label: 'Due date', example: '2 Nov 2026' },
  amount: { label: 'Amount paid', example: 'Rs 4,500' },
  receiptNumber: { label: 'Receipt number', example: 'RCT-000123' },
  paymentDate: { label: 'Payment date', example: '26 Oct 2026' },
  balance: { label: 'Still owed', example: 'Rs 0' },
  age: { label: 'Age (years)', example: '3' },
};

export function sampleVars(trigger: AutomationTrigger) {
  return Object.fromEntries(TRIGGER_INFO[trigger].variables.map((v) => [v, AUTOMATION_VARIABLES[v]?.example ?? '']));
}

// ───────────────────────────── Conditions ─────────────────────────────

export const AUTOMATION_CONDITION_FIELDS = ['species', 'branch', 'appointmentType', 'contact', 'amountAtLeast', 'source'] as const;
export type AutomationConditionField = (typeof AUTOMATION_CONDITION_FIELDS)[number];

export const CONDITION_INFO: Record<AutomationConditionField, { label: string }> = {
  species: { label: 'Species' },
  branch: { label: 'Branch' },
  appointmentType: { label: 'Appointment type' },
  contact: { label: 'Client can be reached by' },
  amountAtLeast: { label: 'Amount paid at least' },
  source: { label: 'Booked' },
};

export const automationConditionSchema = z.object({
  field: z.enum(AUTOMATION_CONDITION_FIELDS),
  /** is / is not (one of the values). */
  op: z.enum(['IS', 'IS_NOT']).default('IS'),
  /** Ids (species, branch, appointment type), "WHATSAPP"/"EMAIL" for contact, "ONLINE"/"STAFF" for source, or an amount in minor units. */
  values: z.array(z.string().trim().min(1).max(80)).min(1).max(30),
});
export type AutomationCondition = z.infer<typeof automationConditionSchema>;

/** The facts a run is judged on (built by the API for each trigger). */
export interface AutomationFacts {
  speciesId?: string | null;
  branchId?: string | null;
  appointmentTypeId?: string | null;
  hasWhatsApp?: boolean;
  hasEmail?: boolean;
  amountMinor?: number | null;
  source?: 'ONLINE' | 'STAFF' | null;
}

/** True when every condition holds. A condition about something the trigger does not have is not met. */
export function conditionsMet(conditions: AutomationCondition[], f: AutomationFacts) {
  return conditions.every((c) => {
    const is = (hit: boolean) => (c.op === 'IS' ? hit : !hit);
    switch (c.field) {
      case 'species':
        return is(!!f.speciesId && c.values.includes(f.speciesId));
      case 'branch':
        return is(!!f.branchId && c.values.includes(f.branchId));
      case 'appointmentType':
        return is(!!f.appointmentTypeId && c.values.includes(f.appointmentTypeId));
      case 'contact':
        return is(c.values.some((v) => (v === 'WHATSAPP' ? !!f.hasWhatsApp : v === 'EMAIL' ? !!f.hasEmail : false)));
      case 'amountAtLeast':
        return is(f.amountMinor != null && f.amountMinor >= Number(c.values[0]));
      case 'source':
        return is(!!f.source && c.values.includes(f.source));
    }
  });
}

// ───────────────────────────── Steps ─────────────────────────────

export const AUTOMATION_CHANNELS = ['BEST', 'WHATSAPP', 'EMAIL', 'SMS'] as const;
export type AutomationChannel = (typeof AUTOMATION_CHANNELS)[number];

export const automationStepSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('SEND_MESSAGE'),
    /** BEST = the client's preferred channel that works (WhatsApp first when connected, else email). */
    channel: z.enum(AUTOMATION_CHANNELS).default('BEST'),
    subject: z.string().trim().max(200).nullish(),
    body: z.string().trim().min(1, 'Write the message').max(2000),
  }),
  z.object({
    type: z.literal('WAIT'),
    amount: z.coerce.number().int().min(1).max(365),
    unit: z.enum(['MINUTES', 'HOURS', 'DAYS']),
  }),
  z.object({
    type: z.literal('CREATE_TASK'),
    title: z.string().trim().min(1, 'Give the task a title').max(200),
    details: z.string().trim().max(1000).nullish(),
    /** Due this many days after the step runs. */
    dueInDays: z.coerce.number().int().min(0).max(90).default(0),
    /** A staff member (membership id), or the appointment's vet when empty. */
    assigneeId: z.string().uuid().nullish(),
  }),
  z.object({
    type: z.literal('EMAIL_TEAM'),
    to: z.string().trim().email('Enter an email address').max(200),
    subject: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(2000),
  }),
]);
export type AutomationStep = z.infer<typeof automationStepSchema>;

export const automationSchema = z
  .object({
    name: z.string().trim().min(1, 'Give the automation a name').max(120),
    description: z.string().trim().max(300).nullish(),
    isActive: z.boolean().default(true),
    /** Promotional (e.g. birthday offers): only clients who agreed to marketing messages. */
    marketing: z.boolean().default(false),
    trigger: z.enum(AUTOMATION_TRIGGERS),
    /** Before an appointment: hours; care due: days before (0 = on the day). */
    offset: z.coerce.number().int().min(0).max(720).nullish(),
    /** Timed triggers: the hour (0–23, clinic time) to send; null = as soon as due. */
    atHour: z.coerce.number().int().min(0).max(23).nullish(),
    conditions: z.array(automationConditionSchema).max(10).default([]),
    steps: z.array(automationStepSchema).min(1, 'Add at least one step').max(12),
  })
  .superRefine((a, ctx) => {
    if (!a.steps.some((s) => s.type !== 'WAIT')) ctx.addIssue({ code: 'custom', path: ['steps'], message: 'Add something to do (a message or a task), not only waits' });
    if (a.steps[a.steps.length - 1]?.type === 'WAIT') ctx.addIssue({ code: 'custom', path: ['steps'], message: 'A wait at the end does nothing — remove it or add a step after it' });
    const timed = TRIGGER_INFO[a.trigger].timed;
    if (timed && timed !== 'ON_DAY' && a.offset == null) ctx.addIssue({ code: 'custom', path: ['offset'], message: timed === 'HOURS_BEFORE' ? 'Say how many hours before' : 'Say how many days before' });
  });
export type AutomationInput = z.infer<typeof automationSchema>;
/** As typed by a person or a recipe (defaults not yet applied). */
export type AutomationDraft = z.input<typeof automationSchema>;

export const waitMs = (s: { amount: number; unit: 'MINUTES' | 'HOURS' | 'DAYS' }) => s.amount * (s.unit === 'MINUTES' ? 60_000 : s.unit === 'HOURS' ? 3_600_000 : 86_400_000);

// ───────────────────────────── Recipes ─────────────────────────────

/** Ready-made automations the clinic starts from (switched off until saved). */
export const AUTOMATION_RECIPES: { key: string; icon: string; automation: AutomationDraft }[] = [
  {
    key: 'thank-you',
    icon: 'heart',
    automation: {
      name: 'Thank you after a visit',
      description: 'A friendly message two hours after the visit.',
      isActive: true,
      trigger: 'APPOINTMENT_COMPLETED',
      conditions: [],
      steps: [
        { type: 'WAIT', amount: 2, unit: 'HOURS' },
        { type: 'SEND_MESSAGE', channel: 'BEST', subject: 'Thank you for visiting {{clinicName}}', body: 'Hello {{clientName}}, thank you for bringing {{petName}} to {{clinicName}} today. If you have any questions, reply here or call {{clinicPhone}}.' },
      ],
    },
  },
  {
    key: 'reminder-24h',
    icon: 'bell',
    automation: {
      name: 'Appointment reminder the day before',
      description: '24 hours before every appointment.',
      isActive: true,
      trigger: 'APPOINTMENT_UPCOMING',
      offset: 24,
      conditions: [],
      steps: [{ type: 'SEND_MESSAGE', channel: 'BEST', subject: 'Reminder: {{petName}} tomorrow at {{clinicName}}', body: 'Hello {{clientName}}, a reminder that {{petName}} has an appointment ({{appointmentType}}) at {{clinicName}}, {{branchName}} on {{appointmentTime}}. Reply or call {{clinicPhone}} if you need to change it.' }],
    },
  },
  {
    key: 'after-discharge',
    icon: 'home',
    automation: {
      name: 'Check on the animal after it goes home',
      description: 'Three days after discharge: a message to the owner and a call task for the vet.',
      isActive: true,
      trigger: 'PATIENT_DISCHARGED',
      conditions: [],
      steps: [
        { type: 'WAIT', amount: 3, unit: 'DAYS' },
        { type: 'SEND_MESSAGE', channel: 'BEST', subject: 'How is {{petName}}?', body: 'Hello {{clientName}}, how is {{petName}} doing at home? If anything worries you, reply here or call {{clinicPhone}}.' },
        { type: 'CREATE_TASK', title: 'Call to check on {{petName}} after discharge', dueInDays: 0 },
      ],
    },
  },
  {
    key: 'missed',
    icon: 'calendar-x',
    automation: {
      name: 'We missed you',
      description: 'An hour after a missed appointment, invite the client to book again.',
      isActive: true,
      trigger: 'APPOINTMENT_NO_SHOW',
      conditions: [],
      steps: [
        { type: 'WAIT', amount: 1, unit: 'HOURS' },
        { type: 'SEND_MESSAGE', channel: 'BEST', subject: 'We missed {{petName}} today', body: 'Hello {{clientName}}, we missed {{petName}} at {{clinicName}} today. Reply here or call {{clinicPhone}} to book another time.' },
      ],
    },
  },
  {
    key: 'welcome',
    icon: 'user-plus',
    automation: {
      name: 'Welcome new clients',
      description: 'A welcome message when a new client is registered.',
      isActive: true,
      trigger: 'CLIENT_REGISTERED',
      conditions: [],
      steps: [{ type: 'SEND_MESSAGE', channel: 'BEST', subject: 'Welcome to {{clinicName}}', body: 'Hello {{clientName}}, welcome to {{clinicName}}! Save this number to reach us — you can message us here any time or call {{clinicPhone}}.' }],
    },
  },
  {
    key: 'birthday',
    icon: 'cake',
    automation: {
      name: 'Pet birthday wishes',
      description: 'On the pet’s birthday at 10:00, to clients who agreed to marketing messages.',
      isActive: true,
      marketing: true,
      trigger: 'PET_BIRTHDAY',
      atHour: 10,
      conditions: [],
      steps: [{ type: 'SEND_MESSAGE', channel: 'BEST', subject: 'Happy birthday, {{petName}}!', body: 'Happy birthday to {{petName}} from all of us at {{clinicName}}! 🎉' }],
    },
  },
  {
    key: 'vaccine-due',
    icon: 'syringe',
    automation: {
      name: 'Vaccination due in a week',
      description: 'Seven days before a vaccination or care is due, at 10:00.',
      isActive: true,
      trigger: 'CARE_DUE',
      offset: 7,
      atHour: 10,
      conditions: [],
      steps: [{ type: 'SEND_MESSAGE', channel: 'BEST', subject: '{{petName}}: {{careName}} due on {{dueDate}}', body: 'Hello {{clientName}}, {{petName}}’s {{careName}} is due on {{dueDate}}. Reply or call {{clinicPhone}} to book.' }],
    },
  },
  {
    key: 'big-payment',
    icon: 'mail',
    automation: {
      name: 'Tell the manager about large payments',
      description: 'Email the clinic manager when a payment of 50,000 or more is received.',
      isActive: true,
      trigger: 'PAYMENT_RECEIVED',
      conditions: [{ field: 'amountAtLeast', op: 'IS', values: ['5000000'] }],
      steps: [{ type: 'EMAIL_TEAM', to: 'manager@example.com', subject: 'Payment of {{amount}} received', body: '{{clientName}} paid {{amount}} (receipt {{receiptNumber}}). Still owed: {{balance}}.' }],
    },
  },
];

// ───────────────────────────── Email connection ─────────────────────────────

export const EMAIL_PROVIDERS = ['GMAIL', 'OUTLOOK', 'SMTP'] as const;
export type EmailProvider = (typeof EMAIL_PROVIDERS)[number];

/** Server settings used when a mailbox is connected with an app password. */
export const EMAIL_SMTP_PRESETS: Record<'GMAIL' | 'OUTLOOK', { host: string; port: number; secure: boolean }> = {
  GMAIL: { host: 'smtp.gmail.com', port: 465, secure: true },
  OUTLOOK: { host: 'smtp.office365.com', port: 587, secure: false },
};

export const emailSmtpConnectSchema = z.object({
  provider: z.enum(EMAIL_PROVIDERS),
  email: z.string().trim().toLowerCase().email('Enter the email address'),
  fromName: z.string().trim().max(120).nullish(),
  /** Defaults to the provider's server for Gmail and Outlook. */
  host: z.string().trim().max(200).nullish(),
  port: z.coerce.number().int().min(1).max(65535).nullish(),
  secure: z.boolean().nullish(),
  /** Defaults to the email address. */
  username: z.string().trim().max(200).nullish(),
  password: z.string().min(1, 'Enter the password or app password').max(500),
});
export type EmailSmtpConnectInput = z.infer<typeof emailSmtpConnectSchema>;

export const emailSettingsSchema = z.object({
  fromName: z.string().trim().max(120).nullish(),
  isActive: z.boolean(),
});
