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
  'PATIENT_ADMITTED',
  'SURGERY_UPCOMING',
  'INVOICE_OVERDUE',
  'PATIENT_LAPSED',
  'APPOINTMENT_CHECKED_IN',
  'PRESCRIPTION_DISPENSED',
  'SURGERY_COMPLETED',
  'ESTIMATE_SENT',
] as const;
export type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number];

export type TriggerGroup = 'Appointments' | 'Clinical' | 'Money' | 'Clients & pets';

export interface TriggerInfo {
  label: string;
  /** "When …" sentence. */
  when: string;
  group: TriggerGroup;
  /** Happens at a time worked out from a date (checked every few minutes), not at a moment in the app. */
  timed?: 'HOURS_BEFORE' | 'DAYS_BEFORE' | 'DAYS_AFTER' | 'MONTHS_SINCE' | 'ON_DAY';
  /** "Check" steps that make sense for this trigger. */
  checks: AutomationCheck[];
  variables: string[];
  /** Conditions that make sense for this trigger. */
  conditions: AutomationConditionField[];
}

const CLIENT_VARS = ['clientName', 'clinicName', 'clinicPhone', 'bookingLine'];
const APPT_VARS = [...CLIENT_VARS, 'petName', 'species', 'appointmentTime', 'appointmentDate', 'appointmentType', 'branchName', 'vetName'];
const PET_CONDS: AutomationConditionField[] = ['species', 'patientSex', 'ageAtLeast', 'ageUnder'];
const APPT_CONDS: AutomationConditionField[] = ['species', 'branch', 'appointmentType', 'contact', 'firstVisit', 'patientSex', 'ageAtLeast', 'ageUnder'];

