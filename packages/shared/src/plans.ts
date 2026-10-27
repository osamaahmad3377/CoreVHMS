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
