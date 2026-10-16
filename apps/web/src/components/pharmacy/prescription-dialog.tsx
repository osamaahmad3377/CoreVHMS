'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FREQUENCIES, ROUTES } from '@vcms/shared';
import { AlertTriangle, Calculator, Info, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Field } from '../forms/field';
import { FormError } from '../forms/form-error';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input, NativeSelect, Textarea } from '../ui/input';
import { Label } from '../ui/label';
import { ProductPicker, productStrength } from './product-picker';
import { useDebounce } from '@/hooks/use-debounce';
import { ApiError, api } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { DoseEvaluation, Prescription, Product } from '@/lib/types';
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
  instructions: string;
  overrideReason: string;
}

const blankLine = (key: number): Line => ({ key, product: null, route: 'PO', doseValue: '', doseUnit: 'mg/kg', frequencyCode: 'BID', durationDays: '7', quantity: '', repeats: '0', instructions: '', overrideReason: '' });

function doseUnits(p: Product | null) {
  const base = p?.strengthUnit ? [`${p.strengthUnit}/kg`, p.strengthUnit] : [];
  const mass = ['mg/kg', 'mcg/kg', 'IU/kg', 'mL/kg', 'mg', 'mg/animal'];
  return [...new Set([...base, ...mass, ...(p ? [p.dispensingUnit] : [])])];
}

function lineBody(l: Line) {
  return {
    productId: l.product!.id,
    route: l.route,
    doseValue: Number(l.doseValue),
    doseUnit: l.doseUnit,
    frequencyCode: l.frequencyCode,
    durationDays: l.durationDays ? Number(l.durationDays) : null,
    quantity: l.quantity ? Number(l.quantity) : null,
    repeats: Number(l.repeats || 0),
    instructions: l.instructions || autoInstructions(l),
    overrideReason: l.overrideReason || null,
  };
}

function autoInstructions(l: Line) {
  const f = FREQUENCIES.find((x) => x.code === l.frequencyCode);
  return `${l.route === 'PO' ? 'Give by mouth' : `Give ${l.route}`} ${f?.label.toLowerCase() ?? ''}${l.durationDays ? ` for ${l.durationDays} days` : ''}.`;
}

