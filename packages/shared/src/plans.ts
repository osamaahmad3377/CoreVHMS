import { z } from 'zod';
import { optText, reqText } from './schemas/common';

/**
 * Plans (multi-clinic hosting). The super admin defines plans and assigns one to each clinic; a plan says which
 * areas of the system a clinic may use and how many staff accounts and branches it may have. The API enforces it.
 *
 * Without multi-clinic hosting, or for a clinic with no plan, nothing is limited.
 */
export const PLAN_FEATURES = ['lab', 'hospital', 'surgery', 'livestock', 'boarding', 'insurance', 'reports', 'branding', 'forecast', 'transfers', 'mailbox', 'automationBuilder', 'marketing'] as const;
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
  mailbox: ['Client emails sent from your own Gmail, Outlook or mail server', 'Replies come straight to your inbox', 'Higher trust: emails carry your clinic’s address'],
  automationBuilder: ['Waits, checks and conditions in your automations', 'Tasks for your team when something needs a person', 'Sending hours and limits on how often clients hear from you'],
  marketing: ['Birthday messages for pets', 'Recalls for clients who have not visited in a while', 'Promotional messages, with clients able to opt out'],
};

const isFeature = (x: string): x is PlanFeature => (PLAN_FEATURES as readonly string[]).includes(x);

/** What a clinic is allowed. Null limits mean unlimited. */
export interface Entitlements {
  planId: string | null;
  planName: string | null;
  maxStaff: number | null;
  maxBranches: number | null;
  /** Automations that may be switched on at once. */
  maxAutomations: number | null;
  features: PlanFeature[];
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
  features: PlanFeature[];
}

export interface PlanLike {
  id: string;
  name: string;
  maxStaff: number | null;
  maxBranches: number | null;
  maxAutomations?: number | null;
  features: readonly string[];
}

export interface PlanOverrides {
  staffLimitOverride?: number | null;
  branchLimitOverride?: number | null;
  extraFeatures?: readonly string[] | null;
  removedFeatures?: readonly string[] | null;
}

/** Everything allowed: no plan assigned. */
export const FULL_ACCESS: Entitlements = { planId: null, planName: null, maxStaff: null, maxBranches: null, maxAutomations: null, features: [...PLAN_FEATURES] };

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
    features: PLAN_FEATURES.filter((f) => features.has(f)),
  };
}

export const hasFeature = (e: Entitlements | null | undefined, f: PlanFeature) => !e || e.features.includes(f);

/** The other plans that include a feature, cheapest first. */
export function plansWithFeature(e: Entitlements | null | undefined, f: PlanFeature): PlanBrief[] {
  return (e?.offers ?? []).filter((p) => p.name !== e?.planName && p.features.includes(f)).sort((a, b) => a.priceMonthlyMinor - b.priceMonthlyMinor);
}

/** The other plans that allow at least `needed` of something, cheapest first. */
export function plansAllowing(e: Entitlements | null | undefined, kind: 'staff' | 'branches' | 'automations', needed: number): PlanBrief[] {
  const max = (p: PlanBrief) => (kind === 'staff' ? p.maxStaff : kind === 'branches' ? p.maxBranches : p.maxAutomations);
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
const featureList = z.array(z.enum(PLAN_FEATURES)).max(PLAN_FEATURES.length);

export const planInputSchema = z.object({
  name: reqText(60),
  description: optText(300),
  priceMonthlyMinor: z.number().int().min(0).max(100_000_000_00),
  currency: z.enum(['PKR', 'AUD']).default('PKR'),
  maxStaff: limit,
  maxBranches: limit,
  maxAutomations: limit.default(null),
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
  features: PlanFeature[];
  isActive: boolean;
  sortOrder: number;
  clinicCount: number;
}

/** A clinic's plan as the owner sees it (Settings → Your plan). */
export interface ClinicPlanView {
  entitlements: Entitlements;
  usage: { staff: number; branches: number; automations: number };
  /** The plans on offer, to compare and ask for an upgrade (multi-clinic hosting only). */
  plans: PlanOffer[];
}

export type PlanOffer = Pick<PlatformPlan, 'id' | 'name' | 'description' | 'priceMonthlyMinor' | 'currency' | 'maxStaff' | 'maxBranches' | 'maxAutomations' | 'features'>;

export const upgradeRequestSchema = z.object({ planId: z.string().uuid(), note: optText(500) });
export type UpgradeRequestInput = z.infer<typeof upgradeRequestSchema>;

/** Plans created the first time the super admin opens Plans. Prices are only a starting point. */
export const DEFAULT_PLANS: Omit<PlanInput, 'currency' | 'isActive'>[] = [
  { name: 'Starter', description: 'A small clinic: 1 branch, 2 staff, 5 automations. Email support within 2 working days.', priceMonthlyMinor: 680_000, maxStaff: 2, maxBranches: 1, maxAutomations: 5, features: ['branding'], sortOrder: 1 },
  {
    name: 'Professional',
    description: 'Most popular: lab, hospital, surgery, reports and stock forecast. 2 branches, 6 staff, 9 automations. Email and WhatsApp support within 1 working day.',
    priceMonthlyMinor: 980_000,
    maxStaff: 6,
    maxBranches: 2,
    maxAutomations: 9,
    features: ['lab', 'hospital', 'surgery', 'boarding', 'reports', 'branding', 'forecast', 'mailbox', 'automationBuilder', 'marketing'],
    sortOrder: 2,
  },
  { name: 'Premium', description: 'Everything, for hospitals and groups: 3 branches, unlimited staff and automations. Priority support within 4 hours, by phone too.', priceMonthlyMinor: 1_500_000, maxStaff: null, maxBranches: 3, maxAutomations: null, features: [...PLAN_FEATURES], sortOrder: 3 },
];
