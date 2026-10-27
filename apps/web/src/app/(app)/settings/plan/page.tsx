'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { daysLeft, formatMoney, monthlyPrice, PLAN_FEATURES, PLAN_FEATURE_INFO, yearlyMonthsFree, type BillingCycle, type ClinicPlanView, type PlanFeature, type PlanOffer } from '@vcms/shared';
import { Building2, Check, Clock, GraduationCap, Headphones, Lock, MessageCircle, Phone, Plus, Receipt, Sparkles, Star, Users, Wand2, X, Zap } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { toast } from 'sonner';
import { useConfirm } from '@/components/confirm';
import { ErrorState, LoadingRows } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { billSummary } from '@/components/platform/plan-ui';
import { cn } from '@/lib/utils';

const price = (minor: number, currency: string) => formatMoney(minor, currency).replace(/\.00$/, '');

function Meter({ label, used, limit, action, fullText = 'Full: add more, or upgrade your plan.' }: { label: string; used: number; limit: number | null; action?: React.ReactNode; fullText?: string }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const full = limit !== null && used >= limit;
  return (
    <div className="flex flex-col rounded-xl surface-flat p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">
        {used} <span className="text-base font-normal text-muted-foreground">{limit === null ? 'in use · no limit' : `of ${limit}`}</span>
      </p>
      {limit !== null && (
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={`${label} used`} aria-valuenow={used} aria-valuemin={0} aria-valuemax={limit}>
          <div className={cn('h-full rounded-full', used > limit ? 'bg-destructive' : full ? 'bg-warning' : 'bg-primary')} style={{ width: `${used > limit ? 100 : pct}%` }} />
        </div>
      )}
      {full && <p className="mt-2 text-xs text-warning">{used > (limit ?? 0) ? 'Over the limit: you keep what you have but cannot add more.' : fullText}</p>}
      {action && <div className="mt-auto pt-3">{action}</div>}
    </div>
  );
}

const limitLine = (n: number | null, one: string, many: string) => (n === null ? `Unlimited ${many}` : `${n} ${n === 1 ? one : many}`);

/** The support that comes with a plan, as ticks and crosses. */
function SupportList({ plan }: { plan: PlanOffer }) {
  const rows: [React.ReactNode, boolean, string][] = [
    [<Headphones key="i" className="h-4 w-4" />, true, plan.supportResponse ? `Help centre and email — reply within ${plan.supportResponse}` : 'Help centre and email'],
    [<MessageCircle key="i" className="h-4 w-4" />, plan.whatsappSupport, 'WhatsApp support'],
    [<Phone key="i" className="h-4 w-4" />, plan.phoneSupport, 'Phone support'],
    [<GraduationCap key="i" className="h-4 w-4" />, plan.trainingSessions > 0, plan.trainingSessions ? `${plan.trainingSessions} free staff training session${plan.trainingSessions === 1 ? '' : 's'}` : 'Staff training sessions'],
  ];
  return (
    <ul className="grid gap-1.5 text-sm">
      {rows.map(([icon, on, text]) => (
        <li key={text} className={cn('flex items-center gap-2', !on && 'text-muted-foreground/70')}>
          <span className={on ? 'text-primary' : ''} aria-hidden>{icon}</span>
          <span className="min-w-0 flex-1">{text}</span>
          {on ? <Check className="h-4 w-4 shrink-0 text-success" aria-label="Included" /> : <X className="h-4 w-4 shrink-0" aria-label="Not included" />}
        </li>
      ))}
    </ul>
  );
}

