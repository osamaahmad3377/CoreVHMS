'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fromMinor } from '@vcms/shared';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { MoneyInput, parseMoney } from '../billing/money';
import { Field } from '../forms/field';
import { FormError } from '../forms/form-error';
import { ProductPicker } from '../pharmacy/product-picker';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input, NativeSelect } from '../ui/input';
import { api } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import { defaultLocation, locationLabel, sortedLocations } from '@/lib/locations';
import { useSession } from '@/lib/session';
import type { Product, PurchaseOrder, StockLocation, Supplier } from '@/lib/types';

interface Line {
  key: string;
  product: Pick<Product, 'id' | 'name' | 'dispensingUnit'> | null;
  purchaseOrderLineId?: string;
  batchNumber: string;
  expiryDate: string;
  quantity: string;
  cost: string;
}

const blank = (): Line => ({ key: crypto.randomUUID(), product: null, batchNumber: '', expiryDate: '', quantity: '', cost: '' });

/** Goods receipt: every line creates or tops up a batch (batch number + expiry) at the chosen location. */
export function ReceiveStockDialog({ open, onOpenChange, order }: { open: boolean; onOpenChange: (o: boolean) => void; order?: PurchaseOrder }) {
  const qc = useQueryClient();
  const { currency, session } = useSession();
  const [supplierId, setSupplierId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [error, setError] = useState<string | null>(null);
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => api.get<Supplier[]>('/suppliers'), enabled: open });
  const locations = useQuery({ queryKey: ['stock-locations'], queryFn: () => api.get<StockLocation[]>('/stock-locations'), enabled: open });

  useEffect(() => {
    if (!open) return;
    setError(null);
    setInvoiceNo('');
    if (order) {
      setSupplierId(order.supplierId);
      setLocationId(order.locationId);
      setLines(
        order.lines
          .filter((l) => l.quantity > l.quantityReceived)
          .map((l) => ({ key: l.id, product: { id: l.productId, name: l.product.name, dispensingUnit: l.product.dispensingUnit ?? '' }, purchaseOrderLineId: l.id, batchNumber: '', expiryDate: '', quantity: String(l.quantity - l.quantityReceived), cost: fromMinor(l.unitCostMinor, currency) })),
      );
    } else {
      setLines([blank()]);
    }
  }, [open, order, currency]);
  useEffect(() => {
    if (!locationId && locations.data?.length) setLocationId(defaultLocation(locations.data, session.branch?.id)!.id);
  }, [locations.data, locationId, session.branch?.id]);

  const update = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const payload = lines.filter((l) => l.product && Number(l.quantity) > 0);
  const total = payload.reduce((n, l) => n + Math.round(Number(l.quantity) * (parseMoney(l.cost, currency) ?? 0)), 0);
  const incomplete = payload.some((l) => !l.batchNumber.trim() || parseMoney(l.cost, currency) === null);

  const m = useMutation({
    mutationFn: () =>
      api.post<{ receiptNo: string }>('/stock/receipts', {
        supplierId,
        locationId,
        purchaseOrderId: order?.id ?? null,
        supplierInvoiceNo: invoiceNo || null,
        lines: payload.map((l) => ({ productId: l.product!.id, purchaseOrderLineId: l.purchaseOrderLineId ?? null, batchNumber: l.batchNumber.trim(), expiryDate: l.expiryDate || null, quantity: Number(l.quantity), unitCostMinor: parseMoney(l.cost, currency) })),
      }),
    onSuccess: (r) => {
      toast.success(`${r.receiptNo} received`);
      ['stock', 'stock-product', 'stock-movements', 'purchase-orders', 'purchase-order', 'dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onOpenChange(false);
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>{order ? `Receive against ${order.poNo}` : 'Receive stock'}</DialogTitle>
          <DialogDescription>Record batch numbers and expiry dates exactly as printed on the packs — they drive expiry alerts, first-expiry-first-out issuing and recalls.</DialogDescription>
        </DialogHeader>
        {error && <FormError message={error} />}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Supplier" htmlFor="rcv-sup" required>
            <NativeSelect id="rcv-sup" value={supplierId} disabled={!!order} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">{suppliers.data?.length === 0 ? 'Add a supplier first' : 'Choose…'}</option>
              {(suppliers.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Into location" htmlFor="rcv-loc" required>
            <NativeSelect id="rcv-loc" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              {sortedLocations(locations.data, session.branch?.id).filter((l) => l.isActive).map((l) => <option key={l.id} value={l.id}>{locationLabel(l, locations.data)}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Supplier invoice / delivery no." htmlFor="rcv-inv"><Input id="rcv-inv" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} maxLength={80} /></Field>
        </div>
        <div className="grid max-h-[45vh] gap-2 overflow-y-auto">
          <div aria-hidden className="hidden px-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground lg:grid lg:grid-cols-[minmax(0,1fr)_130px_140px_90px_130px_32px] lg:gap-2">
            <span>Product</span><span>Batch / lot</span><span>Expiry</span><span>Quantity</span><span>Unit cost</span><span />
          </div>
          {lines.map((l, idx) => (
            <div key={l.key} className="grid gap-2 rounded-md border p-2 lg:grid-cols-[minmax(0,1fr)_130px_140px_90px_130px_auto] lg:items-center">
              {order ? <p className="text-sm font-medium">{l.product?.name}</p> : <ProductPicker value={l.product as Product | null} onChange={(p) => update(l.key, { product: p })} placeholder="Product…" />}
              <Input aria-label={`Line ${idx + 1} batch number`} placeholder="Batch / lot" value={l.batchNumber} onChange={(e) => update(l.key, { batchNumber: e.target.value })} maxLength={60} />
              <Input aria-label={`Line ${idx + 1} expiry`} type="date" value={l.expiryDate} onChange={(e) => update(l.key, { expiryDate: e.target.value })} />
              <Input aria-label={`Line ${idx + 1} quantity`} placeholder={`Qty${l.product ? ` (${l.product.dispensingUnit})` : ''}`} inputMode="decimal" value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} />
              <MoneyInput aria-label={`Line ${idx + 1} unit cost`} placeholder="Unit cost" currency={currency} value={l.cost} onChange={(e) => update(l.key, { cost: e.target.value })} />
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove line ${idx + 1}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><Trash2 /></Button>
            </div>
          ))}
        </div>
        {!order && <div><Button type="button" size="sm" variant="outline" onClick={() => setLines((ls) => [...ls, blank()])}><Plus /> Add line</Button></div>}
        <p className="text-right text-sm">Receipt value <b className="tabular">{fmtMoney(total, currency)}</b></p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={m.isPending} disabled={!supplierId || !locationId || !payload.length || incomplete} onClick={() => { setError(null); m.mutate(); }}>Receive</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
