'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PLAN_FEATURES, PLAN_FEATURE_INFO, clinicBill, daysLeft, type ClinicOverview, type PlanFeature, type PlatformPlan } from '@vcms/shared';
import { AlertTriangle, BadgeCheck, CalendarClock, Gift, LayoutList, Minus, Plus, RotateCcw, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { Field } from '@/components/forms/field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/checkbox';
import { Input, NativeSelect } from '@/components/ui/input';
import { api } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { BillBreakdown, limitWord, planPrice } from './plan-ui';

/** A bar showing how much of a limit is used. */
function UsageBar({ label, used, limit }: { label: string; used: number | null; limit: number | null }) {
  const pct = limit && used !== null ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const over = limit !== null && used !== null && used > limit;
  return (
    <div className="grid gap-1">
      <div className="flex items-baseline justify-between text-sm">
        <span>{label}</span>
        <span className={over ? 'font-semibold text-destructive' : 'font-medium'}>{used === null ? '—' : used} <span className="font-normal text-muted-foreground">of {limitWord(limit)}</span></span>
      </div>
      {limit !== null && (
        <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={`${label} used`} aria-valuenow={used ?? 0} aria-valuemin={0} aria-valuemax={limit}>
          <div className={`h-full rounded-full ${over ? 'bg-destructive' : pct >= 90 ? 'bg-warning' : 'bg-primary'}`} style={{ width: `${over ? 100 : pct}%` }} />
        </div>
      )}
    </div>
  );
}

/** − 2 + : how many extra branches or staff accounts the clinic pays for. */
function Stepper({ id, label, value, onChange, price, base }: { id: string; label: string; value: number; onChange: (n: number) => void; price: string | null; base: number }) {
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <div className="flex items-center gap-2">
        <Button type="button" size="icon" variant="outline" className="h-8 w-8" aria-label={`Fewer ${label.toLowerCase()}`} disabled={value <= 0} onClick={() => onChange(value - 1)}><Minus /></Button>
        <Input id={id} type="number" min={0} max={50} className="h-8 w-16 text-center" value={value} onChange={(e) => onChange(Math.max(0, Math.min(50, Number(e.target.value) || 0)))} />
        <Button type="button" size="icon" variant="outline" className="h-8 w-8" aria-label={`More ${label.toLowerCase()}`} disabled={value >= 50} onClick={() => onChange(value + 1)}><Plus /></Button>
      </div>
      <p className="text-xs text-muted-foreground">{base + value} in total · {price ? `${price} each a month` : 'no price set on the plan'}</p>
    </div>
  );
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));
const extraOver = (override: number | null, base: number | null) => (override != null && base != null ? Math.max(0, override - base) : 0);

/**
 * A clinic's plan: choosing a plan gives the clinic that plan's features and limits; on top, extra branches and
 * staff accounts it pays for, and features switched on or off for this clinic only.
 */