function PlanCard({ plan, cycle, current, popular, onAsk, asking, highlight, requested }: { plan: PlanOffer; cycle: BillingCycle; current: boolean; popular: boolean; onAsk: () => void; asking: boolean; highlight?: PlanFeature; requested?: boolean }) {
  const yearly = cycle === 'YEARLY' && plan.priceYearlyMinor != null;
  const free = yearlyMonthsFree(plan);
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
      <div>
        <p className="whitespace-nowrap text-3xl font-semibold tracking-tight">
          {price(yearly ? plan.priceYearlyMinor! : plan.priceMonthlyMinor, plan.currency)}
          <span className="text-sm font-normal text-muted-foreground"> / {yearly ? 'year' : 'month'}</span>
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {yearly ? `${price(monthlyPrice(plan, 'YEARLY'), plan.currency)} a month${free ? ` · ${free} months free` : ''}` : plan.priceYearlyMinor != null ? `or ${price(plan.priceYearlyMinor, plan.currency)} a year${free ? ` (${free} months free)` : ''}` : ' '}
        </p>
      </div>
      <ul className="grid gap-1.5 text-sm">
        <li className="flex items-center gap-2"><Users className="h-4 w-4 text-primary" /> {limitLine(plan.maxStaff, 'staff account', 'staff accounts')}</li>
        <li className="flex items-center gap-2"><Building2 className="h-4 w-4 text-primary" /> {limitLine(plan.maxBranches, 'branch', 'branches')}</li>
        <li className="flex items-center gap-2"><Zap className="h-4 w-4 text-primary" /> {plan.maxAutomations === null ? 'All ready-made automations' : `${plan.maxAutomations} ready-made automations`} on</li>
        <li className="flex items-center gap-2"><Wand2 className="h-4 w-4 text-primary" /> {plan.maxCustomAutomations === null ? 'Unlimited automations of your own' : `${plan.maxCustomAutomations} automations of your own`}</li>
      </ul>
      {(plan.extraBranchMinor != null || plan.extraStaffMinor != null) && (
        <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          {plan.extraBranchMinor != null && <>Extra branch {price(plan.extraBranchMinor, plan.currency)}/month</>}
          {plan.extraBranchMinor != null && plan.extraStaffMinor != null && ' · '}
          {plan.extraStaffMinor != null && <>Extra staff {price(plan.extraStaffMinor, plan.currency)}/month</>}
        </p>
      )}
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
      <div className="border-t border-foreground/[0.06] pt-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Support</p>
        <SupportList plan={plan} />
      </div>
      <div className="mt-auto pt-2">
        {current ? (
          <Button variant="outline" className="w-full" disabled>
            <Check /> Current plan
          </Button>
        ) : requested ? (
          <Button variant="outline" className="w-full" disabled>
            <Clock /> Requested
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

type Ask = { kind: 'PLAN'; planId: string } | { kind: 'EXTRA_BRANCH' | 'EXTRA_STAFF'; quantity: number };

const METHOD: Record<string, string> = { BANK_TRANSFER: 'Bank transfer', CASH: 'Cash', JAZZCASH: 'JazzCash', EASYPAISA: 'Easypaisa', CARD: 'Card', CHEQUE: 'Cheque', OTHER: 'Other' };

/** What the clinic has paid NextCore: when the next payment is due, and its receipts. */
function Receipts({ billing }: { billing: NonNullable<ClinicPlanView['billing']> }) {
  const due = billing.payment;
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2"><Receipt className="h-4 w-4" /> Payments &amp; receipts</CardTitle>
          <CardDescription className="mt-1">
            {due.kind === 'OVERDUE'
              ? `Your payment of ${price(due.dueMinor, due.currency)} was due on ${fmtDate(due.date)}. Please pay NextCore to keep your clinic running without interruption.`
              : due.kind === 'DUE_SOON'
                ? `Next payment: ${price(due.dueMinor, due.currency)} by ${fmtDate(due.date)}.`
                : billing.paidUntil
                  ? `Paid until ${fmtDate(billing.paidUntil)}. Next payment: ${price(due.dueMinor, due.currency)}.`
                  : 'Your payments to NextCore.'}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y border-t">
          {billing.payments.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm">
              <span className="font-mono text-xs font-medium">{p.receipt}</span>
              <span className="text-muted-foreground">{fmtDate(p.paidAt)} · {METHOD[p.method] ?? p.method}</span>
              <span className="min-w-0 flex-1 text-xs text-muted-foreground">
                {fmtDate(p.periodStart)} → {fmtDate(p.periodEnd)} · {p.paidMonths} month{p.paidMonths === 1 ? '' : 's'}{p.freeMonths ? <span className="ml-1 font-medium text-success">+ {p.freeMonths} free</span> : null}
              </span>
              <span className="font-semibold tabular-nums">{price(p.amountMinor, p.currency)}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function PlanView() {
  const params = useSearchParams();
  const unlock = params.get('unlock') as PlanFeature | null;
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [cycle, setCycle] = useState<BillingCycle | null>(null);
  const q = useQuery({ queryKey: ['clinic-plan'], queryFn: () => api.get<ClinicPlanView>('/organization/plan') });
  const ask = useMutation({
    mutationFn: (body: Ask) => api.post<{ plan: string | null; what: string }>('/organization/plan/upgrade-request', body),
    onSuccess: (r) => {
      toast.success(`Request sent for ${r.what} — NextCore will confirm shortly`);
      qc.invalidateQueries({ queryKey: ['clinic-plan'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });
  if (q.isLoading) return <LoadingRows />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const { entitlements: e, usage, plans, pendingRequest, billing, currentPlan } = q.data;
  const shownCycle = cycle ?? billing?.cycle ?? 'MONTHLY';
  const hasYearly = plans.some((p) => p.priceYearlyMinor != null);
  const freeMonths = Math.max(0, ...plans.map(yearlyMonthsFree));
  const missing = PLAN_FEATURES.filter((f) => !e.features.includes(f));
  const wanted = unlock && PLAN_FEATURE_INFO[unlock] && !e.features.includes(unlock) ? unlock : null;
  const unlockIn = wanted ? plans.filter((p) => p.features.includes(wanted)).map((p) => p.name) : [];
  const popular = plans.length >= 3 ? plans[Math.floor(plans.length / 2)].id : null;
  const trialLeft = e.trialEndsAt ? daysLeft(e.trialEndsAt) : null;

  /** "Add a branch — Rs 5,000 a month" under a full meter, when the plan sells extras. */
  const addExtra = (kind: 'EXTRA_BRANCH' | 'EXTRA_STAFF', used: number, limit: number | null) => {
    const each = kind === 'EXTRA_BRANCH' ? currentPlan?.extraBranchMinor : currentPlan?.extraStaffMinor;
    if (limit === null || each == null || used < limit - 1 || !currentPlan) return undefined;
    const what = kind === 'EXTRA_BRANCH' ? 'branch' : 'staff account';
    if (pendingRequest?.kind === kind) return <p className="text-xs text-muted-foreground"><Clock className="mr-1 inline h-3.5 w-3.5" />Extra {what} requested</p>;
    return (
      <Button
        size="sm"
        variant="outline"
        className="h-auto w-full flex-wrap whitespace-normal py-1.5 leading-tight"
        loading={ask.isPending && ask.variables?.kind === kind}
        onClick={async () => {
          const r = await confirm({ title: `Add a ${what}?`, description: `One more ${what} for ${price(each, currentPlan.currency)} a month on top of your ${currentPlan.name} plan. NextCore confirms it and it is ready straight away.`, confirmLabel: 'Ask NextCore' });
          if (r.confirmed) ask.mutate({ kind, quantity: 1 });
        }}
      >
        <Plus /> Add a {what} <span className="font-normal text-muted-foreground">{price(each, currentPlan.currency)}/month</span>
      </Button>
    );
  };

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
            <CardTitle className="flex flex-wrap items-center gap-2">
              {e.planName ? `${e.planName} plan` : 'Full access'}
              {trialLeft !== null ? (
                <Badge>Free trial · {trialLeft} day{trialLeft === 1 ? '' : 's'} left</Badge>
              ) : billing?.payment.kind === 'OVERDUE' ? (
                <Badge variant="destructive">Payment overdue</Badge>
              ) : billing?.payment.kind === 'DUE_SOON' ? (
                <Badge variant="warning">Payment due soon</Badge>
              ) : (
                <Badge variant="success">Active</Badge>
              )}
            </CardTitle>
            <CardDescription className="mt-1">
              {!e.planName
                ? 'Your clinic has no limits.'
                : billing
                  ? billing.bill.inTrial
                    ? `Free until ${fmtDate(e.trialEndsAt!)}. Then ${price(billing.bill.planMinor + billing.bill.extrasMinor, billing.bill.currency)} a month${billing.cycle === 'YEARLY' ? ' (paid yearly)' : ''}.`
                    : `${billing.bill.cycle === 'YEARLY' ? `You pay ${price(billing.bill.chargeMinor, billing.bill.currency)} a year, upfront` : `You pay ${price(billing.bill.chargeMinor, billing.bill.currency)} a month`}${billing.bill.extrasMinor && currentPlan ? (billing.bill.cycle === 'YEARLY' ? `, including ${[billing.bill.extraStaff && `${billing.bill.extraStaff} extra staff`, billing.bill.extraBranches && `${billing.bill.extraBranches} extra branch${billing.bill.extraBranches === 1 ? '' : 'es'}`].filter(Boolean).join(' and ')}` : ` (${billSummary(billing.bill, currentPlan.name, billing.cycle)})`) : ''}.${billing.paidUntil ? ` Paid until ${fmtDate(billing.paidUntil)}.` : ''}`
                  : 'What your clinic uses of its plan.'}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
            <Meter label="Staff accounts" used={usage.staff} limit={e.maxStaff} action={addExtra('EXTRA_STAFF', usage.staff, e.maxStaff)} />
            <Meter label="Branches" used={usage.branches} limit={e.maxBranches} action={addExtra('EXTRA_BRANCH', usage.branches, e.maxBranches)} />
            <Meter label="Ready-made automations on" used={usage.automations} limit={e.maxAutomations} fullText="Full: switch one off, or upgrade your plan." />
            <Meter label="Your own automations on" used={usage.customAutomations} limit={e.maxCustomAutomations} fullText="Full: switch one off, or upgrade your plan." />
          </div>
          {currentPlan && (
            <div className="rounded-xl surface-flat p-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your support</p>
              <SupportList plan={currentPlan} />
            </div>
          )}
          <p className="text-xs text-muted-foreground">Staff accounts counted: active and invited people. Paused staff and paused branches do not count.</p>
        </CardContent>
      </Card>

      {billing && billing.payments.length > 0 && <Receipts billing={billing} />}

      {pendingRequest && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-warning/10 p-4 ring-1 ring-inset ring-warning/25">
          <Clock className="h-5 w-5 shrink-0 text-warning" aria-hidden />
          <p className="min-w-0 flex-1 text-sm">
            <b>
              {pendingRequest.kind === 'PLAN'
                ? `You asked to move to ${pendingRequest.planName}`
                : `You asked for ${pendingRequest.quantity} extra ${pendingRequest.kind === 'EXTRA_BRANCH' ? (pendingRequest.quantity === 1 ? 'branch' : 'branches') : pendingRequest.quantity === 1 ? 'staff account' : 'staff accounts'}`}
            </b>{' '}
            on {fmtDate(pendingRequest.createdAt)}. NextCore will confirm shortly — you will get an email when it is done.
          </p>
        </div>
      )}
      {plans.length > 0 ? (
        <section className="grid gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">Compare plans</h2>
              <p className="text-sm text-muted-foreground">Everyday work — front desk, clients, patients, appointments, consultations, billing, pharmacy, stock, the shop counter, vaccinations, client emails and online booking — is in every plan.</p>
            </div>
            {hasYearly && (
              <div role="radiogroup" aria-label="Show prices" className="inline-flex rounded-pill bg-muted p-1 text-sm">
                {(['MONTHLY', 'YEARLY'] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={shownCycle === c}
                    onClick={() => setCycle(c)}
                    className={cn('rounded-pill px-4 py-1.5 font-medium transition-colors', shownCycle === c ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground')}
                  >
                    {c === 'MONTHLY' ? 'Monthly' : 'Yearly'}
                    {c === 'YEARLY' && freeMonths > 0 && <span className="ml-1.5 rounded-pill bg-success/15 px-1.5 py-0.5 text-2xs font-semibold text-success">{freeMonths} months free</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="grid gap-5 pt-2 md:grid-cols-2 xl:grid-cols-3">
            {plans.map((p) => (
              <PlanCard
                key={p.id}
                plan={p}
                cycle={shownCycle}
                current={p.id === e.planId}
                popular={p.id === popular}
                highlight={wanted ?? undefined}
                requested={pendingRequest?.kind === 'PLAN' && pendingRequest.planId === p.id}
                asking={ask.isPending && ask.variables?.kind === 'PLAN' && ask.variables.planId === p.id}
                onAsk={() => ask.mutate({ kind: 'PLAN', planId: p.id })}
              />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Plan changes apply within seconds once NextCore confirms them, and nothing you have is ever removed.</p>
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
