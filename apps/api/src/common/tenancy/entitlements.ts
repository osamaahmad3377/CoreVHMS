import { ForbiddenException } from '@nestjs/common';
import { GB, PLAN_FEATURES, featureLockedMessage, hasFeature, permissionInPlan, planNames, plansAllowing, storageText, type Entitlements, type OptionalModule, type PlanFeature } from '@vcms/shared';
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

/** Whether the clinic's plan includes a feature. Optional modules that are not plan features (e.g. home visits) are in every plan. */
export function featureAllowed(feature: PlanFeature | OptionalModule): boolean {
  if (!(PLAN_FEATURES as readonly string[]).includes(feature)) return true;
  return hasFeature(currentEntitlements(), feature as PlanFeature);
}

/** Throws unless the clinic's plan includes the feature. */
export function assertFeature(feature: PlanFeature) {
  if (featureAllowed(feature)) return;
  throw new ForbiddenException({
    code: 'PLAN_FEATURE',
    message: featureLockedMessage(currentEntitlements(), feature),
    details: { feature },
  });
}

const LIMIT_TEXT = {
  staff: { limit: (e: Entitlements) => e.maxStaff, noun: 'staff accounts', hint: 'Remove or pause someone', more: 'add more staff' },
  branches: { limit: (e: Entitlements) => e.maxBranches, noun: 'branches', hint: 'Pause a branch you no longer use', more: 'add more branches' },
  automations: { limit: (e: Entitlements) => e.maxAutomations, noun: 'ready-made automations switched on', hint: 'Switch one off', more: 'switch on more' },
  customAutomations: { limit: (e: Entitlements) => e.maxCustomAutomations, noun: 'of your own automations switched on', hint: 'Switch one off', more: 'switch on more of your own' },
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
  const bigger = plansAllowing(e, kind, current + adding);
  const upgrade = bigger.length ? `upgrade to ${planNames(bigger)} to ${t.more}` : `upgrade your plan to ${t.more}`;
  throw ruleViolation('PLAN_LIMIT', `Your ${e.planName ? `${e.planName} ` : ''}plan allows ${max} ${t.noun}, and you have ${current}. ${t.hint}, or ${upgrade}.`, { kind, limit: max, current, plans: bigger.map((p) => p.name) });
}

/**
 * Throws when a new file would take the clinic's files (documents, photos, X-rays) over its plan's storage.
 * Files already kept are never touched: a clinic over a lowered limit can still open and delete them.
 */
export function assertStorage(usedBytes: number, addingBytes: number) {
  const e = currentEntitlements();
  if (!e || e.maxStorageGb === null) return;
  const max = e.maxStorageGb * GB;
  if (usedBytes + addingBytes <= max) return;
  const bigger = plansAllowing(e, 'storage', Math.ceil((usedBytes + addingBytes) / GB));
  const upgrade = bigger.length ? `upgrade to ${planNames(bigger)}` : 'upgrade your plan';
  throw ruleViolation(
    'PLAN_LIMIT',
    `Your ${e.planName ? `${e.planName} ` : ''}plan includes ${e.maxStorageGb} GB of file storage, and ${storageText(usedBytes)} is used, so this ${storageText(addingBytes)} file does not fit. Delete files you no longer need, ask for more storage (Settings → Your plan), or ${upgrade}.`,
    { kind: 'storage', limit: e.maxStorageGb, current: usedBytes, adding: addingBytes, plans: bigger.map((p) => p.name) },
  );
}
