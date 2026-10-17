'use client';
import { useQuery } from '@tanstack/react-query';
import { MOVEMENT_TYPES, enumLabel, type Paginated } from '@vcms/shared';
import { Suspense } from 'react';
import { INVENTORY_LINKS, SectionNav } from '@/components/billing/section-nav';
import { MovementsTable } from '@/components/inventory/movements-table';
import { PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Card } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/input';
import { useUrlState } from '@/hooks/use-url-state';
import { api, qs } from '@/lib/api';
import type { StockLocation, StockMovement } from '@/lib/types';

function Movements() {
  const url = useUrlState();
  const params = { type: url.get('type'), locationId: url.get('locationId'), page: Number(url.get('page', '1')), pageSize: 50 };
  const query = useQuery({ queryKey: ['stock-movements', params], queryFn: () => api.get<Paginated<StockMovement>>(`/stock/movements${qs(params)}`), placeholderData: (p) => p });
  const locations = useQuery({ queryKey: ['stock-locations'], queryFn: () => api.get<StockLocation[]>('/stock-locations') });
  return (
    <>
      <PageHeader title="Stock movements" description="Every stock change: deliveries, sales, medicines given and counts. Nothing here can be edited." />
      <SectionNav links={INVENTORY_LINKS} />
      <Card>
        <div className="flex flex-col gap-2 border-b p-3 sm:flex-row">
          <NativeSelect aria-label="Movement type" className="sm:w-56" value={params.type} onChange={(e) => url.set({ type: e.target.value, page: 1 })}>
            <option value="">All movement types</option>
            {MOVEMENT_TYPES.map((t) => <option key={t} value={t}>{enumLabel(t)}</option>)}
          </NativeSelect>
          <NativeSelect aria-label="Location" className="sm:w-48" value={params.locationId} onChange={(e) => url.set({ locationId: e.target.value, page: 1 })}>
            <option value="">All locations</option>
            {(locations.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </NativeSelect>
        </div>
        <MovementsTable query={query} page={params.page} onPage={(page) => url.set({ page })} />
      </Card>
    </>
  );
}

export default function MovementsPage() {
  return (
    <RequirePermission anyOf={['inventory.read']}>
      <Suspense><Movements /></Suspense>
    </RequirePermission>
  );
}
