'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertOctagon, CalendarPlus, ChevronLeft, ChevronRight, Globe } from 'lucide-react';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useConfirm } from '@/components/confirm';
import { ErrorState, LoadingRows, PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { AppointmentDialog } from '@/components/scheduling/appointment-dialog';
import { PriorityDot } from '@/components/scheduling/appointment-status';
import { apptSummary } from '@/components/scheduling/appointment-text';
import { BookingDialog, useTimeZoneNote, type BookingDefaults } from '@/components/scheduling/booking-dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input, NativeSelect } from '@/components/ui/input';
import { useClinicians } from '@/hooks/use-catalog';
import { useUrlState } from '@/hooks/use-url-state';
import { ApiError, api, qs } from '@/lib/api';
import { useSession } from '@/lib/session';
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

/** Greedy lane assignment so overlapping (overbooked) appointments sit side by side. */
function layout(appts: Appointment[], tz: string) {
  const items = appts
    .map((a) => ({ a, start: minuteOfDay(a.startsAt, tz), end: Math.max(minuteOfDay(a.endsAt, tz), minuteOfDay(a.startsAt, tz) + 10) }))
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
  const date = url.get('date', todayIn(tz));
  const clinicianFilter = url.get('clinician');
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

  const visible = (appts.data ?? []).filter((a) => showCancelled || (a.status !== 'CANCELLED' && a.status !== 'NO_SHOW'));
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
  }, [view, date, clinicians.data, roster.data, appts.data, showCancelled, clinicianFilter, tz]);

  // Visible hours: union of rosters and bookings, padded.
  const allRanges = columns.flatMap((c) => [...c.available.filter(([s, e]) => !(s === 0 && e === 1440)), ...c.appointments.map((a) => [minuteOfDay(a.startsAt, tz), minuteOfDay(a.endsAt, tz)] as [number, number])]);
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
    const raw = startMin + (e.clientY - rect.top) / PX_PER_MIN - d.grabMinutes;
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
  }, [appts.data, showCancelled, clinicianFilter, tz]);

  return (
    <>
      <PageHeader
        help="book"
        title="Calendar"
        description={[session.branch?.name, tzNote].filter(Boolean).join(' · ')}
        actions={
          can('appointments.write') && (
            <Button size="sm" onClick={() => setBooking({ open: true, defaults: { date } })}>
              <CalendarPlus /> Book appointment
            </Button>
          )
        }
      />
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon-sm" aria-label="Previous" onClick={() => url.set({ date: stepBy(-1) })}>
              <ChevronLeft />
            </Button>
            <Button variant="outline" size="sm" onClick={() => url.set({ date: today })}>
              Today
            </Button>
            <Button variant="outline" size="icon-sm" aria-label="Next" onClick={() => url.set({ date: stepBy(1) })}>
              <ChevronRight />
            </Button>
          </div>
          <h2 className="min-w-[200px] text-sm font-semibold">{title}</h2>
          <Input type="date" aria-label="Go to date" className="h-8 w-[150px]" value={date} onChange={(e) => e.target.value && url.set({ date: e.target.value })} />
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox checked={showCancelled} onCheckedChange={(v) => setShowCancelled(v === true)} /> Show cancelled / no-shows
            </label>
            <NativeSelect aria-label="Vet" className="h-8 w-[180px] text-xs" value={clinicianFilter} onChange={(e) => url.set({ clinician: e.target.value })}>
              <option value="">All vets</option>
              {clinicians.data?.map((c) => (
                <option key={c.membershipId} value={c.membershipId}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
            <div className={tabListClass} role="tablist" aria-label="View">
              {(['day', 'week', 'month'] as const).map((v) => (
                <button
                  key={v}
                  role="tab"
                  aria-selected={view === v}
                  onClick={() => url.set({ view: v })}
                  className={cn(tabTriggerClass(), 'h-8 capitalize')}
                >
                  {v}
                </button>
              ))}
            </div>
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
                <div key={d} className="border-b border-r px-2 py-1.5 text-2xs font-semibold uppercase text-muted-foreground last:border-r-0">{d}</div>
              ))}
              {days.map((d) => {
                const list = byDay.get(d) ?? [];
                const outside = !d.startsWith(month);
                return (
                  <div
                    key={d}
                    role="gridcell"
                    aria-label={`${dayLabel(d, 'EEEE d MMMM')}: ${list.length} appointment${list.length === 1 ? '' : 's'}`}
                    className={cn('min-h-[112px] border-b border-r p-1.5 [&:nth-child(7n)]:border-r-0', outside && 'bg-muted/40', d === today && 'bg-accent/60')}
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <button
                        className={cn('rounded px-1 text-xs font-medium tabular hover:bg-muted', outside && 'text-muted-foreground', d === today && 'bg-primary text-primary-foreground hover:bg-primary')}
                        onClick={() => url.set({ view: 'day', date: d })}
                        aria-label={`Open ${dayLabel(d, 'EEEE d MMMM')}`}
                      >
                        {dayLabel(d, 'd')}
                      </button>
                      {list.length > 0 && <span className="text-2xs text-muted-foreground">{list.length}</span>}
                    </div>
                    <div className="grid gap-0.5">
                      {list.slice(0, MONTH_CELL_LIMIT).map((a) => (
                        <button
                          key={a.id}
                          onClick={() => setSelected(a.id)}
                          className={cn('flex items-center gap-1 truncate rounded border-l-2 bg-card px-1 py-0.5 text-left text-2xs hover:bg-muted', (a.status === 'CANCELLED' || a.status === 'NO_SHOW') && 'line-through opacity-50')}
                          style={{ borderLeftColor: a.appointmentType.color }}
                          title={`${branchTime(a.startsAt, tz)} ${a.patient?.name ?? a.client.displayName} — ${a.appointmentType.name}`}
                        >
                          <span className="tabular text-muted-foreground">{branchTime(a.startsAt, tz)}</span>
                          <span className="truncate">{a.patient?.name ?? a.client.displayName}</span>
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
              <div className="sticky left-0 z-20 w-14 shrink-0 border-r bg-card">
                <div className="sticky top-0 z-10 h-12 border-b bg-card" />
                <div className="relative" style={{ height }}>
                  {Array.from({ length: Math.ceil((endMin - startMin) / 60) + 1 }, (_, i) => {
                    const m = Math.ceil(startMin / 60) * 60 + i * 60;
                    if (m > endMin) return null;
                    return (
                      <span key={m} className="absolute right-1.5 -translate-y-1/2 text-2xs tabular text-muted-foreground" style={{ top: (m - startMin) * PX_PER_MIN }}>
                        {hhmm(m)}
                      </span>
                    );
                  })}
                </div>
              </div>
              {columns.map((col) => (
                <div key={col.key} className={cn('min-w-[180px] flex-1 border-r last:border-r-0', view === 'week' && 'min-w-[140px]')}>
                  <div className={cn('sticky top-0 z-10 flex h-12 flex-col justify-center border-b bg-card px-2', col.date === today && view === 'week' && 'bg-accent')}>
                    <p className="truncate text-sm font-medium">{col.title}</p>
                    <p className="truncate text-2xs text-muted-foreground">
                      {col.subtitle}
                      {view === 'day' && col.clinicianId && !col.available.length && ' · not working today'}
                    </p>
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
                    <div className="pointer-events-none absolute inset-0 bg-muted/60" />
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
                      <div key={i} className={cn('pointer-events-none absolute inset-x-0 border-t', i % 2 ? 'border-dashed border-border/50' : 'border-border')} style={{ top: (Math.ceil(startMin / 30) * 30 - startMin + i * 30) * PX_PER_MIN }} />
                    ))}
                    {col.date === today && nowMin >= startMin && nowMin <= endMin && (
                      <div className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-destructive" style={{ top: (nowMin - startMin) * PX_PER_MIN }}>
                        <span className="absolute -left-1 -top-1.5 h-2.5 w-2.5 rounded-full bg-destructive" />
                      </div>
                    )}
                    {layout(col.appointments, tz).map(({ a, start, end, lane, lanes }) => {
                      const critical = a.patient?.alerts.some((x) => x.severity === 'CRITICAL');
                      const dim = a.status === 'CANCELLED' || a.status === 'NO_SHOW';
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
                            'absolute z-[5] overflow-hidden rounded-md border border-l-4 bg-card px-1.5 py-0.5 text-left text-xs shadow-sm transition-shadow hover:z-10 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring',
                            a.status === 'CHECKED_IN' && 'bg-warning/10',
                            a.status === 'IN_CONSULTATION' && 'bg-primary/10',
                            a.status === 'COMPLETED' && 'opacity-70',
                            dim && 'line-through opacity-50',
                          )}
                          style={{
                            top: (start - startMin) * PX_PER_MIN + 1,
                            height: Math.max((end - start) * PX_PER_MIN - 2, 18),
                            left: `calc(${(lane / lanes) * 100}% + 2px)`,
                            width: `calc(${100 / lanes}% - 4px)`,
                            borderLeftColor: a.appointmentType.color,
                          }}
                          title={`${branchTime(a.startsAt, tz)} ${a.patient?.name ?? a.client.displayName} — ${a.appointmentType.name} (${a.status.toLowerCase()})`}
                        >
                          <span className="flex items-center gap-1 font-medium">
                            <span className="tabular text-muted-foreground">{branchTime(a.startsAt, tz)}</span>
                            <span className="truncate">{a.patient?.name ?? a.client.displayName}</span>
                            {critical && <AlertOctagon className="h-3 w-3 shrink-0 text-destructive" aria-label="Critical alert" />}
                            {a.source === 'ONLINE' && <Globe className={cn('h-3 w-3 shrink-0', a.status === 'BOOKED' ? 'text-warning' : 'text-primary')} aria-label={a.status === 'BOOKED' ? 'Booked online — to confirm' : 'Booked online'} />}
                            <PriorityDot priority={a.triage?.priority ?? a.priority} />
                          </span>
                          {end - start >= 25 && (
                            <span className="block truncate text-2xs text-muted-foreground">
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
      <p className="mt-2 text-xs text-muted-foreground">
        {view === 'month'
          ? 'Click a day to open it; click an appointment for details.'
          : 'Click an empty time to book; drag an appointment to move it. Shaded areas are outside working hours; striped areas are leave.'}
      </p>
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
