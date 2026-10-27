'use client';
import { useQuery } from '@tanstack/react-query';
import { COUNTRIES, yearlyMonthsFree, type ClinicOverview, type PlatformPlan } from '@vcms/shared';
import {
  AlertTriangle,
  Building2,
  CalendarDays,
  Clock,
  CreditCard,
  Download,
  ExternalLink,
  GitBranch,
  History,
  KeyRound,
  LayoutList,
  Loader2,
  Mail,
  PauseCircle,
  PawPrint,
  Play,
  ReceiptText,
  RotateCcw,
  UserCheck,
  UserRound,
  Users,
  Wallet,
} from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, use, useState } from 'react';
import { ErrorState, LoadingRows, PageHeader } from '@/components/page';
import { FeeLines, PaymentBadge, PaymentsTable, RecordPaymentDialog, canRemind, downloadPaymentsCsv, paymentText, useBillingActions } from '@/components/platform/billing-ui';
import { ClinicBillingCard, ClinicPlanCard } from '@/components/platform/clinic-plan-card';
import { ClinicActionsMenu, CopyButton, OwnerAccessDialog, StatusBadge, shortAddress, useClinicActions, type OwnerAccess } from '@/components/platform/clinic-ui';
import { BillBreakdown, amount } from '@/components/platform/plan-ui';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtRelative } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Plain words for the platform's history of a clinic. */
const EVENT_LABELS: Record<string, string> = {
  'platform.clinic_created': 'Clinic added',
  'platform.clinic_ready': 'Set-up finished — ready to use',
  'platform.clinic_setup_retried': 'Set-up tried again',
  'platform.clinic_suspended': 'Paused',
  'platform.clinic_reactivated': 'Reactivated',
  'platform.clinic_owner_password_reset': 'New owner password created',
  'platform.clinic_added_existing': 'Existing database added',
  'platform.clinic_plan_changed': 'Plan changed',
  'platform.clinic_billing_changed': 'Billing or free period changed',
  'platform.plan_request_approved': 'Owner’s request approved',
  'platform.plan_request_dismissed': 'Owner’s request dismissed',
  'platform.payment_recorded': 'Payment recorded',
  'platform.payment_cancelled': 'Payment cancelled',
  'platform.payment_reminder_sent': 'Payment reminder emailed',
};
const EVENT_TONE: Record<string, string> = {
  'platform.payment_recorded': 'bg-success',
  'platform.payment_cancelled': 'bg-destructive',
  'platform.clinic_suspended': 'bg-warning',
  'platform.payment_reminder_sent': 'bg-warning',
};

/** Events whose summary is only the clinic's address: nothing to add. */
const QUIET = new Set(['platform.clinic_created', 'platform.clinic_ready', 'platform.clinic_setup_retried']);

const TABS = ['overview', 'billing', 'plan', 'history'] as const;
type Tab = (typeof TABS)[number];

function Stat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl surface-flat p-3">
      <span className="rounded-md bg-primary/10 p-2 text-primary">{icon}</span>
      <span className="min-w-0">
        <span className="block text-lg font-semibold leading-tight">{value}</span>
        <span className="block truncate text-xs text-muted-foreground">{label}{sub ? ` · ${sub}` : ''}</span>
      </span>
    </div>
  );
}

