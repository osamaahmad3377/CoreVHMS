import { z } from 'zod';
import { CLIENT_NOTIFICATION_EVENTS, type ClientNotificationEvent } from './enums';

/**
 * WhatsApp Business Platform (Meta Cloud API) — the parts shared by the API and the settings screen:
 * connection and template-link forms, the values each kind of message can put into a template, and
 * turning a local phone number into the international form WhatsApp needs.
 */

export const WHATSAPP_SEND_POLICIES = ['PREFERRED', 'ALL_MOBILE'] as const;
export type WhatsAppSendPolicy = (typeof WHATSAPP_SEND_POLICIES)[number];

/** Kinds of message a clinic can send by WhatsApp (those that are only ever emailed are left out). */
export const WHATSAPP_PURPOSES = ['APPOINTMENT_REMINDER', 'CARE_REMINDER', 'CARE_OVERDUE', ...CLIENT_NOTIFICATION_EVENTS, 'GENERAL', 'AUTOMATION'] as const;
export type WhatsAppPurpose = (typeof WHATSAPP_PURPOSES)[number];

export const WHATSAPP_PURPOSE_LABELS: Record<WhatsAppPurpose, { title: string; text: string }> = {
  APPOINTMENT_REMINDER: { title: 'Appointment reminders', text: 'Sent before a booked appointment.' },
  CARE_REMINDER: { title: 'Vaccination & care due', text: 'Vaccinations, deworming and checks coming up.' },
  CARE_OVERDUE: { title: 'Vaccination & care overdue', text: 'When something due has been missed.' },
  GENERAL: { title: 'Messages from staff', text: 'Messages typed by staff to a client.' },
  AUTOMATION: { title: 'Automations', text: 'Messages your own automations send (Settings → Automations).' },
  ...({
    APPOINTMENT_BOOKED: { title: 'Appointment booked', text: 'Confirmation as soon as an appointment is booked.' },
    APPOINTMENT_RESCHEDULED: { title: 'Appointment moved', text: 'When the date or time of an appointment changes.' },
    APPOINTMENT_CANCELLED: { title: 'Appointment cancelled', text: 'When the clinic cancels an appointment.' },
    LAB_RESULTS_READY: { title: 'Test results ready', text: 'When lab or X-ray results are finalised.' },
    PATIENT_DISCHARGED: { title: 'Discharged from hospital', text: 'When an animal goes home, with home-care instructions.' },
    PAYMENT_RECEIVED: { title: 'Payment received', text: 'A thank-you with the receipt number and anything still owed.' },
    VACCINATION_GIVEN: { title: 'Vaccination given', text: 'After a vaccination is recorded, with the next due date.' },
  } satisfies Record<ClientNotificationEvent, { title: string; text: string }>),
};

const APPOINTMENT_VARS = [
  { key: 'clientName', label: 'Client name', example: 'Ahmed Khan' },
  { key: 'petName', label: 'Animal name', example: 'Bella' },
  { key: 'appointmentTime', label: 'Date and time', example: 'Thu 23 Oct, 10:30' },
  { key: 'appointmentType', label: 'Appointment type', example: 'Vaccination' },
  { key: 'branchName', label: 'Branch', example: 'Gulberg' },
  { key: 'clinicName', label: 'Clinic name', example: 'City Vet Clinic' },
  { key: 'clinicPhone', label: 'Clinic phone', example: '042 1234567' },
];

