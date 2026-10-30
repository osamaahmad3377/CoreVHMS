'use client';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CalendarPlus, Car, ChevronLeft, ChevronRight, House, MapPin, Play, Stethoscope } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Suspense, useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { AppointmentDialog } from '@/components/scheduling/appointment-dialog';
import { AppointmentStatusBadge } from '@/components/scheduling/appointment-status';
import { BookingDialog } from '@/components/scheduling/booking-dialog';
import { HomeVisitActions } from '@/components/scheduling/home-visit-actions';
import { mapsHref } from '@/components/scheduling/home-visit-fields';
import { Stat } from '@/components/stat';
import { AlertChip } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, NativeSelect } from '@/components/ui/input';
import { useClinicians } from '@/hooks/use-catalog';
import { useUrlState } from '@/hooks/use-url-state';
import { api, qs } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import { useModuleOn, useSession } from '@/lib/session';
import { branchTime, dayLabel, shiftDate, todayIn } from '@/lib/time';
import type { Appointment, HomeVisit } from '@/lib/types';
import { cn } from '@/lib/utils';

const ALL = 'all';

/** Where the vet is with this visit, in plain words. */
function progress(v: HomeVisit) {
  if (v.status === 'CANCELLED') return null;
  if (v.status === 'COMPLETED') return 'Finished';
  if (v.status === 'IN_CONSULTATION') return 'With the patient';
  if (v.arrivedAt) return 'Arrived';
  if (v.onTheWayAt) return 'On the way';
  return null;
}

