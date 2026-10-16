'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FormError } from '../forms/form-error';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { api } from '@/lib/api';
import type { Prescription } from '@/lib/types';

export function DispenseDialog({ rx, open, onOpenChange }: { rx: Prescription; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [lines, setLines] = useState<Record<string, { quantity: string; batchNumber: string; expiryDate: string }>>({});
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setLines(Object.fromEntries(rx.items.map((i) => [i.id, { quantity: i.remaining > 0 ? String(Math.min(i.remaining, i.quantity)) : '0', batchNumber: '', expiryDate: '' }])));
      setError(null);
    }
  }, [open, rx]);
  const m = useMutation({
    mutationFn: () =>
      api.post<Prescription>(`/prescriptions/${rx.id}/dispense`, {
        lines: Object.entries(lines)
          .filter(([, l]) => Number(l.quantity) > 0)
          .map(([itemId, l]) => ({ itemId, quantity: Number(l.quantity), batchNumber: l.batchNumber || null, expiryDate: l.expiryDate || null })),
      }),
    onSuccess: (r) => {
      toast.success(`${r.prescriptionNo}: ${r.status === 'DISPENSED' ? 'fully dispensed' : 'partly dispensed'}`);
      qc.invalidateQueries({ queryKey: ['prescription', rx.id] });
      qc.invalidateQueries({ queryKey: ['prescriptions'] });
      onOpenChange(false);
    },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Dispense {rx.prescriptionNo}</DialogTitle>
          <DialogDescription>Record what is handed to the client. Batch and expiry support recalls and traceability.</DialogDescription>
        </DialogHeader>
        {error && <FormError message={error} />}
        <div className="grid gap-3">
          {rx.items.map((i) => (
            <div key={i.id} className="grid gap-2 rounded-md border p-3">
              <p className="text-sm font-medium">{i.product.name}</p>
              <p className="text-xs text-muted-foreground">
                Remaining {i.remaining} {i.product.dispensingUnit} (prescribed {i.quantity} × {1 + i.repeats})
              </p>
              <div className="grid grid-cols-3 gap-2">
                <Input aria-label={`Quantity of ${i.product.name}`} inputMode="decimal" disabled={i.remaining <= 0} value={lines[i.id]?.quantity ?? ''} onChange={(e) => setLines((s) => ({ ...s, [i.id]: { ...s[i.id], quantity: e.target.value } }))} />
                <Input aria-label="Batch number" placeholder="Batch" value={lines[i.id]?.batchNumber ?? ''} onChange={(e) => setLines((s) => ({ ...s, [i.id]: { ...s[i.id], batchNumber: e.target.value } }))} />
                <Input aria-label="Expiry date" type="date" value={lines[i.id]?.expiryDate ?? ''} onChange={(e) => setLines((s) => ({ ...s, [i.id]: { ...s[i.id], expiryDate: e.target.value } }))} />
              </div>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={m.isPending} disabled={!Object.values(lines).some((l) => Number(l.quantity) > 0)} onClick={() => { setError(null); m.mutate(); }}>Dispense</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
