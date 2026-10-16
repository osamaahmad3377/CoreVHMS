'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TRIAGE_PRIORITIES, enumLabel } from '@vcms/shared';
import { AlertOctagon, CalendarPlus, Clock, DoorOpen, LogIn, Play, Siren, Stethoscope, UserPlus, Users } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/page';
import { PatientPicker, type PickedPatient } from '@/components/patients/patient-picker';
import { RequirePermission } from '@/components/require';
import { AppointmentDialog } from '@/components/scheduling/appointment-dialog';
import { AppointmentStatusBadge, PriorityDot } from '@/components/scheduling/appointment-status';
import { BookingDialog } from '@/components/scheduling/booking-dialog';
import { TriageDialog } from '@/components/scheduling/triage-dialog';
import { Stat } from '@/components/stat';
import { AlertChip } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect } from '@/components/ui/input';
import { useAppointmentTypes, useClinicians } from '@/hooks/use-catalog';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { branchTime, dayLabel } from '@/lib/time';
import type { Appointment } from '@/lib/types';
import { cn } from '@/lib/utils';

interface Queue {
  date: string;
  timezone: string;
  expected: Appointment[];
  waiting: Appointment[];
  inConsultation: Appointment[];
  done: Appointment[];
  stats: { total: number; averageWaitMinutes: number; noShows: number };
}

function WalkInDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { session } = useSession();
  const qc = useQueryClient();
  const types = useAppointmentTypes();
  const clinicians = useClinicians(session.branch?.id);
  const [patient, setPatient] = useState<PickedPatient | null>(null);
  const [typeId, setTypeId] = useState('');
  const [clinicianId, setClinicianId] = useState('');
  const [priority, setPriority] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () =>
      api.post<Appointment>('/front-desk/walk-in', {
        branchId: session.branch!.id,
        clientId: patient!.owner!.id,
        patientId: patient!.id,
        appointmentTypeId: typeId || types.data![0].id,
        clinicianId: clinicianId || null,
        priority: priority || undefined,
        reason,
      }),
    onSuccess: (a) => {
      toast.success(`${a.patient?.name} checked in as a walk-in`);
      qc.invalidateQueries({ queryKey: ['queue'] });
      qc.invalidateQueries({ queryKey: ['appointments'] });
      setPatient(null);
      setReason('');
      setPriority('');
      onOpenChange(false);
    },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Walk-in / emergency arrival</DialogTitle>
          <DialogDescription>The patient is checked in immediately and added to the waiting queue.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {error && <FormError message={error} />}
          <Field label="Patient" htmlFor="wi-p" required>
            <PatientPicker id="wi-p" value={patient} onChange={setPatient} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Visit type" htmlFor="wi-t">
              <NativeSelect id="wi-t" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
                {types.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Clinician" htmlFor="wi-c">
              <NativeSelect id="wi-c" value={clinicianId} onChange={(e) => setClinicianId(e.target.value)}>
                <option value="">Assign later</option>
                {clinicians.data?.map((c) => <option key={c.membershipId} value={c.membershipId}>{c.name}</option>)}
              </NativeSelect>
            </Field>
          </div>
          <Field label="Initial priority (optional — confirm with triage)" htmlFor="wi-pr">
            <NativeSelect id="wi-pr" value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="">Not triaged yet</option>
              {TRIAGE_PRIORITIES.map((p) => <option key={p} value={p}>{enumLabel(p)}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Reason" htmlFor="wi-r">
            <Input id="wi-r" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!patient?.owner || !types.data?.length} loading={m.isPending} onClick={() => { setError(null); m.mutate(); }}>
            <LogIn /> Check in
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function QueueCard({
  a,
  tz,
  onOpen,
  children,
}: {
  a: Appointment;
  tz: string;
  onOpen: () => void;
  children?: React.ReactNode;
}) {
  const pr = a.effectivePriority ?? a.triage?.priority ?? a.priority;
  const urgent = pr === 'RESUSCITATION' || pr === 'EMERGENT';
  return (
    <li className={cn('rounded-md border bg-card p-3 shadow-sm', urgent && 'border-destructive/50 ring-1 ring-destructive/30')}>
      <button onClick={onOpen} className="block w-full text-left">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 truncate font-medium">
              {urgent && <AlertOctagon className="h-4 w-4 shrink-0 text-destructive" />}
              {a.patient?.name ?? a.client.displayName}
              <span className="text-xs font-normal text-muted-foreground">{a.patient?.species.name}</span>
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {branchTime(a.startsAt, tz)} · {a.appointmentType.name} · {a.clinician?.name ?? 'Unassigned'}
            </p>
            {a.reason && <p className="truncate text-xs">{a.reason}</p>}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <PriorityDot priority={pr} withLabel />
            {a.waitingMinutes !== null && a.waitingMinutes !== undefined && (
              <span className={cn('flex items-center gap-1 text-xs tabular', a.waitingMinutes >= 30 ? 'font-semibold text-destructive' : 'text-muted-foreground')}>
                <Clock className="h-3 w-3" /> {a.waitingMinutes} min
              </span>
            )}
            {a.source === 'WALK_IN' && <span className="text-2xs uppercase text-muted-foreground">Walk-in</span>}
          </div>
        </div>
        {!!a.patient?.alerts.length && (
          <div className="mt-1.5 flex flex-wrap gap-1">{a.patient.alerts.slice(0, 2).map((al) => <AlertChip key={al.id} alert={al} />)}</div>
        )}
      </button>
      {children && <div className="mt-2 flex flex-wrap gap-1.5 border-t pt-2">{children}</div>}
    </li>
  );
}

function FrontDesk() {
  const { session, can } = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const tz = session.branch?.timezone ?? 'UTC';
  const q = useQuery({
    queryKey: ['queue', session.branch?.id],
    queryFn: () => api.get<Queue>(`/front-desk/queue?branchId=${session.branch?.id}`),
    refetchInterval: 30_000,
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [walkIn, setWalkIn] = useState(false);
  const [book, setBook] = useState(false);
  const [triage, setTriage] = useState<Appointment | null>(null);
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) => api.post<Appointment & { encounterId: string | null }>(`/appointments/${id}/status`, { action }),
    onSuccess: (a, v) => {
      qc.invalidateQueries({ queryKey: ['queue'] });
      qc.invalidateQueries({ queryKey: ['appointments'] });
      if (v.action === 'start' && a.encounterId) router.push(`/consultations/${a.encounterId}`);
      else toast.success(`${a.patient?.name ?? a.client.displayName}: ${enumLabel(a.status)}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const columns: { key: keyof Queue; title: string; icon: React.ComponentType<{ className?: string }>; empty: string }[] = [
    { key: 'expected', title: 'Expected', icon: CalendarPlus, empty: 'No more bookings today' },
    { key: 'waiting', title: 'Waiting', icon: Users, empty: 'Nobody is waiting' },
    { key: 'inConsultation', title: 'In consultation', icon: Stethoscope, empty: 'No consultations in progress' },
    { key: 'done', title: 'Finished', icon: DoorOpen, empty: 'Nothing finished yet' },
  ];

  return (
    <>
      <PageHeader
        help="front-desk"
        title="Front desk"
        description={q.data ? `${dayLabel(q.data.date, 'EEEE d MMMM')} · ${session.branch?.name}` : session.branch?.name}
        actions={
          <>
            {can('appointments.write') && (
              <Button size="sm" variant="outline" onClick={() => setBook(true)}>
                <CalendarPlus /> Book
              </Button>
            )}
            {can('appointments.checkin') && (
              <Button size="sm" onClick={() => setWalkIn(true)}>
                <UserPlus /> Walk-in
              </Button>
            )}
          </>
        }
      />
      {q.isLoading ? (
        <LoadingRows />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Patients today" value={q.data!.stats.total} icon={Users} />
            <Stat label="Waiting now" value={q.data!.waiting.length} icon={Clock} tone={q.data!.waiting.length ? 'warning' : 'default'} />
            <Stat label="Average wait" value={`${q.data!.stats.averageWaitMinutes} min`} icon={Clock} tone={q.data!.stats.averageWaitMinutes >= 30 ? 'danger' : 'default'} />
            <Stat label="No-shows" value={q.data!.stats.noShows} icon={DoorOpen} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-4">
            {columns.map((c) => {
              const items = q.data![c.key] as Appointment[];
              return (
                <Card key={c.key} className="flex flex-col bg-muted/30">
                  <CardHeader className="bg-card">
                    <CardTitle className="flex items-center gap-2">
                      <c.icon className="h-4 w-4 text-muted-foreground" /> {c.title}
                    </CardTitle>
                    <span className="rounded-full bg-muted px-2 text-xs tabular">{items.length}</span>
                  </CardHeader>
                  {items.length ? (
                    <ul className="grid gap-2 p-2">
                      {items.map((a) => (
                        <QueueCard key={a.id} a={a} tz={tz} onOpen={() => setSelected(a.id)}>
                          {c.key === 'expected' && can('appointments.checkin') && (
                            <Button size="sm" onClick={() => act.mutate({ id: a.id, action: 'check-in' })}>
                              <LogIn /> Check in
                            </Button>
                          )}
                          {c.key === 'waiting' && (
                            <>
                              {can('triage.write') && a.patient && (
                                <Button size="sm" variant="outline" onClick={() => setTriage(a)}>
                                  <Siren /> Triage
                                </Button>
                              )}
                              {can('clinical.write') && a.patient && (
                                <Button size="sm" onClick={() => act.mutate({ id: a.id, action: 'start' })}>
                                  <Play /> Start
                                </Button>
                              )}
                            </>
                          )}
                          {c.key === 'inConsultation' && a.encounter && (
                            <Button size="sm" variant="outline" asChild>
                              <Link href={`/consultations/${a.encounter.id}`}>
                                <Stethoscope /> Open
                              </Link>
                            </Button>
                          )}
                          {c.key === 'done' && <AppointmentStatusBadge status={a.status} />}
                        </QueueCard>
                      ))}
                    </ul>
                  ) : (
                    <EmptyState title={c.empty} className="py-8" />
                  )}
                </Card>
              );
            })}
          </div>
          <p className="mt-2 text-right text-2xs text-muted-foreground">Refreshes every 30 seconds · waiting list sorted by triage priority, then arrival time</p>
        </>
      )}
      <WalkInDialog open={walkIn} onOpenChange={setWalkIn} />
      <BookingDialog open={book} onOpenChange={setBook} />
      <AppointmentDialog id={selected} open={!!selected} onOpenChange={(o) => !o && setSelected(null)} />
      {triage?.patient && (
        <TriageDialog open={!!triage} onOpenChange={(o) => !o && setTriage(null)} patientId={triage.patient.id} appointmentId={triage.id} patientName={triage.patient.name} />
      )}
    </>
  );
}

export default function FrontDeskPage() {
  return (
    <RequirePermission anyOf={['appointments.checkin', 'appointments.read']}>
      <FrontDesk />
    </RequirePermission>
  );
}
