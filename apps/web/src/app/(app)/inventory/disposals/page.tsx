'use client';
import { useQuery } from '@tanstack/react-query';
import type { Paginated } from '@vcms/shared';
import { AlertTriangle, CalendarClock, Lock, ShieldAlert, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { Suspense, useMemo, useState } from 'react';
import { INVENTORY_LINKS, SectionNav } from '@/components/billing/section-nav';
import { DisposeDialog, type DisposeItem } from '@/components/inventory/dispose-dialog';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Stat } from '@/components/stat';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { NativeSelect } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useUrlState } from '@/hooks/use-url-state';
import { api, qs } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { DisposalCandidate, DisposalCandidates, StockDisposal, StockLocation } from '@/lib/types';
import { cn } from '@/lib/utils';

const STATE = {
  EXPIRED: { label: 'Expired', variant: 'destructive' },
  EXPIRING: { label: 'Expiring', variant: 'warning' },
  RECALLED: { label: 'Recalled', variant: 'destructive' },
  QUARANTINED: { label: 'Quarantined', variant: 'secondary' },
} as const;

const rowKey = (r: DisposalCandidate) => `${r.batchId}:${r.location.id}`;
const toItem = (r: DisposalCandidate): DisposeItem => ({
  batchId: r.batchId,
  batchNumber: r.batchNumber,
  expiryDate: r.expiryDate,
  expired: r.state === 'EXPIRED',
  recalled: r.state === 'RECALLED',
  productName: r.product.name,
  unit: r.product.dispensingUnit,
  isControlled: r.product.isControlled,
  location: r.location,
  onHand: r.quantity,
  unitCostMinor: r.unitCostMinor,
});

