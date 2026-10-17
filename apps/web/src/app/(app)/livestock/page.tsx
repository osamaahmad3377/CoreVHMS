'use client';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Baby, CalendarClock, Milk, Plus, ShieldAlert, Tractor } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Suspense, useState } from 'react';
import { DataTable } from '@/components/data-table';
import { FarmDialog } from '@/components/livestock/farm-dialogs';
import { OutbreakStatusBadge, ReproBadge, VisitStatusBadge, WithdrawalChips } from '@/components/livestock/badges';
import { EmptyState, PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { SearchInput } from '@/components/search-input';
import { Stat } from '@/components/stat';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useUrlState } from '@/hooks/use-url-state';
import { api, qs } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtNumber } from '@/lib/format';
import { useSession } from '@/lib/session';
import { shiftDate, todayIn, zonedInstant } from '@/lib/time';
import type { BirthDueRow, FarmRow, FieldVisitRow, OutbreakRow, WithdrawalBoardRow } from '@/lib/types';
import { cn } from '@/lib/utils';

const TABS = [
  { key: 'farms', label: 'Farms' },
  { key: 'visits', label: 'Field visits' },
  { key: 'withdrawals', label: 'Withdrawals' },
  { key: 'births', label: 'Births due' },
  { key: 'outbreaks', label: 'Outbreaks' },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const sameName = (a: string, b: string) => norm(a) === norm(b);

function Farms() {
  const router = useRouter();
  const url = useUrlState();
  const q = url.get('q');
  const farms = useQuery({ queryKey: ['farms', q], queryFn: () => api.get<FarmRow[]>(`/farms${qs({ q: q || undefined })}`) });
  return (
    <Card>
      <div className="border-b p-3"><SearchInput value={q} onChange={(v) => url.set({ q: v })} placeholder="Search farms, owners, districts…" /></div>
      <DataTable
        query={farms}
        rowKey={(f) => f.id}
        onRowClick={(f) => router.push(`/livestock/farms/${f.id}`)}
        empty={<EmptyState icon={Tractor} title="No farms yet" description="Add a farm for a farming client to keep herds, breeding, production and visits together." />}
        columns={[
          { key: 'name', header: 'Farm', cell: (f) => <div><Link href={`/livestock/farms/${f.id}`} className="font-medium hover:underline">{f.name}</Link><p className="text-xs text-muted-foreground">{f.farmNo}{f.district ? ` · ${f.district}` : ''}</p></div> },
          {
            key: 'owner',
            header: 'Owner',
            // A farm registered as its own client account would just repeat the farm name — show the contact number only.
            cell: (f) => (
              <span className="text-sm">
                {sameName(f.client.displayName, f.name) ? <span className="text-muted-foreground">Farm’s own account</span> : f.client.displayName}
                {f.client.mobilePhone && <span className="block text-xs text-muted-foreground">{f.client.mobilePhone}</span>}
              </span>
            ),
          },
          { key: 'animals', header: 'Animals', cell: (f) => <span className="whitespace-nowrap text-sm tabular">{fmtNumber(f.animalCount ?? 0)}<span className="text-xs text-muted-foreground"> in {fmtNumber(f.groupCount ?? 0)} group{f.groupCount === 1 ? '' : 's'}</span></span> },
          { key: 'alerts', header: 'Alerts', cell: (f) => <span className="flex flex-wrap gap-1">{!!f.openOutbreaks && <Badge variant="destructive">{fmtNumber(f.openOutbreaks)} outbreak{f.openOutbreaks === 1 ? '' : 's'}</Badge>}{!!f.animalsUnderWithdrawal && <Badge variant="warning">{fmtNumber(f.animalsUnderWithdrawal)} under withdrawal</Badge>}</span> },
        ]}
      />
    </Card>
  );
}

function Visits() {
  const router = useRouter();
  const { session } = useSession();
  const tz = session.branch?.timezone ?? 'UTC';
  const url = useUrlState();
  const range = url.get('range', 'upcoming');
  const today = todayIn(tz);
  const params = range === 'upcoming' ? { from: zonedInstant(today, 0, tz).toISOString(), status: 'SCHEDULED,IN_PROGRESS' } : { from: zonedInstant(shiftDate(today, -30), 0, tz).toISOString(), to: zonedInstant(shiftDate(today, 1), 0, tz).toISOString() };
  const q = useQuery({ queryKey: ['field-visits', params], queryFn: () => api.get<FieldVisitRow[]>(`/field-visits${qs(params)}`) });
  return (
    <Card>
      <div className="flex gap-1 border-b p-3">
        {[['upcoming', 'Upcoming'], ['past', 'Last 30 days']].map(([k, l]) => <button key={k} onClick={() => url.set({ range: k })} className={cn('rounded-md px-3 py-1.5 text-sm', range === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}>{l}</button>)}
      </div>
      <DataTable
        query={q}
        rowKey={(v) => v.id}
        onRowClick={(v) => router.push(`/livestock/visits/${v.id}`)}
        empty={<EmptyState icon={CalendarClock} title="No field visits" description="Schedule visits from a farm’s page." />}
        columns={[
          { key: 'when', header: 'When', cell: (v) => <span className="whitespace-nowrap text-sm">{fmtDateTime(v.scheduledAt)}</span> },
          { key: 'farm', header: 'Farm', cell: (v) => <div><Link href={`/livestock/visits/${v.id}`} className="font-medium hover:underline">{v.farm.name}</Link><p className="text-xs text-muted-foreground">{v.visitNo} · {v.farm.district ?? v.client.displayName}</p></div> },
          { key: 'purpose', header: 'Purpose', cell: (v) => <span className="text-sm">{v.purpose}</span> },
          { key: 'vet', header: 'Vet', cell: (v) => <span className="text-sm">{v.clinician?.name ?? '—'}</span> },
          { key: 'st', header: 'Status', cell: (v) => <VisitStatusBadge status={v.status} /> },
        ]}
      />
    </Card>
  );
}

function Withdrawals() {
  const q = useQuery({ queryKey: ['withdrawals'], queryFn: () => api.get<WithdrawalBoardRow[]>('/livestock/withdrawals') });
  return (
    <Card>
      <p className="border-b p-3 text-sm text-muted-foreground">Animals and batches whose meat, milk or eggs must not go into the food chain yet. Periods come from each product’s configured withdrawal and its source.</p>
      <DataTable
        query={q}
        rowKey={(w) => w.id}
        empty={<EmptyState icon={ShieldAlert} title="Nothing under withdrawal" description="All treated animals have cleared their withdrawal periods." />}
        columns={[
          { key: 'subject', header: 'Animal / batch', cell: (w) => <div>{w.subjectType === 'ANIMAL' ? <Link href={`/patients/${w.subject.id}`} className="font-medium hover:underline">{w.subject.name}</Link> : <span className="font-medium">{w.subject.name}</span>}<p className="text-xs text-muted-foreground">{w.subject.tag}</p></div> },
          { key: 'farm', header: 'Farm', cell: (w) => (w.farm ? <Link href={`/livestock/farms/${w.farm.id}`} className="text-sm hover:underline">{w.farm.name}</Link> : '—') },
          { key: 'product', header: 'Product', cell: (w) => <span className="text-sm">{w.product}<span className="block text-xs text-muted-foreground">treated {fmtDate(w.treatedAt)}</span></span> },
          { key: 'clear', header: 'Do not use', cell: (w) => <WithdrawalChips w={w} /> },
          { key: 'src', header: 'Source', cell: (w) => <span className="text-xs text-muted-foreground">{w.source}</span> },
        ]}
      />
    </Card>
  );
}

function Births() {
  const q = useQuery({ queryKey: ['births-due'], queryFn: () => api.get<BirthDueRow[]>('/livestock/births-due?days=60') });
  return (
    <Card>
      <DataTable
        query={q}
        rowKey={(b) => b.id}
        empty={<EmptyState icon={Baby} title="No births expected in the next 60 days" description="Due dates appear after a service, insemination or positive pregnancy check." />}
        columns={[
          { key: 'due', header: 'Expected', cell: (b) => <span className="whitespace-nowrap text-sm font-medium">{fmtDate(b.expectedDueDate)}</span> },
          { key: 'animal', header: 'Animal', cell: (b) => <div><Link href={`/patients/${b.id}?tab=farm`} className="font-medium hover:underline">{b.name}</Link><p className="text-xs text-muted-foreground">{b.tag ?? b.patientNo}</p></div> },
          { key: 'farm', header: 'Farm', cell: (b) => (b.farm ? <Link href={`/livestock/farms/${b.farm.id}`} className="text-sm hover:underline">{b.farm.name}</Link> : '—') },
          { key: 'state', header: 'Status', cell: (b) => <ReproBadge state={b.state} /> },
        ]}
      />
    </Card>
  );
}

function Outbreaks() {
  const router = useRouter();
  const q = useQuery({ queryKey: ['outbreaks', 'all'], queryFn: () => api.get<OutbreakRow[]>('/outbreaks') });
  return (
    <Card>
      <DataTable
        query={q}
        rowKey={(o) => o.id}
        onRowClick={(o) => router.push(`/livestock/farms/${o.farmId}?tab=health`)}
        empty={<EmptyState icon={AlertTriangle} title="No outbreaks recorded" />}
        columns={[
          { key: 'disease', header: 'Disease', cell: (o) => <div><span className="font-medium">{o.disease}</span>{o.notifiable && <Badge variant="destructive" className="ml-2">Notifiable</Badge>}<p className="text-xs text-muted-foreground">{o.outbreakNo}</p></div> },
          { key: 'farm', header: 'Farm', cell: (o) => <span className="text-sm">{o.farm.name}{o.group ? ` · ${o.group.name}` : ''}<span className="block text-xs text-muted-foreground">{o.farm.district}</span></span> },
          { key: 'counts', header: 'Affected / dead', cell: (o) => <span className="text-sm tabular">{fmtNumber(o.affectedCount)} / {fmtNumber(o.deathCount)}{o.populationAtRisk ? <span className="text-xs text-muted-foreground"> of {fmtNumber(o.populationAtRisk)}</span> : null}</span> },
          { key: 'seen', header: 'First seen', cell: (o) => <span className="text-sm">{fmtDate(o.firstSeenOn)}</span> },
          { key: 'st', header: 'Status', cell: (o) => <OutbreakStatusBadge status={o.status} /> },
        ]}
      />
    </Card>
  );
}

function Livestock() {
  const { can } = useSession();
  const url = useUrlState();
  const tab = url.get('tab', 'farms');
  const [creating, setCreating] = useState(false);
  const overview = useQuery({ queryKey: ['livestock-overview'], queryFn: () => api.get<{ farms: number; animals: number; batchHead: number; openOutbreaks: number; activeWithdrawals: number; birthsDue30Days: number }>('/livestock/overview') });
  const o = overview.data;
  return (
    <>
      <PageHeader
        title="Livestock & farms"
        help="livestock"
        description="Farms, herds and flocks, breeding, production, herd health, withdrawal periods and field visits."
        actions={can('livestock.write') && <Button size="sm" onClick={() => setCreating(true)}><Plus /> New farm</Button>}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Active farms" value={o ? fmtNumber(o.farms) : '—'} icon={Tractor} />
        <Stat label="Animals" value={o ? fmtNumber(o.animals + o.batchHead) : '—'} hint={o ? `${fmtNumber(o.animals)} registered · ${fmtNumber(o.batchHead)} in batches` : undefined} icon={Milk} />
        <Stat label="Under withdrawal" value={o ? fmtNumber(o.activeWithdrawals) : '—'} icon={ShieldAlert} tone={o?.activeWithdrawals ? 'warning' : 'default'} href="/livestock?tab=withdrawals" />
        <Stat label="Births due (30 days)" value={o ? fmtNumber(o.birthsDue30Days) : '—'} icon={Baby} href="/livestock?tab=births" />
        <Stat label="Open outbreaks" value={o ? fmtNumber(o.openOutbreaks) : '—'} icon={AlertTriangle} tone={o?.openOutbreaks ? 'danger' : 'default'} href="/livestock?tab=outbreaks" />
      </div>
      <div className="mb-4 flex gap-1 overflow-x-auto border-b" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => url.set({ tab: t.key, q: null, range: null })} className={cn('-mb-px whitespace-nowrap border-b-2 px-3 pb-2 pt-1 text-sm font-medium', tab === t.key ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>{t.label}</button>
        ))}
      </div>
      {tab === 'visits' ? <Visits /> : tab === 'withdrawals' ? <Withdrawals /> : tab === 'births' ? <Births /> : tab === 'outbreaks' ? <Outbreaks /> : <Farms />}
      <FarmDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}

export default function LivestockPage() {
  return (
    <RequirePermission anyOf={['livestock.read']}>
      <Suspense>
        <Livestock />
      </Suspense>
    </RequirePermission>
  );
}
