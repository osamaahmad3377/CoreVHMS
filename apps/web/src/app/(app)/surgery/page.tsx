'use client';
import { useQuery } from '@tanstack/react-query';
import { Plus, Scissors } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { SurgeryStatusBadge } from '@/components/hospital/badges';
import { DataTable } from '@/components/data-table';
import { EmptyState, PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { ScheduleSurgeryDialog } from '@/components/surgery/schedule-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useUrlState } from '@/hooks/use-url-state';
import { api, qs } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import { branchTime, shiftDate, todayIn, zonedInstant } from '@/lib/time';
import type { PatientRow, Surgery } from '@/lib/types';
import { cn } from '@/lib/utils';

const RANGES = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'Next 7 days' },
  { key: 'active', label: 'In progress' },
  { key: 'past', label: 'Past 30 days' },
];

function SurgeryList() {
  const router = useRouter();
  const search = useSearchParams();
  const { can, session } = useSession();
  const tz = session.branch?.timezone ?? 'UTC';
  const url = useUrlState();
  const range = url.get('range', 'today');
  const today = todayIn(tz);
  const params =
    range === 'today' ? { from: zonedInstant(today, 0, tz).toISOString(), to: zonedInstant(shiftDate(today, 1), 0, tz).toISOString() }
    : range === 'week' ? { from: zonedInstant(today, 0, tz).toISOString(), to: zonedInstant(shiftDate(today, 7), 0, tz).toISOString() }
    : range === 'active' ? { status: 'PRE_OP,IN_PROGRESS,RECOVERY' }
    : { from: zonedInstant(shiftDate(today, -30), 0, tz).toISOString(), to: zonedInstant(shiftDate(today, 1), 0, tz).toISOString() };
  const q = useQuery({ queryKey: ['surgeries', params], queryFn: () => api.get<Surgery[]>(`/surgeries${qs(params)}`), refetchInterval: 60_000 });

  // Deep link from a patient or hospital stay: /surgery?schedule=<patientId>&admission=<id>
  const presetId = search.get('schedule');
  const preset = useQuery({ queryKey: ['patient', presetId], queryFn: () => api.get<PatientRow>(`/patients/${presetId}`), enabled: !!presetId });
  const [scheduling, setScheduling] = useState(false);
  useEffect(() => { if (presetId && preset.data) setScheduling(true); }, [presetId, preset.data]);

  return (
    <>
      <PageHeader
        title="Surgery"
        help="surgery"
        description="Theatre list, pre-op checks, anaesthesia monitoring and surgical reports."
        actions={can('surgery.write') && <Button size="sm" onClick={() => setScheduling(true)}><Plus /> Schedule surgery</Button>}
      />
      <Card>
        <div className="flex flex-wrap gap-1 border-b p-3" role="tablist">
          {RANGES.map((r) => (
            <button key={r.key} role="tab" aria-selected={range === r.key} onClick={() => url.set({ range: r.key })} className={cn('rounded-md px-3 py-1.5 text-sm', range === r.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}>{r.label}</button>
          ))}
        </div>
        <DataTable
          query={q}
          rowKey={(s) => s.id}
          onRowClick={(s) => router.push(`/surgery/${s.id}`)}
          empty={<EmptyState icon={Scissors} title="No surgeries in this period" />}
          columns={[
            { key: 'when', header: 'When', cell: (s) => <span className="whitespace-nowrap text-sm"><b className="tabular">{branchTime(s.scheduledAt, tz)}</b>{range !== 'today' && <span className="block text-xs text-muted-foreground">{fmtDate(s.scheduledAt)}</span>}</span> },
            { key: 'patient', header: 'Patient', cell: (s) => <div><Link href={`/surgery/${s.id}`} className="font-medium hover:underline">{s.patient.name}</Link><p className="text-xs text-muted-foreground">{s.patient.species.name} · {s.client.displayName}</p></div> },
            { key: 'proc', header: 'Procedure', cell: (s) => <span className="text-sm">{s.procedure}{s.priority !== 'ELECTIVE' && <Badge variant={s.priority === 'EMERGENCY' ? 'destructive' : 'warning'} className="ml-2">{s.priority.toLowerCase()}</Badge>}</span> },
            { key: 'theatre', header: 'Theatre', cell: (s) => <span className="text-sm">{s.theatre?.name ?? '—'}</span> },
            { key: 'team', header: 'Surgeon', cell: (s) => <span className="text-sm">{s.team.filter((t) => t.role === 'SURGEON').map((t) => t.name).join(', ')}</span> },
            { key: 'checks', header: 'Ready', cell: (s) => <span className="text-xs text-muted-foreground">{s.consentObtained ? 'Consent ✓' : 'No consent'} · {s.checklist.filter((c) => c.checked).length}/{s.checklist.length} checks</span> },
            { key: 'st', header: 'Status', cell: (s) => <SurgeryStatusBadge status={s.status} /> },
          ]}
        />
      </Card>
      <ScheduleSurgeryDialog
        open={scheduling}
        onOpenChange={(o) => { setScheduling(o); if (!o && presetId) url.set({ schedule: null, admission: null }); }}
        patient={presetId && preset.data ? (preset.data as never) : null}
        admissionId={search.get('admission')}
      />
    </>
  );
}

export default function SurgeryPage() {
  return (
    <RequirePermission anyOf={['surgery.read']}>
      <Suspense><SurgeryList /></Suspense>
    </RequirePermission>
  );
}
