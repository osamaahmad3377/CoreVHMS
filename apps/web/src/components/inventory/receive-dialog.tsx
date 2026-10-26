'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PRESCRIBABLE_PRODUCT_TYPES, PRODUCT_TYPE_LABELS, fromMinor } from '@vcms/shared';
import { Plus, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { MoneyInput, parseMoney } from '../billing/money';
import { Field } from '../forms/field';
import { FormError } from '../forms/form-error';
import { ProductDialog, ProductTypeChooser, typeIcon, type ProductType } from '../pharmacy/product-dialog';
import { ProductPicker } from '../pharmacy/product-picker';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input, NativeSelect } from '../ui/input';
import { QuickAddSupplier } from './quick-supplier';
import { api } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import { qtyUnit } from '@/lib/labels';
import { defaultLocation, locationLabel, sortedLocations } from '@/lib/locations';
import { useSession } from '@/lib/session';
import type { Product, PurchaseOrder, StockLocation, Supplier } from '@/lib/types';
import { cn } from '@/lib/utils';

interface Line {
  key: string;
  /** What kind of stock this line is ("What are you adding?"); a chosen product's own type wins. */
  type: ProductType | null;
  product: (Pick<Product, 'id' | 'name' | 'dispensingUnit'> & { type?: string }) | null;
  purchaseOrderLineId?: string;
  batchNumber: string;
  expiryDate: string;
  quantity: string;
  cost: string;
}

const blank = (type: ProductType | null = null): Line => ({ key: crypto.randomUUID(), type, product: null, batchNumber: '', expiryDate: '', quantity: '', cost: '' });
/** Supplier choice for goods bought locally or with no supplier recorded (booked to the "Local purchase" supplier). */
const LOCAL = 'local';
/** Medicines and vaccines need the batch number and expiry from the pack; other products may leave them blank. */
export const needsBatch = (type?: string | null) => !type || (PRESCRIBABLE_PRODUCT_TYPES as readonly string[]).includes(type);
/** Products that can go off: a best-before date is asked for (optional), a batch number is not. */
const DATED = new Set<string>(['FOOD', 'SUPPLEMENT', 'GROOMING', 'CONSUMABLE']);
const lineType = (l: Line) => (l.product?.type as ProductType | undefined) ?? l.type;

/** Why a delivery line cannot be saved yet, in plain words (null when it is complete). */
function lineProblem(l: Line, currency: string) {
  const name = l.product?.name ?? 'this product';
  const t = lineType(l);
  if (needsBatch(t) && !l.batchNumber.trim()) return `Enter a batch number for ${name}`;
  if (needsBatch(t) && !l.expiryDate) return `Enter the expiry date for ${name}`;
  if (parseMoney(l.cost, currency) === null) return `Enter the cost price for ${name}`;
  return null;
}

/**
 * Goods receipt (delivery): every line creates or tops up a batch at the chosen store room. A new delivery starts
 * with "What are you adding to stock?", and every product added asks again, so one delivery can mix medicines,
 * vaccines, food and supplies — each line asks only for what its kind needs.
 */
