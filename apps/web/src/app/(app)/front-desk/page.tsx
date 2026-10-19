'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TRIAGE_PRIORITIES, enumLabel } from '@vcms/shared';
import { AlertOctagon, CalendarPlus, Clock, DoorOpen, Info, LogIn, Phone, Play, Receipt, Siren, Stethoscope, UserPlus, Users } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/page';
import { PatientPicker, type PickedPatient } from '@/components/patients/patient-picker';
import { RequirePermission } from '@/components/require';
import { AppointmentDialog } from '@/components/scheduling/appointment-dialog';
import { AppointmentStatusBadge, PriorityDot } from '@/components/scheduling/appointment-status';
import { fmtWait, statusChangeMessage } from '@/components/scheduling/appointment-text';
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
import type { Appointment, PatientDetail } from '@/lib/types';
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

function WalkInDialog({ open, onOpenChange, initialPatient }: { open: boolean; onOpenChange: (o: boolean) => void; initialPatient?: PickedPatient | null }) {
  const { session } = useSession();
  const qc = useQueryClient();
  const types = useAppointmentTypes();
  const clinicians = useClinicians(session.branch?.id);
  const [patient, setPatient] = useState<PickedPatient | null>(null);
  const [typeId, setTypeId] = useState('');
  const [clinicianId, setClinicianId] = useState('');
  const [priority, setPriority] = useState('');
  // Once the user picks a priority themselves, changing the visit type no longer touches it.
  const [priorityTouched, setPriorityTouched] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open && initialPatient) setPatient(initialPatient);
  }, [open, initialPatient]);
  const chooseType = (id: string) => {
    setTypeId(id);
    if (priorityTouched) return;
    const emergency = types.data?.find((t) => t.id === id)?.category === 'EMERGENCY';
    setPriority(emergency ? 'EMERGENT' : '');
  };
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
      toast.success(`Checked in: ${a.patient?.name ?? a.client.displayName} as a walk-in (${a.appointmentNo})`);
      qc.invalidateQueries({ queryKey: ['queue'] });
      qc.invalidateQueries({ queryKey: ['appointments'] });
      setPatient(null);
      setReason('');
      setPriority('');
      setPriorityTouched(false);
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
            <PatientPicker id="wi-p" value={patient} onChange={setPatient} allowCreate />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Visit type" htmlFor="wi-t">
              <NativeSelect id="wi-t" value={typeId} onChange={(e) => chooseType(e.target.value)}>
                {types.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Vet" htmlFor="wi-c">
              <NativeSelect id="wi-c" value={clinicianId} onChange={(e) => setClinicianId(e.target.value)}>
                <option value="">No vet yet</option>
                {clinicians.data?.map((c) => <option key={c.membershipId} value={c.membershipId}>{c.name}</option>)}
              </NativeSelect>
            </Field>
          </div>
          <Field label="How urgent? (a vet will check)" htmlFor="wi-pr">
            <NativeSelect id="wi-pr" value={priority} onChange={(e) => { setPriority(e.target.value); setPriorityTouched(true); }}>
              <option value="">Don’t know yet</option>
              {TRIAGE_PRIORITIES.map((p) => <option key={p} value={p}>{enumLabel(p)}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Reason" htmlFor="wi-r">
            <Input id="wi-r" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {!patient && <p className="mr-auto self-center text-xs text-muted-foreground">Choose a patient to continue</p>}
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
      <button onClick={onOpen} className="block w-full text-left" aria-label={`Details: ${a.patient?.name ?? a.client.displayName}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 truncate font-medium">
              {urgent && <AlertOctagon className="h-4 w-4 shrink-0 text-destructive" />}
              {a.patient?.name ?? a.client.displayName}
              <span className="text-xs font-normal text-muted-foreground">{a.patient?.species.name}</span>
            </p>
            {a.patient && (
              <p className="flex items-center gap-1 truncate text-xs">
                {a.client.displayName}
                {a.client.mobilePhone && (
                  <span className="flex items-center gap-0.5 text-muted-foreground">
                    · <Phone className="h-3 w-3" /> {a.client.mobilePhone}
                  </span>
                )}
              </p>
            )}
            <p className="truncate text-xs text-muted-foreground">
              {branchTime(a.startsAt, tz)} · {a.appointmentType.name} · {a.clinician?.name ?? 'No vet yet'}
            </p>
            {a.reason && <p className="truncate text-xs">{a.reason}</p>}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <PriorityDot priority={pr} withLabel />
            {a.waitingMinutes !== null && a.waitingMinutes !== undefined && (
              <span className={cn('flex items-center gap-1 text-xs tabular', a.waitingMinutes >= 30 ? 'font-semibold text-destructive' : 'text-muted-foreground')}>
                <Clock className="h-3 w-3" /> {fmtWait(a.waitingMinutes)}
              </span>
            )}
            {a.source === 'WALK_IN' && <span className="text-2xs text-muted-foreground">Walk-in</span>}
          </div>
        </div>
        {!!a.patient?.alerts.length && (
          <div className="mt-1.5 flex flex-wrap gap-1">{a.patient.alerts.slice(0, 2).map((al) => <AlertChip key={al.id} alert={al} />)}</div>
        )}
      </button>
      <div className="mt-2 flex flex-wrap gap-1.5 border-t pt-2">
        {children}
        <Button size="sm" variant="ghost" onClick={onOpen}>
          <Info /> Details
        </Button>
      </div>
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
  // "Check in now" after registering a patient: /front-desk?walkIn=<patientId> opens the walk-in form for them.
  const walkInId = useSearchParams().get('walkIn');
  const walkInPatient = useQuery({
    queryKey: ['patient', walkInId],
    queryFn: () => api.get<PatientDetail>(`/patients/${walkInId}`),
    enabled: !!walkInId && can('appointments.checkin'),
  });
  const [preset, setPreset] = useState<PickedPatient | null>(null);
  useEffect(() => {
    const d = walkInPatient.data;
    if (!d) return;
    setPreset({
      id: d.id,
      name: d.name,
      patientNo: d.patientNo,
      species: d.species,
      owner: d.owner ? { id: d.owner.id, displayName: d.owner.displayName, mobilePhone: d.owner.mobilePhone } : null,
      alerts: d.alerts.filter((a) => a.isActive),
    });
    setWalkIn(true);
    router.replace('/front-desk');
  }, [walkInPatient.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const [book, setBook] = useState(false);
  const [triage, setTriage] = useState<Appointment | null>(null);
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) => api.post<Appointment & { encounterId: string | null }>(`/appointments/${id}/status`, { action }),
    onSuccess: (a, v) => {
      qc.invalidateQueries({ queryKey: ['queue'] });
      qc.invalidateQueries({ queryKey: ['appointments'] });
      if (v.action === 'start' && a.encounterId) router.push(`/consultations/${a.encounterId}`);
      else toast.success(statusChangeMessage(v.action, a, tz));
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
                <CalendarPlus /> Book appointment
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
            <Stat label="Average wait" value={fmtWait(q.data!.stats.averageWaitMinutes)} icon={Clock} tone={q.data!.stats.averageWaitMinutes >= 30 ? 'danger' : 'default'} />
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
                          {c.key === 'waiting' && can('triage.write') && a.patient && (
                            <Button size="sm" variant="outline" onClick={() => setTriage(a)}>
                              <Siren /> Triage
                            </Button>
                          )}
                          {c.key === 'waiting' && can('clinical.write') && a.patient && (
                            <Button size="sm" onClick={() => act.mutate({ id: a.id, action: 'start' })}>
                              <Play /> Start
                            </Button>
                          )}
                          {c.key === 'inConsultation' && a.encounter && (
                            <Button size="sm" variant="outline" asChild>
                              <Link href={`/consultations/${a.encounter.id}`}>
                                <Stethoscope /> Open
                              </Link>
                            </Button>
                          )}
                          {c.key === 'done' && <AppointmentStatusBadge status={a.status} />}
                          {c.key === 'done' && !!a.unbilledCharges && can('billing.write') && (
                            <Button size="sm" asChild>
                              <Link href={`/billing/invoices/new?clientId=${a.client.id}`} title={`${a.unbilledCharges} item${a.unbilledCharges === 1 ? '' : 's'} not yet invoiced`}>
                                <Receipt /> Bill
                              </Link>
                            </Button>
                          )}
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
      <WalkInDialog
        open={walkIn}
        onOpenChange={(o) => {
          setWalkIn(o);
          if (!o) setPreset(null);
        }}
        initialPatient={preset}
      />
      <BookingDialog open={book} onOpenChange={setBook} />
      <AppointmentDialog id={selected} open={!!selected} onOpenChange={(o) => !o && setSelected(null)} />
      {triage?.patient && (
        <TriageDialog open={!!triage} onOpenChange={(o) => !o && setTriage(null)} patientId={triage.patient.id} appointmentId={triage.id} patientName={triage.patient.name} defaultComplaint={triage.triage?.presentingComplaint ?? triage.reason} />
      )}
    </>
  );
}

export default function FrontDeskPage() {
  return (
    <RequirePermission anyOf={['appointments.checkin', 'appointments.read']}>
      <Suspense>
        <FrontDesk />
      </Suspense>
    </RequirePermission>
  );
}
