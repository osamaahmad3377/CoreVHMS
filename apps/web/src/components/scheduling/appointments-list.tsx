'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Paginated } from '@vcms/shared';
import { Building2, CalendarSearch, Check, ChevronRight, ClipboardList, Footprints, Globe, House, LayoutList, PawPrint, Phone, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { DataTable } from '../data-table';
import { EmptyState } from '../page';
import { SearchInput } from '../search-input';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { NativeSelect } from '../ui/input';
import { Avatar } from '../ui/misc';
import { tabListClass, tabTriggerClass } from '../ui/tabs';
import { AppointmentDialog } from './appointment-dialog';
import { AppointmentStatusBadge } from './appointment-status';
import { useClinicians } from '@/hooks/use-catalog';
import { useUrlState } from '@/hooks/use-url-state';
import { api, qs } from '@/lib/api';
import { useModuleOn, useSession } from '@/lib/session';
import { branchTime, localDate, shiftDate, todayIn } from '@/lib/time';
import type { Appointment } from '@/lib/types';
import { cn } from '@/lib/utils';

type Kind = 'all' | 'online' | 'home' | 'clinic';
interface Bookings extends Paginated<Appointment> {
  counts: Record<Kind, number>;
}

/** How each booking was made. */
const SOURCE: Record<string, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  ONLINE: { label: 'Online', icon: Globe },
  RECEPTION: { label: 'Reception', icon: ClipboardList },
  PHONE: { label: 'Phone', icon: Phone },
  WALK_IN: { label: 'Walk-in', icon: Footprints },
  FOLLOW_UP: { label: 'Follow-up', icon: RotateCcw },
};

/** "Today", "Tomorrow", "Yesterday" or "Tue 10 Nov" in the branch's time. */
function dayWord(iso: string, tz: string) {
  const d = localDate(iso, tz);
  const today = todayIn(tz);
  if (d === today) return 'Today';
  if (d === shiftDate(today, 1)) return 'Tomorrow';
  if (d === shiftDate(today, -1)) return 'Yesterday';
  return branchTime(iso, tz, d.slice(0, 4) === today.slice(0, 4) ? 'EEE d MMM' : 'EEE d MMM yyyy');
}

/**
 * Calendar & appointments → Appointments: every booking as a list — online bookings, home visits, visits at the
 * clinic — with a search, filters and a page at a time. A row opens the appointment; a booking still to confirm
 * can be confirmed from the list.
 */
