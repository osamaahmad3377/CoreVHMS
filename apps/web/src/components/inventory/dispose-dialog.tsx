'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DISPOSAL_METHOD_LABELS, DISPOSAL_METHODS, DISPOSAL_REASON_LABELS, DISPOSAL_REASONS, type DisposalMethod, type DisposalReason } from '@vcms/shared';
import { Lock, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Field } from '../forms/field';
import { FormError } from '../forms/form-error';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input, NativeSelect, Textarea } from '../ui/input';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { StockDisposal } from '@/lib/types';

/** A batch at a store room, ready to be disposed of. */
export interface DisposeItem {
  batchId: string;
  batchNumber: string;
  expiryDate: string | null;
  expired: boolean;
  recalled?: boolean;
  productName: string;
  unit: string;
  isControlled: boolean;
  location: { id: string; name: string };
  onHand: number;
  unitCostMinor: number;
}

const qtyOk = (v: string, max: number) => /^\d+(\.\d{1,4})?$/.test(v) && Number(v) > 0 && Number(v) <= max;

/**
 * Dispose of the chosen batches: how much of each, why, how it was destroyed and (for controlled medicines) who
 * witnessed it. One disposal record per store room; the stock leaves the shelf permanently.
 */
export function DisposeDialog({ items, open, onOpenChange, onDone }: { items: DisposeItem[]; open: boolean; onOpenChange: (o: boolean) => void; onDone?: () => void }) {
  const { currency } = useSession();
  const qc = useQueryClient();
  const router = useRouter();
  const [qty, setQty] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<DisposalReason>('EXPIRED');
  const [method, setMethod] = useState<DisposalMethod>('WASTE_CONTRACTOR');
  const [contractor, setContractor] = useState('');
  const [reference, setReference] = useState('');
  const [witness, setWitness] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const key = (i: DisposeItem) => `${i.batchId}:${i.location.id}`;
  const controlled = items.some((i) => i.isControlled);
  const witnesses = useQuery({ queryKey: ['disposal-witnesses'], queryFn: () => api.get<{ id: string; name: string; jobTitle: string | null }[]>('/stock/disposals/witnesses'), enabled: open });
  useEffect(() => {
    if (!open) return;
    setQty(Object.fromEntries(items.map((i) => [key(i), String(i.onHand)])));
    setReason(items.every((i) => i.expired) ? 'EXPIRED' : items.some((i) => i.recalled) ? 'RECALLED' : 'SHORT_DATED');
    setMethod(controlled ? 'DENATURED' : 'WASTE_CONTRACTOR');
    setContractor('');
    setReference('');
    setWitness('');
    setNotes('');
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const rooms = [...new Map(items.map((i) => [i.location.id, i.location])).values()];
  const total = items.reduce((n, i) => n + Math.round((Number(qty[key(i)]) || 0) * i.unitCostMinor), 0);
  const invalid = items.some((i) => !qtyOk(qty[key(i)] ?? '', i.onHand)) || (controlled && !witness) || (method === 'WASTE_CONTRACTOR' && !contractor.trim());

  const save = useMutation({
    mutationFn: async () => {
      const done: StockDisposal[] = [];
      for (const room of rooms) {
        const lines = items.filter((i) => i.location.id === room.id);
        done.push(
          await api.post<StockDisposal>('/stock/disposals', {
            locationId: room.id,
            reason,
            method,
            contractor: contractor.trim() || null,
            reference: reference.trim() || null,
            witnessMembershipId: lines.some((i) => i.isControlled) || witness ? witness || null : null,
            notes: notes.trim() || null,
            lines: lines.map((i) => ({ batchId: i.batchId, quantity: Number(qty[key(i)]) })),
          }),
        );
      }
      return done;
    },
    onSuccess: (done) => {
      toast.success(done.length === 1 ? `Disposed — record ${done[0].disposalNo}` : `Disposed — ${done.length} records (one per store room)`);
      for (const k of ['stock', 'stock-product', 'stock-movements', 'disposal-candidates', 'disposals', 'controlled-register']) qc.invalidateQueries({ queryKey: [k] });
      onOpenChange(false);
      onDone?.();
      if (done.length === 1) router.push(`/inventory/disposals/${done[0].id}`);
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Dispose of stock</DialogTitle>
          <DialogDescription>
            The stock is taken off the shelf for good and a disposal record is kept{rooms.length > 1 ? ` — one for each of the ${rooms.length} store rooms` : ''}.
          </DialogDescription>
        </DialogHeader>
        {error && <FormError message={error} />}
        <ul className="divide-y rounded-lg border">
          {items.map((i) => (
            <li key={key(i)} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1 font-medium">{i.productName}{i.isControlled && <Lock className="h-3.5 w-3.5 text-warning" aria-label="Controlled" />}</p>
                <p className="text-xs text-muted-foreground">
                  Batch {i.batchNumber}{i.expiryDate && ` · ${i.expired ? 'expired' : 'expires'} ${fmtDate(i.expiryDate)}`} · {i.location.name} · {i.onHand} {i.unit} on hand
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <Input
                  aria-label={`Quantity of ${i.productName} batch ${i.batchNumber} to dispose`}
                  inputMode="decimal"
                  className="w-24 tabular"
                  value={qty[key(i)] ?? ''}
                  aria-invalid={!qtyOk(qty[key(i)] ?? '', i.onHand)}
                  onChange={(e) => setQty((q) => ({ ...q, [key(i)]: e.target.value }))}
                />
                <span className="w-14 text-xs text-muted-foreground">{i.unit}</span>
              </div>
            </li>
          ))}
        </ul>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Why" htmlFor="dp-reason">
            <NativeSelect id="dp-reason" value={reason} onChange={(e) => setReason(e.target.value as DisposalReason)}>
              {DISPOSAL_REASONS.map((r) => <option key={r} value={r}>{DISPOSAL_REASON_LABELS[r]}</option>)}
            </NativeSelect>
          </Field>
          <Field label="How it is destroyed" htmlFor="dp-method">
            <NativeSelect id="dp-method" value={method} onChange={(e) => setMethod(e.target.value as DisposalMethod)}>
              {DISPOSAL_METHODS.map((m) => <option key={m} value={m}>{DISPOSAL_METHOD_LABELS[m]}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Waste contractor" htmlFor="dp-contractor" required={method === 'WASTE_CONTRACTOR'}>
            <Input id="dp-contractor" value={contractor} maxLength={160} onChange={(e) => setContractor(e.target.value)} placeholder="e.g. company collecting the pharmaceutical waste" />
          </Field>
          <Field label="Consignment note / reference" htmlFor="dp-ref">
            <Input id="dp-ref" value={reference} maxLength={120} onChange={(e) => setReference(e.target.value)} placeholder="e.g. CN-4471" />
          </Field>
          <Field label="Witness" htmlFor="dp-witness" required={controlled} hint={controlled ? 'Controlled medicines must be destroyed in front of another member of staff.' : 'Optional'} className="sm:col-span-2">
            <NativeSelect id="dp-witness" value={witness} onChange={(e) => setWitness(e.target.value)}>
              <option value="">{controlled ? 'Choose who witnessed it…' : 'No witness'}</option>
              {(witnesses.data ?? []).map((w) => <option key={w.id} value={w.id}>{w.name}{w.jobTitle ? ` — ${w.jobTitle}` : ''}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Notes" htmlFor="dp-notes" className="sm:col-span-2">
            <Textarea id="dp-notes" value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. vials found cracked during the stock check" />
          </Field>
        </div>
        <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm">
          Value written off at cost: <b className="tabular">{fmtMoney(total, currency)}</b>
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" disabled={invalid} loading={save.isPending} onClick={() => { setError(null); save.mutate(); }}>
            <Trash2 /> Dispose
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
