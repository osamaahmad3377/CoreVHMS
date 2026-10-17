'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarPlus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { PatientPicker, type PickedPatient } from '../patients/patient-picker';
import { Field } from '../forms/field';
import { FormError } from '../forms/form-error';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input, NativeSelect, Textarea } from '../ui/input';
import { useAppointmentTypes, useClinicians, useResources } from '@/hooks/use-catalog';
import { ApiError, api, qs } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import { branchTime, hhmm, parseHhmm, todayIn, zonedInstant } from '@/lib/time';
import type { Appointment } from '@/lib/types';

export interface BookingDefaults {
  date?: string;
  minute?: number;
  clinicianId?: string | null;
  patient?: PickedPatient | null;
  followUpOfId?: string;
  reason?: string;
  appointmentTypeId?: string;
}

type Override = { allowOverbook?: boolean; allowOutsideHours?: boolean };

export function BookingDialog({
  open,
  onOpenChange,
  defaults,
  onBooked,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defaults?: BookingDefaults;
  onBooked?: (a: Appointment) => void;
}) {
  const { session, currency } = useSession();
  const qc = useQueryClient();
  const tz = session.branch?.timezone ?? 'UTC';
  const branchId = session.branch?.id ?? '';
  const types = useAppointmentTypes();
  const clinicians = useClinicians(branchId);
  const resources = useResources(branchId);

  const [patient, setPatient] = useState<PickedPatient | null>(null);
  const [typeId, setTypeId] = useState('');
  const [clinicianId, setClinicianId] = useState('');
  const [date, setDate] = useState(todayIn(tz));
  const [time, setTime] = useState('09:00');
  const [duration, setDuration] = useState<number | ''>('');
  const [resourceIds, setResourceIds] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [repeat, setRepeat] = useState(false);
  const [everyWeeks, setEveryWeeks] = useState(1);
  const [occurrences, setOccurrences] = useState(4);
  const [error, setError] = useState<{ message: string; override?: Override; problems?: { startsAt: string; message: string }[] } | null>(null);

  useEffect(() => {
    if (!open) return;
    setPatient(defaults?.patient ?? null);
    setClinicianId(defaults?.clinicianId ?? '');
    setDate(defaults?.date ?? todayIn(tz));
    setTime(defaults?.minute !== undefined ? hhmm(defaults.minute) : '09:00');
    setReason(defaults?.reason ?? '');
    if (defaults?.appointmentTypeId) setTypeId(defaults.appointmentTypeId);
    setNotes('');
    setDuration('');
    setResourceIds([]);
    setRepeat(false);
    setError(null);
  }, [open, defaults, tz]);

  useEffect(() => {
    if (!typeId && types.data?.length) setTypeId(types.data[0].id);
  }, [types.data, typeId]);

  const type = types.data?.find((t) => t.id === typeId);
  const availability = useQuery({
    queryKey: ['availability', branchId, date, typeId, clinicianId],
    queryFn: () => api.get<{ clinicianId: string; name: string; slots: string[] }[]>(`/appointments/availability${qs({ branchId, date, appointmentTypeId: typeId, clinicianId: clinicianId || undefined })}`),
    enabled: open && !!typeId && !!date,
  });
  const slots = useMemo(() => {
    const list = availability.data ?? [];
    return clinicianId ? (list.find((c) => c.clinicianId === clinicianId)?.slots ?? []) : [];
  }, [availability.data, clinicianId]);

  const book = useMutation({
    mutationFn: (override: Override) =>
      api.post<Appointment | { series: Appointment[] }>('/appointments', {
        branchId,
        clientId: patient!.owner!.id,
        patientId: patient!.id,
        appointmentTypeId: typeId,
        clinicianId: clinicianId || null,
        resourceIds,
        startsAt: zonedInstant(date, parseHhmm(time), tz).toISOString(),
        durationMinutes: duration || undefined,
        reason,
        notes,
        followUpOfId: defaults?.followUpOfId,
        source: defaults?.followUpOfId ? 'FOLLOW_UP' : 'RECEPTION',
        repeat: repeat ? { everyWeeks, occurrences } : undefined,
        ...override,
      }),
    onSuccess: (res) => {
      const first = 'series' in res ? res.series[0] : res;
      toast.success('series' in res ? `Booked ${res.series.length} appointments` : `Booked ${first.appointmentNo}`);
      qc.invalidateQueries({ queryKey: ['appointments'] });
      qc.invalidateQueries({ queryKey: ['queue'] });
      qc.invalidateQueries({ queryKey: ['availability'] });
      onBooked?.(first);
      onOpenChange(false);
    },
    onError: (e: Error) => {
      if (e instanceof ApiError) {
        const d = e.details as any;
        const override: Override | undefined =
          e.code === 'OUTSIDE_WORKING_HOURS' ? { allowOutsideHours: true } : d?.code === 'CLINICIAN_BUSY' ? { allowOverbook: true } : undefined;
        setError({ message: e.message, override, problems: d?.problems });
      } else setError({ message: e.message });
    },
  });

  // Back-dated entries are allowed (e.g. recording a visit after the fact), but make it obvious.
  const startInstant = date && /^\d{1,2}:\d{2}$/.test(time) ? zonedInstant(date, parseHhmm(time), tz) : null;
  const inPast = !!startInstant && startInstant.getTime() < Date.now();

  const canSubmit = !!patient?.owner && !!typeId && (!type?.requiresClinician || !!clinicianId) && !!date && !!time;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarPlus className="h-4 w-4" /> New appointment
          </DialogTitle>
          <DialogDescription>
            {session.branch?.name} · times shown in {tz}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {error && (
            <div className="grid gap-2">
              {/* A soft warning (double-booking, outside hours) gets one amber box with its override, not a red error as well. */}
              {!error.override && <FormError message={error.message} />}
              {error.problems && (
                <ul className="ml-4 list-disc text-xs text-muted-foreground">
                  {error.problems.map((p) => (
                    <li key={p.startsAt}>
                      {branchTime(p.startsAt, tz, 'EEE d MMM HH:mm')}: {p.message}
                    </li>
                  ))}
                </ul>
              )}
              {error.override && (
                <div className="flex items-center justify-between gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
                  <span className="flex items-center gap-2 text-warning">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span>
                      {error.message}
                      <span className="block text-xs">{error.override.allowOverbook ? 'Double-book anyway?' : 'Book outside rostered hours?'}</span>
                    </span>
                  </span>
                  <Button size="sm" variant="outline" loading={book.isPending} onClick={() => book.mutate(error.override!)}>
                    Book anyway
                  </Button>
                </div>
              )}
            </div>
          )}
          <Field label="Patient" htmlFor="bk-patient" required>
            <PatientPicker id="bk-patient" value={patient} onChange={setPatient} />
          </Field>
          {patient && !patient.owner && <p className="text-xs text-destructive">This patient has no current owner.</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Appointment type" htmlFor="bk-type" required>
              <NativeSelect id="bk-type" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
                {types.data?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {t.durationMinutes} min{t.priceMinor ? ` · ${fmtMoney(t.priceMinor, currency)}` : ''}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Clinician" htmlFor="bk-clin" required={type?.requiresClinician}>
              <NativeSelect id="bk-clin" value={clinicianId} onChange={(e) => setClinicianId(e.target.value)}>
                <option value="">{type?.requiresClinician ? 'Select clinician…' : 'Unassigned'}</option>
                {clinicians.data?.map((c) => (
                  <option key={c.membershipId} value={c.membershipId}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Date" htmlFor="bk-date" required>
              <Input id="bk-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <div className="grid grid-cols-[1fr_110px] gap-2">
              <Field label="Start time" htmlFor="bk-time" required>
                <Input id="bk-time" type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} />
              </Field>
              <Field label="Minutes" htmlFor="bk-dur">
                <Input id="bk-dur" type="number" min={5} max={720} placeholder={String(type?.durationMinutes ?? '')} value={duration} onChange={(e) => setDuration(e.target.value ? Number(e.target.value) : '')} />
              </Field>
            </div>
          </div>
          {inPast && (
            <p className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning" role="status">
              <AlertTriangle className="h-4 w-4 shrink-0" /> This time has already passed. Book it only to record a visit that already happened.
            </p>
          )}
          {clinicianId && (
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Free times for this clinician</p>
              {availability.isLoading ? (
                <p className="text-xs text-muted-foreground">Checking availability…</p>
              ) : slots.length ? (
                <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">
                  {slots.map((s) => {
                    const t = branchTime(s, tz);
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setTime(t)}
                        className={`rounded border px-2 py-0.5 text-xs tabular hover:border-primary ${t === time ? 'border-primary bg-primary text-primary-foreground' : ''}`}
                      >
                        {t}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No free slots on this date (not rostered, on leave or fully booked).</p>
              )}
            </div>
          )}
          {!!resources.data?.length && (
            <fieldset>
              <legend className="mb-1 text-sm font-medium">Rooms / equipment</legend>
              <div className="flex flex-wrap gap-3">
                {resources.data.map((r) => (
                  <label key={r.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={resourceIds.includes(r.id)}
                      onCheckedChange={(v) => setResourceIds((ids) => (v === true ? [...ids, r.id] : ids.filter((x) => x !== r.id)))}
                    />
                    {r.name}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <Field label="Reason for visit" htmlFor="bk-reason">
            <Input id="bk-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          </Field>
          <Field label="Booking notes" htmlFor="bk-notes">
            <Textarea id="bk-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2">
              <Checkbox checked={repeat} onCheckedChange={(v) => setRepeat(v === true)} /> Repeat
            </label>
            {repeat && (
              <>
                every
                <Input type="number" min={1} max={52} className="h-8 w-16" aria-label="Every N weeks" value={everyWeeks} onChange={(e) => setEveryWeeks(Number(e.target.value))} />
                week(s),
                <Input type="number" min={2} max={52} className="h-8 w-16" aria-label="Occurrences" value={occurrences} onChange={(e) => setOccurrences(Number(e.target.value))} />
                times
              </>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!canSubmit} loading={book.isPending} onClick={() => { setError(null); book.mutate({}); }}>
            Book appointment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
