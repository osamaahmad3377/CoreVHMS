import { z } from 'zod';
import type { Branding } from '../branding';
import { BILLING_CYCLES, type BillingCycle, type ClinicBill, type Entitlements, type PlanFeature } from '../plans';
import { optText } from './common';

/** A clinic's subdomain: 3–30 lowercase letters, numbers and single hyphens, starting with a letter. */
export const clinicAddressSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z](?:[a-z0-9]|-(?=[a-z0-9])){2,29}$/, 'Use 3–30 lowercase letters, numbers or hyphens, starting with a letter');

export const createClinicSchema = z.object({
  name: z.string().trim().min(2).max(160),
  slug: clinicAddressSchema,
  country: z.enum(['PK', 'AU']),
  branchName: z.string().trim().min(2).max(160),
  ownerName: z.string().trim().min(2).max(120),
  ownerEmail: z.string().trim().toLowerCase().email(),
  /** Temporary password shown once to the super admin, or an invitation email to the owner. */
  ownerAccess: z.enum(['TEMPORARY_PASSWORD', 'INVITATION']),
  /** The plan to start on; omit for a clinic without limits. */
  planId: z.string().uuid().nullish(),
  billingCycle: z.enum(BILLING_CYCLES).default('MONTHLY'),
  /** Start with the plan's free trial (when it has one). */
  startTrial: z.boolean().default(true),
});
export type CreateClinicInput = z.infer<typeof createClinicSchema>;

/**
 * How a clinic pays, and its free trial (or a free period, e.g. a month of Professional): when it ends the clinic
 * moves to `trialThenPlanId`, or is paused when that is null.
 */
export const clinicBillingSchema = z.object({
  billingCycle: z.enum(BILLING_CYCLES),
  trialEndsAt: z.string().datetime({ offset: true }).nullable(),
  trialThenPlanId: z.string().uuid().nullable(),
});
export type ClinicBillingInput = z.infer<typeof clinicBillingSchema>;

// ── Clinic payments (subscription billing for NextCore itself) ──

export const PLATFORM_PAYMENT_METHODS = ['BANK_TRANSFER', 'CASH', 'JAZZCASH', 'EASYPAISA', 'CARD', 'CHEQUE', 'OTHER'] as const;
export type PlatformPaymentMethod = (typeof PLATFORM_PAYMENT_METHODS)[number];
export const PLATFORM_PAYMENT_METHOD_LABELS: Record<PlatformPaymentMethod, string> = {
  BANK_TRANSFER: 'Bank transfer',
  CASH: 'Cash',
  JAZZCASH: 'JazzCash',
  EASYPAISA: 'Easypaisa',
  CARD: 'Card',
  CHEQUE: 'Cheque',
  OTHER: 'Other',
};

/**
 * A payment a clinic made to NextCore: it covers `paidMonths` (12 for a year upfront) plus any free months given,
 * from the end of what was already paid (or the end of its free trial, or today).
 */
export const recordPaymentSchema = z
  .object({
    billingCycle: z.enum(BILLING_CYCLES),
    paidMonths: z.number().int().min(1).max(36),
    freeMonths: z.number().int().min(0).max(12).default(0),
    amountMinor: z.number().int().min(0).max(100_000_000_00),
    paidAt: z.string().datetime({ offset: true }),
    method: z.enum(PLATFORM_PAYMENT_METHODS),
    /** When the paid period starts; omit to carry on from what is already paid (see nextPeriodStart). */
    periodStart: z.string().datetime({ offset: true }).nullish(),
    reference: optText(80),
    note: optText(300),
  })
  .refine((v) => v.billingCycle === 'MONTHLY' || v.paidMonths % 12 === 0, { path: ['paidMonths'], message: 'Yearly payments cover whole years (12, 24 or 36 months)' });
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;

