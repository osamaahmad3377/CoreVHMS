'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Plus, ShoppingCart } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { MoneyInput, parseMoney } from '@/components/billing/money';
import { INVENTORY_LINKS, SectionNav } from '@/components/billing/section-nav';
import { CommerceBadge } from '@/components/billing/status';
import { useConfirm } from '@/components/confirm';
import { DataTable } from '@/components/data-table';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { EmptyState, PageHeader } from '@/components/page';
import { ProductPicker } from '@/components/pharmacy/product-picker';
import { RequirePermission } from '@/components/require';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { useUrlState } from '@/hooks/use-url-state';
import { api, qs } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { defaultLocation } from '@/lib/locations';
import { useSession } from '@/lib/session';
import type { Product, StockLocation, Supplier } from '@/lib/types';
import { cn } from '@/lib/utils';

interface PurchaseRequest {
  id: string;
  requestNo: string;
  status: 'OPEN' | 'ORDERED' | 'REJECTED' | 'CANCELLED';
  product: { id: string; name: string; dispensingUnit: string };
  quantity: number;
  reason: string | null;
  neededBy: string | null;
  requestedById: string;
  requestedByName: string;
  createdAt: string;
  decidedByName: string | null;
  decisionNote: string | null;
  purchaseOrder: { id: string; poNo: string; status: string } | null;
}

function RequestDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [product, setProduct] = useState<Product | null>(null);
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [neededBy, setNeededBy] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) { setProduct(null); setQuantity(''); setReason(''); setNeededBy(''); setError(null); }
  }, [open]);
  const m = useMutation({
    mutationFn: () => api.post<PurchaseRequest>('/purchase-requests', { productId: product!.id, quantity: Number(quantity), reason: reason || null, neededBy: neededBy || null }),
    onSuccess: (r) => { toast.success(`${r.requestNo} sent to procurement`); qc.invalidateQueries({ queryKey: ['purchase-requests'] }); onOpenChange(false); },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request an item</DialogTitle>
          <DialogDescription>Procurement sees your request and adds it to a purchase order with the supplier.</DialogDescription>
        </DialogHeader>
        {error && <FormError message={error} />}
        <div className="grid gap-3">
          <Field label="Product" htmlFor="pr-product" required>
            <ProductPicker value={product} onChange={setProduct} placeholder="Search products…" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={`Quantity${product ? ` (${product.dispensingUnit})` : ''}`} htmlFor="pr-qty" required>
              <Input id="pr-qty" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </Field>
            <Field label="Needed by" htmlFor="pr-needed"><Input id="pr-needed" type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} /></Field>
          </div>
          <Field label="Reason" htmlFor="pr-reason"><Textarea id="pr-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. Ward stock running low" /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={m.isPending} disabled={!product || !(Number(quantity) > 0)} onClick={() => { setError(null); m.mutate(); }}>Send request</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OrderDialog({ requests, open, onOpenChange, onDone }: { requests: PurchaseRequest[]; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { currency, session } = useSession();
  const [supplierId, setSupplierId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [expectedAt, setExpectedAt] = useState('');
  const [costs, setCosts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => api.get<Supplier[]>('/suppliers'), enabled: open });
  const locations = useQuery({ queryKey: ['stock-locations'], queryFn: () => api.get<StockLocation[]>('/stock-locations'), enabled: open });
  useEffect(() => { if (open) { setError(null); setCosts({}); } }, [open]);
  useEffect(() => {
    if (!locationId && locations.data?.length) setLocationId(defaultLocation(locations.data, session.branch?.id)!.id);
  }, [locations.data, locationId, session.branch?.id]);
  const lines = Object.values(
    requests.reduce<Record<string, { product: PurchaseRequest['product']; quantity: number; count: number }>>((acc, r) => {
      const e = (acc[r.product.id] ??= { product: r.product, quantity: 0, count: 0 });
      e.quantity += r.quantity;
      e.count += 1;
      return acc;
    }, {}),
  );
  const unitCosts = lines.filter((l) => costs[l.product.id]?.trim()).map((l) => ({ productId: l.product.id, unitCostMinor: parseMoney(costs[l.product.id], currency) }));
  const invalidCost = unitCosts.some((c) => c.unitCostMinor === null);
  const m = useMutation({
    mutationFn: () => api.post<{ purchaseOrderId: string }>('/purchase-requests/order', { requestIds: requests.map((r) => r.id), supplierId, locationId, expectedAt: expectedAt || null, unitCosts }),
    onSuccess: (r) => {
      toast.success('Draft purchase order created');
      qc.invalidateQueries({ queryKey: ['purchase-requests'] });
      qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      onDone();
      router.push(`/inventory/purchase-orders/${r.purchaseOrderId}`);
    },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Create purchase order</DialogTitle>
          <DialogDescription>
            {requests.length} request{requests.length === 1 ? '' : 's'} become one draft order. Requests for the same product are combined. Leave a unit cost empty to use the last price paid.
          </DialogDescription>
        </DialogHeader>
        {error && <FormError message={error} />}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Supplier" htmlFor="ro-sup" required>
            <NativeSelect id="ro-sup" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Choose…</option>
              {(suppliers.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Deliver to" htmlFor="ro-loc" required>
            <NativeSelect id="ro-loc" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              {(locations.data ?? []).filter((l) => l.isActive).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Expected delivery" htmlFor="ro-exp"><Input id="ro-exp" type="date" value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} /></Field>
        </div>
        <ul className="divide-y rounded-md border">
          {lines.map((l) => (
            <li key={l.product.id} className="grid items-center gap-2 px-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto_150px]">
              <span className="font-medium">{l.product.name}</span>
              <span className="tabular text-muted-foreground">{l.quantity} {l.product.dispensingUnit}{l.count > 1 ? ` (${l.count} requests)` : ''}</span>
              <MoneyInput aria-label={`Unit cost for ${l.product.name}`} placeholder="Unit cost" currency={currency} value={costs[l.product.id] ?? ''} onChange={(e) => setCosts((c) => ({ ...c, [l.product.id]: e.target.value }))} />
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={m.isPending} disabled={!supplierId || !locationId || invalidCost} onClick={() => { setError(null); m.mutate(); }}>Create draft order</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Requests() {
  const { can, canAny, session } = useSession();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const url = useUrlState();
  const show = url.get('show', 'open');
  const [asking, setAsking] = useState(url.get('new') === '1');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [ordering, setOrdering] = useState(false);
  const manage = can('procurement.write');
  const query = useQuery({ queryKey: ['purchase-requests', show], queryFn: () => api.get<PurchaseRequest[]>(`/purchase-requests${qs({ status: show === 'open' ? 'OPEN' : undefined })}`) });
  const close = useMutation({
    mutationFn: (v: { id: string; action: 'cancel' | 'reject'; note: string }) => api.post(`/purchase-requests/${v.id}/${v.action}`, { note: v.note }),
    onSuccess: (_r, v) => { toast.success(v.action === 'cancel' ? 'Request cancelled' : 'Request rejected'); qc.invalidateQueries({ queryKey: ['purchase-requests'] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const ask = async (r: PurchaseRequest, action: 'cancel' | 'reject') => {
    const c = await confirm({
      title: `${action === 'cancel' ? 'Cancel' : 'Reject'} ${r.requestNo}?`,
      description: `${r.quantity} ${r.product.dispensingUnit} ${r.product.name}, asked for by ${r.requestedByName}.`,
      confirmLabel: action === 'cancel' ? 'Cancel request' : 'Reject request',
      destructive: action === 'reject',
      requireReason: true,
      reasonLabel: action === 'cancel' ? 'Why is it no longer needed?' : 'Reason (shown to the person who asked)',
    });
    if (c.confirmed) close.mutate({ id: r.id, action, note: c.reason! });
  };
  const rows = query.data ?? [];
  const chosen = rows.filter((r) => selected.has(r.id) && r.status === 'OPEN');
  const toggle = (id: string, on: boolean) => setSelected((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
  return (
    <>
      <PageHeader
        title="Item requests"
        description="Staff ask for items to be ordered; procurement turns open requests into purchase orders."
        breadcrumbs={[{ label: 'Inventory', href: '/inventory' }, { label: 'Item requests' }]}
        actions={
          <div className="flex gap-2">
            {manage && <Button size="sm" variant="outline" disabled={!chosen.length} onClick={() => setOrdering(true)}><ShoppingCart /> Order selected ({chosen.length})</Button>}
            {canAny('procurement.request', 'procurement.write') && <Button size="sm" onClick={() => setAsking(true)}><Plus /> Request item</Button>}
          </div>
        }
      />
      <SectionNav links={INVENTORY_LINKS} />
      <div className="mb-3 flex rounded-md border p-0.5 text-xs w-fit" role="tablist" aria-label="Show">
        {[['open', 'Open'], ['all', 'All']].map(([k, label]) => (
          <button key={k} role="tab" aria-selected={show === k} onClick={() => { url.set({ show: k }); setSelected(new Set()); }} className={cn('rounded px-3 py-1 font-medium', show === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>{label}</button>
        ))}
      </div>
      <Card>
        <DataTable
          query={query}
          rowKey={(r) => r.id}
          empty={<EmptyState icon={ClipboardList} title={show === 'open' ? 'No open requests' : 'No requests yet'} description="Use “Request item” when something needs to be ordered." />}
          columns={[
            ...(manage
              ? [{ key: 'sel', header: '', className: 'w-8', cell: (r: PurchaseRequest) => r.status === 'OPEN' && <Checkbox aria-label={`Select ${r.requestNo}`} checked={selected.has(r.id)} onCheckedChange={(v) => toggle(r.id, v === true)} /> }]
              : []),
            { key: 'no', header: 'Request', cell: (r) => <span className="font-medium">{r.requestNo}</span> },
            { key: 'item', header: 'Item', cell: (r) => <div className="text-sm"><Link className="font-medium hover:underline" href={`/inventory/products/${r.product.id}`}>{r.product.name}</Link><p className="text-xs text-muted-foreground">{r.reason ?? ''}</p></div> },
            { key: 'qty', header: 'Quantity', className: 'text-right tabular', headerClassName: 'text-right', cell: (r) => `${r.quantity} ${r.product.dispensingUnit}` },
            { key: 'who', header: 'Asked by', cell: (r) => <span className="whitespace-nowrap text-xs">{r.requestedByName}<span className="block text-muted-foreground">{fmtDate(r.createdAt)}{r.neededBy ? ` · needed by ${fmtDate(r.neededBy)}` : ''}</span></span> },
            {
              key: 'st',
              header: 'Status',
              cell: (r) => (
                <div className="text-xs">
                  <CommerceBadge status={r.status} />
                  {r.purchaseOrder && <Link className="ml-1 text-primary hover:underline" href={`/inventory/purchase-orders/${r.purchaseOrder.id}`}>{r.purchaseOrder.poNo}</Link>}
                  {r.decisionNote && <p className="mt-0.5 text-muted-foreground">{r.decidedByName}: {r.decisionNote}</p>}
                </div>
              ),
            },
            {
              key: 'act',
              header: '',
              cell: (r) =>
                r.status === 'OPEN' && (
                  <div className="flex justify-end gap-1">
                    {(manage || r.requestedById === session.user.id) && <Button size="sm" variant="ghost" onClick={() => ask(r, 'cancel')}>Cancel</Button>}
                    {manage && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => ask(r, 'reject')}>Reject</Button>}
                  </div>
                ),
            },
          ]}
        />
      </Card>
      <RequestDialog open={asking} onOpenChange={(o) => { setAsking(o); if (!o && url.get('new')) url.set({ new: null }); }} />
      <OrderDialog requests={chosen} open={ordering} onOpenChange={setOrdering} onDone={() => setSelected(new Set())} />
    </>
  );
}

export default function PurchaseRequestsPage() {
  return (
    <RequirePermission anyOf={['procurement.request', 'procurement.read']}>
      <Suspense>
        <Requests />
      </Suspense>
    </RequirePermission>
  );
}
