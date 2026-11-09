'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TRIAGE_PRIORITIES, enumLabel } from '@vcms/shared';
import { CalendarPlus, Clock, DoorOpen, LogIn, UserPlus, Users } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { ErrorState, LoadingRows, PageHeader } from '@/components/page';
import { PatientPicker, type PickedPatient } from '@/components/patients/patient-picker';
import { RequirePermission } from '@/components/require';
import { fmtWait } from '@/components/scheduling/appointment-text';
import { BookingDialog } from '@/components/scheduling/booking-dialog';
import { QueueBoard, useQueue } from '@/components/scheduling/queue-board';
import { Stat } from '@/components/stat';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect } from '@/components/ui/input';
import { useAppointmentTypes, useClinicians } from '@/hooks/use-catalog';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { dayLabel } from '@/lib/time';
import type { Appointment, PatientDetail } from '@/lib/types';

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

function FrontDesk() {
  const { session, can } = useSession();
  const router = useRouter();
  const q = useQueue();
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
          {/* Consultations are started from Consultations, not here. */}
          <QueueBoard columns={['expected', 'waiting', 'inConsultation', 'done']} allowStart={false} />
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
