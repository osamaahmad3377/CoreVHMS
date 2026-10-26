import { DEFAULT_PLANS, FULL_ACCESS, PLAN_FEATURES, clinicPlanSchema, featureOfPermission, permissionInPlan, planInputSchema, resolveEntitlements } from './plans';
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
    // Every feature closes at least one real permission, so a plan can never gate nothing.
    for (const f of PLAN_FEATURES) expect(ALL_PERMISSIONS.some((p) => featureOfPermission(p) === f)).toBe(true);
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
    expect(DEFAULT_PLANS.map((p) => p.name)).toEqual(['Starter', 'Clinic', 'Hospital']);
    for (const p of DEFAULT_PLANS) expect(planInputSchema.safeParse({ ...p, currency: 'PKR', isActive: true }).success).toBe(true);
    expect(DEFAULT_PLANS[2].features).toEqual([...PLAN_FEATURES]);
  });
});
