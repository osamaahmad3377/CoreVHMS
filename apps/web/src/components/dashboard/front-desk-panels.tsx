'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, LogIn, Play, Users } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { PriorityDot } from '@/components/scheduling/appointment-status';
import { EmptyState } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { fmtRelative } from '@/lib/format';
import { useSession } from '@/lib/session';
import { branchTime } from '@/lib/time';

export interface FrontDeskVisit {
  id: string;
  startsAt: string;
  checkedInAt: string | null;
  status: string;
  priority: string | null;
  patient: { id: string; name: string } | null;
  client: { id: string; displayName: string } | null;
  type: { name: string; color: string };
  clinician: string | null;
  late: boolean;
}

export interface FrontDeskWidget {
  waitingCount: number;
  waiting: FrontDeskVisit[];
  arriving: FrontDeskVisit[];
}

/** Sentence for an empty "next bookings" list, so "nothing left" is not mistaken for "nothing booked". */
export function noMoreBookingsText(appts: { total: number; byStatus: Record<string, number> } | undefined) {
  if (!appts?.total) return 'No appointments booked today';
  const notArrived = (appts.byStatus.BOOKED ?? 0) + (appts.byStatus.CONFIRMED ?? 0);
  if (notArrived) return `No more bookings due now · ${notArrived} not arrived yet`;
  return `All of today’s ${appts.total} appointment${appts.total === 1 ? ' has' : 's have'} started or finished`;
}

/** "Waiting now (N)": checked-in patients, longest wait first. Vets can start the consultation from here. */
export function WaitingNow({ data }: { data: FrontDeskWidget }) {
  const { can } = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const start = useMutation({
    mutationFn: (id: string) => api.post<{ encounterId: string | null }>(`/appointments/${id}/status`, { action: 'start' }),
    onSuccess: (a) => {
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['queue'] });
      if (a.encounterId) router.push(`/consultations/${a.encounterId}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Users className="h-4 w-4 text-warning" /> Waiting now ({data.waitingCount})</CardTitle>
        <Link href="/front-desk" className="text-xs text-primary hover:underline">Front desk</Link>
      </CardHeader>
      {data.waiting.length ? (
        <ul className="divide-y">
          {data.waiting.map((a) => (
            <li key={a.id} className="flex items-center gap-2 pr-4 hover:bg-muted/50">
              <Link href="/front-desk" className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-0.5 py-2 pl-4">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{a.patient?.name ?? a.client?.displayName ?? 'Walk-in'}</span>
                  <span className="block truncate text-xs text-muted-foreground">{a.client?.displayName}{a.clinician ? ` · ${a.clinician}` : ''}</span>
                </span>
                <PriorityDot priority={a.priority} />
                <span className="text-xs text-muted-foreground">Waiting since {fmtRelative(a.checkedInAt ?? a.startsAt)}</span>
              </Link>
              {can('clinical.write') && a.patient && (
                <Button size="sm" loading={start.isPending && start.variables === a.id} onClick={() => start.mutate(a.id)} aria-label={`Start consultation for ${a.patient.name}`}>
                  <Play /> Start
                </Button>
              )}
            </li>
          ))}
          {data.waitingCount > data.waiting.length && (
            <li className="px-4 py-2 text-xs text-muted-foreground">+{data.waitingCount - data.waiting.length} more on the front desk</li>
          )}
        </ul>
      ) : (
        <EmptyState title="Nobody is waiting" className="py-6" />
      )}
    </Card>
  );
}

/** "Arriving next": the next bookings, each with a Check in button. */
export function ArrivingNext({ data, emptyText }: { data: FrontDeskWidget; emptyText: string }) {
  const { session, can } = useSession();
  const tz = session.branch?.timezone ?? 'UTC';
  const qc = useQueryClient();
  const checkIn = useMutation({
    mutationFn: (id: string) => api.post<{ patient: { name: string } | null }>(`/appointments/${id}/status`, { action: 'check-in' }),
    onSuccess: (a) => {
      toast.success(`${a.patient?.name ?? 'Client'} checked in`);
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['queue'] });
      qc.invalidateQueries({ queryKey: ['appointments'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-muted-foreground" /> Arriving next</CardTitle>
        <Link href="/calendar" className="text-xs text-primary hover:underline">Calendar</Link>
      </CardHeader>
      {data.arriving.length ? (
        <ul className="divide-y">
          {data.arriving.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
              <span className="w-11 text-sm font-medium tabular">{branchTime(a.startsAt, tz)}</span>
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: a.type.color }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">
                  {a.patient?.name ?? 'No patient'}
                  {a.late && <span className="ml-1.5 rounded bg-warning/15 px-1.5 py-0.5 text-2xs font-medium text-warning">Late</span>}
                </span>
                <span className="block truncate text-xs text-muted-foreground">{a.client?.displayName}{` · ${a.type.name}`}{a.clinician && ` · ${a.clinician}`}</span>
              </span>
              {can('appointments.checkin') && (
                <Button size="sm" variant="outline" loading={checkIn.isPending && checkIn.variables === a.id} onClick={() => checkIn.mutate(a.id)}>
                  <LogIn /> Check in
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title={emptyText} className="py-6" action={<Link href="/calendar" className="text-sm font-medium text-primary hover:underline">Open the calendar</Link>} />
      )}
    </Card>
  );
}