export function AppointmentsList() {
  const { session, can } = useSession();
  const tz = session.branch?.timezone ?? 'UTC';
  const moduleOn = useModuleOn();
  const url = useUrlState();
  const clinicians = useClinicians(session.branch?.id);
  const [selected, setSelected] = useState<string | null>(null);
  const params = {
    branchId: session.branch?.id,
    kind: (url.get('kind', 'all') as Kind) || 'all',
    when: url.get('when', 'upcoming'),
    status: url.get('status', 'any'),
    clinicianId: url.get('clinician') || undefined,
    q: url.get('q') || undefined,
    page: Number(url.get('page', '1')),
    pageSize: Number(url.get('pageSize', '25')),
  };
  const query = useQuery({
    queryKey: ['appointment-bookings', params],
    queryFn: () => api.get<Bookings>(`/appointments/bookings${qs(params)}`),
    placeholderData: (p) => p,
    refetchInterval: 60_000,
  });
  const qc = useQueryClient();
  const confirm = useMutation({
    mutationFn: (id: string) => api.post<Appointment>(`/appointments/${id}/status`, { action: 'confirm' }),
    onSuccess: (a) => {
      toast.success(`${a.patient?.name ?? a.client.displayName} confirmed for ${dayWord(a.startsAt, tz).toLowerCase()} at ${branchTime(a.startsAt, tz)}`);
      qc.invalidateQueries({ queryKey: ['appointment-bookings'] });
      qc.invalidateQueries({ queryKey: ['appointments'] });
      qc.invalidateQueries({ queryKey: ['queue'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const canConfirm = can('appointments.write') || can('appointments.checkin');
  const counts = query.data?.counts;
  const kinds: { key: Kind; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { key: 'all', label: 'All bookings', icon: LayoutList },
    { key: 'online', label: 'Online bookings', icon: Globe },
    ...(moduleOn('homeVisits') ? [{ key: 'home' as const, label: 'Home visits', icon: House }] : []),
    { key: 'clinic', label: 'At the clinic', icon: Building2 },
  ];

  return (
    <Card className="overflow-hidden">
      <div className="grid gap-3 border-b bg-muted/20 p-3 sm:p-4">
        <div className={cn(tabListClass, 'w-fit')} role="radiogroup" aria-label="Kind of booking">
          {kinds.map((k) => {
            const on = params.kind === k.key;
            return (
              <button key={k.key} type="button" role="radio" aria-checked={on} className={tabTriggerClass(on)} onClick={() => url.set({ kind: k.key === 'all' ? null : k.key, page: 1 })}>
                <k.icon className="h-4 w-4" />
                {k.label}
                {counts && <span className={cn('tabular text-xs', on ? 'text-foreground/70' : 'text-muted-foreground')}>{counts[k.key]}</span>}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-full border bg-background p-0.5" role="radiogroup" aria-label="When">
            {(
              [
                ['upcoming', 'Upcoming'],
                ['past', 'Past'],
                ['all', 'All dates'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={params.when === k}
                onClick={() => url.set({ when: k === 'upcoming' ? null : k, page: 1 })}
                className={cn('h-7 rounded-full px-3 text-xs font-medium transition-colors', params.when === k ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground')}
              >
                {label}
              </button>
            ))}
          </div>
          <NativeSelect aria-label="Status" className="h-8 w-[170px] rounded-full text-xs" value={params.status} onChange={(e) => url.set({ status: e.target.value === 'any' ? null : e.target.value, page: 1 })}>
            <option value="any">Any status</option>
            <option value="toConfirm">To confirm</option>
            <option value="active">Booked & in progress</option>
            <option value="done">Finished</option>
            <option value="cancelled">Cancelled & no-shows</option>
          </NativeSelect>
          <NativeSelect aria-label="Vet" className="h-8 w-[180px] rounded-full text-xs" value={params.clinicianId ?? ''} onChange={(e) => url.set({ clinician: e.target.value || null, page: 1 })}>
            <option value="">All vets</option>
            {clinicians.data?.map((c) => (
              <option key={c.membershipId} value={c.membershipId}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
          <SearchInput className="sm:ml-auto sm:max-w-xs" value={params.q ?? ''} onChange={(q) => url.set({ q, page: 1 })} placeholder="Pet, client, mobile or A-number" />
        </div>
      </div>
      <DataTable
        query={query}
        rowKey={(a) => a.id}
        onRowClick={(a) => setSelected(a.id)}
        page={params.page}
        pageSize={params.pageSize}
        onPage={(page) => url.set({ page })}
        onPageSize={(pageSize) => url.set({ pageSize, page: 1 })}
        empty={
          <EmptyState
            icon={CalendarSearch}
            title={params.q ? `No bookings match “${params.q}”` : params.kind === 'online' ? 'No online bookings here' : params.kind === 'home' ? 'No home visits here' : 'No bookings here'}
            description={params.when === 'upcoming' ? 'Try “Past” or “All dates”, or another filter.' : 'Try another filter.'}
          />
        }
        columns={[
          {
            key: 'when',
            header: 'When',
            cell: (a) => {
              const word = dayWord(a.startsAt, tz);
              return (
                <div className="whitespace-nowrap">
                  <p className={cn('text-sm font-semibold', word === 'Today' && 'text-primary')}>{word}</p>
                  <p className="text-xs tabular text-muted-foreground">
                    {branchTime(a.startsAt, tz)} – {branchTime(a.endsAt, tz)}
                  </p>
                </div>
              );
            },
          },
          {
            key: 'patient',
            header: 'Patient',
            cell: (a) => (
              <div className="flex min-w-[190px] items-center gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                  <PawPrint className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="truncate font-semibold">{a.patient?.name ?? a.client.displayName}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[a.patient?.species.name, a.patient ? a.client.displayName : null, a.client.mobilePhone].filter(Boolean).join(' · ')}
                  </p>
                </div>
              </div>
            ),
          },
          {
            key: 'service',
            header: 'Service',
            cell: (a) => (
              <div className="grid max-w-[240px] gap-0.5">
                <span className="flex items-center gap-1.5 text-sm">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: a.appointmentType.color }} aria-hidden />
                  <span className="truncate">{a.appointmentType.name}</span>
                </span>
                {a.reason && <span className="truncate text-xs text-muted-foreground">{a.reason}</span>}
              </div>
            ),
          },
          {
            key: 'vet',
            header: 'Vet',
            cell: (a) =>
              a.clinician ? (
                <span className="flex items-center gap-2 whitespace-nowrap text-sm">
                  <Avatar name={a.clinician.name.replace(/^Dr\.?\s+/i, '')} className="h-7 w-7 text-[10px]" />
                  {a.clinician.name}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">Any vet</span>
              ),
          },
          {
            key: 'where',
            header: 'Where',
            cell: (a) =>
              a.location === 'HOME' ? (
                <div className="grid max-w-[220px] gap-0.5">
                  <span className="inline-flex w-fit items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                    <House className="h-3 w-3" /> Home visit
                  </span>
                  {a.visitAddress && (
                    <span className="truncate text-xs text-muted-foreground" title={a.visitAddress}>
                      {a.visitAddress}
                    </span>
                  )}
                </div>
              ) : (
                <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  <Building2 className="h-3 w-3" /> Clinic
                </span>
              ),
          },
          {
            key: 'source',
            header: 'Booked',
            cell: (a) => {
              const s = SOURCE[a.source] ?? { label: a.source, icon: ClipboardList };
              return (
                <div className="whitespace-nowrap">
                  <span className={cn('inline-flex items-center gap-1 text-xs font-medium', a.source === 'ONLINE' ? 'text-primary' : 'text-foreground/80')}>
                    <s.icon className="h-3.5 w-3.5" /> {s.label}
                  </span>
                  <p className="font-mono text-[11px] text-muted-foreground">{a.appointmentNo}</p>
                </div>
              );
            },
          },
          { key: 'status', header: 'Status', cell: (a) => <AppointmentStatusBadge status={a.status} /> },
          {
            key: 'act',
            header: '',
            className: 'w-px whitespace-nowrap',
            cell: (a) => (
              <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                {a.status === 'BOOKED' && canConfirm && new Date(a.endsAt) > new Date() && (
                  <Button size="sm" variant="outline" className="h-8" loading={confirm.isPending && confirm.variables === a.id} onClick={() => confirm.mutate(a.id)} aria-label={`Confirm ${a.patient?.name ?? a.client.displayName}`}>
                    <Check /> Confirm
                  </Button>
                )}
                <ChevronRight className="h-4 w-4 text-muted-foreground/60" aria-hidden />
              </div>
            ),
          },
        ]}
      />
      <AppointmentDialog id={selected} open={!!selected} onOpenChange={(o) => !o && setSelected(null)} />
    </Card>
  );
}
