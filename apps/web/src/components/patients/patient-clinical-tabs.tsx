'use client';
import { useQuery } from '@tanstack/react-query';
import type { Paginated } from '@vcms/shared';
import { enumLabel } from '@vcms/shared';
import { CalendarDays, CalendarPlus, Stethoscope } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { DataTable } from '../data-table';
import { EmptyState } from '../page';
import { AppointmentDialog } from '../scheduling/appointment-dialog';
import { AppointmentStatusBadge } from '../scheduling/appointment-status';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { api, qs } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import { branchTime } from '@/lib/time';
import type { Appointment, EncounterRow } from '@/lib/types';

export function PatientVisits({ patientId }: { patientId: string }) {
  const q = useQuery({ queryKey: ['encounters', 'patient', patientId], queryFn: () => api.get<Paginated<EncounterRow>>(`/encounters${qs({ patientId, pageSize: 100 })}`) });
  return (
    <Card>
      <DataTable
        query={q}
        rowKey={(e) => e.id}
        empty={<EmptyState icon={Stethoscope} title="No consultations yet" />}
        columns={[
          { key: 'when', header: 'Date', cell: (e) => <Link href={`/consultations/${e.id}`} className="whitespace-nowrap font-medium hover:underline">{fmtDateTime(e.startedAt)}</Link> },
          { key: 'type', header: 'Visit', cell: (e) => <span className="text-sm">{enumLabel(e.type)}{e.chiefComplaint && <span className="block text-xs text-muted-foreground">{e.chiefComplaint}</span>}</span> },
          { key: 'dx', header: 'Diagnoses', cell: (e) => <span className="text-xs">{e.diagnoses.map((d) => d.term).join(', ') || '—'}</span> },
          { key: 'clin', header: 'Clinician', cell: (e) => <span className="text-sm">{e.clinician?.name ?? '—'}</span> },
          { key: 'notes', header: 'Notes', cell: (e) => (e.noteStatus === 'SIGNED' ? <Badge variant="success">Signed</Badge> : e.noteStatus === 'UNSIGNED' ? <Badge variant="warning">Unsigned</Badge> : <Badge variant="outline">None</Badge>) },
          { key: 'st', header: 'Status', cell: (e) => <Badge variant={e.status === 'OPEN' ? 'warning' : e.status === 'COMPLETED' ? 'success' : 'outline'}>{enumLabel(e.status)}</Badge> },
        ]}
      />
    </Card>
  );
}

/** `onBook` is passed only when the user may book for this patient; it turns the empty state into a next step. */
export function PatientAppointments({ patientId, onBook }: { patientId: string; onBook?: () => void }) {
  const { session } = useSession();
  const tz = session.branch?.timezone ?? 'UTC';
  const [selected, setSelected] = useState<string | null>(null);
  const from = new Date(Date.now() - 365 * 86400_000);
  const q = useQuery({
    queryKey: ['appointments', 'patient', patientId],
    queryFn: async () => {
      // the API limits ranges to 62 days, so fetch the past year and the next 60 days in windows
      const windows: [Date, Date][] = [];
      for (let t = from.getTime(); t < Date.now() + 60 * 86400_000; t += 60 * 86400_000) windows.push([new Date(t), new Date(t + 60 * 86400_000)]);
      const parts = await Promise.all(windows.map(([a, b]) => api.get<Appointment[]>(`/appointments${qs({ patientId, from: a.toISOString(), to: b.toISOString() })}`)));
      const seen = new Set<string>();
      return parts.flat().filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true))).sort((a, b) => b.startsAt.localeCompare(a.startsAt));
    },
  });
  return (
    <Card>
      <DataTable
        query={q}
        rowKey={(a) => a.id}
        onRowClick={(a) => setSelected(a.id)}
        empty={
          <EmptyState
            icon={CalendarDays}
            title="No appointments in the last year"
            action={
              onBook && (
                <Button size="sm" onClick={onBook}>
                  <CalendarPlus /> Book appointment
                </Button>
              )
            }
          />
        }
        columns={[
          { key: 'when', header: 'When', cell: (a) => <span className="whitespace-nowrap font-medium">{branchTime(a.startsAt, tz, 'd MMM yyyy, HH:mm')}</span> },
          { key: 'type', header: 'Type', cell: (a) => <span className="flex items-center gap-2 text-sm"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: a.appointmentType.color }} />{a.appointmentType.name}</span> },
          { key: 'clin', header: 'Clinician', cell: (a) => <span className="text-sm">{a.clinician?.name ?? '—'}</span> },
          { key: 'reason', header: 'Reason', cell: (a) => <span className="text-xs">{a.reason ?? a.cancelReason ?? ''}</span> },
          { key: 'st', header: 'Status', cell: (a) => <AppointmentStatusBadge status={a.status} /> },
        ]}
      />
      <AppointmentDialog id={selected} open={!!selected} onOpenChange={(o) => !o && setSelected(null)} />
    </Card>
  );
}
