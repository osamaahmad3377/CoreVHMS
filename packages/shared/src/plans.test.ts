import { DEFAULT_PLANS, FULL_ACCESS, clinicBill, daysLeft, matchesRecommended, monthlyPrice, yearlyPriceFor, yearlyMonthsFree, PLAN_FEATURES, PLAN_FEATURE_BENEFITS, clinicPlanSchema, featureLockedMessage, featureOfPermission, permissionInPlan, planInputSchema, plansAllowing, plansWithFeature, resolveEntitlements } from './plans';
import { ALL_PERMISSIONS } from './permissions';
import { addMonths, nextPeriodStart, paymentState, receiptNumber, recordPaymentSchema } from './schemas/platform';

const plan = { id: 'p1', name: 'Starter', maxStaff: 3, maxBranches: 1, features: ['reports'] };

describe('plans', () => {
  it('has no limits without a plan', () => {
    expect(resolveEntitlements(null)).toEqual(FULL_ACCESS);
    expect(FULL_ACCESS).toMatchObject({ maxStaff: null, maxBranches: null, features: [...PLAN_FEATURES] });
  });

  it('uses the plan, then the clinic’s exceptions on top', () => {
    expect(resolveEntitlements(plan)).toEqual({ planId: 'p1', planName: 'Starter', maxStaff: 3, maxBranches: 1, maxAutomations: null, maxCustomAutomations: null, features: ['reports'], trialEndsAt: null });
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
    // live inside areas everyone has (stock, integrations, automations) and are checked by the API where they are used.
    const inCode = ['forecast', 'transfers', 'whatsapp', 'mailbox', 'automationBuilder', 'marketing'];
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
    // WhatsApp Business: Professional and Premium; Starter sends client messages by email.
    expect(DEFAULT_PLANS.map((p) => p.features.includes('whatsapp'))).toEqual([false, true, true]);
    // Every plan may send client emails from the clinic's own mailbox (its mail server carries them).
    expect(DEFAULT_PLANS.every((p) => p.features.includes('mailbox'))).toBe(true);
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

describe('billing', () => {
  const [starter, professional, premium] = DEFAULT_PLANS.map((p) => ({ ...p, currency: 'PKR' }));
  const clinic = { billingCycle: 'MONTHLY' as const, staffLimitOverride: null, branchLimitOverride: null, trialEndsAt: null };

  it('follows the plan sheet: yearly is 10 months for 12, extras priced per month, trials and support', () => {
    expect(DEFAULT_PLANS.map((p) => [p.priceYearlyMinor, p.trialDays, p.maxCustomAutomations, p.extraBranchMinor, p.extraStaffMinor, p.trainingSessions])).toEqual([
      [6_800_000, 14, 3, 500_000, 50_000, 0],
      [9_800_000, 30, 15, 500_000, 50_000, 1],
      [15_000_000, 30, null, 500_000, null, 3],
    ]);
    expect(DEFAULT_PLANS.map((p) => yearlyMonthsFree(p))).toEqual([2, 2, 2]);
    expect(DEFAULT_PLANS.map((p) => p.phoneSupport)).toEqual([false, false, true]);
    expect(monthlyPrice(starter, 'YEARLY')).toBe(566_667);
    expect(DEFAULT_PLANS.every((p) => matchesRecommended({ ...p, isActive: true, description: null } as never))).toBe(true);
  });

  it('adds extra branches and staff above the plan, and charges nothing during a free trial', () => {
    expect(clinicBill(starter, clinic)).toMatchObject({ planMinor: 680_000, extrasMinor: 0, totalMinor: 680_000, inTrial: false });
    expect(clinicBill(professional, { ...clinic, branchLimitOverride: 3, staffLimitOverride: 8 })).toMatchObject({ extraBranches: 1, extraStaff: 2, extrasMinor: 600_000, totalMinor: 1_580_000 });
    // A lowered limit is not an extra; Premium's unlimited staff has none.
    expect(clinicBill(professional, { ...clinic, branchLimitOverride: 1 }).extraBranches).toBe(0);
    expect(clinicBill(premium, { ...clinic, staffLimitOverride: 40 }).extraStaff).toBe(0);
    // Real staff and branches count too: Starter includes 2 staff and 1 branch, so 5 staff and 2 branches pay
    // 3 × Rs 500 + 1 × Rs 5,000 on top of the plan. Extra places given but not used are still charged.
    expect(clinicBill(starter, clinic, undefined, { staff: 5, branches: 2 })).toMatchObject({ extraStaff: 3, extraBranches: 1, extrasMinor: 650_000, totalMinor: 1_330_000, extraStaffMinor: 50_000 });
    expect(clinicBill(starter, { ...clinic, staffLimitOverride: 6 }, undefined, { staff: 3, branches: 1 })).toMatchObject({ extraStaff: 4, extrasMinor: 200_000 });
    expect(clinicBill(starter, clinic, undefined, { staff: 2, branches: 1 }).extrasMinor).toBe(0);
    expect(clinicBill(premium, clinic, undefined, { staff: 40, branches: 3 }).extrasMinor).toBe(0);
    const now = new Date('2026-10-27T00:00:00Z');
    expect(clinicBill(starter, { ...clinic, trialEndsAt: '2026-11-10T00:00:00Z' }, now)).toMatchObject({ inTrial: true, totalMinor: 0, planMinor: 680_000 });
    expect(daysLeft('2026-11-10T00:00:00Z', now)).toBe(14);
    expect(daysLeft('2026-10-01T00:00:00Z', now)).toBe(0);
  });
});

describe('clinic fees and payments', () => {
  const [starter, professional] = DEFAULT_PLANS.map((p) => ({ ...p, currency: 'PKR' }));
  const clinic = { billingCycle: 'MONTHLY' as const, staffLimitOverride: null, branchLimitOverride: null, trialEndsAt: null };
  const now = new Date('2026-10-27T10:00:00Z');

  it('works out the monthly and the yearly (upfront) fee, extras included', () => {
    const b = clinicBill(starter, clinic, now, { staff: 3, branches: 1 });
    expect(b).toMatchObject({ cycle: 'MONTHLY', monthlyFeeMinor: 730_000, yearlyFeeMinor: 6_800_000 + 12 * 50_000, chargeMinor: 730_000, periodMonths: 1 });
    expect(clinicBill(professional, { ...clinic, billingCycle: 'YEARLY' }, now)).toMatchObject({ cycle: 'YEARLY', chargeMinor: 9_800_000, periodMonths: 12 });
    expect(clinicBill({ ...starter, priceYearlyMinor: null }, { ...clinic, billingCycle: 'YEARLY' }, now)).toMatchObject({ cycle: 'MONTHLY', yearlyFeeMinor: null, chargeMinor: 680_000 });
    expect(yearlyPriceFor(680_000, 2)).toBe(6_800_000);
    expect(yearlyPriceFor(680_000, 0)).toBe(8_160_000);
  });

  it('knows whether a clinic is paid up, due soon, overdue or on trial', () => {
    const bill = clinicBill(starter, clinic, now);
    expect(paymentState({ bill: null, paidUntil: null, trialEndsAt: null }, now).kind).toBe('NO_PLAN');
    expect(paymentState({ bill, paidUntil: null, trialEndsAt: null }, now)).toMatchObject({ kind: 'UNPAID', dueMinor: 680_000 });
    expect(paymentState({ bill, paidUntil: '2026-12-27T10:00:00Z', trialEndsAt: null }, now)).toMatchObject({ kind: 'PAID', days: 61 });
    expect(paymentState({ bill, paidUntil: '2026-10-30T10:00:00Z', trialEndsAt: null }, now)).toMatchObject({ kind: 'DUE_SOON', days: 3 });
    expect(paymentState({ bill, paidUntil: '2026-10-20T10:00:00Z', trialEndsAt: null }, now)).toMatchObject({ kind: 'OVERDUE', days: 7 });
    const trial = clinicBill(starter, { ...clinic, trialEndsAt: '2026-11-05T10:00:00Z' }, now);
    expect(paymentState({ bill: trial, paidUntil: null, trialEndsAt: '2026-11-05T10:00:00Z' }, now)).toMatchObject({ kind: 'TRIAL', days: 9 });
    expect(paymentState({ bill: clinicBill({ ...starter, priceMonthlyMinor: 0 }, clinic, now), paidUntil: null, trialEndsAt: null }, now).kind).toBe('FREE');
  });

  it('starts a new paid period after what is already paid or the trial, and adds calendar months', () => {
    expect(nextPeriodStart({ paidUntil: null, trialEndsAt: null }, now)).toEqual(now);
    expect(nextPeriodStart({ paidUntil: '2026-12-01T00:00:00Z', trialEndsAt: null }, now).toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(nextPeriodStart({ paidUntil: '2026-01-01T00:00:00Z', trialEndsAt: '2026-11-10T00:00:00Z' }, now).toISOString()).toBe('2026-11-10T00:00:00.000Z');
    // Overdue but still working: the new period carries on from when the last one ran out; after a pause, from today.
    expect(nextPeriodStart({ paidUntil: '2026-10-20T00:00:00Z', trialEndsAt: null, status: 'ACTIVE' }, now).toISOString()).toBe('2026-10-20T00:00:00.000Z');
    expect(nextPeriodStart({ paidUntil: '2026-10-20T00:00:00Z', trialEndsAt: null, status: 'SUSPENDED' }, now)).toEqual(now);
    expect(addMonths('2026-01-31T00:00:00Z', 1).toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(addMonths('2026-10-27T10:00:00Z', 14).toISOString()).toBe('2027-12-27T10:00:00.000Z');
    expect(receiptNumber(12)).toBe('NC-000012');
  });

  it('records payments: yearly payments cover whole years', () => {
    const base = { billingCycle: 'YEARLY', paidMonths: 12, freeMonths: 1, amountMinor: 6_800_000, paidAt: '2026-10-27T10:00:00Z', method: 'BANK_TRANSFER' };
    expect(recordPaymentSchema.safeParse(base).success).toBe(true);
    expect(recordPaymentSchema.safeParse({ ...base, paidMonths: 6 }).success).toBe(false);
    expect(recordPaymentSchema.safeParse({ ...base, billingCycle: 'MONTHLY', paidMonths: 3 }).success).toBe(true);
  });
});
