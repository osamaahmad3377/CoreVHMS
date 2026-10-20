'use client';
import { useQuery } from '@tanstack/react-query';
import { enumLabel, type Paginated } from '@vcms/shared';
import { ChevronRight, History } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { PatientAppointments } from '../patients/patient-clinical-tabs';
import { TimelineTab } from '../patients/patient-timeline';
import { ErrorState, LoadingRows } from '../page';
import { Badge } from '../ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { api, qs } from '@/lib/api';
import { fmtDateTime, fmtWeight } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { Encounter, EncounterRow } from '@/lib/types';

const SECTIONS: { key: 'presentingComplaint' | 'history' | 'subjective' | 'objective' | 'assessment' | 'plan' | 'followUpInstructions'; label: string }[] = [
  { key: 'presentingComplaint', label: 'Presenting complaint' },
  { key: 'history', label: 'Past history' },
  { key: 'subjective', label: 'History from the owner' },
  { key: 'objective', label: 'Examination findings' },
  { key: 'assessment', label: 'Assessment' },
  { key: 'plan', label: 'Plan' },
  { key: 'followUpInstructions', label: 'Instructions for the owner' },
];

/** The patient's earlier consultations (not the one on screen), newest first. */
function usePreviousVisits(patientId: string, currentId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['encounters', 'patient', patientId],
    queryFn: () => api.get<Paginated<EncounterRow>>(`/encounters${qs({ patientId, pageSize: 100 })}`),
    enabled,
    select: (r) => r.data.filter((e) => e.id !== currentId && e.status !== 'CANCELLED'),
  });
}

/** What happened at one earlier visit, read-only: vitals, signed notes, diagnoses and open follow-ups. */
function VisitSummary({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['encounter', id], queryFn: () => api.get<Encounter>(`/encounters/${id}`) });
  if (q.isLoading) return <LoadingRows rows={3} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const e = q.data!;
  const notes = e.notes.filter((n) => n.status === 'SIGNED');
  const v = e.vitals[0];
  const vitals = v
    ? [
        v.temperatureC != null && `Temp ${v.temperatureC} °C`,
        v.heartRate != null && `Heart rate ${v.heartRate}`,
        v.respiratoryRate != null && `Breathing ${v.respiratoryRate}`,
        v.weightKg != null && `Weight ${fmtWeight(v.weightKg)}`,
      ].filter(Boolean)
    : [];
  return (
    <div className="grid gap-3 rounded-md border bg-muted/30 p-3 text-sm">
      {vitals.length > 0 && <p className="text-xs text-muted-foreground">{vitals.join(' · ')}</p>}
      {e.diagnoses.length > 0 && (
        <p>
          <span className="font-medium">Diagnosis: </span>
          {e.diagnoses.map((d) => d.term).join(', ')}
        </p>
      )}
      {notes.length ? (
        notes.map((n) => (
          <dl key={n.id} className="grid gap-2">
            {SECTIONS.filter((s) => n[s.key]).map((s) => (
              <div key={s.key}>
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{s.label}</dt>
                <dd className="whitespace-pre-wrap">{n[s.key]}</dd>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">Signed by {n.signedByName} · {fmtDateTime(n.signedAt)}</p>
          </dl>
        ))
      ) : (
        <p className="text-muted-foreground">No signed note for this visit.</p>
      )}
      <Link href={`/consultations/${e.id}`} className="w-fit text-xs text-primary underline">Open the full consultation</Link>
    </div>
  );
}

function PreviousVisits({ patientId, currentId }: { patientId: string; currentId: string }) {
  const q = usePreviousVisits(patientId, currentId, true);
  const [open, setOpen] = useState<string | null>(null);
  if (q.isLoading) return <LoadingRows rows={4} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data?.length) return <p className="py-6 text-center text-sm text-muted-foreground">No earlier consultations for this patient.</p>;
  return (
    <ul className="grid gap-2">
      {q.data.map((e) => {
        const expanded = open === e.id;
        return (
          <li key={e.id} className="rounded-lg border bg-card">
            <button type="button" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : e.id)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/50">
              <ChevronRight className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">
                  {fmtDateTime(e.startedAt)} · {enumLabel(e.type)}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {[e.chiefComplaint, e.diagnoses.map((d) => d.term).join(', '), e.clinician?.name].filter(Boolean).join(' — ') || '—'}
                </span>
              </span>
              <Badge variant={e.status === 'OPEN' ? 'warning' : 'success'}>{e.status === 'OPEN' ? 'In progress' : 'Finished'}</Badge>
            </button>
            {expanded && (
              <div className="px-3 pb-3">
                <VisitSummary id={e.id} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Whether the user may see any part of a patient's history. */
export function useCanSeeHistory() {
  const { canAny } = useSession();
  return canAny('clinical.read', 'appointments.read', 'patients.read');
}

/**
 * Dialog on the consultation screen to look through the patient's history without leaving the
 * visit: earlier consultations with their notes, past and upcoming appointments, and the full timeline
 * (vaccines, medicines, tests, hospital stays, billing and more). Each tab shows only what the user may see.
 */
export function PatientHistoryDialog({ patientId, patientName, currentId, open, onOpenChange }: { patientId: string; patientName: string; currentId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { can } = useSession();
  const visits = can('clinical.read');
  const appts = can('appointments.read');
  const timeline = can('patients.read');
  if (!visits && !appts && !timeline) return null;
  const first = visits ? 'visits' : appts ? 'appointments' : 'timeline';
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent size="xl" className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{patientName}’s history</DialogTitle>
            <DialogDescription>Earlier visits, appointments and everything recorded for this patient. Nothing here changes the current consultation.</DialogDescription>
          </DialogHeader>
          <Tabs defaultValue={first}>
            <TabsList>
              {visits && <TabsTrigger value="visits">Previous visits</TabsTrigger>}
              {appts && <TabsTrigger value="appointments">Appointments</TabsTrigger>}
              {timeline && <TabsTrigger value="timeline">Full timeline</TabsTrigger>}
            </TabsList>
            {visits && (
              <TabsContent value="visits">
                <PreviousVisits patientId={patientId} currentId={currentId} />
              </TabsContent>
            )}
            {appts && (
              <TabsContent value="appointments">
                <PatientAppointments patientId={patientId} />
              </TabsContent>
            )}
            {timeline && (
              <TabsContent value="timeline">
                <TimelineTab patientId={patientId} />
              </TabsContent>
            )}
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** One line under the patient banner: when this patient was last seen and for what, with a link to the full history. */
export function LastVisitStrip({ patientId, currentId, onOpenHistory }: { patientId: string; currentId: string; onOpenHistory: () => void }) {
  const { can } = useSession();
  const q = usePreviousVisits(patientId, currentId, can('clinical.read'));
  if (!can('clinical.read') || q.isLoading || q.error) return null;
  const last = q.data?.[0];
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-card px-3 py-2 text-sm">
      <History className="h-4 w-4 text-muted-foreground" />
      {last ? (
        <span className="min-w-0 flex-1">
          <span className="font-medium">Last seen {fmtDateTime(last.startedAt)}</span>
          <span className="text-muted-foreground">
            {' '}
            — {[last.chiefComplaint, last.diagnoses.map((d) => d.term).join(', ')].filter(Boolean).join(' · ') || enumLabel(last.type)}
            {last.clinician ? ` (${last.clinician.name})` : ''}
          </span>
        </span>
      ) : (
        <span className="flex-1 text-muted-foreground">First visit — no earlier consultations.</span>
      )}
      {last && (
        <button type="button" onClick={onOpenHistory} className="text-primary underline">
          View history
        </button>
      )}
    </div>
  );
}
