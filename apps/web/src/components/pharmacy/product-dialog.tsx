'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DISPENSING_UNITS,
  DOSAGE_FORMS,
  PRESCRIBABLE_PRODUCT_TYPES,
  PRODUCT_TYPES,
  PRODUCT_TYPE_LABELS,
  RETAIL_UNITS,
  SPECIES_CATEGORIES,
  enumLabel,
  fromMinor,
  toMinor,
} from '@vcms/shared';
import { ArrowLeft, Bone, Box, Brush, ImagePlus, Package, Pill, Shirt, Sparkles, Syringe, Trash2, Wrench } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Field } from '../forms/field';
import { FormError } from '../forms/form-error';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input, NativeSelect, Textarea } from '../ui/input';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { Product, ProductCategory } from '@/lib/types';
import { cn } from '@/lib/utils';

type ProductType = (typeof PRODUCT_TYPES)[number];
const CLINICAL = new Set<string>(PRESCRIBABLE_PRODUCT_TYPES);
/** Shop items sold at the counter: brand, pack size and a shelf category instead of strength and dose data. */
const SHOP = new Set<string>(['FOOD', 'GROOMING', 'ACCESSORY', 'SUPPLEMENT', 'RETAIL']);

const TYPE_CHOICES: { type: ProductType; icon: React.ComponentType<{ className?: string }>; hint: string }[] = [
  { type: 'FOOD', icon: Bone, hint: 'Dry and wet food, diets, treats, livestock feed' },
  { type: 'GROOMING', icon: Brush, hint: 'Shampoos, brushes, clippers, ear and dental care, litter' },
  { type: 'ACCESSORY', icon: Shirt, hint: 'Collars, leads, toys, beds, carriers, bowls' },
  { type: 'SUPPLEMENT', icon: Sparkles, hint: 'Vitamins, joint and coat supplements' },
  { type: 'RETAIL', icon: Package, hint: 'Anything else sold in the shop' },
  { type: 'MEDICINE', icon: Pill, hint: 'Prescribed and dispensed medicines' },
  { type: 'VACCINE', icon: Syringe, hint: 'Vaccines used in preventive care' },
  { type: 'CONSUMABLE', icon: Box, hint: 'Syringes, dressings and other clinic supplies' },
  { type: 'EQUIPMENT', icon: Wrench, hint: 'Durable equipment' },
];

const NAME_EXAMPLES: Partial<Record<ProductType, string>> = {
  FOOD: 'e.g. Adult dog food, chicken & rice',
  GROOMING: 'e.g. Oatmeal dog shampoo',
  ACCESSORY: 'e.g. Nylon dog collar',
  SUPPLEMENT: 'e.g. Joint support chews',
  RETAIL: 'e.g. Pet travel bag',
};