/** One figure in the strip under the clinic's name. */
function Tile({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-2xl surface-flat p-3.5 shadow-card', className)}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function Detail({ label, children, narrow }: { label: string; children: React.ReactNode; narrow?: boolean }) {
  return (
    <div className={cn('grid gap-0.5 sm:gap-3', narrow ? 'sm:grid-cols-[6.5rem_1fr]' : 'sm:grid-cols-[10rem_1fr]')}>
      <dt className="text-xs text-muted-foreground sm:pt-0.5">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}

function Events({ events }: { events: ClinicOverview['events'] }) {
  if (!events.length) return <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>;
  return (
    <ol className="grid gap-3 border-l pl-4">
      {events.map((e) => (
        <li key={e.id} className="relative text-sm">
          <span className={cn('absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full', EVENT_TONE[e.action] ?? 'bg-primary')} />
          <p className="font-medium">{EVENT_LABELS[e.action] ?? e.action}</p>
          {e.summary && !QUIET.has(e.action) && <p className="break-words text-xs">{e.summary}</p>}
          <p className="text-xs text-muted-foreground">{fmtDateTime(e.createdAt)}{e.actorName ? ` · ${e.actorName}` : ''}</p>
        </li>
      ))}
    </ol>
  );
}

function ClinicPage({ id }: { id: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const tab: Tab = (TABS as readonly string[]).includes(search.get('tab') ?? '') ? (search.get('tab') as Tab) : 'overview';
  const setTab = (t: string) => router.replace(t === 'overview' ? pathname : `${pathname}?tab=${t}`, { scroll: false });
  const [access, setAccess] = useState<OwnerAccess | null>(null);
  const [paying, setPaying] = useState(false);
  const { run, pending } = useClinicActions(setAccess);
  const billing = useBillingActions();
  const q = useQuery({
    queryKey: ['platform-clinic', id],
    queryFn: () => api.get<ClinicOverview>(`/platform/clinics/${id}/overview`),
    refetchInterval: (query) => (query.state.data?.clinic.status === 'PROVISIONING' ? 3000 : false),
  });
  const plans = useQuery({ queryKey: ['platform-plans'], queryFn: () => api.get<PlatformPlan[]>('/platform/plans') });

  if (q.isLoading) return <LoadingRows />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const { clinic: c, usage, events, payments } = q.data;
  const busy = pending?.id === c.id;
  const live = c.status === 'ACTIVE' || c.status === 'SUSPENDED';
  const billable = live && !!c.planId && !!c.bill;
  const plan = plans.data?.find((p) => p.id === c.planId) ?? null;
  const country = COUNTRIES.find((x) => x.code === c.country)?.name ?? c.country;
  const staffLimit = c.entitlements.maxStaff;
  const branchLimit = c.entitlements.maxBranches;
  const paidTotal = payments.filter((p) => !p.voidedAt).reduce((n, p) => n + p.amountMinor, 0);
  const monthsFree = plan ? yearlyMonthsFree(plan) : 0;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Dashboard', href: '/platform' }, { label: 'Clinics', href: '/platform/clinics' }, { label: c.name }]}
        title={<span className="flex flex-wrap items-center gap-2">{c.name} <StatusBadge status={c.status} />{live && c.planId && <PaymentBadge state={c.payment} />}</span>}
        description={`${country} · ${c.planName ? `${c.planName} plan, ${c.billingCycle === 'YEARLY' ? 'paid yearly' : 'paid monthly'}` : 'no plan'} · added ${fmtDate(c.createdAt)}`}
        actions={
          <>
            {billable && <Button onClick={() => setPaying(true)}><ReceiptText /> Record payment</Button>}
            {c.status === 'ACTIVE' && <Button asChild variant="outline"><a href={`${c.address}/login`} target="_blank" rel="noreferrer"><ExternalLink /> Open clinic</a></Button>}
            <ClinicActionsMenu clinic={c} run={run} onRecordPayment={() => setPaying(true)} />
          </>
        }
      />

      {c.status === 'PROVISIONING' && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-info/30 bg-info/5 p-4 text-sm">
          <Loader2 className="h-5 w-5 animate-spin text-info" />
          <span>Creating the clinic’s database and setting it up. This page updates by itself — usually under a minute.</span>
        </div>
      )}
      {c.status === 'FAILED' && (
        <div className="mb-4 grid gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <p className="flex items-center gap-2 font-medium text-destructive"><AlertTriangle className="h-4 w-4" /> Set-up did not finish</p>
          {c.lastError && <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-card p-2 font-mono text-xs">{c.lastError}</pre>}
          <p className="text-muted-foreground">Common causes: the database server was busy, or the database user may not create databases. Each step is safe to repeat.</p>
          <div><Button loading={busy} onClick={() => run(c, 'retry')}><RotateCcw /> Try set-up again</Button></div>
        </div>
      )}
      {c.status === 'SUSPENDED' && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/5 p-4 text-sm">
          <span className="flex items-center gap-2">
            <PauseCircle className="h-5 w-5 shrink-0 text-warning" />
            {c.pausedReason === 'UNPAID' ? 'Paused for non-payment' : c.pausedReason === 'TRIAL_ENDED' ? 'Paused — the free trial ended' : 'Paused'} {c.suspendedAt ? `on ${fmtDateTime(c.suspendedAt)}` : ''}. Nobody at this clinic can sign in. No data has been deleted.
          </span>
          <div className="flex gap-2">
            {billable && c.pausedReason && <Button variant="outline" onClick={() => setPaying(true)}><ReceiptText /> Record payment</Button>}
            <Button loading={busy} onClick={() => run(c, 'reactivate')}><Play /> Reactivate</Button>
          </div>
        </div>
      )}
      {c.status === 'ACTIVE' && (c.payment.kind === 'OVERDUE' || c.payment.kind === 'UNPAID') && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/25 bg-destructive/[0.05] p-4 text-sm">
          <span className="flex items-center gap-2">
            <Clock className="h-5 w-5 shrink-0 text-destructive" />
            <span><b>{amount(c.payment.dueMinor, c.payment.currency)}</b> to collect — {paymentText(c.payment).toLowerCase()}.</span>
          </span>
          <div className="flex gap-2">
            <Button variant="outline" loading={billing.reminding === c.id} onClick={() => billing.remind(c)}><Mail /> Send reminder</Button>
            <Button onClick={() => setPaying(true)}><ReceiptText /> Record payment</Button>
          </div>
        </div>
      )}

      {/* The clinic at a glance: what it pays, where it stands, and how much of its plan it uses. */}
      {live && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile label="Fee (extras included)">
            {c.bill ? <FeeLines bill={c.bill} /> : <p className="text-sm text-muted-foreground">No plan — not charged</p>}
          </Tile>
          <Tile label="Payment">
            {c.planId ? (
              <>
                <PaymentBadge state={c.payment} />
                <p className="mt-1 text-xs text-muted-foreground">{paymentText(c.payment)}</p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">—</p>
            )}
          </Tile>
          <Tile label="Staff accounts">
            <p className="text-lg font-semibold leading-tight tabular-nums">{usage?.staffCounted ?? '—'}<span className="text-sm font-normal text-muted-foreground"> of {staffLimit ?? 'unlimited'}</span></p>
            {c.bill?.extraStaff ? <p className="text-xs text-muted-foreground">{c.bill.extraStaff} extra billed</p> : null}
          </Tile>
          <Tile label="Branches">
            <p className="text-lg font-semibold leading-tight tabular-nums">{usage?.branches ?? '—'}<span className="text-sm font-normal text-muted-foreground"> of {branchLimit ?? 'unlimited'}</span></p>
            {c.bill?.extraBranches ? <p className="text-xs text-muted-foreground">{c.bill.extraBranches} extra billed</p> : null}
          </Tile>
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Clinic sections">
          <TabsTrigger value="overview"><Building2 className="h-4 w-4" /> Overview</TabsTrigger>
          <TabsTrigger value="billing"><Wallet className="h-4 w-4" /> Billing &amp; payments{payments.length ? <span className="rounded-pill bg-foreground/[0.07] px-1.5 text-2xs">{payments.filter((p) => !p.voidedAt).length}</span> : null}</TabsTrigger>
          <TabsTrigger value="plan"><LayoutList className="h-4 w-4" /> Plan &amp; features</TabsTrigger>
          <TabsTrigger value="history"><History className="h-4 w-4" /> History</TabsTrigger>
        </TabsList>

        {/* ── Overview ── */}
        <TabsContent value="overview" className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid content-start gap-4">
            <Card>
              <CardHeader><CardTitle>Clinic details</CardTitle></CardHeader>
              <CardContent>
                <dl className="grid gap-3">
                  <Detail label="Clinic name">{c.name}</Detail>
                  <Detail label="Web address"><span className="inline-flex items-center gap-1"><a href={c.address} target="_blank" rel="noreferrer" className="break-all text-primary hover:underline">{shortAddress(c.address)}</a><CopyButton text={c.address} what="Address" /></span></Detail>
                  <Detail label="Country">{country}</Detail>
                  <Detail label="Plan">{c.planName ? `${c.planName}${c.extraFeatures.length || c.removedFeatures.length || c.staffLimitOverride != null || c.branchLimitOverride != null ? ' (with changes for this clinic)' : ''}` : 'No plan — no limits'}</Detail>
                  {c.bill && <Detail narrow label="Pays">{c.bill.cycle === 'YEARLY' ? `${amount(c.bill.yearlyFeeMinor ?? 0, c.bill.currency)} a year, upfront` : `${amount(c.bill.monthlyFeeMinor, c.bill.currency)} a month`}</Detail>}
                  {c.planId && <Detail narrow label="Paid until">{c.paidUntil ? fmtDate(c.paidUntil) : c.trialEndsAt ? `Free trial until ${fmtDate(c.trialEndsAt)}` : 'No payment recorded'}</Detail>}
                  {c.lastPaymentAt && <Detail label="Last payment">{fmtDate(c.lastPaymentAt)}</Detail>}
                  <Detail label="Added">{fmtDateTime(c.createdAt)}</Detail>
                  <Detail label="Ready since">{c.provisionedAt ? fmtDateTime(c.provisionedAt) : '—'}</Detail>
                  <Detail label="Database"><span className="font-mono text-xs">{c.databaseName}</span></Detail>
                </dl>
              </CardContent>
            </Card>
            {usage && (
              <Card>
                <CardHeader><CardTitle>How it is used</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-2 gap-2 xl:grid-cols-3">
                  <Stat icon={<Users className="h-4 w-4" />} label="Staff signed up" value={usage.activeStaff} sub={usage.staff > usage.activeStaff ? `${usage.staff - usage.activeStaff} invited or paused` : undefined} />
                  <Stat icon={<GitBranch className="h-4 w-4" />} label="Branches" value={usage.branches} />
                  <Stat icon={<UserCheck className="h-4 w-4" />} label="Clients" value={usage.clients.toLocaleString()} />
                  <Stat icon={<PawPrint className="h-4 w-4" />} label="Patients" value={usage.patients.toLocaleString()} />
                  <Stat icon={<CalendarDays className="h-4 w-4" />} label="Appointments this month" value={usage.appointmentsThisMonth.toLocaleString()} />
                  <Stat icon={<Clock className="h-4 w-4" />} label="Last sign-in" value={usage.lastSignInAt ? fmtRelative(usage.lastSignInAt) : 'Nobody yet'} />
                </CardContent>
              </Card>
            )}
          </div>
          <div className="grid content-start gap-4">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><UserRound className="h-4 w-4" /> Owner</CardTitle></CardHeader>
              <CardContent className="grid gap-3 text-sm">
                <div>
                  <p className="font-medium">{c.ownerName}</p>
                  <div className="flex items-center gap-1"><a href={`mailto:${c.ownerEmail}`} className="break-all text-primary hover:underline">{c.ownerEmail}</a><CopyButton text={c.ownerEmail} what="Email" /></div>
                </div>
                <p className="text-xs text-muted-foreground">{c.ownerAccess === 'INVITATION' ? 'The owner was emailed a link to choose a password.' : 'The owner was given a temporary password.'}</p>
                {c.status === 'ACTIVE' && (
                  <Button variant="outline" loading={busy} onClick={() => run(c, 'owner-password')}><KeyRound /> Owner can’t sign in? New password</Button>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><History className="h-4 w-4" /> Recent activity</CardTitle>
                {events.length > 5 && <button type="button" className="text-xs text-primary hover:underline" onClick={() => setTab('history')}>See all</button>}
              </CardHeader>
              <CardContent><Events events={events.slice(0, 5)} /></CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Billing & payments ── */}
        <TabsContent value="billing" className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid content-start gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><CreditCard className="h-4 w-4" /> Subscription</CardTitle>
                {billable && (
                  <div className="flex gap-2">
                    {canRemind(c) && <Button size="sm" variant="ghost" loading={billing.reminding === c.id} onClick={() => billing.remind(c)}><Mail /> Remind</Button>}
                    <Button size="sm" onClick={() => setPaying(true)}><ReceiptText /> Record payment</Button>
                  </div>
                )}
              </CardHeader>
              <CardContent>
                {c.bill && c.planName ? (
                  <div className="grid gap-5 md:grid-cols-2">
                    <div className="grid content-start gap-3">
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">Paying monthly</p>
                        <BillBreakdown bill={{ ...c.bill, planMinor: plan?.priceMonthlyMinor ?? c.bill.planMinor }} planName={c.planName} cycle="MONTHLY" className="mt-1.5" />
                      </div>
                      {c.bill.yearlyFeeMinor != null && (
                        <div className={cn('rounded-xl p-3 ring-1 ring-inset', c.bill.cycle === 'YEARLY' ? 'bg-primary/[0.06] ring-primary/20' : 'ring-border')}>
                          <p className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
                            Paying a year upfront {monthsFree > 0 && <span className="rounded-pill bg-success/12 px-2 py-0.5 text-2xs font-semibold text-success">{monthsFree} month{monthsFree === 1 ? '' : 's'} free</span>}
                          </p>
                          <p className="mt-1 text-lg font-semibold tabular-nums">{amount(c.bill.yearlyFeeMinor, c.bill.currency)} <span className="text-sm font-normal text-muted-foreground">a year</span></p>
                          <p className="text-xs text-muted-foreground">
                            Instead of {amount(c.bill.monthlyFeeMinor * 12, c.bill.currency)} paid monthly — saves {amount(c.bill.monthlyFeeMinor * 12 - c.bill.yearlyFeeMinor, c.bill.currency)}
                          </p>
                        </div>
                      )}
                    </div>
                    <dl className="grid content-start gap-3 text-sm">
                      <Detail narrow label="Pays">{c.bill.cycle === 'YEARLY' ? 'A year upfront' : 'Monthly'}</Detail>
                      <Detail narrow label="Status"><span className="inline-flex flex-wrap items-center gap-2"><PaymentBadge state={c.payment} /> <span className="text-xs text-muted-foreground">{paymentText(c.payment)}</span></span></Detail>
                      <Detail narrow label="Next payment">{c.payment.kind === 'NO_PLAN' || c.payment.kind === 'FREE' ? '—' : `${amount(c.payment.dueMinor, c.payment.currency)} ${c.payment.kind === 'TRIAL' ? `when the trial ends (${fmtDate(c.payment.date)})` : c.payment.date ? `by ${fmtDate(c.payment.date)}` : 'now'}`}</Detail>
                      <Detail narrow label="Paid until">{c.paidUntil ? fmtDate(c.paidUntil) : '—'}</Detail>
                      <Detail narrow label="Paid in total">{amount(paidTotal, c.bill.currency)} · {payments.filter((p) => !p.voidedAt).length} payment{payments.filter((p) => !p.voidedAt).length === 1 ? '' : 's'}</Detail>
                    </dl>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">This clinic has no plan, so it is not charged. Choose a plan under “Plan &amp; features”.</p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><ReceiptText className="h-4 w-4" /> Payments</CardTitle>
                {payments.length > 0 && <Button size="sm" variant="ghost" onClick={() => downloadPaymentsCsv(payments, `${c.slug}-payments`)}><Download /> CSV</Button>}
              </CardHeader>
              {payments.length ? (
                <PaymentsTable payments={payments} />
              ) : (
                <CardContent><p className="text-sm text-muted-foreground">No payments recorded yet.{billable ? ' Use “Record payment” when the clinic pays — the owner is emailed a receipt.' : ''}</p></CardContent>
              )}
            </Card>
          </div>
          <div className="grid content-start gap-4">
            {live && c.planId && (
              <ClinicBillingCard key={JSON.stringify([c.planId, c.billingCycle, c.trialEndsAt, c.trialThenPlanId])} overview={q.data} onRecordPayment={() => setPaying(true)} />
            )}
          </div>
        </TabsContent>

        {/* ── Plan & features ── */}
        <TabsContent value="plan">
          {live ? (
            <div className="max-w-3xl">
              {/* Keyed on the saved plan, so the form restarts from what was saved. */}
              <ClinicPlanCard key={JSON.stringify([c.planId, c.staffLimitOverride, c.branchLimitOverride, c.extraFeatures, c.removedFeatures])} overview={q.data} />
            </div>
          ) : (
            <Card><CardContent className="pt-6 text-sm text-muted-foreground">The plan can be chosen once the clinic is set up.</CardContent></Card>
          )}
        </TabsContent>

        {/* ── History ── */}
        <TabsContent value="history">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><History className="h-4 w-4" /> Everything NextCore did for this clinic</CardTitle></CardHeader>
            <CardContent><Events events={events} /></CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <OwnerAccessDialog result={access} onClose={() => setAccess(null)} />
      <RecordPaymentDialog clinic={c} open={paying} onOpenChange={setPaying} />
    </>
  );
}

export default function PlatformClinicPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense fallback={<LoadingRows />}>
      <ClinicPage id={id} />
    </Suspense>
  );
}
