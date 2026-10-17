'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { enumLabel } from '@vcms/shared';
import { AlertTriangle, CalendarClock, CalendarPlus, CheckCircle2, ClipboardCheck, LogIn, Play, Scissors, Siren, Stethoscope, Tractor, UserX, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Field } from '../forms/field';
import { FormError } from '../forms/form-error';
import { DescriptionList, ErrorState, LoadingRows } from '../page';
import { AlertChip } from '../status';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input, NativeSelect, Textarea } from '../ui/input';
import { AppointmentStatusBadge, PriorityDot } from './appointment-status';
import { apptWho, statusChangeMessage } from './appointment-text';
import { BookingDialog, FreeTimeButtons, type AvailabilityRow, type BookingDefaults } from './booking-dialog';
import { TriageDialog } from './triage-dialog';
import { GroomingCheckInDialog } from '../boarding/dialogs';
import { VisitFromAppointmentDialog } from '../livestock/record-dialogs';
import { useClinicians } from '@/hooks/use-catalog';
import { ApiError, api, qs } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import { branchTime, localDate, minuteOfDay, hhmm, parseHhmm, todayIn, zonedInstant } from '@/lib/time';
import type { Appointment } from '@/lib/types';
import { cn } from '@/lib/utils';

const CANCEL_REASONS = ['Owner cancelled', 'Patient is better', 'Booked by mistake'] as const;
const OTHER = 'Other';

