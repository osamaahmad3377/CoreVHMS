'use client';
import { useMutation, useQuery } from '@tanstack/react-query';
import { type Paginated } from '@vcms/shared';
import { AlertTriangle, ArrowRight, Clock, Play, Stethoscope, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { PatientPicker, type PickedPatient } from '@/components/patients/patient-picker';
import { EmptyState, LoadingRows, PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { api, qs } from '@/lib/api';
import { useSession } from '@/lib/session';
import { branchTime } from '@/lib/time';
import type { Appointment, EncounterRow } from '@/lib/types';
import { cn } from '@/lib/utils';

type QueueRow = Appointment & { encounter?: { id: string; status: string } | null };
interface Queue {
  waiting: QueueRow[];
  inConsultation: QueueRow[];
  expected: QueueRow[];
}

const PRIORITY: Record<string, { label: string; cls: string }> = {
  RESUSCITATION: { label: 'Resuscitation', cls: 'bg-destructive text-white' },
  EMERGENT: { label: 'Emergency', cls: 'bg-destructive text-white' },
  URGENT: { label: 'Urgent', cls: 'bg-warning text-warning-foreground' },
};

/** Opens a consultation in Quick consult, starting it first when the patient is still in the waiting room. */
function useOpen() {
  const router = useRouter();
  const start = useMutation({
    mutationFn: (appointmentId: string) => api.post<Appointment & { encounterId: string | null }>(`/appointments/${appointmentId}/status`, { action: 'start' }),
    onSuccess: (a) => (a.encounterId ? router.push(`/consultations/${a.encounterId}/quick`) : toast.error('The consultation could not be opened')),
    onError: (e: Error) => toast.error(e.message),
  });
  return { start, go: (encounterId: string) => router.push(`/consultations/${encounterId}/quick`) };
}

function Row({ a, tz, action }: { a: QueueRow; tz: string; action: React.ReactNode }) {
  const pr = PRIORITY[a.effectivePriority ?? ''];
  const reason = a.triage?.presentingComplaint || a.reason;
  const alerts = a.patient?.alerts?.length ?? 0;
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-xl surface-flat px-4 py-3 shadow-card">
      {a.tokenNumber != null && <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-sm font-bold text-primary">{a.tokenNumber}</span>}
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-semibold">
          {a.patient?.name ?? 'No patient'}
          <span className="text-xs font-normal text-muted-foreground">
            {a.patient?.species.name} · {a.client.displayName}
          </span>
          {pr && <span className={cn('rounded-pill px-2 py-0.5 text-2xs font-semibold', pr.cls)}>{pr.label}</span>}
          {alerts > 0 && (
            <span className="flex items-center gap-1 text-xs font-medium text-warning">
              <AlertTriangle className="h-3.5 w-3.5" /> {alerts} alert{alerts === 1 ? '' : 's'}
            </span>
          )}
        </p>
        <p className="text-sm text-muted-foreground">
          {reason || a.appointmentType.name}
          {a.waitingMinutes != null && (
            <span className="ml-2 inline-flex items-center gap-1 text-xs">
              <Clock className="h-3 w-3" /> waiting {a.waitingMinutes} min
            </span>
          )}
          {a.waitingMinutes == null && <span className="ml-2 text-xs">{branchTime(a.startsAt, tz)}</span>}
        </p>
      </div>
      {action}
    </li>
  );
}

/** A visit without a booking (walk-in already examined, phone advice): pick the patient, say why, start. */
function StartOther({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const [patient, setPatient] = useState<PickedPatient | null>(null);
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => api.post<{ id: string }>('/encounters', { patientId: patient!.id, type: 'CONSULTATION', chiefComplaint: reason }),
    onSuccess: (e) => router.push(`/consultations/${e.id}/quick`),
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>See a patient without a booking</DialogTitle>
          <DialogDescription>Patients checked in at the front desk are already on the list — start them from there.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <PatientPicker id="qc-start-patient" value={patient} onChange={setPatient} />
          <Input placeholder="Reason for visit (optional)" value={reason} onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && patient && m.mutate()} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!patient} loading={m.isPending} onClick={() => m.mutate()}>
            <Play /> Start
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NextPatient() {
  const { can, session } = useSession();
  const tz = session.branch?.timezone ?? 'UTC';
  const [other, setOther] = useState(false);
  const { start, go } = useOpen();
  const queue = useQuery({
    queryKey: ['queue', session.branch?.id],
    queryFn: () => api.get<Queue>(`/front-desk/queue?branchId=${session.branch?.id}`),
    refetchInterval: 30_000,
    enabled: can('appointments.read') || can('appointments.checkin'),
  });
  // Consultations still open that are not on today's list (started without a booking, or on an earlier day).
  const open = useQuery({ queryKey: ['encounters', { status: 'OPEN', mine: 'true', quick: true }], queryFn: () => api.get<Paginated<EncounterRow>>(`/encounters${qs({ status: 'OPEN', mine: 'true', pageSize: 25 })}`) });

  const waiting = queue.data?.waiting ?? [];
  const seeing = queue.data?.inConsultation ?? [];
  const onList = new Set(seeing.map((a) => a.encounter?.id).filter(Boolean));
  const otherOpen = (open.data?.data ?? []).filter((e) => !onList.has(e.id));
  const next = waiting[0];

  return (
    <>
      <PageHeader
        title="Quick consult"
        description="See the next patient in a single screen: tap what’s abnormal, speak instead of typing, finish with one button."
        actions={
          <Button variant="outline" onClick={() => setOther(true)}>
            <UserPlus /> Patient without a booking
          </Button>
        }
      />
      {queue.isLoading ? (
        <LoadingRows rows={4} />
      ) : (
        <div className="grid gap-6">
          {next && (
            <button
              type="button"
              disabled={start.isPending}
              onClick={() => start.mutate(next.id)}
              className="flex flex-wrap items-center gap-4 rounded-2xl border-2 border-primary/40 bg-primary/5 p-5 text-left shadow-card transition-colors hover:bg-primary/10 disabled:opacity-60"
            >
              <Stethoscope className="h-8 w-8 text-primary" />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium uppercase tracking-wide text-primary">Next patient</span>
                <span className="block text-xl font-semibold">
                  {next.patient?.name} <span className="text-base font-normal text-muted-foreground">· {next.client.displayName}</span>
                </span>
                <span className="block text-sm text-muted-foreground">
                  {next.triage?.presentingComplaint || next.reason || next.appointmentType.name}
                  {next.waitingMinutes != null && ` · waiting ${next.waitingMinutes} min`}
                </span>
              </span>
              <span className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground">
                Start <ArrowRight className="h-4 w-4" />
              </span>
            </button>
          )}

          {(seeing.length > 0 || otherOpen.length > 0) && (
            <section className="grid gap-2">
              <h2 className="text-sm font-semibold text-muted-foreground">In progress</h2>
              <ul className="grid gap-2">
                {seeing.map((a) => (
                  <Row
                    key={a.id}
                    a={a}
                    tz={tz}
                    action={
                      a.encounter ? (
                        <Button variant="outline" onClick={() => go(a.encounter!.id)}>
                          Continue <ArrowRight />
                        </Button>
                      ) : null
                    }
                  />
                ))}
                {otherOpen.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-3 rounded-xl surface-flat px-4 py-3 shadow-card">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">
                        {e.patient.name} <span className="text-xs font-normal text-muted-foreground">{e.patient.species.name} · {e.client.displayName}</span>
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {e.chiefComplaint || 'Consultation'} · {e.encounterNo} · started {branchTime(e.startedAt, tz, 'd MMM HH:mm')}
                      </p>
                    </div>
                    <Button variant="outline" onClick={() => go(e.id)}>
                      Continue <ArrowRight />
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="grid gap-2">
            <h2 className="text-sm font-semibold text-muted-foreground">Waiting {waiting.length > 0 && `(${waiting.length})`}</h2>
            {waiting.length === 0 ? (
              <EmptyState title="Nobody is waiting" description="Patients checked in at the front desk appear here, most urgent first." />
            ) : (
              <ul className="grid gap-2">
                {waiting.map((a) => (
                  <Row
                    key={a.id}
                    a={a}
                    tz={tz}
                    action={
                      <Button loading={start.isPending && start.variables === a.id} onClick={() => start.mutate(a.id)}>
                        <Play /> Start
                      </Button>
                    }
                  />
                ))}
              </ul>
            )}
          </section>
          <p className="text-xs text-muted-foreground">
            Prefer the step-by-step screen? <Link href="/consultations" className="font-medium text-primary hover:underline">Classic consultations</Link> work as before — both write the same record.
          </p>
        </div>
      )}
      <StartOther open={other} onOpenChange={setOther} />
    </>
  );
}

export default function QuickConsultHome() {
  return (
    <RequirePermission anyOf={['clinical.write']}>
      <NextPatient />
    </RequirePermission>
  );
}