export function ProductDialog({ product, open, onOpenChange, onSaved, defaultType }: { product: Product | null; open: boolean; onOpenChange: (o: boolean) => void; onSaved?: (p: Product) => void; defaultType?: ProductType }) {
  const { currency, can } = useSession();
  const qc = useQueryClient();
  const [step, setStep] = useState<'type' | 'details'>(product || defaultType ? 'details' : 'type');
  const [f, setF] = useState({
    name: product?.name ?? '',
    genericName: product?.genericName ?? '',
    sku: product?.sku ?? '',
    barcode: product?.barcode ?? '',
    type: (product?.type ?? defaultType ?? 'MEDICINE') as ProductType,
    categoryId: product?.categoryId ?? '',
    brand: product?.brand ?? '',
    packSize: product?.packSize ?? '',
    form: product?.form ?? 'TABLET',
    strengthValue: product?.strengthValue != null ? String(product.strengthValue) : '',
    strengthUnit: product?.strengthUnit ?? 'mg',
    dispensingUnit: product?.dispensingUnit ?? 'tablet',
    minDispenseIncrement: String(product?.minDispenseIncrement ?? 1),
    activeIngredients: product?.activeIngredients.join(', ') ?? '',
    drugClass: product?.drugClass ?? '',
    manufacturer: product?.manufacturer ?? '',
    requiresPrescription: product?.requiresPrescription ?? true,
    isControlled: product?.isControlled ?? false,
    controlledSchedule: product?.controlledSchedule ?? '',
    targetSpecies: product?.targetSpecies ?? [],
    price: product?.sellPriceMinor != null ? fromMinor(product.sellPriceMinor, currency) : '',
    notes: product?.notes ?? '',
    isActive: product?.isActive ?? true,
  });
  /** "Order more when below": saved to the stock settings after the product is created. */
  const [reorderLevel, setReorderLevel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const clinical = CLINICAL.has(f.type);
  const askReorder = !product && can('inventory.write');
  const reorderValid = reorderLevel.trim() === '' || (Number.isFinite(Number(reorderLevel)) && Number(reorderLevel) >= 0);
  const shop = SHOP.has(f.type);
  const categories = useQuery({ queryKey: ['product-categories'], queryFn: () => api.get<ProductCategory[]>('/product-categories'), enabled: open });
  const forType = (categories.data ?? []).filter((c) => !c.productType || c.productType === f.type);
  const units = clinical ? DISPENSING_UNITS : shop ? RETAIL_UNITS : [...new Set([...DISPENSING_UNITS, ...RETAIL_UNITS])];

  const choose = (type: ProductType) => {
    const isClinical = CLINICAL.has(type);
    setF((s) => ({
      ...s,
      type,
      categoryId: '',
      requiresPrescription: isClinical,
      isControlled: false,
      dispensingUnit: isClinical ? (type === 'VACCINE' ? 'dose' : 'tablet') : SHOP.has(type) ? (type === 'FOOD' ? 'bag' : 'piece') : 'unit',
      form: isClinical ? (type === 'VACCINE' ? 'INJECTION' : 'TABLET') : '',
    }));
    setStep('details');
  };

  const save = useMutation({
    mutationFn: () => {
      const { price, activeIngredients, strengthValue, strengthUnit, categoryId, ...rest } = f;
      const body = {
        ...rest,
        categoryId: categoryId || null,
        brand: f.brand || null,
        packSize: f.packSize || null,
        strengthValue: clinical && strengthValue !== '' ? Number(strengthValue) : null,
        strengthUnit: clinical && strengthValue !== '' ? strengthUnit : null,
        minDispenseIncrement: Number(f.minDispenseIncrement),
        activeIngredients: clinical || f.type === 'SUPPLEMENT' ? activeIngredients.split(',').map((s) => s.trim()).filter(Boolean) : [],
        drugClass: clinical ? f.drugClass.trim() || null : null,
        sellPriceMinor: price === '' ? null : toMinor(price, currency),
        form: clinical ? f.form || null : null,
        requiresPrescription: clinical && f.requiresPrescription,
        isControlled: clinical && f.isControlled,
      };
      if (product) return api.patch<Product>(`/products/${product.id}`, body);
      return api.post<Product>('/products', body).then(async (created) => {
        if (askReorder && reorderLevel.trim() !== '') {
          try {
            await api.patch(`/stock/products/${created.id}/settings`, { reorderLevel: Number(reorderLevel) });
          } catch {
            toast.error('Product saved, but the reorder level was not. Set it on the product page.');
          }
        }
        return created;
      });
    },
    onSuccess: (p) => {
      toast.success(product ? 'Product saved' : `${p.name} added`);
      qc.invalidateQueries({ queryKey: ['stock'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['product', p.id] });
      qc.invalidateQueries({ queryKey: ['product-categories'] });
      qc.invalidateQueries({ queryKey: ['pos', 'catalog'] });
      onSaved?.(p);
      onOpenChange(false);
    },
    onError: (e: Error) => setError(e.message),
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>{product ? `Edit ${product.name}` : step === 'type' ? 'What are you adding?' : `New product · ${PRODUCT_TYPE_LABELS[f.type]}`}</DialogTitle>
          {step === 'type' && <DialogDescription>Choose the kind of product. The form then asks only for what that kind needs.</DialogDescription>}
        </DialogHeader>
        {step === 'type' ? (
          <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Product type">
            {TYPE_CHOICES.map(({ type, icon: Icon, hint }) => (
              <button
                key={type}
                type="button"
                role="radio"
                aria-checked={f.type === type}
                onClick={() => choose(type)}
                className="flex items-start gap-3 rounded-lg border p-3 text-left text-sm transition-colors hover:border-primary hover:bg-primary/5"
              >
                <Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <span><span className="block font-medium">{PRODUCT_TYPE_LABELS[type]}</span><span className="text-xs text-muted-foreground">{hint}</span></span>
              </button>
            ))}
          </div>
        ) : (
          <div className="grid gap-3">
            {error && <FormError message={error} />}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Product name" htmlFor="p-n" required><Input id="p-n" value={f.name} onChange={set('name')} placeholder={NAME_EXAMPLES[f.type]} /></Field>
              {clinical ? (
                <Field label="Generic name" htmlFor="p-g"><Input id="p-g" value={f.genericName} onChange={set('genericName')} /></Field>
              ) : (
                <Field label="Brand" htmlFor="p-brand"><Input id="p-brand" value={f.brand} onChange={set('brand')} /></Field>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Type" htmlFor="p-t">
                <NativeSelect id="p-t" value={f.type} onChange={(e) => setF((s) => ({ ...s, type: e.target.value as ProductType, categoryId: '' }))}>
                  {PRODUCT_TYPES.map((t) => <option key={t} value={t}>{PRODUCT_TYPE_LABELS[t]}</option>)}
                </NativeSelect>
              </Field>
              {clinical ? (
                <Field label="Form" htmlFor="p-f"><NativeSelect id="p-f" value={f.form ?? ''} onChange={set('form')}><option value="">—</option>{DOSAGE_FORMS.map((t) => <option key={t} value={t}>{enumLabel(t)}</option>)}</NativeSelect></Field>
              ) : (
                <Field label="Category" htmlFor="p-cat" hint={!forType.length && categories.isSuccess ? 'No categories for this type yet' : undefined}>
                  <NativeSelect id="p-cat" value={f.categoryId} onChange={set('categoryId')}>
                    <option value="">No category</option>
                    {forType.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </NativeSelect>
                </Field>
              )}
              <Field label="SKU" htmlFor="p-sku" help="Your own stock code for this item. Optional — leave it blank if you do not use codes."><Input id="p-sku" value={f.sku} onChange={set('sku')} /></Field>
              <Field label="Barcode" htmlFor="p-bc"><Input id="p-bc" value={f.barcode} onChange={set('barcode')} placeholder="Scan or type" /></Field>
            </div>

            {clinical ? (
              <fieldset className="grid gap-3 rounded-md border p-3 sm:grid-cols-4">
                <legend className="px-1 text-sm font-medium">Strength & what it is given out per (used to work out doses)</legend>
                <Field label="Strength" htmlFor="p-sv" hint="in ONE tablet, mL or pack" help="How much medicine is in a single tablet, capsule or mL. For a 250 mg tablet, type 250 and choose mg. The system uses this to work out each patient’s dose from their weight."><Input id="p-sv" inputMode="decimal" value={f.strengthValue} onChange={set('strengthValue')} /></Field>
                <Field label="Strength unit" htmlFor="p-su"><NativeSelect id="p-su" value={f.strengthUnit} onChange={set('strengthUnit')}>{['mg', 'mcg', 'g', 'IU', 'mL'].map((u) => <option key={u}>{u}</option>)}</NativeSelect></Field>
                <Field label="Given out per" htmlFor="p-du" help="The unit you hand over and count in stock, for example tablet, mL or bottle. Stock levels and prices are all counted in this unit."><NativeSelect id="p-du" value={f.dispensingUnit} onChange={set('dispensingUnit')}>{units.map((u) => <option key={u}>{u}</option>)}</NativeSelect></Field>
                <Field label="Smallest amount" htmlFor="p-inc" hint="e.g. 0.25 tablet, 0.1 mL" help="The smallest piece you can give out. Doses are rounded to this, so a quarter tablet is 0.25."><Input id="p-inc" inputMode="decimal" value={f.minDispenseIncrement} onChange={set('minDispenseIncrement')} /></Field>
              </fieldset>
            ) : (
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Pack / size" htmlFor="p-pack"><Input id="p-pack" value={f.packSize} onChange={set('packSize')} placeholder="e.g. 3 kg bag, 400 g can, Medium" /></Field>
                <Field label="Sold per" htmlFor="p-du">
                  <NativeSelect id="p-du" value={f.dispensingUnit} onChange={set('dispensingUnit')}>
                    {[...new Set([f.dispensingUnit, ...units])].map((u) => <option key={u}>{u}</option>)}
                  </NativeSelect>
                </Field>
                {!shop && <Field label="Manufacturer" htmlFor="p-m"><Input id="p-m" value={f.manufacturer} onChange={set('manufacturer')} /></Field>}
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-3">
              {(clinical || f.type === 'SUPPLEMENT') && (
                <Field label={clinical ? 'Active ingredients' : 'Main ingredients'} htmlFor="p-ai" hint={clinical ? 'Separate with commas; used for allergy checks' : 'Separate with commas'} help={clinical ? 'The active medicine inside this product, e.g. amoxicillin. If a patient is allergic to an ingredient, the system warns you.' : undefined}>
                  <Input id="p-ai" value={f.activeIngredients} onChange={set('activeIngredients')} />
                </Field>
              )}
              {clinical && (
                <Field label="Medicine family" htmlFor="p-dc" hint="e.g. Penicillins, Cephalosporins, NSAIDs" help="Medicines in the same family often cause the same allergic reaction. If a patient is allergic to one, the system warns you before you prescribe another from this family.">
                  <Input id="p-dc" value={f.drugClass} onChange={set('drugClass')} />
                </Field>
              )}
              {clinical && <Field label="Manufacturer" htmlFor="p-m"><Input id="p-m" value={f.manufacturer} onChange={set('manufacturer')} /></Field>}
              <Field label={`Price per ${f.dispensingUnit} (${currency === 'PKR' ? 'Rs' : currency})`} htmlFor="p-pr" hint={shop && !f.price ? 'Needed to sell it at the shop counter' : undefined}>
                <Input id="p-pr" inputMode="decimal" value={f.price} onChange={set('price')} />
              </Field>
              {askReorder && (
                <Field label={`Order more when below (${f.dispensingUnit})`} htmlFor="p-reorder" hint="Leave blank if you don't want a low-stock warning" help="When stock falls below this number, the item shows on the low-stock list so you can order more in time." error={reorderValid ? undefined : 'Enter a number'}>
                  <Input id="p-reorder" inputMode="decimal" value={reorderLevel} onChange={(e) => setReorderLevel(e.target.value)} />
                </Field>
              )}
            </div>
            <fieldset>
              <legend className="mb-1 text-sm font-medium">{clinical ? 'Labelled for species groups (leave empty for any)' : 'Suitable for (leave empty for any)'}</legend>
              <div className="flex flex-wrap gap-3">
                {SPECIES_CATEGORIES.map((c) => (
                  <label key={c} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={f.targetSpecies.includes(c)} onCheckedChange={(v) => setF((s) => ({ ...s, targetSpecies: v === true ? [...s.targetSpecies, c] : s.targetSpecies.filter((x) => x !== c) }))} /> {enumLabel(c)}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex flex-wrap items-center gap-4 text-sm">
              {clinical && (
                <>
                  <label className="flex items-center gap-2"><Checkbox checked={f.requiresPrescription} onCheckedChange={(v) => setF((s) => ({ ...s, requiresPrescription: v === true }))} /> Prescription-only</label>
                  <label className="flex items-center gap-2"><Checkbox checked={f.isControlled} onCheckedChange={(v) => setF((s) => ({ ...s, isControlled: v === true }))} /> Controlled medicine</label>
                  {f.isControlled && <Input className="h-8 w-48" placeholder="Schedule / class" value={f.controlledSchedule} onChange={set('controlledSchedule')} aria-label="Controlled schedule" />}
                </>
              )}
              {product && <label className="flex items-center gap-2"><Checkbox checked={f.isActive} onCheckedChange={(v) => setF((s) => ({ ...s, isActive: v === true }))} /> Active</label>}
            </div>
            {product && can('inventory.write') && <ProductPhoto product={product} />}
            <Field label="Notes" htmlFor="p-no"><Textarea id="p-no" rows={2} value={f.notes} onChange={set('notes')} /></Field>
          </div>
        )}
        <DialogFooter>
          {step === 'details' && !product && !defaultType && <Button variant="outline" className="mr-auto" onClick={() => setStep('type')}><ArrowLeft /> Change type</Button>}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {step === 'details' && (
            <Button disabled={!f.name.trim() || !(Number(f.minDispenseIncrement) > 0) || !reorderValid} loading={save.isPending} onClick={() => { setError(null); save.mutate(); }}>Save product</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Photo shown on the shop counter tile; uploaded as an attachment of the product. */
function ProductPhoto({ product }: { product: Product }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [photoId, setPhotoId] = useState(product.photoAttachmentId);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['products'] });
    qc.invalidateQueries({ queryKey: ['product', product.id] });
    qc.invalidateQueries({ queryKey: ['pos', 'catalog'] });
  };
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append('entityType', 'Product');
      fd.append('entityId', product.id);
      fd.append('category', 'photo');
      fd.append('file', file);
      const a = await api.upload<{ id: string }>('/attachments', fd);
      await api.post(`/products/${product.id}/photo`, { attachmentId: a.id });
      return a.id;
    },
    onSuccess: (id) => { setPhotoId(id); refresh(); toast.success('Photo saved'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: () => api.post(`/products/${product.id}/photo`, { attachmentId: null }),
    onSuccess: () => { setPhotoId(null); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="flex items-center gap-3 rounded-md border p-3">
      <div className={cn('flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted', !photoId && 'text-muted-foreground')}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {photoId ? <img src={`/api/v1/attachments/${photoId}/download?inline=1`} alt={`Photo of ${product.name}`} className="h-full w-full object-cover" /> : <Package className="h-6 w-6" />}
      </div>
      <div className="grid gap-1">
        <p className="text-sm font-medium">Photo</p>
        <p className="text-xs text-muted-foreground">Shown on the shop counter. JPEG or PNG.</p>
        <div className="flex gap-2">
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" aria-label="Product photo file" onChange={(e) => { const file = e.target.files?.[0]; if (file) upload.mutate(file); e.target.value = ''; }} />
          <Button type="button" size="sm" variant="outline" loading={upload.isPending} onClick={() => input.current?.click()}><ImagePlus /> {photoId ? 'Replace' : 'Add photo'}</Button>
          {photoId && <Button type="button" size="sm" variant="ghost" loading={remove.isPending} onClick={() => remove.mutate()}><Trash2 /> Remove</Button>}
        </div>
      </div>
    </div>
  );
}
