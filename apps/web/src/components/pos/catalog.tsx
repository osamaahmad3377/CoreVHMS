'use client';
import { enumLabel } from '@vcms/shared';
import { Ban, Bath, Bone, LayoutGrid, Leaf, Loader2, Lock, Package, PackageSearch, Pill, ScanBarcode, ShoppingBag, Stethoscope, Syringe, Tag, Wrench, type LucideIcon } from 'lucide-react';
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

/** An icon for each kind of item (sections and tiles). */
const KIND_ICON: Record<string, LucideIcon> = {
  '': LayoutGrid,
  SERVICE: Stethoscope,
  FOOD: Bone,
  GROOMING: Bath,
  ACCESSORY: Tag,
  SUPPLEMENT: Leaf,
  RETAIL: ShoppingBag,
  CONSUMABLE: Package,
  EQUIPMENT: Wrench,
  MEDICINE: Pill,
  VACCINE: Syringe,
};

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
          className="h-12 w-full rounded-xl border border-input bg-card pl-11 pr-24 text-[15px] shadow-sm transition-shadow placeholder:text-muted-foreground focus-visible:border-primary/50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15"
        />
        <span className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-2">
          {p.loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          <span className="hidden xl:inline"><Kbd>F2</Kbd></span>
        </span>
      </div>
      <div className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0 [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Categories">
        {categories.map((c) => {
          const Icon = KIND_ICON[c.key] ?? Package;
          const on = p.category === c.key;
          return (
            <button
              key={c.key}
              role="tab"
              aria-selected={on}
              onClick={() => p.onCategory(c.key)}
              className={cn(
                'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                on ? 'bg-foreground text-background shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {c.label}
            </button>
          );
        })}
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
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" aria-label="Items">
          {visible.map((item) => {
            const inCart = p.qtyInCart(item);
            const blocked = blockReason(item, inCart, p.allowNegative, p.allowRx);
            const low = item.trackStock && item.available !== null && item.available > 0 && item.available <= 5;
            const Icon = KIND_ICON[item.type === 'SERVICE' ? 'SERVICE' : item.category] ?? Package;
            const kind = item.type === 'SERVICE' ? 'Service' : (item.categoryName ?? PRODUCT_TYPE_LABELS[item.category as keyof typeof PRODUCT_TYPE_LABELS] ?? enumLabel(item.category));
            const left = item.trackStock && item.available !== null ? item.available - inCart : null;
            return (
              <li key={`${item.type}-${item.id}`}>
                <button
                  type="button"
                  aria-disabled={!!blocked}
                  onClick={() => p.onAdd(item)}
                  aria-label={`Add ${item.name}`}
                  className={cn(
                    'group relative flex h-full min-h-[132px] w-full flex-col rounded-xl border bg-card p-3.5 text-left shadow-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    blocked ? 'cursor-not-allowed opacity-55' : 'hover:border-primary/40 hover:shadow-md active:scale-[0.99]',
                    inCart > 0 && 'border-primary bg-primary/[0.03] ring-1 ring-primary/30',
                  )}
                >
                  {inCart > 0 && <span className="absolute right-2.5 top-2.5 z-10 flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold tabular text-primary-foreground shadow-sm">{inCart}</span>}
                  {item.photoAttachmentId ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/v1/attachments/${item.photoAttachmentId}/download?inline=1`} alt="" loading="lazy" className="-mx-3.5 -mt-3.5 mb-3 h-24 w-[calc(100%+1.75rem)] max-w-none rounded-t-xl object-cover" />
                  ) : null}
                  <span className="flex items-center gap-2.5">
                    {!item.photoAttachmentId && (
                      <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-lg', blocked ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary')}>
                        <Icon className="h-[18px] w-[18px]" aria-hidden />
                      </span>
                    )}
                    <span className={cn('min-w-0 flex-1', inCart > 0 && 'pr-7')}>
                      <span className="block truncate text-xs font-medium text-muted-foreground">{kind}</span>
                      {item.code && <span className="block truncate font-mono text-[10.5px] leading-tight text-muted-foreground/70">{item.code}</span>}
                    </span>
                  </span>
                  <span className="mt-2.5 line-clamp-2 text-sm font-semibold leading-snug">{item.name}</span>
                  {(item.brand || item.packSize) && <span className="mt-0.5 truncate text-xs text-muted-foreground">{[item.brand, item.packSize].filter(Boolean).join(' · ')}</span>}
                  <span className="mt-auto flex items-center justify-between gap-2 border-t border-dashed pt-2.5">
                    <span className="whitespace-nowrap text-[15px] font-bold tabular tracking-tight">{item.priceMinor !== null ? fmtMoney(item.priceMinor, p.currency) : '—'}</span>
                    {blocked ? (
                      <span className="inline-flex min-w-0 items-center gap-1 truncate rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">
                        {item.rxOnly ? <Lock className="h-3 w-3" /> : <Ban className="h-3 w-3" />}
                        {blocked}
                      </span>
                    ) : left !== null ? (
                      <span title={low ? 'Running low' : 'In stock'} className={cn('inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium tabular', low ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success')}>
                        <span className={cn('h-1.5 w-1.5 rounded-full', low ? 'bg-warning' : 'bg-success')} aria-hidden />
                        {qtyUnit(left, item.unit)}
                      </span>
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
