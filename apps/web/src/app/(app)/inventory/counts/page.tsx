'use client';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ClipboardCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { INVENTORY_LINKS, SectionNav } from '@/components/billing/section-nav';
import { CommerceBadge } from '@/components/billing/status';
import { DataTable } from '@/components/data-table';
import { EmptyState, PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/input';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { StockCount, StockLocation } from '@/lib/types';

function Counts() {
  const router = useRouter();
  const { can } = useSession();
  const [locationId, setLocationId] = useState('');
  const query = useQuery({ queryKey: ['stock-counts'], queryFn: () => api.get<StockCount[]>('/stock/counts') });
  const locations = useQuery({ queryKey: ['stock-locations'], queryFn: () => api.get<StockLocation[]>('/stock-locations') });
  const start = useMutation({
    mutationFn: () => api.post<StockCount>('/stock/counts', { locationId }),
    onSuccess: (c) => router.push(`/inventory/counts/${c.id}`),
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <>
      <PageHeader
        help="stock-count"
        title="Stock counts"
       
        description="Count a location and post the differences as audited count adjustments."
        actions={
          can('inventory.adjust') && (
            <div className="flex gap-2">
              <NativeSelect aria-label="Location to count" className="h-8 w-48 text-sm" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                <option value="">Choose location…</option>
                {(locations.data ?? []).filter((l) => l.isActive).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </NativeSelect>
              <Button size="sm" disabled={!locationId} loading={start.isPending} onClick={() => start.mutate()}><ClipboardCheck /> Start count</Button>
            </div>
          )
        }
      />
      <SectionNav links={INVENTORY_LINKS} />
      <Card>
        <DataTable
          query={query}
          rowKey={(c) => c.id}
          onRowClick={(c) => router.push(`/inventory/counts/${c.id}`)}
          empty={<EmptyState icon={ClipboardCheck} title="No stock counts yet" />}
          columns={[
            { key: 'no', header: 'Count', cell: (c) => <Link className="font-medium hover:underline" href={`/inventory/counts/${c.id}`}>SC-{String(c.number).padStart(6, '0')}</Link> },
            { key: 'loc', header: 'Location', cell: (c) => <span className="text-sm">{c.location.name}</span> },
            { key: 'lines', header: 'Lines', cell: (c) => c._count?.lines ?? 0 },
            { key: 'start', header: 'Started', cell: (c) => <span className="text-xs">{fmtDateTime(c.createdAt)}<span className="block text-muted-foreground">{c.startedByName}</span></span> },
            { key: 'done', header: 'Completed', cell: (c) => <span className="text-xs">{c.completedAt ? <>{fmtDateTime(c.completedAt)}<span className="block text-muted-foreground">{c.completedByName}</span></> : '—'}</span> },
            { key: 'st', header: 'Status', cell: (c) => <CommerceBadge status={c.status} /> },
          ]}
        />
      </Card>
    </>
  );
}

export default function CountsPage() {
  return (
    <RequirePermission anyOf={['inventory.read']}>
      <Counts />
    </RequirePermission>
  );
}
