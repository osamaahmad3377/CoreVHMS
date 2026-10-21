'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FREQUENCIES, ROUTES, allergyConflictText, allergyConflicts, ownerInstructions } from '@vcms/shared';
import { AlertTriangle, Calculator, Info, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Field } from '../forms/field';
import { FormError } from '../forms/form-error';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input, NativeSelect, Textarea } from '../ui/input';
import { Label } from '../ui/label';
import { ProductPicker, productStrength } from './product-picker';
import { useDebounce } from '@/hooks/use-debounce';
import { ApiError, api } from '@/lib/api';
import { qtyUnit, routeLabel } from '@/lib/labels';
import { useSession } from '@/lib/session';
import type { AlertSummary, DoseEvaluation, Prescription, Product } from '@/lib/types';
import { cn } from '@/lib/utils';

interface Line {
  key: number;
  product: Product | null;
  route: string;
  doseValue: string;
  doseUnit: string;
  frequencyCode: string;
  durationDays: string;
  quantity: string;
  repeats: string;
  /** Owner label text; null = the automatic sentence. */
  instructions: string | null;
  overrideReason: string;
  /** The prescriber confirmed a large number of tablets/units per dose. */
  confirmedLarge: boolean;
}

const blankLine = (key: number): Line => ({ key, product: null, route: 'PO', doseValue: '', doseUnit: 'mg/kg', frequencyCode: 'BID', durationDays: '7', quantity: '', repeats: '0', instructions: null, overrideReason: '', confirmedLarge: false });

function doseUnits(p: Product | null) {
  const base = p?.strengthUnit ? [`${p.strengthUnit}/kg`, p.strengthUnit] : [];
  const mass = ['mg/kg', 'mcg/kg', 'IU/kg', 'mL/kg', 'mg', 'mg/animal'];
  return [...new Set([...base, ...mass, ...(p ? [p.dispensingUnit] : [])])];
}

/** "Give 1 tablet by mouth 2 times a day for 7 days." — plain words, no Latin abbreviations (printed on the label). */
function autoInstructions(l: Line, ev?: DoseEvaluation | null) {
  return ownerInstructions({ amount: ev?.calculation.amount, unit: ev?.calculation.dispensingUnit ?? l.product?.dispensingUnit, route: l.route, frequencyCode: l.frequencyCode, durationDays: l.durationDays ? Number(l.durationDays) : null });
}

function lineBody(l: Line, ev?: DoseEvaluation | null) {
  return {
    productId: l.product!.id,
    route: l.route,
    doseValue: Number(l.doseValue),
    doseUnit: l.doseUnit,
    frequencyCode: l.frequencyCode,
    durationDays: l.durationDays ? Number(l.durationDays) : null,
    quantity: l.quantity ? Number(l.quantity) : null,
    repeats: Number(l.repeats || 0),
    instructions: l.instructions?.trim() || autoInstructions(l, ev),
    overrideReason: l.overrideReason || null,
  };
}

/** "Rounded up: gives 11% more than you asked". */
function roundingText(pct: number) {
  const n = Math.abs(pct) >= 1 ? Math.round(Math.abs(pct)) : Math.round(Math.abs(pct) * 10) / 10;
  return pct > 0 ? `Rounded up: gives ${n}% more than you asked` : `Rounded down: gives ${n}% less than you asked`;
}

/** Red strip with the patient's allergy and medication alerts, shown above everything else. */
export function AllergyStrip({ alerts }: { alerts: AlertSummary[] }) {
  const list = alerts.filter((a) => a.type === 'ALLERGY' || a.type === 'MEDICATION');
  if (!list.length) return null;
  return (
    <p role="alert" className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive">
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        ⚠ Allergies: {list.map((a) => `${a.substance || a.title}${a.reaction ? ` (${a.reaction})` : ''}`).join('; ')}
      </span>
    </p>
  );
}