export function ReceiveStockDialog({ open, onOpenChange, order, initialProduct }: { open: boolean; onOpenChange: (o: boolean) => void; order?: PurchaseOrder; initialProduct?: Line['product'] }) {
  const qc = useQueryClient();
  const { currency, session, can } = useSession();
  const [supplierId, setSupplierId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** "What are you adding?" — first for the whole delivery, then each time a product is added. */
  const [asking, setAsking] = useState<'start' | 'add' | null>(null);
  /** Line waiting for a product created from the picker's "New product". */
  const [creating, setCreating] = useState<{ key: string; name: string; type: ProductType } | null>(null);
  const canCreate = can('inventory.write') || can('formulary.manage');
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => api.get<Supplier[]>('/suppliers'), enabled: open });
  const locations = useQuery({ queryKey: ['stock-locations'], queryFn: () => api.get<StockLocation[]>('/stock-locations'), enabled: open });

  useEffect(() => {
    if (!open) return;
    setError(null);
    setInvoiceNo('');
    setCreating(null);
    if (order) {
      setAsking(null);
      setSupplierId(order.supplierId);
      setLocationId(order.locationId);
      setLines(
        order.lines
          .filter((l) => l.quantity > l.quantityReceived)
          .map((l) => ({ key: l.id, type: (l.product.type as ProductType) ?? null, product: { id: l.productId, name: l.product.name, dispensingUnit: l.product.dispensingUnit ?? '', type: l.product.type }, purchaseOrderLineId: l.id, batchNumber: '', expiryDate: '', quantity: String(l.quantity - l.quantityReceived), cost: fromMinor(l.unitCostMinor, currency) })),
      );
    } else {
      setSupplierId('');
      if (initialProduct) {
        setAsking(null);
        setLines([{ ...blank((initialProduct.type as ProductType) ?? null), product: initialProduct }]);
      } else {
        setAsking('start');
        setLines([]);
      }
    }
  }, [open, order, currency, initialProduct]);
  useEffect(() => {
    if (!locationId && locations.data?.length) setLocationId(defaultLocation(locations.data, session.branch?.id)!.id);
  }, [locations.data, locationId, session.branch?.id]);

  const update = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLine = (t: ProductType) => {
    setLines((ls) => [...ls, blank(t)]);
    setAsking(null);
  };
  const payload = lines.filter((l) => l.product && Number(l.quantity) > 0);
  const total = payload.reduce((n, l) => n + Math.round(Number(l.quantity) * (parseMoney(l.cost, currency) ?? 0)), 0);
  const problem =
    !supplierId ? 'Choose a supplier, or "Bought locally / not recorded"'
    : !locationId ? 'Choose the store room to put the stock into'
    : !payload.length ? 'Add a product and its quantity'
    : payload.map((l) => lineProblem(l, currency)).find(Boolean) ?? null;
  const kinds = [...new Set(lines.map(lineType).filter(Boolean))] as ProductType[];

  const m = useMutation({
    mutationFn: () =>
      api.post<{ receiptNo: string }>('/stock/receipts', {
        supplierId: supplierId === LOCAL ? null : supplierId,
        locationId,
        purchaseOrderId: order?.id ?? null,
        supplierInvoiceNo: invoiceNo || null,
        lines: payload.map((l) => ({ productId: l.product!.id, purchaseOrderLineId: l.purchaseOrderLineId ?? null, batchNumber: l.batchNumber.trim() || null, expiryDate: l.expiryDate || null, quantity: Number(l.quantity), unitCostMinor: parseMoney(l.cost, currency) })),
      }),
    onSuccess: (r) => {
      const one = payload.length === 1 ? payload[0] : null;
      toast.success(one ? `${qtyUnit(Number(one.quantity), one.product!.dispensingUnit)} of ${one.product!.name} added to stock (${r.receiptNo})` : `${payload.length} products added to stock (${r.receiptNo})`);
      ['stock', 'stock-product', 'stock-movements', 'purchase-orders', 'purchase-order', 'dashboard', 'stock-forecast'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onOpenChange(false);
    },
    onError: (e: Error) => setError(e.message),
  });

  const starting = asking === 'start';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>{order ? `Receive delivery for ${order.poNo}` : starting ? 'What are you adding to stock?' : 'Receive stock'}</DialogTitle>
          <DialogDescription>
            {starting
              ? 'Choose the kind of stock that arrived. You can add other kinds to the same delivery afterwards.'
              : 'Each product asks only for what its kind needs: batch and expiry for medicines and vaccines, a best-before date for food and supplies, nothing extra for accessories.'}
          </DialogDescription>
        </DialogHeader>

        {starting ? (
          <ProductTypeChooser onChoose={(t) => { setLines([blank(t)]); setAsking(null); }} />
        ) : (
          <>
            {error && <FormError message={error} />}
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="grid content-start gap-1">
                <Field label="Supplier" htmlFor="rcv-sup" required>
                  <NativeSelect id="rcv-sup" value={supplierId} disabled={!!order} onChange={(e) => setSupplierId(e.target.value)}>
                    <option value="">Choose…</option>
                    <option value={LOCAL}>Bought locally / not recorded</option>
                    {(suppliers.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </NativeSelect>
                </Field>
                {!order && <QuickAddSupplier onCreated={(s) => setSupplierId(s.id)} />}
              </div>
              <Field label="Store room" htmlFor="rcv-loc" required>
                <NativeSelect id="rcv-loc" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                  {sortedLocations(locations.data, session.branch?.id).filter((l) => l.isActive).map((l) => <option key={l.id} value={l.id}>{locationLabel(l, locations.data)}</option>)}
                </NativeSelect>
              </Field>
              <Field label="Supplier invoice / delivery no." htmlFor="rcv-inv"><Input id="rcv-inv" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} maxLength={80} /></Field>
            </div>

            <div className="grid max-h-[45vh] gap-2 overflow-y-auto">
              <div aria-hidden className="hidden px-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground lg:grid lg:grid-cols-[minmax(0,1fr)_130px_140px_90px_130px_32px] lg:gap-2">
                <span>Product</span><span>Batch / lot</span><span>Expiry / best before</span><span>Quantity</span><span>Cost price (each)</span><span />
              </div>
              {lines.map((l, idx) => {
                const t = lineType(l);
                const Icon = typeIcon(t);
                const batch = needsBatch(t);
                const dated = batch || (!!t && DATED.has(t));
                return (
                  <div key={l.key} className="grid gap-2 rounded-lg surface-flat p-2 lg:grid-cols-[minmax(0,1fr)_130px_140px_90px_130px_32px] lg:items-center">
                    <div className="grid min-w-0 gap-1">
                      {t && (
                        <span className="inline-flex w-fit items-center gap-1 rounded-pill bg-primary/10 px-2 py-0.5 text-2xs font-semibold text-primary">
                          <Icon className="h-3 w-3" /> {PRODUCT_TYPE_LABELS[t]}
                        </span>
                      )}
                      {order ? (
                        <p className="text-sm font-medium">{l.product?.name}</p>
                      ) : (
                        <ProductPicker
                          value={l.product as Product | null}
                          onChange={(p) => update(l.key, { product: p })}
                          type={l.type ?? undefined}
                          placeholder={l.type ? `Choose ${PRODUCT_TYPE_LABELS[l.type].toLowerCase()}…` : 'Product…'}
                          onCreate={canCreate && l.type ? (name) => setCreating({ key: l.key, name, type: l.type! }) : undefined}
                        />
                      )}
                    </div>
                    {batch ? (
                      <Input aria-label={`Line ${idx + 1} batch number`} placeholder="Batch / lot" value={l.batchNumber} onChange={(e) => update(l.key, { batchNumber: e.target.value })} maxLength={60} />
                    ) : (
                      <span className="hidden text-xs text-muted-foreground lg:block">Not needed</span>
                    )}
                    {dated ? (
                      <Input aria-label={`Line ${idx + 1} ${batch ? 'expiry' : 'best before (optional)'}`} title={batch ? 'Expiry date' : 'Best before (optional)'} type="date" value={l.expiryDate} onChange={(e) => update(l.key, { expiryDate: e.target.value })} />
                    ) : (
                      <span className="hidden text-xs text-muted-foreground lg:block">Not needed</span>
                    )}
                    <Input aria-label={`Line ${idx + 1} quantity`} placeholder={`Qty${l.product ? ` (${l.product.dispensingUnit})` : ''}`} inputMode="decimal" value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} />
                    <MoneyInput aria-label={`Line ${idx + 1} unit cost`} placeholder="Cost price" currency={currency} value={l.cost} onChange={(e) => update(l.key, { cost: e.target.value })} />
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove line ${idx + 1}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><Trash2 /></Button>
                  </div>
                );
              })}
            </div>

            {!order &&
              (asking === 'add' ? (
                <div className="grid gap-2 rounded-xl border border-primary/25 bg-primary/[0.03] p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold">What are you adding?</p>
                    <Button type="button" size="icon-sm" variant="ghost" aria-label="Close" onClick={() => setAsking(null)}><X /></Button>
                  </div>
                  <ProductTypeChooser compact onChoose={addLine} />
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => setAsking('add')}><Plus /> Add product</Button>
                  {kinds.slice(0, 3).map((k) => {
                    const Icon = typeIcon(k);
                    return (
                      <Button key={k} type="button" size="sm" variant="ghost" className="text-muted-foreground" onClick={() => addLine(k)} title={`Add more ${PRODUCT_TYPE_LABELS[k].toLowerCase()} to this delivery`}>
                        <Icon /> More {PRODUCT_TYPE_LABELS[k].toLowerCase()}
                      </Button>
                    );
                  })}
                </div>
              ))}
            <p className={cn('text-right text-sm', !payload.length && 'text-muted-foreground')}>
              {payload.length > 0 && `${payload.length} ${payload.length === 1 ? 'product' : 'products'} · `}Delivery value <b className="tabular">{fmtMoney(total, currency)}</b>
            </p>
          </>
        )}

        <DialogFooter className="items-center">
          {!starting && problem && <p role="status" className="mr-auto text-sm text-muted-foreground">{problem}</p>}
          <Button variant="outline" className={starting ? 'ml-auto' : undefined} onClick={() => onOpenChange(false)}>Cancel</Button>
          {!starting && <Button loading={m.isPending} disabled={!!problem} onClick={() => { setError(null); m.mutate(); }}>Add to stock</Button>}
        </DialogFooter>
        {/* Inside the content so clicks in it do not count as clicks outside this dialog. */}
        {creating && (
          <ProductDialog
            key={creating.key}
            product={null}
            open
            defaultType={creating.type}
            initialName={creating.name}
            onOpenChange={(o) => { if (!o) setCreating(null); }}
            onSaved={(p) => update(creating.key, { product: { id: p.id, name: p.name, dispensingUnit: p.dispensingUnit, type: p.type } })}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
