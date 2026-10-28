import type { ClinicPaymentView, PaymentState } from './schemas/platform';
import { z } from 'zod';
import { optText, reqText } from './schemas/common';

/**
 * Plans (multi-clinic hosting). The super admin defines plans and assigns one to each clinic; a plan says which
 * areas of the system a clinic may use and how many staff accounts and branches it may have. The API enforces it.
 *
 * Without multi-clinic hosting, or for a clinic with no plan, nothing is limited.
 */
export const PLAN_FEATURES = ['lab', 'hospital', 'surgery', 'livestock', 'boarding', 'insurance', 'reports', 'branding', 'forecast', 'transfers', 'whatsapp', 'mailbox', 'automationBuilder', 'marketing'] as const;
export type PlanFeature = (typeof PLAN_FEATURES)[number];

export const PLAN_FEATURE_INFO: Record<PlanFeature, { label: string; description: string }> = {
  lab: { label: 'Lab & X-ray', description: 'Test orders, results and imaging reports.' },
  hospital: { label: 'Hospital', description: 'Admitted patients, wards, treatment sheets and discharge.' },
  surgery: { label: 'Surgery', description: 'Operations, anaesthesia records and the safety checklist.' },
  livestock: { label: 'Livestock & farms', description: 'Farms, herds, breeding and field visits.' },
  boarding: { label: 'Boarding & grooming', description: 'Kennels, boarding stays and grooming jobs.' },
  insurance: { label: 'Insurance & referrals', description: 'Insurance claims and referrals to other vets.' },
  reports: { label: 'Reports', description: 'Financial, clinical and stock reports and exports.' },
  branding: { label: 'Branding', description: 'The clinic’s own logo, colours, sign-in page, printouts and emails.' },
  forecast: { label: 'Stock forecast', description: 'What runs out next, and supplier orders ready to send.' },
  transfers: { label: 'Branch transfers', description: 'Suggested stock moves between branches, before anyone runs out.' },
  whatsapp: { label: 'WhatsApp Business', description: 'Reminders and messages sent to clients on WhatsApp from the clinic’s own WhatsApp Business number.' },
  mailbox: { label: 'Your own mailbox', description: 'Client emails sent from the clinic’s Gmail, Outlook or mail server.' },
  automationBuilder: { label: 'Full automation builder', description: 'Waits, checks, conditions, tasks and sending hours in your own automations.' },
  marketing: { label: 'Marketing automations', description: 'Birthdays, recalls and other promotional messages.' },
};

/** What a clinic gets with each feature: shown on the "upgrade to unlock" page. */
export const PLAN_FEATURE_BENEFITS: Record<PlanFeature, string[]> = {
  lab: ['Order blood tests, urine tests and X-rays from the consultation', 'Results with normal ranges, flagged when out of range', 'Imaging reports kept on the patient’s record'],
  hospital: ['Admit patients to wards and kennels', 'Treatment sheets with doses due, given and missed', 'Discharge summaries for the owner'],
  surgery: ['Book operations and theatres', 'Anaesthesia records and monitoring', 'The surgical safety checklist, signed by the team'],
  livestock: ['Farms, herds and flocks with their animals', 'Breeding, pregnancy and calving records', 'Field visits and herd treatments'],
  boarding: ['Kennels and boarding stays with check-in and check-out', 'Grooming jobs and their prices', 'Everything billed to the client’s invoice'],
  insurance: ['Clients’ insurance policies', 'Insurance claims from invoices', 'Referrals to other vets with the history attached'],
  reports: ['Takings, sales and payments by day, staff and branch', 'Clinical and vaccination reports', 'Stock reports, with exports you can open in Excel'],
  branding: ['Your logo and colours across the system', 'Your name on the sign-in page', 'Branded printouts and emails'],
  forecast: ['See which medicines and items run out next', 'Supplier orders prepared for you', 'Less money tied up in stock'],
  transfers: ['Suggested stock moves between branches', 'Move stock before a branch runs out', 'Every transfer recorded on both sides'],
  whatsapp: ['Reminders, confirmations and results sent on WhatsApp automatically', 'From your own WhatsApp Business number', 'Clients’ replies arrive in NextCore'],
  mailbox: ['Client emails sent from your own Gmail, Outlook or mail server', 'Replies come straight to your inbox', 'Higher trust: emails carry your clinic’s address'],
  automationBuilder: ['Waits, checks and conditions in your automations', 'Tasks for your team when something needs a person', 'Sending hours and limits on how often clients hear from you'],
  marketing: ['Birthday messages for pets', 'Recalls for clients who have not visited in a while', 'Promotional messages, with clients able to opt out'],
};

