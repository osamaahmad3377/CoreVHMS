'use client';
import { useQuery } from '@tanstack/react-query';
import { enumLabel, fromMinor, toMinor, type Permission } from '@vcms/shared';
import { Download } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Stat } from '@/components/stat';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, NativeSelect } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useUrlState } from '@/hooks/use-url-state';
import { api, qs } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import { shiftDate, todayIn, zonedInstant } from '@/lib/time';
import { cn } from '@/lib/utils';

const REPORTS: { key: string; label: string; perm: Permission[]; ranged: boolean }[] = [
  { key: 'financial-summary', label: 'Financial summary', perm: ['reports.financial'], ranged: true },
  { key: 'sales-by-item', label: 'Sales by item', perm: ['reports.view', 'reports.financial'], ranged: true },
  { key: 'sales-by-category', label: 'Sales by category', perm: ['reports.view', 'reports.financial'], ranged: true },
  { key: 'aged-receivables', label: 'Aged receivables', perm: ['reports.view', 'reports.financial'], ranged: false },
  { key: 'stock-valuation', label: 'Stock valuation', perm: ['reports.view', 'reports.financial'], ranged: false },
  { key: 'write-offs', label: 'Write-offs', perm: ['reports.view', 'reports.financial'], ranged: true },
  { key: 'appointments', label: 'Appointments', perm: ['reports.view', 'reports.financial'], ranged: true },
  { key: 'clinical-activity', label: 'Clinical activity', perm: ['reports.view'], ranged: true },
];

const BUCKETS = { current: 'Not yet due', d1_30: '1–30 days', d31_60: '31–60 days', d61_90: '61–90 days', d90plus: '90+ days' };

interface Summary {
  grossBilledMinor: number; taxBilledMinor: number; creditNotesMinor: number; netRevenueMinor: number; costOfGoodsMinor: number; grossProfitMinor: number;
  expensesMinor: number; operatingProfitMinor: number; cashReceivedMinor: number; refundsMinor: number; outstandingMinor: number; invoiceCount: number;
  paymentsByMethod: { method: string; count: number; amountMinor: number }[]; expensesByCategory: { category: string; amountMinor: number }[];
}

function SummaryView({ d, currency }: { d: Summary; currency: string }) {
  const m = (n: number) => fmtMoney(n, currency);
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="Net revenue (excl. tax)" value={m(d.netRevenueMinor)} hint={`${d.invoiceCount} invoices · billed ${m(d.grossBilledMinor)} incl. tax`} />
        <Stat label="Gross profit" value={m(d.grossProfitMinor)} hint={`Cost of goods ${m(d.costOfGoodsMinor)}`} tone={d.grossProfitMinor < 0 ? 'danger' : 'success'} />
        <Stat label="Operating profit" value={m(d.operatingProfitMinor)} hint={`Expenses ${m(d.expensesMinor)} excl. tax`} tone={d.operatingProfitMinor < 0 ? 'danger' : 'default'} />
        <Stat label="Cash received (net of refunds)" value={m(d.cashReceivedMinor)} hint={`Refunds ${m(d.refundsMinor)} · outstanding now ${m(d.outstandingMinor)}`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Payments by method</CardTitle></CardHeader>
          <CardContent className="h-56">
            {d.paymentsByMethod.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.paymentsByMethod.map((p) => ({ name: enumLabel(p.method), value: Number(fromMinor(p.amountMinor, currency)) }))} margin={{ left: -10 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <Tooltip formatter={(v: number) => m(toMinor(v, currency))} contentStyle={{ fontSize: 12, borderRadius: 6 }} />
                  <Bar dataKey="value" name="Received" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} maxBarSize={44} />
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyState title="No payments in this period" />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Breakdown</CardTitle></CardHeader>
          <Table>
            <TBody>
              <TR><TD>Gross billed (incl. tax)</TD><TD className="text-right tabular">{m(d.grossBilledMinor)}</TD></TR>
              <TR><TD>Credit notes</TD><TD className="text-right tabular">−{m(d.creditNotesMinor)}</TD></TR>
              <TR><TD>Tax collected (net of credits)</TD><TD className="text-right tabular">{m(d.taxBilledMinor)}</TD></TR>
              <TR><TD className="font-medium">Net revenue</TD><TD className="text-right font-medium tabular">{m(d.netRevenueMinor)}</TD></TR>
              <TR><TD>Cost of goods (stock issued at cost, less returns)</TD><TD className="text-right tabular">−{m(d.costOfGoodsMinor)}</TD></TR>
              {d.expensesByCategory.map((e) => <TR key={e.category}><TD className="pl-6 text-muted-foreground">{enumLabel(e.category)}</TD><TD className="text-right tabular text-muted-foreground">−{m(e.amountMinor)}</TD></TR>)}
              <TR><TD className="font-semibold">Operating profit</TD><TD className="text-right font-semibold tabular">{m(d.operatingProfitMinor)}</TD></TR>
            </TBody>
          </Table>
        </Card>
      </div>
      <p className="text-xs text-muted-foreground">Revenue is recognised when invoices are issued (void invoices excluded). Supplier payments recorded as expenses are included in expenses; inventory purchases are counted only as cost of goods when issued, so avoid recording the same stock purchase as both.</p>
    </div>
  );
}

interface Clinical {
  consultations: { total: number; completed: number; byClinician: { clinician: string; count: number }[]; bySpecies: { species: string; count: number }[] };
  diagnoses: { diagnosis: string; count: number; confirmed: number }[];
  hospital: { admitted: number; discharged: number; averageStayDays: number | null; outcomes: { outcome: string; count: number }[] };
  surgery: { completed: number; withComplications: number; byProcedure: { procedure: string; count: number }[] };
  newPatients: { total: number; bySpecies: { species: string; count: number }[] };
}

function CountTable({ title, rows, label, extra }: { title: string; rows: { label: string; count: number; extra?: string }[]; label: string; extra?: string }) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      {rows.length ? (
        <Table>
          <THead><TR><TH>{label}</TH>{extra && <TH className="text-right">{extra}</TH>}<TH className="text-right">Count</TH></TR></THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.label}><TD className="text-sm">{r.label}</TD>{extra && <TD className="text-right tabular text-muted-foreground">{r.extra}</TD>}<TD className="text-right tabular">{r.count}</TD></TR>
            ))}
          </TBody>
        </Table>
      ) : <EmptyState title="Nothing recorded in this period" />}
    </Card>
  );
}