function LineEditor({ line, patientId, weightKg, onChange, onRemove, onEvaluated }: { line: Line; patientId: string; weightKg: number | null; onChange: (l: Line) => void; onRemove?: () => void; onEvaluated: (e: DoseEvaluation | null) => void }) {
  const ready = !!line.product && Number(line.doseValue) > 0;
  const key = useDebounce(JSON.stringify({ ...line, overrideReason: '', weightKg }), 350);
  const ev = useQuery({
    queryKey: ['rx-evaluate', patientId, key],
    queryFn: () => api.post<DoseEvaluation>('/prescriptions/evaluate', { patientId, weightKg, item: lineBody({ ...line, instructions: line.instructions || 'x' }) }),
    enabled: ready,
    retry: false,
  });
  useEffect(() => onEvaluated(ready && ev.data ? ev.data : null), [ev.data, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (patch: Partial<Line>) => onChange({ ...line, ...patch });
  const e = ev.data;
  const err = ev.error instanceof ApiError ? ev.error.message : null;

  return (
    <div className="grid gap-3 rounded-md border p-3">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <ProductPicker value={line.product} prescribable onChange={(p) => set({ product: p, doseUnit: p?.strengthUnit ? `${p.strengthUnit}/kg` : p?.dispensingUnit ?? 'mg/kg', route: p?.form === 'INJECTION' ? 'SC' : p?.form === 'TOPICAL' ? 'TOPICAL' : 'PO' })} />
        </div>
        {onRemove && (
          <Button type="button" size="icon" variant="ghost" aria-label="Remove medicine" onClick={onRemove}>
            <Trash2 />
          </Button>
        )}
      </div>
      {line.product && (
        <>
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
                {ROUTES.map((r) => <option key={r}>{r}</option>)}
              </NativeSelect>
            </div>
            <div className="grid gap-1 sm:col-span-2">
              <Label className="text-xs">Frequency</Label>
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
                  <span className="flex items-center gap-1"><Calculator className="h-3.5 w-3.5" /> {e.calculation.amount} {e.calculation.dispensingUnit} per dose</span>
                  <span className="text-muted-foreground">Supply {e.quantity} {e.calculation.dispensingUnit}</span>
                  {Math.abs(e.calculation.roundingPercent) >= 0.01 && <span className="text-xs text-muted-foreground">rounding {e.calculation.roundingPercent > 0 ? '+' : ''}{e.calculation.roundingPercent.toFixed(1)}%</span>}
                </p>
                <ol className="list-decimal pl-5 text-xs text-muted-foreground">
                  {e.calculation.steps.map((s) => <li key={s}>{s}</li>)}
                </ol>
                {e.warnings.map((w) => (
                  <p key={w.code + w.message} className={cn('flex items-start gap-1.5 text-xs', w.blocking ? 'font-medium text-destructive' : 'text-muted-foreground')}>
                    {w.blocking ? <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />} {w.message}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
          {e?.requiresOverride && (
            <Field label="Reason for overriding the safety warning" htmlFor={`ovr-${line.key}`} required hint="Recorded on the prescription and in the audit log.">
              <Input id={`ovr-${line.key}`} value={line.overrideReason} onChange={(ev) => set({ overrideReason: ev.target.value })} />
            </Field>
          )}
          <div className="grid gap-2 sm:grid-cols-[1fr_110px_90px]">
            <Field label="Label instructions" htmlFor={`ins-${line.key}`}>
              <Input id={`ins-${line.key}`} placeholder={autoInstructions(line)} value={line.instructions} onChange={(ev) => set({ instructions: ev.target.value })} />
            </Field>
            <Field label={`Quantity (${line.product.dispensingUnit})`} htmlFor={`qty-${line.key}`}>
              <Input id={`qty-${line.key}`} inputMode="decimal" placeholder={e ? String(e.quantity) : ''} value={line.quantity} onChange={(ev) => set({ quantity: ev.target.value })} />
            </Field>
            <Field label="Repeats" htmlFor={`rep-${line.key}`}>
              <Input id={`rep-${line.key}`} type="number" min={0} max={12} value={line.repeats} onChange={(ev) => set({ repeats: ev.target.value })} />
            </Field>
          </div>
          <p className="text-2xs text-muted-foreground">Strength: {productStrength(line.product)} · smallest amount {line.product.minDispenseIncrement} {line.product.dispensingUnit}</p>
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
  patient: { id: string; name: string; latestWeightKg: number | null };
  encounterId?: string | null;
  onCreated?: (rx: Prescription) => void;
}) {
  const { can } = useSession();
  const qc = useQueryClient();
  const [weight, setWeight] = useState('');
  const [lines, setLines] = useState<Line[]>([blankLine(1)]);
  const [evals, setEvals] = useState<Record<number, DoseEvaluation | null>>({});
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
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
      api.post<Prescription>('/prescriptions', { patientId: patient.id, encounterId, weightKg, notes, authorize, items: lines.filter((l) => l.product).map(lineBody) }),
    onSuccess: (rx) => {
      toast.success(`${rx.prescriptionNo} ${rx.status === 'AUTHORIZED' ? 'authorised' : 'saved as draft'}`);
      qc.invalidateQueries({ queryKey: ['prescriptions'] });
      qc.invalidateQueries({ queryKey: ['encounter'] });
      onCreated?.(rx);
      onOpenChange(false);
    },
    onError: (e: Error) => setError(e.message),
  });

  const blocked = useMemo(
    () => lines.some((l) => l.product && (!Number(l.doseValue) || !evals[l.key] || (evals[l.key]!.requiresOverride && !l.overrideReason.trim()))),
    [lines, evals],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>Prescribe for {patient.name}</DialogTitle>
          <DialogDescription>Doses are calculated from the body weight and product strength, and checked against allergies, labelled species and approved, sourced dose references.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {error && <FormError message={error} />}
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
