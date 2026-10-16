'use client';
import { useQuery } from '@tanstack/react-query';
import type { Paginated } from '@vcms/shared';
import { enumLabel } from '@vcms/shared';
import { Plus, Stethoscope } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Suspense, useState } from 'react';
import { DataTable } from '@/components/data-table';
import { EmptyState, PageHeader } from '@/components/page';
import { StartConsultationDialog } from '@/components/clinical/start-consultation-dialog';
import { RequirePermission } from '@/components/require';
import { SearchInput } from '@/components/search-input';
import { AlertChip } from '@/components/status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { NativeSelect } from '@/components/ui/input';
import { useUrlState } from '@/hooks/use-url-state';
import { api, qs } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { EncounterRow } from '@/lib/types';

function ConsultationsList() {
  const router = useRouter();
  const { can } = useSession();
  const url = useUrlState();
  const [start, setStart] = useState(false);
  const params = {
    q: url.get('q'),
    status: url.get('status', 'OPEN'),
    mine: url.get('mine') === 'true' ? 'true' : undefined,
    page: Number(url.get('page', '1')),
    pageSize: Number(url.get('pageSize', '25')),
  };
  const query = useQuery({ queryKey: ['encounters', params], queryFn: () => api.get<Paginated<EncounterRow>>(`/encounters${qs(params)}`), placeholderData: (p) => p });
  return (
    <>
      <PageHeader
        help="consultation"
        title="Consultations"
        description="Clinical encounters and their documentation status"
        actions={
          can('clinical.write') && (
            <Button size="sm" onClick={() => setStart(true)}>
              <Plus /> Start consultation
            </Button>
          )
        }
      />
      <Card>
        <div className="flex flex-col gap-2 border-b p-3 sm:flex-row sm:items-center">
          <SearchInput value={params.q} onChange={(q) => url.set({ q, page: 1 })} placeholder="Patient, owner or complaint" />
          <NativeSelect aria-label="Status" className="sm:w-40" value={params.status} onChange={(e) => url.set({ status: e.target.value, page: 1 })}>
            <option value="OPEN">Open</option>
            <option value="COMPLETED">Completed</option>
            <option value="CANCELLED">Cancelled</option>
            <option value="ALL">All</option>
          </NativeSelect>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={params.mine === 'true'} onCheckedChange={(v) => url.set({ mine: v === true ? 'true' : null, page: 1 })} /> Only mine
          </label>
        </div>
        <DataTable
          query={query}
          rowKey={(e) => e.id}
          onRowClick={(e) => router.push(`/consultations/${e.id}`)}
          page={params.page}
          pageSize={params.pageSize}
          onPage={(page) => url.set({ page })}
          onPageSize={(pageSize) => url.set({ pageSize, page: 1 })}
          empty={<EmptyState icon={Stethoscope} title="No consultations match" />}
          columns={[
            {
              key: 'patient',
              header: 'Patient',
              cell: (e) => (
                <div>
                  <Link href={`/consultations/${e.id}`} className="font-medium hover:underline">
                    {e.patient.name}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {e.patient.species.name} · {e.client.displayName}
                  </p>
                </div>
              ),
            },
            {
              key: 'visit',
              header: 'Visit',
              cell: (e) => (
                <div className="text-sm">
                  {enumLabel(e.type)}
                  {e.chiefComplaint && <p className="max-w-[260px] truncate text-xs text-muted-foreground">{e.chiefComplaint}</p>}
                </div>
              ),
            },
            { key: 'dx', header: 'Diagnoses', cell: (e) => <span className="text-xs">{e.diagnoses.map((d) => d.term).join(', ') || '—'}</span> },
            { key: 'clin', header: 'Clinician', cell: (e) => <span className="text-sm">{e.clinician?.name ?? '—'}</span> },
            { key: 'when', header: 'Started', cell: (e) => <span className="whitespace-nowrap text-xs">{fmtDateTime(e.startedAt)}</span> },
            {
              key: 'notes',
              header: 'Notes',
              cell: (e) =>
                e.noteStatus === 'SIGNED' ? <Badge variant="success">Signed</Badge> : e.noteStatus === 'UNSIGNED' ? <Badge variant="warning">Unsigned</Badge> : <Badge variant="outline">None</Badge>,
            },
            { key: 'alerts', header: '', cell: (e) => <div className="flex gap-1">{e.patient.alerts.filter((a) => a.severity === 'CRITICAL').slice(0, 1).map((a) => <AlertChip key={a.id} alert={a} />)}</div> },
            { key: 'status', header: 'Status', cell: (e) => <Badge variant={e.status === 'OPEN' ? 'warning' : e.status === 'COMPLETED' ? 'success' : 'outline'}>{enumLabel(e.status)}</Badge> },
          ]}
        />
      </Card>
      <StartConsultationDialog open={start} onOpenChange={setStart} />
    </>
  );
}

export default function ConsultationsPage() {
  return (
    <RequirePermission anyOf={['clinical.read']}>
      <Suspense>
        <ConsultationsList />
      </Suspense>
    </RequirePermission>
  );
}