function ClinicalView({ d }: { d: Clinical }) {
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="Consultations" value={d.consultations.total} hint={`${d.consultations.completed} completed`} />
        <Stat label="Hospital admissions" value={d.hospital.admitted} hint={`${d.hospital.discharged} discharged${d.hospital.averageStayDays === null ? '' : ` · average stay ${d.hospital.averageStayDays} days`}`} />
        <Stat label="Surgeries completed" value={d.surgery.completed} hint={`${d.surgery.withComplications} with complications recorded`} />
        <Stat label="New patients" value={d.newPatients.total} hint="All branches" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Consultations by species</CardTitle></CardHeader>
          <CardContent className="h-56">
            {d.consultations.bySpecies.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.consultations.bySpecies.map((r) => ({ name: r.species, value: r.count }))} margin={{ left: -20 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} />
                  <Bar dataKey="value" name="Consultations" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} maxBarSize={44} />
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyState title="No consultations in this period" />}
          </CardContent>
        </Card>
        <CountTable title="Consultations by clinician" label="Clinician" rows={d.consultations.byClinician.map((r) => ({ label: r.clinician, count: r.count }))} />
        <CountTable title="Most frequent diagnoses" label="Diagnosis" extra="Confirmed" rows={d.diagnoses.map((r) => ({ label: r.diagnosis, count: r.count, extra: String(r.confirmed) }))} />
        <CountTable title="Surgery by procedure" label="Procedure" rows={d.surgery.byProcedure.map((r) => ({ label: r.procedure, count: r.count }))} />
        <CountTable title="Hospital outcomes (discharged in period)" label="Outcome" rows={d.hospital.outcomes.map((r) => ({ label: enumLabel(r.outcome), count: r.count }))} />
        <CountTable title="New patients by species" label="Species" rows={d.newPatients.bySpecies.map((r) => ({ label: r.species, count: r.count }))} />
      </div>
      <p className="text-xs text-muted-foreground">Counts only, without client or patient details. Consultations by start date (cancelled excluded), diagnoses by date recorded (top 15; same wording counted together regardless of capitals), hospital stays by admission date, outcomes and average stay by discharge date, surgeries by completion date (top 10 procedures).</p>
    </div>
  );
}