/** File storage: bytes in a gigabyte, and the size of each extra storage pack a clinic can buy. */
export const GB = 1024 ** 3;
export const STORAGE_PACK_GB = 50;

/** "3.4 GB", "820 MB", "12 KB". */
export function storageText(bytes: number) {
  if (bytes >= GB) return `${(bytes / GB).toFixed(bytes >= 100 * GB ? 0 : 1).replace(/\.0$/, '')} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.max(0, Math.round(bytes / 1024))} KB`;
}

const isFeature = (x: string): x is PlanFeature => (PLAN_FEATURES as readonly string[]).includes(x);

/** What a clinic is allowed. Null limits mean unlimited. */
export interface Entitlements {
  planId: string | null;
  planName: string | null;
  maxStaff: number | null;
  maxBranches: number | null;
  /** Ready-made automations that may be switched on at once. */
  maxAutomations: number | null;
  /** The clinic's own automations (easy creator or builder) that may be switched on at once. */
  maxCustomAutomations: number | null;
  /** File storage for documents, photos and X-rays, in GB. */
  maxStorageGb: number | null;
  features: PlanFeature[];
  /** When a free trial (or free period) ends; null when the clinic is paying. */
  trialEndsAt?: string | null;
  /** The plans on offer (hosted clinics only), to say which plan unlocks a feature or allows more. */
  offers?: PlanBrief[];
}

/** A plan on offer, as much as a clinic needs to know to choose an upgrade. */
export interface PlanBrief {
  name: string;
  priceMonthlyMinor: number;
  currency: string;
  maxStaff: number | null;
  maxBranches: number | null;
  maxAutomations: number | null;
  maxCustomAutomations: number | null;
  storageGb: number | null;
  features: PlanFeature[];
}

export interface PlanLike {
  id: string;
  name: string;
  maxStaff: number | null;
  maxBranches: number | null;
  maxAutomations?: number | null;
  maxCustomAutomations?: number | null;
  storageGb?: number | null;
  features: readonly string[];
}

export interface PlanOverrides {
  staffLimitOverride?: number | null;
  branchLimitOverride?: number | null;
  storageLimitOverrideGb?: number | null;
  extraFeatures?: readonly string[] | null;
  removedFeatures?: readonly string[] | null;
  trialEndsAt?: Date | string | null;
}

/** Everything allowed: no plan assigned. */
export const FULL_ACCESS: Entitlements = { planId: null, planName: null, maxStaff: null, maxBranches: null, maxAutomations: null, maxCustomAutomations: null, maxStorageGb: null, features: [...PLAN_FEATURES], trialEndsAt: null };

/**
 * A clinic's effective entitlements: its plan, then the super admin's per-clinic exceptions on top
 * (a number replaces the plan's limit; extra features are added; removed features are taken away).
 */
export function resolveEntitlements(plan: PlanLike | null | undefined, o: PlanOverrides = {}): Entitlements {
  if (!plan) return FULL_ACCESS;
  const features = new Set<PlanFeature>(plan.features.filter(isFeature));
  for (const f of o.extraFeatures ?? []) if (isFeature(f)) features.add(f);
  for (const f of o.removedFeatures ?? []) features.delete(f as PlanFeature);
  return {
    planId: plan.id,
    planName: plan.name,
    maxStaff: o.staffLimitOverride ?? plan.maxStaff,
    maxBranches: o.branchLimitOverride ?? plan.maxBranches,
    maxAutomations: plan.maxAutomations ?? null,
    maxCustomAutomations: plan.maxCustomAutomations ?? null,
    maxStorageGb: o.storageLimitOverrideGb ?? plan.storageGb ?? null,
    features: PLAN_FEATURES.filter((f) => features.has(f)),
    trialEndsAt: o.trialEndsAt ? new Date(o.trialEndsAt).toISOString() : null,
  };
}

