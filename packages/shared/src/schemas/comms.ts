import { z } from 'zod';
import { CARE_KINDS, MESSAGE_CHANNELS, MESSAGE_PURPOSES, PREFERRED_TIMES } from '../enums';
import { passwordPolicy } from './auth';
import { optDate, optInt, optText, optUuid, reqText } from './common';

const optNum = (min: number, max: number) =>
  z.preprocess((v) => (v === '' ? null : v), z.coerce.number().min(min).max(max).nullish()) as z.ZodType<number | null | undefined, z.ZodTypeDef, unknown>;

// ── Preventive care ──
export const careProtocolSchema = z
  .object({
    name: reqText(120),
    kind: z.enum(CARE_KINDS),
    speciesId: optUuid(),
    productId: optUuid(),
    firstDueAgeWeeks: optInt(0, 520),
    intervalDays: optInt(1, 3650),
    source: reqText(500),
    notes: optText(1000),
  })
  .refine((p) => p.intervalDays || p.firstDueAgeWeeks != null, { path: ['intervalDays'], message: 'Give a repeat interval, a first-dose age, or both' });

export const careItemSchema = z.object({
  patientId: z.string().uuid(),
  protocolId: optUuid(),
  kind: z.enum(CARE_KINDS),
  title: reqText(160),
  dueDate: z.coerce.date(),
  notes: optText(1000),
});

export const completeCareSchema = z
  .object({
    mode: z.enum(['ADMINISTER', 'ELSEWHERE', 'DONE']),
    productId: optUuid(),
    dose: optNum(0.0001, 100000),
    doseUnit: optText(20),
    route: optText(40),
    site: optText(60),
    batchNumber: optText(60),
    expiryDate: optDate(),
    productName: optText(160),
    notes: optText(1000),
    completedAt: optDate(),
    overrideReason: optText(500),
    encounterId: optUuid(),
  })
  .refine((c) => c.mode !== 'ADMINISTER' || (!!c.productId && !!c.dose && !!c.doseUnit && !!c.route), { path: ['productId'], message: 'Choose the product and enter the dose, unit and route' })
  .refine((c) => c.mode !== 'ELSEWHERE' || !!c.productName, { path: ['productName'], message: 'Which product was given?' });

export const deferCareSchema = z.object({ until: z.coerce.date(), reason: reqText(300) });
export const cancelCareSchema = z.object({ reason: reqText(300) });

// ── Communications ──
export const templateSchema = z.object({
  purpose: z.enum(MESSAGE_PURPOSES),
  channel: z.enum(MESSAGE_CHANNELS),
  subject: optText(200),
  body: reqText(4000),
  isActive: z.boolean().default(true),
});
export const sendMessageSchema = z.object({
  clientId: z.string().uuid(),
  patientId: optUuid(),
  channel: z.enum(MESSAGE_CHANNELS),
  subject: optText(200),
  body: reqText(4000),
});
export const commsSettingsSchema = z.object({
  reminderLeadDays: z.coerce.number().int().min(0).max(90),
  overdueReminderDays: z.coerce.number().int().min(1).max(365),
  appointmentReminderHours: z.coerce.number().int().min(1).max(168),
  portalEnabled: z.boolean(),
  portalCancelHours: z.coerce.number().int().min(0).max(720),
});
export const staffReplySchema = z.object({ clientId: z.string().uuid(), subject: optText(200), body: reqText(4000) });

// ── Client portal ──
export const portalLoginSchema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) });
export const portalAcceptSchema = z.object({ token: z.string().min(20).max(200), password: passwordPolicy });
export const portalForgotSchema = z.object({ email: z.string().trim().toLowerCase().email() });
export const portalResetSchema = z.object({ token: z.string().min(20).max(200), password: passwordPolicy });
export const portalPasswordSchema = z.object({ current: z.string().min(1).max(200), next: passwordPolicy });
export const portalRequestSchema = z.object({
  patientId: optUuid(),
  reason: reqText(500),
  preferredDate: z.coerce.date(),
  preferredTime: z.enum(PREFERRED_TIMES).default('ANY'),
  notes: optText(1000),
});
export const portalMessageSchema = z.object({ kind: z.enum(['MESSAGE', 'FEEDBACK']).default('MESSAGE'), subject: optText(200), body: reqText(4000), patientId: optUuid() });
export const portalPreferencesSchema = z.object({ remindersConsent: z.boolean(), marketingConsent: z.boolean(), preferredChannel: z.enum(['EMAIL', 'SMS', 'WHATSAPP', 'PHONE']) });
export const portalCancelSchema = z.object({ reason: reqText(300) });
export const requestDecisionSchema = z.object({ action: z.enum(['booked', 'declined']), appointmentId: optUuid(), reason: optText(300) });
