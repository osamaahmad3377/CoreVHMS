'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Bell, BellOff, CalendarClock, CalendarX2, Check, CheckCheck, Globe, House, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AppointmentDialog } from '../scheduling/appointment-dialog';
import { Button } from '../ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { api, qs } from '@/lib/api';
import { fmtRelative } from '@/lib/format';
import { useSession } from '@/lib/session';
import { branchTime } from '@/lib/time';
import { cn } from '@/lib/utils';

type Kind = 'ONLINE_BOOKED' | 'ONLINE_RESCHEDULED' | 'ONLINE_CANCELLED';
interface StaffNotification {
  id: string;
  kind: Kind;
  createdAt: string;
  read: boolean;
  previousStartsAt: string | null;
  detail: string | null;
  appointment: {
    id: string;
    appointmentNo: string;
    startsAt: string;
    status: string;
    location: 'CLINIC' | 'HOME';
    service: string | null;
    branch: { name: string; timezone: string };
    patient: { id: string; name: string; species: string | null } | null;
    client: { id: string; displayName: string; mobilePhone: string | null };
    vet: string | null;
  } | null;
}
interface Feed {
  unread: number;
  items: StaffNotification[];
}

const KIND: Record<Kind, { title: string; icon: LucideIcon; tone: string }> = {
  ONLINE_BOOKED: { title: 'New online booking', icon: Globe, tone: 'bg-gradient-to-br from-emerald-500 to-teal-600' },
  ONLINE_RESCHEDULED: { title: 'Booking moved online', icon: CalendarClock, tone: 'bg-gradient-to-br from-amber-500 to-orange-600' },
  ONLINE_CANCELLED: { title: 'Booking cancelled online', icon: CalendarX2, tone: 'bg-gradient-to-br from-rose-500 to-red-600' },
};

const STATUS: Record<string, { label: string; cls: string }> = {
  BOOKED: { label: 'To confirm', cls: 'bg-warning/15 text-warning' },
  CONFIRMED: { label: 'Confirmed', cls: 'bg-success/15 text-success' },
  CHECKED_IN: { label: 'Arrived', cls: 'bg-primary/10 text-primary' },
  IN_CONSULTATION: { label: 'In consultation', cls: 'bg-primary/10 text-primary' },
  COMPLETED: { label: 'Completed', cls: 'bg-muted text-muted-foreground' },
  CANCELLED: { label: 'Cancelled', cls: 'bg-destructive/10 text-destructive' },
  NO_SHOW: { label: 'No-show', cls: 'bg-muted text-muted-foreground' },
};

const when = (iso: string, tz: string) => branchTime(iso, tz, 'EEE d MMM · HH:mm');

/** One line for a toast or screen reader: who, which animal, when. */
function summary(n: StaffNotification) {
  const a = n.appointment;
  if (!a) return '';
  return [a.patient ? `${a.patient.name}${a.patient.species ? ` (${a.patient.species})` : ''}` : null, a.client.displayName, when(a.startsAt, a.branch.timezone)].filter(Boolean).join(' · ');
}

function dayGroup(iso: string) {
  const d = new Date(iso);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (d >= start) return 'Today';
  if (d >= new Date(start.getTime() - 86400_000)) return 'Yesterday';
  return 'Earlier';
}

/**
 * The bell in the top bar: online bookings, moves and cancellations as they happen. A new one also pops up
 * as a toast for whoever has the system open; each member of staff has their own unread count.
 */