export const TRIGGER_INFO: Record<AutomationTrigger, TriggerInfo> = {
  APPOINTMENT_BOOKED: { label: 'Appointment booked', when: 'an appointment is booked', group: 'Appointments', variables: APPT_VARS, conditions: [...APPT_CONDS, 'source'], checks: [] },
  APPOINTMENT_RESCHEDULED: { label: 'Appointment moved', when: 'an appointment is moved to another time', group: 'Appointments', variables: APPT_VARS, conditions: APPT_CONDS, checks: [] },
  APPOINTMENT_CANCELLED: { label: 'Appointment cancelled', when: 'an appointment is cancelled', group: 'Appointments', variables: APPT_VARS, conditions: APPT_CONDS, checks: ['NOT_BOOKED'] },
  APPOINTMENT_UPCOMING: { label: 'Before an appointment', when: 'an appointment is coming up', group: 'Appointments', timed: 'HOURS_BEFORE', variables: APPT_VARS, conditions: APPT_CONDS, checks: [] },
  APPOINTMENT_COMPLETED: { label: 'Visit finished', when: 'a visit is finished', group: 'Appointments', variables: APPT_VARS, conditions: APPT_CONDS, checks: ['NOT_BOOKED'] },
  APPOINTMENT_NO_SHOW: { label: 'Missed appointment', when: 'a client misses an appointment', group: 'Appointments', variables: APPT_VARS, conditions: APPT_CONDS, checks: ['NOT_BOOKED'] },
  APPOINTMENT_CHECKED_IN: { label: 'Checked in', when: 'a client checks in (front desk, walk-in or tablet)', group: 'Appointments', variables: [...APPT_VARS, 'tokenNumber'], conditions: APPT_CONDS, checks: [] },
  SURGERY_UPCOMING: { label: 'Before a surgery', when: 'a surgery is coming up', group: 'Clinical', timed: 'HOURS_BEFORE', variables: [...CLIENT_VARS, 'petName', 'species', 'procedureName', 'surgeryTime', 'surgeryDate', 'branchName'], conditions: ['branch', 'contact', ...PET_CONDS], checks: [] },
  SURGERY_COMPLETED: { label: 'Surgery finished', when: 'a surgery is finished', group: 'Clinical', variables: [...CLIENT_VARS, 'petName', 'species', 'procedureName', 'surgeryDate', 'branchName'], conditions: ['branch', 'contact', ...PET_CONDS], checks: ['NOT_BOOKED'] },
  PRESCRIPTION_DISPENSED: { label: 'Medicine dispensed', when: 'medicine is dispensed for an animal', group: 'Clinical', variables: [...CLIENT_VARS, 'petName', 'species', 'medicines'], conditions: ['branch', 'contact', ...PET_CONDS], checks: ['NOT_BOOKED'] },
  PATIENT_ADMITTED: { label: 'Admitted to hospital', when: 'an animal is admitted to the hospital', group: 'Clinical', variables: [...CLIENT_VARS, 'petName', 'species', 'branchName', 'vetName'], conditions: ['branch', 'contact', ...PET_CONDS], checks: [] },
  LAB_RESULTS_READY: { label: 'Lab results ready', when: 'lab or X-ray results are released', group: 'Clinical', variables: [...CLIENT_VARS, 'petName', 'species', 'testNames'], conditions: ['branch', 'contact', ...PET_CONDS], checks: [] },
  PATIENT_DISCHARGED: { label: 'Animal goes home', when: 'an animal is discharged home from the hospital', group: 'Clinical', variables: [...CLIENT_VARS, 'petName', 'species', 'homeCare', 'followUpDate'], conditions: ['branch', 'contact', ...PET_CONDS], checks: ['NOT_BOOKED'] },
  VACCINATION_GIVEN: { label: 'Vaccination given', when: 'a vaccination is given here', group: 'Clinical', variables: [...CLIENT_VARS, 'petName', 'species', 'vaccineName', 'givenDate', 'nextDueDate'], conditions: ['contact', ...PET_CONDS], checks: [] },
  CARE_DUE: { label: 'Vaccination or care due', when: 'a vaccination or other care is due', group: 'Clinical', timed: 'DAYS_BEFORE', variables: [...CLIENT_VARS, 'petName', 'species', 'careName', 'dueDate'], conditions: ['contact', ...PET_CONDS], checks: ['STILL_DUE', 'NOT_BOOKED'] },
  PAYMENT_RECEIVED: { label: 'Payment received', when: 'a payment is received', group: 'Money', variables: [...CLIENT_VARS, 'amount', 'receiptNumber', 'paymentDate', 'balance'], conditions: ['amountAtLeast', 'branch', 'contact'], checks: [] },
  ESTIMATE_SENT: { label: 'Estimate given', when: 'an estimate (quote) is given to a client', group: 'Money', variables: [...CLIENT_VARS, 'petName', 'estimateNumber', 'estimateTotal', 'validUntil'], conditions: ['amountAtLeast', 'branch', 'contact'], checks: ['ESTIMATE_OPEN'] },
  INVOICE_OVERDUE: { label: 'Invoice overdue', when: 'an invoice is overdue', group: 'Money', timed: 'DAYS_AFTER', variables: [...CLIENT_VARS, 'invoiceNumber', 'amountDue', 'invoiceTotal', 'dueDate'], conditions: ['amountAtLeast', 'branch', 'contact'], checks: ['STILL_UNPAID'] },
  CLIENT_REGISTERED: { label: 'New client', when: 'a new client is registered', group: 'Clients & pets', variables: CLIENT_VARS, conditions: ['branch', 'contact'], checks: ['NOT_BOOKED'] },
  PET_BIRTHDAY: { label: 'Pet’s birthday', when: 'it is a pet’s birthday', group: 'Clients & pets', timed: 'ON_DAY', variables: [...CLIENT_VARS, 'petName', 'species', 'age'], conditions: ['contact', ...PET_CONDS], checks: [] },
  PATIENT_LAPSED: { label: 'Not seen for a while', when: 'an animal has not been seen for a while', group: 'Clients & pets', timed: 'MONTHS_SINCE', variables: [...CLIENT_VARS, 'petName', 'species', 'lastVisitDate', 'monthsSince'], conditions: ['branch', 'contact', ...PET_CONDS], checks: ['NOT_BOOKED'] },
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
  bookingLine: { label: 'Book-online link', example: 'Book online: https://clinic.example/book/happy-paws' },
  procedureName: { label: 'Procedure', example: 'Spay' },
  surgeryTime: { label: 'Surgery date & time', example: 'Wed 29 Oct, 09:00' },
  surgeryDate: { label: 'Surgery date', example: 'Wed 29 Oct' },
  invoiceNumber: { label: 'Invoice number', example: 'INV-000123' },
  amountDue: { label: 'Amount still owed', example: 'Rs 6,500' },
  invoiceTotal: { label: 'Invoice total', example: 'Rs 12,000' },
  lastVisitDate: { label: 'Last visit', example: '14 Oct 2025' },
  monthsSince: { label: 'Months since last visit', example: '12' },
  tokenNumber: { label: 'Token number', example: '12' },
  medicines: { label: 'Medicines', example: 'Amoxicillin 250 mg tablets, Meloxicam oral suspension' },
  estimateNumber: { label: 'Estimate number', example: 'EST-000045' },
  estimateTotal: { label: 'Estimate total', example: 'Rs 35,000' },
  validUntil: { label: 'Valid until', example: '9 Nov 2026' },
};

