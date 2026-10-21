'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { planInputSchema, type PlanInput, type PlatformPlan } from '@vcms/shared';
import { Building2, Edit, LayoutList, Plus, Power, Trash2, Users } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useConfirm } from '@/components/confirm';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/page';
import { FeatureList, FeaturePicker, limitText, planPrice } from '@/components/platform/plan-ui';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { ApiError, api } from '@/lib/api';

const EMPTY: PlanInput = { name: '', description: null, priceMonthlyMinor: 0, currency: 'PKR', maxStaff: 5, maxBranches: 1, features: [], isActive: true, sortOrder: 10 };

/** A number box where empty means "no limit". */
function LimitField({ id, label, value, onChange, error, unit }: { id: string; label: string; value: number | null; onChange: (v: number | null) => void; error?: string; unit: string }) {
  return (
    <Field label={label} htmlFor={id} error={error} hint={value === null ? `No limit on ${unit}` : undefined}>
      <div className="flex items-center gap-3">
        <Input id={id} type="number" min={1} className="w-28" disabled={value === null} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? 1 : Number(e.target.value))} />
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={value === null} onCheckedChange={(c) => onChange(c === true ? null : 5)} /> No limit
        </label>
      </div>
    </Field>
  );
}

function PlanDialog({ plan, open, onOpenChange }: { plan: PlatformPlan | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [v, setV] = useState<PlanInput>(EMPTY);
  const [price, setPrice] = useState('0');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [lastOpen, setLastOpen] = useState(false);
  // Fill the form each time the dialog opens (for a new plan, or the plan being edited).
  if (open && !lastOpen) {
    setLastOpen(true);
    setV(plan ? { name: plan.name, description: plan.description, priceMonthlyMinor: plan.priceMonthlyMinor, currency: plan.currency as 'PKR' | 'AUD', maxStaff: plan.maxStaff, maxBranches: plan.maxBranches, features: plan.features, isActive: plan.isActive, sortOrder: plan.sortOrder } : EMPTY);
    setPrice(String((plan?.priceMonthlyMinor ?? 0) / 100));
    setErrors({});
    setError(null);
  }
  if (!open && lastOpen) setLastOpen(false);
  const set = <K extends keyof PlanInput>(k: K, value: PlanInput[K]) => setV((p) => ({ ...p, [k]: value }));

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
    const minor = Math.round(Number(price || 0) * 100);
    const parsed = planInputSchema.safeParse({ ...v, priceMonthlyMinor: Number.isFinite(minor) ? minor : -1 });
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
            {plan?.clinicCount ? `Changes reach all ${plan.clinicCount} clinic${plan.clinicCount === 1 ? '' : 's'} on this plan within seconds. Nobody is removed: a clinic above a lowered limit keeps what it has but cannot add more.` : 'What clinics on this plan may use, and how many staff and branches they may have.'}
          </DialogDescription>
        </DialogHeader>
        <form id="plan-form" onSubmit={submit} className="grid gap-4" noValidate>
          {error && <FormError message={error} />}
          <div className="grid gap-3 sm:grid-cols-[1fr_160px_100px]">
            <Field label="Plan name" htmlFor="p-name" required error={errors.name}>
              <Input id="p-name" value={v.name} onChange={(e) => set('name', e.target.value)} autoFocus />
            </Field>
            <Field label="Price per month" htmlFor="p-price" error={errors.priceMonthlyMinor} hint="For your reference">
              <Input id="p-price" type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} />
            </Field>
            <Field label="Currency" htmlFor="p-cur">
              <NativeSelect id="p-cur" value={v.currency} onChange={(e) => set('currency', e.target.value as 'PKR' | 'AUD')}>
                <option value="PKR">Rs (PKR)</option>
                <option value="AUD">A$ (AUD)</option>
              </NativeSelect>
            </Field>
          </div>
          <Field label="Short description" htmlFor="p-desc" error={errors.description}>
            <Textarea id="p-desc" rows={2} maxLength={300} value={v.description ?? ''} onChange={(e) => set('description', e.target.value || null)} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <LimitField id="p-staff" label="Staff accounts" unit="staff accounts" value={v.maxStaff} onChange={(x) => set('maxStaff', x)} error={errors.maxStaff} />
            <LimitField id="p-branches" label="Branches" unit="branches" value={v.maxBranches} onChange={(x) => set('maxBranches', x)} error={errors.maxBranches} />
          </div>
          <fieldset className="grid gap-1">
            <legend className="mb-1 text-sm font-medium">Included features</legend>
            <p className="mb-1 text-xs text-muted-foreground">Everyday work (clients, patients, appointments, consultations, billing, pharmacy, stock, shop counter, vaccinations) is in every plan.</p>
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

export default function PlansPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<{ plan: PlatformPlan | null } | null>(null);
  const plans = useQuery({ queryKey: ['platform-plans'], queryFn: () => api.get<PlatformPlan[]>('/platform/plans') });

  const toggle = useMutation({
    mutationFn: (p: PlatformPlan) => api.put<PlatformPlan>(`/platform/plans/${p.id}`, { name: p.name, description: p.description, priceMonthlyMinor: p.priceMonthlyMinor, currency: p.currency, maxStaff: p.maxStaff, maxBranches: p.maxBranches, features: p.features, isActive: !p.isActive, sortOrder: p.sortOrder }),
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
                  <CardTitle className="flex flex-wrap items-center gap-2">{p.name} {!p.isActive && <Badge variant="secondary">Switched off</Badge>}</CardTitle>
                  {p.description && <p className="mt-1 text-xs font-normal text-muted-foreground">{p.description}</p>}
                </div>
              </CardHeader>
              <CardContent className="grid gap-3">
                <p className="text-2xl font-semibold">{planPrice(p)}<span className="text-sm font-normal text-muted-foreground"> / month</span></p>
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-lg surface-flat p-2"><dt className="text-xs text-muted-foreground">Staff accounts</dt><dd className="font-semibold">{limitText(p.maxStaff)}</dd></div>
                  <div className="rounded-lg surface-flat p-2"><dt className="text-xs text-muted-foreground">Branches</dt><dd className="font-semibold">{limitText(p.maxBranches)}</dd></div>
                </dl>
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
