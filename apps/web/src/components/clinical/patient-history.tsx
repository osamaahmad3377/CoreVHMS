'use client';
import { useQuery } from '@tanstack/react-query';
import { enumLabel, type Paginated } from '@vcms/shared';
import { ArrowLeft, ChevronRight, ExternalLink, History } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { PatientAppointments } from '../patients/patient-clinical-tabs';
import { ConsultationCharges } from './charges-card';
import { DiagnosesPanel } from './diagnoses-panel';
import { NoteView } from './note-view';
import { AdministrationsPanel, LabOrdersPanel, PrescriptionsPanel } from './orders-panels';
import { VitalsPanel } from './vitals-panel';
import { Card, CardContent } from '../ui/card';
import { TimelineTab } from '../patients/patient-timeline';
import { ErrorState, LoadingRows } from '../page';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
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

/**
 * An earlier consultation, complete and read-only: vitals, the signed notes (with their integrity check),
 * diagnoses, medicines, tests (each opens in a window) and charges. Nothing here can be changed.
 */
function PastConsultation({ id, onBack }: { id: string; onBack: () => void }) {
  const q = useQuery({ queryKey: ['encounter', id], queryFn: () => api.get<Encounter>(`/encounters/${id}`) });
  const { can } = useSession();
  if (q.isLoading) return <LoadingRows rows={5} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const e = q.data!;
  const notes = e.notes.filter((n) => n.status === 'SIGNED');
  const none = () => undefined;
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft /> All earlier visits
        </Button>
        <Button variant="ghost" size="sm" className="ml-auto" asChild title="Opens this consultation on its own page, in a new tab">
          <a href={`/consultations/${e.id}`} target="_blank" rel="noopener noreferrer">
            <ExternalLink /> Open on its own page
          </a>
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold">
          {e.encounterNo} · {fmtDateTime(e.startedAt)}
        </h3>
        <Badge variant={e.status === 'OPEN' ? 'warning' : 'success'}>{e.status === 'OPEN' ? 'In progress' : 'Finished'}</Badge>
        <span className="text-xs text-muted-foreground">
          {enumLabel(e.type)}
          {e.chiefComplaint ? ` — ${e.chiefComplaint}` : ''} · {e.clinician?.name ?? 'No vet recorded'}
        </span>
      </div>
      <VitalsPanel encounterId={e.id} vitals={e.vitals} editable={false} onSaved={none} />
      {notes.length ? (
        notes.map((n) => (
          <Card key={n.id}>
            <CardContent className="pt-4">
              <NoteView note={n} />
            </CardContent>
          </Card>
        ))
      ) : (
        <p className="rounded-lg border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">No signed note for this visit.</p>
      )}
      <DiagnosesPanel encounterId={e.id} diagnoses={e.diagnoses} editable={false} onSaved={none} />
      <PrescriptionsPanel patient={e.patient} encounterId={e.id} editable={false} />
      <AdministrationsPanel patient={e.patient} encounterId={e.id} editable={false} />
      <LabOrdersPanel patient={e.patient} encounterId={e.id} editable={false} />
      {can('billing.read') && <ConsultationCharges encounterId={e.id} hasPrescriptions />}
    </div>
  );
}

function PreviousVisits({ patientId, currentId, initialVisitId }: { patientId: string; currentId: string; initialVisitId?: string | null }) {
  const q = usePreviousVisits(patientId, currentId, true);
  const [selected, setSelected] = useState<string | null>(initialVisitId ?? null);
  if (selected) return <PastConsultation id={selected} onBack={() => setSelected(null)} />;
  if (q.isLoading) return <LoadingRows rows={4} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data?.length) return <p className="py-6 text-center text-sm text-muted-foreground">No earlier consultations for this patient.</p>;
  return (
    <ul className="grid gap-2">
      {q.data.map((e) => (
        <li key={e.id} className="rounded-xl surface-flat">
          <button type="button" onClick={() => setSelected(e.id)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none" title="Open this consultation in full">
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">
                {fmtDateTime(e.startedAt)} · {enumLabel(e.type)}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {[e.chiefComplaint, e.diagnoses.map((d) => d.term).join(', '), e.clinician?.name].filter(Boolean).join(' — ') || '—'}
              </span>
            </span>
            <Badge variant={e.status === 'OPEN' ? 'warning' : 'success'}>{e.status === 'OPEN' ? 'In progress' : 'Finished'}</Badge>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        </li>
      ))}
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
export function PatientHistoryDialog({ patientId, patientName, currentId, open, onOpenChange, initialVisitId }: { patientId: string; patientName: string; currentId: string; open: boolean; onOpenChange: (o: boolean) => void; /** Start on this earlier consultation instead of the list. */ initialVisitId?: string | null }) {
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
            <DialogDescription>Earlier consultations in full, appointments and everything recorded for this patient. Nothing here changes the current consultation.</DialogDescription>
          </DialogHeader>
          <Tabs defaultValue={first}>
            <TabsList>
              {visits && <TabsTrigger value="visits">Previous visits</TabsTrigger>}
              {appts && <TabsTrigger value="appointments">Appointments</TabsTrigger>}
              {timeline && <TabsTrigger value="timeline">Full timeline</TabsTrigger>}
            </TabsList>
            {visits && (
              <TabsContent value="visits">
                <PreviousVisits patientId={patientId} currentId={currentId} initialVisitId={initialVisitId} />
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
export function LastVisitStrip({ patientId, currentId, onOpenHistory }: { patientId: string; currentId: string; onOpenHistory: (visitId?: string) => void }) {
  const { can } = useSession();
  const q = usePreviousVisits(patientId, currentId, can('clinical.read'));
  if (!can('clinical.read') || q.isLoading || q.error) return null;
  const last = q.data?.[0];
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl surface-flat px-3 py-2 text-sm">
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
        <span className="flex items-center gap-3">
          <button type="button" onClick={() => onOpenHistory(last.id)} className="font-medium text-primary underline">
            Open that visit
          </button>
          <button type="button" onClick={() => onOpenHistory()} className="text-primary underline">
            All history
          </button>
        </span>
      )}
    </div>
  );
}
