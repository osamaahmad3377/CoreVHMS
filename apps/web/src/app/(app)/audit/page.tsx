'use client';
import { useQuery } from '@tanstack/react-query';
import type { Paginated } from '@vcms/shared';
import { Download, ScrollText } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import { DataTable } from '@/components/data-table';
import { EmptyState, PageHeader } from '@/components/page';
import { Button } from '@/components/ui/button';
import { RequirePermission } from '@/components/require';
import { ChangeList } from '@/components/shared/history-panel';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input, NativeSelect } from '@/components/ui/input';
import { useUrlState } from '@/hooks/use-url-state';
import { api, qs } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import type { AuditEvent } from '@/lib/types';

const ENTITY_LINKS: Record<string, string> = { Client: '/clients/', Patient: '/patients/' };

function AuditLog() {
  const url = useUrlState();
  const params = {
    action: url.get('action'),
    entityType: url.get('entityType'),
    from: url.get('from'),
    to: url.get('to'),
    page: Number(url.get('page', '1')),
    pageSize: Number(url.get('pageSize', '50')),
  };
  const query = useQuery({
    queryKey: ['audit-log', params],
    queryFn: () =>
      api.get<Paginated<AuditEvent>>(
        `/audit-events${qs({ ...params, from: params.from ? new Date(params.from).toISOString() : undefined, to: params.to ? new Date(params.to + 'T23:59:59').toISOString() : undefined })}`,
      ),
    placeholderData: (p) => p,
  });
  return (
    <>
      <PageHeader
        title="Audit log"
        description="Append-only record of sign-ins, record access, changes, exports and administrative actions."
        actions={
          <Button size="sm" variant="outline" asChild>
            <a href={`/api/v1/audit-events/export.csv${qs({ action: params.action || undefined, entityType: params.entityType || undefined, from: params.from ? new Date(params.from).toISOString() : undefined, to: params.to ? new Date(params.to + 'T23:59:59').toISOString() : undefined })}`} download>
              <Download /> Export CSV
            </a>
          </Button>
        }
      />
      <Card>
        <div className="flex flex-col gap-2 border-b p-3 md:flex-row md:items-center">
          <NativeSelect aria-label="Action" className="md:w-52" value={params.action} onChange={(e) => url.set({ action: e.target.value, page: 1 })}>
            <option value="">All actions</option>
            <option value="auth.">Authentication</option>
            <option value="client.">Clients</option>
            <option value="patient.">Patients</option>
            <option value="patient.viewed">Patient record views</option>
            <option value="attachment.">Files</option>
            <option value="membership.">Staff accounts</option>
            <option value="role.">Roles</option>
            <option value="organization.">Organization</option>
            <option value="branch.">Branches</option>
            <option value="client.exported,client.data_exported,client.statement_exported,report.exported,audit.exported">Exports (all)</option>
            <option value="client.data_exported,client.anonymised">Privacy requests</option>
          </NativeSelect>
          <NativeSelect aria-label="Entity" className="md:w-40" value={params.entityType} onChange={(e) => url.set({ entityType: e.target.value, page: 1 })}>
            <option value="">All records</option>
            {['Client', 'Patient', 'User', 'Membership', 'Role', 'Branch', 'Organization', 'Session'].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </NativeSelect>
          <div className="flex items-center gap-2">
            <Input type="date" aria-label="From date" value={params.from} onChange={(e) => url.set({ from: e.target.value, page: 1 })} />
            <span className="text-xs text-muted-foreground">to</span>
            <Input type="date" aria-label="To date" value={params.to} onChange={(e) => url.set({ to: e.target.value, page: 1 })} />
          </div>
        </div>
        <DataTable
          query={query}
          rowKey={(e) => e.id}
          page={params.page}
          pageSize={params.pageSize}
          onPage={(page) => url.set({ page })}
          onPageSize={(pageSize) => url.set({ pageSize, page: 1 })}
          empty={<EmptyState icon={ScrollText} title="No events match these filters" />}
          columns={[
            { key: 'at', header: 'When', className: 'whitespace-nowrap text-xs', cell: (e) => fmtDateTime(e.createdAt) },
            { key: 'who', header: 'Who', cell: (e) => <span className="text-sm">{e.actorName ?? 'System'}</span> },
            {
              key: 'what',
              header: 'Action',
              cell: (e) => (
                <div className="max-w-[520px]">
                  <Badge variant={e.action.includes('failed') || e.action.includes('locked') ? 'destructive' : 'secondary'} className="font-mono normal-case tracking-normal">
                    {e.action}
                  </Badge>
                  {e.summary && <p className="mt-1 text-sm">{e.summary}</p>}
                  <ChangeList changes={e.changes} />
                </div>
              ),
            },
            {
              key: 'record',
              header: 'Record',
              cell: (e) =>
                e.entityId && ENTITY_LINKS[e.entityType] ? (
                  <Link href={`${ENTITY_LINKS[e.entityType]}${e.entityId}`} className="text-sm text-primary hover:underline">
                    {e.entityType}
                  </Link>
                ) : (
                  <span className="text-sm text-muted-foreground">{e.entityType}</span>
                ),
            },
            { key: 'ip', header: 'IP', cell: (e) => <span className="font-mono text-xs text-muted-foreground">{e.ip ?? '—'}</span> },
          ]}
        />
      </Card>
    </>
  );
}

export default function AuditPage() {
  return (
    <RequirePermission anyOf={['audit.read']}>
      <Suspense>
        <AuditLog />
      </Suspense>
    </RequirePermission>
  );
}