export function ClinicPlanCard({ overview }: { overview: ClinicOverview }) {
  const { clinic: c, usage } = overview;
  const qc = useQueryClient();
  const plans = useQuery({ queryKey: ['platform-plans'], queryFn: () => api.get<PlatformPlan[]>('/platform/plans') });
  const savedPlan = plans.data?.find((p) => p.id === c.planId) ?? null;
  // The form starts from what the clinic has now; choosing another plan starts its features and extras again.
  const [planId, setPlanId] = useState<string>(c.planId ?? '');
  const [extraBranches, setExtraBranches] = useState<number | null>(null);
  const [extraStaff, setExtraStaff] = useState<number | null>(null);
  const [features, setFeatures] = useState<PlanFeature[]>(c.entitlements.features);

  const plan = plans.data?.find((p) => p.id === planId) ?? null;
  const samePlan = planId === (c.planId ?? '');
  const xBranches = extraBranches ?? (samePlan ? extraOver(c.branchLimitOverride, savedPlan?.maxBranches ?? null) : 0);
  const xStaff = extraStaff ?? (samePlan ? extraOver(c.staffLimitOverride, savedPlan?.maxStaff ?? null) : 0);
  const choices = (plans.data ?? []).filter((p) => p.isActive || p.id === c.planId);
  const planFeatures = plan?.features ?? [...PLAN_FEATURES];
  const extra = features.filter((f) => !planFeatures.includes(f));
  const removed = planFeatures.filter((f) => !features.includes(f));
  const branchOverride = plan && plan.maxBranches != null && xBranches > 0 ? plan.maxBranches + xBranches : null;
  const staffOverride = plan && plan.maxStaff != null && xStaff > 0 ? plan.maxStaff + xStaff : null;
  const staffLimit = staffOverride ?? plan?.maxStaff ?? null;
  const branchLimit = branchOverride ?? plan?.maxBranches ?? null;
  const staffUsed = usage?.staffCounted ?? null;
  const branchesUsed = usage?.branches ?? null;
  const bill = plan ? clinicBill(plan, { billingCycle: c.billingCycle, staffLimitOverride: staffOverride, branchLimitOverride: branchOverride, trialEndsAt: c.trialEndsAt }, undefined, usage && { staff: usage.staffCounted, branches: usage.branches }) : null;
  // Staff or branches in use above the plan and the extra places given are billed too.
  const billedOverStaff = bill ? bill.extraStaff - xStaff : 0;
  const billedOverBranches = bill ? bill.extraBranches - xBranches : 0;

  const dirty = !samePlan || branchOverride !== c.branchLimitOverride || staffOverride !== c.staffLimitOverride || !sameSet(extra, c.extraFeatures) || !sameSet(removed, c.removedFeatures);
  const overStaff = staffLimit !== null && staffUsed !== null && staffUsed > staffLimit;
  const overBranches = branchLimit !== null && branchesUsed !== null && branchesUsed > branchLimit;

  const choosePlan = (id: string) => {
    setPlanId(id);
    setExtraBranches(id === (c.planId ?? '') ? null : 0);
    setExtraStaff(id === (c.planId ?? '') ? null : 0);
    setFeatures(plans.data?.find((p) => p.id === id)?.features ?? [...PLAN_FEATURES]);
  };
  const undo = () => {
    setPlanId(c.planId ?? '');
    setExtraBranches(null);
    setExtraStaff(null);
    setFeatures(c.entitlements.features);
  };

  const save = useMutation({
    mutationFn: () =>
      api.put(`/platform/clinics/${c.id}/plan`, {
        planId: planId || null,
        staffLimitOverride: planId ? staffOverride : null,
        branchLimitOverride: planId ? branchOverride : null,
        extraFeatures: planId ? extra : [],
        removedFeatures: planId ? removed : [],
      }),
    onSuccess: () => {
      toast.success('Plan saved — it applies to the clinic within seconds');
      qc.invalidateQueries({ queryKey: ['platform-clinic'] });
      qc.invalidateQueries({ queryKey: ['platform-clinics'] });
      qc.invalidateQueries({ queryKey: ['platform-plans'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const money = (minor: number | null | undefined) => (minor == null || !plan ? null : planPrice({ priceMonthlyMinor: minor, currency: plan.currency }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><LayoutList className="h-4 w-4" /> Plan &amp; features</CardTitle>
        <Link href="/platform/plans" className="text-xs text-primary hover:underline">Manage plans</Link>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Field label="Plan" htmlFor="clinic-plan" hint={plan ? 'The clinic gets this plan’s features and limits automatically.' : 'No limits: the clinic can use everything.'}>
          <NativeSelect id="clinic-plan" value={planId} onChange={(e) => choosePlan(e.target.value)} disabled={plans.isLoading}>
            <option value="">No plan (no limits)</option>
            {choices.map((p) => <option key={p.id} value={p.id}>{p.name} — {planPrice(p)}/month{p.isActive ? '' : ' (switched off)'}</option>)}
          </NativeSelect>
        </Field>

        <div className="grid gap-3 rounded-lg surface-flat p-3">
          <UsageBar label="Staff accounts" used={staffUsed} limit={staffLimit} />
          <UsageBar label="Branches" used={branchesUsed} limit={branchLimit} />
          {(overStaff || overBranches) && (
            <p className="flex items-start gap-2 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              The clinic is above this limit. Nobody is removed and each one above the plan is billed as an extra, but it cannot add more until you give it extra places below.
            </p>
          )}
        </div>

        {plan && (plan.maxBranches != null || plan.maxStaff != null) && (
          <div className="grid gap-3 sm:grid-cols-2">
            {plan.maxBranches != null && <Stepper id="x-branches" label="Extra branches" value={xBranches} onChange={setExtraBranches} price={money(plan.extraBranchMinor)} base={plan.maxBranches} />}
            {plan.maxStaff != null && <Stepper id="x-staff" label="Extra staff accounts" value={xStaff} onChange={setExtraStaff} price={money(plan.extraStaffMinor)} base={plan.maxStaff} />}
          </div>
        )}

        <fieldset className="grid gap-1">
          <div className="mb-1 flex items-center justify-between gap-2">
            <legend className="text-sm font-medium">Features</legend>
            {(extra.length > 0 || removed.length > 0) && (
              <Button type="button" size="sm" variant="ghost" onClick={() => setFeatures([...planFeatures])}><RotateCcw /> Same as the plan</Button>
            )}
          </div>
          <ul className="grid gap-1">
            {PLAN_FEATURES.map((f) => {
              const on = features.includes(f);
              const inPlan = planFeatures.includes(f);
              return (
                <li key={f} className={cn('flex items-center gap-3 rounded-lg px-2 py-1.5', on !== inPlan && 'bg-primary/[0.06]')}>
                  <Switch id={`cf-${f}`} checked={on} onCheckedChange={(v) => setFeatures((cur) => (v ? [...cur, f] : cur.filter((x) => x !== f)))} aria-label={`${PLAN_FEATURE_INFO[f].label} on or off`} />
                  <label htmlFor={`cf-${f}`} className="min-w-0 flex-1 cursor-pointer text-sm">{PLAN_FEATURE_INFO[f].label}</label>
                  {on !== inPlan ? (
                    <Badge variant={on ? 'success' : 'warning'} className="shrink-0">{on ? 'Added for this clinic' : 'Off for this clinic'}</Badge>
                  ) : (
                    <span className="shrink-0 text-2xs text-muted-foreground">{inPlan ? 'In the plan' : 'Not in the plan'}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </fieldset>

        {bill && (
          <div className="flex items-start gap-3 rounded-lg bg-success/[0.07] p-3 ring-1 ring-inset ring-success/15">
            <Wallet className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="mb-2 text-sm font-semibold">Monthly bill</p>
              <BillBreakdown bill={bill} planName={plan!.name} cycle={c.billingCycle} />
              {(billedOverStaff > 0 || billedOverBranches > 0) && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Counted from what the clinic has now: {usage?.staffCounted} staff account{usage?.staffCounted === 1 ? '' : 's'} (active and invited) and {usage?.branches} branch{usage?.branches === 1 ? '' : 'es'}. Every one above the plan is billed.
                </p>
              )}
              {bill.inTrial && <p className="mt-2 text-xs font-medium text-primary">Nothing is charged during the free trial.</p>}
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t pt-3">
          {dirty && <span className="mr-auto text-xs text-muted-foreground">Not saved yet</span>}
          <Button variant="outline" disabled={!dirty || save.isPending} onClick={undo}>Undo</Button>
          <Button loading={save.isPending} disabled={!dirty} onClick={() => save.mutate()}>Save plan</Button>
        </div>
      </CardContent>
    </Card>
  );
}

const endOfDay = (day: string) => new Date(`${day}T23:59:00`).toISOString();
const dayOf = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-CA') : '');
const inDays = (n: number) => new Date(Date.now() + n * 86400_000).toLocaleDateString('en-CA');

/**
 * How the clinic pays (monthly or yearly) and its free trial or free period — e.g. "a free month of Professional,
 * then back to Starter". When it ends the clinic moves to the chosen plan, or is paused until marked as paid.
 */
export function ClinicBillingCard({ overview, onRecordPayment }: { overview: ClinicOverview; onRecordPayment: () => void }) {
  const c = overview.clinic;
  const qc = useQueryClient();
  const plans = useQuery({ queryKey: ['platform-plans'], queryFn: () => api.get<PlatformPlan[]>('/platform/plans') });
  const plan = plans.data?.find((p) => p.id === c.planId) ?? null;
  const [cycle, setCycle] = useState(c.billingCycle);
  const [until, setUntil] = useState(dayOf(c.trialEndsAt));
  const [then, setThen] = useState(c.trialThenPlanId ?? '');
  const inTrial = !!c.trialEndsAt && new Date(c.trialEndsAt) > new Date();
  const dirty = cycle !== c.billingCycle || until !== dayOf(c.trialEndsAt) || (until !== '' && then !== (c.trialThenPlanId ?? ''));

  const save = useMutation({
    mutationFn: (body: { billingCycle: string; trialEndsAt: string | null; trialThenPlanId: string | null }) => api.put(`/platform/clinics/${c.id}/billing`, body),
    onSuccess: (_, body) => {
      toast.success(body.trialEndsAt ? 'Billing and free period saved' : c.trialEndsAt ? 'Free period ended' : 'Billing saved');
      qc.invalidateQueries({ queryKey: ['platform-clinic'] });
      qc.invalidateQueries({ queryKey: ['platform-clinics'] });
      qc.invalidateQueries({ queryKey: ['platform-billing-summary'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!plan) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><CalendarClock className="h-4 w-4" /> Billing cycle &amp; free period</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {inTrial ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg bg-primary/[0.07] p-3 text-sm ring-1 ring-inset ring-primary/15">
            <Gift className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            <p className="min-w-0 flex-1">
              <b>Free until {fmtDate(c.trialEndsAt!)}</b> · {daysLeft(c.trialEndsAt!)} days left · then {c.trialThenPlanId ? `moves to ${plans.data?.find((p) => p.id === c.trialThenPlanId)?.name ?? 'another plan'}` : 'paused until paid'}
            </p>
            <Button size="sm" onClick={onRecordPayment}>
              <BadgeCheck /> Record payment
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{c.pausedReason === 'TRIAL_ENDED' ? 'The free trial ended and the clinic is paused. Recording a payment reactivates it.' : c.pausedReason === 'UNPAID' ? 'Paused for non-payment. Recording a payment reactivates it.' : 'Paying clinic — no free period running. Give a free period below (e.g. a free month of a higher plan).'}</p>
        )}

        <Field label="Pays" htmlFor="b-cycle" hint={c.bill?.yearlyFeeMinor == null ? `${plan.name} has no yearly price` : 'Recording a payment also sets this.'}>
          <NativeSelect id="b-cycle" value={cycle} onChange={(e) => setCycle(e.target.value as typeof cycle)}>
            <option value="MONTHLY">Monthly — {planPrice({ priceMonthlyMinor: c.bill?.monthlyFeeMinor ?? plan.priceMonthlyMinor, currency: plan.currency })} a month</option>
            <option value="YEARLY" disabled={c.bill?.yearlyFeeMinor == null}>A year upfront{c.bill?.yearlyFeeMinor != null ? ` — ${planPrice({ priceMonthlyMinor: c.bill.yearlyFeeMinor, currency: plan.currency })} a year` : ''}</option>
          </NativeSelect>
        </Field>

        <div className="grid gap-3">
          <Field label="Free until" htmlFor="b-until" hint={until ? undefined : 'Empty: no free period'}>
            <Input id="b-until" type="date" min={inDays(1)} value={until} onChange={(e) => setUntil(e.target.value)} />
          </Field>
          <Field label="Then" htmlFor="b-then">
            <NativeSelect id="b-then" value={then} disabled={!until} onChange={(e) => setThen(e.target.value)}>
              <option value="">Pause until paid</option>
              {(plans.data ?? []).filter((p) => p.isActive).map((p) => <option key={p.id} value={p.id}>Move to {p.name}</option>)}
            </NativeSelect>
          </Field>
        </div>
        <div className="flex flex-wrap gap-2">
          {plan.trialDays > 0 && <Button type="button" size="sm" variant="outline" onClick={() => setUntil(inDays(plan.trialDays))}>{plan.trialDays}-day trial</Button>}
          <Button type="button" size="sm" variant="outline" onClick={() => setUntil(inDays(30))}><Gift /> 1 free month</Button>
          {until && <Button type="button" size="sm" variant="ghost" onClick={() => setUntil('')}>No free period</Button>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t pt-3">
          {dirty && <span className="mr-auto text-xs text-muted-foreground">Not saved yet</span>}
          <Button variant="outline" disabled={!dirty || save.isPending} onClick={() => { setCycle(c.billingCycle); setUntil(dayOf(c.trialEndsAt)); setThen(c.trialThenPlanId ?? ''); }}>Undo</Button>
          <Button disabled={!dirty} loading={save.isPending} onClick={() => save.mutate({ billingCycle: cycle, trialEndsAt: until ? endOfDay(until) : null, trialThenPlanId: until && then ? then : null })}>Save billing</Button>
        </div>
      </CardContent>
    </Card>
  );
}
