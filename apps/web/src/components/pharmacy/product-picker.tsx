'use client';
import { useQuery } from '@tanstack/react-query';
import { allergyMatches, type AllergyAlertLike, type Paginated } from '@vcms/shared';
import { Check, ChevronsUpDown, Loader2, Lock, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { useDebounce } from '@/hooks/use-debounce';
import { api, qs } from '@/lib/api';
import type { Product } from '@/lib/types';
import { cn } from '@/lib/utils';

export function productStrength(p: Pick<Product, 'strengthValue' | 'strengthUnit' | 'dispensingUnit'> & Partial<Pick<Product, 'brand' | 'packSize'>>) {
  if (p.strengthValue) return `${p.strengthValue} ${p.strengthUnit}/${p.dispensingUnit}`;
  // Shop items: brand and pack size describe them better than a strength.
  return [p.brand, p.packSize, `per ${p.dispensingUnit}`].filter(Boolean).join(' · ');
}

export function ProductPicker({
  value,
  onChange,
  prescribable,
  id,
  alerts,
  placeholder = 'Search by name, brand, generic name or SKU…',
  type,
  onCreate,
}: {
  value: Product | null;
  onChange: (p: Product | null) => void;
  prescribable?: boolean;
  /** The patient's alerts: products that match an allergy are marked in the list before they are picked. */
  alerts?: AllergyAlertLike[];
  id?: string;
  placeholder?: string;
  /** Only products of this kind (e.g. FOOD). */
  type?: string;
  /** Offers "New product" with what was typed, for products not in the catalogue yet. */
  onCreate?: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const q = useDebounce(term.trim(), 200);
  const results = useQuery({
    queryKey: ['product-picker', q, prescribable, type],
    queryFn: () => api.get<Paginated<Product>>(`/products${qs({ q: q || undefined, pageSize: 15, prescribable: prescribable ? 'true' : undefined, type })}`),
    enabled: open,
  });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button id={id} type="button" variant="outline" role="combobox" aria-expanded={open} className={cn('w-full min-w-0 justify-between overflow-hidden font-normal', !value && 'text-muted-foreground')}>
          <span className="truncate">{value ? `${value.name} · ${productStrength(value)}` : placeholder}</span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[340px] p-0">
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input autoFocus value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search products…" className="h-10 flex-1 bg-transparent text-sm outline-none" aria-label="Search products" />
          {results.isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
        <ul className="max-h-72 overflow-y-auto p-1" role="listbox">
          {!results.isFetching && !results.data?.data.length && <li className="px-3 py-4 text-center text-xs text-muted-foreground">{onCreate ? 'Not in your products yet.' : 'No matching products. Add them in Stock → Products.'}</li>}
          {results.data?.data.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                role="option"
                aria-selected={value?.id === p.id}
                onClick={() => {
                  onChange(p);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted"
              >
                <Check className={cn('h-4 w-4 shrink-0', value?.id === p.id ? 'opacity-100' : 'opacity-0')} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1 truncate font-medium">
                    {p.name} {p.isControlled && <Lock className="h-3 w-3 text-warning" aria-label="Controlled" />}
                    {!!alerts?.length && allergyMatches(alerts, p).length > 0 && (
                      <span className="ml-auto shrink-0 rounded bg-destructive px-1.5 py-0.5 text-2xs font-semibold text-destructive-foreground">⚠ Allergy match</span>
                    )}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {productStrength(p)}
                    {p.genericName && ` · ${p.genericName}`}
                    {p.drugClass && ` · ${p.drugClass}`}
                    {!!p._count?.doseReferences && ` · ${p._count.doseReferences} approved dose ref.`}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {onCreate && (
          <div className="border-t p-1">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onCreate(term.trim());
              }}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm font-medium text-primary hover:bg-primary/5"
            >
              <Plus className="h-4 w-4" /> {term.trim() ? `New product “${term.trim()}”` : 'New product'}
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
