'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarPlus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { apptSummary } from './appointment-text';
import { EMPTY_HOME_VISIT, HomeVisitFields, LocationSwitch, useHomeVisitSettings, type HomeVisitValue, type VisitLocation } from './home-visit-fields';
import { PatientPicker, type PickedPatient } from '../patients/patient-picker';
import { Field } from '../forms/field';
import { FormError } from '../forms/form-error';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input, NativeSelect, Textarea } from '../ui/input';
import { useAppointmentTypes, useClinicians, useResources } from '@/hooks/use-catalog';
import { useDiscardConfirm } from '@/hooks/use-discard-confirm';
import { ApiError, api, qs } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import { useModuleOn, useSession } from '@/lib/session';
import { branchTime, hhmm, minuteOfDay, parseHhmm, shiftDate, todayIn, zonedInstant } from '@/lib/time';
import type { Appointment } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Vet choice meaning "whichever vet is free first at the chosen time". */
export const ANY_VET = '__any';

/** The browser's own time zone, read after mount so server and client render the same markup. */
export function useBrowserTimeZone() {
  const [zone, setZone] = useState<string | null>(null);
  useEffect(() => {
    try {
      setZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    } catch {
      setZone(null);
    }
  }, []);
  return zone;
}

/** "Times shown in Asia/Karachi" is only worth saying when this computer is set to a different time zone. */
export function useTimeZoneNote(tz: string) {
  const zone = useBrowserTimeZone();
  return zone && zone !== tz ? `Times shown in ${tz} (the branch’s time zone)` : null;
}

export interface AvailabilityRow {
  clinicianId: string;
  name: string;
  slots: string[];
}

/** Clickable free start times; one button per time, the chosen one highlighted. */
export function FreeTimeButtons({ slots, tz, value, onPick, titleFor }: { slots: string[]; tz: string; value: string; onPick: (hhmm: string) => void; titleFor?: (iso: string) => string | undefined }) {
  return (
    <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto">
      {slots.map((s) => {
        const t = branchTime(s, tz);
        return (
          <button
            key={s}
            type="button"
            title={titleFor?.(s)}
            onClick={() => onPick(t)}
            className={cn('rounded border px-2 py-1 text-xs tabular hover:border-primary', t === value && 'border-primary bg-primary text-primary-foreground')}
          >
            {t}
          </button>
        );
      })}
    </div>
  );
}

/** First start time, as yyyy-MM-dd + HH:mm in the branch zone, that is not in the past: the next quarter hour today, else 09:00. */
function fallbackTime(date: string, tz: string) {
  if (date !== todayIn(tz)) return '09:00';
  const next = Math.min(Math.ceil((minuteOfDay(new Date(), tz) + 1) / 15) * 15, 23 * 60 + 45);
  return hhmm(next);
}

const withStop = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);

export interface BookingDefaults {
  date?: string;
  minute?: number;
  clinicianId?: string | null;
  patient?: PickedPatient | null;
  followUpOfId?: string;
  reason?: string;
  appointmentTypeId?: string;
  /** Pick the first appointment type of this category (e.g. VACCINATION) when no type id is given. */
  typeCategory?: string;
  /** Start as a home visit (e.g. from the Home visits page). */
  location?: VisitLocation;
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

  const discard = useDiscardConfirm();
  const tzNote = useTimeZoneNote(tz);
  const [patient, setPatient] = useState<PickedPatient | null>(null);
  const [typeId, setTypeId] = useState('');
  /** A vet's membership id, ANY_VET, or '' for "no vet yet". */
  const [clinicianId, setClinicianId] = useState(ANY_VET);
  const [date, setDate] = useState(todayIn(tz));
  const [time, setTime] = useState('09:00');
  /** True until the user picks a time themselves: the start time follows the next free slot. */
  const [timeAuto, setTimeAuto] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [duration, setDuration] = useState<number | ''>('');
  const [resourceIds, setResourceIds] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [repeat, setRepeat] = useState(false);
  const [everyWeeks, setEveryWeeks] = useState(1);
  const [occurrences, setOccurrences] = useState(4);
  const homeVisitsOn = useModuleOn()('homeVisits');
  const [location, setLocation] = useState<VisitLocation>('CLINIC');
  const [visit, setVisit] = useState<HomeVisitValue>(EMPTY_HOME_VISIT);
  const hvSettings = useHomeVisitSettings(open && homeVisitsOn);
  const isHome = homeVisitsOn && location === 'HOME';
  const travelMinutes = isHome ? (visit.travelMinutes === '' ? (hvSettings.data?.travelMinutes ?? 0) : visit.travelMinutes) : 0;
  const [error, setError] = useState<{ message: string; override?: Override; problems?: { startsAt: string; message: string }[] } | null>(null);

