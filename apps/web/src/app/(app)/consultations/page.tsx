'use client';
import { useQueries, useQuery } from '@tanstack/react-query';
import type { Paginated } from '@vcms/shared';
import { enumLabel } from '@vcms/shared';
import { CalendarClock, ChevronRight, ListChecks, PawPrint, Plus, Stethoscope } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Suspense, useState } from 'react';
import { DataTable } from '@/components/data-table';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/page';
import { QueueBoard, useQueue } from '@/components/scheduling/queue-board';
import { NewVisitDialog } from '@/components/front-desk/new-visit-dialog';
import type { PickedPatient } from '@/components/patients/patient-picker';
import { BookingDialog } from '@/components/scheduling/booking-dialog';
import { RequirePermission } from '@/components/require';
import { SearchInput } from '@/components/search-input';
import { AlertChip } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/checkbox';
import { Avatar } from '@/components/ui/misc';
import { tabListClass, tabTriggerClass } from '@/components/ui/tabs';
import { dashboardRole } from '@/components/dashboard/quick-actions';
import { useUrlState } from '@/hooks/use-url-state';
import { api, qs } from '@/lib/api';
import { fmtRelative } from '@/lib/format';
import { branchTime, localDate, shiftDate, todayIn } from '@/lib/time';
import { useSession } from '@/lib/session';
import type { EncounterRow } from '@/lib/types';
import { cn } from '@/lib/utils';

const STATUSES = [
  { key: 'OPEN', label: 'Open', dot: 'bg-warning', pill: 'bg-warning/10 text-warning' },
  { key: 'COMPLETED', label: 'Completed', dot: 'bg-success', pill: 'bg-success/10 text-success' },
  { key: 'CANCELLED', label: 'Cancelled', dot: 'bg-muted-foreground/50', pill: 'bg-muted text-muted-foreground' },
  { key: 'ALL', label: 'All', dot: 'bg-primary', pill: 'bg-primary/10 text-primary' },
] as const;

const NOTES = {
  SIGNED: { label: 'Signed', dot: 'bg-success', text: 'text-success' },
  UNSIGNED: { label: 'Not signed', dot: 'bg-warning', text: 'text-warning' },
  NONE: { label: 'No notes', dot: 'bg-muted-foreground/40', text: 'text-muted-foreground' },
} as const;

/** "Today, 05:28", "Yesterday, 23:20" or "7 Nov, 20:22" in the branch's time. */
function whenLabel(iso: string, tz: string) {
  const day = localDate(iso, tz);
  const today = todayIn(tz);
  const time = branchTime(iso, tz, 'HH:mm');
  if (day === today) return `Today, ${time}`;
  if (day === shiftDate(today, -1)) return `Yesterday, ${time}`;
  return branchTime(iso, tz, day.slice(0, 4) === today.slice(0, 4) ? 'd MMM, HH:mm' : 'd MMM yyyy, HH:mm');
}

