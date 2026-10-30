'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { WELLNESS_MAX_MONTHS, fromMinor } from '@vcms/shared';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { MoneyInput, parseMoney } from '../billing/money';
import { Field } from '../forms/field';
import { FormError } from '../forms/form-error';
import { ProductPicker } from '../pharmacy/product-picker';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input, NativeSelect, Textarea } from '../ui/input';
import { api } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { LabTest, Product, Service, Species, TaxRate, WellnessPlan } from '@/lib/types';

interface ItemRow {
  key: string;
  kind: 'SERVICE' | 'PRODUCT' | 'LAB';
  serviceId: string;
  labTestId: string;
  product: Pick<Product, 'id' | 'name' | 'sellPriceMinor'> | null;
  quantity: string;
}

const newRow = (kind: ItemRow['kind'] = 'SERVICE'): ItemRow => ({ key: Math.random().toString(36).slice(2), kind, serviceId: '', labTestId: '', product: null, quantity: '1' });
const toMajor = (minor: number | null | undefined, currency: string) => (minor == null ? '' : fromMinor(minor, currency));

/** Create or change a wellness plan. Changes only apply to people who join from now on. */
export function PlanEditor({ plan, open, onOpenChange }: { plan: WellnessPlan | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { currency, can } = useSession();
  const qc = useQueryClient();
  const services = useQuery({ queryKey: ['services', 'active'], queryFn: () => api.get<Service[]>('/services'), enabled: open });
  const labTests = useQuery({ queryKey: ['lab-tests'], queryFn: () => api.get<LabTest[]>('/lab-tests'), enabled: open && (can('lab.read') || can('settings.manage')) });
  const species = useQuery({ queryKey: ['species'], queryFn: () => api.get<Species[]>('/species'), enabled: open, staleTime: 300_000 });
  const taxes = useQuery({ queryKey: ['tax-rates'], queryFn: () => api.get<TaxRate[]>('/tax-rates'), enabled: open });
  const [f, setF] = useState({ name: '', description: '', speciesId: '', durationMonths: '12', price: '', monthly: false, monthlyPrice: '', joiningFee: '', taxRateId: '', serviceDiscount: '', productDiscount: '', terms: '' });
  const [items, setItems] = useState<ItemRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setTried(false);
    if (plan) {
      setF({
        name: plan.name,
        description: plan.description ?? '',
        speciesId: plan.speciesId ?? '',
        durationMonths: String(plan.durationMonths),
        price: toMajor(plan.priceMinor, currency),
        monthly: plan.monthlyPriceMinor != null,
        monthlyPrice: toMajor(plan.monthlyPriceMinor, currency),
        joiningFee: plan.joiningFeeMinor ? toMajor(plan.joiningFeeMinor, currency) : '',
        taxRateId: plan.taxRateId ?? '',
        serviceDiscount: plan.serviceDiscountBp ? String(plan.serviceDiscountBp / 100) : '',
        productDiscount: plan.productDiscountBp ? String(plan.productDiscountBp / 100) : '',
        terms: plan.terms ?? '',
      });
      setItems(plan.items.map((i) => ({ key: i.id, kind: i.kind, serviceId: i.serviceId ?? '', labTestId: i.labTestId ?? '', product: i.productId ? { id: i.productId, name: i.label, sellPriceMinor: i.unitValueMinor } : null, quantity: String(i.quantity) })));
    } else {
      setF({ name: '', description: '', speciesId: '', durationMonths: '12', price: '', monthly: false, monthlyPrice: '', joiningFee: '', taxRateId: '', serviceDiscount: '', productDiscount: '', terms: '' });
      setItems([newRow()]);
    }
  }, [open, plan, currency]);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const price = parseMoney(f.price, currency);
  const monthly = f.monthly ? parseMoney(f.monthlyPrice, currency) : null;
  const joining = f.joiningFee ? parseMoney(f.joiningFee, currency) : 0;
  const months = Number(f.durationMonths);
  const pct = (v: string) => (v === '' ? 0 : Number(v));
  const pctOk = (v: string) => v === '' || (/^\d{1,3}(\.\d{1,2})?$/.test(v) && Number(v) <= 100);
  const filled = items.filter((i) => (i.kind === 'SERVICE' ? i.serviceId : i.kind === 'LAB' ? i.labTestId : i.product));
  const valueOf = (i: ItemRow) => {
    const qty = Number(i.quantity) || 0;
    if (i.kind === 'SERVICE') return (services.data?.find((s) => s.id === i.serviceId)?.priceMinor ?? 0) * qty;
    if (i.kind === 'LAB') return (labTests.data?.find((t) => t.id === i.labTestId)?.priceMinor ?? 0) * qty;
    return (i.product?.sellPriceMinor ?? 0) * qty;
  };
  const includedValue = filled.reduce((n, i) => n + valueOf(i), 0);
  const errors = {
    name: !f.name.trim() ? 'Required' : undefined,
    price: price == null ? 'Enter the price' : undefined,
    monthlyPrice: f.monthly && monthly == null ? 'Enter the monthly price' : undefined,
    joiningFee: f.joiningFee && joining == null ? 'Check the amount' : undefined,
    durationMonths: !Number.isInteger(months) || months < 1 || months > WELLNESS_MAX_MONTHS ? `1 to ${WELLNESS_MAX_MONTHS} months` : undefined,
    serviceDiscount: pctOk(f.serviceDiscount) ? undefined : '0 to 100',
    productDiscount: pctOk(f.productDiscount) ? undefined : '0 to 100',
    items: !filled.length && !pct(f.serviceDiscount) && !pct(f.productDiscount) ? 'Include at least one item or a member discount' : items.some((i) => !(Number.isInteger(Number(i.quantity)) && Number(i.quantity) >= 1)) ? 'Quantities are whole numbers, at least 1' : undefined,
  };
  const invalid = Object.values(errors).some(Boolean);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: f.name.trim(),
        description: f.description,
        speciesId: f.speciesId || null,
        durationMonths: months,
        priceMinor: price,
        monthlyPriceMinor: f.monthly ? monthly : null,
        joiningFeeMinor: joining ?? 0,
        taxRateId: f.taxRateId || null,
        serviceDiscountBp: Math.round(pct(f.serviceDiscount) * 100),
        productDiscountBp: Math.round(pct(f.productDiscount) * 100),
        terms: f.terms,
        items: filled.map((i) => ({ kind: i.kind, serviceId: i.kind === 'SERVICE' ? i.serviceId : null, productId: i.kind === 'PRODUCT' ? i.product!.id : null, labTestId: i.kind === 'LAB' ? i.labTestId : null, quantity: Number(i.quantity) })),
      };
      return plan ? api.patch<WellnessPlan>(`/wellness/plans/${plan.id}`, body) : api.post<WellnessPlan>('/wellness/plans', body);
    },
    onSuccess: (p) => {
      toast.success(plan ? `${p.name} saved — applies to new members` : `${p.name} created`);
      qc.invalidateQueries({ queryKey: ['wellness-plans'] });
      qc.invalidateQueries({ queryKey: ['wellness-overview'] });
      onOpenChange(false);
    },
    onError: (e: Error) => setError(e.message),
  });

  const perMonthUpfront = price != null && months > 0 ? Math.round(price / months) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{plan ? `Edit ${plan.name}` : 'New wellness plan'}</DialogTitle>
          <DialogDescription>{plan ? 'Changes apply to people who join from now on. Current members keep what they signed up for.' : 'A yearly (or shorter) care package: what’s included, the price, and a discount on everything else.'}</DialogDescription>
        </DialogHeader>
        {error && <FormError message={error} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Plan name" htmlFor="wp-name" required error={tried ? errors.name : undefined}>
            <Input id="wp-name" value={f.name} maxLength={120} onChange={set('name')} placeholder="e.g. Puppy Care, Adult Dog Gold, Senior Cat" />
          </Field>
          <Field label="For" htmlFor="wp-species" hint="Only offered for this species.">
            <NativeSelect id="wp-species" value={f.speciesId} onChange={set('speciesId')}>
              <option value="">Any species</option>
              {(species.data ?? []).filter((s) => s.isActive).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Description" htmlFor="wp-desc" className="sm:col-span-2" hint="Shown when choosing a plan and on the agreement.">
            <Textarea id="wp-desc" value={f.description} maxLength={1000} onChange={set('description')} placeholder="e.g. Everything a healthy adult dog needs for a year: two check-ups, yearly vaccinations and a dental clean." />
          </Field>
        </div>

        <fieldset className="grid gap-3 rounded-lg border p-3">
          <legend className="px-1 text-sm font-semibold">Price</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Length (months)" htmlFor="wp-months" error={tried ? errors.durationMonths : undefined}>
              <Input id="wp-months" type="number" min={1} max={WELLNESS_MAX_MONTHS} value={f.durationMonths} onChange={set('durationMonths')} />
            </Field>
            <Field label="Price, paid up front" htmlFor="wp-price" required error={tried ? errors.price : undefined} hint={perMonthUpfront != null ? `About ${fmtMoney(perMonthUpfront, currency)} a month` : undefined}>
              <MoneyInput id="wp-price" currency={currency} value={f.price} onChange={set('price')} />
            </Field>
            <Field label="Joining fee" htmlFor="wp-join" error={tried ? errors.joiningFee : undefined} hint="First term only; not charged on renewal.">
              <MoneyInput id="wp-join" currency={currency} value={f.joiningFee} onChange={set('joiningFee')} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={f.monthly} onCheckedChange={(v) => setF((s) => ({ ...s, monthly: v === true }))} /> Also offer monthly payments
          </label>
          {f.monthly && (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Price per month" htmlFor="wp-monthly" required error={tried ? errors.monthlyPrice : undefined} hint={monthly != null && months > 0 ? `${fmtMoney(monthly * months, currency)} over ${months} months` : undefined}>
                <MoneyInput id="wp-monthly" currency={currency} value={f.monthlyPrice} onChange={set('monthlyPrice')} />
              </Field>
            </div>
          )}
          <Field label="Tax" htmlFor="wp-tax" className="max-w-xs">
            <NativeSelect id="wp-tax" value={f.taxRateId} onChange={set('taxRateId')}>
              <option value="">Clinic default</option>
              {(taxes.data ?? []).filter((t) => t.isActive).map((t) => <option key={t.id} value={t.id}>{t.name} ({t.rateBasisPoints / 100}%)</option>)}
            </NativeSelect>
          </Field>
        </fieldset>

        <fieldset className="grid gap-3 rounded-lg border p-3">
          <legend className="px-1 text-sm font-semibold">What’s included</legend>
          {items.map((i, n) => (
            <div key={i.key} className="grid items-end gap-2 sm:grid-cols-[8rem_minmax(0,1fr)_5rem_auto]">
              <Field label={n === 0 ? 'Type' : <span className="sr-only">Type</span>} htmlFor={`wi-kind-${i.key}`}>
                <NativeSelect id={`wi-kind-${i.key}`} value={i.kind} onChange={(e) => setItems((list) => list.map((x) => (x.key === i.key ? { ...newRow(e.target.value as ItemRow['kind']), key: x.key, quantity: x.quantity } : x)))}>
                  <option value="SERVICE">Service</option>
                  <option value="PRODUCT">Product</option>
                  {labTests.data && <option value="LAB">Lab test</option>}
                </NativeSelect>
              </Field>
              <Field label={n === 0 ? 'Item' : <span className="sr-only">Item</span>} htmlFor={`wi-item-${i.key}`}>
                {i.kind === 'SERVICE' ? (
                  <NativeSelect id={`wi-item-${i.key}`} value={i.serviceId} onChange={(e) => setItems((list) => list.map((x) => (x.key === i.key ? { ...x, serviceId: e.target.value } : x)))}>
                    <option value="">Choose a service…</option>
                    {(services.data ?? []).filter((s) => s.isActive).map((s) => <option key={s.id} value={s.id}>{s.name} · {fmtMoney(s.priceMinor, currency)}</option>)}
                  </NativeSelect>
                ) : i.kind === 'LAB' ? (
                  <NativeSelect id={`wi-item-${i.key}`} value={i.labTestId} onChange={(e) => setItems((list) => list.map((x) => (x.key === i.key ? { ...x, labTestId: e.target.value } : x)))}>
                    <option value="">Choose a lab test…</option>
                    {(labTests.data ?? []).filter((t) => t.isActive).map((t) => <option key={t.id} value={t.id}>{t.name}{t.priceMinor != null ? ` · ${fmtMoney(t.priceMinor, currency)}` : ''}</option>)}
                  </NativeSelect>
                ) : (
                  <ProductPicker id={`wi-item-${i.key}`} value={i.product as Product | null} onChange={(p) => setItems((list) => list.map((x) => (x.key === i.key ? { ...x, product: p } : x)))} placeholder="Search vaccines, wormers, food…" />
                )}
              </Field>
              <Field label={n === 0 ? 'How many' : <span className="sr-only">How many</span>} htmlFor={`wi-qty-${i.key}`}>
                <Input id={`wi-qty-${i.key}`} type="number" min={1} max={999} value={i.quantity} onChange={(e) => setItems((list) => list.map((x) => (x.key === i.key ? { ...x, quantity: e.target.value } : x)))} />
              </Field>
              <Button size="icon" variant="ghost" aria-label="Remove item" onClick={() => setItems((list) => list.filter((x) => x.key !== i.key))}>
                <Trash2 />
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button size="sm" variant="outline" onClick={() => setItems((list) => [...list, newRow()])}>
              <Plus /> Add item
            </Button>
            {includedValue > 0 && (
              <p className="text-sm text-muted-foreground">
                Worth <b className="tabular text-foreground">{fmtMoney(includedValue, currency)}</b> at today’s prices
                {price != null && includedValue > price && <span className="text-success"> · members save {fmtMoney(includedValue - price, currency)}</span>}
              </p>
            )}
          </div>
          {tried && errors.items && <p className="text-xs text-destructive">{errors.items}</p>}
        </fieldset>

        <fieldset className="grid gap-3 rounded-lg border p-3">
          <legend className="px-1 text-sm font-semibold">Member discount on everything else</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Services and lab tests (%)" htmlFor="wp-sd" error={tried ? errors.serviceDiscount : undefined}>
              <Input id="wp-sd" inputMode="decimal" value={f.serviceDiscount} onChange={set('serviceDiscount')} placeholder="0" />
            </Field>
            <Field label="Products and medicines (%)" htmlFor="wp-pd" error={tried ? errors.productDiscount : undefined}>
              <Input id="wp-pd" inputMode="decimal" value={f.productDiscount} onChange={set('productDiscount')} placeholder="0" />
            </Field>
          </div>
          <p className="text-xs text-muted-foreground">Taken off the member’s bill automatically, item by item, and shown on the invoice.</p>
        </fieldset>

        <Field label="Terms and conditions" htmlFor="wp-terms" hint="Printed on the membership agreement the client signs.">
          <Textarea id="wp-terms" value={f.terms} maxLength={4000} onChange={set('terms')} placeholder="e.g. Included items must be used within the plan year and can’t be exchanged for cash. Cancelling: benefits used beyond what has been paid are charged." className="min-h-[96px]" />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            loading={save.isPending}
            onClick={() => {
              setTried(true);
              setError(null);
              if (!invalid) save.mutate();
            }}
          >
            {plan ? 'Save plan' : 'Create plan'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
