'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PLAN_FEATURES, type ClinicOverview, type PlanFeature, type PlatformPlan } from '@vcms/shared';
import { AlertTriangle, LayoutList } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { Field } from '@/components/forms/field';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, NativeSelect } from '@/components/ui/input';
import { api } from '@/lib/api';
import { FeaturePicker, limitText } from './plan-ui';

/** A bar showing how much of a limit is used. */
function UsageBar({ label, used, limit }: { label: string; used: number | null; limit: number | null }) {
  const pct = limit && used !== null ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const over = limit !== null && used !== null && used > limit;
  return (
    <div className="grid gap-1">
      <div className="flex items-baseline justify-between text-sm">
        <span>{label}</span>
        <span className={over ? 'font-semibold text-destructive' : 'font-medium'}>{used === null ? '—' : used} <span className="font-normal text-muted-foreground">of {limitText(limit).toLowerCase()}</span></span>
      </div>
      {limit !== null && (
        <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={`${label} used`} aria-valuenow={used ?? 0} aria-valuemin={0} aria-valuemax={limit}>
          <div className={`h-full rounded-full ${over ? 'bg-destructive' : pct >= 90 ? 'bg-warning' : 'bg-primary'}`} style={{ width: `${over ? 100 : pct}%` }} />
        </div>
      )}
    </div>
  );
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** Choose a clinic's plan and, where needed, exceptions for this clinic only. */
export function ClinicPlanCard({ overview }: { overview: ClinicOverview }) {
  const { clinic: c, usage } = overview;
  const qc = useQueryClient();
  const plans = useQuery({ queryKey: ['platform-plans'], queryFn: () => api.get<PlatformPlan[]>('/platform/plans') });
  // The form starts from what the clinic has now; changing the plan starts the exceptions again.
  const [planId, setPlanId] = useState<string>(c.planId ?? '');
  const [staff, setStaff] = useState(c.staffLimitOverride ? String(c.staffLimitOverride) : '');
  const [branches, setBranches] = useState(c.branchLimitOverride ? String(c.branchLimitOverride) : '');
  const [features, setFeatures] = useState<PlanFeature[]>(c.entitlements.features);

  const plan = plans.data?.find((p) => p.id === planId) ?? null;
  const choices = (plans.data ?? []).filter((p) => p.isActive || p.id === c.planId);
  const planFeatures = plan?.features ?? [...PLAN_FEATURES];
  const extra = features.filter((f) => !planFeatures.includes(f));
  const removed = planFeatures.filter((f) => !features.includes(f));
  const staffLimit = staff ? Number(staff) : (plan?.maxStaff ?? null);
  const branchLimit = branches ? Number(branches) : (plan?.maxBranches ?? null);
  const staffUsed = usage?.staffCounted ?? null;
  const branchesUsed = usage?.branches ?? null;
  const invalid = (staff !== '' && !(Number(staff) >= 1)) || (branches !== '' && !(Number(branches) >= 1));

  const dirty =
    planId !== (c.planId ?? '') ||
    (staff === '' ? null : Number(staff)) !== c.staffLimitOverride ||
    (branches === '' ? null : Number(branches)) !== c.branchLimitOverride ||
    !sameSet(extra, c.extraFeatures) ||
    !sameSet(removed, c.removedFeatures);
  const overStaff = staffLimit !== null && staffUsed !== null && staffUsed > staffLimit;
  const overBranches = branchLimit !== null && branchesUsed !== null && branchesUsed > branchLimit;

  const choosePlan = (id: string) => {
    setPlanId(id);
    setStaff('');
    setBranches('');
    setFeatures(plans.data?.find((p) => p.id === id)?.features ?? [...PLAN_FEATURES]);
  };

  const save = useMutation({
    mutationFn: () =>
      api.put(`/platform/clinics/${c.id}/plan`, {
        planId: planId || null,
        staffLimitOverride: planId && staff ? Number(staff) : null,
        branchLimitOverride: planId && branches ? Number(branches) : null,
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><LayoutList className="h-4 w-4" /> Plan &amp; limits</CardTitle>
        <Link href="/platform/plans" className="text-xs text-primary hover:underline">Manage plans</Link>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Field label="Plan" htmlFor="clinic-plan" hint={plan ? `${plan.name}: ${limitText(plan.maxStaff).toLowerCase()} staff, ${limitText(plan.maxBranches).toLowerCase()} branches` : 'No limits: the clinic can use everything.'}>
          <NativeSelect id="clinic-plan" value={planId} onChange={(e) => choosePlan(e.target.value)} disabled={plans.isLoading}>
            <option value="">No plan (no limits)</option>
            {choices.map((p) => <option key={p.id} value={p.id}>{p.name}{p.isActive ? '' : ' (switched off)'}</option>)}
          </NativeSelect>
        </Field>

        <div className="grid gap-3 rounded-lg surface-flat p-3">
          <UsageBar label="Staff accounts" used={staffUsed} limit={staffLimit} />
          <UsageBar label="Branches" used={branchesUsed} limit={branchLimit} />
          {(overStaff || overBranches) && (
            <p className="flex items-start gap-2 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              The clinic is above this limit. Nobody is removed — it keeps what it has but cannot add more until it is under the limit.
            </p>
          )}
        </div>

        {planId && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Staff limit for this clinic" htmlFor="ov-staff" hint={staff ? 'Replaces the plan’s limit' : `Leave empty to follow the plan (${limitText(plan?.maxStaff ?? null).toLowerCase()})`}>
              <Input id="ov-staff" type="number" min={1} placeholder={limitText(plan?.maxStaff ?? null)} value={staff} onChange={(e) => setStaff(e.target.value)} />
            </Field>
            <Field label="Branch limit for this clinic" htmlFor="ov-branches" hint={branches ? 'Replaces the plan’s limit' : `Leave empty to follow the plan (${limitText(plan?.maxBranches ?? null).toLowerCase()})`}>
              <Input id="ov-branches" type="number" min={1} placeholder={limitText(plan?.maxBranches ?? null)} value={branches} onChange={(e) => setBranches(e.target.value)} />
            </Field>
          </div>
        )}

        <fieldset className="grid gap-1">
          <legend className="mb-1 text-sm font-medium">Features this clinic can use</legend>
          <FeaturePicker value={features} onChange={setFeatures} idPrefix="clinic" />
          {(extra.length > 0 || removed.length > 0) && (
            <p className="mt-1 text-xs text-muted-foreground">
              Different from the plan for this clinic only:
              {extra.length > 0 && <> <b>added</b> {extra.join(', ')}.</>}
              {removed.length > 0 && <> <b>taken away</b> {removed.join(', ')}.</>}
            </p>
          )}
        </fieldset>

        <div className="flex items-center justify-end gap-2 border-t pt-3">
          {dirty && <span className="mr-auto text-xs text-muted-foreground">Not saved yet</span>}
          <Button variant="outline" disabled={!dirty || save.isPending} onClick={() => { setPlanId(c.planId ?? ''); setStaff(c.staffLimitOverride ? String(c.staffLimitOverride) : ''); setBranches(c.branchLimitOverride ? String(c.branchLimitOverride) : ''); setFeatures(c.entitlements.features); }}>Undo</Button>
          <Button loading={save.isPending} disabled={!dirty || invalid} onClick={() => save.mutate()}>Save plan</Button>
        </div>
      </CardContent>
    </Card>
  );
}