function ConsultationsList() {
  const router = useRouter();
  const { can, session } = useSession();
  const tz = session.branch?.timezone ?? 'UTC';
  const url = useUrlState();
  // ?start=1 (e.g. "See a walk-in" on the dashboard) opens the start window straight away.
  const [start, setStart] = useState(() => url.get('start') === '1');
  const [bookFor, setBookFor] = useState<PickedPatient | null>(null);
  // Vets see their own consultations first; everyone can switch to all.
  const mineDefault = dashboardRole((p) => can(p)) === 'vet' ? 'true' : 'false';
  const params = {
    q: url.get('q'),
    status: url.get('status', 'OPEN'),
    mine: url.get('mine', mineDefault) === 'true' ? 'true' : undefined,
    page: Number(url.get('page', '1')),
    pageSize: Number(url.get('pageSize', '25')),
  };
  // Today's patients (expected and waiting) first; all consultations on the other tab.
  const view = url.get('view', 'today') === 'all' ? 'all' : 'today';
  const queue = useQueue();
  const todayCount = (queue.data?.expected.length ?? 0) + (queue.data?.waiting.length ?? 0);
  const query = useQuery({
    queryKey: ['encounters', params],
    queryFn: () => api.get<Paginated<EncounterRow>>(`/encounters${qs(params)}`),
    placeholderData: (p) => p,
    enabled: view === 'all',
  });
  // How many in each status (same search and "only mine"), for the status buttons.
  const countParams = { q: params.q, mine: params.mine, page: 1, pageSize: 1 };
  const countQueries = useQueries({
    queries: STATUSES.map((st) => ({
      queryKey: ['encounters', 'count', st.key, countParams],
      queryFn: () => api.get<Paginated<EncounterRow>>(`/encounters${qs({ ...countParams, status: st.key })}`),
      enabled: view === 'all',
      staleTime: 15_000,
    })),
  });
  const counts: Partial<Record<string, number>> = Object.fromEntries(STATUSES.map((st, i) => [st.key, countQueries[i].data?.meta.total]));
  return (
    <>
      <PageHeader
        help="consultation"
        title="Consultations"
        description={view === 'today' ? 'Patients expected today and waiting to be seen — start a consultation from here' : 'Consultations and whether their notes are finished'}
        actions={
          can('clinical.write') && (
            <Button size="sm" onClick={() => setStart(true)}>
              <Plus /> New visit or consultation
            </Button>
          )
        }
      />
      <div className={cn(tabListClass, 'mb-4 w-fit')} role="tablist" aria-label="Consultations">
        <button type="button" role="tab" aria-selected={view === 'today'} className={tabTriggerClass(view === 'today')} onClick={() => url.set({ view: undefined })}>
          <CalendarClock className="h-4 w-4" /> Today’s patients
          {todayCount > 0 && <span className="ml-1 rounded-full bg-primary/15 px-1.5 text-xs font-semibold tabular text-primary">{todayCount}</span>}
        </button>
        <button type="button" role="tab" aria-selected={view === 'all'} className={tabTriggerClass(view === 'all')} onClick={() => url.set({ view: 'all' })}>
          <ListChecks className="h-4 w-4" /> All consultations
        </button>
      </div>
      {view === 'today' ? (
        queue.isLoading ? (
          <LoadingRows />
        ) : queue.error ? (
          <ErrorState error={queue.error} onRetry={() => queue.refetch()} />
        ) : (
          <>
            <QueueBoard columns={['expected', 'waiting']} allowStart className="lg:grid-cols-2" />
            <p className="mt-2 text-right text-2xs text-muted-foreground">Refreshes every 30 seconds · waiting list sorted by triage priority, then arrival time</p>
          </>
        )
      ) : (
        <Card className="overflow-hidden">
          <div className="flex flex-col gap-3 border-b bg-muted/20 p-3 lg:flex-row lg:items-center">
            <div className={cn(tabListClass, 'w-fit')} role="radiogroup" aria-label="Status">
              {STATUSES.map((st) => {
                const on = params.status === st.key;
                const n = counts[st.key];
                return (
                  <button key={st.key} type="button" role="radio" aria-checked={on} className={tabTriggerClass(on)} onClick={() => url.set({ status: st.key === 'OPEN' ? undefined : st.key, page: 1 })}>
                    <span className={cn('h-2 w-2 rounded-full', st.dot)} aria-hidden />
                    {st.label}
                    {n !== undefined && <span className={cn('tabular text-xs', on ? 'text-foreground/70' : 'text-muted-foreground')}>{n}</span>}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center lg:justify-end">
              <SearchInput className="sm:max-w-xs lg:max-w-sm" value={params.q} onChange={(q) => url.set({ q, page: 1 })} placeholder="Patient, client or complaint" />
              <label className={cn('inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border px-3.5 text-sm transition-colors', params.mine === 'true' ? 'border-primary/40 bg-primary/[0.07] text-primary' : 'bg-background text-muted-foreground hover:text-foreground')}>
                <Switch checked={params.mine === 'true'} onCheckedChange={(v) => url.set({ mine: v ? 'true' : 'false', page: 1 })} aria-label="Only my consultations" />
                Only mine
              </label>
            </div>
          </div>
          <DataTable
            query={query}
            rowKey={(e) => e.id}
            onRowClick={(e) => router.push(`/consultations/${e.id}`)}
            page={params.page}
            pageSize={params.pageSize}
            onPage={(page) => url.set({ page })}
            onPageSize={(pageSize) => url.set({ pageSize, page: 1 })}
            empty={<EmptyState icon={Stethoscope} title="No consultations match" description={params.q ? 'Try another name, or clear the search.' : undefined} />}
            columns={[
              {
                key: 'patient',
                header: 'Patient',
                cell: (e) => {
                  const critical = e.patient.alerts.find((a) => a.severity === 'CRITICAL');
                  return (
                    <div className="flex min-w-[200px] items-center gap-3">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
                        <PawPrint className="h-[18px] w-[18px]" />
                      </span>
                      <div className="min-w-0">
                        <p className="flex items-center gap-2">
                          <Link href={`/consultations/${e.id}`} className="truncate font-semibold hover:text-primary" onClick={(ev) => ev.stopPropagation()}>
                            {e.patient.name}
                          </Link>
                          {critical && <AlertChip alert={critical} />}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {e.patient.species.name} · {e.client.displayName}
                        </p>
                      </div>
                    </div>
                  );
                },
              },
              {
                key: 'visit',
                header: 'Visit',
                cell: (e) => (
                  <div className="grid max-w-[280px] gap-1">
                    <span className="w-fit rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-foreground/80">{enumLabel(e.type)}</span>
                    {e.chiefComplaint && <p className="truncate text-xs text-muted-foreground">{e.chiefComplaint}</p>}
                  </div>
                ),
              },
              {
                key: 'dx',
                header: 'Diagnoses',
                cell: (e) =>
                  e.diagnoses.length ? (
                    <div className="flex max-w-[240px] flex-wrap gap-1">
                      {e.diagnoses.slice(0, 2).map((d) => (
                        <span key={d.id} className="max-w-[160px] truncate rounded-md border bg-background px-2 py-0.5 text-xs" title={d.term}>
                          {d.term}
                        </span>
                      ))}
                      {e.diagnoses.length > 2 && <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">+{e.diagnoses.length - 2}</span>}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground/70">Not yet</span>
                  ),
              },
              {
                key: 'clin',
                header: 'Vet',
                cell: (e) =>
                  e.clinician ? (
                    <span className="flex items-center gap-2 whitespace-nowrap text-sm">
                      <Avatar name={e.clinician.name.replace(/^Dr\.?\s+/i, '')} className="h-7 w-7 text-[10px]" />
                      {e.clinician.name}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  ),
              },
              {
                key: 'when',
                header: 'Started',
                cell: (e) => (
                  <div className="whitespace-nowrap">
                    <p className="text-sm">{whenLabel(e.startedAt, tz)}</p>
                    <p className="text-xs text-muted-foreground">{fmtRelative(e.startedAt)}</p>
                  </div>
                ),
              },
              {
                key: 'notes',
                header: 'Notes',
                cell: (e) => {
                  const n = NOTES[e.noteStatus];
                  return (
                    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium', n.text)}>
                      <span className={cn('h-2 w-2 rounded-full', n.dot)} aria-hidden />
                      {n.label}
                    </span>
                  );
                },
              },
              {
                key: 'status',
                header: 'Status',
                cell: (e) => {
                  const st = STATUSES.find((x) => x.key === e.status);
                  return (
                    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold', st?.pill ?? 'bg-muted text-muted-foreground')}>
                      <span className={cn('h-1.5 w-1.5 rounded-full', st?.dot ?? 'bg-muted-foreground')} aria-hidden />
                      {enumLabel(e.status)}
                    </span>
                  );
                },
              },
              { key: 'go', header: '', className: 'w-8', cell: () => <ChevronRight className="h-4 w-4 text-muted-foreground/60" aria-hidden /> },
            ]}
          />
        </Card>
      )}
      {/* Start a consultation: find the owner and animal (or register them), then start — or queue or book instead. */}
      <NewVisitDialog open={start} onOpenChange={setStart} initialAction="consult" onBook={(p) => setBookFor(p)} />
      <BookingDialog open={!!bookFor} onOpenChange={(o) => !o && setBookFor(null)} defaults={bookFor ? { patient: bookFor } : undefined} />
    </>
  );
}

export default function ConsultationsPage() {
  return (
    <RequirePermission anyOf={['clinical.read']}>
      <Suspense>
        <ConsultationsList />
      </Suspense>
    </RequirePermission>
  );
}
