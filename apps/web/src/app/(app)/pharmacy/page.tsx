'use client';
import { useQuery } from '@tanstack/react-query';
import type { Paginated } from '@vcms/shared';
import { BookOpen, Pill } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Suspense } from 'react';
import { DataTable } from '@/components/data-table';
import { EmptyState, PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { SearchInput } from '@/components/search-input';
import { AlertChip } from '@/components/status';
import { RxStatusBadge } from '@/components/pharmacy/rx-status';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useUrlState } from '@/hooks/use-url-state';
import { api, qs } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { Prescription } from '@/lib/types';
import { cn } from '@/lib/utils';


const TABS = [
  { key: 'DRAFT', label: 'Awaiting authorisation' },
  { key: 'AUTHORIZED,PARTIALLY_DISPENSED', label: 'Ready to dispense' },
  { key: 'DISPENSED', label: 'Dispensed' },
  { key: 'CANCELLED', label: 'Cancelled' },
  { key: '', label: 'All' },
];

function Worklist() {
  const router = useRouter();
  const { can } = useSession();
  const url = useUrlState();
  const params = { status: url.get('status', 'AUTHORIZED,PARTIALLY_DISPENSED'), q: url.get('q'), page: Number(url.get('page', '1')), pageSize: 25 };
  const query = useQuery({ queryKey: ['prescriptions', params], queryFn: () => api.get<Paginated<Prescription>>(`/prescriptions${qs(params)}`), refetchInterval: 30_000, placeholderData: (p) => p });
  return (
    <>
      <PageHeader
        help="dispense"
        title="Prescriptions & pharmacy"
        description="Authorise, dispense and track prescriptions"
        actions={
          (can('formulary.manage') || can('inventory.read')) && (
            <Button size="sm" variant="outline" asChild>
              <Link href="/pharmacy/formulary"><BookOpen /> Formulary</Link>
            </Button>
          )
        }
      />
      <Card>
        <div className="flex flex-col gap-2 border-b p-3 lg:flex-row lg:items-center">
          <div className="flex flex-wrap gap-1" role="tablist">
            {TABS.map((t) => (
              <button key={t.label} role="tab" aria-selected={params.status === t.key} onClick={() => url.set({ status: t.key || null, page: 1 })} className={cn('rounded-md px-3 py-1.5 text-sm', params.status === t.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}>
                {t.label}
              </button>
            ))}
          </div>
          <SearchInput className="lg:ml-auto" value={params.q} onChange={(q) => url.set({ q, page: 1 })} placeholder="Patient, owner or medicine" />
        </div>
        <DataTable
          query={query}
          rowKey={(r) => r.id}
          onRowClick={(r) => router.push(`/pharmacy/prescriptions/${r.id}`)}
          page={params.page}
          onPage={(page) => url.set({ page })}
          empty={<EmptyState icon={Pill} title="No prescriptions here" />}
          columns={[
            { key: 'no', header: 'Rx', cell: (r) => <Link href={`/pharmacy/prescriptions/${r.id}`} className="font-medium hover:underline">{r.prescriptionNo}</Link> },
            { key: 'patient', header: 'Patient', cell: (r) => <div><p className="text-sm font-medium">{r.patient.name} <span className="font-normal text-muted-foreground">· {r.patient.species.name}</span></p><p className="text-xs text-muted-foreground">{r.client.displayName}</p></div> },
            { key: 'items', header: 'Medicines', cell: (r) => <span className="text-sm">{r.items.map((i) => i.product.name).join(', ')}</span> },
            { key: 'alerts', header: '', cell: (r) => <div className="flex gap-1">{r.patient.alerts.filter((a) => a.type === 'ALLERGY').slice(0, 1).map((a) => <AlertChip key={a.id} alert={a} />)}</div> },
            { key: 'by', header: 'Prescriber', cell: (r) => <span className="text-sm">{r.prescriber?.name ?? r.createdByName}</span> },
            { key: 'when', header: 'Created', cell: (r) => <span className="whitespace-nowrap text-xs">{fmtDateTime(r.createdAt)}</span> },
            { key: 'st', header: 'Status', cell: (r) => <RxStatusBadge status={r.status} /> },
          ]}
        />
      </Card>
    </>
  );
}

export default function PharmacyPage() {
  return (
    <RequirePermission anyOf={['prescriptions.read', 'pharmacy.dispense']}>
      <Suspense>
        <Worklist />
      </Suspense>
    </RequirePermission>
  );
}