/** Cancel with a one-tap reason; "Other…" opens a text box. The reason is stored on the appointment. */
function CancelAppointmentDialog({
  appointment,
  tz,
  open,
  onOpenChange,
  onConfirm,
  pending,
}: {
  appointment: Appointment;
  tz: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onConfirm: (reason: string) => void;
  pending: boolean;
}) {
  const [choice, setChoice] = useState<string>('');
  const [other, setOther] = useState('');
  useEffect(() => {
    if (open) {
      setChoice('');
      setOther('');
    }
  }, [open]);
  const reason = choice === OTHER ? other.trim() : choice;
  const day = localDate(appointment.startsAt, tz) === todayIn(tz) ? 'today' : `on ${branchTime(appointment.startsAt, tz, 'EEE d MMM')}`;
  const who = appointment.patient ? `${appointment.patient.name}’s` : `${appointment.client.displayName}’s`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>
            Cancel {who} appointment {day} at {branchTime(appointment.startsAt, tz)}?
          </DialogTitle>
          <DialogDescription>Choose a reason. The time becomes free for other bookings.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2" role="radiogroup" aria-label="Reason for cancelling">
          {[...CANCEL_REASONS, OTHER].map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={choice === r}
              onClick={() => setChoice(r)}
              className={cn('rounded-md border px-3 py-2 text-left text-sm hover:bg-muted', choice === r && 'border-primary bg-primary/10 font-medium')}
            >
              {r === OTHER ? 'Other…' : r}
            </button>
          ))}
          {choice === OTHER && (
            <Field label="Reason" htmlFor="cancel-other" required>
              <Textarea id="cancel-other" rows={2} autoFocus maxLength={500} value={other} onChange={(e) => setOther(e.target.value)} />
            </Field>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Keep appointment
          </Button>
          <Button variant="destructive" disabled={!reason} loading={pending} onClick={() => onConfirm(reason)}>
            Cancel appointment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AppointmentDialog({ id, open, onOpenChange }: { id: string | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { session, can } = useSession();
  const tz = session.branch?.timezone ?? 'UTC';
  const qc = useQueryClient();
  const router = useRouter();
  const [moduleDlg, setModuleDlg] = useState<null | 'grooming' | 'visit'>(null);
  const [cancelling, setCancelling] = useState(false);
  const q = useQuery({ queryKey: ['appointment', id], queryFn: () => api.get<Appointment>(`/appointments/${id}`), enabled: open && !!id });
  const clinicians = useClinicians(session.branch?.id);
  const [mode, setMode] = useState<'view' | 'reschedule'>('view');
  const [triageOpen, setTriageOpen] = useState(false);
  const [rebook, setRebook] = useState<BookingDefaults | null>(null);
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
      setCancelling(false);
      toast.success(statusChangeMessage(vars.action, a, tz));
      if (vars.action === 'start' && a.encounterId) router.push(`/consultations/${a.encounterId}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reschedule = useMutation({
    mutationFn: (override: { allowOverbook?: boolean; allowOutsideHours?: boolean }) =>
      api.patch<Appointment>(`/appointments/${id}`, { startsAt: zonedInstant(date, parseHhmm(time), tz).toISOString(), clinicianId: clinicianId || null, ...override }),
    onSuccess: (after) => {
      // The API resets a confirmed appointment to Booked when its time changes, so the client should be asked again.
      const when = `${apptWho(after)}, ${branchTime(after.startsAt, tz, 'EEE d MMM')} at ${branchTime(after.startsAt, tz)}${after.clinician ? ` with ${after.clinician.name}` : ''} (${after.appointmentNo})`;
      if (q.data?.status === 'CONFIRMED' && after.status === 'BOOKED') toast.warning(`Appointment moved: ${when}. Ask the owner to confirm the new time again.`);
      else toast.success(`Appointment moved: ${when}`);
      refresh();
      setMode('view');
    },
    onError: (e: Error) => setError({ message: e.message, code: e instanceof ApiError ? (e.code === 'OUTSIDE_WORKING_HOURS' ? e.code : (e.details as any)?.code) : undefined }),
  });

  const a = q.data;
  const s = a?.status;
  // Free start times for the reschedule form: the chosen vet's, or every vet's when none is chosen.
  const availability = useQuery({
    queryKey: ['availability', a?.branchId, date, a?.appointmentType.id, clinicianId],
    queryFn: () => api.get<AvailabilityRow[]>(`/appointments/availability${qs({ branchId: a!.branchId, date, appointmentTypeId: a!.appointmentType.id, clinicianId: clinicianId || undefined })}`),
    enabled: open && mode === 'reschedule' && !!a && !!date,
  });
  const freeSlots = [...new Set((availability.data ?? []).filter((c) => !clinicianId || c.clinicianId === clinicianId).flatMap((c) => c.slots))].sort();
  const actions: { key: string; label: string; icon: React.ComponentType; show: boolean; variant?: 'outline' | 'default' | 'destructive'; reason?: boolean }[] = a
    ? [
        { key: 'confirm', label: 'Owner confirmed', icon: ClipboardCheck, show: s === 'BOOKED' && (can('appointments.write') || can('appointments.checkin')), variant: 'outline' },
        { key: 'check-in', label: 'Check in', icon: LogIn, show: (s === 'BOOKED' || s === 'CONFIRMED') && can('appointments.checkin') },
        { key: 'start', label: 'Start consultation', icon: Play, show: ['BOOKED', 'CONFIRMED', 'CHECKED_IN'].includes(s!) && !!a.patient && can('clinical.write') },
        { key: 'complete', label: 'Mark finished', icon: CheckCircle2, show: (s === 'CHECKED_IN' || s === 'IN_CONSULTATION') && (can('clinical.write') || can('appointments.checkin')), variant: 'outline' },
        { key: 'no-show', label: 'No-show', icon: UserX, show: (s === 'BOOKED' || s === 'CONFIRMED') && new Date(a.startsAt) < new Date() && (can('appointments.write') || can('appointments.checkin')), variant: 'outline' },
        { key: 'revert', label: s === 'NO_SHOW' ? 'Undo no-show' : 'Undo check-in', icon: XCircle, show: (s === 'CHECKED_IN' || s === 'NO_SHOW') && can('appointments.checkin'), variant: 'outline' },
        { key: 'cancel', label: 'Cancel appointment', icon: XCircle, show: ['BOOKED', 'CONFIRMED', 'CHECKED_IN'].includes(s!) && can('appointments.write'), variant: 'destructive', reason: true },
      ]
    : [];
  const visibleActions = actions.filter((x) => x.show);
  const canTriage = !!a?.patient && ['BOOKED', 'CONFIRMED', 'CHECKED_IN'].includes(s ?? '') && can('triage.write');
  const canReschedule = ['BOOKED', 'CONFIRMED', 'CHECKED_IN'].includes(s ?? '') && can('appointments.write');
  const canRebook = !!a?.patient && (s === 'CANCELLED' || s === 'NO_SHOW') && can('appointments.write');
  const moduleLinks = a
    ? [
        a.groomingJob && can('boarding.read'),
        !a.groomingJob && a.appointmentType.category === 'GROOMING' && ['BOOKED', 'CONFIRMED', 'CHECKED_IN'].includes(a.status) && can('boarding.write'),
        a.fieldVisit && can('livestock.read'),
        !a.fieldVisit && a.appointmentType.category === 'FIELD_VISIT' && !['CANCELLED', 'NO_SHOW'].includes(a.status) && can('livestock.write'),
      ].some(Boolean)
    : false;
  const hasActions = !!a?.encounter || moduleLinks || visibleActions.length > 0 || canTriage || canReschedule || canRebook;
  const softClash = error?.code === 'CLINICIAN_BUSY' || error?.code === 'OUTSIDE_WORKING_HOURS';

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
                      { label: 'Vet', value: a.clinician?.name ?? 'No vet yet' },
                      { label: 'Rooms', value: a.resources.map((r) => r.name).join(', ') },
                      { label: 'Reason', value: a.reason },
                      { label: 'Notes', value: a.notes },
                      { label: 'Checked in', value: a.checkedInAt && fmtDateTime(a.checkedInAt) },
                      { label: 'Triage', value: a.triage && `${enumLabel(a.triage.priority)} — ${a.triage.presentingComplaint} (${a.triage.assessedByName})` },
                      ...(a.cancelReason ? [{ label: 'Cancelled', value: `${fmtDateTime(a.cancelledAt)} — ${a.cancelReason}` }] : []),
                    ]}
                  />
                  {/* Reference details for the office; kept small so they do not compete with the actions. */}
                  <p className="text-2xs text-muted-foreground">
                    {/* Walk-ins are always stored as overbooked (they sit alongside bookings), so the flag is noise for them. */}
                    Ref. {a.appointmentNo} · booked via {enumLabel(a.source).toLowerCase()}
                    {a.isOverbooked && a.source !== 'WALK_IN' ? ' · double-booked' : ''}
                  </p>
                  {hasActions && (
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
                    {canRebook && (
                      <Button
                        size="sm"
                        onClick={() =>
                          setRebook({
                            patient: {
                              id: a.patient!.id,
                              name: a.patient!.name,
                              patientNo: `P-${String(a.patient!.number).padStart(6, '0')}`,
                              species: { id: '', name: a.patient!.species.name, category: '' },
                              owner: { id: a.client.id, displayName: a.client.displayName, mobilePhone: a.client.mobilePhone },
                              alerts: a.patient!.alerts,
                            },
                            appointmentTypeId: a.appointmentType.id,
                            clinicianId: a.clinician?.id ?? null,
                            reason: a.reason ?? undefined,
                          })
                        }
                      >
                        <CalendarPlus /> Book again
                      </Button>
                    )}
                    {visibleActions.map((x) => (
                      <Button
                        key={x.key}
                        size="sm"
                        variant={x.variant ?? 'default'}
                        loading={act.isPending && act.variables?.action === x.key}
                        onClick={async () => {
                          if (x.reason) setCancelling(true);
                          else act.mutate({ action: x.key });
                        }}
                      >
                        <x.icon /> {x.label}
                      </Button>
                    ))}
                    {canTriage && (
                      <Button size="sm" variant="outline" onClick={() => setTriageOpen(true)}>
                        <Siren /> Triage
                      </Button>
                    )}
                    {canReschedule && (
                      <Button size="sm" variant="outline" onClick={() => setMode('reschedule')}>
                        <CalendarClock /> Reschedule
                      </Button>
                    )}
                  </div>
                  )}
                </>
              ) : (
                <div className="grid gap-3">
                  {error && !softClash && <FormError message={error.message} />}
                  {error && softClash && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm" role="alert">
                      <span className="flex items-center gap-2 text-warning">
                        <AlertTriangle className="h-4 w-4 shrink-0" /> {error.message}
                      </span>
                      <Button size="sm" variant="outline" loading={reschedule.isPending} onClick={() => reschedule.mutate(error.code === 'CLINICIAN_BUSY' ? { allowOverbook: true } : { allowOutsideHours: true })}>
                        Move anyway
                      </Button>
                    </div>
                  )}
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Date" htmlFor="rs-date"><Input id="rs-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
                    <Field label="Time" htmlFor="rs-time"><Input id="rs-time" type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} /></Field>
                    <Field label="Vet" htmlFor="rs-clin">
                      <NativeSelect id="rs-clin" value={clinicianId} onChange={(e) => setClinicianId(e.target.value)}>
                        <option value="">No vet yet</option>
                        {clinicians.data?.map((c) => <option key={c.membershipId} value={c.membershipId}>{c.name}</option>)}
                      </NativeSelect>
                    </Field>
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">{clinicianId ? 'Free times for this vet' : 'Free times (any vet)'}</p>
                    {availability.isLoading ? (
                      <p className="text-xs text-muted-foreground">Checking which times are free…</p>
                    ) : freeSlots.length ? (
                      <FreeTimeButtons slots={freeSlots} tz={tz} value={time} onPick={setTime} />
                    ) : (
                      <p className="text-xs text-muted-foreground">No free times on this date. Try another day.</p>
                    )}
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
      {a && (
        <CancelAppointmentDialog
          appointment={a}
          tz={tz}
          open={cancelling}
          onOpenChange={setCancelling}
          pending={act.isPending && act.variables?.action === 'cancel'}
          onConfirm={(reason) => act.mutate({ action: 'cancel', reason })}
        />
      )}
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
          defaultComplaint={a.triage?.presentingComplaint ?? a.reason}
        />
      )}
      <BookingDialog
        open={!!rebook}
        onOpenChange={(o) => !o && setRebook(null)}
        defaults={rebook ?? undefined}
        onBooked={() => {
          setRebook(null);
          onOpenChange(false);
        }}
      />
      {a && <GroomingCheckInDialog open={moduleDlg === 'grooming'} onOpenChange={(o) => !o && setModuleDlg(null)} appointment={{ id: a.id, patient: a.patient, reason: a.reason }} />}
      {a && <VisitFromAppointmentDialog open={moduleDlg === 'visit'} onOpenChange={(o) => !o && setModuleDlg(null)} appointment={a} onDone={(vid) => router.push(`/livestock/visits/${vid}`)} />}
    </>
  );
}