export const hasFeature = (e: Entitlements | null | undefined, f: PlanFeature) => !e || e.features.includes(f);

/** The other plans that include a feature, cheapest first. */
export function plansWithFeature(e: Entitlements | null | undefined, f: PlanFeature): PlanBrief[] {
  return (e?.offers ?? []).filter((p) => p.name !== e?.planName && p.features.includes(f)).sort((a, b) => a.priceMonthlyMinor - b.priceMonthlyMinor);
}

/** The other plans that allow at least `needed` of something, cheapest first. */
export function plansAllowing(e: Entitlements | null | undefined, kind: 'staff' | 'branches' | 'automations' | 'customAutomations' | 'storage', needed: number): PlanBrief[] {
  const max = (p: PlanBrief) =>
    kind === 'staff' ? p.maxStaff : kind === 'branches' ? p.maxBranches : kind === 'automations' ? p.maxAutomations : kind === 'storage' ? p.storageGb : p.maxCustomAutomations;
  return (e?.offers ?? []).filter((p) => p.name !== e?.planName && (max(p) === null || max(p)! >= needed)).sort((a, b) => a.priceMonthlyMinor - b.priceMonthlyMinor);
}

/** "Professional", "Professional or Premium", "Starter, Professional or Premium". */
export function planNames(plans: readonly { name: string }[], joiner = 'or'): string {
  const n = plans.map((p) => p.name);
  return n.length <= 1 ? (n[0] ?? '') : `${n.slice(0, -1).join(', ')} ${joiner} ${n[n.length - 1]}`;
}

/** "Upgrade to Professional or Premium to use it." — or a general line when the plans on offer are not known. */
export function upgradeLine(plans: readonly { name: string }[], what = 'use it') {
  return plans.length ? `Upgrade to ${planNames(plans)} to ${what}.` : `Upgrade your plan to ${what}.`;
}

/** The message for a feature the clinic's plan does not include. */
export function featureLockedMessage(e: Entitlements | null | undefined, f: PlanFeature): string {
  const plan = e?.planName ? `your ${e.planName} plan` : 'your plan';
  return `${PLAN_FEATURE_INFO[f].label} is not included in ${plan}. ${upgradeLine(plansWithFeature(e, f))}`;
}

/**
 * The plan feature a permission belongs to, by its name (`lab.read` → lab, `reports.view` → reports), or null for
 * permissions every plan includes. A clinic whose plan lacks a feature loses these permissions for everyone,
 * so server checks and the interface both follow the plan without any per-route rules.
 */
export function featureOfPermission(permission: string): PlanFeature | null {
  const domain = permission.split('.')[0];
  return isFeature(domain) ? domain : null;
}

export function permissionInPlan(e: Entitlements | null | undefined, permission: string): boolean {
  const f = featureOfPermission(permission);
  return !f || hasFeature(e, f);
}

/** "3 of 10", "3 (no limit)". */
export function usageText(used: number, limit: number | null) {
  return limit === null ? `${used} (no limit)` : `${used} of ${limit}`;
}

// ── Schemas (super admin) ──

const limit = z.number().int().min(1, 'At least 1').max(10_000).nullable();
const money = z.number().int().min(0).max(100_000_000_00);
const featureList = z.array(z.enum(PLAN_FEATURES)).max(PLAN_FEATURES.length);

