'use client';
import { useQuery } from '@tanstack/react-query';
import type { BillingSummary, ClinicPaymentView, PlatformClinic, PlatformPlan } from '@vcms/shared';
import { AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, Building2, CalendarClock, Crown, Mail, Plus, ReceiptText, TrendingUp, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { BarChartCard } from '@/components/charts';
import { ErrorState, LoadingRows, PageHeader } from '@/components/page';
import { AddClinicDialog } from '@/components/platform/add-clinic-dialog';
import { PaymentBadge, PaymentsTable, RecordPaymentDialog, paymentText, useBillingActions } from '@/components/platform/billing-ui';
import { OwnerAccessDialog, type OwnerAccess } from '@/components/platform/clinic-ui';
import { PlanRequests, TrialsList } from '@/components/platform/plan-requests';
import { amount } from '@/components/platform/plan-ui';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1];
/** "1.2M", "680k" for chart axes (the currency is in the chart's title). */
const short = (minor: number) => {
  const v = minor / 100;
  return v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${Math.round(v / 1000)}k` : String(v);
};

function Kpi({ icon, label, value, sub, tone = 'primary', href }: { icon: React.ReactNode; label: string; value: string; sub?: React.ReactNode; tone?: 'primary' | 'success' | 'destructive' | 'warning'; href?: string }) {
  const tones = {
    primary: 'from-primary/[0.10] ring-primary/15 [&_.kpi-icon]:bg-primary/12 [&_.kpi-icon]:text-primary',
    success: 'from-success/[0.12] ring-success/20 [&_.kpi-icon]:bg-success/15 [&_.kpi-icon]:text-success',
    destructive: 'from-destructive/[0.10] ring-destructive/20 [&_.kpi-icon]:bg-destructive/12 [&_.kpi-icon]:text-destructive',
    warning: 'from-warning/[0.12] ring-warning/25 [&_.kpi-icon]:bg-warning/15 [&_.kpi-icon]:text-warning',
  };
  const body = (
    <>
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span className="kpi-icon rounded-md p-1.5">{icon}</span>
        {label}
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums leading-tight">{value}</p>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </>
  );
  const cls = cn('block rounded-2xl bg-gradient-to-br to-transparent p-4 shadow-card ring-1 ring-inset', tones[tone], href && 'transition-transform hover:-translate-y-px');
  return href ? <Link href={href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}

/** Clinics that owe money or will soon: overdue first, then no payment recorded, then due this week. */
function PaymentsDue({ clinics, onRecordPayment }: { clinics: PlatformClinic[]; onRecordPayment: (c: PlatformClinic) => void }) {
  const billing = useBillingActions();
  const order = { OVERDUE: 0, UNPAID: 1, DUE_SOON: 2 } as Record<string, number>;
  const rows = clinics
    .filter((c) => c.status === 'ACTIVE' && c.payment.kind in order)
    .sort((a, b) => order[a.payment.kind] - order[b.payment.kind] || (b.payment.days ?? 0) - (a.payment.days ?? 0));
  if (!rows.length) return null;
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b bg-destructive/[0.06] px-4 py-3">
        <CalendarClock className="h-4 w-4 text-destructive" aria-hidden />
        <h2 className="text-sm font-semibold">Payments to collect</h2>
        <span className="rounded-pill bg-destructive/15 px-2 py-0.5 text-2xs font-semibold text-destructive">{rows.length}</span>
        <p className="ml-auto hidden text-xs text-muted-foreground sm:block">Overdue, never paid, or due within a week.</p>
      </div>
      <ul className="divide-y">
        {rows.slice(0, 8).map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1 basis-56">
              <p className="font-medium">
                <Link href={`/platform/clinics/${c.id}`} className="text-primary hover:underline">{c.name}</Link>
                <span className="ml-2 text-sm font-normal text-muted-foreground">{c.planName} · {c.bill?.cycle === 'YEARLY' ? 'yearly' : 'monthly'}</span>
              </p>
              <p className="text-xs text-muted-foreground">{paymentText(c.payment)}</p>
            </div>
            <div className="text-right">
              <p className="font-semibold tabular-nums">{amount(c.payment.dueMinor, c.payment.currency)}</p>
              <PaymentBadge state={c.payment} />
            </div>
            <div className="flex gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => billing.remind(c)} loading={billing.reminding === c.id} title="Email the owner a reminder"><Mail /> <span className="hidden sm:inline">Remind</span></Button>
              <Button size="sm" variant="outline" onClick={() => onRecordPayment(c)}><ReceiptText /> Record payment</Button>
            </div>
          </li>
        ))}
      </ul>
      {rows.length > 8 && <Link href="/platform/clinics" className="block border-t px-4 py-2.5 text-center text-sm text-primary hover:bg-muted/40">See all {rows.length} clinics</Link>}
    </Card>
  );
}

/** How many clinics are on each plan and what they bring in a month. */
function PlanMix({ clinics }: { clinics: PlatformClinic[] }) {
  const plans = useQuery({ queryKey: ['platform-plans'], queryFn: () => api.get<PlatformPlan[]>('/platform/plans') });
  const live = clinics.filter((c) => c.status === 'ACTIVE');
  const rows = (plans.data ?? [])
    .map((p) => {
      const on = live.filter((c) => c.planId === p.id);
      return { plan: p, count: on.length, trials: on.filter((c) => c.payment.kind === 'TRIAL').length, income: on.reduce((n, c) => n + (c.bill?.totalMinor ?? 0), 0) };
    })
    .filter((r) => r.count > 0 || r.plan.isActive);
  const noPlan = live.filter((c) => !c.planId).length;
  const max = Math.max(1, ...rows.map((r) => r.count), noPlan);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Crown className="h-4 w-4 text-amber-500" /> Clinics by plan</CardTitle>
        <Link href="/platform/plans" className="text-xs text-primary hover:underline">Manage plans</Link>
      </CardHeader>
      <CardContent className="grid gap-3">
        {rows.map((r) => (
          <div key={r.plan.id} className={cn(!r.plan.isActive && 'opacity-70')}>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="font-medium">{r.plan.name}</span>
              <span className="tabular-nums text-muted-foreground">{amount(r.income, r.plan.currency)} / month</span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary/80" style={{ width: `${(r.count / max) * 100}%` }} />
              </div>
              <span className="w-24 shrink-0 text-right text-xs text-muted-foreground">{r.count} clinic{r.count === 1 ? '' : 's'}{r.trials ? ` · ${r.trials} trial` : ''}</span>
            </div>
          </div>
        ))}
        {noPlan > 0 && (
          <div>
            <div className="flex items-baseline justify-between gap-2 text-sm"><span className="font-medium">No plan</span><span className="text-muted-foreground">not charged</span></div>
            <div className="mt-1 flex items-center gap-2">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-muted-foreground/40" style={{ width: `${(noPlan / max) * 100}%` }} /></div>
              <span className="w-24 shrink-0 text-right text-xs text-muted-foreground">{noPlan} clinic{noPlan === 1 ? '' : 's'}</span>
            </div>
          </div>
        )}
        {!rows.length && !noPlan && <p className="text-sm text-muted-foreground">No clinics yet.</p>}
      </CardContent>
    </Card>
  );
}

export default function PlatformDashboardPage() {
  const [adding, setAdding] = useState(false);
  const [access, setAccess] = useState<OwnerAccess | null>(null);
  const [paying, setPaying] = useState<PlatformClinic | null>(null);
  const clinics = useQuery({ queryKey: ['platform-clinics'], queryFn: () => api.get<PlatformClinic[]>('/platform/clinics') });
  const summary = useQuery({ queryKey: ['platform-billing-summary'], queryFn: () => api.get<BillingSummary>('/platform/billing/summary') });
  const recent = useQuery({ queryKey: ['platform-payments', 'recent'], queryFn: () => api.get<ClinicPaymentView[]>('/platform/payments') });

  const all = useMemo(() => clinics.data ?? [], [clinics.data]);
  const s = summary.data;
  const chart = useMemo(() => (s?.months ?? []).map((m) => ({ name: monthLabel(m.month), value: m.totalMinor })), [s]);

  if (clinics.isLoading || summary.isLoading) return <LoadingRows />;
  if (clinics.error || summary.error) return <ErrorState error={clinics.error ?? summary.error} onRetry={() => { clinics.refetch(); summary.refetch(); }} />;

  const cur = s!.currency;
  const change = s!.collectedLastMonthMinor ? Math.round(((s!.collectedThisMonthMinor - s!.collectedLastMonthMinor) / s!.collectedLastMonthMinor) * 100) : null;
  const ready = all.filter((c) => c.status === 'ACTIVE').length;
  const paused = all.filter((c) => c.status === 'SUSPENDED').length;
  const owed = s!.overdue.amountMinor + s!.unpaid.amountMinor;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Income, payments to collect and what needs your attention across all clinics."
        actions={
          <>
            <Button asChild variant="outline"><Link href="/platform/clinics"><Building2 /> All clinics</Link></Button>
            <Button onClick={() => setAdding(true)}><Plus /> Add clinic</Button>
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          icon={<TrendingUp className="h-4 w-4" />}
          tone="success"
          label="Monthly recurring income"
          value={amount(s!.mrrMinor, cur)}
          sub={<>{amount(s!.mrrMinor * 12, cur)} a year · {s!.payingClinics} paying clinic{s!.payingClinics === 1 ? '' : 's'}</>}
        />
        <Kpi
          icon={<Wallet className="h-4 w-4" />}
          label="Collected this month"
          value={amount(s!.collectedThisMonthMinor, cur)}
          href="/platform/payments"
          sub={
            <span className="flex flex-wrap items-center gap-1">
              {change !== null && (
                <span className={cn('inline-flex items-center font-medium', change >= 0 ? 'text-success' : 'text-destructive')}>
                  {change >= 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}{Math.abs(change)}%
                </span>
              )}
              Last month {amount(s!.collectedLastMonthMinor, cur)}
            </span>
          }
        />
        <Kpi
          icon={<AlertTriangle className="h-4 w-4" />}
          tone={owed ? 'destructive' : 'primary'}
          label="To collect"
          value={amount(owed, cur)}
          href="/platform/clinics"
          sub={<>{s!.overdue.count} overdue · {s!.unpaid.count} never paid · {s!.dueSoon.count} due this week</>}
        />
        <Kpi
          icon={<Building2 className="h-4 w-4" />}
          tone="primary"
          label="Clinics"
          value={`${ready} ready`}
          href="/platform/clinics"
          sub={<>{s!.trialClinics} on free trial · {paused} paused · {all.length} in total</>}
        />
      </div>

      <div className="mb-4 grid gap-4">
        <PlanRequests />
        <PaymentsDue clinics={all} onRecordPayment={setPaying} />
        <TrialsList clinics={all} onRecordPayment={setPaying} />
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Collected each month{cur === 'AUD' ? ' (A$)' : ' (Rs)'}</CardTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">Payments recorded, last 12 months · {amount(s!.collectedThisYearMinor, cur)} so far this year</p>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <BarChartCard data={chart} name="Collected" format={(v) => amount(v, cur)} axisFormat={short} left={0} />
            </div>
          </CardContent>
        </Card>
        <PlanMix clinics={all} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ReceiptText className="h-4 w-4" /> Latest payments</CardTitle>
          <Link href="/platform/payments" className="flex items-center gap-1 text-xs text-primary hover:underline">All payments <ArrowRight className="h-3 w-3" /></Link>
        </CardHeader>
        {recent.data?.length ? (
          <PaymentsTable payments={recent.data.slice(0, 6)} showClinic compact />
        ) : (
          <CardContent><p className="text-sm text-muted-foreground">No payments recorded yet. Use “Record payment” on a clinic when it pays.</p></CardContent>
        )}
      </Card>

      <AddClinicDialog open={adding} onOpenChange={setAdding} onOwnerAccess={setAccess} />
      <OwnerAccessDialog result={access} onClose={() => setAccess(null)} />
      <RecordPaymentDialog clinic={paying} open={!!paying} onOpenChange={(o) => { if (!o) setPaying(null); }} />
    </>
  );
}