/** The values each kind of message can fill a template's {{1}}, {{2}}… with. */
export const WHATSAPP_VARIABLES: Record<WhatsAppPurpose, { key: string; label: string; example: string }[]> = {
  APPOINTMENT_REMINDER: [
    { key: 'clientName', label: 'Client name', example: 'Ahmed Khan' },
    { key: 'petName', label: 'Animal name', example: 'Bella' },
    { key: 'appointmentTime', label: 'Date and time', example: 'Thu 23 Oct, 10:30' },
    { key: 'appointmentType', label: 'Appointment type', example: 'Vaccination' },
    { key: 'clinicName', label: 'Clinic name', example: 'City Vet Clinic' },
    { key: 'clinicPhone', label: 'Clinic phone', example: '042 1234567' },
  ],
  CARE_REMINDER: [
    { key: 'clientName', label: 'Client name', example: 'Ahmed Khan' },
    { key: 'petNames', label: 'Animal name(s)', example: 'Bella & Max' },
    { key: 'itemsShort', label: 'What is due', example: 'Rabies vaccination' },
    { key: 'dueDate', label: 'Due date', example: '30 Oct 2026' },
    { key: 'clinicName', label: 'Clinic name', example: 'City Vet Clinic' },
    { key: 'clinicPhone', label: 'Clinic phone', example: '042 1234567' },
  ],
  CARE_OVERDUE: [
    { key: 'clientName', label: 'Client name', example: 'Ahmed Khan' },
    { key: 'petNames', label: 'Animal name(s)', example: 'Bella & Max' },
    { key: 'itemsShort', label: 'What is overdue', example: 'Rabies vaccination' },
    { key: 'dueDate', label: 'Was due on', example: '1 Oct 2026' },
    { key: 'clinicName', label: 'Clinic name', example: 'City Vet Clinic' },
    { key: 'clinicPhone', label: 'Clinic phone', example: '042 1234567' },
  ],
  GENERAL: [
    { key: 'clientName', label: 'Client name', example: 'Ahmed Khan' },
    { key: 'body', label: 'The message text', example: 'Bella is ready to be collected.' },
    { key: 'clinicName', label: 'Clinic name', example: 'City Vet Clinic' },
  ],
  AUTOMATION: [
    { key: 'clientName', label: 'Client name', example: 'Ahmed Khan' },
    { key: 'body', label: 'The message text', example: 'Thank you for bringing Bella in today.' },
    { key: 'petName', label: 'Animal name', example: 'Bella' },
    { key: 'clinicName', label: 'Clinic name', example: 'City Vet Clinic' },
  ],
  APPOINTMENT_BOOKED: [...APPOINTMENT_VARS, { key: 'manageLink', label: 'Change/cancel link (online bookings)', example: 'https://clinic.example/book/manage/…' }],
  APPOINTMENT_RESCHEDULED: APPOINTMENT_VARS,
  APPOINTMENT_CANCELLED: APPOINTMENT_VARS,
  LAB_RESULTS_READY: [
    { key: 'clientName', label: 'Client name', example: 'Ahmed Khan' },
    { key: 'petName', label: 'Animal name', example: 'Bella' },
    { key: 'testNames', label: 'Tests', example: 'Complete blood count, X-ray' },
    { key: 'clinicName', label: 'Clinic name', example: 'City Vet Clinic' },
    { key: 'clinicPhone', label: 'Clinic phone', example: '042 1234567' },
  ],
  PATIENT_DISCHARGED: [
    { key: 'clientName', label: 'Client name', example: 'Ahmed Khan' },
    { key: 'petName', label: 'Animal name', example: 'Bella' },
    { key: 'homeCare', label: 'Home-care instructions', example: 'Rest for 3 days, tablets twice daily with food' },
    { key: 'followUpDate', label: 'Check-up date', example: '30 Oct 2026' },
    { key: 'clinicName', label: 'Clinic name', example: 'City Vet Clinic' },
    { key: 'clinicPhone', label: 'Clinic phone', example: '042 1234567' },
  ],
  PAYMENT_RECEIVED: [
    { key: 'clientName', label: 'Client name', example: 'Ahmed Khan' },
    { key: 'amount', label: 'Amount paid', example: 'Rs 2,500' },
    { key: 'receiptNumber', label: 'Receipt number', example: 'RCT-000123' },
    { key: 'paymentDate', label: 'Date', example: '22 Oct 2026' },
    { key: 'balance', label: 'Still owed', example: 'Rs 0' },
    { key: 'clinicName', label: 'Clinic name', example: 'City Vet Clinic' },
  ],
  VACCINATION_GIVEN: [
    { key: 'clientName', label: 'Client name', example: 'Ahmed Khan' },
    { key: 'petName', label: 'Animal name', example: 'Bella' },
    { key: 'vaccineName', label: 'Vaccination', example: 'Rabies vaccination' },
    { key: 'givenDate', label: 'Date given', example: '22 Oct 2026' },
    { key: 'nextDueDate', label: 'Next due', example: '22 Oct 2027' },
    { key: 'clinicName', label: 'Clinic name', example: 'City Vet Clinic' },
  ],
};

