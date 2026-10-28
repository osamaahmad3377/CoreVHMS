'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DEFAULT_PLANS, STORAGE_PACK_GB, matchesRecommended, planInputSchema, recommendedPlanMapping, yearlyMonthsFree, yearlyPriceFor, type PlanInput, type PlatformPlan } from '@vcms/shared';
import { ArrowRight, Building2, Edit, Gift, LayoutList, Plus, Power, Sparkles, Star, Trash2, Users } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useConfirm } from '@/components/confirm';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/page';
import { FeatureList, FeaturePicker, limitText, limitWord, planPrice } from '@/components/platform/plan-ui';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { ApiError, api } from '@/lib/api';

const EMPTY: PlanInput = {
  name: '',
  description: null,
  priceMonthlyMinor: 0,
  priceYearlyMinor: null,
  currency: 'PKR',
  maxStaff: 5,
  maxBranches: 1,
  maxAutomations: null,
  maxCustomAutomations: null,
  extraBranchMinor: null,
  extraStaffMinor: null,
  storageGb: 10,
  extraStorageMinor: null,
  trialDays: 0,
  supportResponse: null,
  whatsappSupport: false,
  phoneSupport: false,
  trainingSessions: 0,
  features: [],
  isActive: true,
  sortOrder: 10,
};

const toMajor = (minor: number | null) => (minor == null ? '' : String(minor / 100));
const toMinor = (major: string) => (major.trim() === '' ? null : Math.round(Number(major) * 100));

/** A number box where empty means "no limit". */
function LimitField({ id, label, value, onChange, error, unit, suffix, fallback = 5 }: { id: string; label: string; value: number | null; onChange: (v: number | null) => void; error?: string; unit: string; suffix?: string; fallback?: number }) {
  return (
    <Field label={label} htmlFor={id} error={error} hint={value === null ? `No limit on ${unit}` : undefined}>
      <div className="flex items-center gap-3">
        <Input id={id} type="number" min={1} className="w-28" disabled={value === null} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? 1 : Number(e.target.value))} />
        {suffix && <span className="-ml-1 text-sm text-muted-foreground">{suffix}</span>}
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={value === null} onCheckedChange={(c) => onChange(c === true ? null : fallback)} /> No limit
        </label>
      </div>
    </Field>
  );
}

/** A price in rupees / dollars (stored in minor units); empty = not offered when `optional`. */
function MoneyField({ id, label, value, onChange, error, hint, currency }: { id: string; label: string; value: string; onChange: (v: string) => void; error?: string; hint?: string; currency: string }) {
  return (
    <Field label={label} htmlFor={id} error={error} hint={hint}>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{currency === 'AUD' ? 'A$' : 'Rs'}</span>
        <Input id={id} type="number" min={0} inputMode="decimal" className="pl-10" value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    </Field>
  );
}

/**
 * The yearly offer: a clinic paying a year upfront gets some months free (e.g. 2 → pays for 10 months, gets 12).
 * Choosing the months free sets the yearly price; the price can also be typed for an exact amount.
 */