  useEffect(() => {
    if (!open) return;
    setPatient(defaults?.patient ?? null);
    setClinicianId(defaults?.clinicianId === undefined ? ANY_VET : (defaults.clinicianId ?? ''));
    setDate(defaults?.date ?? todayIn(tz));
    setTime(defaults?.minute !== undefined ? hhmm(defaults.minute) : fallbackTime(defaults?.date ?? todayIn(tz), tz));
    setTimeAuto(defaults?.minute === undefined);
    setDirty(false);
    setReason(defaults?.reason ?? '');
    if (defaults?.appointmentTypeId) setTypeId(defaults.appointmentTypeId);
    setNotes('');
    setDuration('');
    setResourceIds([]);
    setRepeat(false);
    setLocation(defaults?.location ?? 'CLINIC');
    setVisit(EMPTY_HOME_VISIT);
    setError(null);
  }, [open, defaults, tz]);

  // A suggested type category (e.g. VACCINATION from the due list) is applied once per opening, when the types are loaded.
  const categoryApplied = useRef(false);
  useEffect(() => {
    if (!open) {
      categoryApplied.current = false;
      return;
    }
    if (categoryApplied.current || !defaults?.typeCategory || defaults.appointmentTypeId || !types.data) return;
    categoryApplied.current = true;
    const match = types.data.find((t) => t.category === defaults.typeCategory);
    if (match) setTypeId(match.id);
  }, [open, defaults, types.data]);

  useEffect(() => {
    if (!typeId && types.data?.length) setTypeId(types.data[0].id);
  }, [types.data, typeId]);

  const type = types.data?.find((t) => t.id === typeId);
  const anyVet = clinicianId === ANY_VET;
  const availability = useQuery({
    queryKey: ['availability', branchId, date, typeId, anyVet ? '' : clinicianId, travelMinutes],
    // A home visit needs the vet free for the travel time too.
    queryFn: () => api.get<AvailabilityRow[]>(`/appointments/availability${qs({ branchId, date, appointmentTypeId: typeId, clinicianId: anyVet ? undefined : clinicianId || undefined, travelMinutes: travelMinutes || undefined })}`),
    enabled: open && !!typeId && !!date && clinicianId !== '',
  });
  // One vet: their free times. Any vet: every time at least one vet is free.
  const slots = useMemo(() => {
    const list = availability.data ?? [];
    if (anyVet) return [...new Set(list.flatMap((c) => c.slots))].sort();
    return clinicianId ? (list.find((c) => c.clinicianId === clinicianId)?.slots ?? []) : [];
  }, [availability.data, clinicianId, anyVet]);

  // Start at the next free time instead of a time that has already passed.
  useEffect(() => {
    if (!open || !timeAuto) return;
    if (clinicianId && availability.isLoading) return;
    setTime(slots.length ? branchTime(slots[0], tz) : fallbackTime(date, tz));
  }, [open, timeAuto, slots, clinicianId, availability.isLoading, date, tz]);

  const pickTime = (t: string) => {
    setTime(t);
    setTimeAuto(false);
    setDirty(true);
  };