function VisitCard({ v, tz, onOpen, onChanged }: { v: HomeVisit; tz: string; onOpen: () => void; onChanged: () => void }) {
  const { can, currency } = useSession();
  const router = useRouter();
  const href = mapsHref(v);
  const start = useMutation({
    mutationFn: () => api.post<Appointment & { encounterId: string | null }>(`/appointments/${v.id}/status`, { action: 'start' }),
    onSuccess: (a) => {
      onChanged();
      if (a.encounterId) router.push(`/consultations/${a.encounterId}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const closed = ['CANCELLED', 'NO_SHOW'].includes(v.status);
  const step = progress(v);
  return (
    <li className={cn('grid gap-3 rounded-xl surface-flat p-4 shadow-card', closed && 'opacity-60', v.status === 'IN_CONSULTATION' && 'border-primary/50 ring-1 ring-primary/30')}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-lg font-semibold tabular">{branchTime(v.startsAt, tz)}</p>
          {v.travelStartsAt && <p className="text-xs text-muted-foreground">Leave by {branchTime(v.travelStartsAt, tz)} · {v.travelMinutes} min travel</p>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {step && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{step}</span>}
          <AppointmentStatusBadge status={v.status} />
        </div>
      </div>

      <div className="grid gap-1">
        <p className="font-medium">
          {v.patient ? (
            <Link href={`/patients/${v.patient.id}`} className="hover:underline">
              {v.patient.name}
            </Link>
          ) : (
            'Patient not chosen'
          )}
          {v.patient && <span className="font-normal text-muted-foreground"> · {v.patient.species.name}</span>}
          <span className="font-normal text-muted-foreground"> · {v.appointmentType.name}</span>
        </p>
        {v.patient && v.patient.alerts.length > 0 && <div className="flex flex-wrap gap-1">{v.patient.alerts.map((al) => <AlertChip key={al.id} alert={al} />)}</div>}
        <p className="text-sm">
          <Link href={`/clients/${v.client.id}`} className="hover:underline">
            {v.client.displayName}
          </Link>
          {v.client.mobilePhone && <span className="text-muted-foreground"> · {v.client.mobilePhone}</span>}
        </p>
        {v.reason && <p className="text-sm text-muted-foreground">Reason: {v.reason}</p>}
        {v.clinician && <p className="text-xs text-muted-foreground">Vet: {v.clinician.name}</p>}
      </div>

      <div className="grid gap-1 rounded-md bg-muted/50 p-3 text-sm">
        <p className="flex items-start gap-2">
          <House className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span className="whitespace-pre-line">{v.visitAddress}</span>
        </p>
        {v.visitDirections && <p className="pl-6 text-muted-foreground">{v.visitDirections}</p>}
        {href && (
          <a href={href} target="_blank" rel="noopener noreferrer" className="flex w-fit items-center gap-1 pl-6 text-sm font-medium text-primary hover:underline">
            <MapPin className="h-4 w-4" /> Open in Google Maps
          </a>
        )}
      </div>

      {v.fees.length > 0 && (
        <ul className="grid gap-0.5 text-xs text-muted-foreground">
          {v.fees.map((f) => (
            <li key={f.id} className={cn(f.status === 'WAIVED' && 'line-through')}>
              {f.description}: {fmtMoney(f.totalMinor, currency)}
              {f.status === 'INVOICED' ? ' (on invoice)' : f.status === 'WAIVED' ? ' (waived)' : ' (added to the bill)'}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2 border-t pt-3">
        <HomeVisitActions a={v} onDone={onChanged} />
        {v.encounter ? (
          <Button size="sm" asChild>
            <Link href={`/consultations/${v.encounter.id}`}>
              <Stethoscope /> Open consultation
            </Link>
          </Button>
        ) : (
          ['BOOKED', 'CONFIRMED'].includes(v.status) &&
          !!v.patient &&
          can('clinical.write') && (
            <Button size="sm" variant={v.arrivedAt ? 'default' : 'outline'} loading={start.isPending} onClick={() => start.mutate()}>
              <Play /> Start consultation
            </Button>
          )
        )}
        <Button size="sm" variant="ghost" onClick={onOpen}>
          Details
        </Button>
      </div>
    </li>
  );
}

function HomeVisitsView() {
  const { session, can } = useSession();
  const tz = session.branch?.timezone ?? 'UTC';
  const branchId = session.branch?.id ?? '';
  const url = useUrlState();
  const today = todayIn(tz);
  const date = url.get('date', today);
  const clinicians = useClinicians(branchId);
  const me = clinicians.data?.find((c) => c.userId === session.user.id);
  // A vet sees their own visits first; everyone else sees all of them.
  const vet = url.get('vet', me ? me.membershipId : ALL);
  const clinicianId = vet === ALL ? undefined : vet;
  const [selected, setSelected] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);

  const q = useQuery({
    queryKey: ['home-visits', branchId, date, clinicianId],
    queryFn: () => api.get<{ date: string; timezone: string; visits: HomeVisit[] }>(`/home-visits${qs({ date, branchId, clinicianId })}`),
    enabled: !!branchId && !clinicians.isLoading,
    refetchInterval: 60_000,
  });
  const visits = q.data?.visits ?? [];
  const active = visits.filter((v) => !['CANCELLED', 'NO_SHOW'].includes(v.status));
  const done = active.filter((v) => v.status === 'COMPLETED').length;
  const km = active.reduce((n, v) => n + (v.distanceKm ?? 0), 0);

  return (
    <>
      <PageHeader
        help="home-visits"
        title="Home visits"
        description={`${session.branch?.name ?? ''} · ${dayLabel(date, 'EEEE d MMMM')}`}
        actions={
          can('appointments.write') && (
            <Button size="sm" onClick={() => setBooking(true)}>
              <CalendarPlus /> Book a home visit
            </Button>
          )
        }
      />
      <Card className="mb-4 flex flex-wrap items-center gap-2 p-3">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon-sm" aria-label="Previous day" onClick={() => url.set({ date: shiftDate(date, -1) })}>
            <ChevronLeft />
          </Button>
          <Button variant="outline" size="sm" onClick={() => url.set({ date: today })}>
            Today
          </Button>
          <Button variant="outline" size="icon-sm" aria-label="Next day" onClick={() => url.set({ date: shiftDate(date, 1) })}>
            <ChevronRight />
          </Button>
        </div>
        <Input type="date" aria-label="Date" className="h-8 w-[150px]" value={date} onChange={(e) => e.target.value && url.set({ date: e.target.value })} />
        <NativeSelect aria-label="Vet" className="h-8 w-[200px] text-sm sm:ml-auto" value={vet} onChange={(e) => url.set({ vet: e.target.value })}>
          <option value={ALL}>All vets</option>
          {clinicians.data?.map((c) => (
            <option key={c.membershipId} value={c.membershipId}>
              {c.membershipId === me?.membershipId ? `${c.name} (me)` : c.name}
            </option>
          ))}
        </NativeSelect>
      </Card>

      {q.isLoading || clinicians.isLoading ? (
        <LoadingRows rows={4} />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !visits.length ? (
        <EmptyState
          icon={Car}
          title={date === today ? 'No home visits today' : 'No home visits on this day'}
          description={
            clinicianId
              ? `Showing ${clinicians.data?.find((c) => c.membershipId === clinicianId)?.name ?? 'one vet'}’s visits only.`
              : 'Book one from here or from the calendar: choose “Home visit” and enter the address.'
          }
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {clinicianId && (
                <Button size="sm" variant="outline" onClick={() => url.set({ vet: ALL })}>
                  Show all vets
                </Button>
              )}
              {can('appointments.write') && (
                <Button size="sm" onClick={() => setBooking(true)}>
                  <CalendarPlus /> Book a home visit
                </Button>
              )}
            </div>
          }
        />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-3 gap-3">
            <Stat label="Visits" value={active.length} />
            <Stat label="Finished" value={`${done} of ${active.length}`} />
            <Stat label="Distance" value={`${Math.round(km * 10) / 10} km`} />
          </div>
          <ol className="grid gap-3 lg:grid-cols-2">
            {visits.map((v) => (
              <VisitCard key={v.id} v={v} tz={tz} onOpen={() => setSelected(v.id)} onChanged={() => q.refetch()} />
            ))}
          </ol>
        </>
      )}
      <BookingDialog open={booking} onOpenChange={setBooking} defaults={{ date, location: 'HOME', clinicianId: clinicianId ?? undefined }} onBooked={() => q.refetch()} />
      <AppointmentDialog
        id={selected}
        open={!!selected}
        onOpenChange={(o) => {
          if (!o) {
            setSelected(null);
            q.refetch();
          }
        }}
      />
    </>
  );
}

export default function HomeVisitsPage() {
  const moduleOn = useModuleOn();
  if (!moduleOn('homeVisits')) {
    return <EmptyState icon={House} title="Home visits are switched off" description="An owner or manager can switch them on in Settings → Services you offer." />;
  }
  return (
    <RequirePermission anyOf={['appointments.read']}>
      <Suspense>
        <HomeVisitsView />
      </Suspense>
    </RequirePermission>
  );
}
