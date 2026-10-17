'use client';
import { useQuery } from '@tanstack/react-query';
import { BedDouble, CalendarRange, ChevronLeft, ChevronRight, LogIn, LogOut, Plus, Scissors } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Suspense, useState } from 'react';
import { GroomingCheckInDialog, ReserveDialog, StayStatusBadge } from '@/components/boarding/dialogs';
import { DataTable } from '@/components/data-table';
import { EmptyState, PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Stat } from '@/components/stat';
import { AlertChip } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useUrlState } from '@/hooks/use-url-state';
import { api, qs } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import { branchTime, dayLabel, shiftDate, todayIn } from '@/lib/time';
import type { BoardingBoard, BoardingStay, GroomingBoard, UnitAvailability } from '@/lib/types';
import { cn } from '@/lib/utils';

const TABS = [
  { key: 'today', label: 'Today' },
  { key: 'chart', label: 'Kennel chart' },
  { key: 'grooming', label: 'Grooming' },
  { key: 'bookings', label: 'All bookings' },
];

function StayLine({ s, right }: { s: BoardingStay; right?: React.ReactNode }) {
  return (
    <li>
      <Link href={`/boarding/stays/${s.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{s.patient.name} <span className="text-xs font-normal text-muted-foreground">{s.patient.species.name} · {s.client.displayName}</span></p>
          <p className="text-xs text-muted-foreground">{s.stayNo} · {fmtDate(s.startDate)} → {fmtDate(s.endDate)} ({s.nights} night{s.nights === 1 ? '' : 's'}){s.unit ? ` · ${s.unit.name}` : ''}</p>
          {!!s.patient.alerts.length && <span className="mt-1 flex flex-wrap gap-1">{s.patient.alerts.map((a) => <AlertChip key={a.id} alert={a} />)}</span>}
        </div>
        {right}
      </Link>
    </li>
  );
}

function Today() {
  const { session } = useSession();
  const q = useQuery({ queryKey: ['boarding-board', session.branch?.id], queryFn: () => api.get<BoardingBoard>(`/boarding/board${qs({ branchId: session.branch?.id })}`), refetchInterval: 60_000 });
  const b = q.data;
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Boarding now" value={b?.inHouse.length ?? '—'} icon={BedDouble} />
        <Stat label="Arriving" value={b?.arriving.length ?? '—'} icon={LogIn} />
        <Stat label="Going home today" value={b?.inHouse.filter((s) => s.departingToday).length ?? '—'} icon={LogOut} />
        <Stat label="Units occupied" value={b ? `${b.occupancy.occupied} / ${b.occupancy.units}` : '—'} icon={CalendarRange} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Arriving</CardTitle></CardHeader>
          {b?.arriving.length ? <ul className="divide-y">{b.arriving.map((s) => <StayLine key={s.id} s={s} right={<span className="text-xs font-medium text-primary">Check in →</span>} />)}</ul> : <p className="px-4 pb-4 text-sm text-muted-foreground">No arrivals due.</p>}
        </Card>
        <Card>
          <CardHeader><CardTitle>Boarding now</CardTitle></CardHeader>
          {b?.inHouse.length ? <ul className="divide-y">{b.inHouse.map((s) => <StayLine key={s.id} s={s} right={s.departingToday ? <span className="text-xs font-medium text-warning">Going home</span> : undefined} />)}</ul> : <p className="px-4 pb-4 text-sm text-muted-foreground">No boarders in.</p>}
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle>Next 14 days</CardTitle></CardHeader>
        {b?.upcoming.length ? <ul className="divide-y">{b.upcoming.map((s) => <StayLine key={s.id} s={s} />)}</ul> : <p className="px-4 pb-4 text-sm text-muted-foreground">No upcoming bookings.</p>}
      </Card>
    </div>
  );
}

/** The kennel chart shows two weeks; Earlier / Later move by the same span. */
const CHART_DAYS = 14;

function Chart() {
  const { session } = useSession();
  const tz = session.branch?.timezone ?? 'UTC';
  const today = todayIn(tz);
  const [start, setStart] = useState(today);
  const days = Array.from({ length: CHART_DAYS }, (_, i) => shiftDate(start, i));
  const q = useQuery({ queryKey: ['boarding-availability', session.branch?.id, start], queryFn: () => api.get<UnitAvailability[]>(`/boarding/availability${qs({ branchId: session.branch?.id, from: start, to: shiftDate(start, 14) })}`) });
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <Button size="sm" variant="outline" onClick={() => setStart(shiftDate(start, -CHART_DAYS))} aria-label={`Show the previous ${CHART_DAYS} days`}><ChevronLeft /> Earlier</Button>
        <Button size="sm" variant="outline" disabled={start === today} onClick={() => setStart(today)}>Today</Button>
        <Button size="sm" variant="outline" onClick={() => setStart(shiftDate(start, CHART_DAYS))} aria-label={`Show the next ${CHART_DAYS} days`}>Later <ChevronRight /></Button>
        <Input type="date" value={start} onChange={(e) => e.target.value && setStart(e.target.value)} className="w-40" aria-label="Start date" />
        <span className="text-xs text-muted-foreground">{CHART_DAYS} days: {dayLabel(start, 'd MMM')} – {dayLabel(days[days.length - 1], 'd MMM')}</span>
        <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-success" /> In house</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-info" /> Reserved</span>
        </span>
      </div>
      {q.data?.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] table-fixed text-xs">
            <thead><tr><th className="w-32 p-2 text-left">Unit</th>{days.map((d) => <th key={d} className={cn('p-1 text-center font-normal', d === today ? 'font-semibold text-primary' : 'text-muted-foreground')}>{dayLabel(d, 'EEE d')}</th>)}</tr></thead>
            <tbody>
              {q.data.map((u) => (
                <tr key={u.id} className="border-t">
                  <td className="p-2 font-medium">{u.name}</td>
                  {days.map((d) => {
                    const s = u.stays.find((x) => x.startDate.slice(0, 10) <= d && x.endDate.slice(0, 10) > d);
                    const first = s && (s.startDate.slice(0, 10) === d || d === days[0]);
                    return (
                      <td key={d} className="p-0.5">
                        {s ? <Link href={`/boarding/stays/${s.id}`} title={`${s.patient.name} ${s.stayNo}`} className={cn('block h-7 truncate rounded px-1 font-medium leading-7 hover:opacity-90', s.status === 'CHECKED_IN' ? 'bg-success text-success-foreground' : 'bg-info text-info-foreground')}>{first ? s.patient.name : ''}</Link> : <span className="block h-7 rounded bg-muted/30" />}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <EmptyState icon={BedDouble} title="No boarding units" description="Add kennels in Settings → Boarding units." />}
    </Card>
  );
}

function Grooming() {
  const { session, currency } = useSession();
  const tz = session.branch?.timezone ?? 'UTC';
  const url = useUrlState();
  const date = url.get('date', todayIn(tz));
  const [checkIn, setCheckIn] = useState<{ open: boolean; appointment: GroomingBoard['booked'][number] | null }>({ open: false, appointment: null });
  const q = useQuery({ queryKey: ['grooming-board', session.branch?.id, date], queryFn: () => api.get<GroomingBoard>(`/grooming/board${qs({ branchId: session.branch?.id, date })}`), refetchInterval: 30_000 });
  const cols: { key: string; label: string; statuses: string[] }[] = [
    { key: 'waiting', label: 'Waiting', statuses: ['WAITING'] },
    { key: 'progress', label: 'Being groomed', statuses: ['IN_PROGRESS'] },
    { key: 'ready', label: 'Ready for collection', statuses: ['READY'] },
    { key: 'done', label: 'Collected', statuses: ['COLLECTED'] },
  ];
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input type="date" value={date} onChange={(e) => url.set({ date: e.target.value })} className="w-40" aria-label="Date" />
        <Button size="sm" className="ml-auto" onClick={() => setCheckIn({ open: true, appointment: null })}><Plus /> Walk-in</Button>
      </div>
      <Card>
        <CardHeader><CardTitle>Booked</CardTitle></CardHeader>
        {q.data?.booked.length ? (
          <ul className="divide-y">
            {q.data.booked.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="w-14 font-medium tabular">{branchTime(a.startsAt, tz)}</span>
                <div className="min-w-0 flex-1"><p className="font-medium">{a.patient?.name ?? 'No animal'} <span className="text-xs font-normal text-muted-foreground">{a.patient?.species.name} · {a.client.displayName}</span></p><p className="text-xs text-muted-foreground">{a.type}{a.reason ? ` · ${a.reason}` : ''}{a.staff ? ` · ${a.staff.name}` : ''}</p></div>
                <Button size="sm" variant="outline" onClick={() => setCheckIn({ open: true, appointment: a })}>Check in</Button>
              </li>
            ))}
          </ul>
        ) : <p className="px-4 pb-4 text-sm text-muted-foreground">No grooming appointments waiting to be checked in. Book them in the calendar with a Grooming appointment type.</p>}
      </Card>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {cols.map((c) => {
          const jobs = (q.data?.jobs ?? []).filter((j) => c.statuses.includes(j.status));
          return (
            <Card key={c.key} className="min-h-32">
              <CardHeader><CardTitle className="text-sm">{c.label} <span className="text-muted-foreground">({jobs.length})</span></CardTitle></CardHeader>
              <ul className="grid gap-2 px-3 pb-3">
                {jobs.map((j) => (
                  <li key={j.id}>
                    <Link href={`/boarding/grooming/${j.id}`} className="block rounded-md border p-2 hover:bg-muted/40">
                      <p className="text-sm font-medium">{j.patient.name} <span className="text-xs font-normal text-muted-foreground">{j.patient.breed?.name ?? j.patient.breedText ?? j.patient.species.name}</span></p>
                      <p className="text-xs text-muted-foreground">{j.client.displayName}{j.groomer ? ` · ${j.groomer.name}` : ''}</p>
                      <p className="mt-1 text-xs">{j.services.map((s) => s.description).join(', ') || 'No services yet'}{j.totalMinor ? ` · ${fmtMoney(j.totalMinor, currency)}` : ''}</p>
                      {!!j.patient.alerts.length && <span className="mt-1 flex flex-wrap gap-1">{j.patient.alerts.map((a) => <AlertChip key={a.id} alert={a} />)}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}
      </div>
      <GroomingCheckInDialog open={checkIn.open} onOpenChange={(open) => setCheckIn((c) => ({ ...c, open }))} appointment={checkIn.appointment} />
    </div>
  );
}

function Bookings() {
  const router = useRouter();
  const { session } = useSession();
  const tz = session.branch?.timezone ?? 'UTC';
  const url = useUrlState();
  const status = url.get('status', 'RESERVED,CHECKED_IN');
  const q = useQuery({ queryKey: ['boarding-stays', status], queryFn: () => api.get<BoardingStay[]>(`/boarding/stays${qs(status === 'ALL' ? { from: shiftDate(todayIn(tz), -60) } : { status })}`) });
  return (
    <Card>
      <div className="flex flex-wrap gap-1 border-b p-3">
        {[['RESERVED,CHECKED_IN', 'Current & upcoming'], ['CHECKED_OUT', 'Checked out'], ['CANCELLED,NO_SHOW', 'Cancelled'], ['ALL', 'Last 60 days']].map(([k, l]) => <button key={k} onClick={() => url.set({ status: k })} className={cn('rounded-md px-3 py-1.5 text-sm', status === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}>{l}</button>)}
      </div>
      <DataTable
        query={q}
        rowKey={(s) => s.id}
        onRowClick={(s) => router.push(`/boarding/stays/${s.id}`)}
        empty={<EmptyState icon={BedDouble} title="No bookings" />}
        columns={[
          { key: 'pet', header: 'Animal', cell: (s) => <div><span className="font-medium">{s.patient.name}</span><p className="text-xs text-muted-foreground">{s.stayNo} · {s.client.displayName}</p></div> },
          { key: 'dates', header: 'Dates', cell: (s) => <span className="text-sm">{fmtDate(s.startDate)} → {fmtDate(s.endDate)}</span> },
          { key: 'unit', header: 'Unit', cell: (s) => <span className="text-sm">{s.unit?.name ?? '—'}</span> },
          { key: 'st', header: 'Status', cell: (s) => <StayStatusBadge status={s.status} /> },
        ]}
      />
    </Card>
  );
}

function Boarding() {
  const { can } = useSession();
  const url = useUrlState();
  const tab = url.get('tab', 'today');
  const [reserving, setReserving] = useState(false);
  return (
    <>
      <PageHeader
        title="Boarding & grooming"
        help="boarding"
        description="Kennel bookings, check-in and check-out with nightly billing, daily care log, and the grooming board."
        actions={can('boarding.write') && <Button size="sm" onClick={() => setReserving(true)}><Plus /> New booking</Button>}
      />
      <div className="mb-4 flex gap-1 overflow-x-auto border-b" role="tablist">
        {TABS.map((t) => <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => url.set({ tab: t.key, status: null, date: null })} className={cn('-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 pb-2 pt-1 text-sm font-medium', tab === t.key ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>{t.key === 'grooming' && <Scissors className="h-3.5 w-3.5" />}{t.label}</button>)}
      </div>
      {tab === 'chart' ? <Chart /> : tab === 'grooming' ? <Grooming /> : tab === 'bookings' ? <Bookings /> : <Today />}
      <ReserveDialog open={reserving} onOpenChange={setReserving} />
    </>
  );
}

export default function BoardingPage() {
  return (
    <RequirePermission anyOf={['boarding.read']}>
      <Suspense>
        <Boarding />
      </Suspense>
    </RequirePermission>
  );
}
