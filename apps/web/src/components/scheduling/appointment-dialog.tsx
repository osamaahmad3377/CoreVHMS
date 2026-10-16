'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { enumLabel } from '@vcms/shared';
import { CalendarClock, CheckCircle2, ClipboardCheck, LogIn, Play, Scissors, Siren, Stethoscope, Tractor, UserX, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useConfirm } from '../confirm';
import { Field } from '../forms/field';
import { FormError } from '../forms/form-error';
import { DescriptionList, ErrorState, LoadingRows } from '../page';
import { AlertChip } from '../status';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input, NativeSelect } from '../ui/input';
import { AppointmentStatusBadge, PriorityDot } from './appointment-status';
import { TriageDialog } from './triage-dialog';
import { GroomingCheckInDialog } from '../boarding/dialogs';
import { VisitFromAppointmentDialog } from '../livestock/record-dialogs';
import { useClinicians } from '@/hooks/use-catalog';
import { ApiError, api } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import { branchTime, localDate, minuteOfDay, hhmm, parseHhmm, zonedInstant } from '@/lib/time';
import type { Appointment } from '@/lib/types';

export function AppointmentDialog({ id, open, onOpenChange }: { id: string | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { session, can } = useSession();
  const tz = session.branch?.timezone ?? 'UTC';
  const qc = useQueryClient();
  const router = useRouter();
  const [moduleDlg, setModuleDlg] = useState<null | 'grooming' | 'visit'>(null);
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ['appointment', id], queryFn: () => api.get<Appointment>(`/appointments/${id}`), enabled: open && !!id });
  const clinicians = useClinicians(session.branch?.id);
  const [mode, setMode] = useState<'view' | 'reschedule'>('view');
  const [triageOpen, setTriageOpen] = useState(false);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [clinicianId, setClinicianId] = useState('');
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);

  useEffect(() => {
    if (!open) setMode('view');
    setError(null);
  }, [open, id]);
  useEffect(() => {
    if (q.data) {
      setDate(localDate(q.data.startsAt, tz));
      setTime(hhmm(minuteOfDay(q.data.startsAt, tz)));
      setClinicianId(q.data.clinician?.id ?? '');
    }
  }, [q.data, tz]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['appointments'] });
    qc.invalidateQueries({ queryKey: ['appointment', id] });
    qc.invalidateQueries({ queryKey: ['queue'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const act = useMutation({
    mutationFn: (body: { action: string; reason?: string }) => api.post<Appointment & { encounterId: string | null }>(`/appointments/${id}/status`, body),
    onSuccess: (a, vars) => {
      refresh();
      toast.success(`${a.appointmentNo}: ${enumLabel(a.status)}`);
      if (vars.action === 'start' && a.encounterId) router.push(`/consultations/${a.encounterId}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reschedule = useMutation({
    mutationFn: (override: { allowOverbook?: boolean; allowOutsideHours?: boolean }) =>
      api.patch(`/appointments/${id}`, { startsAt: zonedInstant(date, parseHhmm(time), tz).toISOString(), clinicianId: clinicianId || null, ...override }),
    onSuccess: () => {
      toast.success('Appointment moved');
      refresh();
      setMode('view');
    },
    onError: (e: Error) => setError({ message: e.message, code: e instanceof ApiError ? (e.code === 'OUTSIDE_WORKING_HOURS' ? e.code : (e.details as any)?.code) : undefined }),
  });

  const a = q.data;
  const s = a?.status;
  const actions: { key: string; label: string; icon: React.ComponentType; show: boolean; variant?: 'outline' | 'default' | 'destructive'; reason?: boolean }[] = a
    ? [
        { key: 'confirm', label: 'Confirm', icon: ClipboardCheck, show: s === 'BOOKED' && (can('appointments.write') || can('appointments.checkin')), variant: 'outline' },
        { key: 'check-in', label: 'Check in', icon: LogIn, show: (s === 'BOOKED' || s === 'CONFIRMED') && can('appointments.checkin') },
        { key: 'start', label: 'Start consultation', icon: Play, show: ['BOOKED', 'CONFIRMED', 'CHECKED_IN'].includes(s!) && !!a.patient && can('clinical.write') },
        { key: 'complete', label: 'Complete', icon: CheckCircle2, show: (s === 'CHECKED_IN' || s === 'IN_CONSULTATION') && (can('clinical.write') || can('appointments.checkin')), variant: 'outline' },
        { key: 'no-show', label: 'No-show', icon: UserX, show: (s === 'BOOKED' || s === 'CONFIRMED') && new Date(a.startsAt) < new Date() && (can('appointments.write') || can('appointments.checkin')), variant: 'outline' },
        { key: 'revert', label: 'Undo check-in', icon: XCircle, show: (s === 'CHECKED_IN' || s === 'NO_SHOW') && can('appointments.checkin'), variant: 'outline' },
        { key: 'cancel', label: 'Cancel appointment', icon: XCircle, show: ['BOOKED', 'CONFIRMED', 'CHECKED_IN'].includes(s!) && can('appointments.write'), variant: 'destructive', reason: true },
      ]
    : [];

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent size="lg">
          {q.isLoading || !a ? (
            q.error ? <ErrorState error={q.error} /> : <LoadingRows rows={4} />
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: a.appointmentType.color }} />
                  {a.appointmentType.name} · {branchTime(a.startsAt, tz, 'EEE d MMM, HH:mm')}–{branchTime(a.endsAt, tz)}
                  <AppointmentStatusBadge status={a.status} />
                  <PriorityDot priority={a.triage?.priority ?? a.priority} withLabel />
                </DialogTitle>
              </DialogHeader>
              {a.patient && a.patient.alerts.length > 0 && (
                <div className="flex flex-wrap gap-1">{a.patient.alerts.map((al) => <AlertChip key={al.id} alert={al} />)}</div>
              )}
              {mode === 'view' ? (
                <>
                  <DescriptionList
                    items={[
                      { label: 'Patient', value: a.patient ? <Link className="text-primary hover:underline" href={`/patients/${a.patient.id}`}>{a.patient.name} ({a.patient.species.name})</Link> : 'Not specified' },
                      { label: 'Client', value: <Link className="text-primary hover:underline" href={`/clients/${a.client.id}`}>{a.client.displayName}</Link> },
                      { label: 'Phone', value: a.client.mobilePhone },
                      { label: 'Clinician', value: a.clinician?.name ?? 'Unassigned' },
                      { label: 'Rooms', value: a.resources.map((r) => r.name).join(', ') },
                      { label: 'Number', value: `${a.appointmentNo} · ${enumLabel(a.source)}${a.isOverbooked ? ' · overbooked' : ''}` },
                      { label: 'Reason', value: a.reason },
                      { label: 'Notes', value: a.notes },
                      { label: 'Checked in', value: a.checkedInAt && fmtDateTime(a.checkedInAt) },
                      { label: 'Triage', value: a.triage && `${enumLabel(a.triage.priority)} — ${a.triage.presentingComplaint} (${a.triage.assessedByName})` },
                      ...(a.cancelReason ? [{ label: 'Cancelled', value: `${fmtDateTime(a.cancelledAt)} — ${a.cancelReason}` }] : []),
                    ]}
                  />
                  <div className="flex flex-wrap gap-2 border-t pt-3">
                    {a.encounter && (
                      <Button size="sm" asChild>
                        <Link href={`/consultations/${a.encounter.id}`}>
                          <Stethoscope /> Open consultation
                        </Link>
                      </Button>
                    )}
                    {a.groomingJob && can('boarding.read') && <Button size="sm" asChild><Link href={`/boarding/grooming/${a.groomingJob.id}`}><Scissors /> Open grooming job</Link></Button>}
                    {!a.groomingJob && a.appointmentType.category === 'GROOMING' && ['BOOKED', 'CONFIRMED', 'CHECKED_IN'].includes(a.status) && can('boarding.write') && <Button size="sm" onClick={() => setModuleDlg('grooming')}><Scissors /> Check in for grooming</Button>}
                    {a.fieldVisit && can('livestock.read') && <Button size="sm" asChild><Link href={`/livestock/visits/${a.fieldVisit.id}`}><Tractor /> Open visit record</Link></Button>}
                    {!a.fieldVisit && a.appointmentType.category === 'FIELD_VISIT' && !['CANCELLED', 'NO_SHOW'].includes(a.status) && can('livestock.write') && <Button size="sm" onClick={() => setModuleDlg('visit')}><Tractor /> Open visit record</Button>}
                    {actions.filter((x) => x.show).map((x) => (
                      <Button
                        key={x.key}
                        size="sm"
                        variant={x.variant ?? 'default'}
                        loading={act.isPending && act.variables?.action === x.key}
                        onClick={async () => {
                          if (x.reason) {
                            const r = await confirm({ title: `Cancel ${a.appointmentNo}?`, requireReason: true, reasonLabel: 'Cancellation reason', destructive: true, confirmLabel: 'Cancel appointment' });
                            if (r.confirmed) act.mutate({ action: x.key, reason: r.reason });
                          } else act.mutate({ action: x.key });
                        }}
                      >
                        <x.icon /> {x.label}
                      </Button>
                    ))}
                    {a.patient && ['BOOKED', 'CONFIRMED', 'CHECKED_IN'].includes(a.status) && can('triage.write') && (
                      <Button size="sm" variant="outline" onClick={() => setTriageOpen(true)}>
                        <Siren /> Triage
                      </Button>
                    )}
                    {['BOOKED', 'CONFIRMED', 'CHECKED_IN'].includes(a.status) && can('appointments.write') && (
                      <Button size="sm" variant="outline" onClick={() => setMode('reschedule')}>
                        <CalendarClock /> Reschedule
                      </Button>
                    )}
                  </div>
                </>
              ) : (
                <div className="grid gap-3">
                  {error && <FormError message={error.message} />}
                  {(error?.code === 'CLINICIAN_BUSY' || error?.code === 'OUTSIDE_WORKING_HOURS') && (
                    <Button size="sm" variant="outline" className="w-fit" onClick={() => reschedule.mutate(error.code === 'CLINICIAN_BUSY' ? { allowOverbook: true } : { allowOutsideHours: true })}>
                      Move anyway
                    </Button>
                  )}
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Date" htmlFor="rs-date"><Input id="rs-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
                    <Field label="Time" htmlFor="rs-time"><Input id="rs-time" type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} /></Field>
                    <Field label="Clinician" htmlFor="rs-clin">
                      <NativeSelect id="rs-clin" value={clinicianId} onChange={(e) => setClinicianId(e.target.value)}>
                        <option value="">Unassigned</option>
                        {clinicians.data?.map((c) => <option key={c.membershipId} value={c.membershipId}>{c.name}</option>)}
                      </NativeSelect>
                    </Field>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setMode('view')}>Back</Button>
                    <Button loading={reschedule.isPending} onClick={() => { setError(null); reschedule.mutate({}); }}>Save new time</Button>
                  </div>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
      {a?.patient && (
        <TriageDialog
          open={triageOpen}
          onOpenChange={(o) => {
            setTriageOpen(o);
            if (!o) refresh();
          }}
          patientId={a.patient.id}
          appointmentId={a.id}
          patientName={a.patient.name}
        />
      )}
      {a && <GroomingCheckInDialog open={moduleDlg === 'grooming'} onOpenChange={(o) => !o && setModuleDlg(null)} appointment={{ id: a.id, patient: a.patient, reason: a.reason }} />}
      {a && <VisitFromAppointmentDialog open={moduleDlg === 'visit'} onOpenChange={(o) => !o && setModuleDlg(null)} appointment={a} onDone={(vid) => router.push(`/livestock/visits/${vid}`)} />}
    </>
  );
}