export function NotificationsMenu() {
  const { session, can } = useSession();
  const branchId = session.branch?.id;
  const allowed = can('appointments.read');
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [selected, setSelected] = useState<string | null>(null);

  const key = ['notifications', branchId];
  const feed = useQuery({
    queryKey: key,
    queryFn: () => api.get<Feed>(`/notifications${qs({ branchId, limit: 30 })}`),
    enabled: allowed,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const items = feed.data?.items ?? [];
  const unread = feed.data?.unread ?? 0;

  const markRead = useMutation({
    mutationFn: (ids?: string[]) => api.post<{ marked: number }>('/notifications/read', ids ? { ids } : { branchId }),
    onMutate: async (ids) => {
      // Shows as read at once; the server confirms.
      await qc.cancelQueries({ queryKey: key });
      qc.setQueryData<Feed>(key, (f) => {
        if (!f) return f;
        const hit = (n: StaffNotification) => !ids || ids.includes(n.id);
        const newly = f.items.filter((n) => !n.read && hit(n)).length;
        return { unread: ids ? Math.max(0, f.unread - newly) : 0, items: f.items.map((n) => (hit(n) ? { ...n, read: true } : n)) };
      });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });

  const confirm = useMutation({
    mutationFn: (appointmentId: string) => api.post(`/appointments/${appointmentId}/status`, { action: 'confirm' }),
    onSuccess: () => {
      toast.success('Booking confirmed');
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ['appointment-bookings'] });
      qc.invalidateQueries({ queryKey: ['appointments'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openOne = (n: StaffNotification) => {
    if (!n.read) markRead.mutate([n.id]);
    if (n.appointment) {
      setOpen(false);
      setSelected(n.appointment.id);
    }
  };

  // A pop-up for anything new since the page was opened (not for what was already waiting).
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!feed.data) return;
    if (!seen.current) {
      seen.current = new Set(feed.data.items.map((n) => n.id));
      return;
    }
    const fresh = feed.data.items.filter((n) => !n.read && !seen.current!.has(n.id));
    fresh.forEach((n) => seen.current!.add(n.id));
    fresh.slice(0, 3).forEach((n) => {
      const k = KIND[n.kind];
      toast(k.title, {
        id: `notification-${n.id}`,
        description: summary(n),
        icon: <k.icon className="h-4 w-4 text-primary" />,
        duration: 12_000,
        action: n.appointment ? { label: 'View', onClick: () => openOne(n) } : undefined,
      });
    });
    if (fresh.length > 3) toast(`${fresh.length - 3} more online updates`, { description: 'Open the bell in the top bar to see them all.' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed.data]);

  // A new branch has its own list: start the pop-ups afresh.
  useEffect(() => {
    seen.current = null;
  }, [branchId]);

  if (!allowed) return null;
  const shown = filter === 'unread' ? items.filter((n) => !n.read) : items;
  const groups = ['Today', 'Yesterday', 'Earlier'].map((g) => ({ g, rows: shown.filter((n) => dayGroup(n.createdAt) === g) })).filter((x) => x.rows.length);

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="icon" className="relative" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} title="Notifications">
            <Bell className={cn(unread > 0 && 'origin-top motion-safe:animate-[bell-ring_1.2s_ease-in-out_1]')} />
            {unread > 0 && (
              <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-destructive px-1 text-2xs font-semibold text-white shadow-sm ring-2 ring-background">
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[min(26rem,calc(100vw-1.5rem))] overflow-hidden p-0">
          <div className="flex items-start gap-3 border-b px-4 pb-3 pt-3.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Notifications</p>
              <p className="text-xs text-muted-foreground">Online bookings, changes and cancellations{session.branch ? ` · ${session.branch.name}` : ''}</p>
            </div>
            {unread > 0 && (
              <Button variant="ghost" size="sm" className="h-7 shrink-0 gap-1 px-2 text-xs" onClick={() => markRead.mutate(undefined)}>
                <CheckCheck className="h-3.5 w-3.5" /> Mark all as read
              </Button>
            )}
          </div>
          <div className="flex gap-1 border-b px-3 py-2" role="tablist" aria-label="Show">
            {(['all', 'unread'] as const).map((f) => (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={filter === f}
                onClick={() => setFilter(f)}
                className={cn('inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors', filter === f ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}
              >
                {f === 'all' ? 'All' : 'Unread'}
                {f === 'unread' && unread > 0 && <span className="rounded-full bg-primary px-1.5 text-2xs font-semibold text-primary-foreground">{unread}</span>}
              </button>
            ))}
          </div>

          {feed.isLoading ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">Loading…</p>
          ) : groups.length ? (
            <div className="max-h-[min(65vh,34rem)] overflow-y-auto">
              {groups.map(({ g, rows }) => (
                <section key={g} aria-label={g}>
                  <p className="sticky top-0 z-10 bg-[hsl(var(--glass))] px-4 pb-1 pt-2.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">{g}</p>
                  <ul>
                    {rows.map((n) => (
                      <NotificationRow key={n.id} n={n} onOpen={() => openOne(n)} canConfirm={can('appointments.write')} confirming={confirm.isPending && confirm.variables === n.appointment?.id} onConfirm={() => n.appointment && confirm.mutate(n.appointment.id)} />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-muted text-muted-foreground">
                <BellOff className="h-5 w-5" />
              </span>
              <p className="text-sm font-medium">{filter === 'unread' ? 'You’re all caught up' : 'No notifications yet'}</p>
              <p className="max-w-[18rem] text-xs text-muted-foreground">When a client books, moves or cancels on your online booking page, it shows up here straight away.</p>
            </div>
          )}

          <div className="border-t bg-muted/30 px-4 py-2.5 text-xs">
            <Link href="/calendar?tab=appointments&kind=online" onClick={() => setOpen(false)} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
              All online bookings <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </PopoverContent>
      </Popover>
      <AppointmentDialog id={selected} open={!!selected} onOpenChange={(o) => !o && setSelected(null)} />
    </>
  );
}

function NotificationRow({ n, onOpen, canConfirm, confirming, onConfirm }: { n: StaffNotification; onOpen: () => void; canConfirm: boolean; confirming: boolean; onConfirm: () => void }) {
  const k = KIND[n.kind];
  const a = n.appointment;
  const status = a ? STATUS[a.status] : undefined;
  const showConfirm = canConfirm && n.kind !== 'ONLINE_CANCELLED' && a?.status === 'BOOKED';
  return (
    <li className={cn('relative border-b last:border-b-0', !n.read && 'bg-primary/[0.04]')}>
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen())}
        className="group flex cursor-pointer gap-3 px-4 py-3 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
        aria-label={`${k.title}: ${summary(n)}${n.read ? '' : ' (unread)'}`}
      >
        <span className={cn('relative mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white shadow-sm', k.tone)}>
          <k.icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <p className={cn('min-w-0 flex-1 truncate text-sm', n.read ? 'font-medium' : 'font-semibold')}>{k.title}</p>
            <span className="shrink-0 text-2xs text-muted-foreground">{fmtRelative(n.createdAt)}</span>
            {!n.read && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden />}
          </div>
          {a ? (
            <>
              <p className="mt-0.5 truncate text-[0.8125rem]">
                <span className="font-medium">{a.patient?.name ?? 'No animal'}</span>
                {a.patient?.species && <span className="text-muted-foreground"> ({a.patient.species})</span>}
                <span className="text-muted-foreground"> · {a.client.displayName}</span>
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-2xs">
                <span className={cn('inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-medium tabular', a.status === 'CANCELLED' && 'line-through decoration-muted-foreground/60')}>
                  <CalendarClock className="h-3 w-3" /> {when(a.startsAt, a.branch.timezone)}
                </span>
                {a.service && <span className="max-w-[10rem] truncate rounded-full bg-muted px-2 py-0.5 text-muted-foreground">{a.service}</span>}
                {a.location === 'HOME' && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
                    <House className="h-3 w-3" /> Home visit
                  </span>
                )}
                {status && <span className={cn('rounded-full px-2 py-0.5 font-semibold', status.cls)}>{status.label}</span>}
              </div>
              {n.kind === 'ONLINE_RESCHEDULED' && n.previousStartsAt && <p className="mt-1 text-2xs text-muted-foreground">Was {when(n.previousStartsAt, a.branch.timezone)}</p>}
              {n.kind === 'ONLINE_CANCELLED' && n.detail && <p className="mt-1 truncate text-2xs italic text-muted-foreground">“{n.detail}”</p>}
            </>
          ) : (
            <p className="mt-0.5 text-xs text-muted-foreground">This booking is no longer on the system.</p>
          )}
          {showConfirm && (
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                className="h-7 gap-1 px-2.5 text-xs"
                loading={confirming}
                onClick={(e) => {
                  e.stopPropagation();
                  onConfirm();
                }}
              >
                <Check className="h-3.5 w-3.5" /> Confirm
              </Button>
              <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={(e) => (e.stopPropagation(), onOpen())}>
                Open
              </Button>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
