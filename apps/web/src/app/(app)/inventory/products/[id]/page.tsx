'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { enumLabel, type Paginated } from '@vcms/shared';
import { PRESCRIBABLE_PRODUCT_TYPES, PRODUCT_TYPE_LABELS } from '@vcms/shared';
import { Edit, Lock, MoreHorizontal, PackagePlus } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { MoneyInput, bpToPct, parseMoney } from '@/components/billing/money';
import { CommerceBadge } from '@/components/billing/status';
import { useConfirm } from '@/components/confirm';
import { DataTable } from '@/components/data-table';
import { Field } from '@/components/forms/field';
import { AdjustDialog, TransferDialog } from '@/components/inventory/batch-dialogs';
import { DisposeDialog, type DisposeItem } from '@/components/inventory/dispose-dialog';
import { needsBatch } from '@/components/inventory/receive-dialog';
import { MovementsTable } from '@/components/inventory/movements-table';
import { ProductDialog } from '@/components/pharmacy/product-dialog';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input, NativeSelect } from '@/components/ui/input';
import { api, qs } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/format';
import { defaultLocation, locationLabel, sortedLocations } from '@/lib/locations';
import { qtyUnit } from '@/lib/labels';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import type { Product, ProductStock, StockBatch, StockLocation, StockMovement, TaxRate } from '@/lib/types';
import { localToday } from '@/lib/time';

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
          <Field label={`Order more when below (${p.dispensingUnit})`} htmlFor="ps-level"><Input id="ps-level" inputMode="decimal" value={level} onChange={(e) => setLevel(e.target.value)} /></Field>
          <Field label="How many to order" htmlFor="ps-qty"><Input id="ps-qty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
        </div>
        <Field label="Tax rate" htmlFor="ps-tax" hint="Leave as Default to use the clinic's usual tax rate.">
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

/**
 * Next step after adding a product: record what is already on the shelf. Uses the delivery (goods receipt) API so the
 * cost price is recorded on the batch and stock value is right; no supplier is needed ("Local purchase").
 */
