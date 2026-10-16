'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PackageX, Undo2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { INVENTORY_LINKS, SectionNav } from '@/components/billing/section-nav';
import { DataTable } from '@/components/data-table';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { EmptyState, PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { StatusBadge } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { api, qs } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { StockLocation, Supplier } from '@/lib/types';

interface Returnable { batchId: string; batchNumber: string; expiryDate: string | null; status: string; product: { id: string; name: string; dispensingUnit: string }; onHand: number; unitCostMinor: number }
interface SupplierReturn {
  id: string;
  returnNo: string;
  supplier: { id: string; name: string };
  reason: string;
  reference: string | null;
  totalMinor: number;
  createdByName: string;
  createdAt: string;
  lines: { id: string; quantity: number; unitCostMinor: number; totalMinor: number; product: { name: string }; batch: { batchNumber: string; expiryDate: string | null } }[];
}

function ReturnDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { currency } = useSession();
  const [supplierId, setSupplierId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [qty, setQty] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => api.get<Supplier[]>('/suppliers'), enabled: open });
  const locations = useQuery({ queryKey: ['stock-locations'], queryFn: () => api.get<StockLocation[]>('/stock-locations'), enabled: open });
  const batches = useQuery({
    queryKey: ['returnable', supplierId, locationId],
    queryFn: () => api.get<Returnable[]>(`/supplier-returns/returnable${qs({ supplierId, locationId })}`),
    enabled: open && !!supplierId && !!locationId,
  });
  useEffect(() => { if (open) { setError(null); setQty({}); setReason(''); setReference(''); } }, [open]);
  useEffect(() => { setQty({}); }, [supplierId, locationId]);
  useEffect(() => {
    if (!locationId && locations.data?.length) setLocationId((locations.data.find((l) => l.isDefault) ?? locations.data[0]).id);
  }, [locations.data, locationId]);
  const lines = (batches.data ?? []).filter((b) => Number(qty[b.batchId]) > 0).map((b) => ({ b, quantity: Number(qty[b.batchId]) }));
  const tooMuch = lines.some((l) => l.quantity > l.b.onHand);
  const total = lines.reduce((n, l) => n + Math.round(l.quantity * l.b.unitCostMinor), 0);
  const m = useMutation({
    mutationFn: () => api.post<SupplierReturn>('/supplier-returns', { supplierId, locationId, reason, reference: reference || null, lines: lines.map((l) => ({ batchId: l.b.batchId, quantity: l.quantity })) }),
    onSuccess: (r) => {
      toast.success(`${r.returnNo} recorded — stock and the supplier balance are updated`);
      for (const k of ['supplier-returns', 'stock', 'returnable', 'supplier']) qc.invalidateQueries({ queryKey: [k] });
      onOpenChange(false);
    },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>Return stock to a supplier</DialogTitle>
          <DialogDescription>Only batches received from this supplier are listed. The stock leaves the location at the batch cost, and the amount is taken off what you owe the supplier. A recorded return cannot be edited.</DialogDescription>
        </DialogHeader>
        {error && <FormError message={error} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Supplier" htmlFor="sr-sup" required>
            <NativeSelect id="sr-sup" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Choose…</option>
              {(suppliers.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="From location" htmlFor="sr-loc" required>
            <NativeSelect id="sr-loc" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              {(locations.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </NativeSelect>
          </Field>
        </div>
        {supplierId && (
          <div className="max-h-[38vh] overflow-y-auto rounded-md border">
            {batches.isLoading ? (
              <p className="p-3 text-sm text-muted-foreground">Loading batches…</p>
            ) : !batches.data?.length ? (
              <EmptyState icon={PackageX} title="Nothing from this supplier is in stock here" />
            ) : (
              <ul className="divide-y">
                {batches.data.map((b) => (
                  <li key={b.batchId} className="grid items-center gap-2 px-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto_120px]">
                    <div>
                      <p className="font-medium">{b.product.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Batch {b.batchNumber}{b.expiryDate ? ` · expires ${fmtDate(b.expiryDate)}` : ''} · {fmtMoney(b.unitCostMinor, currency)} each
                      </p>
                    </div>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">{b.status !== 'AVAILABLE' && <StatusBadge status={b.status} />}{b.onHand} {b.product.dispensingUnit} on hand</span>
                    <Input aria-label={`Quantity to return of batch ${b.batchNumber}`} inputMode="decimal" placeholder="Return qty" value={qty[b.batchId] ?? ''} onChange={(e) => setQty((q) => ({ ...q, [b.batchId]: e.target.value }))} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px]">
          <Field label="Reason" htmlFor="sr-reason" required><Textarea id="sr-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. Manufacturer recall, damaged in transit" /></Field>
          <Field label="Supplier reference (RMA)" htmlFor="sr-ref"><Input id="sr-ref" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} /></Field>
        </div>
        {tooMuch && <p className="text-sm text-destructive">A quantity is more than is on hand.</p>}
        <p className="text-right text-sm">Credit to supplier account <b className="tabular">{fmtMoney(total, currency)}</b></p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={m.isPending} disabled={!lines.length || tooMuch || reason.trim().length < 3} onClick={() => { setError(null); m.mutate(); }}>Record return</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Returns() {
  const { can, currency } = useSession();
  const [creating, setCreating] = useState(false);
  const query = useQuery({ queryKey: ['supplier-returns'], queryFn: () => api.get<SupplierReturn[]>('/supplier-returns') });
  return (
    <>
      <PageHeader
        title="Supplier returns"
        description="Stock sent back to suppliers: recalls, damage, short-dated or wrong items."
        breadcrumbs={[{ label: 'Inventory', href: '/inventory' }, { label: 'Supplier returns' }]}
        actions={can('procurement.write') && can('inventory.adjust') && <Button size="sm" onClick={() => setCreating(true)}><Undo2 /> Return to supplier</Button>}
      />
      <SectionNav links={INVENTORY_LINKS} />
      <Card>
        <DataTable
          query={query}
          rowKey={(r) => r.id}
          empty={<EmptyState icon={Undo2} title="No supplier returns" />}
          columns={[
            { key: 'no', header: 'Return', cell: (r) => <span className="font-medium">{r.returnNo}</span> },
            { key: 'sup', header: 'Supplier', cell: (r) => <span className="text-sm">{r.supplier.name}</span> },
            { key: 'items', header: 'Items', cell: (r) => <ul className="text-xs">{r.lines.map((l) => <li key={l.id}>{l.quantity} × {l.product.name} <span className="text-muted-foreground">(batch {l.batch.batchNumber})</span></li>)}</ul> },
            { key: 'why', header: 'Reason', cell: (r) => <span className="text-sm">{r.reason}{r.reference && <span className="block text-xs text-muted-foreground">Ref {r.reference}</span>}</span> },
            { key: 'when', header: 'Recorded', cell: (r) => <span className="whitespace-nowrap text-xs">{fmtDateTime(r.createdAt)}<span className="block text-muted-foreground">{r.createdByName}</span></span> },
            { key: 'total', header: 'Credit', className: 'text-right tabular', headerClassName: 'text-right', cell: (r) => fmtMoney(r.totalMinor, currency) },
          ]}
        />
      </Card>
      <ReturnDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}

export default function SupplierReturnsPage() {
  return (
    <RequirePermission anyOf={['procurement.read', 'inventory.read']}>
      <Returns />
    </RequirePermission>
  );
}
