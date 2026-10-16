'use client';
import { enumLabel } from '@vcms/shared';
import { Ban, Loader2, Lock, PackageSearch, ScanBarcode, Scissors } from 'lucide-react';
import * as React from 'react';
import { EmptyState } from '../page';
import { Kbd } from '../ui/misc';
import { CATEGORIES, blockReason } from './model';
import { fmtMoney } from '@/lib/format';
import type { PosItem } from '@/lib/types';
import { cn } from '@/lib/utils';

interface Props {
  search: string;
  onSearch: (v: string) => void;
  /** Enter in the search box: scanners send the barcode followed by Enter. */
  onSubmit: (v: string) => void;
  category: string;
  onCategory: (c: string) => void;
  items: PosItem[];
  loading: boolean;
  qtyInCart: (item: PosItem) => number;
  allowNegative: boolean;
  currency: string;
  onAdd: (item: PosItem) => void;
}

export const PosCatalog = React.forwardRef<HTMLInputElement, Props>(function PosCatalog(p, ref) {
  // Prescription-only items are only shown when searching, so staff understand why they cannot be sold here.
  const visible = p.search.trim() ? p.items : p.items.filter((i) => !i.rxOnly);
  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="relative">
        <ScanBarcode className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={ref}
          value={p.search}
          onChange={(e) => p.onSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              p.onSubmit(p.search);
            } else if (e.key === 'Escape') p.onSearch('');
          }}
          placeholder="Scan a barcode or search products and services…"
          aria-label="Scan or search items"
          autoComplete="off"
          className="h-12 w-full rounded-lg border border-input bg-card pl-11 pr-24 text-base shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <span className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-2">
          {p.loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          <Kbd>F2</Kbd>
        </span>
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Categories">
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            role="tab"
            aria-selected={p.category === c.key}
            onClick={() => p.onCategory(c.key)}
            className={cn('shrink-0 rounded-full border px-3.5 py-1.5 text-sm transition-colors', p.category === c.key ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted hover:text-foreground')}
          >
            {c.label}
          </button>
        ))}
      </div>
      {!p.loading && !visible.length ? (
        <EmptyState icon={PackageSearch} title={p.search ? `Nothing matches “${p.search}”` : 'No items in this category'} description="Products need a selling price, and services must be active, to appear here." />
      ) : (
        <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" aria-label="Items">
          {visible.map((item) => {
            const inCart = p.qtyInCart(item);
            const blocked = blockReason(item, inCart, p.allowNegative);
            const low = item.trackStock && item.available !== null && item.available > 0 && item.available <= 5;
            return (
              <li key={`${item.type}-${item.id}`}>
                <button
                  type="button"
                  disabled={!!blocked}
                  onClick={() => p.onAdd(item)}
                  aria-label={`Add ${item.name}`}
                  className={cn(
                    'group relative flex h-full min-h-[118px] w-full flex-col rounded-lg border bg-card p-3 text-left shadow-sm transition-all',
                    blocked ? 'cursor-not-allowed opacity-60' : 'hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md active:translate-y-0',
                    inCart > 0 && 'border-primary ring-1 ring-primary/40',
                  )}
                >
                  {inCart > 0 && <span className="absolute -right-1.5 -top-1.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground tabular">{inCart}</span>}
                  <span className="flex items-center gap-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                    {item.type === 'SERVICE' && <Scissors className="h-3 w-3" />}
                    {item.type === 'SERVICE' ? 'Service' : enumLabel(item.category)}
                    {item.code && <span className="truncate font-mono normal-case tracking-normal">· {item.code}</span>}
                  </span>
                  <span className="mt-1 line-clamp-2 text-sm font-medium leading-snug">{item.name}</span>
                  <span className="mt-auto flex items-end justify-between gap-2 pt-2">
                    <span className="text-base font-semibold tabular">{item.priceMinor !== null ? fmtMoney(item.priceMinor, p.currency) : '—'}</span>
                    {blocked ? (
                      <span className="flex items-center gap-1 text-2xs font-medium text-destructive">{item.rxOnly ? <Lock className="h-3 w-3" /> : <Ban className="h-3 w-3" />}{blocked}</span>
                    ) : item.trackStock && item.available !== null ? (
                      <span className={cn('text-2xs font-medium tabular', low ? 'text-warning' : 'text-muted-foreground')}>{item.available - inCart} {item.unit}{low ? ' · low' : ''}</span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
});
