'use client';
import { useMutation, useQuery } from '@tanstack/react-query';
import { formatMoney, PLAN_FEATURES, PLAN_FEATURE_INFO, type ClinicPlanView, type PlanFeature, type PlanOffer } from '@vcms/shared';
import { Building2, Check, Lock, Sparkles, Star, Users, X, Zap } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { toast } from 'sonner';
import { ErrorState, LoadingRows } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

function Meter({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const full = limit !== null && used >= limit;
  return (
    <div className="rounded-xl surface-flat p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">
        {used} <span className="text-base font-normal text-muted-foreground">{limit === null ? 'in use · no limit' : `of ${limit}`}</span>
      </p>
      {limit !== null && (
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={`${label} used`} aria-valuenow={used} aria-valuemin={0} aria-valuemax={limit}>
          <div className={cn('h-full rounded-full', used > limit ? 'bg-destructive' : full ? 'bg-warning' : 'bg-primary')} style={{ width: `${used > limit ? 100 : pct}%` }} />
        </div>
      )}
      {full && <p className="mt-2 text-xs text-warning">{used > (limit ?? 0) ? 'Over the limit: you keep what you have but cannot add more.' : 'Full: upgrade your plan to add more.'}</p>}
    </div>
  );
}

const limitLine = (n: number | null, one: string, many: string) => (n === null ? `Unlimited ${many}` : `${n} ${n === 1 ? one : many}`);

function PlanCard({ plan, current, popular, onAsk, asking, highlight }: { plan: PlanOffer; current: boolean; popular: boolean; onAsk: () => void; asking: boolean; highlight?: PlanFeature }) {
  return (
    <div
      className={cn(
        'relative flex flex-col gap-4 rounded-[1.75rem] p-6 ring-1 ring-inset transition-shadow',
        current ? 'bg-card ring-success/40' : popular ? 'bg-gradient-to-b from-primary/[0.10] to-card shadow-lg ring-primary/30' : 'bg-card ring-foreground/10',
      )}
    >
      {popular && !current && (
        <span className="absolute -top-3 left-6 inline-flex items-center gap-1 rounded-pill bg-gradient-to-r from-primary to-brand-2 px-3 py-1 text-2xs font-semibold uppercase tracking-wide text-white shadow">
          <Star className="h-3 w-3" /> Most popular
        </span>
      )}
      <div>
        <p className="flex items-center gap-2 text-lg font-semibold">
          {plan.name} {current && <Badge variant="success">Your plan</Badge>}
        </p>
        {plan.description && <p className="mt-1 text-sm text-muted-foreground">{plan.description}</p>}
      </div>
      <p className="whitespace-nowrap text-3xl font-semibold tracking-tight">
        {formatMoney(plan.priceMonthlyMinor, plan.currency).replace(/\.00$/, '')}
        <span className="text-sm font-normal text-muted-foreground"> / month</span>
      </p>
      <ul className="grid gap-1.5 text-sm">
        <li className="flex items-center gap-2"><Users className="h-4 w-4 text-primary" /> {limitLine(plan.maxStaff, 'staff account', 'staff accounts')}</li>
        <li className="flex items-center gap-2"><Building2 className="h-4 w-4 text-primary" /> {limitLine(plan.maxBranches, 'branch', 'branches')}</li>
        <li className="flex items-center gap-2"><Zap className="h-4 w-4 text-primary" /> {limitLine(plan.maxAutomations, 'automation', 'automations')} switched on</li>
      </ul>
      <ul className="grid gap-1.5 border-t border-foreground/[0.06] pt-4 text-sm">
        {PLAN_FEATURES.map((f) => {
          const on = plan.features.includes(f);
          return (
            <li key={f} className={cn('flex items-center gap-2 rounded-md', !on && 'text-muted-foreground/70', highlight === f && on && 'bg-primary/10 px-1.5 py-0.5 font-semibold text-primary')}>
              {on ? <Check className="h-4 w-4 shrink-0 text-success" aria-label="Included" /> : <X className="h-4 w-4 shrink-0" aria-label="Not included" />}
              {PLAN_FEATURE_INFO[f].label}
            </li>
          );
        })}
      </ul>
      <div className="mt-auto pt-2">
        {current ? (
          <Button variant="outline" className="w-full" disabled>
            <Check /> Current plan
          </Button>
        ) : (
          <Button className="w-full" variant={popular ? 'default' : 'outline'} loading={asking} onClick={onAsk}>
            <Sparkles /> Switch to {plan.name}
          </Button>
        )}
      </div>
    </div>
  );
}

function PlanView() {
  const params = useSearchParams();
  const unlock = params.get('unlock') as PlanFeature | null;
  const q = useQuery({ queryKey: ['clinic-plan'], queryFn: () => api.get<ClinicPlanView>('/organization/plan') });
  const ask = useMutation({
    mutationFn: (planId: string) => api.post<{ plan: string }>('/organization/plan/upgrade-request', { planId }),
    onSuccess: (r) => toast.success(`Request sent — NextCore will move you to ${r.plan} shortly`),
    onError: (err: Error) => toast.error(err.message),
  });
  if (q.isLoading) return <LoadingRows />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const { entitlements: e, usage, plans } = q.data;
  const missing = PLAN_FEATURES.filter((f) => !e.features.includes(f));
  const wanted = unlock && PLAN_FEATURE_INFO[unlock] && !e.features.includes(unlock) ? unlock : null;
  const unlockIn = wanted ? plans.filter((p) => p.features.includes(wanted)).map((p) => p.name) : [];
  const popular = plans.length >= 3 ? plans[Math.floor(plans.length / 2)].id : null;
  return (
    <div className="grid gap-6">
      {wanted && (
        <div className="flex flex-wrap items-center gap-4 rounded-2xl bg-gradient-to-br from-primary/[0.12] to-brand-2/[0.08] p-5 ring-1 ring-inset ring-primary/20">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-brand-2 text-white shadow">
            <Lock className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1 basis-64">
            <p className="font-semibold">Unlock {PLAN_FEATURE_INFO[wanted].label}</p>
            <p className="text-sm text-muted-foreground">
              {PLAN_FEATURE_INFO[wanted].description} {unlockIn.length ? `Included in ${unlockIn.join(' and ')}.` : 'Ask NextCore to add it to your plan.'}
            </p>
          </div>
        </div>
      )}
      <Card>
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-2">{e.planName ? `${e.planName} plan` : 'Full access'} <Badge variant="success">Active</Badge></CardTitle>
            <CardDescription className="mt-1">{e.planName ? 'What your clinic uses of its plan.' : 'Your clinic has no limits.'}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Meter label="Staff accounts" used={usage.staff} limit={e.maxStaff} />
            <Meter label="Branches" used={usage.branches} limit={e.maxBranches} />
            <Meter label="Automations switched on" used={usage.automations} limit={e.maxAutomations} />
          </div>
          <p className="text-xs text-muted-foreground">Staff accounts counted: active and invited people. Paused staff and paused branches do not count.</p>
        </CardContent>
      </Card>

      {plans.length > 0 ? (
        <section className="grid gap-4">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Compare plans</h2>
            <p className="text-sm text-muted-foreground">Everyday work — clients, patients, appointments, consultations, billing, pharmacy, stock, the shop counter, vaccinations, WhatsApp and the ready-made automations — is in every plan.</p>
          </div>
          <div className="grid gap-5 pt-2 md:grid-cols-2 xl:grid-cols-3">
            {plans.map((p) => (
              <PlanCard key={p.id} plan={p} current={p.id === e.planId} popular={p.id === popular} highlight={wanted ?? undefined} asking={ask.isPending && ask.variables === p.id} onAsk={() => ask.mutate(p.id)} />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Extra branch or staff account? Ask NextCore. Plan changes apply within seconds, and nothing you have is ever removed.</p>
        </section>
      ) : (
        <Card>
          <CardHeader><CardTitle>What is included</CardTitle></CardHeader>
          <CardContent className="grid gap-4">
            <ul className="grid gap-2 sm:grid-cols-2">
              {PLAN_FEATURES.map((f) => {
                const on = e.features.includes(f);
                return (
                  <li key={f} className={cn('flex items-start gap-2 rounded-lg surface-flat p-3 text-sm', !on && 'bg-muted/40 text-muted-foreground')}>
                    {on ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-label="Included" /> : <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-label="Not in your plan" />}
                    <span>
                      <span className="block font-medium">{PLAN_FEATURE_INFO[f].label}</span>
                      <span className="block text-xs">{on ? PLAN_FEATURE_INFO[f].description : 'Not in your plan'}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
            {missing.length > 0 && <p className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">Want {missing.length === 1 ? PLAN_FEATURE_INFO[missing[0]].label : 'more'}, more staff or another branch? <b>Ask NextCore</b> to change your plan. It applies within seconds.</p>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function PlanPage() {
  return (
    <RequirePermission anyOf={['org.manage']}>
      <Suspense>
        <PlanView />
      </Suspense>
    </RequirePermission>
  );
}
