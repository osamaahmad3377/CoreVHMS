'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { enumLabel } from '@vcms/shared';
import { Baby, CalendarPlus, ClipboardList, Edit, MapPin, Milk, Plus, Printer, Syringe, Users } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { useConfirm } from '@/components/confirm';
import { DataTable } from '@/components/data-table';
import { OutbreakStatusBadge, ReproBadge, VisitStatusBadge, WithdrawalChips } from '@/components/livestock/badges';
import { FarmDialog, GroupDialog } from '@/components/livestock/farm-dialogs';
import { BreedingDialog, GroupTreatmentDialog, OutbreakDialog, ProductionDialog, ScheduleVisitDialog } from '@/components/livestock/record-dialogs';
import { DescriptionList, EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { AttachmentsPanel } from '@/components/shared/attachments-panel';
import { Stat } from '@/components/stat';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useUrlState } from '@/hooks/use-url-state';
import { api, qs } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { FarmDetail, FarmReport, FertilityRow, FieldVisitRow, GroupTreatmentRow, MovementRow, OutbreakRow, ProductionRow, WithdrawalBoardRow } from '@/lib/types';

const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);

function Groups({ farm, canWrite }: { farm: FarmDetail; canWrite: boolean }) {
  const [adding, setAdding] = useState(false);
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Herds, flocks & batches</CardTitle>
        {canWrite && <Button size="sm" onClick={() => setAdding(true)}><Plus /> New group</Button>}
      </CardHeader>
      {farm.groups.length ? (
        <ul className="divide-y">
          {farm.groups.map((g) => (
            <li key={g.id}>
              <Link href={`/livestock/groups/${g.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{g.name} <span className="text-xs font-normal text-muted-foreground">· {enumLabel(g.kind)} · {g.species.name} · {enumLabel(g.purpose)}</span></p>
                  <p className="text-xs text-muted-foreground">{g.tracksIndividuals ? 'Individually registered' : `Batch${g.placedOn ? `, placed ${fmtDate(g.placedOn)} (day ${g.ageDays})` : ''}`}{g.location ? ` · ${g.location}` : ''}</p>
                </div>
                <span className="text-right"><b className="tabular text-lg">{g.population}</b><span className="block text-xs text-muted-foreground">head</span></span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <CardContent><EmptyState icon={Users} title="No groups yet" description="Create a herd, flock or batch, then add the animals." /></CardContent>
      )}
      {farm.unassignedAnimals > 0 && <p className="border-t px-4 py-2 text-xs text-muted-foreground">{farm.unassignedAnimals} animal(s) on this farm are not in a group.</p>}
      <GroupDialog open={adding} onOpenChange={setAdding} farmId={farm.id} />
    </Card>
  );
}

function Breeding({ farm, canWrite }: { farm: FarmDetail; canWrite: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['fertility', farm.id], queryFn: () => api.get<FertilityRow[]>(`/farms/${farm.id}/fertility`) });
  const males = useQuery({ queryKey: ['farm-males', farm.id], queryFn: async () => (await Promise.all(farm.groups.filter((g) => g.tracksIndividuals).map((g) => api.get<{ animals: { id: string; name: string; sex: string; tag: string | null }[] }>(`/animal-groups/${g.id}`)))).flatMap((g) => g.animals.filter((a) => a.sex.startsWith('MALE'))) });
  const [female, setFemale] = useState<{ id: string; name: string } | null>(null);
  const [type, setType] = useState('HEAT');
  const counts = useMemo(() => (q.data ?? []).reduce<Record<string, number>>((m, r) => ({ ...m, [r.state]: (m[r.state] ?? 0) + 1 }), {}), [q.data]);
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {(['OPEN', 'SERVED', 'PREGNANT', 'DUE_SOON', 'OVERDUE'] as const).map((s) => <Card key={s} className="p-3"><ReproBadge state={s} /><p className="mt-1 text-2xl font-semibold tabular">{counts[s] ?? 0}</p></Card>)}
      </div>
      <Card>
        <DataTable
          query={q}
          rowKey={(r) => r.id}
          empty={<EmptyState icon={Baby} title="No breeding females on this farm" />}
          columns={[
            { key: 'animal', header: 'Female', cell: (r) => <div><Link href={`/patients/${r.id}?tab=farm`} className="font-medium hover:underline">{r.name}</Link><p className="text-xs text-muted-foreground">{r.tag ?? r.patientNo}{r.group ? ` · ${r.group.name}` : ''}</p></div> },
            { key: 'state', header: 'Status', cell: (r) => <ReproBadge state={r.state} /> },
            { key: 'due', header: 'Due', cell: (r) => <span className="text-sm">{r.expectedDueDate ? fmtDate(r.expectedDueDate) : '—'}</span> },
            { key: 'last', header: 'Last service / heat', cell: (r) => <span className="text-xs text-muted-foreground">{r.lastService ? `Served ${fmtDate(r.lastService)}` : r.lastHeat ? `Heat ${fmtDate(r.lastHeat)}` : '—'}</span> },
            { key: 'birth', header: 'Since last birth', cell: (r) => <span className="text-xs text-muted-foreground">{r.daysSinceBirth != null ? `${r.daysSinceBirth} days` : '—'}</span> },
            {
              key: 'act', header: '', cell: (r) => canWrite && (
                <span className="flex justify-end gap-1">
                  <Button size="sm" variant="outline" onClick={() => { setType(r.state === 'SERVED' ? 'PREGNANCY_CHECK' : r.state === 'DUE_SOON' || r.state === 'OVERDUE' ? 'BIRTH' : r.state === 'PREGNANT' ? 'PREGNANCY_CHECK' : 'HEAT'); setFemale(r); }}>Record</Button>
                </span>
              ),
            },
          ]}
        />
      </Card>
      <BreedingDialog open={!!female} onOpenChange={(o) => !o && setFemale(null)} female={female} males={males.data ?? []} defaultType={type} onDone={() => { qc.invalidateQueries({ queryKey: ['fertility', farm.id] }); qc.invalidateQueries({ queryKey: ['farm', farm.id] }); }} />
    </div>
  );
}

function Production({ farm, canWrite }: { farm: FarmDetail; canWrite: boolean }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [from, setFrom] = useState(daysAgo(30));
  const [recording, setRecording] = useState(false);
  const daily = useQuery({ queryKey: ['production', 'daily', farm.id, from], queryFn: () => api.get<Record<string, number | string>[]>(`/farms/${farm.id}/daily-production${qs({ from })}`) });
  const rows = useQuery({ queryKey: ['production', farm.id, from], queryFn: () => api.get<ProductionRow[]>(`/production${qs({ farmId: farm.id, from })}`) });
  const voidM = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.post(`/production/${id}/void`, { reason }),
    onSuccess: () => { toast.success('Record voided'); qc.invalidateQueries({ queryKey: ['production'] }); qc.invalidateQueries({ queryKey: ['farm', farm.id] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const kinds = [...new Set((daily.data ?? []).flatMap((d) => Object.keys(d).filter((k) => k !== 'date')))];
  const colors: Record<string, string> = { MILK: '#2563eb', EGGS: '#ca8a04', FEED: '#16a34a', MORTALITY: '#dc2626', BATCH_WEIGHT: '#7c3aed', WATER: '#0891b2' };
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-xs text-muted-foreground">From<Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" /></label>
        {canWrite && <Button size="sm" className="ml-auto" onClick={() => setRecording(true)}><Plus /> Record production</Button>}
      </div>
      <Card className="p-4">
        {daily.data?.length ? (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={daily.data}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              {kinds.map((k) => <Line key={k} type="monotone" dataKey={k} name={enumLabel(k)} stroke={colors[k] ?? '#64748b'} dot={false} strokeWidth={2} />)}
            </LineChart>
          </ResponsiveContainer>
        ) : <EmptyState icon={Milk} title="No production recorded in this period" />}
      </Card>
      <Card>
        <DataTable
          query={rows}
          rowKey={(r) => r.id}
          empty={<EmptyState title="No records" />}
          columns={[
            { key: 'date', header: 'Date', cell: (r) => <span className="text-sm">{fmtDate(r.recordedOn)}{r.session ? ` ${r.session}` : ''}</span> },
            { key: 'kind', header: 'Record', cell: (r) => <span className="text-sm">{enumLabel(r.kind)}</span> },
            { key: 'what', header: 'For', cell: (r) => <span className="text-sm">{r.patient?.name ?? r.group?.name ?? 'Whole farm'}</span> },
            { key: 'qty', header: 'Quantity', cell: (r) => <span className="text-sm tabular">{r.quantity} {r.unit}</span> },
            { key: 'by', header: 'By', cell: (r) => <span className="text-xs text-muted-foreground">{r.recordedByName}</span> },
            { key: 'act', header: '', cell: (r) => canWrite && <Button size="sm" variant="ghost" onClick={async () => { const c = await confirm({ title: 'Void this record?', description: 'It stays in the history, marked void. Enter the correct figure as a new record.', confirmLabel: 'Void', requireReason: true }); if (c.confirmed) voidM.mutate({ id: r.id, reason: c.reason! }); }}>Void</Button> },
          ]}
        />
      </Card>
      <ProductionDialog open={recording} onOpenChange={setRecording} farmId={farm.id} groups={farm.groups} onDone={() => qc.invalidateQueries({ queryKey: ['farm', farm.id] })} />
    </div>
  );
}

function Health({ farm, canWrite }: { farm: FarmDetail; canWrite: boolean }) {
  const qc = useQueryClient();
  const [treating, setTreating] = useState(false);
  const [outbreak, setOutbreak] = useState<OutbreakRow | null | 'new'>(null);
  const treatments = useQuery({ queryKey: ['group-treatments', farm.id], queryFn: () => api.get<GroupTreatmentRow[]>(`/group-treatments?farmId=${farm.id}`) });
  const outbreaks = useQuery({ queryKey: ['outbreaks', farm.id], queryFn: () => api.get<OutbreakRow[]>(`/outbreaks?farmId=${farm.id}`) });
  const withdrawals = useQuery({ queryKey: ['withdrawals', farm.id], queryFn: () => api.get<WithdrawalBoardRow[]>(`/livestock/withdrawals?farmId=${farm.id}`) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['group-treatments', farm.id] }); qc.invalidateQueries({ queryKey: ['withdrawals'] }); qc.invalidateQueries({ queryKey: ['outbreaks'] }); qc.invalidateQueries({ queryKey: ['farm', farm.id] }); };
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between"><CardTitle>Under withdrawal</CardTitle></CardHeader>
        <DataTable
          query={withdrawals}
          rowKey={(w) => w.id}
          empty={<p className="px-4 pb-4 text-sm text-muted-foreground">No animals or batches are under withdrawal.</p>}
          columns={[
            { key: 's', header: 'Animal / batch', cell: (w) => <span className="text-sm font-medium">{w.subject.name} <span className="text-xs font-normal text-muted-foreground">{w.subject.tag}</span></span> },
            { key: 'p', header: 'Product', cell: (w) => <span className="text-sm">{w.product}</span> },
            { key: 'c', header: 'Do not use', cell: (w) => <WithdrawalChips w={w} /> },
          ]}
        />
      </Card>
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Group treatments & campaigns</CardTitle>
          {canWrite && <Button size="sm" onClick={() => setTreating(true)}><Syringe /> Treat a group</Button>}
        </CardHeader>
        <DataTable
          query={treatments}
          rowKey={(t) => t.id}
          empty={<p className="px-4 pb-4 text-sm text-muted-foreground">No group treatments recorded.</p>}
          columns={[
            { key: 'when', header: 'When', cell: (t) => <span className="text-sm">{fmtDate(t.administeredAt)}</span> },
            { key: 'what', header: 'Treatment', cell: (t) => <div><span className="text-sm font-medium">{t.productName}</span><p className="text-xs text-muted-foreground">{enumLabel(t.kind)}{t.dosePerHead ? ` · ${t.dosePerHead}` : ''}{t.route ? ` · ${t.route}` : ''}{t.batchNumber ? ` · batch ${t.batchNumber}` : ''}</p></div> },
            { key: 'grp', header: 'Group', cell: (t) => <span className="text-sm">{t.group?.name ?? 'Farm'} · {t.headCount} head</span> },
            { key: 'wd', header: 'Withdrawal', cell: (t) => (t.meatClearAt || t.milkClearAt || t.eggClearAt ? <span className="text-xs">{[t.meatClearAt && `meat ${fmtDate(t.meatClearAt)}`, t.milkClearAt && `milk ${fmtDate(t.milkClearAt)}`, t.eggClearAt && `eggs ${fmtDate(t.eggClearAt)}`].filter(Boolean).join(' · ')}</span> : <span className="text-xs text-muted-foreground">None configured</span>) },
            { key: 'by', header: 'By', cell: (t) => <span className="text-xs text-muted-foreground">{t.administeredByName}</span> },
          ]}
        />
      </Card>
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Disease outbreaks</CardTitle>
          {canWrite && <Button size="sm" variant="outline" onClick={() => setOutbreak('new')}><Plus /> Report outbreak</Button>}
        </CardHeader>
        <DataTable
          query={outbreaks}
          rowKey={(o) => o.id}
          onRowClick={canWrite ? (o) => setOutbreak(o) : undefined}
          empty={<p className="px-4 pb-4 text-sm text-muted-foreground">No outbreaks recorded on this farm.</p>}
          columns={[
            { key: 'd', header: 'Disease', cell: (o) => <div><span className="text-sm font-medium">{o.disease}</span>{o.notifiable && <Badge variant="destructive" className="ml-2">Notifiable</Badge>}<p className="text-xs text-muted-foreground">{o.outbreakNo}{o.group ? ` · ${o.group.name}` : ''}</p></div> },
            { key: 'n', header: 'Affected / dead', cell: (o) => <span className="text-sm tabular">{o.affectedCount} / {o.deathCount}</span> },
            { key: 'f', header: 'First seen', cell: (o) => <span className="text-sm">{fmtDate(o.firstSeenOn)}</span> },
            { key: 's', header: 'Status', cell: (o) => <OutbreakStatusBadge status={o.status} /> },
          ]}
        />
      </Card>
      <GroupTreatmentDialog open={treating} onOpenChange={setTreating} farmId={farm.id} groups={farm.groups} onDone={refresh} />
      <OutbreakDialog open={!!outbreak} onOpenChange={(o) => !o && setOutbreak(null)} farmId={farm.id} groups={farm.groups} outbreak={outbreak === 'new' ? null : outbreak} onDone={refresh} />
    </div>
  );
}

function Visits({ farm, canWrite }: { farm: FarmDetail; canWrite: boolean }) {
  const router = useRouter();
  const [scheduling, setScheduling] = useState(false);
  const q = useQuery({ queryKey: ['field-visits', 'farm', farm.id], queryFn: () => api.get<FieldVisitRow[]>(`/field-visits?farmId=${farm.id}`) });
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Field visits</CardTitle>
        {canWrite && <Button size="sm" onClick={() => setScheduling(true)}><CalendarPlus /> Schedule visit</Button>}
      </CardHeader>
      <DataTable
        query={q}
        rowKey={(v) => v.id}
        onRowClick={(v) => router.push(`/livestock/visits/${v.id}`)}
        empty={<p className="px-4 pb-4 text-sm text-muted-foreground">No visits yet.</p>}
        columns={[
          { key: 'w', header: 'When', cell: (v) => <span className="text-sm">{fmtDateTime(v.scheduledAt)}</span> },
          { key: 'p', header: 'Purpose', cell: (v) => <span className="text-sm">{v.purpose}<span className="block text-xs text-muted-foreground">{v.visitNo}</span></span> },
          { key: 'v', header: 'Vet', cell: (v) => <span className="text-sm">{v.clinician?.name ?? '—'}</span> },
          { key: 's', header: 'Status', cell: (v) => <VisitStatusBadge status={v.status} /> },
        ]}
      />
      <ScheduleVisitDialog open={scheduling} onOpenChange={setScheduling} farm={farm} onDone={(id) => router.push(`/livestock/visits/${id}`)} />
    </Card>
  );
}

function Report({ farm }: { farm: FarmDetail }) {
  const { currency } = useSession();
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(daysAgo(0));
  const q = useQuery({ queryKey: ['farm-report', farm.id, from, to], queryFn: () => api.get<FarmReport>(`/farms/${farm.id}/report${qs({ from: new Date(from).toISOString(), to: new Date(`${to}T23:59:59`).toISOString() })}`) });
  const r = q.data;
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-2 print:hidden">
        <label className="grid gap-1 text-xs text-muted-foreground">From<Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" /></label>
        <label className="grid gap-1 text-xs text-muted-foreground">To<Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" /></label>
        <Button size="sm" variant="outline" className="ml-auto" onClick={() => window.print()}><Printer /> Print</Button>
      </div>
      {q.isLoading ? <LoadingRows /> : q.error ? <ErrorState error={q.error} /> : r && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Animals on farm" value={r.census.individuals + r.census.batchHead} hint={r.census.bySpecies.map((s) => `${s.total} ${s.species.toLowerCase()}`).join(', ') || undefined} />
            <Stat label="Mortality" value={r.mortalityRatePct != null ? `${r.mortalityRatePct}%` : '—'} hint={`${r.movements.deaths} died · ${r.movements.culls} culled`} tone={r.movements.deaths ? 'warning' : 'default'} />
            <Stat label="Pregnancy rate" value={r.breeding.pregnancyRatePct != null ? `${r.breeding.pregnancyRatePct}%` : '—'} hint={`${r.breeding.pregnant} of ${r.breeding.pregnancyChecks} checks`} />
            <Stat label="Milk" value={`${r.production.milkLitres} L`} hint={r.production.avgMilkPerAnimalDay != null ? `${r.production.avgMilkPerAnimalDay} L per animal per day` : 'Record per animal for averages'} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card><CardHeader><CardTitle>Herd changes</CardTitle></CardHeader><CardContent><DescriptionList items={[
              { label: 'Born alive', value: r.movements.births },
              { label: 'Purchased', value: r.movements.purchased },
              { label: 'Sold / transferred', value: r.movements.sold },
              { label: 'Sales value', value: fmtMoney(r.movements.salesValueMinor, currency) },
              { label: 'Died', value: r.movements.deaths },
              { label: 'Culled', value: r.movements.culls },
            ]} /></CardContent></Card>
            <Card><CardHeader><CardTitle>Breeding</CardTitle></CardHeader><CardContent><DescriptionList items={[
              { label: 'Services / inseminations', value: r.breeding.services },
              { label: 'Pregnancy checks', value: `${r.breeding.pregnancyChecks} (${r.breeding.pregnant} pregnant)` },
              { label: 'Births', value: `${r.breeding.births} (${r.breeding.bornAlive} alive, ${r.breeding.stillborn} stillborn)` },
              { label: 'Abortions', value: r.breeding.abortions },
            ]} /></CardContent></Card>
            <Card><CardHeader><CardTitle>Production</CardTitle></CardHeader><CardContent><DescriptionList items={[
              { label: 'Milk', value: `${r.production.milkLitres} L` },
              { label: 'Eggs', value: r.production.eggs },
              { label: 'Feed', value: `${r.production.feedKg} kg` },
              { label: 'Batch mortality', value: r.production.batchMortality },
            ]} /></CardContent></Card>
            <Card><CardHeader><CardTitle>Health</CardTitle></CardHeader><CardContent><DescriptionList items={[
              { label: 'Group treatments', value: r.health.treatments },
              { label: 'Under withdrawal now', value: r.health.activeWithdrawals },
              { label: 'Open outbreaks', value: r.health.openOutbreaks },
              { label: 'New outbreaks', value: r.health.newOutbreaks.map((o) => `${o.disease} (${o.affectedCount} affected)`).join('; ') || 'None' },
            ]} /></CardContent></Card>
          </div>
          {!!r.batches.length && (
            <Card>
              <CardHeader><CardTitle>Batches</CardTitle></CardHeader>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr><th className="p-2">Batch</th><th className="p-2">Age</th><th className="p-2">Placed</th><th className="p-2">Now</th><th className="p-2">Cumulative mortality</th><th className="p-2">Deaths in period</th><th className="p-2">Feed (kg)</th><th className="p-2">Eggs</th><th className="p-2">Avg weight</th></tr></thead>
                  <tbody>{r.batches.map((b) => <tr key={b.id} className="border-t"><td className="p-2 font-medium">{b.name}<span className="block text-xs font-normal text-muted-foreground">{b.species} · {enumLabel(b.purpose)}{b.status === 'CLOSED' ? ' · closed' : ''}</span></td><td className="p-2">{b.ageDays != null ? `${b.ageDays} d` : '—'}</td><td className="p-2 tabular">{b.initialCount ?? '—'}</td><td className="p-2 tabular">{b.headCount}</td><td className="p-2">{b.cumulativeMortalityPct != null ? `${b.cumulativeMortalityPct}%` : '—'}</td><td className="p-2 tabular">{b.mortalityInPeriod}</td><td className="p-2 tabular">{b.feedKg}</td><td className="p-2 tabular">{b.eggs}</td><td className="p-2">{b.latestAvgWeightKg != null ? `${b.latestAvgWeightKg} kg` : '—'}</td></tr>)}</tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function History({ farm }: { farm: FarmDetail }) {
  const q = useQuery({ queryKey: ['movements', farm.id], queryFn: () => api.get<MovementRow[]>(`/livestock/movements?farmId=${farm.id}`) });
  return (
    <Card>
      <DataTable
        query={q}
        rowKey={(m) => m.id}
        empty={<EmptyState icon={ClipboardList} title="No movements recorded" />}
        columns={[
          { key: 'w', header: 'When', cell: (m) => <span className="text-sm">{fmtDateTime(m.occurredAt)}</span> },
          { key: 't', header: 'Event', cell: (m) => <Badge variant={m.type === 'DEATH' || m.type === 'CULL' ? 'destructive' : m.type === 'SALE' || m.type === 'TRANSFER' ? 'warning' : 'secondary'}>{enumLabel(m.type)}</Badge> },
          { key: 'a', header: 'Animal(s)', cell: (m) => (m.patient ? <Link href={`/patients/${m.patient.id}`} className="text-sm hover:underline">{m.patient.name}</Link> : <span className="text-sm">{m.headCount} head</span>) },
          { key: 'f', header: 'From → to', cell: (m) => <span className="text-xs text-muted-foreground">{m.fromGroup?.name ?? m.fromFarm?.name ?? '—'} → {m.toGroup?.name ?? m.toFarm?.name ?? (m.counterparty || '—')}</span> },
          { key: 'r', header: 'Details', cell: (m) => <span className="text-xs">{[m.counterparty, m.reason].filter(Boolean).join(' · ')}</span> },
          { key: 'b', header: 'By', cell: (m) => <span className="text-xs text-muted-foreground">{m.recordedByName}</span> },
        ]}
      />
    </Card>
  );
}

function Farm() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const url = useUrlState();
  const [editing, setEditing] = useState(false);
  const q = useQuery({ queryKey: ['farm', id], queryFn: () => api.get<FarmDetail>(`/farms/${id}`) });
  if (q.isLoading) return <LoadingRows />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const farm = q.data;
  const canWrite = can('livestock.write');
  const tab = url.get('tab', 'groups');
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Livestock & farms', href: '/livestock' }, { label: farm.farmNo }]}
        title={farm.name}
        help="livestock"
        description={<span className="flex flex-wrap items-center gap-x-3 gap-y-1"><Link href={`/clients/${farm.client.id}`} className="hover:underline">{farm.client.displayName}</Link>{farm.client.mobilePhone && <span>{farm.client.mobilePhone}</span>}{farm.district && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{farm.district}</span>}{farm.latitude != null && farm.longitude != null && <a className="text-primary hover:underline" target="_blank" rel="noreferrer" href={`https://www.openstreetmap.org/?mlat=${farm.latitude}&mlon=${farm.longitude}#map=15/${farm.latitude}/${farm.longitude}`}>Map</a>}{farm.status === 'INACTIVE' && <Badge variant="secondary">Inactive</Badge>}</span>}
        actions={canWrite && <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Edit /> Edit farm</Button>}
      />
      <Tabs value={tab} onValueChange={(v) => url.set({ tab: v })}>
        <TabsList>
          <TabsTrigger value="groups">Animals & groups</TabsTrigger>
          <TabsTrigger value="breeding">Breeding</TabsTrigger>
          <TabsTrigger value="production">Production</TabsTrigger>
          <TabsTrigger value="health">Health & withdrawals</TabsTrigger>
          <TabsTrigger value="visits">Visits</TabsTrigger>
          <TabsTrigger value="report">Report</TabsTrigger>
          <TabsTrigger value="history">Movements</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
        </TabsList>
        <TabsContent value="groups"><Groups farm={farm} canWrite={canWrite} /></TabsContent>
        <TabsContent value="breeding"><Breeding farm={farm} canWrite={canWrite} /></TabsContent>
        <TabsContent value="production"><Production farm={farm} canWrite={canWrite} /></TabsContent>
        <TabsContent value="health"><Health farm={farm} canWrite={canWrite} /></TabsContent>
        <TabsContent value="visits"><Visits farm={farm} canWrite={canWrite} /></TabsContent>
        <TabsContent value="report"><Report farm={farm} /></TabsContent>
        <TabsContent value="history"><History farm={farm} /></TabsContent>
        <TabsContent value="documents"><Card className="p-4"><AttachmentsPanel entityType="Farm" entityId={farm.id} canWrite={canWrite} /></Card></TabsContent>
      </Tabs>
      {farm.notes && tab === 'groups' && <p className="mt-4 text-sm text-muted-foreground">Notes: {farm.notes}</p>}
      <FarmDialog open={editing} onOpenChange={setEditing} farm={farm} />
    </>
  );
}

export default function FarmPage() {
  return (
    <RequirePermission anyOf={['livestock.read']}>
      <Suspense>
        <Farm />
      </Suspense>
    </RequirePermission>
  );
}

