'use client';
import { useQuery } from '@tanstack/react-query';
import type { Paginated } from '@vcms/shared';
import { PRODUCT_TYPES, enumLabel } from '@vcms/shared';
import { Lock, Package, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Suspense, useState } from 'react';
import { DataTable } from '@/components/data-table';
import { EmptyState, PageHeader } from '@/components/page';
import { ProductDialog } from '@/components/pharmacy/product-dialog';
import { productStrength } from '@/components/pharmacy/product-picker';
import { RequirePermission } from '@/components/require';
import { SearchInput } from '@/components/search-input';
import { StatusBadge } from '@/components/status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/input';
import { useUrlState } from '@/hooks/use-url-state';
import { api, qs } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { Product } from '@/lib/types';

function Formulary() {
  const router = useRouter();
  const { can, currency } = useSession();
  const url = useUrlState();
  const [create, setCreate] = useState(false);
  const params = { q: url.get('q'), type: url.get('type'), active: url.get('active', 'true'), page: Number(url.get('page', '1')), pageSize: 25 };
  const query = useQuery({ queryKey: ['products', params], queryFn: () => api.get<Paginated<Product>>(`/products${qs(params)}`), placeholderData: (p) => p });
  return (
    <>
      <PageHeader
        title="Formulary"
        breadcrumbs={[{ label: 'Pharmacy', href: '/pharmacy' }, { label: 'Formulary' }]}
        description="Medicines, vaccines and consumables. Strength and dispensing units drive the dose calculator."
        actions={(can('formulary.manage') || can('inventory.write')) && <Button size="sm" onClick={() => setCreate(true)}><Plus /> New product</Button>}
      />
      <Card>
        <div className="flex flex-col gap-2 border-b p-3 sm:flex-row">
          <SearchInput value={params.q} onChange={(q) => url.set({ q, page: 1 })} placeholder="Name, generic, SKU, ingredient" />
          <NativeSelect aria-label="Type" className="sm:w-40" value={params.type} onChange={(e) => url.set({ type: e.target.value, page: 1 })}>
            <option value="">All types</option>
            {PRODUCT_TYPES.map((t) => <option key={t} value={t}>{enumLabel(t)}</option>)}
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
          onRowClick={(p) => router.push(`/pharmacy/formulary/${p.id}`)}
          page={params.page}
          onPage={(page) => url.set({ page })}
          empty={<EmptyState icon={Package} title="No products" description="Add medicines with their strength and dispensing unit to enable prescribing." />}
          columns={[
            { key: 'name', header: 'Product', cell: (p) => <div><Link href={`/pharmacy/formulary/${p.id}`} className="flex items-center gap-1 font-medium hover:underline">{p.name}{p.isControlled && <Lock className="h-3 w-3 text-warning" aria-label="Controlled" />}</Link><p className="text-xs text-muted-foreground">{p.genericName}</p></div> },
            { key: 'type', header: 'Type', cell: (p) => <span className="text-sm">{enumLabel(p.type)}{p.form && ` · ${enumLabel(p.form)}`}</span> },
            { key: 'str', header: 'Strength', cell: (p) => <span className="text-sm">{productStrength(p)}</span> },
            { key: 'refs', header: 'Dose refs', cell: (p) => (p._count?.doseReferences ? <Badge variant="success">{p._count.doseReferences} approved</Badge> : <span className="text-xs text-muted-foreground">none</span>) },
            { key: 'price', header: 'Price', cell: (p) => (p.sellPriceMinor != null ? `${fmtMoney(p.sellPriceMinor, currency)}/${p.dispensingUnit}` : '—') },
            { key: 'st', header: 'Status', cell: (p) => <StatusBadge status={p.isActive ? 'ACTIVE' : 'ARCHIVED'} /> },
          ]}
        />
      </Card>
      {create && <ProductDialog product={null} open={create} onOpenChange={setCreate} onSaved={(p) => router.push(`/pharmacy/formulary/${p.id}`)} />}
    </>
  );
}

export default function FormularyPage() {
  return (
    <RequirePermission anyOf={['formulary.manage', 'inventory.read', 'prescriptions.read']}>
      <Suspense>
        <Formulary />
      </Suspense>
    </RequirePermission>
  );
}
