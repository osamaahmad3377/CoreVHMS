'use client';
import { useQuery } from '@tanstack/react-query';
import { calcLine, fromMinor, sumLines } from '@vcms/shared';
import { Plus, Trash2 } from 'lucide-react';
import { ProductPicker } from '../pharmacy/product-picker';
import { Button } from '../ui/button';
import { Input, NativeSelect } from '../ui/input';
import { MoneyInput, bpToPct, parseMoney } from './money';
import { api } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { BillingSettings, Product, Service, TaxRate } from '@/lib/types';

export interface DraftLine {
  key: string;
  kind: 'SERVICE' | 'PRODUCT' | 'CUSTOM';
  serviceId?: string;
  product?: Product | null;
  description: string;
  quantity: string;
  price: string;
  /** Catalogue price, so only genuine overrides are sent to the server. */
  catalogPriceMinor?: number | null;
  discount: string;
  taxRateBasisPoints: number;
}

export const newLine = (kind: DraftLine['kind'] = 'SERVICE', taxBp = 0): DraftLine => ({ key: crypto.randomUUID(), kind, description: '', quantity: '1', price: '', discount: '', taxRateBasisPoints: taxBp });

export function useBillingCatalog() {
  const services = useQuery({ queryKey: ['services', 'active'], queryFn: () => api.get<Service[]>('/services') });
  const taxRates = useQuery({ queryKey: ['tax-rates'], queryFn: () => api.get<TaxRate[]>('/tax-rates') });
  const settings = useQuery({ queryKey: ['billing-settings'], queryFn: () => api.get<BillingSettings>('/billing/settings') });
  const rates = taxRates.data ?? [];
  const defaultBp = rates.find((t) => t.isDefault && t.isActive)?.rateBasisPoints ?? 0;
  const taxFor = (taxRateId?: string | null) => rates.find((t) => t.id === taxRateId && t.isActive)?.rateBasisPoints ?? defaultBp;
  return { services: (services.data ?? []).filter((s) => s.isActive), rates, defaultBp, taxFor, pricesIncludeTax: settings.data?.pricesIncludeTax ?? false, loading: services.isLoading || taxRates.isLoading || settings.isLoading };
}

/** Converts draft lines to the API's line payload. */
export function toPayload(lines: DraftLine[], currency: string) {
  return lines.map((l) => {
    const unit = parseMoney(l.price, currency);
    const override = l.kind === 'CUSTOM' || (unit !== null && unit !== l.catalogPriceMinor);
    return {
      kind: l.kind,
      serviceId: l.kind === 'SERVICE' ? l.serviceId : undefined,
      productId: l.kind === 'PRODUCT' ? l.product?.id : undefined,
      description: l.kind === 'CUSTOM' ? l.description : undefined,
      quantity: Number(l.quantity),
      unitPriceMinor: override && unit !== null ? unit : undefined,
      discountMinor: parseMoney(l.discount, currency) ?? 0,
    };
  });
}

export function lineAmounts(l: DraftLine, currency: string, inclusive: boolean) {
  const unit = parseMoney(l.price, currency);
  const qty = Number(l.quantity);
  if (unit === null || !(qty > 0)) return null;
  try {
    return { ...calcLine({ quantity: qty, unitPriceMinor: unit, discountMinor: parseMoney(l.discount, currency) ?? 0, taxRateBasisPoints: l.taxRateBasisPoints }, inclusive), discountMinor: parseMoney(l.discount, currency) ?? 0 };
  } catch {
    return null;
  }
}

export function draftTotals(lines: DraftLine[], currency: string, inclusive: boolean) {
  return sumLines(lines.map((l) => lineAmounts(l, currency, inclusive)).filter((a): a is NonNullable<typeof a> => a !== null));
}

/**
 * Editable invoice/estimate lines. Prices come from the catalogue; users with billing permission may
 * override a price or add a discount (the server re-validates and records the change).
 */
