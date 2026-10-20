import { ForbiddenException } from '@nestjs/common';
import { PLAN_FEATURE_INFO, hasFeature, permissionInPlan, type Entitlements, type PlanFeature } from '@vcms/shared';
import { RequestContext } from '../context/request-context';
import { ruleViolation } from '../http/errors';

/** The current clinic's entitlements; null when nothing is limited (single installation, or a clinic without a plan). */
export function currentEntitlements(): Entitlements | null {
  return RequestContext.get()?.tenant?.entitlements ?? null;
}

/**
 * Whether the signed-in person "holds" a permission for the rule that nobody may give or take away more than they have.
 * Permissions of areas outside the clinic's plan count as held: they are dormant for everyone, and a clinic that
 * upgrades gets them back, so they must not stop an owner from assigning an ordinary role.
 */
export function holds(permissions: ReadonlySet<string>, permission: string): boolean {
  return permissions.has(permission) || !permissionInPlan(currentEntitlements(), permission);
}

export function featureAllowed(feature: PlanFeature): boolean {
  return hasFeature(currentEntitlements(), feature);
}

const UPGRADE = 'Ask NextCore to add it to your plan.';

/** Throws unless the clinic's plan includes the feature. */
export function assertFeature(feature: PlanFeature) {
  if (featureAllowed(feature)) return;
  const e = currentEntitlements();
  throw new ForbiddenException({
    code: 'PLAN_FEATURE',
    message: `${PLAN_FEATURE_INFO[feature].label} is not part of your ${e?.planName ? `${e.planName} ` : ''}plan. ${UPGRADE}`,
    details: { feature },
  });
}

const LIMIT_TEXT = {
  staff: { limit: (e: Entitlements) => e.maxStaff, noun: 'staff accounts', hint: 'Remove or pause someone, or ask NextCore for a bigger plan.' },
  branches: { limit: (e: Entitlements) => e.maxBranches, noun: 'branches', hint: 'Pause a branch you no longer use, or ask NextCore for a bigger plan.' },
} as const;

/**
 * Throws when adding `adding` more would go over the plan's limit. `current` is how many the clinic has now
 * (staff: active and invited; branches: active). A clinic already over a lowered limit keeps what it has but cannot add more.
 */
export function assertWithinLimit(kind: keyof typeof LIMIT_TEXT, current: number, adding = 1) {
  const e = currentEntitlements();
  if (!e) return;
  const t = LIMIT_TEXT[kind];
  const max = t.limit(e);
  if (max === null || current + adding <= max) return;
  throw ruleViolation('PLAN_LIMIT', `Your ${e.planName ? `${e.planName} ` : ''}plan allows ${max} ${t.noun}, and you have ${current}. ${t.hint}`, { kind, limit: max, current });
}
