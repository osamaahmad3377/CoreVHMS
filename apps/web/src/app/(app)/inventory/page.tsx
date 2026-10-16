'use client';
import { useQuery } from '@tanstack/react-query';
import type { Paginated } from '@vcms/shared';
import { AlertTriangle, Boxes, CalendarClock, Lock, PackagePlus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { INVENTORY_LINKS, SectionNav } from '@/components/billing/section-nav';
import { DataTable } from '@/components/data-table';
import { ReceiveStockDialog } from '@/components/inventory/receive-dialog';
import { EmptyState, PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { SearchInput } from '@/components/search-input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/input';
import { useUrlState } from '@/hooks/use-url-state';
import { api, qs } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { StockLocation, StockRow } from '@/lib/types';

function Stock() {
  const router = useRouter();
  const { can, currency } = useSession();
  const url = useUrlState();
  const [receiving, setReceiving] = useState(false);
  // Quick actions link here with ?receive=1 to open the receive dialog directly.
  const wantsReceive = url.get('receive') === '1';
  useEffect(() => {
    if (wantsReceive && can('inventory.write')) {
      setReceiving(true);
      url.set({ receive: null });
    }
  }, [wantsReceive, can, url]);
  const filter = url.get('filter');
  const params = { q: url.get('q'), locationId: url.get('locationId'), lowStock: filter === 'low' ? 'true' : undefined, expiringDays: filter.startsWith('exp') ? filter.slice(3) : undefined, page: Number(url.get('page', '1')), pageSize: 50 };
  const query = useQuery({ queryKey: ['stock', params], queryFn: () => api.get<Paginated<StockRow> & { totals: { valueMinor: number } }>(`/stock${qs(params)}`), placeholderData: (p) => p });
  const locations = useQuery({ queryKey: ['stock-locations'], queryFn: () => api.get<StockLocation[]>('/stock-locations') });
  const noLocations = locations.isSuccess && !locations.data.length;
  return (
    <>
      <PageHeader
        help="receive-stock"
        title="Inventory & procurement"
        description="Stock on hand by batch and location. Dispensing, administration and counter sales deduct stock automatically."
        actions={can('inventory.write') && <Button size="sm" disabled={noLocations} onClick={() => setReceiving(true)}><PackagePlus /> Receive stock</Button>}
      />
      <SectionNav links={INVENTORY_LINKS} />
      {noLocations && (
        <Card className="mb-4 border-warning/40 bg-warning/5 p-4 text-sm">
          No stock locations are set up yet, so stock is not being tracked. <Link className="font-medium underline" href="/inventory/locations">Add a pharmacy or store location</Link> to start receiving stock.
        </Card>
      )}
      <Card>
        <div className="flex flex-col gap-2 border-b p-3 lg:flex-row lg:items-center">
          <SearchInput value={params.q} onChange={(q) => url.set({ q, page: 1 })} placeholder="Product name, SKU or barcode" />
          <NativeSelect aria-label="Location" className="lg:w-48" value={params.locationId} onChange={(e) => url.set({ locationId: e.target.value, page: 1 })}>
            <option value="">All locations</option>
            {(locations.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </NativeSelect>
          <NativeSelect aria-label="Filter" className="lg:w-48" value={filter} onChange={(e) => url.set({ filter: e.target.value, page: 1 })}>
            <option value="">All stocked products</option>
            <option value="low">At or below reorder level</option>
            <option value="exp30">Expiring within 30 days</option>
            <option value="exp90">Expiring within 90 days</option>
          </NativeSelect>
          {query.data && <p className="text-sm text-muted-foreground lg:ml-auto">Value at cost <b className="tabular text-foreground">{fmtMoney(query.data.totals.valueMinor, currency)}</b></p>}
        </div>
        <DataTable
          query={query}
          rowKey={(r) => r.id}
          onRowClick={(r) => router.push(`/inventory/products/${r.id}`)}
          page={params.page}
          pageSize={50}
          onPage={(page) => url.set({ page })}
          empty={<EmptyState icon={Boxes} title="No stock to show" description="Products appear here once they are marked as stock-tracked and stock is received." />}
          columns={[
            { key: 'name', header: 'Product', cell: (r) => <div><Link href={`/inventory/products/${r.id}`} className="flex items-center gap-1 font-medium hover:underline">{r.name}{r.isControlled && <Lock className="h-3 w-3 text-warning" aria-label="Controlled" />}</Link><p className="text-xs text-muted-foreground">{r.sku ?? ''} {r.locations.map((l) => `${l.name}: ${l.quantity}`).join(' · ')}</p></div> },
            { key: 'avail', header: 'Available', className: 'text-right tabular', headerClassName: 'text-right', cell: (r) => <span className={r.low ? 'font-semibold text-destructive' : ''}>{r.available} <span className="text-xs font-normal text-muted-foreground">{r.dispensingUnit}</span></span> },
            { key: 'unusable', header: 'Unusable', className: 'text-right tabular', headerClassName: 'text-right', cell: (r) => (r.unusable ? <span className="text-warning" title="Expired, quarantined or recalled">{r.unusable}</span> : '—') },
            { key: 'reorder', header: 'Reorder at', className: 'text-right tabular', headerClassName: 'text-right', cell: (r) => r.reorderLevel ?? '—' },
            { key: 'exp', header: 'Next expiry', cell: (r) => <span className={`whitespace-nowrap text-sm ${r.expiringSoon ? 'font-medium text-warning' : ''}`}>{fmtDate(r.nextExpiry)}</span> },
            { key: 'value', header: 'Value', className: 'text-right tabular', headerClassName: 'text-right', cell: (r) => fmtMoney(r.valueMinor, currency) },
            { key: 'flags', header: '', cell: (r) => <div className="flex gap-1">{r.low && <Badge variant="destructive"><AlertTriangle className="h-3 w-3" /> Low</Badge>}{r.expiringSoon && <Badge variant="warning"><CalendarClock className="h-3 w-3" /> Expiring</Badge>}</div> },
          ]}
        />
      </Card>
      <ReceiveStockDialog open={receiving} onOpenChange={setReceiving} />
    </>
  );
}

export default function InventoryPage() {
  return (
    <RequirePermission anyOf={['inventory.read']}>
      <Suspense><Stock /></Suspense>
    </RequirePermission>
  );
}
