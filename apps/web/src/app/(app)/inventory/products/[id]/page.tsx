'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { enumLabel, type Paginated } from '@vcms/shared';
import { Lock, MoreHorizontal } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { bpToPct } from '@/components/billing/money';
import { CommerceBadge } from '@/components/billing/status';
import { useConfirm } from '@/components/confirm';
import { DataTable } from '@/components/data-table';
import { Field } from '@/components/forms/field';
import { AdjustDialog, TransferDialog } from '@/components/inventory/batch-dialogs';
import { MovementsTable } from '@/components/inventory/movements-table';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input, NativeSelect } from '@/components/ui/input';
import { api, qs } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { ProductStock, StockBatch, StockMovement, TaxRate } from '@/lib/types';

function Settings({ data }: { data: ProductStock }) {
  const qc = useQueryClient();
  const p = data.product;
  const [track, setTrack] = useState(p.trackStock);
  const [level, setLevel] = useState(p.reorderLevel?.toString() ?? '');
  const [qty, setQty] = useState(p.reorderQuantity?.toString() ?? '');
  const [tax, setTax] = useState(p.taxRateId ?? '');
  const rates = useQuery({ queryKey: ['tax-rates'], queryFn: () => api.get<TaxRate[]>('/tax-rates') });
  useEffect(() => { setTrack(p.trackStock); setLevel(p.reorderLevel?.toString() ?? ''); setQty(p.reorderQuantity?.toString() ?? ''); setTax(p.taxRateId ?? ''); }, [p]);
  const m = useMutation({
    mutationFn: () => api.patch(`/stock/products/${p.id}/settings`, { trackStock: track, reorderLevel: level === '' ? null : Number(level), reorderQuantity: qty === '' ? null : Number(qty), taxRateId: tax || null }),
    onSuccess: () => { toast.success('Stock settings saved'); qc.invalidateQueries({ queryKey: ['stock-product', p.id] }); qc.invalidateQueries({ queryKey: ['stock'] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Card>
      <CardHeader><CardTitle>Stock settings</CardTitle></CardHeader>
      <CardContent className="grid gap-3">
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>Track stock<span className="block text-xs text-muted-foreground">Deduct automatically when dispensed, administered or sold</span></span>
          <Switch checked={track} onCheckedChange={setTrack} aria-label="Track stock" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`Reorder level (${p.dispensingUnit})`} htmlFor="ps-level"><Input id="ps-level" inputMode="decimal" value={level} onChange={(e) => setLevel(e.target.value)} /></Field>
          <Field label="Reorder quantity" htmlFor="ps-qty"><Input id="ps-qty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
        </div>
        <Field label="Tax rate" htmlFor="ps-tax" hint="Leave as default to use the organisation's default tax rate.">
          <NativeSelect id="ps-tax" value={tax} onChange={(e) => setTax(e.target.value)}>
            <option value="">Default</option>
            {(rates.data ?? []).filter((r) => r.isActive).map((r) => <option key={r.id} value={r.id}>{r.name} ({bpToPct(r.rateBasisPoints)})</option>)}
          </NativeSelect>
        </Field>
        <div><Button size="sm" loading={m.isPending} onClick={() => m.mutate()}>Save</Button></div>
      </CardContent>
    </Card>
  );
}

function ProductStockView() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { can, currency } = useSession();
  const [adjusting, setAdjusting] = useState<StockBatch | null>(null);
  const [moving, setMoving] = useState<StockBatch | null>(null);
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['stock-product', id], queryFn: () => api.get<ProductStock>(`/stock/products/${id}`) });
  const ledger = useQuery({ queryKey: ['stock-movements', id, page], queryFn: () => api.get<Paginated<StockMovement>>(`/stock/movements${qs({ productId: id, page, pageSize: 25 })}`), placeholderData: (p) => p });
  const status = useMutation({
    mutationFn: ({ batchId, status, reason }: { batchId: string; status: string; reason?: string }) => api.post(`/stock/batches/${batchId}/status`, { status, reason }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['stock-product', id] }); qc.invalidateQueries({ queryKey: ['stock'] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  if (q.isLoading) return <LoadingRows />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const { product: p, batches } = q.data;
  const today = new Date().toISOString().slice(0, 10);
  const onHand = batches.reduce((n, b) => n + b.onHand, 0);
  const setStatus = async (b: StockBatch, s: 'AVAILABLE' | 'QUARANTINED' | 'RECALLED') => {
    if (s === 'AVAILABLE') return status.mutate({ batchId: b.id, status: s });
    const r = await confirm({ title: `${s === 'RECALLED' ? 'Recall' : 'Quarantine'} batch ${b.batchNumber}?`, description: 'The batch will not be issued for dispensing or sale until it is released.', requireReason: true, destructive: s === 'RECALLED', confirmLabel: s === 'RECALLED' ? 'Mark recalled' : 'Quarantine' });
    if (r.confirmed) status.mutate({ batchId: b.id, status: s, reason: r.reason });
  };
  return (
    <>
      <PageHeader
        title={<span className="flex items-center gap-2">{p.name}{p.isControlled && <Lock className="h-4 w-4 text-warning" aria-label="Controlled" />}</span>}
        breadcrumbs={[{ label: 'Inventory', href: '/inventory' }, { label: p.name }]}
        description={<>{onHand} {p.dispensingUnit} on hand{p.sellPriceMinor != null && ` · sells at ${fmtMoney(p.sellPriceMinor, currency)}/${p.dispensingUnit}`} · <Link className="hover:underline" href={`/pharmacy/formulary/${p.id}`}>Formulary record</Link></>}
      />
      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader><CardTitle>Batches</CardTitle></CardHeader>
            <DataTable
              query={{ data: batches, isLoading: false, error: null, refetch: () => q.refetch() }}
              rowKey={(b) => b.id}
              empty={<EmptyState title="No batches received yet" />}
              columns={[
                { key: 'b', header: 'Batch', cell: (b) => <div><p className="font-medium">{b.batchNumber}</p><p className="text-xs text-muted-foreground">Received {fmtDate(b.receivedAt)}{b.supplier && ` · ${b.supplier.name}`}</p></div> },
                { key: 'exp', header: 'Expiry', cell: (b) => <span className={b.expiryDate && b.expiryDate.slice(0, 10) < today ? 'font-medium text-destructive' : 'text-sm'}>{fmtDate(b.expiryDate)}{b.expiryDate && b.expiryDate.slice(0, 10) < today && ' (expired)'}</span> },
                { key: 'lv', header: 'Locations', cell: (b) => <span className="text-xs">{b.levels.filter((l) => l.quantity !== 0).map((l) => `${l.location.name}: ${l.quantity}`).join(' · ') || '—'}</span> },
                { key: 'qty', header: 'On hand', className: 'text-right tabular', headerClassName: 'text-right', cell: (b) => <span className={b.onHand < 0 ? 'text-destructive' : ''}>{b.onHand}</span> },
                { key: 'cost', header: 'Unit cost', className: 'text-right tabular', headerClassName: 'text-right', cell: (b) => fmtMoney(b.unitCostMinor, currency) },
                { key: 'st', header: 'Status', cell: (b) => <span title={b.statusReason ?? undefined}><CommerceBadge status={b.status} /></span> },
                {
                  key: 'act',
                  header: '',
                  cell: (b) =>
                    can('inventory.adjust') && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button size="icon-sm" variant="ghost" aria-label={`Actions for batch ${b.batchNumber}`}><MoreHorizontal /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setAdjusting(b)}>Adjust / write off</DropdownMenuItem>
                          <DropdownMenuItem disabled={!b.levels.some((l) => l.quantity > 0)} onSelect={() => setMoving(b)}>Transfer</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {b.status !== 'AVAILABLE' && <DropdownMenuItem onSelect={() => setStatus(b, 'AVAILABLE')}>Release for use</DropdownMenuItem>}
                          {b.status !== 'QUARANTINED' && <DropdownMenuItem onSelect={() => setStatus(b, 'QUARANTINED')}>Quarantine</DropdownMenuItem>}
                          {b.status !== 'RECALLED' && <DropdownMenuItem onSelect={() => setStatus(b, 'RECALLED')}>Mark recalled</DropdownMenuItem>}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ),
                },
              ]}
            />
          </Card>
          <Card>
            <CardHeader><CardTitle>Stock ledger</CardTitle></CardHeader>
            <MovementsTable query={ledger} page={page} onPage={setPage} hideProduct />
          </Card>
        </div>
        {can('inventory.write') ? <Settings data={q.data} /> : <div />}
      </div>
      <AdjustDialog batch={adjusting} unit={p.dispensingUnit} onClose={() => setAdjusting(null)} />
      <TransferDialog batch={moving} unit={p.dispensingUnit} onClose={() => setMoving(null)} />
    </>
  );
}

export default function ProductStockPage() {
  return (
    <RequirePermission anyOf={['inventory.read']}>
      <ProductStockView />
    </RequirePermission>
  );
}
