'use client';
import { useQuery } from '@tanstack/react-query';
import type { Paginated } from '@vcms/shared';
import { CLIENT_TYPES, enumLabel } from '@vcms/shared';
import { Download, UserPlus, Users } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Suspense } from 'react';
import { AccountBalance } from '@/components/billing/money';
import { DataTable, type Column } from '@/components/data-table';
import { EmptyState, PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { SearchInput } from '@/components/search-input';
import { StatusBadge } from '@/components/status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/input';
import { useUrlState } from '@/hooks/use-url-state';
import { api, qs } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { ClientRow } from '@/lib/types';

function ClientsList() {
  const router = useRouter();
  const { can, currency } = useSession();
  const url = useUrlState();
  const params = {
    q: url.get('q'),
    status: url.get('status', 'ACTIVE'),
    type: url.get('type'),
    sort: url.get('sort', 'displayName'),
    page: Number(url.get('page', '1')),
    pageSize: Number(url.get('pageSize', '25')),
  };
  const query = useQuery({
    queryKey: ['clients', params],
    queryFn: () => api.get<Paginated<ClientRow>>(`/clients${qs(params)}`),
    placeholderData: (prev) => prev,
  });

  const columns: Column<ClientRow>[] = [
    {
      key: 'name',
      header: 'Client',
      sortKey: 'displayName',
      cell: (c) => (
        <div className="min-w-0">
          <Link href={`/clients/${c.id}`} className="font-medium hover:underline">
            {c.displayName}
          </Link>
          <div className="text-xs text-muted-foreground">
            {c.clientNo}
            {c.type !== 'INDIVIDUAL' && <> · {enumLabel(c.type)}</>}
          </div>
        </div>
      ),
    },
    {
      key: 'contact',
      header: 'Contact',
      cell: (c) => (
        <div className="text-sm">
          <div>{c.mobilePhone ?? '—'}</div>
          <div className="max-w-[220px] truncate text-xs text-muted-foreground">{c.email}</div>
        </div>
      ),
    },
    {
      key: 'patients',
      header: 'Patients',
      cell: (c) =>
        c.patients.length ? (
          <div className="flex max-w-[320px] flex-wrap gap-1">
            {c.patients.slice(0, 4).map((p) => (
              <Badge key={p.id} variant={p.status === 'ACTIVE' ? 'secondary' : 'outline'} className="normal-case tracking-normal">
                {p.name} · {p.species}
              </Badge>
            ))}
            {c.patients.length > 4 && <span className="text-xs text-muted-foreground">+{c.patients.length - 4}</span>}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">None</span>
        ),
    },
    {
      key: 'balance',
      header: 'Amount owed',
      sortKey: 'balanceMinor',
      headerClassName: 'text-right',
      className: 'text-right tabular',
      cell: (c) => <AccountBalance minor={c.balanceMinor} currency={currency} />,
    },
    { key: 'status', header: 'Status', cell: (c) => <StatusBadge status={c.status} /> },
  ];

  return (
    <>
      <PageHeader
        help="register-client"
        title="Clients"
        description="People, families, farms and businesses you treat animals for"
        actions={
          <>
            {can('clients.export') && (
              <Button variant="outline" size="sm" asChild>
                <a href={`/api/v1/clients/export.csv${qs({ q: params.q, status: params.status, type: params.type })}`}>
                  <Download /> Export CSV
                </a>
              </Button>
            )}
            {can('clients.write') && (
              <Button size="sm" asChild>
                <Link href="/clients/new">
                  <UserPlus /> Add client
                </Link>
              </Button>
            )}
          </>
        }
      />
      <Card>
        <div className="flex flex-col gap-2 border-b p-3 sm:flex-row sm:items-center">
          <SearchInput value={params.q} onChange={(q) => url.set({ q, page: 1 })} placeholder="Search by name, patient or phone (e.g. 0300 77…)" />
          <NativeSelect aria-label="Client type" className="sm:w-40" value={params.type} onChange={(e) => url.set({ type: e.target.value, page: 1 })}>
            <option value="">All types</option>
            {CLIENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {enumLabel(t)}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect aria-label="Status" className="sm:w-36" value={params.status} onChange={(e) => url.set({ status: e.target.value, page: 1 })}>
            <option value="ACTIVE">Active</option>
            <option value="ARCHIVED">Archived</option>
            <option value="ALL">All</option>
          </NativeSelect>
        </div>
        <DataTable
          columns={columns}
          query={query}
          rowKey={(c) => c.id}
          onRowClick={(c) => router.push(`/clients/${c.id}`)}
          sort={params.sort}
          onSort={(sort) => url.set({ sort })}
          page={params.page}
          pageSize={params.pageSize}
          onPage={(page) => url.set({ page })}
          onPageSize={(pageSize) => url.set({ pageSize, page: 1 })}
          empty={
            <EmptyState
              icon={Users}
              title={params.q ? `No clients match “${params.q}”` : 'No clients yet'}
              description={params.q ? 'Check the spelling, or try the phone number or client number.' : 'Register your first client to get started.'}
              action={
                can('clients.write') && (
                  <Button size="sm" asChild>
                    <Link href="/clients/new">
                      <UserPlus /> Add client
                    </Link>
                  </Button>
                )
              }
            />
          }
        />
      </Card>
    </>
  );
}

export default function ClientsPage() {
  return (
    <RequirePermission anyOf={['clients.read']}>
      <Suspense>
        <ClientsList />
      </Suspense>
    </RequirePermission>
  );
}