export const planInputSchema = z.object({
  name: reqText(60),
  description: optText(300),
  priceMonthlyMinor: z.number().int().min(0).max(100_000_000_00),
  currency: z.enum(['PKR', 'AUD']).default('PKR'),
  maxStaff: limit,
  maxBranches: limit,
  maxAutomations: limit.default(null),
  maxCustomAutomations: limit.default(null),
  /** Yearly price (e.g. 10 months for 12); null = no yearly option. */
  priceYearlyMinor: money.nullable().default(null),
  /** Monthly price of each branch / staff account above the plan's limit; null = not offered. */
  extraBranchMinor: money.nullable().default(null),
  extraStaffMinor: money.nullable().default(null),
  /** File storage included, in GB (null = no limit), and the monthly price of each extra STORAGE_PACK_GB. */
  storageGb: z.number().int().min(1, 'At least 1 GB').max(100_000).nullable().default(null),
  extraStorageMinor: money.nullable().default(null),
  trialDays: z.number().int().min(0).max(365).default(0),
  supportResponse: optText(60),
  whatsappSupport: z.boolean().default(false),
  phoneSupport: z.boolean().default(false),
  trainingSessions: z.number().int().min(0).max(100).default(0),
  features: featureList,
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(1000).default(0),
});
export type PlanInput = z.infer<typeof planInputSchema>;

/** Assigns a plan to a clinic, with optional exceptions for this clinic only. */
export const clinicPlanSchema = z.object({
  planId: z.string().uuid().nullable(),
  staffLimitOverride: limit.default(null),
  branchLimitOverride: limit.default(null),
  storageLimitOverrideGb: z.number().int().min(1, 'At least 1 GB').max(100_000).nullable().default(null),
  extraFeatures: featureList.default([]),
  removedFeatures: featureList.default([]),
});
export type ClinicPlanInput = z.infer<typeof clinicPlanSchema>;

export interface PlatformPlan {
  id: string;
  name: string;
  description: string | null;
  priceMonthlyMinor: number;
  currency: string;
  maxStaff: number | null;
  maxBranches: number | null;
  maxAutomations: number | null;
  maxCustomAutomations: number | null;
  priceYearlyMinor: number | null;
  extraBranchMinor: number | null;
  extraStaffMinor: number | null;
  storageGb: number | null;
  extraStorageMinor: number | null;
  trialDays: number;
  supportResponse: string | null;
  whatsappSupport: boolean;
  phoneSupport: boolean;
  trainingSessions: number;
  features: PlanFeature[];
  isActive: boolean;
  sortOrder: number;
  clinicCount: number;
}

/** A clinic's plan as the owner sees it (Settings → Your plan). */
export interface ClinicPlanView {
  entitlements: Entitlements;
  /** automations = ready-made switched on; customAutomations = the clinic's own switched on. */
  usage: { staff: number; branches: number; automations: number; customAutomations: number; storageBytes: number };
  /** The plans on offer, to compare and ask for an upgrade (multi-clinic hosting only). */
  plans: PlanOffer[];
  /** A plan change the owner asked for that NextCore has not handled yet. */
  pendingRequest: { kind: PlanRequestKind; planId: string | null; planName: string | null; quantity: number; createdAt: string } | null;
  /** How the clinic pays, and its monthly bill as it stands (hosted clinics on a plan). */
  billing: {
    cycle: BillingCycle;
    bill: ClinicBill;
    paidUntil: string | null;
    payment: PaymentState;
    /** The clinic's receipts, newest first (cancelled ones left out). */
    payments: Pick<ClinicPaymentView, 'id' | 'receipt' | 'paidAt' | 'amountMinor' | 'currency' | 'billingCycle' | 'paidMonths' | 'freeMonths' | 'periodStart' | 'periodEnd' | 'method'>[];
  } | null;
  /** The clinic's current plan in full (price, extras, support), when it has one. */
  currentPlan: PlanOffer | null;
}

/** EXTRA_STORAGE: `quantity` packs of STORAGE_PACK_GB. */
export const PLAN_REQUEST_KINDS = ['PLAN', 'EXTRA_BRANCH', 'EXTRA_STAFF', 'EXTRA_STORAGE'] as const;
export type PlanRequestKind = (typeof PLAN_REQUEST_KINDS)[number];
export const BILLING_CYCLES = ['MONTHLY', 'YEARLY'] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