// ───────────────────────────── Checks ─────────────────────────────

/** "Only continue if…" — checked when the step is reached (usually after a wait). */
export const AUTOMATION_CHECKS = ['NOT_BOOKED', 'STILL_UNPAID', 'STILL_DUE', 'ESTIMATE_OPEN'] as const;
export type AutomationCheck = (typeof AUTOMATION_CHECKS)[number];
export const CHECK_INFO: Record<AutomationCheck, { label: string; stopped: string }> = {
  NOT_BOOKED: { label: 'the client has not booked another appointment', stopped: 'The client has booked — no need to continue' },
  STILL_UNPAID: { label: 'the invoice is still not paid', stopped: 'The invoice has been paid — no need to continue' },
  STILL_DUE: { label: 'the care is still due (not given yet)', stopped: 'The care was given or cancelled — no need to continue' },
  ESTIMATE_OPEN: { label: 'the estimate has not been accepted or declined yet', stopped: 'The client has answered the estimate — no need to continue' },
};

export function sampleVars(trigger: AutomationTrigger) {
  return Object.fromEntries(TRIGGER_INFO[trigger].variables.map((v) => [v, AUTOMATION_VARIABLES[v]?.example ?? '']));
}

// ───────────────────────────── Conditions ─────────────────────────────

export const AUTOMATION_CONDITION_FIELDS = ['species', 'branch', 'appointmentType', 'contact', 'amountAtLeast', 'source', 'patientSex', 'ageAtLeast', 'ageUnder', 'firstVisit'] as const;
export type AutomationConditionField = (typeof AUTOMATION_CONDITION_FIELDS)[number];

export const CONDITION_INFO: Record<AutomationConditionField, { label: string }> = {
  species: { label: 'Species' },
  branch: { label: 'Branch' },
  appointmentType: { label: 'Appointment type' },
  contact: { label: 'Client can be reached by' },
  amountAtLeast: { label: 'Amount paid at least' },
  source: { label: 'Booked' },
  patientSex: { label: 'Sex' },
  ageAtLeast: { label: 'Age at least (years)' },
  ageUnder: { label: 'Age under (years)' },
  firstVisit: { label: 'First visit' },
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
  /** MALE or FEMALE (neutered or not). */
  patientSex?: 'MALE' | 'FEMALE' | null;
  ageYears?: number | null;
  /** The client's first visit to the clinic. */
  firstVisit?: boolean;
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
      case 'patientSex':
        return is(!!f.patientSex && c.values.includes(f.patientSex));
      case 'ageAtLeast':
        return is(f.ageYears != null && f.ageYears >= Number(c.values[0]));
      case 'ageUnder':
        return is(f.ageYears != null && f.ageYears < Number(c.values[0]));
      case 'firstVisit':
        return is(c.values.includes(f.firstVisit ? 'FIRST' : 'RETURNING'));
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
    type: z.literal('WAIT_UNTIL'),
    /** Hour of the day, clinic time. */
    hour: z.coerce.number().int().min(0).max(23),
    /** Skip Saturday and Sunday (or Friday for clinics that close on Fridays — set by `skipDays`). */
    skipDays: z.array(z.coerce.number().int().min(0).max(6)).max(6).default([]),
  }),
  z.object({
    type: z.literal('CHECK'),
    check: z.enum(AUTOMATION_CHECKS),
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
    /** Hours before (appointment, surgery), days before (care due), days after (invoice due), or months since the last visit. */
    offset: z.coerce.number().int().min(0).max(720).nullish(),
    /** Timed triggers: the hour (0–23, clinic time) to send; null = as soon as due. */
    atHour: z.coerce.number().int().min(0).max(23).nullish(),
    /** Messages only between these hours (clinic time); outside them they wait. Null = any time. */
    sendFromHour: z.coerce.number().int().min(0).max(23).nullish(),
    sendToHour: z.coerce.number().int().min(1).max(24).nullish(),
    /** Not again for the same client within this many days (any record). */
    cooldownDays: z.coerce.number().int().min(1).max(365).nullish(),
    conditions: z.array(automationConditionSchema).max(10).default([]),
    steps: z.array(automationStepSchema).min(1, 'Add at least one step').max(12),
  })
  .superRefine((a, ctx) => {
    if (a.sendFromHour != null && a.sendToHour != null && a.sendToHour <= a.sendFromHour) ctx.addIssue({ code: 'custom', path: ['sendToHour'], message: 'The sending hours must end after they start' });
    if (!a.steps.some((s) => s.type !== 'WAIT' && s.type !== 'WAIT_UNTIL' && s.type !== 'CHECK')) ctx.addIssue({ code: 'custom', path: ['steps'], message: 'Add something to do (a message or a task), not only waits and checks' });
    const last = a.steps[a.steps.length - 1]?.type;
    if (last === 'WAIT' || last === 'WAIT_UNTIL' || last === 'CHECK') ctx.addIssue({ code: 'custom', path: ['steps'], message: `A ${last === 'CHECK' ? 'check' : 'wait'} at the end does nothing — remove it or add a step after it` });
    a.steps.forEach((s, i) => {
      if (s.type === 'CHECK' && !TRIGGER_INFO[a.trigger].checks.includes(s.check)) ctx.addIssue({ code: 'custom', path: ['steps', i], message: `“Only continue if ${CHECK_INFO[s.check].label}” does not apply to ${TRIGGER_INFO[a.trigger].label.toLowerCase()}` });
    });
    const timed = TRIGGER_INFO[a.trigger].timed;
    if (timed && timed !== 'ON_DAY' && a.offset == null) ctx.addIssue({ code: 'custom', path: ['offset'], message: timed === 'HOURS_BEFORE' ? 'Say how many hours before' : timed === 'MONTHS_SINCE' ? 'Say after how many months' : 'Say how many days' });
  });
