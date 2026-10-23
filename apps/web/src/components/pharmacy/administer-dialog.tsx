'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { calculateDose, ROUTES } from '@vcms/shared';
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
import { fmtMoney } from '@/lib/format';
import { routeLabel } from '@/lib/labels';
import { useSession } from '@/lib/session';
import type { Product } from '@/lib/types';

/** Records medication given in clinic (injection, in-clinic dose, vaccine). */
export function AdministerDialog({ open, onOpenChange, patientId, encounterId }: { open: boolean; onOpenChange: (o: boolean) => void; patientId: string; encounterId?: string | null }) {
  const qc = useQueryClient();
  const [product, setProduct] = useState<Product | null>(null);
  const [f, setF] = useState({ dose: '', doseUnit: 'mL', route: 'SC', site: '', batchNumber: '', expiryDate: '', notes: '', reasonNotGiven: '', overrideReason: '' });
  const [notGiven, setNotGiven] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsOverride, setNeedsOverride] = useState<string | null>(null);
  const { currency } = useSession();
  /** Amount to bill in the product's selling unit; follows the dose until the user changes it. */
  const [bill, setBill] = useState('');
  const [billTouched, setBillTouched] = useState(false);
  useEffect(() => {
    if (open) {
      setProduct(null);
      setF({ dose: '', doseUnit: 'mL', route: 'SC', site: '', batchNumber: '', expiryDate: '', notes: '', reasonNotGiven: '', overrideReason: '' });
      setNotGiven(false);
      setError(null);
      setNeedsOverride(null);
      setBill('');
      setBillTouched(false);
    }
  }, [open]);
  // The dose in selling units (e.g. 100 mg of a 50 mg tablet = 2 tablets); 1 when it cannot be worked out.
  const suggested = (() => {
    const dose = Number(f.dose);
    if (!product || !(dose > 0)) return null;
    if (f.doseUnit.trim().toLowerCase() === product.dispensingUnit.toLowerCase()) return dose;
    const r = calculateDose({ doseValue: dose, doseUnit: f.doseUnit, strengthValue: product.strengthValue, strengthUnit: product.strengthUnit, dispensingUnit: product.dispensingUnit, increment: Number(product.minDispenseIncrement) || 1, rounding: 'up' });
    return r.ok ? r.amount : 1;
  })();
  useEffect(() => {
    if (!billTouched) setBill(suggested === null ? '' : String(suggested));
  }, [suggested, billTouched]);
  const billQty = bill === '' ? null : Number(bill);
  const price = product?.sellPriceMinor ?? null;
  const m = useMutation({
    mutationFn: () =>
      api.post('/administrations', {
        patientId,
        encounterId,
        productId: product!.id,
        status: notGiven ? 'NOT_GIVEN' : 'GIVEN',
        ...f,
        overrideReason: f.overrideReason || null,
        billQuantity: billQty ?? undefined,
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
          </div>
          {product && !notGiven && (
            <Field
              label="Bill"
              htmlFor="ad-bill"
              help="Added to the client’s bill for this visit. Filled in from the dose; change it if needed, or enter 0 to give it free of charge."
              hint={billQty === 0 ? 'Free of charge — not added to the bill.' : price !== null && billQty ? `${billQty} × ${fmtMoney(price, currency)} = ${fmtMoney(Math.round(price * billQty), currency)}` : price === null ? 'This product has no selling price yet — it is added to the bill at 0.' : undefined}
            >
              <div className="flex items-center gap-2">
                <Input id="ad-bill" className="w-32" inputMode="decimal" value={bill} onChange={(e) => { setBill(e.target.value); setBillTouched(true); }} />
                <span className="text-sm text-muted-foreground">{product.dispensingUnit}</span>
              </div>
            </Field>
          )}
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
