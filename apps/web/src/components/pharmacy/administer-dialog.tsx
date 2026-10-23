'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ROUTES } from '@vcms/shared';
import { ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Field } from '../forms/field';
import { FormError } from '../forms/form-error';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input, NativeSelect } from '../ui/input';
import { ProductPicker } from './product-picker';
import { ApiError, api } from '@/lib/api';
import { routeLabel } from '@/lib/labels';
import type { Product } from '@/lib/types';

/** Records medication given in clinic (injection, in-clinic dose, vaccine). */
export function AdministerDialog({ open, onOpenChange, patientId, encounterId }: { open: boolean; onOpenChange: (o: boolean) => void; patientId: string; encounterId?: string | null }) {
  const qc = useQueryClient();
  const [product, setProduct] = useState<Product | null>(null);
  const [f, setF] = useState({ dose: '', doseUnit: 'mL', route: 'SC', site: '', batchNumber: '', expiryDate: '', notes: '', reasonNotGiven: '', overrideReason: '' });
  const [notGiven, setNotGiven] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsOverride, setNeedsOverride] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setProduct(null);
      setF({ dose: '', doseUnit: 'mL', route: 'SC', site: '', batchNumber: '', expiryDate: '', notes: '', reasonNotGiven: '', overrideReason: '' });
      setNotGiven(false);
      setError(null);
      setNeedsOverride(null);
    }
  }, [open]);
  const m = useMutation({
    mutationFn: () =>
      api.post('/administrations', {
        patientId,
        encounterId,
        productId: product!.id,
        status: notGiven ? 'NOT_GIVEN' : 'GIVEN',
        ...f,
        overrideReason: f.overrideReason || null,
      }),
    onSuccess: () => {
      toast.success(notGiven ? 'Recorded as not given' : 'Administration recorded');
      qc.invalidateQueries({ queryKey: ['administrations'] });
      qc.invalidateQueries({ queryKey: ['withdrawals'] });
      onOpenChange(false);
    },
    onError: (e: Error) => {
      if (e instanceof ApiError && e.code === 'SAFETY_OVERRIDE_REQUIRED') setNeedsOverride(e.message);
      else setError(e.message);
    },
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Give medicine now (in clinic)</DialogTitle>
          <DialogDescription>Record a medicine you give here — an injection, a tablet or a vaccine. Checked against the patient’s allergies. Withdrawal periods start automatically for food-producing animals when configured for the product.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {error && <FormError message={error} />}
          {needsOverride && (
            <div className="grid gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3">
              <p className="flex items-center gap-2 text-sm font-medium text-destructive"><ShieldAlert className="h-4 w-4" /> {needsOverride}</p>
              <Input placeholder="Reason for giving despite the alert" value={f.overrideReason} onChange={set('overrideReason')} aria-label="Override reason" />
            </div>
          )}
          <Field label="Product" htmlFor="ad-p" required>
            <ProductPicker id="ad-p" value={product} onChange={(p) => { setProduct(p); if (p) setF((s) => ({ ...s, doseUnit: p.dispensingUnit, route: p.form === 'INJECTION' ? 'SC' : 'PO' })); }} />
          </Field>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Dose" htmlFor="ad-d" required><Input id="ad-d" inputMode="decimal" value={f.dose} onChange={set('dose')} /></Field>
            <Field label="Unit" htmlFor="ad-u"><Input id="ad-u" value={f.doseUnit} onChange={set('doseUnit')} /></Field>
            <Field label="How given" htmlFor="ad-r" help="The way the medicine goes in: by mouth, injection under the skin, into a muscle or a vein, drops, and so on.">
              <NativeSelect id="ad-r" value={f.route} onChange={set('route')}>{ROUTES.map((r) => <option key={r} value={r}>{routeLabel(r)}</option>)}</NativeSelect>
            </Field>
            <Field label="Site" htmlFor="ad-s"><Input id="ad-s" placeholder="e.g. L flank" value={f.site} onChange={set('site')} /></Field>
            <Field label="Expiry" htmlFor="ad-e"><Input id="ad-e" type="date" value={f.expiryDate} onChange={set('expiryDate')} /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={notGiven} onCheckedChange={(v) => setNotGiven(v === true)} /> Dose was NOT given</label>
          {notGiven && <Field label="Reason not given" htmlFor="ad-ng" required><Input id="ad-ng" value={f.reasonNotGiven} onChange={set('reasonNotGiven')} /></Field>}
          <Field label="Notes" htmlFor="ad-n"><Input id="ad-n" value={f.notes} onChange={set('notes')} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!product || !Number(f.dose) || (!!needsOverride && !f.overrideReason.trim())} loading={m.isPending} onClick={() => { setError(null); m.mutate(); }}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
