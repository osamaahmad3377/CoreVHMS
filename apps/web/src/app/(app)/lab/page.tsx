'use client';
import { useQuery } from '@tanstack/react-query';
import type { Paginated } from '@vcms/shared';
import { enumLabel } from '@vcms/shared';
import { AlertOctagon, ArrowRight, FlaskConical, Settings2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Suspense } from 'react';
import { DataTable } from '@/components/data-table';
import { LabStatusBadge } from '@/components/lab/lab-status';
import { EmptyState, PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { SearchInput } from '@/components/search-input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useUrlState } from '@/hooks/use-url-state';
import { api, qs } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { DiagnosticOrder } from '@/lib/types';
import { cn } from '@/lib/utils';

const TABS = [
  { key: 'ORDERED', label: 'To collect' },
  { key: 'COLLECTED,IN_PROGRESS', label: 'In progress' },
  { key: 'AWAITING_VALIDATION', label: 'Awaiting validation' },
  { key: 'RELEASED', label: 'Released' },
  { key: 'critical', label: 'Critical' },
  { key: '', label: 'All' },
];

function Worklist() {
  const router = useRouter();
  const { can } = useSession();
  const url = useUrlState();
  const tab = url.get('tab', 'ORDERED');
  const params = { status: tab === 'critical' ? undefined : tab || undefined, critical: tab === 'critical' ? 'true' : undefined, q: url.get('q'), page: Number(url.get('page', '1')), pageSize: 25 };
  const query = useQuery({ queryKey: ['lab-orders', params], queryFn: () => api.get<Paginated<DiagnosticOrder>>(`/lab-orders${qs(params)}`), refetchInterval: 30_000, placeholderData: (p) => p });
  return (
    <>
      <PageHeader
        help="lab"
        title="Lab & X-ray"
        description="Sample collection, result entry, validation and release"
        actions={can('settings.manage') && <Button size="sm" variant="outline" asChild><Link href="/lab/catalogue"><Settings2 /> Test catalogue</Link></Button>}
      />
      <Card>
        <div className="flex flex-col gap-2 border-b p-3 lg:flex-row lg:items-center">
          <div className="flex flex-wrap gap-1" role="tablist">
            {TABS.map((t) => (
              <button key={t.label} role="tab" aria-selected={tab === t.key} onClick={() => url.set({ tab: t.key || null, page: 1 })} className={cn('rounded-md px-3 py-1.5 text-sm', tab === t.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}>
                {t.label}
              </button>
            ))}
          </div>
          <SearchInput className="lg:ml-auto" value={params.q} onChange={(q) => url.set({ q, page: 1 })} placeholder="Patient, test or sample barcode" />
        </div>
        <DataTable
          query={query}
          rowKey={(o) => o.id}
          onRowClick={(o) => router.push(`/lab/orders/${o.id}`)}
          page={params.page}
          onPage={(page) => url.set({ page })}
          empty={<EmptyState icon={FlaskConical} title="Nothing in this list" />}
          columns={[
            { key: 'no', header: 'Order', cell: (o) => <span className="flex items-center gap-1 font-medium">{o.hasCritical && <AlertOctagon className="h-4 w-4 text-destructive" aria-label="Critical" />}{o.orderNo}</span> },
            { key: 'pt', header: 'Patient', cell: (o) => <div><p className="text-sm font-medium">{o.patient.name} <span className="font-normal text-muted-foreground">· {o.patient.species.name}</span></p><p className="text-xs text-muted-foreground">{o.client.displayName}</p></div> },
            { key: 'tests', header: 'Tests', cell: (o) => <span className="text-sm">{o.items.map((i) => i.test.name).join(', ')}</span> },
            { key: 'pri', header: 'Priority', cell: (o) => (o.priority === 'ROUTINE' ? <span className="text-xs text-muted-foreground">Routine</span> : <Badge variant="destructive">{enumLabel(o.priority)}</Badge>) },
            { key: 'samples', header: 'Samples', cell: (o) => <span className="font-mono text-xs">{o.samples.map((s) => s.barcode).join(', ') || '—'}</span> },
            { key: 'when', header: 'Ordered', cell: (o) => <span className="whitespace-nowrap text-xs">{fmtDateTime(o.createdAt)} · {o.orderedByName}</span> },
            { key: 'st', header: 'Status', cell: (o) => <LabStatusBadge status={o.status} /> },
            {
              key: 'open',
              header: '',
              cell: (o) => (
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/lab/orders/${o.id}`} onClick={(e) => e.stopPropagation()}>
                    Open <ArrowRight />
                  </Link>
                </Button>
              ),
            },
          ]}
        />
      </Card>
    </>
  );
}

export default function LabPage() {
  return (
    <RequirePermission anyOf={['lab.read']}>
      <Suspense>
        <Worklist />
      </Suspense>
    </RequirePermission>
  );
}