export type AutomationInput = z.infer<typeof automationSchema>;
/** As typed by a person or a recipe (defaults not yet applied). */
export type AutomationDraft = z.input<typeof automationSchema>;

export const waitMs = (s: { amount: number; unit: 'MINUTES' | 'HOURS' | 'DAYS' }) => s.amount * (s.unit === 'MINUTES' ? 60_000 : s.unit === 'HOURS' ? 3_600_000 : 86_400_000);

// ───────────────────────────── Recipes ─────────────────────────────

/** Ready-made automations the clinic starts from (switched off until saved). */
export const AUTOMATION_RECIPES: { key: string; icon: string; automation: AutomationDraft }[] = [
  {
    key: 'rescheduled',
    icon: 'calendar',
    automation: {
      name: 'Appointment moved',
      description: 'Tells the client when their appointment time changes.',
      isActive: true,
      trigger: 'APPOINTMENT_RESCHEDULED',
      conditions: [],
      steps: [{ type: 'SEND_MESSAGE', channel: 'BEST', subject: '{{petName}}’s appointment has moved', body: 'Hello {{clientName}}, {{petName}}’s appointment at {{clinicName}} is now on {{appointmentTime}} with {{vetName}}. If this time does not suit you, reply here.' }],
    },
  },
  {
    key: 'cancelled',
    icon: 'calendar',
    automation: {
      name: 'Appointment cancelled',
      description: 'Tells the client when an appointment is cancelled.',
      isActive: true,
      trigger: 'APPOINTMENT_CANCELLED',
      conditions: [],
      steps: [{ type: 'SEND_MESSAGE', channel: 'BEST', subject: 'Appointment cancelled', body: 'Hello {{clientName}}, the appointment for {{petName}} on {{appointmentTime}} has been cancelled. We would be happy to find you another time.\n{{bookingLine}}' }],
    },
  },
  {
    key: 'results-ready',
    icon: 'flask',
    automation: {
      name: 'Results are ready',
      description: 'When lab or X-ray results are released.',
      isActive: true,
      trigger: 'LAB_RESULTS_READY',
      conditions: [],
      steps: [{ type: 'SEND_MESSAGE', channel: 'BEST', subject: '{{petName}}’s results are ready', body: 'Hello {{clientName}}, the results for {{petName}} ({{testNames}}) are ready. Your vet will go through them with you. Reply here or call {{clinicPhone}} if you need anything.' }],
    },
  },
  {
    key: 'home-today',
    icon: 'home',
    automation: {
      name: 'Animal goes home',
      description: 'Straight away when an animal is discharged.',
      isActive: true,
      trigger: 'PATIENT_DISCHARGED',
      conditions: [],
      steps: [{ type: 'SEND_MESSAGE', channel: 'BEST', subject: '{{petName}} is ready to go home', body: 'Hello {{clientName}}, {{petName}} is ready to go home from {{clinicName}}. {{homeCare}} Reply here or call {{clinicPhone}} if you need anything.' }],
    },
  },
  {
    key: 'payment',
    icon: 'card',
    automation: {
      name: 'Payment received',
      description: 'A receipt message when a payment is taken.',
      isActive: true,
      trigger: 'PAYMENT_RECEIVED',
      conditions: [],
      steps: [{ type: 'SEND_MESSAGE', channel: 'BEST', subject: 'Payment received — {{receiptNumber}}', body: 'Hello {{clientName}}, thank you, we received {{amount}} on {{paymentDate}} (receipt {{receiptNumber}}). Still owed: {{balance}}.' }],
    },
  },
  {
    key: 'vaccinated',
    icon: 'syringe',
    automation: {
      name: 'Vaccination done',
      description: 'After a vaccination: what was given and when it is next due.',
      isActive: true,
      trigger: 'VACCINATION_GIVEN',
      conditions: [],
      steps: [{ type: 'SEND_MESSAGE', channel: 'BEST', subject: '{{petName}}: {{vaccineName}} done', body: 'Hello {{clientName}}, {{petName}} had {{vaccineName}} on {{givenDate}}. Next due: {{nextDueDate}} — we will remind you before then.' }],
    },
  },
  {
    key: 'booked',
    icon: 'calendar',
    automation: {
      name: 'Appointment booked confirmation',
      description: 'As soon as an appointment is booked: the date, time and vet.',
      isActive: true,
      trigger: 'APPOINTMENT_BOOKED',
      conditions: [],
      steps: [{ type: 'SEND_MESSAGE', channel: 'BEST', subject: 'Appointment booked for {{petName}}', body: 'Hello {{clientName}}, {{petName}} is booked at {{clinicName}}, {{branchName}} on {{appointmentTime}} with {{vetName}} ({{appointmentType}}). Reply here or call {{clinicPhone}} if you need to change it.' }],
    },
  },
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
      description: 'An hour after a missed appointment, invite the client to book again; if they have not booked 3 days later, a call task.',
      isActive: true,
      trigger: 'APPOINTMENT_NO_SHOW',
      conditions: [],
      steps: [
        { type: 'WAIT', amount: 1, unit: 'HOURS' },
        { type: 'SEND_MESSAGE', channel: 'BEST', subject: 'We missed {{petName}} today', body: 'Hello {{clientName}}, we missed {{petName}} at {{clinicName}} today. Reply here or call {{clinicPhone}} to book another time.\n{{bookingLine}}' },
        { type: 'WAIT', amount: 3, unit: 'DAYS' },
        { type: 'CHECK', check: 'NOT_BOOKED' },
        { type: 'CREATE_TASK', title: 'Call {{clientName}} to rebook {{petName}}', dueInDays: 0 },
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
  {
    key: 'invoice-overdue',
    icon: 'receipt',
    automation: {
      name: 'Overdue invoice reminder',
      description: 'A polite reminder 7 days after the due date; if still unpaid a week later, a second reminder and a call task.',
      isActive: true,
      trigger: 'INVOICE_OVERDUE',
      offset: 7,
      atHour: 11,
      conditions: [],
      steps: [
        { type: 'SEND_MESSAGE', channel: 'BEST', subject: 'Invoice {{invoiceNumber}}: {{amountDue}} still to pay', body: 'Hello {{clientName}}, a friendly reminder from {{clinicName}}: {{amountDue}} is still to pay on invoice {{invoiceNumber}} (due {{dueDate}}). If you have already paid, thank you and please ignore this. Questions? Call {{clinicPhone}}.' },
        { type: 'WAIT', amount: 7, unit: 'DAYS' },
        { type: 'CHECK', check: 'STILL_UNPAID' },
        { type: 'SEND_MESSAGE', channel: 'BEST', subject: 'Second reminder: invoice {{invoiceNumber}}', body: 'Hello {{clientName}}, invoice {{invoiceNumber}} from {{clinicName}} still shows {{amountDue}} to pay. Please call {{clinicPhone}} if you would like to talk about it.' },
        { type: 'CREATE_TASK', title: 'Call {{clientName}} about invoice {{invoiceNumber}} ({{amountDue}})', dueInDays: 0 },
      ],
    },
  },
  {
    key: 'pre-surgery',
    icon: 'scissors',
    automation: {
      name: 'Before a surgery',
      description: 'The day before: time, place and a reminder to follow the vet’s food and water instructions.',
      isActive: true,
      trigger: 'SURGERY_UPCOMING',
      offset: 24,
      conditions: [],
      steps: [{ type: 'SEND_MESSAGE', channel: 'BEST', subject: '{{petName}}’s {{procedureName}} on {{surgeryTime}}', body: 'Hello {{clientName}}, {{petName}}’s {{procedureName}} at {{clinicName}}, {{branchName}} is on {{surgeryTime}}. Please follow the food and water instructions your vet gave you, and call {{clinicPhone}} with any questions.' }],
    },
  },
  {
    key: 'admitted',
    icon: 'bed',
    automation: {
      name: 'Admitted to hospital',
      description: 'Reassure the owner when their animal is admitted.',
      isActive: true,
      trigger: 'PATIENT_ADMITTED',
      conditions: [],
      steps: [{ type: 'SEND_MESSAGE', channel: 'BEST', subject: '{{petName}} is in our care', body: 'Hello {{clientName}}, {{petName}} has been admitted at {{clinicName}}, {{branchName}}. Our team will keep you updated. You can call {{clinicPhone}} at any time.' }],
    },
  },
  {
    key: 'recall',
    icon: 'repeat',
    automation: {
      name: 'Haven’t seen you for a year',
      description: '12 months after the last visit (and nothing booked): invite the client back; once more two weeks later if they still have not booked.',
      isActive: true,
      trigger: 'PATIENT_LAPSED',
      offset: 12,
      atHour: 10,
      conditions: [],
      steps: [
        { type: 'SEND_MESSAGE', channel: 'BEST', subject: 'Time for {{petName}}’s check-up', body: 'Hello {{clientName}}, it has been {{monthsSince}} months since we last saw {{petName}} at {{clinicName}}. A yearly check-up keeps problems small. Reply or call {{clinicPhone}} to book.\n{{bookingLine}}' },
        { type: 'WAIT', amount: 14, unit: 'DAYS' },
        { type: 'CHECK', check: 'NOT_BOOKED' },
        { type: 'SEND_MESSAGE', channel: 'BEST', subject: 'A gentle reminder for {{petName}}', body: 'Hello {{clientName}}, just a gentle reminder that {{petName}} is due a check-up at {{clinicName}}. Call {{clinicPhone}} or reply to book.\n{{bookingLine}}' },
      ],
    },
  },
  {
    key: 'checked-in',
    icon: 'ticket',
    automation: {
      name: 'Your token number',
      description: 'As soon as a client checks in, send their token number so they can wait comfortably.',
      isActive: true,
      trigger: 'APPOINTMENT_CHECKED_IN',
      conditions: [],
      steps: [{ type: 'SEND_MESSAGE', channel: 'WHATSAPP', subject: 'Token {{tokenNumber}}', body: 'Welcome to {{clinicName}}, {{clientName}}! {{petName}}’s token number is {{tokenNumber}}. Please take a seat — we will call you on the screen.' }],
    },
  },
  {
    key: 'medicine',
    icon: 'pill',
    automation: {
      name: 'How is the medicine going?',
      description: 'Two days after medicine is dispensed, check that the owner is managing — at 11:00, not at night.',
      isActive: true,
      trigger: 'PRESCRIPTION_DISPENSED',
      conditions: [],
      sendFromHour: 9,
      sendToHour: 20,
      steps: [
        { type: 'WAIT', amount: 2, unit: 'DAYS' },
        { type: 'WAIT_UNTIL', hour: 11, skipDays: [] },
        { type: 'SEND_MESSAGE', channel: 'BEST', subject: 'How is {{petName}} doing?', body: 'Hello {{clientName}}, how is {{petName}} getting on with the medicine ({{medicines}})? If you have any trouble giving it, reply here or call {{clinicPhone}}.' },
      ],
    },
  },
  {
    key: 'after-surgery',
    icon: 'scissors',
    automation: {
      name: 'After a surgery',
      description: 'The morning after surgery: a message to the owner and a check-up call task for the vet.',
      isActive: true,
      trigger: 'SURGERY_COMPLETED',
      conditions: [],
      steps: [
        { type: 'WAIT_UNTIL', hour: 10, skipDays: [] },
        { type: 'SEND_MESSAGE', channel: 'BEST', subject: 'How is {{petName}} after the {{procedureName}}?', body: 'Hello {{clientName}}, we hope {{petName}} had a good night after the {{procedureName}}. If anything worries you, reply here or call {{clinicPhone}}.' },
        { type: 'CREATE_TASK', title: 'Post-op call for {{petName}} ({{procedureName}})', dueInDays: 0 },
      ],
    },
  },
  {
    key: 'estimate',
    icon: 'file-text',
    automation: {
      name: 'Follow up an estimate',
      description: 'Three days after an estimate is given, if the client has not answered: a friendly follow-up and a call task.',
      isActive: true,
      trigger: 'ESTIMATE_SENT',
      conditions: [],
      sendFromHour: 9,
      sendToHour: 19,
      steps: [
        { type: 'WAIT', amount: 3, unit: 'DAYS' },
        { type: 'CHECK', check: 'ESTIMATE_OPEN' },
        { type: 'SEND_MESSAGE', channel: 'BEST', subject: 'Your estimate {{estimateNumber}}', body: 'Hello {{clientName}}, do you have any questions about estimate {{estimateNumber}} ({{estimateTotal}}) for {{petName}}? It is valid until {{validUntil}}. Reply here or call {{clinicPhone}}.' },
        { type: 'CREATE_TASK', title: 'Call {{clientName}} about estimate {{estimateNumber}}', dueInDays: 1 },
      ],
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

// ───────────────────────────── Suggested wording ─────────────────────────────

export interface TriggerDefaults {
  /** Email subject. */
  subject: string;
  /** Ready-to-use message in friendly plain words. */
  body: string;
  /** A sensible task for staff for this trigger. */
  taskTitle: string;
  /** Usual pause before the message (null = straight away). */
  delay: { amount: number; unit: 'MINUTES' | 'HOURS' | 'DAYS' } | null;
}

const hi = 'Hello {{clientName}}, ';
const help = ' Reply here or call {{clinicPhone}} if you need anything.';

/** What the easy creator fills in for each trigger; the client can change every word. Only uses variables the trigger has. */
export const TRIGGER_DEFAULTS: Record<AutomationTrigger, TriggerDefaults> = {
  APPOINTMENT_BOOKED: { subject: 'Appointment booked for {{petName}}', body: `${hi}{{petName}} is booked at {{clinicName}}, {{branchName}} on {{appointmentTime}} with {{vetName}} ({{appointmentType}}).${help}`, taskTitle: 'Check the booking for {{petName}}', delay: null },
  APPOINTMENT_RESCHEDULED: { subject: '{{petName}}’s appointment has moved', body: `${hi}{{petName}}’s appointment at {{clinicName}} is now on {{appointmentTime}}. If this time does not suit you, reply here.`, taskTitle: 'Call {{clientName}} about the new time', delay: null },
  APPOINTMENT_CANCELLED: { subject: 'Appointment cancelled', body: `${hi}the appointment for {{petName}} on {{appointmentTime}} has been cancelled. We would be happy to find you another time.\n{{bookingLine}}`, taskTitle: 'Offer {{clientName}} another time for {{petName}}', delay: null },
  APPOINTMENT_UPCOMING: { subject: 'Reminder: {{petName}} at {{clinicName}}', body: `${hi}a reminder that {{petName}} has an appointment on {{appointmentTime}} at {{clinicName}}, {{branchName}}.${help}`, taskTitle: 'Call {{clientName}} to confirm tomorrow', delay: null },
  APPOINTMENT_CHECKED_IN: { subject: 'Token {{tokenNumber}}', body: `Welcome to {{clinicName}}, {{clientName}}! {{petName}}’s token number is {{tokenNumber}}. Please take a seat — we will call you.`, taskTitle: 'Greet {{clientName}}', delay: null },
  APPOINTMENT_COMPLETED: { subject: 'Thank you for visiting {{clinicName}}', body: `${hi}thank you for bringing {{petName}} to {{clinicName}} today.${help}`, taskTitle: 'Call {{clientName}} to check on {{petName}}', delay: { amount: 2, unit: 'HOURS' } },
  APPOINTMENT_NO_SHOW: { subject: 'We missed {{petName}} today', body: `${hi}we missed {{petName}} at {{clinicName}} today. Would you like to book another time?\n{{bookingLine}}`, taskTitle: 'Call {{clientName}} to rebook {{petName}}', delay: { amount: 1, unit: 'HOURS' } },
  LAB_RESULTS_READY: { subject: '{{petName}}’s results are ready', body: `${hi}the results for {{petName}} ({{testNames}}) are ready. Your vet will go through them with you.${help}`, taskTitle: 'Call {{clientName}} with {{petName}}’s results', delay: null },
  PATIENT_DISCHARGED: { subject: 'How is {{petName}}?', body: `${hi}how is {{petName}} doing at home? If anything worries you, please let us know.${help}`, taskTitle: 'Call to check on {{petName}} after discharge', delay: { amount: 3, unit: 'DAYS' } },
  VACCINATION_GIVEN: { subject: '{{petName}}: {{vaccineName}} done', body: `${hi}{{petName}} had {{vaccineName}} on {{givenDate}}. Next due: {{nextDueDate}} — we will remind you before then.`, taskTitle: 'Note {{petName}}’s next vaccination', delay: null },
  CARE_DUE: { subject: '{{petName}}: {{careName}} due on {{dueDate}}', body: `${hi}{{petName}}’s {{careName}} is due on {{dueDate}}. Reply or call {{clinicPhone}} to book.\n{{bookingLine}}`, taskTitle: 'Call {{clientName}} to book {{petName}}’s {{careName}}', delay: null },
  PAYMENT_RECEIVED: { subject: 'Payment received — {{receiptNumber}}', body: `${hi}thank you, we received {{amount}} on {{paymentDate}} (receipt {{receiptNumber}}). Still owed: {{balance}}.`, taskTitle: 'Thank {{clientName}} for the payment', delay: null },
  INVOICE_OVERDUE: { subject: 'Invoice {{invoiceNumber}}: {{amountDue}} still to pay', body: `${hi}a friendly reminder: {{amountDue}} is still to pay on invoice {{invoiceNumber}} (due {{dueDate}}). If you have already paid, thank you!${help}`, taskTitle: 'Call {{clientName}} about invoice {{invoiceNumber}}', delay: null },
  ESTIMATE_SENT: { subject: 'Your estimate {{estimateNumber}}', body: `${hi}do you have any questions about estimate {{estimateNumber}} ({{estimateTotal}}) for {{petName}}? It is valid until {{validUntil}}.${help}`, taskTitle: 'Call {{clientName}} about estimate {{estimateNumber}}', delay: { amount: 3, unit: 'DAYS' } },
  CLIENT_REGISTERED: { subject: 'Welcome to {{clinicName}}', body: `${hi}welcome to {{clinicName}}! Save this number — you can message us here any time or call {{clinicPhone}}.`, taskTitle: 'Welcome {{clientName}}', delay: null },
  PET_BIRTHDAY: { subject: 'Happy birthday, {{petName}}!', body: 'Happy birthday to {{petName}} from everyone at {{clinicName}}! 🎉', taskTitle: 'Wish {{petName}} a happy birthday', delay: null },
  PATIENT_ADMITTED: { subject: '{{petName}} is in our care', body: `${hi}{{petName}} has been admitted at {{clinicName}}, {{branchName}}. Our team will keep you updated.${help}`, taskTitle: 'Update {{clientName}} on {{petName}}', delay: null },
  SURGERY_UPCOMING: { subject: '{{petName}}’s {{procedureName}} on {{surgeryTime}}', body: `${hi}{{petName}}’s {{procedureName}} at {{clinicName}} is on {{surgeryTime}}. Please follow the food and water instructions your vet gave you.${help}`, taskTitle: 'Confirm {{petName}}’s surgery with {{clientName}}', delay: null },
  SURGERY_COMPLETED: { subject: 'How is {{petName}} after the {{procedureName}}?', body: `${hi}we hope {{petName}} is resting well after the {{procedureName}}. If anything worries you, please let us know.${help}`, taskTitle: 'Post-op call for {{petName}} ({{procedureName}})', delay: { amount: 1, unit: 'DAYS' } },
  PRESCRIPTION_DISPENSED: { subject: 'How is {{petName}} doing?', body: `${hi}how is {{petName}} getting on with the medicine ({{medicines}})? If you have any trouble giving it, let us know.${help}`, taskTitle: 'Check {{petName}}’s medicine with {{clientName}}', delay: { amount: 2, unit: 'DAYS' } },
  PATIENT_LAPSED: { subject: 'Time for {{petName}}’s check-up', body: `${hi}it has been {{monthsSince}} months since we last saw {{petName}}. A yearly check-up keeps problems small.\n{{bookingLine}}`, taskTitle: 'Call {{clientName}} to book {{petName}}’s check-up', delay: null },
};

/** "When should it go out?" choices in the easy creator. */
export const EASY_DELAYS: { label: string; value: { amount: number; unit: 'MINUTES' | 'HOURS' | 'DAYS' } | null }[] = [
  { label: 'Straight away', value: null },
  { label: 'After 1 hour', value: { amount: 1, unit: 'HOURS' } },
  { label: 'After 2 hours', value: { amount: 2, unit: 'HOURS' } },
  { label: 'The next day', value: { amount: 1, unit: 'DAYS' } },
  { label: 'After 3 days', value: { amount: 3, unit: 'DAYS' } },
  { label: 'After 1 week', value: { amount: 7, unit: 'DAYS' } },
];

/** Recipes every clinic gets, switched on, the first time automations are used. */
export const BASIC_AUTOMATION_KEYS = ['booked', 'rescheduled', 'cancelled', 'reminder-24h', 'results-ready', 'home-today', 'payment', 'vaccinated', 'thank-you', 'missed', 'after-discharge', 'welcome', 'vaccine-due'] as const;
