'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DISPENSING_UNITS, DOSAGE_FORMS, PRODUCT_TYPES, SPECIES_CATEGORIES, enumLabel, fromMinor, toMinor } from '@vcms/shared';
import { useState } from 'react';
import { toast } from 'sonner';
import { Field } from '../forms/field';
import { FormError } from '../forms/form-error';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input, NativeSelect, Textarea } from '../ui/input';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { Product } from '@/lib/types';

export function ProductDialog({ product, open, onOpenChange, onSaved }: { product: Product | null; open: boolean; onOpenChange: (o: boolean) => void; onSaved?: (p: Product) => void }) {
  const { currency } = useSession();
  const qc = useQueryClient();
  const [f, setF] = useState({
    name: product?.name ?? '',
    genericName: product?.genericName ?? '',
    sku: product?.sku ?? '',
    barcode: product?.barcode ?? '',
    type: product?.type ?? 'MEDICINE',
    category: product?.category ?? '',
    form: product?.form ?? 'TABLET',
    strengthValue: product?.strengthValue != null ? String(product.strengthValue) : '',
    strengthUnit: product?.strengthUnit ?? 'mg',
    dispensingUnit: product?.dispensingUnit ?? 'tablet',
    minDispenseIncrement: String(product?.minDispenseIncrement ?? 1),
    activeIngredients: product?.activeIngredients.join(', ') ?? '',
    manufacturer: product?.manufacturer ?? '',
    requiresPrescription: product?.requiresPrescription ?? true,
    isControlled: product?.isControlled ?? false,
    controlledSchedule: product?.controlledSchedule ?? '',
    targetSpecies: product?.targetSpecies ?? [],
    price: product?.sellPriceMinor != null ? fromMinor(product.sellPriceMinor, currency) : '',
    notes: product?.notes ?? '',
    isActive: product?.isActive ?? true,
  });
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const { price, activeIngredients, strengthValue, strengthUnit, ...rest } = f;
      const body = {
        ...rest,
        strengthValue: strengthValue === '' ? null : Number(strengthValue),
        strengthUnit: strengthValue === '' ? null : strengthUnit,
        minDispenseIncrement: Number(f.minDispenseIncrement),
        activeIngredients: activeIngredients.split(',').map((s) => s.trim()).filter(Boolean),
        sellPriceMinor: price === '' ? null : toMinor(price, currency),
        form: f.form || null,
      };
      return product ? api.patch<Product>(`/products/${product.id}`, body) : api.post<Product>('/products', body);
    },
    onSuccess: (p) => {
      toast.success('Product saved');
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['product', p.id] });
      onSaved?.(p);
      onOpenChange(false);
    },
    onError: (e: Error) => setError(e.message),
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader><DialogTitle>{product ? `Edit ${product.name}` : 'New product'}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          {error && <FormError message={error} />}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Product name" htmlFor="p-n" required><Input id="p-n" value={f.name} onChange={set('name')} /></Field>
            <Field label="Generic name" htmlFor="p-g"><Input id="p-g" value={f.genericName} onChange={set('genericName')} /></Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Type" htmlFor="p-t"><NativeSelect id="p-t" value={f.type} onChange={set('type')}>{PRODUCT_TYPES.map((t) => <option key={t} value={t}>{enumLabel(t)}</option>)}</NativeSelect></Field>
            <Field label="Form" htmlFor="p-f"><NativeSelect id="p-f" value={f.form ?? ''} onChange={set('form')}><option value="">—</option>{DOSAGE_FORMS.map((t) => <option key={t} value={t}>{enumLabel(t)}</option>)}</NativeSelect></Field>
            <Field label="SKU" htmlFor="p-sku"><Input id="p-sku" value={f.sku} onChange={set('sku')} /></Field>
            <Field label="Barcode" htmlFor="p-bc"><Input id="p-bc" value={f.barcode} onChange={set('barcode')} /></Field>
          </div>
          <fieldset className="grid gap-3 rounded-md border p-3 sm:grid-cols-4">
            <legend className="px-1 text-sm font-medium">Strength & dispensing (used by the dose calculator)</legend>
            <Field label="Strength" htmlFor="p-sv" hint="per ONE dispensing unit"><Input id="p-sv" inputMode="decimal" value={f.strengthValue} onChange={set('strengthValue')} /></Field>
            <Field label="Strength unit" htmlFor="p-su"><NativeSelect id="p-su" value={f.strengthUnit} onChange={set('strengthUnit')}>{['mg', 'mcg', 'g', 'IU', 'mL'].map((u) => <option key={u}>{u}</option>)}</NativeSelect></Field>
            <Field label="Dispensing unit" htmlFor="p-du"><NativeSelect id="p-du" value={f.dispensingUnit} onChange={set('dispensingUnit')}>{DISPENSING_UNITS.map((u) => <option key={u}>{u}</option>)}</NativeSelect></Field>
            <Field label="Smallest amount" htmlFor="p-inc" hint="e.g. 0.25 tablet, 0.1 mL"><Input id="p-inc" inputMode="decimal" value={f.minDispenseIncrement} onChange={set('minDispenseIncrement')} /></Field>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Active ingredients" htmlFor="p-ai" hint="Comma-separated; used for allergy checks"><Input id="p-ai" value={f.activeIngredients} onChange={set('activeIngredients')} /></Field>
            <Field label="Manufacturer" htmlFor="p-m"><Input id="p-m" value={f.manufacturer} onChange={set('manufacturer')} /></Field>
            <Field label={`Price per ${f.dispensingUnit} (${currency})`} htmlFor="p-pr"><Input id="p-pr" inputMode="decimal" value={f.price} onChange={set('price')} /></Field>
          </div>
          <fieldset>
            <legend className="mb-1 text-sm font-medium">Labelled for species groups (leave empty for any)</legend>
            <div className="flex flex-wrap gap-3">
              {SPECIES_CATEGORIES.map((c) => (
                <label key={c} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={f.targetSpecies.includes(c)} onCheckedChange={(v) => setF((s) => ({ ...s, targetSpecies: v === true ? [...s.targetSpecies, c] : s.targetSpecies.filter((x) => x !== c) }))} /> {enumLabel(c)}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2"><Checkbox checked={f.requiresPrescription} onCheckedChange={(v) => setF((s) => ({ ...s, requiresPrescription: v === true }))} /> Prescription-only</label>
            <label className="flex items-center gap-2"><Checkbox checked={f.isControlled} onCheckedChange={(v) => setF((s) => ({ ...s, isControlled: v === true }))} /> Controlled medicine</label>
            {f.isControlled && <Input className="h-8 w-48" placeholder="Schedule / class" value={f.controlledSchedule} onChange={set('controlledSchedule')} aria-label="Controlled schedule" />}
            {product && <label className="flex items-center gap-2"><Checkbox checked={f.isActive} onCheckedChange={(v) => setF((s) => ({ ...s, isActive: v === true }))} /> Active</label>}
          </div>
          <Field label="Notes" htmlFor="p-no"><Textarea id="p-no" rows={2} value={f.notes} onChange={set('notes')} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!f.name.trim() || !(Number(f.minDispenseIncrement) > 0)} loading={save.isPending} onClick={() => { setError(null); save.mutate(); }}>Save product</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