function ToDispose() {
  const { can, currency } = useSession();
  const url = useUrlState();
  const days = Number(url.get('days', '60'));
  const locationId = url.get('locationId');
  const show = url.get('show');
  const q = useQuery({ queryKey: ['disposal-candidates', days, locationId], queryFn: () => api.get<DisposalCandidates>(`/stock/disposals/candidates${qs({ days, locationId })}`) });
  const locations = useQuery({ queryKey: ['stock-locations'], queryFn: () => api.get<StockLocation[]>('/stock-locations') });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [disposing, setDisposing] = useState<DisposeItem[] | null>(null);
  const rows = useMemo(() => (q.data?.rows ?? []).filter((r) => !show || r.state === show), [q.data, show]);
  const canDispose = can('inventory.adjust');
  const picked = rows.filter((r) => selected.has(rowKey(r)));
  const s = q.data?.summary;
  const toggleAll = (on: boolean) => setSelected(on ? new Set(rows.map(rowKey)) : new Set());

  return (
    <>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <button type="button" className="text-left" onClick={() => url.set({ show: show === 'EXPIRED' ? null : 'EXPIRED' })}>
          <Stat label="Expired, still on the shelf" value={s ? s.expired.count : '—'} hint={s ? `${fmtMoney(s.expired.valueMinor, currency)} at cost — can’t be used or sold` : undefined} icon={AlertTriangle} tone={s?.expired.count ? 'danger' : 'default'} />
        </button>
        <button type="button" className="text-left" onClick={() => url.set({ show: show === 'EXPIRING' ? null : 'EXPIRING' })}>
          <Stat label={`Expiring within ${days} days`} value={s ? s.expiring.count : '—'} hint={s ? `${fmtMoney(s.expiring.valueMinor, currency)} at cost` : undefined} icon={CalendarClock} tone={s?.expiring.count ? 'warning' : 'default'} />
        </button>
        <button type="button" className="text-left" onClick={() => url.set({ show: show === 'RECALLED' ? null : 'RECALLED' })}>
          <Stat label="Recalled" value={s ? s.recalled.count : '—'} hint={s ? fmtMoney(s.recalled.valueMinor, currency) : undefined} icon={ShieldAlert} tone={s?.recalled.count ? 'danger' : 'default'} />
        </button>
        <button type="button" className="text-left" onClick={() => url.set({ show: show === 'QUARANTINED' ? null : 'QUARANTINED' })}>
          <Stat label="Quarantined" value={s ? s.quarantined.count : '—'} hint={s ? fmtMoney(s.quarantined.valueMinor, currency) : undefined} icon={Lock} />
        </button>
      </div>
      <Card>
        <div className="flex flex-col gap-2 border-b p-3 lg:flex-row lg:items-center">
          <NativeSelect aria-label="Store room" className="lg:w-52" value={locationId} onChange={(e) => { url.set({ locationId: e.target.value }); setSelected(new Set()); }}>
            <option value="">All store rooms</option>
            {(locations.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </NativeSelect>
          <NativeSelect aria-label="Expiring within" className="lg:w-52" value={String(days)} onChange={(e) => { url.set({ days: e.target.value }); setSelected(new Set()); }}>
            <option value="0">Expired only</option>
            <option value="30">Expiring within 30 days</option>
            <option value="60">Expiring within 60 days</option>
            <option value="90">Expiring within 90 days</option>
            <option value="180">Expiring within 6 months</option>
          </NativeSelect>
          {show && (
            <Button size="sm" variant="ghost" onClick={() => url.set({ show: null })}>
              Showing {STATE[show as keyof typeof STATE]?.label.toLowerCase()} only — show all
            </Button>
          )}
          {canDispose && picked.length > 0 && (
            <Button className="lg:ml-auto" variant="destructive" onClick={() => setDisposing(picked.map(toItem))}>
              <Trash2 /> Dispose {picked.length} selected ({fmtMoney(picked.reduce((n, r) => n + r.valueMinor, 0), currency)})
            </Button>
          )}
        </div>
        {q.isLoading ? (
          <LoadingRows />
        ) : q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !rows.length ? (
          <EmptyState icon={CalendarClock} title="Nothing to dispose of" description={days ? `No expired, recalled or quarantined stock, and nothing expiring within ${days} days.` : 'No expired, recalled or quarantined stock on the shelves.'} />
        ) : (
          <Table>
            <THead>
              <TR>
                {canDispose && (
                  <TH className="w-10">
                    <Checkbox aria-label="Select all" checked={picked.length === rows.length} onCheckedChange={(v) => toggleAll(v === true)} />
                  </TH>
                )}
                <TH>Product</TH>
                <TH>Batch</TH>
                <TH>Expiry</TH>
                <TH className="hidden md:table-cell">Store room</TH>
                <TH className="text-right">On hand</TH>
                <TH className="hidden text-right sm:table-cell">Value at cost</TH>
                <TH>Status</TH>
                {canDispose && <TH className="w-24"><span className="sr-only">Dispose</span></TH>}
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => {
                const k = rowKey(r);
                return (
                  <TR key={k} className={cn(selected.has(k) && 'bg-primary/5')}>
                    {canDispose && (
                      <TD>
                        <Checkbox aria-label={`Select ${r.product.name} batch ${r.batchNumber} at ${r.location.name}`} checked={selected.has(k)} onCheckedChange={(v) => setSelected((cur) => { const n = new Set(cur); if (v === true) n.add(k); else n.delete(k); return n; })} />
                      </TD>
                    )}
                    <TD>
                      <Link href={`/inventory/products/${r.product.id}`} className="flex items-center gap-1 font-medium hover:underline">
                        {r.product.name}
                        {r.product.isControlled && <Lock className="h-3 w-3 text-warning" aria-label="Controlled" />}
                      </Link>
                      {r.product.sku && <p className="text-xs text-muted-foreground">{r.product.sku}</p>}
                    </TD>
                    <TD className="text-sm">{r.batchNumber}</TD>
                    <TD className="whitespace-nowrap text-sm">
                      {r.expiryDate ? fmtDate(r.expiryDate) : '—'}
                      {r.daysLeft !== null && (
                        <span className={cn('block text-xs', r.daysLeft < 0 ? 'font-medium text-destructive' : r.daysLeft <= 30 ? 'text-warning' : 'text-muted-foreground')}>
                          {r.daysLeft < 0 ? `expired ${-r.daysLeft} day${r.daysLeft === -1 ? '' : 's'} ago` : r.daysLeft === 0 ? 'expires today' : `in ${r.daysLeft} day${r.daysLeft === 1 ? '' : 's'}`}
                        </span>
                      )}
                    </TD>
                    <TD className="hidden text-sm md:table-cell">{r.location.name}</TD>
                    <TD className="whitespace-nowrap text-right tabular">{r.quantity} <span className="text-xs text-muted-foreground">{r.product.dispensingUnit}</span></TD>
                    <TD className="hidden text-right tabular sm:table-cell">{fmtMoney(r.valueMinor, currency)}</TD>
                    <TD>
                      <Badge variant={STATE[r.state].variant} title={r.statusReason ?? undefined}>{STATE[r.state].label}</Badge>
                    </TD>
                    {canDispose && (
                      <TD>
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDisposing([toItem(r)])}>
                          Dispose
                        </Button>
                      </TD>
                    )}
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
        <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">
          Expired stock is never dispensed, used or sold, but it stays on the shelf until it is disposed of. Stock that can still go back to the supplier for credit: use{' '}
          <Link href="/inventory/returns" className="text-primary hover:underline">Supplier returns</Link> instead.
        </p>
      </Card>
      <DisposeDialog items={disposing ?? []} open={!!disposing} onOpenChange={(o) => !o && setDisposing(null)} onDone={() => setSelected(new Set())} />
    </>
  );
}

function Records() {
  const { currency } = useSession();
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['disposals', page], queryFn: () => api.get<Paginated<StockDisposal> & { thisMonthMinor: number }>(`/stock/disposals${qs({ page, pageSize: 25 })}`) });
  const rows = q.data?.data ?? [];
  const pages = q.data ? Math.max(1, Math.ceil(q.data.meta.total / q.data.meta.pageSize)) : 1;
  return (
    <Card>
      {q.data && <p className="border-b px-4 py-2.5 text-sm text-muted-foreground">Written off this month: <b className="tabular text-foreground">{fmtMoney(q.data.thisMonthMinor, currency)}</b> at cost</p>}
      {q.isLoading ? (
        <LoadingRows />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !rows.length ? (
        <EmptyState icon={Trash2} title="No disposals recorded yet" />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Record</TH>
                <TH>Date</TH>
                <TH className="hidden md:table-cell">Store room</TH>
                <TH>Items</TH>
                <TH className="hidden lg:table-cell">How</TH>
                <TH className="hidden md:table-cell">By / witness</TH>
                <TH className="text-right">Value</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((d) => (
                <TR key={d.id}>
                  <TD>
                    <Link href={`/inventory/disposals/${d.id}`} className="whitespace-nowrap font-medium text-primary hover:underline">{d.disposalNo}</Link>
                    <p className="text-xs text-muted-foreground">{d.reasonLabel}</p>
                  </TD>
                  <TD className="whitespace-nowrap text-sm">{fmtDateTime(d.disposedAt)}</TD>
                  <TD className="hidden text-sm md:table-cell">{d.location.name}</TD>
                  <TD className="text-sm">
                    {d.lines.slice(0, 2).map((l) => `${l.quantity} × ${l.product.name}`).join(', ')}
                    {d.lines.length > 2 && ` +${d.lines.length - 2} more`}
                    {d.hasControlled && <Lock className="ml-1 inline h-3 w-3 text-warning" aria-label="Includes controlled medicines" />}
                  </TD>
                  <TD className="hidden text-xs text-muted-foreground lg:table-cell">{d.methodLabel}{d.contractor && ` · ${d.contractor}`}</TD>
                  <TD className="hidden text-sm md:table-cell">{d.createdByName}{d.witnessName && <span className="block text-xs text-muted-foreground">Witness: {d.witnessName}</span>}</TD>
                  <TD className="text-right tabular">{fmtMoney(d.totalMinor, currency)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {pages > 1 && (
            <div className="flex items-center justify-end gap-2 border-t p-3 text-sm">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
              <span className="text-muted-foreground">Page {page} of {pages}</span>
              <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function Disposals() {
  const url = useUrlState();
  const tab = url.get('tab') === 'records' ? 'records' : 'todo';
  return (
    <>
      <PageHeader title="Expiry & disposal" description="Expired, expiring, recalled and quarantined stock — and the record of everything disposed of." help="dispose-stock" />
      <SectionNav links={INVENTORY_LINKS} />
      <div className="mb-4 flex gap-1" role="tablist" aria-label="Disposal">
        {(
          [
            ['todo', 'To dispose'],
            ['records', 'Disposal records'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => url.set({ tab: k === 'records' ? 'records' : null })} className={cn('rounded-pill px-4 py-1.5 text-sm font-medium transition-colors', tab === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'todo' ? <ToDispose /> : <Records />}
    </>
  );
}

export default function DisposalsPage() {
  return (
    <RequirePermission anyOf={['inventory.read']}>
      <Suspense fallback={<LoadingRows />}>
        <Disposals />
      </Suspense>
    </RequirePermission>
  );
}
