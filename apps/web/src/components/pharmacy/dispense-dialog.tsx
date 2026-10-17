'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { allergyMatches } from '@vcms/shared';
import { ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Field } from '../forms/field';
import { FormError } from '../forms/form-error';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { BatchPicker, type BatchChoice } from './batch-picker';
import { api } from '@/lib/api';
import { qtyUnit } from '@/lib/labels';
import type { Prescription } from '@/lib/types';

type Line = { quantity: string } & BatchChoice;

/** "14 tablets left to dispense · 14 tablets prescribed + 1 repeat (28 in all)" */
function remainingText(i: Prescription['items'][number]) {
  const unit = i.product.dispensingUnit;
  const prescribed = i.repeats ? `${qtyUnit(i.quantity, unit)} prescribed + ${i.repeats} repeat${i.repeats === 1 ? '' : 's'} (${i.quantity * (1 + i.repeats)} in all)` : `${qtyUnit(i.quantity, unit)} prescribed`;
  return i.remaining > 0 ? `${qtyUnit(i.remaining, unit)} left to dispense · ${prescribed}` : `Fully dispensed · ${prescribed}`;
}

export function DispenseDialog({ rx, open, onOpenChange }: { rx: Prescription; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [lines, setLines] = useState<Record<string, Line>>({});
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setLines(Object.fromEntries(rx.items.map((i) => [i.id, { quantity: i.remaining > 0 ? String(Math.min(i.remaining, i.quantity)) : '0', batchNumber: '', expiryDate: '' }])));
      setError(null);
    }
  }, [open, rx]);
  const setLine = (id: string, patch: Partial<Line>) => setLines((s) => ({ ...s, [id]: { ...s[id], ...patch } }));
  const m = useMutation({
    mutationFn: () =>
      api.post<Prescription>(`/prescriptions/${rx.id}/dispense`, {
        lines: Object.entries(lines)
          .filter(([, l]) => Number(l.quantity) > 0)
          .map(([itemId, l]) => ({ itemId, quantity: Number(l.quantity), batchNumber: l.batchNumber || null, expiryDate: l.expiryDate || null })),
      }),
    onSuccess: (r) => {
      toast.success(`${r.prescriptionNo}: ${r.status === 'DISPENSED' ? 'fully dispensed' : 'partly dispensed'}`, {
        action: { label: r.items.length === 1 ? 'Print label' : 'Print labels', onClick: () => window.print() },
        duration: 10_000,
      });
      qc.invalidateQueries({ queryKey: ['prescription', rx.id] });
      qc.invalidateQueries({ queryKey: ['prescriptions'] });
      qc.invalidateQueries({ queryKey: ['product-batches'] });
      onOpenChange(false);
    },
    onError: (e: Error) => setError(e.message),
  });
  const allergies = rx.patient.alerts.filter((a) => a.type === 'ALLERGY' || a.type === 'MEDICATION');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Dispense {rx.prescriptionNo}</DialogTitle>
          <DialogDescription>Record what is handed to {rx.client.displayName} for {rx.patient.name}. The batch is kept for recalls and traceability.</DialogDescription>
        </DialogHeader>
        {error && <FormError message={error} />}
        {!!allergies.length && (
          <div role="alert" className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-sm">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <p><span className="font-medium text-destructive">Check before handing over — {rx.patient.name} has {allergies.length === 1 ? 'an alert' : 'alerts'}:</span> {allergies.map((a) => `${a.substance || a.title}${a.reaction ? ` (${a.reaction})` : ''}`).join('; ')}</p>
          </div>
        )}
        <div className="grid gap-3">
          {rx.items.map((i) => {
            const matches = allergyMatches(allergies, i.product);
            const l = lines[i.id];
            return (
              <div key={i.id} className="grid gap-2 rounded-md border p-3">
                <div>
                  <p className="text-sm font-medium">{i.product.name}</p>
                  <p className="text-xs text-muted-foreground">{remainingText(i)}</p>
                  {!!matches.length && (
                    <p className="mt-1 rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs font-medium text-destructive">
                      ⚠ May conflict with allergy “{matches[0].substance || matches[0].title}” — ask the vet{i.overrideReason ? `. The vet's reason: ${i.overrideReason}` : ''}
                    </p>
                  )}
                </div>
                {i.remaining > 0 && l && (
                  <div className="grid gap-2 sm:grid-cols-[140px_1fr]">
                    <Field label={`Quantity (${i.product.dispensingUnit})`} htmlFor={`dq-${i.id}`}>
                      <Input id={`dq-${i.id}`} inputMode="decimal" value={l.quantity} onChange={(e) => setLine(i.id, { quantity: e.target.value })} />
                    </Field>
                    <BatchPicker id={`db-${i.id}`} productId={i.product.id} quantity={Number(l.quantity) || undefined} value={l} onChange={(v) => setLine(i.id, v)} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={m.isPending} disabled={!Object.values(lines).some((l) => Number(l.quantity) > 0)} onClick={() => { setError(null); m.mutate(); }}>Dispense</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
