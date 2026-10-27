'use client';
import { useQuery } from '@tanstack/react-query';
import { PLATFORM_PAYMENT_METHODS, PLATFORM_PAYMENT_METHOD_LABELS, type ClinicPaymentView, type PlatformPaymentMethod } from '@vcms/shared';
import { Download, ReceiptText } from 'lucide-react';
import { useMemo, useState } from 'react';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/page';
import { PaymentsTable, downloadPaymentsCsv } from '@/components/platform/billing-ui';
import { amount } from '@/components/platform/plan-ui';
import { SearchInput } from '@/components/search-input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { NativeSelect } from '@/components/ui/input';
import { api } from '@/lib/api';

type Period = 'this-month' | 'last-month' | 'this-year' | 'last-12' | 'all';
const PERIODS: { value: Period; label: string }[] = [
  { value: 'this-month', label: 'This month' },
  { value: 'last-month', label: 'Last month' },
  { value: 'this-year', label: 'This year' },
  { value: 'last-12', label: 'Last 12 months' },
  { value: 'all', label: 'All time' },
];

/** The date range of a period, in UTC (payments are stored in UTC). */
function range(p: Period): { from?: string; to?: string } {
  const n = new Date();
  const m = (y: number, mo: number) => new Date(Date.UTC(y, mo, 1)).toISOString();
  const y = n.getUTCFullYear();
  const mo = n.getUTCMonth();
  switch (p) {
    case 'this-month':
      return { from: m(y, mo) };
    case 'last-month':
      return { from: m(y, mo - 1), to: m(y, mo) };
    case 'this-year':
      return { from: m(y, 0) };
    case 'last-12':
      return { from: m(y, mo - 11) };
    default:
      return {};
  }
}

export default function PlatformPaymentsPage() {
  const [period, setPeriod] = useState<Period>('this-year');
  const [q, setQ] = useState('');
  const [method, setMethod] = useState<'' | PlatformPaymentMethod>('');
  const [showCancelled, setShowCancelled] = useState(false);
  const r = range(period);
  const qs = new URLSearchParams(Object.entries(r).filter(([, v]) => v) as [string, string][]).toString();
  const payments = useQuery({ queryKey: ['platform-payments', period], queryFn: () => api.get<ClinicPaymentView[]>(`/platform/payments${qs ? `?${qs}` : ''}`) });

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (payments.data ?? []).filter(
      (p) => (showCancelled || !p.voidedAt) && (!method || p.method === method) && (!term || [p.clinicName, p.receipt, p.reference ?? ''].some((x) => x.toLowerCase().includes(term))),
    );
  }, [payments.data, q, method, showCancelled]);

  const counted = rows.filter((p) => !p.voidedAt);
  const byCurrency = counted.reduce<Record<string, number>>((acc, p) => ({ ...acc, [p.currency]: (acc[p.currency] ?? 0) + p.amountMinor }), {});
  const yearly = counted.filter((p) => p.billingCycle === 'YEARLY');
  const freeGiven = counted.reduce((n, p) => n + p.freeMonths, 0);
  const cancelled = (payments.data ?? []).filter((p) => p.voidedAt).length;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Dashboard', href: '/platform' }, { label: 'Payments' }]}
        title="Payments"
        description="Every payment clinics have made to NextCore, with receipts. Record a payment from the clinic’s page or the dashboard."
        actions={<Button variant="outline" disabled={!rows.length} onClick={() => downloadPaymentsCsv(rows, `nextcore-payments-${period}`)}><Download /> Export CSV</Button>}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl bg-gradient-to-br from-success/[0.12] to-transparent p-4 shadow-card ring-1 ring-inset ring-success/20">
          <p className="text-xs font-medium text-muted-foreground">Collected · {PERIODS.find((p) => p.value === period)?.label.toLowerCase()}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{Object.keys(byCurrency).length ? Object.entries(byCurrency).map(([c, v]) => amount(v, c)).join(' + ') : amount(0, 'PKR')}</p>
        </div>
        <div className="rounded-2xl surface-flat p-4 shadow-card">
          <p className="text-xs font-medium text-muted-foreground">Payments</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{counted.length}</p>
          <p className="text-xs text-muted-foreground">{cancelled ? `${cancelled} cancelled` : 'none cancelled'}</p>
        </div>
        <div className="rounded-2xl surface-flat p-4 shadow-card">
          <p className="text-xs font-medium text-muted-foreground">Paid a year upfront</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{yearly.length}</p>
          <p className="text-xs text-muted-foreground">{counted.length ? `${Math.round((yearly.length / counted.length) * 100)}% of payments` : '—'}</p>
        </div>
        <div className="rounded-2xl surface-flat p-4 shadow-card">
          <p className="text-xs font-medium text-muted-foreground">Free months given</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{freeGiven}</p>
          <p className="text-xs text-muted-foreground">on top of paid months</p>
        </div>
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <NativeSelect aria-label="Period" value={period} onChange={(e) => setPeriod(e.target.value as Period)} className="h-9 w-auto">
            {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </NativeSelect>
          <SearchInput value={q} onChange={setQ} placeholder="Clinic, receipt or reference" className="min-w-[14rem] max-w-sm flex-1" />
          <NativeSelect aria-label="Paid by" value={method} onChange={(e) => setMethod(e.target.value as '' | PlatformPaymentMethod)} className="h-9 w-auto">
            <option value="">Any method</option>
            {PLATFORM_PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PLATFORM_PAYMENT_METHOD_LABELS[m]}</option>)}
          </NativeSelect>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={showCancelled} onCheckedChange={(c) => setShowCancelled(c === true)} /> Show cancelled</label>
          <span className="ml-auto text-xs text-muted-foreground">{rows.length} payment{rows.length === 1 ? '' : 's'}</span>
        </div>
        {payments.isLoading ? (
          <LoadingRows />
        ) : payments.error ? (
          <ErrorState error={payments.error} onRetry={() => payments.refetch()} />
        ) : rows.length ? (
          <PaymentsTable payments={rows} showClinic />
        ) : (
          <EmptyState icon={ReceiptText} title="No payments here" description={payments.data?.length ? 'Nothing matches these filters.' : 'No payments were recorded in this period. Record one from a clinic’s page when it pays.'} />
        )}
      </Card>
    </>
  );
}
