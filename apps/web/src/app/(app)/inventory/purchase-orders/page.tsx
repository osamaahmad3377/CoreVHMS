'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fromMinor } from '@vcms/shared';
import { Plus, ShoppingBag, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { MoneyInput, parseMoney } from '@/components/billing/money';
import { INVENTORY_LINKS, SectionNav } from '@/components/billing/section-nav';
import { CommerceBadge } from '@/components/billing/status';
import { DataTable } from '@/components/data-table';
import { QuickAddSupplier } from '@/components/inventory/quick-supplier';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { ProductPicker } from '@/components/pharmacy/product-picker';
import { EmptyState, PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { useUrlState } from '@/hooks/use-url-state';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/format';
import { defaultLocation, locationLabel, sortedLocations } from '@/lib/locations';
import { qtyUnit } from '@/lib/labels';
import { useSession } from '@/lib/session';
import type { Product, PurchaseOrder, StockLocation, Supplier } from '@/lib/types';

interface Suggestion { productId: string; name: string; dispensingUnit: string; available: number; onOrder: number; reorderLevel: number; suggested: number; lastCostMinor: number | null; lastSupplier: { id: string; name: string } | null }
interface PoLine { key: string; product: Pick<Product, 'id' | 'name' | 'dispensingUnit'> | null; quantity: string; cost: string }

function useApprovalRule() {
  return useQuery({ queryKey: ['po-approval-rule'], queryFn: () => api.get<{ needsSecondApprover: boolean }>('/purchase-orders/approval-rule'), staleTime: 60_000 });
}

function PoDialog({ open, onOpenChange, seed }: { open: boolean; onOpenChange: (o: boolean) => void; seed: Suggestion[] }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { can, currency, session } = useSession();
  const rule = useApprovalRule();
  // Without a second approver, an authorised person approves their own order in the same step.
  const oneStep = rule.data?.needsSecondApprover === false && can('procurement.approve');
  const [supplierId, setSupplierId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [expectedAt, setExpectedAt] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<PoLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => api.get<Supplier[]>('/suppliers'), enabled: open });
  const locations = useQuery({ queryKey: ['stock-locations'], queryFn: () => api.get<StockLocation[]>('/stock-locations'), enabled: open });
  useEffect(() => {
    if (!open) return;
    setError(null);
    setLines(seed.length ? seed.map((s) => ({ key: s.productId, product: { id: s.productId, name: s.name, dispensingUnit: s.dispensingUnit }, quantity: String(s.suggested), cost: s.lastCostMinor != null ? fromMinor(s.lastCostMinor, currency) : '' })) : [{ key: crypto.randomUUID(), product: null, quantity: '', cost: '' }]);
    // Suggestions from one supplier pre-select that supplier.
    const from = [...new Set(seed.map((s) => s.lastSupplier?.id).filter(Boolean))];
    setSupplierId(from.length === 1 ? from[0]! : '');
    setExpectedAt('');
    setNotes('');
  }, [open, seed, currency]);
  useEffect(() => {
    if (!locationId && locations.data?.length) setLocationId(defaultLocation(locations.data, session.branch?.id)!.id);
  }, [locations.data, locationId, session.branch?.id]);
  const update = (key: string, patch: Partial<PoLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const valid = lines.filter((l) => l.product && Number(l.quantity) > 0 && parseMoney(l.cost, currency) !== null);
  const total = valid.reduce((n, l) => n + Math.round(Number(l.quantity) * (parseMoney(l.cost, currency) ?? 0)), 0);
  const m = useMutation({
    mutationFn: async (approve: boolean) => {
      const po = await api.post<PurchaseOrder>('/purchase-orders', { supplierId, locationId, expectedAt: expectedAt || null, notes: notes || null, lines: valid.map((l) => ({ productId: l.product!.id, quantity: Number(l.quantity), unitCostMinor: parseMoney(l.cost, currency) })) });
      return approve ? api.post<PurchaseOrder>(`/purchase-orders/${po.id}/approve`, {}) : po;
    },
    onSuccess: (po) => {
      ['purchase-orders', 'reorder-suggestions', 'stock'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast.success(po.status === 'APPROVED' ? `${po.poNo} approved — print it or send it to the supplier` : oneStep ? `${po.poNo} saved as a draft` : `${po.poNo} saved — send it for approval when ready`);
      router.push(`/inventory/purchase-orders/${po.id}`);
    },
    onError: (e: Error) => setError(e.message),
  });
  const problem = !supplierId ? 'Choose a supplier' : !locationId ? 'Choose where it will be delivered' : !valid.length ? 'Add a product with a quantity and cost price' : null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>Add order</DialogTitle>
          <DialogDescription>
            {oneStep
              ? 'Approve the order to print it or send it to the supplier. When the goods arrive, receive the delivery against it.'
              : 'Save the order, then send it for approval. Another person approves it before the goods are received.'}
          </DialogDescription>
        </DialogHeader>
        {error && <FormError message={error} />}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="grid content-start gap-1">
            <Field label="Supplier" htmlFor="po-sup" required>
              <NativeSelect id="po-sup" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">Choose…</option>
                {(suppliers.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </NativeSelect>
            </Field>
            <QuickAddSupplier onCreated={(s) => setSupplierId(s.id)} />
          </div>
          <Field label="Deliver to (store room)" htmlFor="po-loc" required>
            <NativeSelect id="po-loc" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              {sortedLocations(locations.data, session.branch?.id).filter((l) => l.isActive).map((l) => <option key={l.id} value={l.id}>{locationLabel(l, locations.data)}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Expected delivery" htmlFor="po-exp"><Input id="po-exp" type="date" value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} /></Field>
        </div>
        <div className="grid max-h-[40vh] gap-2 overflow-y-auto">
          <div aria-hidden className="hidden px-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground sm:grid sm:grid-cols-[minmax(0,1fr)_110px_140px_32px] sm:gap-2">
            <span>Product</span><span>Quantity</span><span>Cost price (each)</span><span />
          </div>
          {lines.map((l, idx) => (
            <div key={l.key} className="grid gap-2 rounded-lg surface-flat p-2 sm:grid-cols-[minmax(0,1fr)_110px_140px_auto] sm:items-center">
              <ProductPicker value={l.product as Product | null} onChange={(p) => update(l.key, { product: p })} placeholder="Product…" />
              <Input aria-label={`Line ${idx + 1} quantity`} placeholder={`Qty${l.product ? ` (${l.product.dispensingUnit})` : ''}`} inputMode="decimal" value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} />
              <MoneyInput aria-label={`Line ${idx + 1} unit cost`} placeholder="Unit cost" currency={currency} value={l.cost} onChange={(e) => update(l.key, { cost: e.target.value })} />
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove line ${idx + 1}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><Trash2 /></Button>
            </div>
          ))}
        </div>
        <div><Button type="button" size="sm" variant="outline" onClick={() => setLines((ls) => [...ls, { key: crypto.randomUUID(), product: null, quantity: '', cost: '' }])}><Plus /> Add line</Button></div>
        <Field label="Notes" htmlFor="po-notes"><Textarea id="po-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} /></Field>
        <p className="text-right text-sm">Order total <b className="tabular">{fmtMoney(total, currency)}</b></p>
        <DialogFooter className="items-center">
          {problem && <p role="status" className="mr-auto text-sm text-muted-foreground">{problem}</p>}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {oneStep ? (
            <>
              <Button variant="outline" loading={m.isPending && m.variables === false} disabled={!!problem || m.isPending} onClick={() => { setError(null); m.mutate(false); }}>Save as draft</Button>
              <Button loading={m.isPending && m.variables === true} disabled={!!problem || m.isPending} onClick={() => { setError(null); m.mutate(true); }}>Approve &amp; send</Button>
            </>
          ) : (
            <Button loading={m.isPending} disabled={!!problem} onClick={() => { setError(null); m.mutate(false); }}>Save order</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Orders() {
  const router = useRouter();
  const url = useUrlState();
  const { can, currency } = useSession();
  const [creating, setCreating] = useState<Suggestion[] | null>(null);
  const query = useQuery({ queryKey: ['purchase-orders'], queryFn: () => api.get<PurchaseOrder[]>('/purchase-orders') });
  const suggestions = useQuery({ queryKey: ['reorder-suggestions'], queryFn: () => api.get<Suggestion[]>('/purchase-orders/reorder-suggestions') });
  const rule = useApprovalRule();
  // The Stock page's "Order these" links here with ?new=suggested: open a draft seeded from the reorder suggestions.
  const wantsNew = url.get('new');
  // Handle each ?new= link once: the URL update lands a render later, and re-running would reset the open dialog in a loop.
  const handledNew = useRef<string | null>(null);
  useEffect(() => {
    if (!wantsNew) { handledNew.current = null; return; }
    if (handledNew.current === wantsNew || !can('procurement.write')) return;
    if (wantsNew === 'suggested' && !suggestions.isSuccess) return;
    handledNew.current = wantsNew;
    setCreating(wantsNew === 'suggested' ? suggestions.data ?? [] : []);
    url.set({ new: null });
  }, [wantsNew, can, suggestions.isSuccess, suggestions.data, url]);
  // One draft order per supplier: group suggestions by who supplied them last.
  const bySupplier = Object.entries(
    (suggestions.data ?? []).reduce<Record<string, Suggestion[]>>((acc, s) => ((acc[s.lastSupplier?.name ?? '—'] ??= []).push(s), acc), {}),
  ).sort(([a], [b]) => (a === '—' ? 1 : b === '—' ? -1 : a.localeCompare(b)));
  return (
    <>
      <PageHeader
        help="purchase-order"
        title="Orders"
        description={
          rule.data?.needsSecondApprover === false
            ? 'Orders to your suppliers. Approve an order to send it; receive the delivery when the goods arrive.'
            : 'Orders to your suppliers. Another person approves each order before it is sent; receive the delivery when the goods arrive.'
        }
        actions={can('procurement.write') && <Button size="sm" onClick={() => setCreating([])}><Plus /> Add order</Button>}
      />
      <SectionNav links={INVENTORY_LINKS} />
      {!!suggestions.data?.length && (
        <Card className="mb-4">
          <CardHeader>
            <div>
              <CardTitle>Reorder suggestions</CardTitle>
              <p className="text-xs text-muted-foreground">Running low, counting stock already on order. Quantities and costs are filled in from the last delivery.</p>
            </div>
          </CardHeader>
          {bySupplier.map(([supplier, items]) => (
            <div key={supplier} className="border-t">
              <div className="flex flex-wrap items-center justify-between gap-2 bg-muted/40 px-4 py-2">
                <span className="text-xs font-semibold">{supplier === '—' ? 'No previous supplier' : supplier} <span className="font-normal text-muted-foreground">· {items.length} {items.length === 1 ? 'item' : 'items'}</span></span>
                {can('procurement.write') && <Button size="sm" variant="outline" onClick={() => setCreating(items)}><Plus /> Draft order</Button>}
              </div>
              <ul className="divide-y">
                {items.map((s) => (
                  <li key={s.productId} className="grid gap-1 px-4 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4">
                    <Link className="truncate font-medium hover:underline" href={`/inventory/products/${s.productId}`}>{s.name}</Link>
                    <span className="flex flex-wrap gap-x-3 text-xs text-muted-foreground tabular">
                      <span>{qtyUnit(s.available, s.dispensingUnit)} left</span>
                      {s.onOrder > 0 && <span>{qtyUnit(s.onOrder, s.dispensingUnit)} on order</span>}
                      <span>reorder at {s.reorderLevel}</span>
                      {s.lastCostMinor != null && <span>last cost {fmtMoney(s.lastCostMinor, currency)}</span>}
                      <span className="font-medium text-foreground">order {qtyUnit(s.suggested, s.dispensingUnit)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </Card>
      )}
      <Card>
        <DataTable
          query={query}
          rowKey={(r) => r.id}
          onRowClick={(r) => router.push(`/inventory/purchase-orders/${r.id}`)}
          empty={<EmptyState icon={ShoppingBag} title="No orders yet" description="Add an order when you need stock from a supplier." />}
          columns={[
            { key: 'no', header: 'Order', cell: (r) => <Link className="font-medium hover:underline" href={`/inventory/purchase-orders/${r.id}`}>{r.poNo}</Link> },
            { key: 'sup', header: 'Supplier', cell: (r) => <span className="text-sm">{r.supplier.name}</span> },
            { key: 'items', header: 'Items', cell: (r) => <span className="text-sm">{r.lines.map((l) => l.product.name).join(', ')}</span> },
            { key: 'date', header: 'Created', cell: (r) => <span className="whitespace-nowrap text-xs">{fmtDate(r.createdAt)}<span className="block text-muted-foreground">{r.createdByName}</span></span> },
            { key: 'total', header: 'Total', className: 'text-right tabular', headerClassName: 'text-right', cell: (r) => fmtMoney(r.totalMinor, currency) },
            { key: 'st', header: 'Status', cell: (r) => <CommerceBadge status={r.status} /> },
          ]}
        />
      </Card>
      <PoDialog open={!!creating} onOpenChange={(o) => !o && setCreating(null)} seed={creating ?? []} />
    </>
  );
}

export default function PurchaseOrdersPage() {
  return (
    <RequirePermission anyOf={['procurement.read']}>
      <Suspense><Orders /></Suspense>
    </RequirePermission>
  );
}