const digits = (s: string) => s.replace(/\D/g, '');

/** Country calling codes for the countries the clinics work in (and their neighbours). */
const CALLING_CODES: Record<string, string> = { PK: '92', AU: '61', NZ: '64', GB: '44', AE: '971', SA: '966', QA: '974', IN: '91', US: '1', CA: '1' };

/**
 * A phone number as WhatsApp wants it: country code and number, digits only ("0300 1234567" in Pakistan →
 * "923001234567"; "0412 345 678" in Australia → "61412345678"). Null when it cannot be a mobile number.
 */
export function toWhatsAppNumber(phone: string | null | undefined, country: string | null | undefined): string | null {
  if (!phone) return null;
  const raw = phone.trim();
  let n: string;
  if (raw.startsWith('+')) n = digits(raw);
  else if (raw.startsWith('00')) n = digits(raw).slice(2);
  else {
    const d = digits(raw);
    const cc = CALLING_CODES[(country ?? '').toUpperCase()];
    if (d.startsWith('0') && cc) n = cc + d.replace(/^0+/, '');
    else if (cc && d.startsWith(cc) && d.length > 10) n = d;
    else if (cc && d.length >= 8 && d.length <= 10) n = cc + d;
    else n = d;
  }
  return n.length >= 10 && n.length <= 15 ? n : null;
}

/** A template value WhatsApp accepts: one line, no long runs of spaces, never empty. */
export function whatsAppParam(value: unknown): string {
  const s = String(value ?? '')
    .replace(/[\r\n\t]+/g, ' · ')
    .replace(/ {4,}/g, '   ')
    .trim();
  return (s || '–').slice(0, 1024);
}

/** {{1}}, {{2}}… used in a template's text, in order. */
export function templateParamCount(text: string | null | undefined): number {
  const nums = [...(text ?? '').matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1]));
  return nums.length ? Math.max(...nums) : 0;
}

export const whatsappConnectSchema = z.object({
  phoneNumberId: z.string().trim().regex(/^\d{6,25}$/, 'The Phone number ID is a long number from WhatsApp Manager → API setup'),
  businessAccountId: z.string().trim().regex(/^\d{6,25}$/, 'The WhatsApp Business Account ID is a long number from WhatsApp Manager'),
  /** Leave empty when editing to keep the saved token. */
  accessToken: z.string().trim().min(20, 'Paste the permanent access token (System User token)').max(1000).optional().or(z.literal('')),
  /** Meta app secret, used to check that webhook calls really come from Meta. */
  appSecret: z.string().trim().max(200).optional().or(z.literal('')),
});

export const whatsappSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  sendPolicy: z.enum(WHATSAPP_SEND_POLICIES).optional(),
  fallbackToEmail: z.boolean().optional(),
});

export const whatsappTemplateLinkSchema = z.object({
  purpose: z.enum(WHATSAPP_PURPOSES),
  /** Empty = no template (the message goes as plain text, which WhatsApp only allows within 24 hours of the client's last message). */
  templateName: z.string().trim().max(512).optional().or(z.literal('')),
  language: z.string().trim().max(15).optional().or(z.literal('')),
  params: z.array(z.string().max(40)).max(20).default([]),
});

export const whatsappTestSchema = z.object({
  to: z.string().trim().min(6, 'Enter the mobile number to send the test to').max(32),
  /** Send this kind of message's linked template with example values (default: Meta's hello_world template). */
  purpose: z.enum(WHATSAPP_PURPOSES).optional(),
});

/** Settings → Client notifications: per event, by WhatsApp (when connected) and/or by email. */
export const clientNotificationRuleSchema = z.object({
  event: z.enum(CLIENT_NOTIFICATION_EVENTS),
  whatsapp: z.boolean(),
  email: z.boolean(),
});
