'use client';
import { useQuery } from '@tanstack/react-query';
import { enumLabel } from '@vcms/shared';
import { Printer } from 'lucide-react';
import { Suspense } from 'react';
import { INVENTORY_LINKS, SectionNav } from '@/components/billing/section-nav';
import { REF_LABEL } from '@/components/inventory/movements-table';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useUrlState } from '@/hooks/use-url-state';
import { api, qs } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import { shiftDate, todayIn, zonedInstant } from '@/lib/time';
import type { StockMovement } from '@/lib/types';

/** Controlled-drug register: every movement of controlled products, grouped by product, with running balances. */
function Register() {
  const { session } = useSession();
  const tz = session.branch?.timezone ?? 'UTC';
  const url = useUrlState();
  const today = todayIn(tz);
  const from = url.get('from', shiftDate(today, -30));
  const to = url.get('to', today);
  const range = { from: zonedInstant(from, 0, tz).toISOString(), to: zonedInstant(shiftDate(to, 1), 0, tz).toISOString() };
  const q = useQuery({ queryKey: ['controlled-register', range], queryFn: () => api.get<StockMovement[]>(`/stock/controlled-register${qs(range)}`) });
  const groups = (q.data ?? []).reduce<Record<string, StockMovement[]>>((acc, m) => ((acc[m.product.name] ??= []).push(m), acc), {});
  return (
    <>
      <div className="no-print">
        <PageHeader
          title="Controlled medicines register"
          breadcrumbs={[{ label: 'Inventory', href: '/inventory' }, { label: 'Controlled register' }]}
          description="Every receipt, issue, adjustment and count of controlled products. Entries are permanent and cannot be edited."
          actions={<Button size="sm" variant="outline" onClick={() => window.print()}><Printer /> Print</Button>}
        />
        <SectionNav links={INVENTORY_LINKS} />
        <div className="mb-4 flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-xs">From<Input type="date" value={from} max={to} onChange={(e) => url.set({ from: e.target.value })} /></label>
          <label className="grid gap-1 text-xs">To<Input type="date" value={to} min={from} onChange={(e) => url.set({ to: e.target.value })} /></label>
        </div>
      </div>
      <h1 className="mb-2 hidden text-lg font-bold print:block">Controlled medicines register · {from} to {to} · {session.organization?.name}</h1>
      {q.isLoading ? <LoadingRows /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !Object.keys(groups).length ? (
        <Card><EmptyState title="No controlled-medicine movements in this period" /></Card>
      ) : (
        <div className="grid gap-4">
          {Object.entries(groups).map(([name, rows]) => (
            <Card key={name} className="break-inside-avoid">
              <CardHeader><CardTitle>{name}{rows[0].product.controlledSchedule && <span className="ml-2 text-xs font-normal text-muted-foreground">Schedule {rows[0].product.controlledSchedule}</span>}</CardTitle></CardHeader>
              <Table>
                <THead><TR><TH>Date & time</TH><TH>Movement</TH><TH>Batch</TH><TH>Location</TH><TH>By</TH><TH>Reason / reference</TH><TH className="text-right">In</TH><TH className="text-right">Out</TH><TH className="text-right">Balance</TH></TR></THead>
                <TBody>
                  {rows.map((m) => (
                    <TR key={m.id}>
                      <TD className="whitespace-nowrap text-xs">{fmtDateTime(m.createdAt)}</TD>
                      <TD className="text-sm">{enumLabel(m.type)}</TD>
                      <TD className="text-sm">{m.batch.batchNumber}</TD>
                      <TD className="text-sm">{m.location.name}</TD>
                      <TD className="text-xs">{m.createdByName}</TD>
                      <TD className="text-xs">{[m.reason, m.referenceType && (REF_LABEL[m.referenceType] ?? m.referenceType)].filter(Boolean).join(' · ')}</TD>
                      <TD className="text-right tabular">{m.quantity > 0 ? m.quantity : ''}</TD>
                      <TD className="text-right tabular">{m.quantity < 0 ? -m.quantity : ''}</TD>
                      <TD className="text-right font-medium tabular">{m.balanceAfter} <span className="text-2xs font-normal text-muted-foreground">{m.product.dispensingUnit}</span></TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

export default function ControlledPage() {
  return (
    <RequirePermission anyOf={['inventory.read']}>
      <Suspense><Register /></Suspense>
    </RequirePermission>
  );
}
