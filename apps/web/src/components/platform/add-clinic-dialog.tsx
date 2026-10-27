'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { COUNTRIES, type CreateClinicInput, type PlatformPlan, createClinicSchema } from '@vcms/shared';
import { KeyRound, Mail, Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect } from '@/components/ui/input';
import { ApiError, api } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { useHostInfo } from '@/lib/host';
import { cn } from '@/lib/utils';
import type { OwnerAccess } from './clinic-ui';
import { limitWord, planPrice } from './plan-ui';

/** Suggests a web address from the clinic name: "Happy Paws Vet" → "happy-paws-vet". */
function suggestAddress(name: string) {
  const s = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^[^a-z]+/, '');
  return s.slice(0, 30).replace(/-+$/, '');
}

const EMPTY: CreateClinicInput = { name: '', slug: '', country: 'PK', branchName: 'Main branch', ownerName: '', ownerEmail: '', ownerAccess: 'TEMPORARY_PASSWORD', planId: null, billingCycle: 'MONTHLY', startTrial: true };

export function AddClinicDialog({ open, onOpenChange, onOwnerAccess }: { open: boolean; onOpenChange: (o: boolean) => void; onOwnerAccess: (r: OwnerAccess) => void }) {
  const qc = useQueryClient();
  const baseDomain = useHostInfo().data?.baseDomain;
  const plans = useQuery({ queryKey: ['platform-plans'], queryFn: () => api.get<PlatformPlan[]>('/platform/plans') });
  const available = (plans.data ?? []).filter((p) => p.isActive);
  const [v, setV] = useState<CreateClinicInput>(EMPTY);
  // undefined = not touched: the first available plan is chosen for the new clinic ('' = deliberately no plan).
  const [planChoice, setPlanChoice] = useState<string | undefined>(undefined);
  const planId = planChoice ?? available[0]?.id ?? '';
  const chosen = available.find((p) => p.id === planId) ?? null;
  const [addressEdited, setAddressEdited] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof CreateClinicInput>(k: K, value: CreateClinicInput[K]) => setV((p) => ({ ...p, [k]: value }));

  const reset = () => {
    setV(EMPTY);
    setPlanChoice(undefined);
    setAddressEdited(false);
    setErrors({});
    setError(null);
  };

  const save = useMutation({
    mutationFn: (input: CreateClinicInput) => api.post<OwnerAccess & { temporaryPassword: string | null }>('/platform/clinics', input),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['platform-clinics'] });
      qc.invalidateQueries({ queryKey: ['platform-billing-summary'] });
      onOpenChange(false);
      reset();
      if (r.temporaryPassword) onOwnerAccess(r as OwnerAccess);
      else toast.success(`Setting up ${r.clinic.name}. The owner gets an email when it is ready.`);
    },
    onError: (e: Error) => {
      if (e instanceof ApiError) setErrors(e.fieldErrors);
      setError(e.message);
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = createClinicSchema.safeParse({ ...v, planId: planId || null, billingCycle: chosen?.priceYearlyMinor != null ? v.billingCycle : 'MONTHLY', startTrial: !!chosen?.trialDays && v.startTrial });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
      return;
    }
    setErrors({});
    save.mutate(parsed.data);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Add clinic</DialogTitle>
          <DialogDescription>Four things: the clinic’s name, its web address, and who the owner is. It is ready in about a minute.</DialogDescription>
        </DialogHeader>
        <form id="add-clinic" onSubmit={submit} className="grid gap-4" noValidate>
          {error && <FormError message={error} />}
          <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
            <Field label="Clinic name" htmlFor="c-name" required error={errors.name}>
              <Input
                id="c-name"
                value={v.name}
                onChange={(e) => {
                  set('name', e.target.value);
                  if (!addressEdited) set('slug', suggestAddress(e.target.value));
                }}
                autoFocus
              />
            </Field>
            <Field label="Country" htmlFor="c-country" required>
              <NativeSelect id="c-country" value={v.country} onChange={(e) => set('country', e.target.value as 'PK' | 'AU')}>
                {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
              </NativeSelect>
            </Field>
          </div>
          <Field label="Web address" htmlFor="c-slug" required hint="Filled in from the name. Lowercase letters, numbers and hyphens; it cannot be changed later." error={errors.slug}>
            <div className="flex items-center gap-2">
              <Input
                id="c-slug"
                value={v.slug}
                onChange={(e) => { setAddressEdited(true); set('slug', e.target.value.toLowerCase()); }}
                autoCapitalize="none"
                spellCheck={false}
                placeholder="happy-paws"
              />
              {baseDomain && <span className="shrink-0 text-sm text-muted-foreground">.{baseDomain}</span>}
            </div>
          </Field>
          <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
            <Field label="Plan" htmlFor="c-plan" hint="What the clinic may use, and its limits. You can change it later.">
              <NativeSelect id="c-plan" value={planId} onChange={(e) => setPlanChoice(e.target.value)} disabled={plans.isLoading}>
                {available.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} — {planPrice(p)}/month · {limitWord(p.maxStaff)} staff · {limitWord(p.maxBranches)} branch{p.maxBranches === 1 ? '' : 'es'}</option>
                ))}
                <option value="">No plan (no limits)</option>
              </NativeSelect>
            </Field>
            <Field label="Billing" htmlFor="c-cycle">
              <NativeSelect id="c-cycle" value={v.billingCycle} onChange={(e) => set('billingCycle', e.target.value as 'MONTHLY' | 'YEARLY')} disabled={!chosen}>
                <option value="MONTHLY">Monthly</option>
                <option value="YEARLY" disabled={chosen?.priceYearlyMinor == null}>Yearly{chosen?.priceYearlyMinor != null ? ` (${planPrice({ priceMonthlyMinor: chosen.priceYearlyMinor, currency: chosen.currency })})` : ''}</option>
              </NativeSelect>
            </Field>
          </div>
          {chosen && chosen.trialDays > 0 && (
            <label className="flex items-start gap-2 rounded-lg surface-flat p-3 text-sm">
              <Checkbox checked={v.startTrial} onCheckedChange={(c) => set('startTrial', c === true)} className="mt-0.5" />
              <span>
                Start with the {chosen.trialDays}-day free trial
                <span className="block text-xs text-muted-foreground">Nothing is charged until {fmtDate(new Date(Date.now() + chosen.trialDays * 86400_000).toISOString())}. If it is not marked as paid by then, the clinic is paused (its records are kept).</span>
              </span>
            </label>
          )}
          <fieldset className="grid gap-3 rounded-lg surface-flat p-3">
            <legend className="px-1 text-sm font-medium">Clinic owner</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Full name" htmlFor="c-owner" required error={errors.ownerName}>
                <Input id="c-owner" value={v.ownerName} onChange={(e) => set('ownerName', e.target.value)} />
              </Field>
              <Field label="Email" htmlFor="c-email" required hint="They sign in with this." error={errors.ownerEmail}>
                <Input id="c-email" type="email" value={v.ownerEmail} onChange={(e) => set('ownerEmail', e.target.value)} />
              </Field>
            </div>
            <div role="radiogroup" aria-label="How the owner gets access" className="grid gap-2 sm:grid-cols-2">
              {([
                ['TEMPORARY_PASSWORD', KeyRound, 'Give them a password', 'You get a ready-made message to send by WhatsApp or SMS.'],
                ['INVITATION', Mail, 'Email them a link', 'They choose their own password when the clinic is ready.'],
              ] as const).map(([value, Icon, title, text]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={v.ownerAccess === value}
                  onClick={() => set('ownerAccess', value)}
                  className={cn('flex items-start gap-3 rounded-lg surface-flat p-3 text-left text-sm transition-colors', v.ownerAccess === value ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted')}
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span><span className="block font-medium">{title}</span><span className="text-xs text-muted-foreground">{text}</span></span>
                </button>
              ))}
            </div>
          </fieldset>
          <Field label="Main branch name" htmlFor="c-branch" required hint="Change it if the clinic has a branch name, e.g. Lahore — Gulberg. They can add more branches later." error={errors.branchName}>
            <Input id="c-branch" value={v.branchName} onChange={(e) => set('branchName', e.target.value)} />
          </Field>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="add-clinic" loading={save.isPending}><Plus /> Add clinic</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
