'use client';
import { useQuery } from '@tanstack/react-query';
import type { Paginated } from '@vcms/shared';
import { Check, ChevronsUpDown, Loader2, Lock, Search } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { useDebounce } from '@/hooks/use-debounce';
import { api, qs } from '@/lib/api';
import type { Product } from '@/lib/types';
import { cn } from '@/lib/utils';

export function productStrength(p: Pick<Product, 'strengthValue' | 'strengthUnit' | 'dispensingUnit'>) {
  return p.strengthValue ? `${p.strengthValue} ${p.strengthUnit}/${p.dispensingUnit}` : p.dispensingUnit;
}

export function ProductPicker({
  value,
  onChange,
  prescribable,
  id,
  placeholder = 'Search medicine by name, generic name or SKU…',
}: {
  value: Product | null;
  onChange: (p: Product | null) => void;
  prescribable?: boolean;
  id?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const q = useDebounce(term.trim(), 200);
  const results = useQuery({
    queryKey: ['product-picker', q, prescribable],
    queryFn: () => api.get<Paginated<Product>>(`/products${qs({ q: q || undefined, pageSize: 15, prescribable: prescribable ? 'true' : undefined })}`),
    enabled: open,
  });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button id={id} type="button" variant="outline" role="combobox" aria-expanded={open} className={cn('w-full justify-between font-normal', !value && 'text-muted-foreground')}>
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
          {!results.isFetching && !results.data?.data.length && <li className="px-3 py-4 text-center text-xs text-muted-foreground">No matching products. Add them in Formulary.</li>}
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
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {productStrength(p)}
                    {p.genericName && ` · ${p.genericName}`}
                    {!!p._count?.doseReferences && ` · ${p._count.doseReferences} approved dose ref.`}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