function LineEditor({ line, patientId, weightKg, alerts, onChange, onRemove, onEvaluated }: { line: Line; patientId: string; weightKg: number | null; alerts: AlertSummary[]; onChange: (l: Line) => void; onRemove?: () => void; onEvaluated: (e: DoseEvaluation | null) => void }) {
  const ready = !!line.product && Number(line.doseValue) > 0;
  const key = useDebounce(JSON.stringify({ ...line, overrideReason: '', instructions: null, confirmedLarge: false, weightKg }), 350);
  const ev = useQuery({
    queryKey: ['rx-evaluate', patientId, key],
    queryFn: () => api.post<DoseEvaluation>('/prescriptions/evaluate', { patientId, weightKg, item: lineBody({ ...line, instructions: 'x' }) }),
    enabled: ready,
    retry: false,
  });
  useEffect(() => onEvaluated(ready && ev.data ? ev.data : null), [ev.data, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  // A new product or dose needs a fresh confirmation of a large amount per dose.
  const set = (patch: Partial<Line>) => onChange({ ...line, ...patch, ...('product' in patch || 'doseValue' in patch || 'doseUnit' in patch ? { confirmedLarge: false } : {}) });
  const e = ready ? ev.data : undefined;
  const err = ev.error instanceof ApiError ? ev.error.message : null;
  // Warn as soon as the product is picked; the full check (with override) runs once a dose is entered.
  const conflicts = line.product ? allergyConflicts(alerts, line.product) : [];
  const noReference = e?.warnings.find((w) => w.code === 'NO_REFERENCE');
  const otherWarnings = e?.warnings.filter((w) => w.code !== 'ALLERGY' && w.code !== 'NO_REFERENCE') ?? [];
  const auto = autoInstructions(line, e);

  return (
    <div className="grid gap-3 rounded-lg surface-flat p-3">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <ProductPicker value={line.product} prescribable alerts={alerts} onChange={(p) => set({ product: p, doseUnit: p?.strengthUnit ? `${p.strengthUnit}/kg` : p?.dispensingUnit ?? 'mg/kg', route: p?.form === 'INJECTION' ? 'SC' : p?.form === 'TOPICAL' ? 'TOPICAL' : 'PO' })} />
        </div>
        {onRemove && (
          <Button type="button" size="icon" variant="ghost" aria-label="Remove medicine" onClick={onRemove}>
            <Trash2 />
          </Button>
        )}
      </div>
      {line.product && (
        <>
          {!!conflicts.length && (
            <div role="alert" className="grid gap-1 rounded-md border-2 border-destructive bg-destructive/10 p-3 text-sm text-destructive">
              <p className="flex items-center gap-2 font-semibold"><ShieldAlert className="h-4 w-4 shrink-0" /> Allergy warning — do not give unless you are sure</p>
              {conflicts.map((c) => (
                <p key={c.alert.id}>{allergyConflictText(c, line.product!.name)}{c.alert.reaction ? ` (reaction: ${c.alert.reaction})` : ''}.</p>
              ))}
              <p className="text-xs">Choose a different medicine, or write why it is safe in “Reason for overriding the safety warning” below.</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
            <div className="grid gap-1 sm:col-span-1">
              <Label className="text-xs">Dose</Label>
              <Input inputMode="decimal" className="h-8" value={line.doseValue} onChange={(ev) => set({ doseValue: ev.target.value })} aria-label="Dose value" />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">Unit</Label>
              <NativeSelect className="h-8 text-xs" value={line.doseUnit} onChange={(ev) => set({ doseUnit: ev.target.value })} aria-label="Dose unit">
                {doseUnits(line.product).map((u) => <option key={u}>{u}</option>)}
              </NativeSelect>
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">Route</Label>
              <NativeSelect className="h-8 text-xs" value={line.route} onChange={(ev) => set({ route: ev.target.value })} aria-label="Route">
                {ROUTES.map((r) => <option key={r} value={r}>{routeLabel(r)}</option>)}
              </NativeSelect>
            </div>
            <div className="grid gap-1 sm:col-span-2">
              <Label className="text-xs">How often</Label>
              <NativeSelect className="h-8 text-xs" value={line.frequencyCode} onChange={(ev) => set({ frequencyCode: ev.target.value })} aria-label="Frequency">
                {FREQUENCIES.map((f) => <option key={f.code} value={f.code}>{f.label}</option>)}
              </NativeSelect>
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">Days</Label>
              <Input type="number" min={1} className="h-8" value={line.durationDays} onChange={(ev) => set({ durationDays: ev.target.value })} aria-label="Duration days" />
            </div>
          </div>
          <div className="rounded-md bg-muted/60 p-2.5 text-sm">
            {!ready ? (
              <p className="text-xs text-muted-foreground">Enter a dose to calculate.</p>
            ) : ev.isFetching && !e ? (
              <p className="text-xs text-muted-foreground">Calculating…</p>
            ) : err ? (
              <p className="flex items-center gap-1.5 text-xs font-medium text-destructive"><AlertTriangle className="h-3.5 w-3.5" /> {err}</p>
            ) : e ? (
              <div className="grid gap-1.5">
                <p className="flex flex-wrap items-center gap-x-3 font-medium">
                  <span className="flex items-center gap-1"><Calculator className="h-3.5 w-3.5" /> {qtyUnit(e.calculation.amount, e.calculation.dispensingUnit)} per dose</span>
                  <span className="text-muted-foreground">Supply {qtyUnit(e.quantity, e.calculation.dispensingUnit)}</span>
                  {Math.abs(e.calculation.roundingPercent) >= 0.05 && <span className="text-xs text-muted-foreground">{roundingText(e.calculation.roundingPercent)}</span>}
                </p>
                <ol className="list-decimal pl-5 text-xs text-muted-foreground">
                  {e.calculation.steps.map((s) => <li key={s}>{s}</li>)}
                </ol>
                {otherWarnings.map((w) => (
                  <p key={w.code + w.message} className={cn('flex items-start gap-1.5 text-xs', w.blocking ? 'font-medium text-destructive' : 'text-muted-foreground')}>
                    {w.blocking ? <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />} {w.message}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
          {noReference && (
            <p role="status" className="flex items-start gap-2 rounded-md border border-warning/50 bg-warning/10 p-2.5 text-sm text-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              {noReference.message}
            </p>
          )}
          {e?.largeDose && (
            <label className="flex items-start gap-2 rounded-md border border-warning/50 bg-warning/10 p-2.5 text-sm font-medium">
              <Checkbox className="mt-0.5" checked={line.confirmedLarge} onCheckedChange={(v) => onChange({ ...line, confirmedLarge: v === true })} aria-label="Yes, the amount per dose is correct" />
              <span>
                This is {qtyUnit(e.largeDose.amount, e.largeDose.unit)} per dose — is that correct?
                <span className="block text-xs font-normal text-muted-foreground">Tick to confirm. Your clinic asks for this above {qtyUnit(e.largeDose.confirmAbove, e.largeDose.unit)} per dose.</span>
              </span>
            </label>
          )}
          {e?.requiresOverride && (
            <Field label="Reason for overriding the safety warning" htmlFor={`ovr-${line.key}`} required hint="Recorded on the prescription and in the audit log.">
              <Input id={`ovr-${line.key}`} value={line.overrideReason} onChange={(ev) => set({ overrideReason: ev.target.value })} />
            </Field>
          )}
          <div className="grid gap-2 sm:grid-cols-[1fr_110px_90px]">
            <Field
              label="Instructions printed on the label for the client"
              htmlFor={`ins-${line.key}`}
              hint={
                <>
                  This text is printed on the label.
                  {line.instructions !== null && (
                    <button type="button" className="ml-1 text-primary hover:underline" onClick={() => set({ instructions: null })}>
                      Use the automatic text
                    </button>
                  )}
                </>
              }
            >
              <Textarea id={`ins-${line.key}`} rows={2} value={line.instructions ?? auto} onChange={(ev) => set({ instructions: ev.target.value })} />
            </Field>
            <Field label={`Quantity (${line.product.dispensingUnit})`} htmlFor={`qty-${line.key}`}>
              <Input id={`qty-${line.key}`} inputMode="decimal" placeholder={e ? String(e.quantity) : ''} value={line.quantity} onChange={(ev) => set({ quantity: ev.target.value })} />
            </Field>
            <Field label="Repeats" htmlFor={`rep-${line.key}`} help="How many extra times the client can collect this medicine without a new visit. 0 means a single supply.">
              <Input id={`rep-${line.key}`} type="number" min={0} max={12} value={line.repeats} onChange={(ev) => set({ repeats: ev.target.value })} />
            </Field>
          </div>
          <p className="text-2xs text-muted-foreground">
            Strength: {productStrength(line.product)} · smallest amount {line.product.minDispenseIncrement} {line.product.dispensingUnit}
            {line.product.drugClass && ` · drug family: ${line.product.drugClass}`}
          </p>
        </>
      )}
    </div>
  );
}

export function PrescriptionDialog({
  open,
  onOpenChange,
  patient,
  encounterId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Pass `alerts` (as the consultation's patient has them) to warn about allergies as soon as a product is picked. */
  patient: { id: string; name: string; latestWeightKg: number | null; alerts?: AlertSummary[] };
  encounterId?: string | null;
  onCreated?: (rx: Prescription) => void;
}) {
  const { can } = useSession();
  const qc = useQueryClient();
  const [weight, setWeight] = useState('');
  const [lines, setLines] = useState<Line[]>([blankLine(1)]);
  const [evals, setEvals] = useState<Record<number, DoseEvaluation | null>>({});
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (open) {
      setWeight(patient.latestWeightKg ? String(patient.latestWeightKg) : '');
      setLines([blankLine(Date.now())]);
      setEvals({});
      setNotes('');
      setError(null);
    }
  }, [open, patient.latestWeightKg]);
  const weightKg = weight ? Number(weight) : null;

  const save = useMutation({
    mutationFn: (authorize: boolean) =>
      api.post<Prescription>('/prescriptions', { patientId: patient.id, encounterId, weightKg, notes, authorize, items: lines.filter((l) => l.product).map((l) => lineBody(l, evals[l.key])) }),
    onSuccess: (rx) => {
      toast.success(`${rx.prescriptionNo} ${rx.status === 'AUTHORIZED' ? 'authorised' : 'saved as draft'}`);
      qc.invalidateQueries({ queryKey: ['prescriptions'] });
      qc.invalidateQueries({ queryKey: ['encounter'] });
      onCreated?.(rx);
      onOpenChange(false);
    },
    onError: (e: Error) => setError(e),
  });

  const blocked = useMemo(
    () =>
      lines.some(
        (l) => l.product && (!Number(l.doseValue) || !evals[l.key] || (evals[l.key]!.requiresOverride && !l.overrideReason.trim()) || (!!evals[l.key]!.largeDose && !l.confirmedLarge)),
      ),
    [lines, evals],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>Prescribe for {patient.name}</DialogTitle>
          <DialogDescription>
            Doses are calculated from the body weight and the medicine’s strength. Checked against allergies by medicine name, ingredient and drug family, and against the species and dose ranges your clinic has approved.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <AllergyStrip alerts={patient.alerts ?? []} />
          {!!error && <FormError error={error} />}
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Body weight used (kg)" htmlFor="rx-weight" hint={patient.latestWeightKg ? `Latest recorded: ${patient.latestWeightKg} kg` : 'No weight on record'} className="w-48">
              <Input id="rx-weight" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} />
            </Field>
          </div>
          {lines.map((l, i) => (
            <LineEditor
              key={l.key}
              line={l}
              patientId={patient.id}
              weightKg={weightKg}
              alerts={patient.alerts ?? []}
              onChange={(nl) => setLines(lines.map((x, j) => (j === i ? nl : x)))}
              onRemove={lines.length > 1 ? () => setLines(lines.filter((_, j) => j !== i)) : undefined}
              onEvaluated={(e) => setEvals((s) => ({ ...s, [l.key]: e }))}
            />
          ))}
          <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => setLines([...lines, blankLine(Date.now())])}>
            <Plus /> Add another medicine
          </Button>
          <Field label="Notes for the dispensary" htmlFor="rx-notes">
            <Textarea id="rx-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="outline" disabled={blocked || !lines.some((l) => l.product)} loading={save.isPending && save.variables === false} onClick={() => { setError(null); save.mutate(false); }}>
            Save draft
          </Button>
          {can('prescriptions.authorize') && (
            <Button disabled={blocked || !lines.some((l) => l.product)} loading={save.isPending && save.variables === true} onClick={() => { setError(null); save.mutate(true); }}>
              Authorise prescription
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
