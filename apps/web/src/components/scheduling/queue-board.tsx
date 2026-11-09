'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertOctagon, Building2, CalendarPlus, Clock, DoorOpen, House, Info, LogIn, Phone, Play, Printer, Receipt, Siren, Stethoscope, Users } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { EmptyState } from '../page';
import { AlertChip } from '../status';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardHeader, CardTitle } from '../ui/card';
import { AppointmentDialog } from './appointment-dialog';
import { AppointmentStatusBadge, PriorityDot } from './appointment-status';
import { fmtWait, statusChangeMessage } from './appointment-text';
import { CallButton, TokenBadge } from './call-button';
import { printTokenSlip } from './token-slip';
import { TriageDialog } from './triage-dialog';
import { api } from '@/lib/api';
import { useModuleOn, useSession } from '@/lib/session';
import { branchTime } from '@/lib/time';
import type { Appointment } from '@/lib/types';
import { cn } from '@/lib/utils';

export interface Queue {
  date: string;
  timezone: string;
  expected: Appointment[];
  waiting: Appointment[];
  inConsultation: Appointment[];
  done: Appointment[];
  stats: { total: number; averageWaitMinutes: number; noShows: number };
}
export type QueueColumn = 'expected' | 'waiting' | 'inConsultation' | 'done';
type ExpectedWhere = 'ALL' | 'CLINIC' | 'HOME';

/** Today's queue at the signed-in branch (refreshes every 30 seconds; shared by the front desk and consultations). */
export function useQueue() {
  const { session } = useSession();
  return useQuery({
    queryKey: ['queue', session.branch?.id],
    queryFn: () => api.get<Queue>(`/front-desk/queue?branchId=${session.branch?.id}`),
    refetchInterval: 30_000,
  });
}

const COLUMNS: { key: QueueColumn; title: string; icon: React.ComponentType<{ className?: string }>; empty: string }[] = [
  { key: 'expected', title: 'Expected', icon: CalendarPlus, empty: 'No more bookings today' },
  { key: 'waiting', title: 'Waiting', icon: Users, empty: 'Nobody is waiting' },
  { key: 'inConsultation', title: 'In consultation', icon: Stethoscope, empty: 'No consultations in progress' },
  { key: 'done', title: 'Finished', icon: DoorOpen, empty: 'Nothing finished yet' },
];

