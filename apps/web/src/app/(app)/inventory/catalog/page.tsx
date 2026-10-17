'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PRODUCT_TYPES, PRODUCT_TYPE_LABELS, type Paginated } from '@vcms/shared';
import { Lock, Package, Plus, Tags } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Suspense, useState } from 'react';
import { toast } from 'sonner';
import { INVENTORY_LINKS, SectionNav } from '@/components/billing/section-nav';
import { DataTable } from '@/components/data-table';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { EmptyState, PageHeader } from '@/components/page';
import { ProductDialog } from '@/components/pharmacy/product-dialog';
import { RequirePermission } from '@/components/require';
import { SearchInput } from '@/components/search-input';
import { StatusBadge } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect } from '@/components/ui/input';
import { useUrlState } from '@/hooks/use-url-state';
import { api, qs } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { Product, ProductCategory } from '@/lib/types';
import { cn } from '@/lib/utils';

type ProductType = (typeof PRODUCT_TYPES)[number];
const TABS: { key: string; label: string }[] = [
  { key: '', label: 'All' },
  { key: 'shop', label: 'Shop items' },
  ...(['FOOD', 'GROOMING', 'ACCESSORY', 'SUPPLEMENT', 'RETAIL', 'MEDICINE', 'VACCINE', 'CONSUMABLE', 'EQUIPMENT'] as const).map((t) => ({ key: t, label: PRODUCT_TYPE_LABELS[t] })),
];

function CategoriesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { can } = useSession();
  const editable = can('inventory.write') || can('formulary.manage');
  const list = useQuery({ queryKey: ['product-categories', 'all'], queryFn: () => api.get<ProductCategory[]>('/product-categories?all=true'), enabled: open });
  const [name, setName] = useState('');
  const [type, setType] = useState<ProductType | ''>('FOOD');
  const [error, setError] = useState<string | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['product-categories'] }); qc.invalidateQueries({ queryKey: ['pos', 'catalog'] }); };
  const create = useMutation({
    mutationFn: () => api.post('/product-categories', { name, productType: type || null, sortOrder: 100 }),
    onSuccess: () => { setName(''); refresh(); toast.success('Category added'); },
    onError: (e: Error) => setError(e.message),
  });
  const update = useMutation({
    mutationFn: (v: { id: string; body: Partial<ProductCategory> }) => api.patch(`/product-categories/${v.id}`, v.body),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const saveName = () => {
    if (editing && editing.name.trim()) update.mutate({ id: editing.id, body: { name: editing.name.trim() } });
    setEditing(null);
  };
  const groups = [...PRODUCT_TYPES, null].map((t) => ({ t, rows: (list.data ?? []).filter((c) => c.productType === t) })).filter((g) => g.rows.length);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Shop categories</DialogTitle>
          <DialogDescription>Shelf groups used on the shop counter and in the sales-by-category report. Hide a category instead of deleting it; products already in it keep it.</DialogDescription>
        </DialogHeader>
        {error && <FormError message={error} />}
        {editable && (
          <form className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_200px_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); setError(null); create.mutate(); }}>
            <Field label="New category" htmlFor="pc-name"><Input id="pc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Puppy food" maxLength={60} /></Field>
            <Field label="For" htmlFor="pc-type">
              <NativeSelect id="pc-type" value={type} onChange={(e) => setType(e.target.value as ProductType | '')}>
                {PRODUCT_TYPES.map((t) => <option key={t} value={t}>{PRODUCT_TYPE_LABELS[t]}</option>)}
                <option value="">Any type</option>
              </NativeSelect>
            </Field>
            <Button type="submit" loading={create.isPending} disabled={name.trim().length < 1}><Plus /> Add</Button>
          </form>
        )}
        <div className="grid max-h-[50vh] gap-3 overflow-y-auto">
          {groups.map((g) => (
            <div key={g.t ?? 'any'}>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.t ? PRODUCT_TYPE_LABELS[g.t] : 'Any type'}</p>
              <ul className="divide-y rounded-md border">
                {g.rows.map((c) => (
                  <li key={c.id} className={cn('flex items-center gap-2 px-3 py-2 text-sm', !c.isActive && 'text-muted-foreground')}>
                    {editing?.id === c.id ? (
                      <Input
                        autoFocus
                        aria-label={`New name for ${c.name}`}
                        className="h-8 flex-1"
                        value={editing.name}
                        maxLength={60}
                        onChange={(e) => setEditing({ id: c.id, name: e.target.value })}
                        onKeyDown={(e) => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') { e.stopPropagation(); setEditing(null); } }}
                        onBlur={saveName}
                      />
                    ) : (
                      <span className="flex-1">{c.name}{!c.isActive && ' (hidden)'}</span>
                    )}
                    <span className="text-xs text-muted-foreground tabular">{c.productCount ?? 0} product{c.productCount === 1 ? '' : 's'}</span>
                    {editable && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => setEditing({ id: c.id, name: c.name })}>Rename</Button>
                        <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: c.id, body: { isActive: !c.isActive } })}>{c.isActive ? 'Hide' : 'Show'}</Button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <DialogFooter><Button onClick={() => onOpenChange(false)}>Done</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Catalog() {
  const router = useRouter();
  const { can, currency } = useSession();
  const url = useUrlState();
  const tab = url.get('tab', 'shop');
  const categoryId = url.get('category');
  const [create, setCreate] = useState(url.get('new') === '1');
  const [managing, setManaging] = useState(false);
  const isType = (PRODUCT_TYPES as readonly string[]).includes(tab);
  const params = {
    q: url.get('q'),
    type: isType ? tab : undefined,
    kind: tab === 'shop' ? 'shop' : undefined,
    categoryId: categoryId || undefined,
    active: url.get('active', 'true'),
    page: Number(url.get('page', '1')),
    pageSize: 25,
  };
  const query = useQuery({ queryKey: ['products', params], queryFn: () => api.get<Paginated<Product>>(`/products${qs(params)}`), placeholderData: (p) => p });
  const categories = useQuery({ queryKey: ['product-categories'], queryFn: () => api.get<ProductCategory[]>('/product-categories') });
  const shownCategories = (categories.data ?? []).filter((c) => (isType ? c.productType === tab || !c.productType : tab === 'shop' ? c.productType !== 'MEDICINE' && c.productType !== 'VACCINE' : true));
  const canEdit = can('inventory.write') || can('formulary.manage');
  return (
    <>
      <PageHeader
        title="Products"
        description="Everything the clinic stocks and sells: food, grooming and accessories as well as medicines and supplies."
       
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setManaging(true)}><Tags /> Categories</Button>
            {canEdit && <Button size="sm" onClick={() => setCreate(true)}><Plus /> New product</Button>}
          </div>
        }
      />
      <SectionNav links={INVENTORY_LINKS} />
      <div className="mb-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Product type">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => url.set({ tab: t.key, category: null, page: 1 })}
            className={cn('shrink-0 rounded-full border px-3 py-1 text-sm', tab === t.key ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted')}
          >
            {t.label}
          </button>
        ))}
      </div>
      <Card>
        <div className="flex flex-col gap-2 border-b p-3 sm:flex-row">
          <SearchInput value={params.q} onChange={(q) => url.set({ q, page: 1 })} placeholder="Name, brand, SKU or barcode" />
          <NativeSelect aria-label="Category" className="sm:w-56" value={categoryId} onChange={(e) => url.set({ category: e.target.value, page: 1 })}>
            <option value="">All categories</option>
            {shownCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </NativeSelect>
          <NativeSelect aria-label="Status" className="sm:w-32" value={params.active} onChange={(e) => url.set({ active: e.target.value, page: 1 })}>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
            <option value="all">All</option>
          </NativeSelect>
        </div>
        <DataTable
          query={query}
          rowKey={(p) => p.id}
          onRowClick={(p) => router.push(`/inventory/products/${p.id}`)}
          page={params.page}
          onPage={(page) => url.set({ page })}
          empty={<EmptyState icon={Package} title="No products here yet" description={canEdit ? 'Use “New product” to add food, grooming items, accessories and more.' : undefined} />}
          columns={[
            {
              key: 'name',
              header: 'Product',
              cell: (p) => (
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {p.photoAttachmentId ? <img src={`/api/v1/attachments/${p.photoAttachmentId}/download?inline=1`} alt="" className="h-full w-full object-cover" /> : <Package className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0">
                    <Link href={`/inventory/products/${p.id}`} className="flex items-center gap-1 font-medium hover:underline">{p.name}{p.isControlled && <Lock className="h-3 w-3 text-warning" aria-label="Controlled" />}</Link>
                    <p className="truncate text-xs text-muted-foreground">{[p.brand, p.packSize, p.genericName].filter(Boolean).join(' · ')}</p>
                  </div>
                </div>
              ),
            },
            { key: 'type', header: 'Type', cell: (p) => <span className="text-sm">{PRODUCT_TYPE_LABELS[p.type as ProductType] ?? p.type}<span className="block text-xs text-muted-foreground">{p.productCategory?.name ?? ''}</span></span> },
            { key: 'codes', header: 'SKU / barcode', cell: (p) => <span className="font-mono text-xs text-muted-foreground">{[p.sku, p.barcode].filter(Boolean).join(' · ') || '—'}</span> },
            { key: 'price', header: 'Price', className: 'text-right tabular', headerClassName: 'text-right', cell: (p) => (p.sellPriceMinor != null ? `${fmtMoney(p.sellPriceMinor, currency)} / ${p.dispensingUnit}` : <span className="text-xs text-muted-foreground">no price</span>) },
            { key: 'st', header: 'Status', cell: (p) => <StatusBadge status={p.isActive ? 'ACTIVE' : 'ARCHIVED'} /> },
          ]}
        />
      </Card>
      {create && (
        <ProductDialog
          product={null}
          open={create}
          defaultType={isType ? (tab as ProductType) : undefined}
          onOpenChange={(o) => { setCreate(o); if (!o && url.get('new')) url.set({ new: null }); }}
          onSaved={(p) => router.push(`/inventory/products/${p.id}`)}
        />
      )}
      <CategoriesDialog open={managing} onOpenChange={setManaging} />
    </>
  );
}

export default function ProductCatalogPage() {
  return (
    <RequirePermission anyOf={['inventory.read', 'formulary.manage']}>
      <Suspense>
        <Catalog />
      </Suspense>
    </RequirePermission>
  );
}