export const voidPaymentSchema = z.object({ reason: z.string().trim().min(3, 'Say why this payment is cancelled').max(200) });
export type VoidPaymentInput = z.infer<typeof voidPaymentSchema>;

export const paymentListSchema = z.object({
  clinicId: z.string().uuid().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

export interface ClinicPaymentView {
  id: string;
  /** Receipt number, e.g. NC-000012. */
  receipt: string;
  clinicId: string;
  clinicName: string;
  planName: string | null;
  billingCycle: BillingCycle;
  amountMinor: number;
  currency: string;
  paidMonths: number;
  freeMonths: number;
  periodStart: string;
  periodEnd: string;
  paidAt: string;
  method: PlatformPaymentMethod;
  reference: string | null;
  note: string | null;
  recordedByName: string | null;
  createdAt: string;
  voidedAt: string | null;
  voidedByName: string | null;
  voidReason: string | null;
}

export const receiptNumber = (n: number) => `NC-${String(n).padStart(6, '0')}`;

/** Days before the paid period ends when a clinic shows as "due soon". */
export const DUE_SOON_DAYS = 7;

/**
 * Where a clinic stands with its payments:
 * NO_PLAN (no limits, not charged) · FREE (its plan costs nothing) · TRIAL · PAID · DUE_SOON (paid period ends within
 * a week) · OVERDUE (paid period has ended) · UNPAID (no payment recorded since it started paying).
 */
export type PaymentStateKind = 'NO_PLAN' | 'FREE' | 'TRIAL' | 'PAID' | 'DUE_SOON' | 'OVERDUE' | 'UNPAID';
export interface PaymentState {
  kind: PaymentStateKind;
  /** Paid until (PAID, DUE_SOON, OVERDUE) or the end of the free trial (TRIAL). */
  date: string | null;
  /** Days left (TRIAL, PAID, DUE_SOON) or days overdue (OVERDUE). */
  days: number | null;
  /** What to collect next: one billing period on the clinic's cycle. */
  dueMinor: number;
  currency: string;
}

const DAY = 86400_000;

export function paymentState(
  c: { bill: ClinicBill | null; paidUntil: string | Date | null; trialEndsAt: string | Date | null },
  now = new Date(),
): PaymentState {
  const bill = c.bill;
  const iso = (d: string | Date | null) => (d ? new Date(d).toISOString() : null);
  if (!bill) return { kind: 'NO_PLAN', date: null, days: null, dueMinor: 0, currency: 'PKR' };
  const base = { dueMinor: bill.chargeMinor, currency: bill.currency };
  if (bill.inTrial && c.trialEndsAt) return { kind: 'TRIAL', date: iso(c.trialEndsAt), days: Math.max(0, Math.ceil((new Date(c.trialEndsAt).getTime() - now.getTime()) / DAY)), ...base };
  if (!bill.chargeMinor) return { kind: 'FREE', date: iso(c.paidUntil), days: null, ...base, dueMinor: 0 };
  if (!c.paidUntil) return { kind: 'UNPAID', date: null, days: null, ...base };
  const ms = new Date(c.paidUntil).getTime() - now.getTime();
  if (ms <= 0) return { kind: 'OVERDUE', date: iso(c.paidUntil), days: Math.floor(-ms / DAY), ...base };
  const days = Math.ceil(ms / DAY);
  return { kind: days <= DUE_SOON_DAYS ? 'DUE_SOON' : 'PAID', date: iso(c.paidUntil), days, ...base };
}

/** Adds calendar months in UTC, keeping the day where it can (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(d: Date | string, months: number) {
  const x = new Date(d);
  const day = x.getUTCDate();
  x.setUTCDate(1);
  x.setUTCMonth(x.getUTCMonth() + months);
  const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
  x.setUTCDate(Math.min(day, last));
  return x;
}

/**
 * Where a new payment's period starts: straight after what is already paid — even when that ran out a few days ago
 * and the clinic kept working (it pays for the days it used) — or after the free trial, or today. A clinic that
 * was paused starts again today.
 */
export function nextPeriodStart(c: { paidUntil: string | Date | null; trialEndsAt: string | Date | null; status?: string }, now = new Date()) {
  const trial = c.trialEndsAt ? new Date(c.trialEndsAt).getTime() : 0;
  if (c.paidUntil && c.status !== 'SUSPENDED') return new Date(Math.max(new Date(c.paidUntil).getTime(), trial));
  const times = [now.getTime(), c.paidUntil ? new Date(c.paidUntil).getTime() : 0, trial];
  return new Date(Math.max(...times));
}

/** The super admin's money at a glance. Amounts are in the main currency (the first plan's). */
export interface BillingSummary {
  currency: string;
  /** Monthly recurring income from paying clinics (yearly spread over 12, extras included). */
  mrrMinor: number;
  payingClinics: number;
  trialClinics: number;
  overdue: { count: number; amountMinor: number };
  dueSoon: { count: number; amountMinor: number };
  unpaid: { count: number; amountMinor: number };
  collectedThisMonthMinor: number;
  collectedLastMonthMinor: number;
  collectedThisYearMinor: number;
  /** Collected in each of the last 12 months, oldest first ("2026-10"). */
  months: { month: string; totalMinor: number; count: number }[];
}

export type ClinicStatus = 'PROVISIONING' | 'ACTIVE' | 'SUSPENDED' | 'FAILED';

export interface PlatformClinic {
  id: string;
  slug: string;
  name: string;
  /** Full web address, e.g. https://happypaws.nextcore.net.au */
  address: string;
  databaseName: string;
  status: ClinicStatus;
  country: string;
  ownerName: string;
  ownerEmail: string;
  ownerAccess: 'TEMPORARY_PASSWORD' | 'INVITATION';
  lastError: string | null;
  /** The clinic's plan and the super admin's exceptions for this clinic. */
  planId: string | null;
  planName: string | null;
  staffLimitOverride: number | null;
  branchLimitOverride: number | null;
  storageLimitOverrideGb: number | null;
  extraFeatures: PlanFeature[];
  removedFeatures: PlanFeature[];
  /** What the clinic may actually use (plan + exceptions). */
  entitlements: Entitlements;
  billingCycle: BillingCycle;
  trialEndsAt: string | null;
  trialThenPlanId: string | null;
  /** Why it is paused, e.g. TRIAL_ENDED. */
  pausedReason: string | null;
  /** Its monthly bill (null without a plan). */
  bill: ClinicBill | null;
  /** The end of what it has paid for (null: nothing recorded). */
  paidUntil: string | null;
  lastPaymentAt: string | null;
  payment: PaymentState;
  provisionedAt: string | null;
  suspendedAt: string | null;
  createdAt: string;
}

/** How much a clinic is used (counts only; nothing clinical is read). */
export interface ClinicUsage {
  staff: number;
  activeStaff: number;
  /** Staff accounts counted against the plan: active and invited. */
  staffCounted: number;
  branches: number;
  /** Files kept (documents, photos, X-rays), in bytes; deleted files are not counted. */
  storageBytes: number;
  clients: number;
  patients: number;
  appointmentsThisMonth: number;
  lastSignInAt: string | null;
}

export interface ClinicOverview {
  clinic: PlatformClinic;
  /** Null while the clinic is being set up, or if its database cannot be reached. */
  usage: ClinicUsage | null;
  events: { id: string; action: string; summary: string | null; actorName: string | null; createdAt: string }[];
  payments: ClinicPaymentView[];
}

/** Answer to "which part of the system is this address?" (public). */
export interface HostInfo {
  mode: 'single' | 'platform' | 'clinic' | 'root';
  /** On a clinic's address: its name, status and branding for the sign-in page, browser tab and icon. */
  clinic?: { name: string; status: ClinicStatus; branding?: Branding };
  baseDomain?: string;
}
