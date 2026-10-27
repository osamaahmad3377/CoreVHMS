'use client';
import { useQuery } from '@tanstack/react-query';
import { COUNTRIES, type PaymentStateKind, type PlatformClinic } from '@vcms/shared';
import { AlertTriangle, Building2, CheckCircle2, Clock, ExternalLink, Gift, Loader2, PauseCircle, Plus, RotateCcw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/page';
import { AddClinicDialog } from '@/components/platform/add-clinic-dialog';
import { FeeLines, PaymentBadge, RecordPaymentDialog, paymentText } from '@/components/platform/billing-ui';
import { ClinicActionsMenu, CopyButton, OwnerAccessDialog, STATUS, StatusBadge, shortAddress, useClinicActions, type OwnerAccess } from '@/components/platform/clinic-ui';
import { SearchInput } from '@/components/search-input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/input';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { api } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { cn } from '@/lib/utils';

type Filter = 'ALL' | PlatformClinic['status'] | 'OVERDUE' | 'TRIAL';
type Sort = 'newest' | 'name' | 'fee' | 'paid';

const PAYMENT_FILTERS: { value: '' | PaymentStateKind; label: string }[] = [
  { value: '', label: 'Any payment status' },
  { value: 'PAID', label: 'Paid' },
  { value: 'DUE_SOON', label: 'Due within a week' },
  { value: 'OVERDUE', label: 'Overdue' },
  { value: 'UNPAID', label: 'No payment recorded' },
  { value: 'TRIAL', label: 'On free trial' },
  { value: 'NO_PLAN', label: 'No plan' },
];

const countryName = (code: string) => COUNTRIES.find((x) => x.code === code)?.name ?? code;
const monthly = (c: PlatformClinic) => c.bill?.totalMinor ?? -1;

export default function PlatformClinicsPage() {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [access, setAccess] = useState<OwnerAccess | null>(null);
  const [paying, setPaying] = useState<PlatformClinic | null>(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('ALL');
  const [payment, setPayment] = useState<'' | PaymentStateKind>('');
  const [planFilter, setPlanFilter] = useState('');
  const [sort, setSort] = useState<Sort>('newest');
  const { run, pending } = useClinicActions(setAccess);
  const clinics = useQuery({
    queryKey: ['platform-clinics'],
    queryFn: () => api.get<PlatformClinic[]>('/platform/clinics'),
    // Watch clinics that are still being set up.
    refetchInterval: (query) => (query.state.data?.some((c) => c.status === 'PROVISIONING') ? 3000 : false),
  });

  const all = useMemo(() => clinics.data ?? [], [clinics.data]);
  const planNames = useMemo(() => [...new Set(all.map((c) => c.planName).filter(Boolean))] as string[], [all]);
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = all.filter((c) => {
      if (filter === 'OVERDUE' ? !(c.payment.kind === 'OVERDUE' || c.payment.kind === 'UNPAID') : filter === 'TRIAL' ? c.payment.kind !== 'TRIAL' : filter !== 'ALL' && c.status !== filter) return false;
      if (payment && c.payment.kind !== payment) return false;
      if (planFilter && (planFilter === '-' ? c.planName : c.planName !== planFilter)) return false;
      return !term || [c.name, c.slug, c.ownerName, c.ownerEmail].some((x) => x.toLowerCase().includes(term));
    });
    const by: Record<Sort, (a: PlatformClinic, b: PlatformClinic) => number> = {
      newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
      name: (a, b) => a.name.localeCompare(b.name),
      fee: (a, b) => monthly(b) - monthly(a),
      paid: (a, b) => (a.paidUntil ?? '0').localeCompare(b.paidUntil ?? '0'),
    };
    return [...list].sort(by[sort]);
  }, [all, q, filter, payment, planFilter, sort]);

  const count = (f: (c: PlatformClinic) => boolean) => all.filter(f).length;
  const tiles: { key: Filter; label: string; value: number; icon: React.ReactNode; tone: string }[] = [
    { key: 'ALL', label: 'All clinics', value: all.length, icon: <Building2 className="h-4 w-4" />, tone: 'text-primary bg-primary/10' },
    { key: 'ACTIVE', label: 'Ready', value: count((c) => c.status === 'ACTIVE'), icon: <CheckCircle2 className="h-4 w-4" />, tone: 'text-success bg-success/10' },
    { key: 'TRIAL', label: 'On free trial', value: count((c) => c.payment.kind === 'TRIAL'), icon: <Gift className="h-4 w-4" />, tone: 'text-primary bg-primary/10' },
    { key: 'OVERDUE', label: 'Payment overdue', value: count((c) => c.payment.kind === 'OVERDUE' || c.payment.kind === 'UNPAID'), icon: <Clock className="h-4 w-4" />, tone: 'text-destructive bg-destructive/10' },
    { key: 'SUSPENDED', label: 'Paused', value: count((c) => c.status === 'SUSPENDED'), icon: <PauseCircle className="h-4 w-4" />, tone: 'text-warning bg-warning/15' },
    ...(count((c) => c.status === 'FAILED') ? [{ key: 'FAILED' as const, label: 'Set-up failed', value: count((c) => c.status === 'FAILED'), icon: <AlertTriangle className="h-4 w-4" />, tone: 'text-destructive bg-destructive/10' }] : []),
  ];
  const filtered = filter !== 'ALL' || payment || planFilter || q;
  const reset = () => { setQ(''); setFilter('ALL'); setPayment(''); setPlanFilter(''); };

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Dashboard', href: '/platform' }, { label: 'Clinics' }]}
        title="Clinics"
        description="Every clinic with its plan, what it pays a month and a year, and whether it is paid up."
        actions={<Button onClick={() => setAdding(true)}><Plus /> Add clinic</Button>}
      />
      {all.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5" role="group" aria-label="Show clinics">
          {tiles.map((t) => {
            const active = filter === t.key;
            return (
              <button
                key={t.key}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(active && t.key !== 'ALL' ? 'ALL' : t.key)}
                className={cn('flex items-center gap-3 rounded-xl surface-flat p-3 text-left shadow-card transition-colors hover:border-primary/50', active && 'border-primary ring-1 ring-primary')}
              >
                <span className={cn('rounded-md p-2', t.tone)}>{t.icon}</span>
                <span><span className="block text-xl font-semibold leading-tight">{t.value}</span><span className="text-xs text-muted-foreground">{t.label}</span></span>
              </button>
            );
          })}
        </div>
      )}
      <Card>
        {all.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b p-3">
            <SearchInput value={q} onChange={setQ} placeholder="Search by clinic, address or owner" className="min-w-[14rem] max-w-sm flex-1" />
            <NativeSelect aria-label="Plan" value={planFilter} onChange={(e) => setPlanFilter(e.target.value)} className="h-9 w-auto">
              <option value="">All plans</option>
              {planNames.map((n) => <option key={n} value={n}>{n}</option>)}
              <option value="-">No plan</option>
            </NativeSelect>
            <NativeSelect aria-label="Payment status" value={payment} onChange={(e) => setPayment(e.target.value as '' | PaymentStateKind)} className="h-9 w-auto">
              {PAYMENT_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </NativeSelect>
            <NativeSelect aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="h-9 w-auto">
              <option value="newest">Newest first</option>
              <option value="name">Name A–Z</option>
              <option value="fee">Highest fee first</option>
              <option value="paid">Paid-until date (soonest first)</option>
            </NativeSelect>
            {filtered && <Button variant="ghost" size="sm" onClick={reset}>Clear</Button>}
            <span className="ml-auto text-xs text-muted-foreground">{rows.length} of {all.length}</span>
          </div>
        )}
        {clinics.isLoading ? (
          <LoadingRows />
        ) : clinics.error ? (
          <ErrorState error={clinics.error} onRetry={() => clinics.refetch()} />
        ) : !all.length ? (
          <EmptyState icon={Building2} title="No clinics yet" description="Add the first clinic. It gets its own database and web address, ready in about a minute." action={<Button onClick={() => setAdding(true)}><Plus /> Add clinic</Button>} />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Clinic</TH>
                <TH className="hidden md:table-cell">Plan</TH>
                <TH className="hidden sm:table-cell">Fee</TH>
                <TH className="hidden lg:table-cell">Payment</TH>
                <TH>Status</TH>
                <TH className="hidden xl:table-cell">Owner</TH>
                <TH className="w-px"><span className="sr-only">Actions</span></TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((c) => (
                <TR key={c.id} data-clickable="true" onClick={() => router.push(`/platform/clinics/${c.id}`)}>
                  <TD>
                    <div className="font-medium text-primary">{c.name}</div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground" onClick={(e) => e.stopPropagation()}>
                      <span className="max-w-[15rem] truncate" title={shortAddress(c.address)}>{shortAddress(c.address)}</span>
                      <span className="hidden sm:inline"><CopyButton text={c.address} what="Address" /></span>
                    </div>
                    <div className="text-2xs text-muted-foreground">{countryName(c.country)} · added {fmtDate(c.createdAt)}</div>
                  </TD>
                  <TD className="hidden md:table-cell">
                    {c.planName ? <Badge variant="secondary">{c.planName}</Badge> : <span className="text-xs text-muted-foreground">No plan</span>}
                    {c.bill && <div className="mt-1 text-2xs text-muted-foreground">{c.bill.cycle === 'YEARLY' ? 'Pays yearly' : 'Pays monthly'}{c.bill.extraStaff || c.bill.extraBranches ? ` · ${[c.bill.extraStaff && `+${c.bill.extraStaff} staff`, c.bill.extraBranches && `+${c.bill.extraBranches} branch${c.bill.extraBranches === 1 ? '' : 'es'}`].filter(Boolean).join(', ')}` : ''}</div>}
                  </TD>
                  <TD className="hidden sm:table-cell">{c.bill ? <FeeLines bill={c.bill} /> : <span className="text-xs text-muted-foreground">Not charged</span>}</TD>
                  <TD className="hidden lg:table-cell">
                    <PaymentBadge state={c.payment} />
                    <div className="mt-1 text-2xs text-muted-foreground">{paymentText(c.payment)}</div>
                  </TD>
                  <TD>
                    <StatusBadge status={c.status} />
                    <div className="mt-1 lg:hidden"><PaymentBadge state={c.payment} /></div>
                    {c.status !== 'ACTIVE' && (
                      <p className="mt-1 max-w-[14rem] text-xs text-muted-foreground">
                        {c.status === 'FAILED' && c.lastError ? c.lastError.split('\n')[0].slice(0, 120) : c.pausedReason === 'TRIAL_ENDED' ? 'Free trial ended — record a payment to reactivate' : c.pausedReason === 'UNPAID' ? 'Paused for non-payment' : STATUS[c.status].hint}
                      </p>
                    )}
                  </TD>
                  <TD className="hidden xl:table-cell">
                    <div>{c.ownerName}</div>
                    <div className="text-xs text-muted-foreground">{c.ownerEmail}</div>
                  </TD>
                  <TD onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      {c.status === 'ACTIVE' && (
                        <Button asChild size="sm" variant="outline" className="hidden 2xl:inline-flex"><a href={`${c.address}/login`} target="_blank" rel="noreferrer"><ExternalLink /> Open</a></Button>
                      )}
                      {c.status === 'FAILED' && (
                        <Button size="sm" variant="outline" loading={pending?.id === c.id} onClick={() => run(c, 'retry')}><RotateCcw /> Try again</Button>
                      )}
                      {c.status === 'PROVISIONING' && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Setting up" />}
                      <ClinicActionsMenu clinic={c} run={run} onRecordPayment={setPaying} />
                    </div>
                  </TD>
                </TR>
              ))}
              {!rows.length && <TR><TD colSpan={7} className="py-8 text-center text-muted-foreground">No clinics match. <button type="button" className="text-primary hover:underline" onClick={reset}>Show all clinics</button></TD></TR>}
            </TBody>
          </Table>
        )}
      </Card>
      <AddClinicDialog open={adding} onOpenChange={setAdding} onOwnerAccess={setAccess} />
      <OwnerAccessDialog result={access} onClose={() => setAccess(null)} />
      <RecordPaymentDialog clinic={paying} open={!!paying} onOpenChange={(o) => { if (!o) setPaying(null); }} />
    </>
  );
}
