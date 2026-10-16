'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ADJUSTMENT_REASONS, enumLabel } from '@vcms/shared';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Field } from '../forms/field';
import { FormError } from '../forms/form-error';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input, NativeSelect, Textarea } from '../ui/input';
import { api } from '@/lib/api';
import type { StockBatch, StockLocation } from '@/lib/types';

const ADDS = ['FOUND', 'RETURN_FROM_CLIENT', 'DATA_CORRECTION', 'OTHER'];
const REMOVES = ['DAMAGED', 'EXPIRED', 'LOST', 'RECALLED', 'RETURN_TO_SUPPLIER', 'DATA_CORRECTION', 'OTHER'];

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  ['stock', 'stock-product', 'stock-movements', 'dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}

export function AdjustDialog({ batch, unit, onClose }: { batch: StockBatch | null; unit: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [direction, setDirection] = useState<'remove' | 'add'>('remove');
  const [locationId, setLocationId] = useState('');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('DAMAGED');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const locations = useQuery({ queryKey: ['stock-locations'], queryFn: () => api.get<StockLocation[]>('/stock-locations'), enabled: !!batch });
  useEffect(() => {
    if (!batch) return;
    setDirection('remove'); setQty(''); setReason('DAMAGED'); setNotes(''); setError(null);
    setLocationId(batch.levels.find((l) => l.quantity > 0)?.locationId ?? batch.levels[0]?.locationId ?? '');
  }, [batch]);
  const level = batch?.levels.find((l) => l.locationId === locationId);
  const m = useMutation({
    mutationFn: () => api.post('/stock/adjustments', { batchId: batch!.id, locationId, quantity: direction === 'remove' ? -Number(qty) : Number(qty), reason, notes: notes || null }),
    onSuccess: () => { toast.success('Stock adjusted'); invalidate(qc); onClose(); },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog open={!!batch} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Adjust batch {batch?.batchNumber}</DialogTitle>
          <DialogDescription>Adjustments and write-offs are permanent ledger entries with your name and reason.</DialogDescription>
        </DialogHeader>
        {error && <FormError message={error} />}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Change" htmlFor="adj-dir">
            <NativeSelect id="adj-dir" value={direction} onChange={(e) => { const d = e.target.value as 'add' | 'remove'; setDirection(d); setReason(d === 'remove' ? 'DAMAGED' : 'FOUND'); }}>
              <option value="remove">Remove / write off</option>
              <option value="add">Add</option>
            </NativeSelect>
          </Field>
          <Field label="Location" htmlFor="adj-loc">
            <NativeSelect id="adj-loc" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              {(locations.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label={`Quantity (${unit})`} htmlFor="adj-qty" required hint={`On hand here: ${level?.quantity ?? 0}`}><Input id="adj-qty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
          <Field label="Reason" htmlFor="adj-reason" required>
            <NativeSelect id="adj-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
              {ADJUSTMENT_REASONS.filter((r) => (direction === 'remove' ? REMOVES : ADDS).includes(r)).map((r) => <option key={r} value={r}>{enumLabel(r)}</option>)}
            </NativeSelect>
          </Field>
        </div>
        <Field label="Notes" htmlFor="adj-notes"><Textarea id="adj-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} /></Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant={direction === 'remove' ? 'destructive' : 'default'} loading={m.isPending} disabled={!(Number(qty) > 0) || !locationId} onClick={() => { setError(null); m.mutate(); }}>Save adjustment</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TransferDialog({ batch, unit, onClose }: { batch: StockBatch | null; unit: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [qty, setQty] = useState('');
  const [error, setError] = useState<string | null>(null);
  const locations = useQuery({ queryKey: ['stock-locations'], queryFn: () => api.get<StockLocation[]>('/stock-locations'), enabled: !!batch });
  useEffect(() => {
    if (!batch) return;
    setQty(''); setError(null); setTo('');
    setFrom(batch.levels.find((l) => l.quantity > 0)?.locationId ?? '');
  }, [batch]);
  const available = batch?.levels.find((l) => l.locationId === from)?.quantity ?? 0;
  const m = useMutation({
    mutationFn: () => api.post('/stock/transfers', { batchId: batch!.id, fromLocationId: from, toLocationId: to, quantity: Number(qty) }),
    onSuccess: () => { toast.success('Stock transferred'); invalidate(qc); onClose(); },
    onError: (e: Error) => setError(e.message),
  });
  const active = (locations.data ?? []).filter((l) => l.isActive);
  return (
    <Dialog open={!!batch} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Transfer batch {batch?.batchNumber}</DialogTitle>
          <DialogDescription>Move stock between locations (e.g. store room to pharmacy or ward).</DialogDescription>
        </DialogHeader>
        {error && <FormError message={error} />}
        <div className="grid grid-cols-2 gap-3">
          <Field label="From" htmlFor="tr-from">
            <NativeSelect id="tr-from" value={from} onChange={(e) => setFrom(e.target.value)}>
              {batch?.levels.filter((l) => l.quantity > 0).map((l) => <option key={l.locationId} value={l.locationId}>{l.location.name} ({l.quantity})</option>)}
            </NativeSelect>
          </Field>
          <Field label="To" htmlFor="tr-to">
            <NativeSelect id="tr-to" value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">Choose…</option>
              {active.filter((l) => l.id !== from).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label={`Quantity (${unit})`} htmlFor="tr-qty" required hint={`Available: ${available}`}><Input id="tr-qty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button loading={m.isPending} disabled={!from || !to || !(Number(qty) > 0) || Number(qty) > available} onClick={() => { setError(null); m.mutate(); }}>Transfer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