  const book = useMutation({
    mutationFn: (override: Override) =>
      api.post<Appointment | { series: Appointment[] }>('/appointments', {
        branchId,
        clientId: patient!.owner!.id,
        patientId: patient!.id,
        appointmentTypeId: typeId,
        clinicianId: resolvedClinicianId,
        resourceIds: isHome ? [] : resourceIds,
        ...(isHome
          ? { location: 'HOME', visitAddress: visit.visitAddress, visitDirections: visit.visitDirections, visitMapUrl: visit.visitMapUrl, travelMinutes }
          : { location: 'CLINIC' }),
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
      const summary = apptSummary({ ...first, patient: first.patient ?? (patient ? { name: patient.name } : null) } as Appointment, tz);
      toast.success('series' in res ? `${res.series.length} appointments booked, the first: ${summary}` : `Appointment booked: ${summary}`);
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

  // "Any vet": the first vet (in the list order) who is free at the chosen start time.
  const startIso = startInstant?.toISOString();
  const firstFree = anyVet && startIso ? (availability.data ?? []).find((c) => c.slots.includes(startIso)) : undefined;
  const resolvedClinicianId = anyVet ? (firstFree?.clinicianId ?? null) : clinicianId || null;
  const vetMissing = anyVet ? !firstFree : !!type?.requiresClinician && !clinicianId;

  const addressMissing = isHome && !visit.visitAddress.trim();
  const canSubmit = !!patient?.owner && !!typeId && !vetMissing && !!date && !!time && !addressMissing;
  const blockedReason = canSubmit
    ? null
    : patient?.owner && !vetMissing && addressMissing
      ? 'Enter the address the vet should go to'
      : !patient && vetMissing && !anyVet
      ? 'Choose a patient and a vet to continue'
      : !patient
        ? 'Choose a patient to continue'
        : anyVet && vetMissing
          ? availability.isLoading
            ? 'Checking which vets are free…'
            : `No vet is free at ${time}. Pick a free time below, or choose a vet.`
          : vetMissing
            ? 'Choose a vet to continue'
            : null;

  const close = async () => {
    if (await discard(dirty)) onOpenChange(false);
  };
  const today = todayIn(tz);
  const shortcuts = [
    { label: 'Today', date: today },
    { label: 'Tomorrow', date: shiftDate(today, 1) },
    { label: 'Next week', date: shiftDate(today, 7) },
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : void close())}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarPlus className="h-4 w-4" /> {isHome ? 'Book a home visit' : 'Book appointment'}
          </DialogTitle>
          <DialogDescription>
            {session.branch?.name}
            {tzNote && ` · ${tzNote}`}
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
                      {withStop(error.message)} {error.override.allowOverbook ? 'Double-book anyway?' : 'Book anyway?'}
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
            <PatientPicker
              id="bk-patient"
              value={patient}
              allowCreate
              onChange={(p) => {
                setPatient(p);
                setDirty(true);
              }}
            />
          </Field>
          {patient && !patient.owner && <p className="text-xs text-destructive">This patient has no client linked. Add the client on the patient’s page first.</p>}
          {homeVisitsOn && (
            <LocationSwitch
              value={location}
              onChange={(v) => {
                setLocation(v);
                setDirty(true);
              }}
            />
          )}
          {isHome && (
            <HomeVisitFields
              clientId={patient?.owner?.id}
              value={visit}
              onChange={(v) => {
                setVisit(v);
                setDirty(true);
              }}
              idPrefix="bk-hv"
              defaultTravelMinutes={hvSettings.data?.travelMinutes}
            />
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Appointment type" htmlFor="bk-type" required>
              <NativeSelect id="bk-type" value={typeId} onChange={(e) => { setTypeId(e.target.value); setDirty(true); }}>
                {types.data?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {t.durationMinutes} min{(t.service?.priceMinor ?? t.priceMinor) ? ` · ${fmtMoney((t.service?.priceMinor ?? t.priceMinor)!, currency)}` : ''}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Vet" htmlFor="bk-clin" required={type?.requiresClinician}>
              <NativeSelect id="bk-clin" value={clinicianId} onChange={(e) => { setClinicianId(e.target.value); setDirty(true); }}>
                <option value={ANY_VET}>Any vet (first free)</option>
                {type?.requiresClinician ? <option value="" disabled>Choose a vet…</option> : <option value="">No vet yet</option>}
                {clinicians.data?.map((c) => (
                  <option key={c.membershipId} value={c.membershipId}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <div className="grid content-start gap-1.5">
              <Field label="Date" htmlFor="bk-date" required>
                <Input id="bk-date" type="date" value={date} onChange={(e) => { setDate(e.target.value); setDirty(true); }} />
              </Field>
              <div className="flex flex-wrap gap-1" role="group" aria-label="Date shortcuts">
                {shortcuts.map((d) => (
                  <Button
                    key={d.label}
                    type="button"
                    size="sm"
                    variant={date === d.date ? 'default' : 'outline'}
                    className="h-7 px-2 text-xs"
                    onClick={() => { setDate(d.date); setDirty(true); }}
                  >
                    {d.label}
                  </Button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-[1fr_110px] content-start gap-2">
              <Field label={isHome ? 'Arrival time' : 'Start time'} htmlFor="bk-time" required>
                <Input id="bk-time" type="time" step={300} value={time} onChange={(e) => pickTime(e.target.value)} />
              </Field>
              <Field label="Minutes" htmlFor="bk-dur">
                <Input id="bk-dur" type="number" min={5} max={720} placeholder={String(type?.durationMinutes ?? '')} value={duration} onChange={(e) => { setDuration(e.target.value ? Number(e.target.value) : ''); setDirty(true); }} />
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
              <p className="mb-1 text-xs font-medium text-muted-foreground">{anyVet ? 'Free times (any vet)' : 'Free times for this vet'}</p>
              {availability.isLoading ? (
                <p className="text-xs text-muted-foreground">Checking which times are free…</p>
              ) : slots.length ? (
                <FreeTimeButtons
                  slots={slots}
                  tz={tz}
                  value={time}
                  onPick={pickTime}
                  titleFor={anyVet ? (iso) => `Free: ${(availability.data ?? []).filter((c) => c.slots.includes(iso)).map((c) => c.name).join(', ')}` : undefined}
                />
              ) : (
                <p className="text-xs text-muted-foreground">
                  {anyVet ? 'No vet has a free time on this date. Try another day.' : 'No free times on this date (not working, on leave or fully booked).'}
                </p>
              )}
              {anyVet && firstFree && <p className="mt-1 text-xs">Vet: <b>{firstFree.name}</b> (first free at {time})</p>}
              {isHome && travelMinutes > 0 && startInstant && (
                <p className="mt-1 text-xs text-muted-foreground">The vet leaves at {hhmm(Math.max(0, minuteOfDay(startInstant, tz) - travelMinutes))} ({travelMinutes} min travel is blocked on their calendar).</p>
              )}
            </div>
          )}
          {!isHome && !!resources.data?.length && (
            <fieldset>
              <legend className="mb-1 text-sm font-medium">Rooms / equipment</legend>
              <div className="flex flex-wrap gap-3">
                {resources.data.map((r) => (
                  <label key={r.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={resourceIds.includes(r.id)}
                      onCheckedChange={(v) => { setResourceIds((ids) => (v === true ? [...ids, r.id] : ids.filter((x) => x !== r.id))); setDirty(true); }}
                    />
                    {r.name}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <Field label="Reason for visit" htmlFor="bk-reason">
            <Input id="bk-reason" value={reason} onChange={(e) => { setReason(e.target.value); setDirty(true); }} maxLength={500} />
          </Field>
          <Field label="Booking notes" htmlFor="bk-notes">
            <Textarea id="bk-notes" rows={2} value={notes} onChange={(e) => { setNotes(e.target.value); setDirty(true); }} />
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
        <DialogFooter className="items-center">
          {blockedReason && (
            <p className="mr-auto text-xs text-muted-foreground" role="status">
              {blockedReason}
            </p>
          )}
          <Button variant="outline" onClick={() => void close()}>
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