/** A clinic's request to change plan, as the super admin sees it. */
export interface PlanRequestView {
  id: string;
  clinicId: string;
  clinicName: string;
  clinicSlug: string;
  kind: PlanRequestKind;
  quantity: number;
  fromPlanName: string | null;
  toPlanId: string | null;
  toPlanName: string | null;
  /** The new monthly price (plan change) or the monthly price of the extras asked for. */
  priceMonthlyMinor: number;
  currency: string;
  note: string | null;
  requestedByName: string | null;
  createdAt: string;
}

export type PlanOffer = Pick<
  PlatformPlan,
  | 'id'
  | 'name'
  | 'description'
  | 'priceMonthlyMinor'
  | 'priceYearlyMinor'
  | 'currency'
  | 'maxStaff'
  | 'maxBranches'
  | 'maxAutomations'
  | 'maxCustomAutomations'
  | 'extraBranchMinor'
  | 'extraStaffMinor'
  | 'storageGb'
  | 'extraStorageMinor'
  | 'trialDays'
  | 'supportResponse'
  | 'whatsappSupport'
  | 'phoneSupport'
  | 'trainingSessions'
  | 'features'
>;

/** An owner asks for another plan, or for more branches / staff accounts on the current one. */
export const upgradeRequestSchema = z
  .object({
    kind: z.enum(PLAN_REQUEST_KINDS).default('PLAN'),
    planId: z.string().uuid().optional(),
    quantity: z.number().int().min(1).max(20).default(1),
    note: optText(500),
  })
  .refine((r) => r.kind !== 'PLAN' || !!r.planId, { message: 'Choose a plan', path: ['planId'] });
export type UpgradeRequestInput = z.infer<typeof upgradeRequestSchema>;

/** Plans created the first time the super admin opens Plans (and offered as "recommended plans"). */
export const DEFAULT_PLANS: Omit<PlanInput, 'currency' | 'isActive'>[] = [
  {
    name: 'Starter',
    description: 'For a small clinic getting started: front desk, records, billing, stock and client emails in one place.',
    priceMonthlyMinor: 680_000,
    priceYearlyMinor: 6_800_000,
    maxStaff: 2,
    maxBranches: 1,
    maxAutomations: 5,
    maxCustomAutomations: 3,
    extraBranchMinor: 500_000,
    extraStaffMinor: 50_000,
    storageGb: 10,
    extraStorageMinor: 100_000,
    trialDays: 14,
    supportResponse: '2 working days',
    whatsappSupport: true,
    phoneSupport: false,
    trainingSessions: 0,
    features: ['branding', 'mailbox'],
    sortOrder: 1,
  },
  {
    name: 'Professional',
    description: 'Most popular: lab, hospital, surgery, reports, stock forecast and the full automation builder.',
    priceMonthlyMinor: 980_000,
    priceYearlyMinor: 9_800_000,
    maxStaff: 6,
    maxBranches: 2,
    maxAutomations: 9,
    maxCustomAutomations: 15,
    extraBranchMinor: 500_000,
    extraStaffMinor: 50_000,
    storageGb: 50,
    extraStorageMinor: 100_000,
    trialDays: 30,
    supportResponse: '1 working day',
    whatsappSupport: true,
    phoneSupport: false,
    trainingSessions: 1,
    features: ['lab', 'hospital', 'surgery', 'boarding', 'reports', 'branding', 'forecast', 'whatsapp', 'mailbox', 'automationBuilder', 'marketing'],
    sortOrder: 2,
  },
  {
    name: 'Premium',
    description: 'Everything, for hospitals and groups: livestock, insurance, branch transfers and priority support.',
    priceMonthlyMinor: 1_500_000,
    priceYearlyMinor: 15_000_000,
    maxStaff: null,
    maxBranches: 3,
    maxAutomations: null,
    maxCustomAutomations: null,
    extraBranchMinor: 500_000,
    extraStaffMinor: null,
    storageGb: 200,
    extraStorageMinor: 100_000,
    trialDays: 30,
    supportResponse: '4 hours',
    whatsappSupport: true,
    phoneSupport: true,
    trainingSessions: 3,
    features: [...PLAN_FEATURES],
    sortOrder: 3,
  },
];