function GenericTable({ rows, currency }: { rows: Record<string, unknown>[]; currency: string }) {
  if (!rows.length) return <EmptyState title="No data for this period" />;
  const cols = Object.keys(rows[0]).filter((c) => !['id', 'productId', 'organizationId', 'batchId', 'locationId', 'branchId'].includes(c) && typeof rows[0][c] !== 'object');
  return (
    <Table>
      <THead><TR>{cols.map((c) => <TH key={c} className={c.endsWith('Minor') || typeof rows[0][c] === 'number' ? 'text-right' : ''}>{enumLabel(c.replace(/Minor$/, '').replace(/([A-Z])/g, '_$1').toUpperCase())}</TH>)}</TR></THead>
      <TBody>
        {rows.map((r, i) => (
          <TR key={i}>
            {cols.map((c) => {
              const v = r[c];
              return <TD key={c} className={typeof v === 'number' ? 'text-right tabular' : 'text-sm'}>{c.endsWith('Minor') ? fmtMoney(v as number, currency) : typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) ? fmtDate(v) : typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(2)) : String(v ?? '—')}</TD>;
            })}
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

function Reports() {
  const { canAny, currency, session } = useSession();
  const tz = session.branch?.timezone ?? 'UTC';
  const url = useUrlState();
  const available = REPORTS.filter((r) => canAny(...r.perm));
  const report = available.find((r) => r.key === url.get('report')) ?? available[0];
  const today = todayIn(tz);
  const from = url.get('from', shiftDate(today, -29));
  const to = url.get('to', today);
  const scope = url.get('scope', 'all');
  const params = { from: zonedInstant(from, 0, tz).toISOString(), to: zonedInstant(shiftDate(to, 1), 0, tz).toISOString(), branchId: scope === 'branch' ? session.branch?.id : undefined };
  const q = useQuery({ queryKey: ['report', report?.key, params], queryFn: () => api.get<any>(`/reports/${report!.key}${qs(params)}`), enabled: !!report });
  if (!report) return <EmptyState title="No reports available for your role" />;
  const rows: Record<string, unknown>[] = !q.data ? [] : Array.isArray(q.data) ? q.data : report.key === 'aged-receivables' ? q.data.invoices.map((i: any) => ({ invoiceNo: i.invoiceNo, client: i.client?.displayName, dueAt: i.dueAt, daysOverdue: i.daysOverdue, bucket: BUCKETS[i.bucket as keyof typeof BUCKETS], balanceMinor: i.balanceMinor })) : report.key === 'write-offs' ? q.data.rows.map((r: any) => ({ date: r.createdAt, product: r.product.name, batch: r.batch.batchNumber, quantity: -r.quantity, reason: r.reason, costMinor: r.costMinor })) : q.data.rows ?? [];
  return (
    <>
      <PageHeader
        help="reports"
        title="Reports"
        description={report.ranged ? `${fmtDate(from)} – ${fmtDate(to)} (${tz})` : 'As of now'}
        actions={<Button size="sm" variant="outline" asChild><a href={`/api/v1/reports/${report.key}${qs({ ...params, format: 'csv' })}`} download><Download /> CSV</a></Button>}
      />
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end">
        <div className="flex flex-wrap gap-1" role="tablist">
          {available.map((r) => (
            <button key={r.key} role="tab" aria-selected={r.key === report.key} onClick={() => url.set({ report: r.key })} className={cn('rounded-md px-3 py-1.5 text-sm', r.key === report.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}>{r.label}</button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-2 lg:ml-auto">
          {report.ranged && (
            <>
              <label className="grid gap-1 text-xs">From<Input type="date" value={from} max={to} onChange={(e) => url.set({ from: e.target.value })} /></label>
              <label className="grid gap-1 text-xs">To<Input type="date" value={to} min={from} onChange={(e) => url.set({ to: e.target.value })} /></label>
            </>
          )}
          <NativeSelect aria-label="Branch scope" className="w-44" value={scope} onChange={(e) => url.set({ scope: e.target.value })}>
            <option value="all">All branches</option>
            <option value="branch">{session.branch?.name ?? 'Current branch'}</option>
          </NativeSelect>
        </div>
      </div>
      {q.isLoading ? <LoadingRows /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : report.key === 'financial-summary' ? (
        <SummaryView d={q.data} currency={currency} />
      ) : report.key === 'clinical-activity' ? (
        <ClinicalView d={q.data} />
      ) : report.key === 'appointments' ? (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <Stat label="Appointments" value={q.data.total} />
          <Stat label="No-show rate" value={`${(q.data.noShowRate * 100).toFixed(1)}%`} hint={`${q.data.byStatus.NO_SHOW ?? 0} no-shows`} />
          <Stat label="Cancellation rate" value={`${(q.data.cancellationRate * 100).toFixed(1)}%`} hint={`${q.data.byStatus.CANCELLED ?? 0} cancelled`} />
          <Stat label="Completed" value={q.data.byStatus.COMPLETED ?? 0} />
        </div>
      ) : (
        <Card>
          {report.key === 'aged-receivables' && (
            <div className="grid grid-cols-2 gap-3 border-b p-4 sm:grid-cols-5">
              {Object.entries(q.data.buckets as Record<string, number>).map(([k, v]) => (
                <div key={k}><p className="text-xs text-muted-foreground">{BUCKETS[k as keyof typeof BUCKETS]}</p><p className="font-semibold tabular">{fmtMoney(v, currency)}</p></div>
              ))}
            </div>
          )}
          {'totalMinor' in (q.data ?? {}) && <p className="border-b px-4 py-2 text-sm">Total <b className="tabular">{fmtMoney(q.data.totalMinor, currency)}</b></p>}
          <GenericTable rows={rows} currency={currency} />
          {report.key === 'aged-receivables' && <p className="p-3 text-xs text-muted-foreground">Open an invoice from <Link className="underline" href="/billing?tab=overdue">Billing</Link> to take payment.</p>}
        </Card>
      )}
    </>
  );
}

export default function ReportsPage() {
  return (
    <RequirePermission anyOf={['reports.view', 'reports.financial']}>
      <Suspense><Reports /></Suspense>
    </RequirePermission>
  );
}