export function LineEditor({
  lines,
  onChange,
  allowOverrides,
  kinds = ['SERVICE', 'PRODUCT', 'CUSTOM'],
}: {
  lines: DraftLine[];
  onChange: (lines: DraftLine[]) => void;
  allowOverrides: boolean;
  kinds?: DraftLine['kind'][];
}) {
  const { currency } = useSession();
  const cat = useBillingCatalog();
  const update = (key: string, patch: Partial<DraftLine>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  return (
    <div className="grid gap-2">
      {lines.map((l, idx) => {
        const amounts = lineAmounts(l, currency, cat.pricesIncludeTax);
        return (
          <div key={l.key} className="grid gap-2 rounded-md border p-3">
            <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-2">
              <NativeSelect aria-label={`Line ${idx + 1} type`} value={l.kind} onChange={(e) => update(l.key, { ...newLine(e.target.value as DraftLine['kind'], cat.defaultBp), key: l.key, quantity: l.quantity })}>
                {kinds.map((k) => <option key={k} value={k}>{k === 'SERVICE' ? 'Service' : k === 'PRODUCT' ? 'Product' : 'Custom'}</option>)}
              </NativeSelect>
              {l.kind === 'SERVICE' ? (
                <NativeSelect
                  aria-label={`Line ${idx + 1} service`}
                  value={l.serviceId ?? ''}
                  onChange={(e) => {
                    const s = cat.services.find((x) => x.id === e.target.value);
                    update(l.key, s ? { serviceId: s.id, description: s.name, price: fromMinor(s.priceMinor, currency), catalogPriceMinor: s.priceMinor, taxRateBasisPoints: cat.taxFor(s.taxRateId) } : { serviceId: undefined });
                  }}
                >
                  <option value="">{cat.services.length ? 'Choose a service…' : 'No services configured'}</option>
                  {cat.services.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
                </NativeSelect>
              ) : l.kind === 'PRODUCT' ? (
                <ProductPicker
                  value={l.product ?? null}
                  placeholder="Search product…"
                  onChange={(p) => update(l.key, { product: p, description: p?.name ?? '', price: p?.sellPriceMinor != null ? fromMinor(p.sellPriceMinor, currency) : '', catalogPriceMinor: p?.sellPriceMinor ?? null, taxRateBasisPoints: cat.taxFor(p?.taxRateId) })}
                />
              ) : (
                <Input aria-label={`Line ${idx + 1} description`} placeholder="Description" value={l.description} maxLength={300} onChange={(e) => update(l.key, { description: e.target.value })} />
              )}
            </div>
            <div className="grid grid-cols-[72px_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2 sm:grid-cols-[90px_minmax(0,1fr)_minmax(0,1fr)_110px_auto]">
              <Input aria-label={`Line ${idx + 1} quantity`} title="Quantity" inputMode="decimal" value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} />
              <MoneyInput aria-label={`Line ${idx + 1} unit price`} title="Unit price" currency={currency} value={l.price} disabled={!allowOverrides && l.kind !== 'CUSTOM'} onChange={(e) => update(l.key, { price: e.target.value })} />
              <MoneyInput aria-label={`Line ${idx + 1} discount`} placeholder="Discount" currency={currency} value={l.discount} disabled={!allowOverrides} onChange={(e) => update(l.key, { discount: e.target.value })} />
              <div className="text-right text-sm tabular">
                <p className="font-medium">{amounts ? fmtMoney(amounts.grossMinor, currency) : '—'}</p>
                <p className="text-2xs text-muted-foreground">tax {bpToPct(l.taxRateBasisPoints)}</p>
              </div>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove line ${idx + 1}`} onClick={() => onChange(lines.filter((x) => x.key !== l.key))}>
                <Trash2 />
              </Button>
            </div>
            {l.kind === 'PRODUCT' && l.product?.requiresPrescription && l.product.type === 'MEDICINE' && (
              <p className="text-xs text-destructive">{l.product.name} is prescription-only. Dispense it from a prescription; it is then billed automatically.</p>
            )}
          </div>
        );
      })}
      <div>
        <Button type="button" size="sm" variant="outline" onClick={() => onChange([...lines, newLine(kinds[0], cat.defaultBp)])}>
          <Plus /> Add line
        </Button>
      </div>
    </div>
  );
}

export function TotalsBox({ subtotalMinor, taxMinor, totalMinor, discountMinor, inclusive, extra }: { subtotalMinor: number; taxMinor: number; totalMinor: number; discountMinor?: number; inclusive: boolean; extra?: React.ReactNode }) {
  const { currency } = useSession();
  return (
    <dl className="ml-auto grid w-full max-w-xs gap-1 text-sm">
      {!!discountMinor && <div className="flex justify-between text-muted-foreground"><dt>Discounts</dt><dd className="tabular">−{fmtMoney(discountMinor, currency)}</dd></div>}
      <div className="flex justify-between"><dt className="text-muted-foreground">Subtotal (excl. tax)</dt><dd className="tabular">{fmtMoney(subtotalMinor, currency)}</dd></div>
      <div className="flex justify-between"><dt className="text-muted-foreground">Tax{inclusive ? ' (included)' : ''}</dt><dd className="tabular">{fmtMoney(taxMinor, currency)}</dd></div>
      <div className="flex justify-between border-t pt-1 text-base font-semibold"><dt>Total</dt><dd className="tabular">{fmtMoney(totalMinor, currency)}</dd></div>
      {extra}
    </dl>
  );
}