/** What a plan costs a month on a billing cycle (a yearly price is spread over 12 months). */
export function monthlyPrice(p: { priceMonthlyMinor: number; priceYearlyMinor?: number | null }, cycle: BillingCycle = 'MONTHLY') {
  return cycle === 'YEARLY' && p.priceYearlyMinor != null ? Math.round(p.priceYearlyMinor / 12) : p.priceMonthlyMinor;
}

/** Months free when paying yearly (e.g. 2 when the yearly price is 10 monthly prices). */
export function yearlyMonthsFree(p: { priceMonthlyMinor: number; priceYearlyMinor?: number | null }) {
  if (p.priceYearlyMinor == null || !p.priceMonthlyMinor) return 0;
  return Math.max(0, Math.round(12 - p.priceYearlyMinor / p.priceMonthlyMinor));
}

export interface ClinicBill {
  cycle: BillingCycle;
  /** The plan's price for the month (yearly spread over 12). */
  planMinor: number;
  extraBranches: number;
  extraStaff: number;
  /** Price of each extra branch / staff account a month (null: not offered on this plan). */
  extraBranchMinor: number | null;
  extraStaffMinor: number | null;
  /** Extra storage packs (STORAGE_PACK_GB each) above the plan's storage, and the price of each a month. */
  extraStoragePacks: number;
  extraStorageMinor: number | null;
  /** Extras a month (staff, branches and storage above the plan). */
  extrasMinor: number;
  /** Paying monthly: the plan's monthly price + extras. */
  monthlyFeeMinor: number;
  /** Paying yearly upfront: the plan's yearly price + 12 months of extras (null: no yearly option). */
  yearlyFeeMinor: number | null;
  /** What is charged each billing period on the clinic's cycle (a month, or a year upfront). */
  chargeMinor: number;
  periodMonths: 1 | 12;
  /** What the clinic pays a month now: 0 during a free trial. */
  totalMinor: number;
  inTrial: boolean;
  currency: string;
}

/**
 * A clinic's monthly bill: its plan (yearly spread over 12) plus each branch and staff account above the plan's
 * limit at the plan's extra price. Extras are whichever is higher: the extra places NextCore gave the clinic, or the
 * staff accounts (active and invited) and branches it really has — e.g. Starter includes 2 staff, so a clinic with 5
 * pays for 3 extra. Nothing is charged during a free trial.
 */