function OpeningStock({ product }: { product: ProductStock['product'] }) {
  const qc = useQueryClient();
  const { currency, session } = useSession();
  const [qty, setQty] = useState('');
  const [cost, setCost] = useState('');
  const [batch, setBatch] = useState('');
  const [expiry, setExpiry] = useState('');
  const [locationId, setLocationId] = useState('');
  const locations = useQuery({ queryKey: ['stock-locations'], queryFn: () => api.get<StockLocation[]>('/stock-locations') });
  const active = sortedLocations(locations.data, session.branch?.id).filter((l) => l.isActive);
  useEffect(() => {
    if (!locationId && locations.data?.length) setLocationId(defaultLocation(locations.data, session.branch?.id)?.id ?? '');
  }, [locations.data, locationId, session.branch?.id]);
  const strict = needsBatch(product.type);
  const costMinor = parseMoney(cost, currency);
  const problem =
    locations.isSuccess && !active.length ? 'Add a store room first'
    : !(Number(qty) > 0) ? 'Enter how many you have'
    : costMinor === null ? 'Enter the cost price'
    : strict && !batch.trim() ? `Enter a batch number for ${product.name}`
    : strict && !expiry ? `Enter the expiry date for ${product.name}`
    : null;
  const m = useMutation({
    mutationFn: () =>
      api.post<{ receiptNo: string }>('/stock/receipts', {
        supplierId: null,
        locationId,
        notes: 'Opening stock',
        lines: [{ productId: product.id, batchNumber: batch.trim() || null, expiryDate: expiry || null, quantity: Number(qty), unitCostMinor: costMinor }],
      }),
    onSuccess: (r) => {
      toast.success(`${qtyUnit(Number(qty), product.dispensingUnit)} of ${product.name} added to stock (${r.receiptNo})`);
      ['stock', 'stock-product', 'stock-movements', 'dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Card className="border-primary/40 bg-primary/5">
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2"><PackagePlus className="h-4 w-4 text-primary" /> Add opening stock</CardTitle>
          <CardDescription>How many do you have on the shelf now? {strict ? 'Copy the batch number and expiry date from the pack.' : 'No batch number needed.'}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={`Quantity (${product.dispensingUnit})`} htmlFor="os-qty" required><Input id="os-qty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
          <Field label={`Cost price per ${product.dispensingUnit}`} htmlFor="os-cost" required hint="What you paid, for stock value and profit"><MoneyInput id="os-cost" currency={currency} value={cost} onChange={(e) => setCost(e.target.value)} /></Field>
          {active.length > 1 && (
            <Field label="Store room" htmlFor="os-loc">
              <NativeSelect id="os-loc" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                {active.map((l) => <option key={l.id} value={l.id}>{locationLabel(l, locations.data)}</option>)}
              </NativeSelect>
            </Field>
          )}
        </div>
        {strict && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Batch number" htmlFor="os-batch" required help="The batch or lot number printed on the pack from your supplier. Needed so you can trace the medicine if there is a recall."><Input id="os-batch" value={batch} maxLength={60} onChange={(e) => setBatch(e.target.value)} /></Field>
            <Field label="Expiry date" htmlFor="os-exp" required><Input id="os-exp" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} /></Field>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" loading={m.isPending} disabled={!!problem || !locationId} onClick={() => m.mutate()}>Add to stock</Button>
          {problem && <p role="status" className="text-sm text-muted-foreground">{problem}</p>}
          {problem === 'Add a store room first' && <Link className="text-sm font-medium text-primary hover:underline" href="/inventory/locations">Add store room</Link>}
        </div>
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
  const [disposing, setDisposing] = useState<DisposeItem[] | null>(null);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(false);
  const q = useQuery({ queryKey: ['stock-product', id], queryFn: () => api.get<ProductStock>(`/stock/products/${id}`) });
  const details = useQuery({ queryKey: ['product', id], queryFn: () => api.get<Product>(`/products/${id}`) });
  const ledger = useQuery({ queryKey: ['stock-movements', id, page], queryFn: () => api.get<Paginated<StockMovement>>(`/stock/movements${qs({ productId: id, page, pageSize: 25 })}`), placeholderData: (p) => p });
  const status = useMutation({
    mutationFn: ({ batchId, status, reason }: { batchId: string; status: string; reason?: string }) => api.post(`/stock/batches/${batchId}/status`, { status, reason }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['stock-product', id] }); qc.invalidateQueries({ queryKey: ['stock'] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  if (q.isLoading) return <LoadingRows />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const { product: p, batches } = q.data;
  const today = localToday();
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
        description={
          <>
            {details.data && <>{PRODUCT_TYPE_LABELS[details.data.type as keyof typeof PRODUCT_TYPE_LABELS] ?? details.data.type}{details.data.productCategory && ` › ${details.data.productCategory.name}`}{details.data.brand && ` · ${details.data.brand}`}{details.data.packSize && ` · ${details.data.packSize}`} · </>}
            {qtyUnit(onHand, p.dispensingUnit)} on hand{p.sellPriceMinor != null && ` · sells at ${fmtMoney(p.sellPriceMinor, currency)}/${p.dispensingUnit}`}
            {details.data && (PRESCRIBABLE_PRODUCT_TYPES as readonly string[]).includes(details.data.type) && <> · <Link className="hover:underline" href={`/pharmacy/formulary/${p.id}`}>Medicine details</Link></>}
          </>
        }
        actions={(can('inventory.write') || can('formulary.manage')) && details.data && <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Edit /> Edit product</Button>}
      />
      {editing && details.data && <ProductDialog product={details.data} open={editing} onOpenChange={setEditing} onSaved={() => qc.invalidateQueries({ queryKey: ['stock-product', id] })} />}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid content-start gap-4">
          {!batches.length && p.trackStock && can('inventory.write') && <OpeningStock product={p} />}
          <Card>
            <CardHeader><CardTitle>Batches</CardTitle></CardHeader>
            <DataTable
              query={{ data: batches, isLoading: false, error: null, refetch: () => q.refetch() }}
              rowKey={(b) => b.id}
              empty={<EmptyState title="No stock received yet" />}
              columns={[
                { key: 'b', header: 'Batch', cell: (b) => <div><p className="font-medium">{b.batchNumber}</p><p className="text-xs text-muted-foreground">Received {fmtDate(b.receivedAt)}{b.supplier && ` · ${b.supplier.name}`}</p></div> },
                { key: 'exp', header: 'Expiry', cell: (b) => <span className={b.expiryDate && b.expiryDate.slice(0, 10) < today ? 'whitespace-nowrap font-medium text-destructive' : 'whitespace-nowrap text-sm'}>{fmtDate(b.expiryDate)}{b.expiryDate && b.expiryDate.slice(0, 10) < today && ' (expired)'}</span> },
                { key: 'lv', header: 'Store rooms', cell: (b) => { const at = b.levels.filter((l) => l.quantity !== 0); return at.length ? <ul className="grid gap-0.5 text-xs">{at.map((l) => <li key={l.location.name} className="flex justify-between gap-3"><span className="truncate">{l.location.name}</span><span className="tabular">{l.quantity}</span></li>)}</ul> : <span className="text-xs text-muted-foreground">—</span>; } },
                { key: 'qty', header: 'On hand', className: 'text-right tabular', headerClassName: 'text-right', cell: (b) => <span className={cn('whitespace-nowrap', b.onHand < 0 && 'text-destructive')}>{qtyUnit(b.onHand, p.dispensingUnit)}</span> },
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
                          <DropdownMenuItem
                            destructive
                            disabled={!b.levels.some((l) => l.quantity > 0)}
                            onSelect={() =>
                              setDisposing(
                                b.levels
                                  .filter((l) => l.quantity > 0)
                                  .map((l) => ({ batchId: b.id, batchNumber: b.batchNumber, expiryDate: b.expiryDate, expired: !!b.expiryDate && b.expiryDate.slice(0, 10) < today, recalled: b.status === 'RECALLED', productName: p.name, unit: p.dispensingUnit, isControlled: p.isControlled, location: l.location, onHand: l.quantity, unitCostMinor: b.unitCostMinor })),
                              )
                            }
                          >
                            Dispose…
                          </DropdownMenuItem>
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
            <CardHeader><CardTitle>Stock history</CardTitle></CardHeader>
            <MovementsTable query={ledger} page={page} onPage={setPage} hideProduct />
          </Card>
        </div>
        {can('inventory.write') ? <Settings data={q.data} /> : <div />}
      </div>
      <AdjustDialog batch={adjusting} unit={p.dispensingUnit} onClose={() => setAdjusting(null)} />
      <TransferDialog batch={moving} unit={p.dispensingUnit} onClose={() => setMoving(null)} />
      <DisposeDialog items={disposing ?? []} open={!!disposing} onOpenChange={(o) => !o && setDisposing(null)} />
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
