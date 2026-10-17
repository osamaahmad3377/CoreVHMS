'use client';
import { useQuery } from '@tanstack/react-query';
import type { Paginated } from '@vcms/shared';
import { enumLabel } from '@vcms/shared';
import { PawPrint, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Suspense } from 'react';
import { DataTable, type Column } from '@/components/data-table';
import { EmptyState, PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { SearchInput } from '@/components/search-input';
import { AlertChip, StatusBadge } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/input';
import { useUrlState } from '@/hooks/use-url-state';
import { api, qs } from '@/lib/api';
import { fmtAge, fmtWeight } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { PatientRow, Species } from '@/lib/types';

function PatientsList() {
  const router = useRouter();
  const { can } = useSession();
  const url = useUrlState();
  const params = {
    q: url.get('q'),
    status: url.get('status', 'ACTIVE'),
    speciesId: url.get('speciesId'),
    sort: url.get('sort', 'name'),
    page: Number(url.get('page', '1')),
    pageSize: Number(url.get('pageSize', '25')),
  };
  const species = useQuery({ queryKey: ['species'], queryFn: () => api.get<Species[]>('/species'), staleTime: 300_000 });
  const query = useQuery({
    queryKey: ['patients', params],
    queryFn: () => api.get<Paginated<PatientRow>>(`/patients${qs(params)}`),
    placeholderData: (prev) => prev,
  });

  const columns: Column<PatientRow>[] = [
    {
      key: 'name',
      header: 'Patient',
      sortKey: 'name',
      cell: (p) => (
        <div>
          <Link href={`/patients/${p.id}`} className="font-medium hover:underline">
            {p.name}
          </Link>
          <div className="text-xs text-muted-foreground">{p.patientNo}</div>
        </div>
      ),
    },
    {
      key: 'species',
      header: 'Species / breed',
      cell: (p) => (
        <div className="text-sm">
          {p.species.name}
          <div className="text-xs text-muted-foreground">{p.breed ?? '—'}</div>
        </div>
      ),
    },
    { key: 'sex', header: 'Sex', cell: (p) => <span className="text-sm">{enumLabel(p.sex)}</span> },
    { key: 'age', header: 'Age', sortKey: 'dateOfBirth', cell: (p) => <span className="tabular text-sm">{fmtAge(p.dateOfBirth, p.dobEstimated)}</span> },
    { key: 'weight', header: 'Weight', cell: (p) => <span className="tabular text-sm">{fmtWeight(p.latestWeightKg)}</span> },
    {
      key: 'owner',
      header: 'Owner',
      cell: (p) =>
        p.owner ? (
          <Link href={`/clients/${p.owner.id}`} className="text-sm hover:underline">
            {p.owner.displayName}
          </Link>
        ) : (
          '—'
        ),
    },
    {
      key: 'alerts',
      header: 'Alerts',
      cell: (p) => (
        <div className="flex max-w-[240px] flex-wrap gap-1">
          {p.alerts.slice(0, 2).map((a) => (
            <AlertChip key={a.id} alert={a} />
          ))}
          {p.alerts.length > 2 && <span className="text-xs text-muted-foreground">+{p.alerts.length - 2}</span>}
        </div>
      ),
    },
    { key: 'status', header: 'Status', cell: (p) => <StatusBadge status={p.status} /> },
  ];

  return (
    <>
      <PageHeader
        title="Patients"
        description="Every animal under the practice's care"
        actions={
          can('patients.write') && (
            <Button size="sm" asChild>
              <Link href="/patients/new">
                <Plus /> Add patient
              </Link>
            </Button>
          )
        }
      />
      <Card>
        <div className="flex flex-col gap-2 border-b p-3 sm:flex-row sm:items-center">
          <SearchInput value={params.q} onChange={(q) => url.set({ q, page: 1 })} placeholder="Name, owner, microchip/tag or P-number" />
          <NativeSelect aria-label="Species" className="sm:w-44" value={params.speciesId} onChange={(e) => url.set({ speciesId: e.target.value, page: 1 })}>
            <option value="">All species</option>
            {species.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect aria-label="Status" className="sm:w-36" value={params.status} onChange={(e) => url.set({ status: e.target.value, page: 1 })}>
            <option value="ACTIVE">Active</option>
            <option value="DECEASED">Deceased</option>
            <option value="TRANSFERRED">Transferred</option>
            <option value="ARCHIVED">Archived</option>
            <option value="ALL">All</option>
          </NativeSelect>
        </div>
        <DataTable
          columns={columns}
          query={query}
          rowKey={(p) => p.id}
          onRowClick={(p) => router.push(`/patients/${p.id}`)}
          sort={params.sort}
          onSort={(sort) => url.set({ sort })}
          page={params.page}
          pageSize={params.pageSize}
          onPage={(page) => url.set({ page })}
          onPageSize={(pageSize) => url.set({ pageSize, page: 1 })}
          empty={
            <EmptyState
              icon={PawPrint}
              title={params.q ? `No patients match “${params.q}”` : 'No patients'}
              description="Search by animal name, owner surname, microchip, ear tag or patient number."
            />
          }
        />
      </Card>
    </>
  );
}

export default function PatientsPage() {
  return (
    <RequirePermission anyOf={['patients.read']}>
      <Suspense>
        <PatientsList />
      </Suspense>
    </RequirePermission>
  );
}
