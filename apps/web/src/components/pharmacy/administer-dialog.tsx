'use client';
import { useQueryClient } from '@tanstack/react-query';
import { calculateDose, ROUTES } from '@vcms/shared';
import { PackageX, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
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

interface Line {
  key: number;
  product: Product | null;
  dose: string;
  doseUnit: string;
  route: string;
  site: string;
  notes: string;
  notGiven: boolean;
  reasonNotGiven: string;
  overrideReason: string;
  /** Amount to bill in the product's selling unit; follows the dose until the user changes it. */
  bill: string;
  billTouched: boolean;
  error: string | null;
  needsOverride: string | null;
  /** Set when stock shows not enough of the product: what the stock shows. */
  stockShort: string | null;
  stockOverrideReason: string;
}

const blank = (key: number): Line => ({
  key,
  product: null,
  dose: '',
  doseUnit: 'mL',
  route: 'SC',
  site: '',
  notes: '',
  notGiven: false,
  reasonNotGiven: '',
  overrideReason: '',
  bill: '',
  billTouched: false,
  error: null,
  needsOverride: null,
  stockShort: null,
  stockOverrideReason: '',
});

/** The dose in selling units (e.g. 100 mg of a 50 mg tablet = 2 tablets); 1 when it cannot be worked out. */
function suggestedBill(l: Line): number | null {
  const dose = Number(l.dose);
  const p = l.product;
  if (!p || !(dose > 0)) return null;
  if (l.doseUnit.trim().toLowerCase() === p.dispensingUnit.toLowerCase()) return dose;
  const r = calculateDose({ doseValue: dose, doseUnit: l.doseUnit, strengthValue: p.strengthValue, strengthUnit: p.strengthUnit, dispensingUnit: p.dispensingUnit, increment: Number(p.minDispenseIncrement) || 1, rounding: 'up' });
  return r.ok ? r.amount : 1;
}
const billText = (l: Line) => (l.billTouched ? l.bill : String(suggestedBill(l) ?? ''));

const lineReady = (l: Line) => !!l.product && Number(l.dose) > 0 && (!l.notGiven || !!l.reasonNotGiven.trim()) && (!l.needsOverride || !!l.overrideReason.trim()) && (!l.stockShort || !!l.stockOverrideReason.trim());
const amount = (n: number) => String(Math.round(n * 100) / 100);
/** "Only 2 vials in stock, 3 needed" from the stock error's details. */
function stockText(l: Line, details: unknown) {
  const d = (details ?? {}) as { available?: number; required?: number };
  const unit = l.product?.dispensingUnit ?? '';
  if (typeof d.available !== 'number') return `Not enough ${l.product?.name ?? 'of this medicine'} in stock.`;
  return `Only ${amount(Math.max(d.available, 0))} ${unit} of ${l.product?.name} in stock${typeof d.required === 'number' ? `, ${amount(d.required)} needed` : ''}.`;
}
const lineEmpty = (l: Line) => !l.product && !l.dose.trim();

/** Records medicines given in clinic (injections, in-clinic doses, vaccines) — one or several at once. */
export function AdministerDialog({ open, onOpenChange, patientId, encounterId }: { open: boolean; onOpenChange: (o: boolean) => void; patientId: string; encounterId?: string | null }) {
  const qc = useQueryClient();
  const nextKey = useRef(1);
  const [lines, setLines] = useState<Line[]>([blank(0)]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      nextKey.current = 1;
      setLines([blank(0)]);
      setSaving(false);
    }
  }, [open]);

  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const add = () => setLines((ls) => [...ls, blank(nextKey.current++)]);
  const remove = (key: number) => setLines((ls) => ls.filter((l) => l.key !== key));

  // Rows left completely empty are ignored; every other row must be complete.
  const toSave = lines.filter((l) => !lineEmpty(l));
  const canSave = toSave.length > 0 && toSave.every(lineReady);

  async function save() {
    setSaving(true);
    let saved = 0;
    let notGiven = 0;
    for (const l of toSave) {
      update(l.key, { error: null });
      const billQty = l.notGiven ? undefined : billText(l) === '' ? undefined : Number(billText(l));
      try {
        await api.post('/administrations', {
          patientId,
          encounterId,
          productId: l.product!.id,
          status: l.notGiven ? 'NOT_GIVEN' : 'GIVEN',
          dose: l.dose,
          doseUnit: l.doseUnit,
          route: l.route,
          site: l.site,
          batchNumber: '',
          expiryDate: '',
          notes: l.notes,
          reasonNotGiven: l.reasonNotGiven,
          overrideReason: l.overrideReason || null,
          stockOverrideReason: l.stockShort ? l.stockOverrideReason : null,
          billQuantity: billQty,
        });
        saved++;
        if (l.notGiven) notGiven++;
        // Saved rows leave the list, so trying again never records them twice.
        setLines((ls) => ls.filter((x) => x.key !== l.key));
      } catch (e) {
        if (e instanceof ApiError && e.code === 'SAFETY_OVERRIDE_REQUIRED') update(l.key, { needsOverride: e.message });
        else if (e instanceof ApiError && e.code === 'INSUFFICIENT_STOCK') update(l.key, { stockShort: stockText(l, e.details) });
        else update(l.key, { error: (e as Error).message });
        break;
      }
    }
    if (saved) {
      qc.invalidateQueries({ queryKey: ['administrations'] });
      qc.invalidateQueries({ queryKey: ['withdrawals'] });
      const given = saved - notGiven;
      toast.success(
        [given && `${given} medicine${given === 1 ? '' : 's'} recorded as given`, notGiven && `${notGiven} recorded as not given`].filter(Boolean).join(', '),
      );
    }
    setSaving(false);
    if (saved === toSave.length) onOpenChange(false);
    else setLines((ls) => (ls.length ? ls : [blank(nextKey.current++)]));
  }

  const count = toSave.length;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Give medicine now (in clinic)</DialogTitle>
          <DialogDescription>Record what you give here — injections, tablets or vaccines. Add as many as you need. Each is checked against the patient’s allergies.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {lines.map((l, i) => (
            <MedicineRow key={l.key} line={l} index={i} many={lines.length > 1} onChange={(patch) => update(l.key, patch)} onRemove={() => remove(l.key)} />
          ))}
          <Button type="button" variant="outline" className="justify-self-start" onClick={add}>
            <Plus /> Add another medicine
          </Button>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!canSave} loading={saving} onClick={save}>
            {count > 1 ? `Save ${count} medicines` : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MedicineRow({ line: l, index, many, onChange, onRemove }: { line: Line; index: number; many: boolean; onChange: (patch: Partial<Line>) => void; onRemove: () => void }) {
  const { currency } = useSession();
  const id = (k: string) => `ad-${k}-${l.key}`;
  const bill = billText(l);
  const billQty = bill === '' ? null : Number(bill);
  const price = l.product?.sellPriceMinor ?? null;
  const set = (k: 'dose' | 'doseUnit' | 'route' | 'site' | 'notes' | 'reasonNotGiven' | 'overrideReason' | 'stockOverrideReason') => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => onChange({ [k]: e.target.value });
  const label = many ? `Medicine ${index + 1}` : undefined;

  const body = (
    <div className="grid gap-3">
      {l.error && <FormError message={l.error} />}
      {l.needsOverride && (
        <div className="grid gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3">
          <p className="flex items-center gap-2 text-sm font-medium text-destructive"><ShieldAlert className="h-4 w-4" /> {l.needsOverride}</p>
          <Input placeholder="Reason for giving despite the alert" value={l.overrideReason} onChange={set('overrideReason')} aria-label="Override reason" />
        </div>
      )}
      {l.stockShort && (
        <div className="grid gap-2 rounded-md border border-warning/40 bg-warning/10 p-3">
          <p className="flex items-start gap-2 text-sm font-medium"><PackageX className="mt-0.5 h-4 w-4 shrink-0 text-warning" /> <span>{l.stockShort} You can still record it as given — the stock will show the shortfall until it is received or counted.</span></p>
          <Input placeholder="Reason, e.g. stock not entered yet" value={l.stockOverrideReason} onChange={set('stockOverrideReason')} aria-label="Reason for giving without stock" />
        </div>
      )}
      <Field label="Product" htmlFor={id('p')} required>
        <ProductPicker
          id={id('p')}
          value={l.product}
          onChange={(p) => onChange(p ? { product: p, doseUnit: p.dispensingUnit, route: p.form === 'INJECTION' ? 'SC' : 'PO', needsOverride: null, overrideReason: '', stockShort: null, stockOverrideReason: '' } : { product: null, stockShort: null })}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Dose" htmlFor={id('d')} required><Input id={id('d')} inputMode="decimal" value={l.dose} onChange={set('dose')} /></Field>
        <Field label="Unit" htmlFor={id('u')}><Input id={id('u')} value={l.doseUnit} onChange={set('doseUnit')} /></Field>
        <Field label="How given" htmlFor={id('r')} help="The way the medicine goes in: by mouth, injection under the skin, into a muscle or a vein, drops, and so on.">
          <NativeSelect id={id('r')} value={l.route} onChange={set('route')}>{ROUTES.map((r) => <option key={r} value={r}>{routeLabel(r)}</option>)}</NativeSelect>
        </Field>
        <Field label="Site" htmlFor={id('s')}><Input id={id('s')} placeholder="e.g. L flank" value={l.site} onChange={set('site')} /></Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-[11rem_minmax(0,1fr)]">
        {l.product && !l.notGiven && (
          <Field
            label="Bill"
            htmlFor={id('bill')}
            help="Added to the client’s bill for this visit. Filled in from the dose; change it if needed, or enter 0 to give it free of charge."
            hint={billQty === 0 ? 'Free of charge — not added to the bill.' : price !== null && billQty ? `${billQty} × ${fmtMoney(price, currency)} = ${fmtMoney(Math.round(price * billQty), currency)}` : price === null ? 'This product has no selling price yet — it is added to the bill at 0.' : undefined}
          >
            <div className="flex items-center gap-2">
              <Input id={id('bill')} className="w-32" inputMode="decimal" value={bill} onChange={(e) => onChange({ bill: e.target.value, billTouched: true })} />
              <span className="text-sm text-muted-foreground">{l.product.dispensingUnit}</span>
            </div>
          </Field>
        )}
        <Field className={l.product && !l.notGiven ? undefined : 'sm:col-span-2'} label="Notes" htmlFor={id('n')}><Input id={id('n')} value={l.notes} onChange={set('notes')} /></Field>
      </div>
      <label className="flex items-center gap-2 text-sm"><Checkbox checked={l.notGiven} onCheckedChange={(v) => onChange({ notGiven: v === true })} /> Dose was NOT given</label>
      {l.notGiven && <Field label="Reason not given" htmlFor={id('ng')} required><Input id={id('ng')} value={l.reasonNotGiven} onChange={set('reasonNotGiven')} /></Field>}
    </div>
  );

  if (!many) return body;
  return (
    <section aria-label={label} className="grid gap-3 rounded-xl border border-border/80 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">
          {label}
          {l.product && <span className="font-normal text-muted-foreground"> · {l.product.name}</span>}
        </h3>
        <Button type="button" size="icon-sm" variant="ghost" aria-label={`Remove ${label}`} onClick={onRemove}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      {body}
    </section>
  );
}