function QueueCard({
  a,
  tz,
  onOpen,
  children,
}: {
  a: Appointment;
  tz: string;
  onOpen: () => void;
  children?: React.ReactNode;
}) {
  const pr = a.effectivePriority ?? a.triage?.priority ?? a.priority;
  const urgent = pr === 'RESUSCITATION' || pr === 'EMERGENT';
  return (
    <li className={cn('rounded-lg surface-flat p-3 shadow-card', urgent && 'border-destructive/50 ring-1 ring-destructive/30')}>
      <button onClick={onOpen} className="block w-full text-left" aria-label={`Details: ${a.patient?.name ?? a.client.displayName}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 truncate font-medium">
              <TokenBadge token={a.tokenNumber} className="mr-0.5" />
              {urgent && <AlertOctagon className="h-4 w-4 shrink-0 text-destructive" />}
              {a.patient?.name ?? a.client.displayName}
              <span className="text-xs font-normal text-muted-foreground">{a.patient?.species.name}</span>
            </p>
            {a.patient && (
              <p className="flex items-center gap-1 truncate text-xs">
                {a.client.displayName}
                {a.client.mobilePhone && (
                  <span className="flex items-center gap-0.5 text-muted-foreground">
                    · <Phone className="h-3 w-3" /> {a.client.mobilePhone}
                  </span>
                )}
              </p>
            )}
            <p className="truncate text-xs text-muted-foreground">
              {branchTime(a.startsAt, tz)} · {a.appointmentType.name} · {a.clinician?.name ?? 'No vet yet'}
            </p>
            {a.reason && <p className="truncate text-xs">{a.reason}</p>}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <PriorityDot priority={pr} withLabel />
            {a.waitingMinutes !== null && a.waitingMinutes !== undefined && (
              <span className={cn('flex items-center gap-1 text-xs tabular', a.waitingMinutes >= 30 ? 'font-semibold text-destructive' : 'text-muted-foreground')}>
                <Clock className="h-3 w-3" /> {fmtWait(a.waitingMinutes)}
              </span>
            )}
            {a.source === 'WALK_IN' && <span className="text-2xs text-muted-foreground">Walk-in</span>}
            {a.calledAt && a.status === 'CHECKED_IN' && <span className="text-2xs font-semibold text-primary">Called{a.calledRoom ? ` · ${a.calledRoom}` : ''}</span>}
          </div>
        </div>
        {!!a.patient?.alerts.length && (
          <div className="mt-1.5 flex flex-wrap gap-1">{a.patient.alerts.slice(0, 2).map((al) => <AlertChip key={al.id} alert={al} />)}</div>
        )}
      </button>
      <div className="mt-2 flex flex-wrap gap-1.5 border-t pt-2">
        {children}
        <Button size="sm" variant="ghost" onClick={onOpen}>
          <Info /> Details
        </Button>
      </div>
    </li>
  );
}

/**
 * Today's queue as cards per column, each with its actions (check in, call, token, triage, details …). A consultation
 * is started only where `allowStart` is set — from Consultations, not the front desk.
 */
export function QueueBoard({ columns, allowStart, className }: { columns: QueueColumn[]; allowStart: boolean; className?: string }) {
  const { session, can, canAny } = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const tz = session.branch?.timezone ?? 'UTC';
  const q = useQueue();
  const [selected, setSelected] = useState<string | null>(null);
  const [triage, setTriage] = useState<Appointment | null>(null);
  // Expected: everyone, only visits at the clinic, or only home visits (remembered on this computer).
  const moduleOn = useModuleOn();
  const [expectedWhere, setExpectedWhereState] = useState<ExpectedWhere>('ALL');
  useEffect(() => {
    try {
      const v = localStorage.getItem('front-desk-expected-where');
      if (v === 'CLINIC' || v === 'HOME') setExpectedWhereState(v);
    } catch {
      /* storage unavailable: start with everyone */
    }
  }, []);
  const setExpectedWhere = (v: ExpectedWhere) => {
    setExpectedWhereState(v);
    try {
      localStorage.setItem('front-desk-expected-where', v);
    } catch {
      /* storage unavailable */
    }
  };
  // Prints the client's token on the 80 mm receipt printer; "ahead" counts uncalled tokens checked in earlier.
  const printToken = (a: Appointment) => {
    if (!a.tokenNumber) return;
    const waiting = q.data?.waiting ?? [];
    const at = a.checkedInAt ? new Date(a.checkedInAt).getTime() : Date.now();
    const ahead = waiting.filter((w) => w.id !== a.id && !w.calledAt && w.checkedInAt && new Date(w.checkedInAt).getTime() < at).length;
    void printTokenSlip({
      clinic: session.organization?.name ?? '',
      branch: session.branch?.name ?? '',
      token: a.tokenNumber,
      petName: a.patient?.name ?? null,
      service: a.appointmentType.name,
      ahead,
      issuedAt: branchTime(a.checkedInAt ?? new Date().toISOString(), tz, 'd MMM yyyy, h:mm a'),
      bookedAt: a.source === 'WALK_IN' ? null : branchTime(a.startsAt, tz, 'h:mm a'),
    });
  };
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) => api.post<Appointment & { encounterId: string | null }>(`/appointments/${id}/status`, { action }),
    onSuccess: (a, v) => {
      qc.invalidateQueries({ queryKey: ['queue'] });
      qc.invalidateQueries({ queryKey: ['appointments'] });
      if (v.action === 'start' && a.encounterId) router.push(`/consultations/${a.encounterId}`);
      else if (v.action === 'check-in' && a.tokenNumber) toast.success(statusChangeMessage(v.action, a, tz), { action: { label: 'Print token', onClick: () => printToken(a) } });
      else toast.success(statusChangeMessage(v.action, a, tz));
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!q.data) return null;
  const shown = COLUMNS.filter((c) => columns.includes(c.key));

  return (
    <>
    <div className={cn('grid gap-4', className ?? 'lg:grid-cols-2 2xl:grid-cols-4')}>
      {shown.map((c) => {
        const all = q.data![c.key] as Appointment[];
        // The home-visit filter is on Expected, while the clinic offers home visits (or has some today).
        const filterable = c.key === 'expected' && (moduleOn('homeVisits') || all.some((a) => a.location === 'HOME'));
        const where = filterable ? expectedWhere : 'ALL';
        const items = where === 'ALL' ? all : all.filter((a) => (where === 'HOME' ? a.location === 'HOME' : a.location !== 'HOME'));
        const homeCount = all.filter((a) => a.location === 'HOME').length;
        return (
          <Card key={c.key} className="flex flex-col">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <c.icon className="h-4 w-4 text-muted-foreground" /> {c.title}
              </CardTitle>
              <Badge variant="secondary" className="tabular">{items.length}</Badge>
            </CardHeader>
            {filterable && (
              <div className="flex flex-wrap gap-1.5 px-3 pb-1" role="radiogroup" aria-label="Show expected">
                {(
                  [
                    { key: 'ALL', label: 'All', count: all.length, icon: null },
                    { key: 'CLINIC', label: 'At the clinic', count: all.length - homeCount, icon: Building2 },
                    { key: 'HOME', label: 'Home visits', count: homeCount, icon: House },
                  ] as const
                ).map((o) => {
                  const on = where === o.key;
                  return (
                    <button
                      key={o.key}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => setExpectedWhere(o.key)}
                      className={cn(
                        'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        on ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-foreground/80 hover:border-primary/40 hover:text-foreground',
                      )}
                    >
                      {o.icon && <o.icon className="h-3.5 w-3.5" aria-hidden />}
                      {o.label}
                      <span className={cn('tabular', on ? 'text-primary-foreground/80' : 'text-muted-foreground')}>{o.count}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {items.length ? (
              <ul className="grid gap-2 p-2">
                {items.map((a) => (
                  <QueueCard key={a.id} a={a} tz={tz} onOpen={() => setSelected(a.id)}>
                    {c.key === 'expected' && a.location === 'HOME' && (
                      <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                        <House className="h-3.5 w-3.5" /> Home visit{a.arrivedAt ? ' · vet arrived' : a.onTheWayAt ? ' · vet on the way' : ''}
                      </span>
                    )}
                    {c.key === 'expected' && a.location !== 'HOME' && can('appointments.checkin') && (
                      <Button size="sm" onClick={() => act.mutate({ id: a.id, action: 'check-in' })}>
                        <LogIn /> Check in
                      </Button>
                    )}
                    {c.key === 'waiting' && canAny('appointments.checkin', 'clinical.write') && (
                      <CallButton appointmentId={a.id} branchId={a.branchId} calledRoom={a.calledRoom} callCount={a.callCount} />
                    )}
                    {c.key === 'waiting' && !!a.tokenNumber && (
                      <Button size="sm" variant="outline" onClick={() => printToken(a)} title="Print the token on the receipt printer (80 mm)">
                        <Printer /> Print token
                      </Button>
                    )}
                    {c.key === 'waiting' && can('triage.write') && a.patient && (
                      <Button size="sm" variant="outline" onClick={() => setTriage(a)}>
                        <Siren /> Triage
                      </Button>
                    )}
                    {c.key === 'waiting' && allowStart && can('clinical.write') && a.patient && (
                      <Button size="sm" onClick={() => act.mutate({ id: a.id, action: 'start' })}>
                        <Play /> Start
                      </Button>
                    )}
                    {c.key === 'inConsultation' && a.encounter && (
                      <Button size="sm" variant="outline" asChild>
                        <Link href={`/consultations/${a.encounter.id}`}>
                          <Stethoscope /> Open
                        </Link>
                      </Button>
                    )}
                    {c.key === 'done' && <AppointmentStatusBadge status={a.status} />}
                    {c.key === 'done' && !!a.unbilledCharges && can('billing.write') && (
                      <Button size="sm" asChild>
                        <Link href={`/billing/invoices/new?clientId=${a.client.id}`} title={`${a.unbilledCharges} item${a.unbilledCharges === 1 ? '' : 's'} not yet invoiced`}>
                          <Receipt /> Bill
                        </Link>
                      </Button>
                    )}
                  </QueueCard>
                ))}
              </ul>
            ) : (
              <EmptyState title={where === 'HOME' ? 'No more home visits today' : where === 'CLINIC' ? 'No more clinic visits today' : c.empty} className="py-8" />
            )}
          </Card>
        );
      })}
    </div>
      <AppointmentDialog id={selected} open={!!selected} onOpenChange={(o) => !o && setSelected(null)} allowStart={allowStart} />
      {triage?.patient && (
        <TriageDialog open={!!triage} onOpenChange={(o) => !o && setTriage(null)} patientId={triage.patient.id} appointmentId={triage.id} patientName={triage.patient.name} defaultComplaint={triage.triage?.presentingComplaint ?? triage.reason} />
      )}
    </>
  );
}