export function clinicBill(
  plan: Pick<PlatformPlan, 'priceMonthlyMinor' | 'priceYearlyMinor' | 'currency' | 'maxStaff' | 'maxBranches' | 'extraBranchMinor' | 'extraStaffMinor'> & { storageGb?: number | null; extraStorageMinor?: number | null },
  c: { billingCycle: BillingCycle; staffLimitOverride: number | null; branchLimitOverride: number | null; storageLimitOverrideGb?: number | null; trialEndsAt: Date | string | null },
  now = new Date(),
  used?: { staff: number; branches: number } | null,
): ClinicBill {
  const extra = (override: number | null, inUse: number | undefined, base: number | null) =>
    base == null ? 0 : Math.max(0, Math.max(override ?? 0, inUse ?? 0) - base);
  const extraBranches = extra(c.branchLimitOverride, used?.branches, plan.maxBranches);
  const extraStaff = extra(c.staffLimitOverride, used?.staff, plan.maxStaff);
  // Storage above the plan is the extra space NextCore gave the clinic, in whole packs (uploads stop at the limit).
  const extraStoragePacks = plan.storageGb == null || c.storageLimitOverrideGb == null ? 0 : Math.ceil(Math.max(0, c.storageLimitOverrideGb - plan.storageGb) / STORAGE_PACK_GB);
  const planMinor = monthlyPrice(plan, c.billingCycle);
  const extrasMinor = extraBranches * (plan.extraBranchMinor ?? 0) + extraStaff * (plan.extraStaffMinor ?? 0) + extraStoragePacks * (plan.extraStorageMinor ?? 0);
  const inTrial = !!c.trialEndsAt && new Date(c.trialEndsAt) > now;
  const monthlyFeeMinor = plan.priceMonthlyMinor + extrasMinor;
  const yearlyFeeMinor = plan.priceYearlyMinor != null ? plan.priceYearlyMinor + 12 * extrasMinor : null;
  const yearly = c.billingCycle === 'YEARLY' && yearlyFeeMinor != null;
  return {
    cycle: yearly ? 'YEARLY' : 'MONTHLY',
    monthlyFeeMinor,
    yearlyFeeMinor,
    chargeMinor: yearly ? yearlyFeeMinor : monthlyFeeMinor,
    periodMonths: yearly ? 12 : 1,
    planMinor,
    extraBranches,
    extraStaff,
    extraBranchMinor: plan.extraBranchMinor,
    extraStaffMinor: plan.extraStaffMinor,
    extraStoragePacks,
    extraStorageMinor: plan.extraStorageMinor ?? null,
    extrasMinor,
    totalMinor: inTrial ? 0 : planMinor + extrasMinor,
    inTrial,
    currency: plan.currency,
  };
}

/** The yearly price that gives `monthsFree` months free (e.g. 2 → pay for 10 months, get 12). */
export function yearlyPriceFor(priceMonthlyMinor: number, monthsFree: number) {
  return priceMonthlyMinor * (12 - Math.max(0, Math.min(11, Math.round(monthsFree))));
}

/** Whole days left until a date (0 when it has passed). */
export function daysLeft(until: Date | string, now = new Date()) {
  return Math.max(0, Math.ceil((new Date(until).getTime() - now.getTime()) / 86400_000));
}

/**
 * How the recommended plans replace a platform's existing ones: a plan with the same name is updated; the other
 * recommended plans take over the remaining active plans in order (so clinics on them move with the plan, e.g.
 * Clinic → Professional, Hospital → Premium); anything left over is created. Other plans are not touched.
 */
export function recommendedPlanMapping<T extends { id: string; name: string; isActive: boolean; sortOrder: number }>(existing: readonly T[]) {
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const used = new Set<string>();
  const rows = DEFAULT_PLANS.map((rec) => {
    const match = existing.find((p) => same(p.name, rec.name)) ?? null;
    if (match) used.add(match.id);
    return { recommended: rec, replaces: match };
  });
  const spare = [...existing]
    .filter((p) => !used.has(p.id) && p.isActive && !DEFAULT_PLANS.some((d) => same(d.name, p.name)))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  for (const r of rows) if (!r.replaces && spare.length) r.replaces = spare.shift()!;
  return rows;
}

/** Whether a plan already matches its recommended version (name, price, limits and features). */
export function matchesRecommended(p: Omit<PlatformPlan, 'id' | 'clinicCount' | 'description' | 'sortOrder' | 'currency'>) {
  const rec = DEFAULT_PLANS.find((d) => d.name === p.name);
  const keys = ['priceMonthlyMinor', 'priceYearlyMinor', 'maxStaff', 'maxBranches', 'maxAutomations', 'maxCustomAutomations', 'extraBranchMinor', 'extraStaffMinor', 'storageGb', 'extraStorageMinor', 'trialDays', 'whatsappSupport', 'phoneSupport', 'trainingSessions'] as const;
  return (
    !!rec &&
    p.isActive &&
    keys.every((k) => (rec[k] ?? null) === (p[k] ?? null)) &&
    (rec.supportResponse ?? null) === (p.supportResponse ?? null) &&
    rec.features.length === p.features.length &&
    rec.features.every((f) => p.features.includes(f))
  );
}