function YearlyOffer({ monthlyMinor, yearly, onChange, currency, error }: { monthlyMinor: number; yearly: string; onChange: (v: string) => void; currency: string; error?: string }) {
  const on = yearly !== '';
  const yearlyMinor = toMinor(yearly);
  const exact = (n: number) => yearlyMinor === yearlyPriceFor(monthlyMinor, n);
  const free = yearlyMinor != null && monthlyMinor ? yearlyMonthsFree({ priceMonthlyMinor: monthlyMinor, priceYearlyMinor: yearlyMinor }) : 0;
  const custom = on && !exact(free);
  const money = (minor: number) => `${currency === 'AUD' ? 'A$' : 'Rs '}${(minor / 100).toLocaleString('en', { maximumFractionDigits: 0 })}`;
  const setFree = (n: number) => onChange(toMajor(yearlyPriceFor(monthlyMinor, n)));
  return (
    <div className="grid gap-3 rounded-lg border border-dashed p-3">
      <label className="flex items-start gap-2 text-sm">
        <Checkbox checked={on} onCheckedChange={(c) => (c === true ? setFree(2) : onChange(''))} className="mt-0.5" />
        <span>
          <span className="font-medium">Yearly price, paid upfront</span>
          <span className="block text-xs text-muted-foreground">Clinics that pay a year in advance get months free.</span>
        </span>
      </label>
      {on && (
        <>
          <div className="grid gap-1.5">
            <span className="text-sm font-medium" id="free-months-label">Months free</span>
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-labelledby="free-months-label">
              {[0, 1, 2, 3, 4].map((n) => (
                <Button key={n} type="button" size="sm" variant={!custom && free === n ? 'secondary' : 'outline'} aria-pressed={!custom && free === n} onClick={() => setFree(n)} className="px-3">
                  {n === 0 ? 'None' : <><Gift /> {n}</>}
                </Button>
              ))}
              <Input type="number" min={0} max={11} aria-label="Months free (number)" className="h-9 w-16 text-center" value={custom ? '' : free} placeholder="–" onChange={(e) => setFree(Math.max(0, Math.min(11, Number(e.target.value) || 0)))} />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <MoneyField id="p-year" label="Yearly price" currency={currency} value={yearly} onChange={onChange} error={error} hint={custom ? `A custom price — about ${free} month${free === 1 ? '' : 's'} free. Choose the months free above to round it.` : 'Set by the months free; type a different amount for an exact price.'} />
          </div>
          {yearlyMinor != null && monthlyMinor > 0 && (
            <p className="rounded-md bg-success/[0.08] px-3 py-2 text-xs text-success">
              {money(yearlyMinor)} a year — the clinic pays for {Math.round(yearlyMinor / monthlyMinor)} months and gets 12{monthlyMinor * 12 > yearlyMinor ? `, saving ${money(monthlyMinor * 12 - yearlyMinor)}` : ''}.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="grid gap-3 rounded-xl surface-flat p-4">
      <legend className="px-1 text-sm font-semibold">{title}</legend>
      {children}
    </fieldset>
  );
}

function PlanDialog({ plan, open, onOpenChange }: { plan: PlatformPlan | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [v, setV] = useState<PlanInput>(EMPTY);
  const [prices, setPrices] = useState({ monthly: '0', yearly: '', branch: '', staff: '', storage: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [lastOpen, setLastOpen] = useState(false);
  // Fill the form each time the dialog opens (for a new plan, or the plan being edited).
  if (open && !lastOpen) {
    setLastOpen(true);
    const start: PlanInput = plan
      ? {
          name: plan.name,
          description: plan.description,
          priceMonthlyMinor: plan.priceMonthlyMinor,
          priceYearlyMinor: plan.priceYearlyMinor,
          currency: plan.currency as 'PKR' | 'AUD',
          maxStaff: plan.maxStaff,
          maxBranches: plan.maxBranches,
          maxAutomations: plan.maxAutomations,
          maxCustomAutomations: plan.maxCustomAutomations,
          extraBranchMinor: plan.extraBranchMinor,
          extraStaffMinor: plan.extraStaffMinor,
          storageGb: plan.storageGb,
          extraStorageMinor: plan.extraStorageMinor,
          trialDays: plan.trialDays,
          supportResponse: plan.supportResponse,
          whatsappSupport: plan.whatsappSupport,
          phoneSupport: plan.phoneSupport,
          trainingSessions: plan.trainingSessions,
          features: plan.features,
          isActive: plan.isActive,
          sortOrder: plan.sortOrder,
        }
      : EMPTY;
    setV(start);
    setPrices({ monthly: toMajor(start.priceMonthlyMinor) || '0', yearly: toMajor(start.priceYearlyMinor), branch: toMajor(start.extraBranchMinor), staff: toMajor(start.extraStaffMinor), storage: toMajor(start.extraStorageMinor) });
    setErrors({});
    setError(null);
  }
  if (!open && lastOpen) setLastOpen(false);
  const set = <K extends keyof PlanInput>(k: K, value: PlanInput[K]) => setV((p) => ({ ...p, [k]: value }));
  const setPrice = (k: keyof typeof prices) => (x: string) =>
    setPrices((p) => {
      // Changing the monthly price keeps the same months free on the yearly price.
      if (k !== 'monthly' || p.yearly === '') return { ...p, [k]: x };
      const before = toMinor(p.monthly) ?? 0;
      const yearly = toMinor(p.yearly);
      const free = before && yearly != null ? yearlyMonthsFree({ priceMonthlyMinor: before, priceYearlyMinor: yearly }) : 0;
      const matched = yearly === yearlyPriceFor(before, free);
      return { ...p, monthly: x, yearly: matched ? toMajor(yearlyPriceFor(toMinor(x) ?? 0, free)) : p.yearly };
    });
  const monthlyMinor = toMinor(prices.monthly) ?? 0;

  const save = useMutation({
    mutationFn: (input: PlanInput) => (plan ? api.put<PlatformPlan>(`/platform/plans/${plan.id}`, input) : api.post<PlatformPlan>('/platform/plans', input)),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ['platform-plans'] });
      qc.invalidateQueries({ queryKey: ['platform-clinics'] });
      qc.invalidateQueries({ queryKey: ['platform-clinic'] });
      toast.success(plan ? `${p.name} saved${plan.clinicCount ? ` — ${plan.clinicCount} clinic${plan.clinicCount === 1 ? '' : 's'} updated` : ''}` : `${p.name} added`);
      onOpenChange(false);
    },
    onError: (e: Error) => {
      if (e instanceof ApiError) setErrors(e.fieldErrors);
      setError(e.message);
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = planInputSchema.safeParse({
      ...v,
      priceMonthlyMinor: monthlyMinor,
      priceYearlyMinor: toMinor(prices.yearly),
      extraBranchMinor: toMinor(prices.branch),
      extraStaffMinor: toMinor(prices.staff),
      extraStorageMinor: v.storageGb === null ? null : toMinor(prices.storage),
    });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
      return;
    }
    setErrors({});
    save.mutate(parsed.data);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{plan ? `Edit ${plan.name}` : 'Add plan'}</DialogTitle>
          <DialogDescription>
            {plan?.clinicCount ? `Changes reach all ${plan.clinicCount} clinic${plan.clinicCount === 1 ? '' : 's'} on this plan within seconds. Nobody is removed: a clinic above a lowered limit keeps what it has but cannot add more.` : 'Prices, limits, support and the features clinics on this plan get.'}
          </DialogDescription>
        </DialogHeader>
        <form id="plan-form" onSubmit={submit} className="grid gap-4" noValidate>
          {error && <FormError message={error} />}
          <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
            <Field label="Plan name" htmlFor="p-name" required error={errors.name}>
              <Input id="p-name" value={v.name} onChange={(e) => set('name', e.target.value)} autoFocus />
            </Field>
            <Field label="Currency" htmlFor="p-cur">
              <NativeSelect id="p-cur" value={v.currency} onChange={(e) => set('currency', e.target.value as 'PKR' | 'AUD')}>
                <option value="PKR">Rs (PKR)</option>
                <option value="AUD">A$ (AUD)</option>
              </NativeSelect>
            </Field>
          </div>
          <Field label="Short description" htmlFor="p-desc" error={errors.description} hint="Shown to clinics when they compare plans.">
            <Textarea id="p-desc" rows={2} maxLength={300} value={v.description ?? ''} onChange={(e) => set('description', e.target.value || null)} />
          </Field>

          <Section title="Prices">
            <div className="grid gap-3 sm:grid-cols-2">
              <MoneyField id="p-price" label="Monthly" currency={v.currency} value={prices.monthly} onChange={setPrice('monthly')} error={errors.priceMonthlyMinor} />
            </div>
            <YearlyOffer monthlyMinor={monthlyMinor} yearly={prices.yearly} onChange={setPrice('yearly')} currency={v.currency} error={errors.priceYearlyMinor} />
            <div className="grid gap-3 sm:grid-cols-2">
              <MoneyField id="p-xbranch" label="Each extra branch, per month" currency={v.currency} value={prices.branch} onChange={setPrice('branch')} error={errors.extraBranchMinor} hint={prices.branch === '' ? 'Empty: extra branches not offered' : undefined} />
              <MoneyField id="p-xstaff" label="Each extra staff account, per month" currency={v.currency} value={prices.staff} onChange={setPrice('staff')} error={errors.extraStaffMinor} hint={prices.staff === '' ? 'Empty: extra staff not offered' : undefined} />
            </div>
            <Field label="Free trial for new clinics" htmlFor="p-trial" error={errors.trialDays} hint={v.trialDays ? 'Nothing is charged during the trial. When it ends the clinic is paused until a payment is recorded.' : 'No free trial'}>
              <div className="flex items-center gap-2">
                <Input id="p-trial" type="number" min={0} max={365} className="w-24" value={v.trialDays} onChange={(e) => set('trialDays', Math.max(0, Number(e.target.value) || 0))} />
                <span className="text-sm text-muted-foreground">days</span>
              </div>
            </Field>
          </Section>

          <Section title="Limits">
            <div className="grid gap-3 sm:grid-cols-2">
              <LimitField id="p-staff" label="Staff accounts" unit="staff accounts" value={v.maxStaff} onChange={(x) => set('maxStaff', x)} error={errors.maxStaff} />
              <LimitField id="p-branches" label="Branches" unit="branches" value={v.maxBranches} onChange={(x) => set('maxBranches', x)} error={errors.maxBranches} />
              <LimitField id="p-automations" label="Ready-made automations switched on" unit="ready-made automations" value={v.maxAutomations} onChange={(x) => set('maxAutomations', x)} error={errors.maxAutomations} />
              <LimitField id="p-custom" label="Own automations switched on" unit="the clinic’s own automations" value={v.maxCustomAutomations} onChange={(x) => set('maxCustomAutomations', x)} error={errors.maxCustomAutomations} />
              <LimitField id="p-storage" label="File storage (documents, photos, X-rays)" unit="file storage" suffix="GB" fallback={10} value={v.storageGb} onChange={(x) => set('storageGb', x)} error={errors.storageGb} />
              {v.storageGb !== null && (
                <MoneyField id="p-xstorage" label={`Each extra ${STORAGE_PACK_GB} GB of storage, per month`} currency={v.currency} value={prices.storage} onChange={setPrice('storage')} error={errors.extraStorageMinor} hint={prices.storage === '' ? 'Empty: extra storage not offered' : undefined} />
              )}
            </div>
          </Section>

          <Section title="Support">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Help centre and email: reply within" htmlFor="p-support" error={errors.supportResponse} hint="e.g. 2 working days, 4 hours">
                <Input id="p-support" maxLength={60} value={v.supportResponse ?? ''} onChange={(e) => set('supportResponse', e.target.value || null)} />
              </Field>
              <Field label="Free staff training sessions" htmlFor="p-training" error={errors.trainingSessions}>
                <Input id="p-training" type="number" min={0} max={100} className="w-24" value={v.trainingSessions} onChange={(e) => set('trainingSessions', Math.max(0, Number(e.target.value) || 0))} />
              </Field>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={v.whatsappSupport} onCheckedChange={(c) => set('whatsappSupport', c === true)} /> WhatsApp support</label>
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={v.phoneSupport} onCheckedChange={(c) => set('phoneSupport', c === true)} /> Phone support</label>
            </div>
          </Section>

          <fieldset className="grid gap-1">
            <legend className="mb-1 text-sm font-semibold">Included features</legend>
            <p className="mb-1 text-xs text-muted-foreground">Everyday work (front desk, clients, patients, appointments, consultations, billing, pharmacy, stock, shop counter, vaccinations, client emails, online booking) is in every plan.</p>
            <FeaturePicker value={v.features} onChange={(f) => set('features', f)} idPrefix="plan" />
          </fieldset>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={v.isActive} onCheckedChange={(c) => set('isActive', c === true)} className="mt-0.5" />
            <span>Available for new clinics<span className="block text-xs text-muted-foreground">Switch off to stop choosing this plan for more clinics. Clinics already on it keep it.</span></span>
          </label>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="plan-form" loading={save.isPending}>{plan ? 'Save plan' : 'Add plan'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Offers to bring the plans in line with the recommended Starter, Professional and Premium, showing exactly what
 * happens to each existing plan. Hidden once the plans match.
 */
function RecommendedPlans({ plans }: { plans: PlatformPlan[] }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const apply = useMutation({
    mutationFn: () => api.post<PlatformPlan[]>('/platform/plans/recommended', {}),
    onSuccess: () => {
      toast.success('Plans updated to Starter, Professional and Premium');
      qc.invalidateQueries({ queryKey: ['platform-plans'] });
      qc.invalidateQueries({ queryKey: ['platform-clinics'] });
      qc.invalidateQueries({ queryKey: ['platform-clinic'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (DEFAULT_PLANS.every((d) => plans.some((p) => p.name === d.name && matchesRecommended(p)))) return null;
  const rows = recommendedPlanMapping(plans);
  const moving = rows.reduce((n, r) => n + ((r.replaces && plans.find((p) => p.id === r.replaces!.id)?.clinicCount) || 0), 0);
  const what = (r: (typeof rows)[number]) => {
    const clinics = r.replaces ? plans.find((p) => p.id === r.replaces!.id)?.clinicCount ?? 0 : 0;
    const who = clinics ? ` · ${clinics} clinic${clinics === 1 ? '' : 's'} move${clinics === 1 ? 's' : ''} with it` : '';
    if (!r.replaces) return 'New plan';
    return r.replaces.name === r.recommended.name ? `Updated${who}` : `Replaces ${r.replaces.name}${who}`;
  };
  return (
    <section aria-labelledby="rec-title" className="relative mb-5 overflow-hidden rounded-2xl bg-gradient-to-br from-primary/[0.10] via-brand-2/[0.06] to-transparent p-5 ring-1 ring-inset ring-primary/15">
      <div className="flex flex-wrap items-start gap-4">
        <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-brand-2 text-white shadow">
          <Sparkles className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1 basis-72">
          <h2 id="rec-title" className="font-semibold tracking-tight">Use the recommended plans</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Starter, Professional and Premium, with the prices, limits and features recommended for clinics in Pakistan. Clinics stay on their plan and get the new limits straight away; nobody loses staff or branches.
          </p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-3">
            {rows.map((r) => (
              <li key={r.recommended.name} className="rounded-xl bg-card/80 p-3 text-sm shadow-sm ring-1 ring-inset ring-foreground/[0.06]">
                <p className="flex items-center gap-1.5 font-semibold">
                  {r.replaces && r.replaces.name !== r.recommended.name && (<><span className="font-normal text-muted-foreground line-through">{r.replaces.name}</span><ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-label="becomes" /></>)}
                  {r.recommended.name}
                </p>
                <p className="mt-0.5 text-muted-foreground">
                  {planPrice({ priceMonthlyMinor: r.recommended.priceMonthlyMinor, currency: 'PKR' })} / month · {limitWord(r.recommended.maxStaff)} staff · {limitWord(r.recommended.maxBranches)} branch{r.recommended.maxBranches === 1 ? '' : 'es'}
                </p>
                <p className="mt-1 text-xs font-medium text-primary">{what(r)}</p>
              </li>
            ))}
          </ul>
        </div>
        <Button
          loading={apply.isPending}
          onClick={async () => {
            const r = await confirm({
              title: 'Use the recommended plans?',
              description: `Prices, limits and features of these plans change to the recommended ones.${moving ? ` ${moving} clinic${moving === 1 ? '' : 's'} on them get the new plan within seconds.` : ''} Other plans are not changed.`,
              confirmLabel: 'Use recommended plans',
            });
            if (r.confirmed) apply.mutate();
          }}
        >
          <Sparkles /> Use recommended plans
        </Button>
      </div>
    </section>
  );
}

export default function PlansPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<{ plan: PlatformPlan | null } | null>(null);
  const plans = useQuery({ queryKey: ['platform-plans'], queryFn: () => api.get<PlatformPlan[]>('/platform/plans') });

  const toggle = useMutation({
    mutationFn: (p: PlatformPlan) => api.put<PlatformPlan>(`/platform/plans/${p.id}`, { name: p.name, description: p.description, priceMonthlyMinor: p.priceMonthlyMinor, currency: p.currency, maxStaff: p.maxStaff, maxBranches: p.maxBranches, maxAutomations: p.maxAutomations, features: p.features, isActive: !p.isActive, sortOrder: p.sortOrder }),
    onSuccess: (p) => {
      toast.success(p.isActive ? `${p.name} is available again` : `${p.name} switched off for new clinics`);
      qc.invalidateQueries({ queryKey: ['platform-plans'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (p: PlatformPlan) => api.del(`/platform/plans/${p.id}`),
    onSuccess: () => {
      toast.success('Plan deleted');
      qc.invalidateQueries({ queryKey: ['platform-plans'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <PageHeader
        title="Plans"
        description="What each kind of clinic may use, and how many staff and branches it may have. Choose a clinic’s plan on its own page."
        actions={<Button onClick={() => setEditing({ plan: null })}><Plus /> Add plan</Button>}
      />
      {plans.data && <RecommendedPlans plans={plans.data} />}
      {plans.isLoading ? (
        <LoadingRows />
      ) : plans.error ? (
        <ErrorState error={plans.error} onRetry={() => plans.refetch()} />
      ) : !plans.data?.length ? (
        <Card><EmptyState icon={LayoutList} title="No plans yet" action={<Button onClick={() => setEditing({ plan: null })}><Plus /> Add plan</Button>} /></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {plans.data.map((p) => (
            <Card key={p.id} className={p.isActive ? '' : 'opacity-75'}>
              <CardHeader>
                <div className="min-w-0">
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    {p.name}
                    {p.name === DEFAULT_PLANS[1].name && p.isActive && <Badge><Star className="h-3 w-3" /> Most popular</Badge>}
                    {!p.isActive && <Badge variant="secondary">Switched off</Badge>}
                  </CardTitle>
                  {p.description && <p className="mt-1 text-xs font-normal text-muted-foreground">{p.description}</p>}
                </div>
              </CardHeader>
              <CardContent className="grid gap-3">
                <div>
                  <p className="text-2xl font-semibold">{planPrice(p)}<span className="text-sm font-normal text-muted-foreground"> / month</span></p>
                  {p.priceYearlyMinor != null && (
                    <p className="text-xs text-muted-foreground">
                      or {planPrice({ priceMonthlyMinor: p.priceYearlyMinor, currency: p.currency })} / year{yearlyMonthsFree(p) ? ` · ${yearlyMonthsFree(p)} months free` : ''}
                    </p>
                  )}
                </div>
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-lg surface-flat p-2"><dt className="text-xs text-muted-foreground">Staff accounts</dt><dd className="font-semibold">{limitText(p.maxStaff)}</dd></div>
                  <div className="rounded-lg surface-flat p-2"><dt className="text-xs text-muted-foreground">Branches</dt><dd className="font-semibold">{limitText(p.maxBranches)}</dd></div>
                  <div className="rounded-lg surface-flat p-2"><dt className="text-xs text-muted-foreground">Ready-made automations on</dt><dd className="font-semibold">{limitText(p.maxAutomations)}</dd></div>
                  <div className="rounded-lg surface-flat p-2"><dt className="text-xs text-muted-foreground">Own automations on</dt><dd className="font-semibold">{limitText(p.maxCustomAutomations)}</dd></div>
                  <div className="col-span-2 rounded-lg surface-flat p-2"><dt className="text-xs text-muted-foreground">File storage</dt><dd className="font-semibold">{p.storageGb == null ? 'Unlimited' : `${p.storageGb} GB`}</dd></div>
                </dl>
                <ul className="grid gap-1 text-xs text-muted-foreground">
                  <li>Extra branch: {p.extraBranchMinor != null ? `${planPrice({ priceMonthlyMinor: p.extraBranchMinor, currency: p.currency })} / month` : 'not offered'} · Extra staff: {p.extraStaffMinor != null ? `${planPrice({ priceMonthlyMinor: p.extraStaffMinor, currency: p.currency })} / month` : 'not offered'}</li>
                  {p.storageGb != null && <li>Extra {STORAGE_PACK_GB} GB storage: {p.extraStorageMinor != null ? `${planPrice({ priceMonthlyMinor: p.extraStorageMinor, currency: p.currency })} / month` : 'not offered'}</li>}
                  <li>Free trial: {p.trialDays ? `${p.trialDays} days` : 'none'}</li>
                  <li>
                    Support: {p.supportResponse ? `reply within ${p.supportResponse}` : 'help centre'}
                    {p.whatsappSupport ? ' · WhatsApp' : ''}
                    {p.phoneSupport ? ' · phone' : ''}
                    {p.trainingSessions ? ` · ${p.trainingSessions} training session${p.trainingSessions === 1 ? '' : 's'}` : ''}
                  </li>
                </ul>
                <FeatureList features={p.features} />
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Building2 className="h-3.5 w-3.5" /> {p.clinicCount} clinic{p.clinicCount === 1 ? '' : 's'} on this plan</p>
                <div className="flex flex-wrap gap-2 border-t pt-3">
                  <Button size="sm" variant="outline" onClick={() => setEditing({ plan: p })}><Edit /> Edit</Button>
                  <Button size="sm" variant="ghost" loading={toggle.isPending && toggle.variables?.id === p.id} onClick={() => toggle.mutate(p)}><Power /> {p.isActive ? 'Switch off' : 'Switch on'}</Button>
                  {!p.clinicCount && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={async () => {
                        const r = await confirm({ title: `Delete ${p.name}?`, description: 'No clinic is on this plan. This cannot be undone.', confirmLabel: 'Delete plan', destructive: true });
                        if (r.confirmed) remove.mutate(p);
                      }}
                    >
                      <Trash2 /> Delete
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground"><Users className="h-3.5 w-3.5" /> Staff accounts counted: active and invited people. Paused staff and paused branches do not count.</p>
      <PlanDialog plan={editing?.plan ?? null} open={!!editing} onOpenChange={(o) => !o && setEditing(null)} />
    </>
  );
}
