import { DEFAULT_PLANS, FULL_ACCESS, PLAN_FEATURES, PLAN_FEATURE_BENEFITS, clinicPlanSchema, featureLockedMessage, featureOfPermission, permissionInPlan, planInputSchema, plansAllowing, plansWithFeature, resolveEntitlements } from './plans';
import { ALL_PERMISSIONS } from './permissions';

const plan = { id: 'p1', name: 'Starter', maxStaff: 3, maxBranches: 1, features: ['reports'] };

describe('plans', () => {
  it('has no limits without a plan', () => {
    expect(resolveEntitlements(null)).toEqual(FULL_ACCESS);
    expect(FULL_ACCESS).toMatchObject({ maxStaff: null, maxBranches: null, features: [...PLAN_FEATURES] });
  });

  it('uses the plan, then the clinic’s exceptions on top', () => {
    expect(resolveEntitlements(plan)).toEqual({ planId: 'p1', planName: 'Starter', maxStaff: 3, maxBranches: 1, maxAutomations: null, features: ['reports'] });
    const e = resolveEntitlements(plan, { staffLimitOverride: 8, extraFeatures: ['lab'], removedFeatures: ['reports'] });
    expect(e).toMatchObject({ maxStaff: 8, maxBranches: 1, features: ['lab'] });
    // Unknown feature keys (a retired feature stored earlier) are ignored, and order follows the catalogue.
    expect(resolveEntitlements({ ...plan, features: ['nonsense', 'branding', 'lab'] }).features).toEqual(['lab', 'branding']);
    // A plan without limits stays unlimited; an exception can still set one.
    expect(resolveEntitlements({ ...plan, maxStaff: null }).maxStaff).toBeNull();
    expect(resolveEntitlements({ ...plan, maxStaff: null }, { staffLimitOverride: 2 }).maxStaff).toBe(2);
  });

  it('ties every plan feature to the permissions of the same name, and leaves everything else open', () => {
    const e = resolveEntitlements(plan);
    expect(featureOfPermission('lab.read')).toBe('lab');
    expect(featureOfPermission('reports.financial')).toBe('reports');
    expect(featureOfPermission('clients.read')).toBeNull();
    expect(permissionInPlan(e, 'lab.read')).toBe(false);
    expect(permissionInPlan(e, 'reports.view')).toBe(true);
    expect(permissionInPlan(e, 'billing.write')).toBe(true);
    expect(permissionInPlan(null, 'lab.read')).toBe(true);
    // Every area feature closes at least one real permission, so a plan can never gate nothing. The newer features
    // live inside areas everyone has (stock, email, automations) and are checked by the API where they are used.
    const inCode = ['forecast', 'transfers', 'mailbox', 'automationBuilder', 'marketing'];
    for (const f of PLAN_FEATURES) expect(ALL_PERMISSIONS.some((p) => featureOfPermission(p) === f)).toBe(!inCode.includes(f));
  });

  it('validates plans and per-clinic exceptions', () => {
    expect(planInputSchema.safeParse({ name: 'Basic', maxStaff: null, maxBranches: 2, features: ['lab'], priceMonthlyMinor: 500000 }).success).toBe(true);
    for (const bad of [{ maxStaff: 0 }, { maxBranches: -1 }, { features: ['teleport'] }, { name: '' }, { priceMonthlyMinor: -1 }]) {
      expect(planInputSchema.safeParse({ name: 'Basic', maxStaff: 5, maxBranches: 1, features: [], priceMonthlyMinor: 0, ...bad }).success).toBe(false);
    }
    expect(clinicPlanSchema.parse({ planId: null })).toMatchObject({ staffLimitOverride: null, extraFeatures: [], removedFeatures: [] });
    expect(clinicPlanSchema.safeParse({ planId: 'not-a-uuid' }).success).toBe(false);
  });

  it('ships three sensible starter plans', () => {
    expect(DEFAULT_PLANS.map((p) => p.name)).toEqual(['Starter', 'Professional', 'Premium']);
    expect(DEFAULT_PLANS.map((p) => [p.maxStaff, p.maxBranches, p.maxAutomations, p.priceMonthlyMinor])).toEqual([[2, 1, 5, 680_000], [6, 2, 9, 980_000], [null, 3, null, 1_500_000]]);
    for (const p of DEFAULT_PLANS) expect(planInputSchema.safeParse({ ...p, currency: 'PKR', isActive: true }).success).toBe(true);
    expect(DEFAULT_PLANS[2].features).toEqual([...PLAN_FEATURES]);
  });
});

describe('upgrade messages', () => {
  const offers = DEFAULT_PLANS.map((p) => ({ ...p, currency: 'PKR' })).reverse();
  const starter = { ...resolveEntitlements({ id: 's', ...DEFAULT_PLANS[0] }), offers };

  it('names the cheaper plans that include a feature first, without the current plan', () => {
    expect(plansWithFeature(starter, 'lab').map((p) => p.name)).toEqual(['Professional', 'Premium']);
    expect(plansWithFeature(starter, 'livestock').map((p) => p.name)).toEqual(['Premium']);
    expect(featureLockedMessage(starter, 'lab')).toBe('Lab & X-ray is not included in your Starter plan. Upgrade to Professional or Premium to use it.');
  });

  it('names the plans that allow more, and falls back when the offers are unknown', () => {
    expect(plansAllowing(starter, 'staff', 3).map((p) => p.name)).toEqual(['Professional', 'Premium']);
    expect(plansAllowing(starter, 'branches', 3).map((p) => p.name)).toEqual(['Premium']);
    expect(featureLockedMessage({ ...starter, offers: undefined }, 'lab')).toBe('Lab & X-ray is not included in your Starter plan. Upgrade your plan to use it.');
  });

  it('describes every feature', () => {
    for (const f of PLAN_FEATURES) expect(PLAN_FEATURE_BENEFITS[f].length).toBeGreaterThan(0);
  });
});
