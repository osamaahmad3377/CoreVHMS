'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertOctagon, CalendarDays, CalendarPlus, Car, Check, ChevronLeft, ChevronRight, Globe, House, ListChecks, Users, XCircle } from 'lucide-react';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useConfirm } from '@/components/confirm';
import { ErrorState, LoadingRows, PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { AppointmentDialog } from '@/components/scheduling/appointment-dialog';
import { PriorityDot } from '@/components/scheduling/appointment-status';
import { apptSummary } from '@/components/scheduling/appointment-text';
import { AppointmentsList } from '@/components/scheduling/appointments-list';
import { BookingDialog, useTimeZoneNote, type BookingDefaults } from '@/components/scheduling/booking-dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, NativeSelect } from '@/components/ui/input';
import { Avatar } from '@/components/ui/misc';
import { useClinicians } from '@/hooks/use-catalog';
import { useUrlState } from '@/hooks/use-url-state';
import { ApiError, api, qs } from '@/lib/api';
import { useModuleOn, useSession } from '@/lib/session';
import { branchTime, dayLabel, dowOf, hhmm, localDate, minuteOfDay, monthGrid, shiftDate, shiftMonth, todayIn, weekStart, zonedInstant } from '@/lib/time';
import type { Appointment, PatientRow, RosterEntry } from '@/lib/types';
import { tabListClass, tabTriggerClass } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

const PX_PER_MIN = 1.6;
const DEFAULT_START = 8 * 60;
const DEFAULT_END = 19 * 60;

interface Column {
  key: string;
  title: string;
  subtitle?: string;
  date: string;
  clinicianId: string | null;
  /** Minutes that are rostered (free to book); everything else is shaded. */
  available: [number, number][];
  /** Leave periods as minute ranges. */
  leave: [number, number][];
  appointments: Appointment[];
}

/** Where an appointment's time on the calendar begins: a home visit's travel time comes first. */
const blockStart = (a: Appointment) => a.travelStartsAt ?? a.startsAt;

/** Greedy lane assignment so overlapping (overbooked) appointments sit side by side. */
function layout(appts: Appointment[], tz: string) {
  const items = appts
    .map((a) => ({ a, start: minuteOfDay(blockStart(a), tz), end: Math.max(minuteOfDay(a.endsAt, tz), minuteOfDay(a.startsAt, tz) + 10) }))
    .sort((x, y) => x.start - y.start);
  const lanes: number[] = [];
  const placed = items.map((it) => {
    let lane = lanes.findIndex((end) => end <= it.start);
    if (lane === -1) {
      lane = lanes.length;
      lanes.push(it.end);
    } else lanes[lane] = it.end;
    return { ...it, lane };
  });
  return placed.map((p) => ({ ...p, lanes: Math.max(1, ...placed.filter((o) => o.start < p.end && o.end > p.start).map((o) => o.lane + 1)) }));
}

/** How each status looks on a card: a short label and its colour. */
const STATUS_LOOK: Record<string, { label: string; chip: string }> = {
  BOOKED: { label: 'Booked', chip: 'bg-muted text-muted-foreground' },
  CONFIRMED: { label: 'Confirmed', chip: 'bg-success/15 text-success' },
  CHECKED_IN: { label: 'Arrived', chip: 'bg-warning/15 text-warning' },
  IN_CONSULTATION: { label: 'With vet', chip: 'bg-primary/15 text-primary' },
  COMPLETED: { label: 'Done', chip: 'bg-muted text-muted-foreground' },
  CANCELLED: { label: 'Cancelled', chip: 'bg-destructive/10 text-destructive' },
  NO_SHOW: { label: 'No-show', chip: 'bg-destructive/10 text-destructive' },
};
/** A soft wash of the appointment type's colour behind a card. */
const tint = (color: string, pct = 12) => `color-mix(in srgb, ${color} ${pct}%, hsl(var(--card)))`;

/** Appointments that can still be moved (same rule as the server's reschedule). */
const MOVABLE = new Set(['BOOKED', 'CONFIRMED', 'CHECKED_IN']);
const MONTH_CELL_LIMIT = 3;

function CalendarView() {
  const { session, can } = useSession();
  const tz = session.branch?.timezone ?? 'UTC';
  const tzNote = useTimeZoneNote(tz);
  const branchId = session.branch?.id ?? '';
  const url = useUrlState();
  const view = url.get('view', 'day') as 'day' | 'week' | 'month';
  // The calendar grid, or every booking as a list.
  const tab = url.get('tab') === 'appointments' ? 'appointments' : 'calendar';
  const toConfirm = useQuery({
    queryKey: ['appointment-bookings', 'to-confirm', session.branch?.id],
    queryFn: () => api.get<{ meta: { total: number } }>(`/appointments/bookings${qs({ branchId: session.branch?.id, status: 'toConfirm', when: 'upcoming', pageSize: 1 })}`),
    refetchInterval: 60_000,
  });
  const date = url.get('date', todayIn(tz));
  const clinicianFilter = url.get('clinician');
  const moduleOn = useModuleOn();
  const homeOnly = moduleOn('homeVisits') && url.get('where') === 'home';
  const [showCancelled, setShowCancelled] = useState(false);
  const [booking, setBooking] = useState<{ open: boolean; defaults?: BookingDefaults }>({ open: false });
  const [selected, setSelected] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  // Booking an online appointment request: /calendar?request=…&patient=…&reason=…&date=…
  const requestId = url.get('request');
  const requestPatientId = url.get('patient');
  const requestPatient = useQuery({ queryKey: ['patient', requestPatientId], queryFn: () => api.get<PatientRow>(`/patients/${requestPatientId}`), enabled: !!requestId && !!requestPatientId });
  useEffect(() => {
    if (requestId && (!requestPatientId || requestPatient.data)) {
      setBooking({ open: true, defaults: { date, patient: (requestPatient.data as never) ?? null, reason: url.get('reason') || undefined } });
    }
  }, [requestId, requestPatientId, requestPatient.data]); // eslint-disable-line react-hooks/exhaustive-deps
  // "Book appointment" from the New menu or search opens the booking window straight away: /calendar?book=1
  // With &patient=…&reason=… (from the due-vaccinations list) the patient and reason are already filled in.
  const bookNow = url.get('book') === '1';
  const bookPatientId = bookNow && !requestId ? url.get('patient') : '';
  const bookPatient = useQuery({ queryKey: ['patient', bookPatientId], queryFn: () => api.get<PatientRow>(`/patients/${bookPatientId}`), enabled: !!bookPatientId });
  useEffect(() => {
    if (!bookNow) return;
    if (bookPatientId && bookPatient.isLoading) return; // wait for the patient
    if (can('appointments.write')) setBooking({ open: true, defaults: { date, patient: (bookPatient.data as never) ?? null, reason: url.get('reason') || undefined, typeCategory: url.get('type') || undefined } });
    url.set({ book: null, patient: null, reason: null, type: null });
  }, [bookNow, bookPatientId, bookPatient.isLoading]); // eslint-disable-line react-hooks/exhaustive-deps
  const markRequestBooked = async (appointmentId: string) => {
    if (!requestId) return;
    try {
      await api.post(`/appointment-requests/${requestId}/decision`, { action: 'booked', appointmentId });
      toast.success('Request marked as booked — the client has been told in the portal');
    } catch (e) {
      toast.error((e as Error).message);
    }
    url.set({ request: null, patient: null, reason: null, client: null });
  };

  const days = view === 'day' ? [date] : view === 'week' ? Array.from({ length: 7 }, (_, i) => shiftDate(weekStart(date), i)) : monthGrid(date);
  const from = zonedInstant(days[0], 0, tz).toISOString();
  const to = zonedInstant(shiftDate(days[days.length - 1], 1), 0, tz).toISOString();

  const appts = useQuery({
    queryKey: ['appointments', branchId, from, to],
    queryFn: () => api.get<Appointment[]>(`/appointments${qs({ branchId, from, to })}`),
    refetchInterval: 60_000,
  });
  const roster = useQuery({
    queryKey: ['roster', branchId, from, to],
    queryFn: () => api.get<RosterEntry[]>(`/schedules/roster${qs({ branchId, from, to })}`),
  });
  const clinicians = useClinicians(branchId);

  const visible = (appts.data ?? []).filter((a) => (showCancelled || (a.status !== 'CANCELLED' && a.status !== 'NO_SHOW')) && (!homeOnly || a.location === 'HOME'));
  const rosterById = new Map((roster.data ?? []).map((r) => [r.membershipId, r]));

  const leaveMinutes = (r: RosterEntry | undefined, d: string): [number, number][] =>
    (r?.leave ?? [])
      .filter((l) => localDate(l.startsAt, tz) <= d && localDate(new Date(new Date(l.endsAt).getTime() - 1), tz) >= d)
      .map((l) => [localDate(l.startsAt, tz) === d ? minuteOfDay(l.startsAt, tz) : 0, localDate(l.endsAt, tz) === d ? minuteOfDay(l.endsAt, tz) : 1440]);
  const hoursFor = (r: RosterEntry | undefined, d: string): [number, number][] =>
    (r?.workingHours ?? []).filter((h) => h.branchId === branchId && h.dayOfWeek === dowOf(d)).map((h) => [h.startMinute, h.endMinute]);

  const columns: Column[] = useMemo(() => {
    if (view === 'day') {
      const cols: Column[] = (clinicians.data ?? [])
        .filter((c) => !clinicianFilter || c.membershipId === clinicianFilter)
        .map((c) => {
          const r = rosterById.get(c.membershipId);
          return {
            key: c.membershipId,
            title: c.name,
            subtitle: c.jobTitle ?? undefined,
            date,
            clinicianId: c.membershipId,
            available: hoursFor(r, date),
            leave: leaveMinutes(r, date),
            appointments: visible.filter((a) => a.clinician?.id === c.membershipId),
          };
        });
      const unassigned = visible.filter((a) => !a.clinician);
      if (!clinicianFilter && (unassigned.length || !cols.length)) {
        cols.push({ key: 'none', title: 'No vet yet', date, clinicianId: null, available: [[0, 1440]], leave: [], appointments: unassigned });
      }
      return cols;
    }
    return days.map((d) => {
      const r = clinicianFilter ? rosterById.get(clinicianFilter) : undefined;
      return {
        key: d,
        title: dayLabel(d, 'EEE'),
        subtitle: dayLabel(d, 'd MMM'),
        date: d,
        clinicianId: clinicianFilter || null,
        available: clinicianFilter ? hoursFor(r, d) : [[0, 1440]],
        leave: clinicianFilter ? leaveMinutes(r, d) : [],
        appointments: visible.filter((a) => localDate(a.startsAt, tz) === d && (!clinicianFilter || a.clinician?.id === clinicianFilter)),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, date, clinicians.data, roster.data, appts.data, showCancelled, clinicianFilter, homeOnly, tz]);

  // Visible hours: union of rosters and bookings, padded.
  const allRanges = columns.flatMap((c) => [...c.available.filter(([s, e]) => !(s === 0 && e === 1440)), ...c.appointments.map((a) => [minuteOfDay(blockStart(a), tz), minuteOfDay(a.endsAt, tz)] as [number, number])]);
  const startMin = Math.max(0, Math.min(DEFAULT_START, ...allRanges.map((r) => r[0])) - 30);
  const endMin = Math.min(1440, Math.max(DEFAULT_END, ...allRanges.map((r) => r[1])) + 30);
  const height = (endMin - startMin) * PX_PER_MIN;
  const nowMin = minuteOfDay(new Date(), tz);
  const today = todayIn(tz);

  useEffect(() => {
    if (scroller.current && days.includes(today)) scroller.current.scrollTop = Math.max(0, (nowMin - startMin - 60) * PX_PER_MIN);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, date, appts.isSuccess]);

  const openSlot = (col: Column, e: React.MouseEvent<HTMLDivElement>) => {
    if (!can('appointments.write')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const minute = Math.floor((startMin + (e.clientY - rect.top) / PX_PER_MIN) / 15) * 15;
    // The "No vet yet" column books without a vet; a day column without a vet filter offers any free vet.
    setBooking({ open: true, defaults: { date: col.date, minute, clinicianId: col.key === 'none' ? null : (col.clinicianId ?? undefined) } });
  };

  // Drag an appointment to a new time, day or clinician column. The server applies the same conflict and roster
  // checks as the reschedule dialog; a clash can be overridden after confirmation, exactly as in the dialog.
  const qc = useQueryClient();
  const confirm = useConfirm();
  const drag = useRef<{ id: string; grabMinutes: number } | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const move = useMutation({
    mutationFn: (v: { id: string; startsAt: string; clinicianId?: string | null; allowOverbook?: boolean; allowOutsideHours?: boolean; wasConfirmed?: boolean }) => {
      const { id, wasConfirmed: _wasConfirmed, ...body } = v;
      return api.patch<Appointment>(`/appointments/${id}`, body);
    },
    onSuccess: (after, v) => {
      // The API resets a confirmed appointment to Booked when its time changes.
      if (v.wasConfirmed && after.status === 'BOOKED') toast.warning(`Appointment moved: ${apptSummary(after, tz)}. Ask the owner to confirm the new time again.`);
      else toast.success(`Appointment moved: ${apptSummary(after, tz)}`);
      qc.invalidateQueries({ queryKey: ['appointments'] });
      qc.invalidateQueries({ queryKey: ['queue'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: async (e: Error, v) => {
      const code = e instanceof ApiError ? (e.code === 'OUTSIDE_WORKING_HOURS' ? e.code : (e.details as { code?: string } | undefined)?.code) : undefined;
      if ((code === 'CLINICIAN_BUSY' && !v.allowOverbook) || (code === 'OUTSIDE_WORKING_HOURS' && !v.allowOutsideHours)) {
        const c = await confirm({ title: 'Move anyway?', description: e.message, confirmLabel: 'Move anyway' });
        if (c.confirmed) move.mutate({ ...v, ...(code === 'CLINICIAN_BUSY' ? { allowOverbook: true } : { allowOutsideHours: true }) });
        return;
      }
      toast.error(e.message);
    },
  });
  const canMove = (a: Appointment) => can('appointments.write') && MOVABLE.has(a.status);
  const dropOn = (col: Column, e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDropKey(null);
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const a = visible.find((x) => x.id === d.id);
    if (!a) return;
    const rect = e.currentTarget.getBoundingClientRect();
    // The card starts with a home visit's travel time; the visit itself starts after it.
    const raw = startMin + (e.clientY - rect.top) / PX_PER_MIN - d.grabMinutes + (a.travelMinutes ?? 0);
    const minute = Math.min(1440 - 15, Math.max(0, Math.round(raw / 15) * 15));
    const startsAt = zonedInstant(col.date, minute, tz).toISOString();
    // Day view columns are clinicians; in week view the clinician only changes when a clinician filter is set.
    const clinicianId = view === 'day' || clinicianFilter ? col.clinicianId : undefined;
    if (startsAt === new Date(a.startsAt).toISOString() && (clinicianId === undefined || clinicianId === (a.clinician?.id ?? null))) return;
    move.mutate({ id: a.id, startsAt, wasConfirmed: a.status === 'CONFIRMED', ...(clinicianId !== undefined ? { clinicianId } : {}) });
  };

  const stepBy = (n: number) => (view === 'month' ? shiftMonth(date, n) : shiftDate(date, n * (view === 'day' ? 1 : 7)));
  const title =
    view === 'day' ? dayLabel(date, 'EEEE d MMMM yyyy') : view === 'week' ? `${dayLabel(days[0], 'd MMM')} – ${dayLabel(days[6], 'd MMM yyyy')}` : dayLabel(date, 'MMMM yyyy');
  const month = date.slice(0, 7);
  const byDay = useMemo(() => {
    const m = new Map<string, Appointment[]>();
    for (const a of visible) if (!clinicianFilter || a.clinician?.id === clinicianFilter) m.set(localDate(a.startsAt, tz), [...(m.get(localDate(a.startsAt, tz)) ?? []), a]);
    for (const list of m.values()) list.sort((x, y) => x.startsAt.localeCompare(y.startsAt));
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appts.data, showCancelled, clinicianFilter, homeOnly, tz]);

  // What is on: counts for the dates shown (with the filters applied).
  const inView = visible.filter((a) => !clinicianFilter || a.clinician?.id === clinicianFilter);
  const live = inView.filter((a) => a.status !== 'CANCELLED' && a.status !== 'NO_SHOW');
  const stats = [
    { label: live.length === 1 ? 'appointment' : 'appointments', value: live.length, tone: '' },
    { label: 'to confirm', value: live.filter((a) => a.status === 'BOOKED').length, tone: 'text-warning' },
    ...(moduleOn('homeVisits') ? [{ label: live.filter((a) => a.location === 'HOME').length === 1 ? 'home visit' : 'home visits', value: live.filter((a) => a.location === 'HOME').length, tone: 'text-primary' }] : []),
    { label: 'booked online', value: live.filter((a) => a.source === 'ONLINE').length, tone: '' },
  ];
  const isToday = view === 'day' ? date === today : days.includes(today);
  const chip = (on: boolean) =>
    cn(
      'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      on ? 'border-primary/40 bg-primary/10 text-primary' : 'bg-background text-muted-foreground hover:text-foreground',
    );

  return (
    <>
      <PageHeader
        help="book"
        title="Calendar & appointments"
        description={[session.branch?.name, tzNote].filter(Boolean).join(' · ')}
        actions={
          can('appointments.write') && (
            <Button size="sm" onClick={() => setBooking({ open: true, defaults: { date } })}>
              <CalendarPlus /> Book appointment
            </Button>
          )
        }
      />
      <div className={cn(tabListClass, 'mb-4 w-fit')} role="tablist" aria-label="Calendar or list">
        <button type="button" role="tab" aria-selected={tab === 'calendar'} className={tabTriggerClass(tab === 'calendar')} onClick={() => url.set({ tab: null })}>
          <CalendarDays className="h-4 w-4" /> Calendar
        </button>
        <button type="button" role="tab" aria-selected={tab === 'appointments'} className={tabTriggerClass(tab === 'appointments')} onClick={() => url.set({ tab: 'appointments' })}>
          <ListChecks className="h-4 w-4" /> Appointments
          {!!toConfirm.data?.meta.total && (
            <span className="ml-1 rounded-full bg-warning/15 px-1.5 text-xs font-semibold tabular text-warning" title="Booked, still to confirm">
              {toConfirm.data.meta.total} to confirm
            </span>
          )}
        </button>
      </div>
      {tab === 'appointments' ? (
        <AppointmentsList />
      ) : (
      <>
      <Card className="overflow-hidden">
        <div className="grid gap-3 border-b p-3 sm:p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center rounded-full border bg-background p-0.5 shadow-sm">
              <Button variant="ghost" size="icon-sm" className="rounded-full" aria-label="Previous" onClick={() => url.set({ date: stepBy(-1) })}>
                <ChevronLeft />
              </Button>
              <Button variant="ghost" size="sm" className="h-8 rounded-full px-3" onClick={() => url.set({ date: today })}>
                Today
              </Button>
              <Button variant="ghost" size="icon-sm" className="rounded-full" aria-label="Next" onClick={() => url.set({ date: stepBy(1) })}>
                <ChevronRight />
              </Button>
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="truncate text-lg font-semibold tracking-tight">{title}</h2>
              {isToday && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">{view === 'day' ? 'Today' : 'This ' + view}</span>}
            </div>
            <label className="relative">
              <span className="sr-only">Go to date</span>
              <CalendarDays className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input type="date" aria-label="Go to date" className="h-9 w-[160px] rounded-full pl-8 text-sm" value={date} onChange={(e) => e.target.value && url.set({ date: e.target.value })} />
            </label>
            <div className={cn(tabListClass, 'ml-auto')} role="tablist" aria-label="View">
              {(['day', 'week', 'month'] as const).map((v) => (
                <button key={v} role="tab" aria-selected={view === v} onClick={() => url.set({ view: v })} className={cn(tabTriggerClass(view === v), 'h-8 capitalize')}>
                  {v}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative">
              <Users className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <NativeSelect aria-label="Vet" className="h-8 w-[190px] rounded-full pl-8 text-xs" value={clinicianFilter} onChange={(e) => url.set({ clinician: e.target.value })}>
                <option value="">All vets</option>
                {clinicians.data?.map((c) => (
                  <option key={c.membershipId} value={c.membershipId}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            </label>
            {moduleOn('homeVisits') && (
              <button type="button" role="checkbox" aria-checked={homeOnly} className={chip(homeOnly)} onClick={() => url.set({ where: homeOnly ? null : 'home' })}>
                <House className="h-3.5 w-3.5" /> Home visits only
              </button>
            )}
            <button type="button" role="checkbox" aria-checked={showCancelled} className={chip(showCancelled)} onClick={() => setShowCancelled(!showCancelled)}>
              <XCircle className="h-3.5 w-3.5" /> Show cancelled / no-shows
            </button>
            <ul className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Summary">
              {stats.map((st) => (
                <li key={st.label}>
                  <span className={cn('text-sm font-semibold tabular text-foreground', st.value > 0 && st.tone)}>{st.value}</span> {st.label}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {appts.isLoading || clinicians.isLoading ? (
          <LoadingRows rows={8} />
        ) : appts.error ? (
          <ErrorState error={appts.error} onRetry={() => appts.refetch()} />
        ) : view === 'month' ? (
          <div className="overflow-x-auto">
            <div className="grid min-w-[700px] grid-cols-7" role="grid" aria-label={`Appointments in ${title}`}>
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                <div key={d} className="border-b border-r bg-muted/30 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground last:border-r-0">{d}</div>
              ))}
              {days.map((d) => {
                const list = byDay.get(d) ?? [];
                const outside = !d.startsWith(month);
                return (
                  <div
                    key={d}
                    role="gridcell"
                    aria-label={`${dayLabel(d, 'EEEE d MMMM')}: ${list.length} appointment${list.length === 1 ? '' : 's'}`}
                    className={cn('min-h-[118px] border-b border-r p-2 transition-colors hover:bg-muted/20 [&:nth-child(7n)]:border-r-0', outside && 'bg-muted/30', d === today && 'bg-primary/[0.04]')}
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <button
                        className={cn('grid h-7 min-w-7 place-items-center rounded-full px-1 text-xs font-semibold tabular hover:bg-muted', outside && 'font-normal text-muted-foreground', d === today && 'bg-primary text-primary-foreground hover:bg-primary')}
                        onClick={() => url.set({ view: 'day', date: d })}
                        aria-label={`Open ${dayLabel(d, 'EEEE d MMMM')}`}
                      >
                        {dayLabel(d, 'd')}
                      </button>
                      {list.length > 0 && <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium tabular text-muted-foreground">{list.length}</span>}
                    </div>
                    <div className="grid gap-0.5">
                      {list.slice(0, MONTH_CELL_LIMIT).map((a) => (
                        <button
                          key={a.id}
                          onClick={() => setSelected(a.id)}
                          className={cn('flex items-center gap-1.5 truncate rounded-md px-1.5 py-1 text-left text-[11px] transition-[filter] hover:brightness-95', (a.status === 'CANCELLED' || a.status === 'NO_SHOW') && 'line-through opacity-50')}
                          style={{ background: tint(a.appointmentType.color, 14) }}
                          title={`${branchTime(a.startsAt, tz)} ${a.patient?.name ?? a.client.displayName} — ${a.appointmentType.name}`}
                        >
                          <span className="tabular text-muted-foreground">{branchTime(a.startsAt, tz)}</span>
                          {a.location === 'HOME' && <House className="h-3 w-3 shrink-0 text-primary" aria-label="Home visit" />}
                          <span className="truncate font-medium">{a.patient?.name ?? a.client.displayName}</span>
                        </button>
                      ))}
                      {list.length > MONTH_CELL_LIMIT && (
                        <button className="px-1 text-left text-2xs font-medium text-primary hover:underline" onClick={() => url.set({ view: 'day', date: d })}>
                          +{list.length - MONTH_CELL_LIMIT} more
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div ref={scroller} className="max-h-[calc(100vh-250px)] overflow-auto">
            <div className="flex min-w-fit">
              {/* time gutter */}
              <div className="sticky left-0 z-20 w-16 shrink-0 border-r bg-card">
                <div className="sticky top-0 z-10 h-14 border-b bg-card" />
                <div className="relative" style={{ height }}>
                  {Array.from({ length: Math.ceil((endMin - startMin) / 60) + 1 }, (_, i) => {
                    const m = Math.ceil(startMin / 60) * 60 + i * 60;
                    if (m > endMin) return null;
                    return (
                      <span key={m} className="absolute right-2 -translate-y-1/2 text-[11px] font-medium tabular text-muted-foreground" style={{ top: (m - startMin) * PX_PER_MIN }}>
                        {hhmm(m)}
                      </span>
                    );
                  })}
                  {days.includes(today) && nowMin >= startMin && nowMin <= endMin && (
                    <span className="absolute right-1 z-10 -translate-y-1/2 rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-semibold tabular text-destructive-foreground" style={{ top: (nowMin - startMin) * PX_PER_MIN }} aria-label="Now">
                      {branchTime(new Date(), tz)}
                    </span>
                  )}
                </div>
              </div>
              {columns.map((col) => (
                <div key={col.key} className={cn('min-w-[190px] flex-1 border-r last:border-r-0', view === 'week' && 'min-w-[140px]')}>
                  <div className={cn('sticky top-0 z-10 flex h-14 items-center gap-2.5 border-b bg-card px-3', col.date === today && view === 'week' && 'shadow-[inset_0_-2px_0_hsl(var(--primary))]')}>
                    {view === 'day' ? (
                      col.clinicianId ? <Avatar name={col.title.replace(/^Dr\.?\s+/i, '')} className="h-8 w-8 text-[11px]" /> : <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"><Users className="h-4 w-4" /></span>
                    ) : (
                      <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-semibold tabular', col.date === today ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground')}>{dayLabel(col.date, 'd')}</span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{view === 'day' ? col.title : dayLabel(col.date, 'EEEE')}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {view === 'day' ? (col.clinicianId && !col.available.length ? <span className="font-medium text-warning">Not working today</span> : col.subtitle) : dayLabel(col.date, 'MMMM')}
                      </p>
                    </div>
                    {col.appointments.filter((a) => a.status !== 'CANCELLED' && a.status !== 'NO_SHOW').length > 0 && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold tabular text-muted-foreground" title="Appointments">
                        {col.appointments.filter((a) => a.status !== 'CANCELLED' && a.status !== 'NO_SHOW').length}
                      </span>
                    )}
                  </div>
                  <div
                    className={cn('relative cursor-crosshair', dropKey === col.key && 'ring-2 ring-inset ring-primary')}
                    style={{ height }}
                    onClick={(e) => e.target === e.currentTarget && openSlot(col, e)}
                    onDragOver={(e) => {
                      if (!drag.current) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      if (dropKey !== col.key) setDropKey(col.key);
                    }}
                    onDragLeave={(e) => e.currentTarget === e.target && setDropKey(null)}
                    onDrop={(e) => dropOn(col, e)}
                    data-testid={`calendar-column-${col.key}`}
                  >
                    {/* shading for non-rostered time */}
                    <div className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(135deg,hsl(var(--muted)/0.55),hsl(var(--muted)/0.55)_8px,hsl(var(--muted)/0.3)_8px,hsl(var(--muted)/0.3)_16px)]" />
                    {col.available.map(([s, e]) => (
                      <div key={`${s}-${e}`} className="pointer-events-none absolute inset-x-0 bg-card" style={{ top: Math.max(0, s - startMin) * PX_PER_MIN, height: (Math.min(e, endMin) - Math.max(s, startMin)) * PX_PER_MIN }} />
                    ))}
                    {col.leave.map(([s, e]) => (
                      <div
                        key={`l${s}-${e}`}
                        className="pointer-events-none absolute inset-x-0 flex items-start justify-center bg-[repeating-linear-gradient(45deg,transparent,transparent_6px,hsl(var(--muted))_6px,hsl(var(--muted))_12px)] pt-1 text-2xs font-medium text-muted-foreground"
                        style={{ top: Math.max(0, s - startMin) * PX_PER_MIN, height: (Math.min(e, endMin) - Math.max(s, startMin)) * PX_PER_MIN }}
                      >
                        On leave
                      </div>
                    ))}
                    {/* hour lines */}
                    {Array.from({ length: Math.ceil((endMin - startMin) / 30) }, (_, i) => (
                      <div key={i} className={cn('pointer-events-none absolute inset-x-0 border-t', i % 2 ? 'border-dotted border-border/40' : 'border-border/70')} style={{ top: (Math.ceil(startMin / 30) * 30 - startMin + i * 30) * PX_PER_MIN }} />
                    ))}
                    {col.date === today && nowMin >= startMin && nowMin <= endMin && (
                      <div className="pointer-events-none absolute inset-x-0 z-[6] border-t-2 border-destructive/80" style={{ top: (nowMin - startMin) * PX_PER_MIN }} />
                    )}
                    {layout(col.appointments, tz).map(({ a, start, end, lane, lanes }) => {
                      const critical = a.patient?.alerts.some((x) => x.severity === 'CRITICAL');
                      const dim = a.status === 'CANCELLED' || a.status === 'NO_SHOW';
                      const travel = a.location === 'HOME' ? (a.travelMinutes ?? 0) : 0;
                      return (
                        <button
                          key={a.id}
                          onClick={() => setSelected(a.id)}
                          draggable={canMove(a)}
                          onDragStart={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            drag.current = { id: a.id, grabMinutes: (e.clientY - rect.top) / PX_PER_MIN };
                            e.dataTransfer.effectAllowed = 'move';
                            e.dataTransfer.setData('text/plain', a.id);
                          }}
                          onDragEnd={() => { drag.current = null; setDropKey(null); }}
                          aria-roledescription={canMove(a) ? 'draggable appointment' : undefined}
                          className={cn(
                            canMove(a) && 'cursor-grab active:cursor-grabbing',
                            'absolute z-[5] overflow-hidden rounded-lg border border-black/[0.04] border-l-[3px] px-2 py-1 text-left text-xs shadow-[0_1px_2px_rgb(0_0_0/0.06)] transition-all hover:z-10 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring dark:border-white/[0.06]',
                            a.status === 'CHECKED_IN' && 'ring-1 ring-warning/50',
                            a.status === 'IN_CONSULTATION' && 'ring-1 ring-primary/50',
                            a.status === 'COMPLETED' && 'opacity-60',
                            dim && 'line-through opacity-50',
                          )}
                          style={{
                            top: (start - startMin) * PX_PER_MIN + 1,
                            height: Math.max((end - start) * PX_PER_MIN - 2, 18),
                            left: `calc(${(lane / lanes) * 100}% + 2px)`,
                            width: `calc(${100 / lanes}% - 4px)`,
                            borderLeftColor: a.appointmentType.color,
                            background: tint(a.appointmentType.color, a.status === 'COMPLETED' ? 6 : 12),
                          }}
                          title={`${branchTime(a.startsAt, tz)} ${a.patient?.name ?? a.client.displayName} — ${a.appointmentType.name} (${a.status.toLowerCase()})${a.location === 'HOME' ? ` · home visit: ${a.visitAddress}${travel ? ` · leaves ${branchTime(blockStart(a), tz)}` : ''}` : ''}`}
                        >
                          {/* A home visit's travel time, striped, before the visit itself. */}
                          {travel > 0 && (
                            <span
                              className="-mx-2 -mt-1 mb-1 flex items-center gap-1 overflow-hidden bg-[repeating-linear-gradient(45deg,transparent,transparent_5px,hsl(var(--muted))_5px,hsl(var(--muted))_10px)] px-2 text-[10px] text-muted-foreground"
                              style={{ height: Math.max(travel * PX_PER_MIN - 2, 12) }}
                            >
                              <Car className="h-3 w-3 shrink-0" aria-hidden /> {travel >= 15 && `Travel ${travel} min`}
                            </span>
                          )}
                          <span className="flex items-center gap-1">
                            <span className="text-[11px] font-medium tabular text-muted-foreground">{branchTime(a.startsAt, tz)}</span>
                            <span className="truncate font-semibold">{a.patient?.name ?? a.client.displayName}</span>
                            {a.location === 'HOME' && <House className="h-3 w-3 shrink-0 text-primary" aria-label="Home visit" />}
                            {critical && <AlertOctagon className="h-3 w-3 shrink-0 text-destructive" aria-label="Critical alert" />}
                            {a.source === 'ONLINE' && <Globe className={cn('h-3 w-3 shrink-0', a.status === 'BOOKED' ? 'text-warning' : 'text-primary')} aria-label={a.status === 'BOOKED' ? 'Booked online — to confirm' : 'Booked online'} />}
                            <PriorityDot priority={a.triage?.priority ?? a.priority} />
                            {end - start - travel >= 25 && (view === 'day' || lanes === 1) && STATUS_LOOK[a.status] && a.status !== 'BOOKED' && (
                              <span className={cn('ml-auto inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 text-[10px] font-semibold no-underline', STATUS_LOOK[a.status].chip)}>
                                {a.status === 'CONFIRMED' && <Check className="h-2.5 w-2.5" />}
                                {STATUS_LOOK[a.status].label}
                              </span>
                            )}
                          </span>
                          {end - start - travel >= 25 && (
                            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                              {a.location === 'HOME' ? `Home visit · ` : ''}
                              {a.appointmentType.name}
                              {view === 'week' && a.clinician ? ` · ${a.clinician.name}` : ''}
                              {a.reason ? ` · ${a.reason}` : ''}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
        <span>
          {view === 'month' ? 'Click a day to open it; click an appointment for details.' : 'Click an empty time to book · drag an appointment to move it.'}
        </span>
        {view !== 'month' && (
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 sm:ml-auto" aria-label="Legend">
            {(['CONFIRMED', 'CHECKED_IN', 'IN_CONSULTATION'] as const).map((k) => (
              <li key={k} className="flex items-center gap-1.5">
                <span className={cn('rounded-full px-1.5 text-[10px] font-semibold', STATUS_LOOK[k].chip)}>{STATUS_LOOK[k].label}</span>
              </li>
            ))}
            <li className="flex items-center gap-1.5"><House className="h-3.5 w-3.5 text-primary" /> Home visit</li>
            <li className="flex items-center gap-1.5"><Globe className="h-3.5 w-3.5 text-warning" /> Online, to confirm</li>
            <li className="flex items-center gap-1.5"><span className="h-3 w-4 rounded-sm bg-[repeating-linear-gradient(135deg,hsl(var(--muted)),hsl(var(--muted))_3px,transparent_3px,transparent_6px)] ring-1 ring-border" /> Not working</li>
          </ul>
        )}
      </div>
      </>
      )}
      <BookingDialog
        open={booking.open}
        onOpenChange={(open) => { setBooking((b) => ({ ...b, open })); if (!open && requestId) url.set({ request: null, patient: null, reason: null, client: null }); }}
        defaults={booking.defaults}
        onBooked={(a) => markRequestBooked(a.id)}
      />
      <AppointmentDialog id={selected} open={!!selected} onOpenChange={(o) => !o && setSelected(null)} />
    </>
  );
}

export default function CalendarPage() {
  return (
    <RequirePermission anyOf={['appointments.read']}>
      <Suspense>
        <CalendarView />
      </Suspense>
    </RequirePermission>
  );
}
