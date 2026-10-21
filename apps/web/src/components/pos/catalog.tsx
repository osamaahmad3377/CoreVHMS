'use client';
import { enumLabel } from '@vcms/shared';
import { Ban, Loader2, Lock, PackageSearch, ScanBarcode, Scissors } from 'lucide-react';
import { PRODUCT_TYPE_LABELS } from '@vcms/shared';
import Link from 'next/link';
import * as React from 'react';
import { EmptyState } from '../page';
import { Kbd } from '../ui/misc';
import { CATEGORIES, blockReason } from './model';
import { fmtMoney } from '@/lib/format';
import type { PosItem, ProductCategory } from '@/lib/types';
import { qtyUnit } from '@/lib/labels';
import { cn } from '@/lib/utils';

interface Props {
  search: string;
  onSearch: (v: string) => void;
  /** Enter in the search box: scanners send the barcode followed by Enter. */
  onSubmit: (v: string) => void;
  category: string;
  onCategory: (c: string) => void;
  /** Shop categories within the selected section (e.g. Dry food, Wet food under Food & treats). */
  shelves: ProductCategory[];
  shelf: string;
  onShelf: (id: string) => void;
  items: PosItem[];
  loading: boolean;
  qtyInCart: (item: PosItem) => number;
  allowNegative: boolean;
  currency: string;
  /** Tapping an item that cannot be sold also calls this, so the page can say why (e.g. out of stock). */
  onAdd: (item: PosItem) => void;
  /** Product types with something sellable at the counter; clinic-only sections without any are hidden. */
  sellableTypes?: string[];
  /** Shows "Add products to sell" in empty sections (inventory.write). */
  canAddProducts: boolean;
  /** The clinic lets prescription-only items be sold without a prescription (with a note). */
  allowRx?: boolean;
}

/** Sections that are often empty at the counter (prescription-only items are not sold here). */
const HIDE_WHEN_EMPTY = new Set(['MEDICINE', 'VACCINE']);

export const PosCatalog = React.forwardRef<HTMLInputElement, Props>(function PosCatalog(p, ref) {
  // Prescription-only items are only shown when searching, so staff understand why they cannot be sold here.
  // Items that cannot be sold (out of stock, prescription only, no price) go last, greyed out.
  const visible = (p.search.trim() ? p.items : p.items.filter((i) => !i.rxOnly || (p.allowRx && !i.controlled)))
    .map((item, i) => ({ item, i, blocked: !!blockReason(item, 0, p.allowNegative, p.allowRx) }))
    .sort((a, b) => Number(a.blocked) - Number(b.blocked) || a.i - b.i)
    .map((x) => x.item);
  const categories = CATEGORIES.filter((c) => !HIDE_WHEN_EMPTY.has(c.key) || !p.sellableTypes || p.sellableTypes.includes(c.key) || p.category === c.key);
  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-3">
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
          <span className="hidden xl:inline"><Kbd>F2</Kbd></span>
        </span>
      </div>
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0 [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Categories">
        {categories.map((c) => (
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
      {p.shelves.length > 0 && (
        <div className="-mx-4 -mt-1 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0 [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Shelves">
          {[{ id: '', name: 'All' }, ...p.shelves].map((s) => (
            <button
              key={s.id || 'all'}
              role="tab"
              aria-selected={p.shelf === s.id}
              onClick={() => p.onShelf(s.id)}
              className={cn('shrink-0 rounded-md border px-2.5 py-1 text-xs transition-colors', p.shelf === s.id ? 'border-primary bg-primary/10 font-medium text-primary' : 'bg-card text-muted-foreground hover:bg-muted hover:text-foreground')}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      {!p.loading && !visible.length ? (
        <EmptyState
          icon={PackageSearch}
          title={p.search ? `Nothing matches “${p.search}”` : 'No items here yet.'}
          description={p.search ? 'Try another word, such as the brand or the type of item (food, shampoo, collar).' : 'Products need a selling price to appear here.'}
          action={p.canAddProducts ? <Link className="text-sm font-medium text-primary underline" href="/inventory/catalog">Add products to sell</Link> : undefined}
        />
      ) : (
        <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" aria-label="Items">
          {visible.map((item) => {
            const inCart = p.qtyInCart(item);
            const blocked = blockReason(item, inCart, p.allowNegative, p.allowRx);
            const low = item.trackStock && item.available !== null && item.available > 0 && item.available <= 5;
            return (
              <li key={`${item.type}-${item.id}`}>
                <button
                  type="button"
                  aria-disabled={!!blocked}
                  onClick={() => p.onAdd(item)}
                  aria-label={`Add ${item.name}`}
                  className={cn(
                    'group relative flex h-full min-h-[118px] w-full flex-col rounded-xl surface-flat p-3 text-left shadow-card transition-all',
                    blocked ? 'cursor-not-allowed bg-muted/40 opacity-50 grayscale' : 'hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md active:translate-y-0',
                    inCart > 0 && 'border-primary ring-1 ring-primary/40',
                  )}
                >
                  {inCart > 0 && <span className="absolute -right-1.5 -top-1.5 z-10 flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground tabular">{inCart}</span>}
                  {item.photoAttachmentId && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/v1/attachments/${item.photoAttachmentId}/download?inline=1`} alt="" loading="lazy" className="-mx-3 -mt-3 mb-2 h-24 w-[calc(100%+1.5rem)] max-w-none rounded-t-lg object-cover" />
                  )}
                  <span className="flex items-center gap-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                    {item.type === 'SERVICE' && <Scissors className="h-3 w-3" />}
                    <span className="truncate">{item.type === 'SERVICE' ? 'Service' : item.categoryName ?? PRODUCT_TYPE_LABELS[item.category as keyof typeof PRODUCT_TYPE_LABELS] ?? enumLabel(item.category)}</span>
                    {item.code && <span className="truncate font-mono normal-case tracking-normal">· {item.code}</span>}
                  </span>
                  <span className="mt-1 line-clamp-2 text-sm font-medium leading-snug">{item.name}</span>
                  {(item.brand || item.packSize) && <span className="truncate text-xs text-muted-foreground">{[item.brand, item.packSize].filter(Boolean).join(' · ')}</span>}
                  <span className="mt-auto flex items-end justify-between gap-2 pt-2">
                    <span className="text-base font-semibold tabular">{item.priceMinor !== null ? fmtMoney(item.priceMinor, p.currency) : '—'}</span>
                    {blocked ? (
                      <span className="flex items-center gap-1 text-2xs font-medium text-destructive">{item.rxOnly ? <Lock className="h-3 w-3" /> : <Ban className="h-3 w-3" />}{blocked}</span>
                    ) : item.trackStock && item.available !== null ? (
                      <span className={cn('text-2xs font-medium tabular', low ? 'text-warning' : 'text-muted-foreground')}>{qtyUnit(item.available - inCart, item.unit)}{low ? ' · low' : ''}</span>
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
