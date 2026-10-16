'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { enumLabel } from '@vcms/shared';
import { ArrowRightLeft, Baby, Lock, Milk, Plus, Skull, Syringe, Users } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { toast } from 'sonner';
import { useConfirm } from '@/components/confirm';
import { BulkAnimalsDialog, MovementDialog } from '@/components/livestock/farm-dialogs';
import { BreedingDialog, GroupTreatmentDialog, MilkSheetDialog, ProductionDialog } from '@/components/livestock/record-dialogs';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Stat } from '@/components/stat';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { api } from '@/lib/api';
import { fmtAge, fmtDate, fmtWeight } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { FarmDetail, GroupDetail, ProductionRow } from '@/lib/types';

function Group() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const canWrite = can('livestock.write');
  const q = useQuery({ queryKey: ['animal-group', id], queryFn: () => api.get<GroupDetail>(`/animal-groups/${id}`) });
  const farm = useQuery({ queryKey: ['farm', q.data?.farmId], queryFn: () => api.get<FarmDetail>(`/farms/${q.data!.farmId}`), enabled: !!q.data });
  const recent = useQuery({ queryKey: ['production', 'group', id], queryFn: () => api.get<ProductionRow[]>(`/production?groupId=${id}`), enabled: !!q.data });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<null | 'add' | 'move' | 'milk' | 'treat' | 'production'>(null);
  const [prodKind, setProdKind] = useState('MILK');
  const [breedFor, setBreedFor] = useState<{ id: string; name: string } | null>(null);
  const refresh = () => { setSelected(new Set()); qc.invalidateQueries({ queryKey: ['animal-group', id] }); qc.invalidateQueries({ queryKey: ['farm'] }); qc.invalidateQueries({ queryKey: ['production'] }); };
  const close = useMutation({
    mutationFn: (reason: string) => api.post(`/animal-groups/${id}/close`, { reason }),
    onSuccess: () => { toast.success('Group closed'); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  if (q.isLoading) return <LoadingRows />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const g = q.data;
  const groups = farm.data?.groups ?? [];
  const males = g.animals.filter((a) => a.sex.startsWith('MALE'));
  const allSelected = g.animals.length > 0 && selected.size === g.animals.length;
  const open = g.status === 'ACTIVE';
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Livestock & farms', href: '/livestock' }, { label: g.farm.name, href: `/livestock/farms/${g.farm.id}` }, { label: g.name }]}
        title={g.name}
        help="livestock"
        description={`${enumLabel(g.kind)} · ${g.species.name} · ${enumLabel(g.purpose)}${g.breedText ? ` · ${g.breedText}` : ''}${g.location ? ` · ${g.location}` : ''}`}
        actions={
          canWrite && open && (
            <>
              {g.tracksIndividuals && <Button size="sm" onClick={() => setDialog('add')}><Plus /> Add animals</Button>}
              <Button size="sm" variant="outline" onClick={() => setDialog('treat')}><Syringe /> Treat group</Button>
              {g.purpose === 'DAIRY' && g.tracksIndividuals && <Button size="sm" variant="outline" onClick={() => setDialog('milk')}><Milk /> Milk sheet</Button>}
              {!g.tracksIndividuals && <Button size="sm" variant="outline" onClick={() => setDialog('move')}><ArrowRightLeft /> Move / sell</Button>}
              <Button size="sm" variant="ghost" onClick={async () => { const c = await confirm({ title: `Close ${g.name}?`, description: 'Closed groups stay in reports but no longer take records. The group must be empty.', confirmLabel: 'Close group', requireReason: true }); if (c.confirmed) close.mutate(c.reason!); }}><Lock /> Close</Button>
            </>
          )
        }
      />
      {!open && <p className="mb-4 rounded-md bg-muted px-3 py-2 text-sm">This group is closed{g.closedReason ? `: ${g.closedReason}` : ''}.</p>}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={g.tracksIndividuals ? 'Animals' : 'Head count'} value={g.population} icon={Users} />
        {!g.tracksIndividuals && <Stat label="Placed" value={g.initialCount ?? '—'} hint={g.placedOn ? `${fmtDate(g.placedOn)} · day ${g.ageDays}` : undefined} />}
        {!g.tracksIndividuals && g.initialCount ? <Stat label="Cumulative losses" value={`${Math.round(((g.initialCount - g.headCount) / g.initialCount) * 1000) / 10}%`} hint={`${g.initialCount - g.headCount} head`} tone={g.initialCount - g.headCount > g.initialCount * 0.05 ? 'warning' : 'default'} /> : null}
        {g.tracksIndividuals && <Stat label="Females" value={g.animals.filter((a) => a.sex.startsWith('FEMALE')).length} />}
        {g.tracksIndividuals && <Stat label="Males" value={males.length} />}
      </div>

      {!g.tracksIndividuals && canWrite && open && (
        <Card className="mb-4 flex flex-wrap items-center gap-2 p-3">
          <span className="mr-2 text-sm font-medium">Daily records:</span>
          {[['MORTALITY', 'Mortality', Skull], ['FEED', 'Feed', Plus], ['EGGS', 'Eggs', Plus], ['BATCH_WEIGHT', 'Average weight', Plus], ['WATER', 'Water', Plus]].map(([k, l, Icon]) => {
            const I = Icon as typeof Plus;
            return <Button key={k as string} size="sm" variant={k === 'MORTALITY' ? 'outline' : 'ghost'} onClick={() => { setProdKind(k as string); setDialog('production'); }}><I /> {l as string}</Button>;
          })}
        </Card>
      )}

      {g.tracksIndividuals && (
        <Card className="mb-4">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Animals</CardTitle>
            {canWrite && open && selected.size > 0 && <Button size="sm" variant="outline" onClick={() => setDialog('move')}><ArrowRightLeft /> Move / sell / record death ({selected.size})</Button>}
          </CardHeader>
          {g.animals.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    {canWrite && <th className="w-10 p-2"><Checkbox aria-label="Select all" checked={allSelected} onCheckedChange={(v) => setSelected(v ? new Set(g.animals.map((a) => a.id)) : new Set())} /></th>}
                    <th className="p-2">Tag</th><th className="p-2">Name</th><th className="p-2">Sex</th><th className="p-2">Age</th><th className="p-2">Weight</th><th />
                  </tr>
                </thead>
                <tbody>
                  {g.animals.map((a) => (
                    <tr key={a.id} className="border-t hover:bg-muted/30">
                      {canWrite && <td className="p-2"><Checkbox aria-label={`Select ${a.name}`} checked={selected.has(a.id)} onCheckedChange={(v) => { const n = new Set(selected); if (v) n.add(a.id); else n.delete(a.id); setSelected(n); }} /></td>}
                      <td className="p-2 font-mono text-xs">{a.tag ?? '—'}</td>
                      <td className="p-2"><Link href={`/patients/${a.id}?tab=farm`} className="font-medium hover:underline">{a.name}</Link></td>
                      <td className="p-2">{enumLabel(a.sex)}</td>
                      <td className="p-2">{fmtAge(a.dateOfBirth)}</td>
                      <td className="p-2">{fmtWeight(a.latestWeightKg)}</td>
                      <td className="p-2 text-right">{canWrite && open && a.sex.startsWith('FEMALE') && <Button size="sm" variant="ghost" onClick={() => setBreedFor(a)}><Baby /> Breeding</Button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="p-4"><EmptyState icon={Users} title="No animals in this group" description="Add animals by ear tag, or move them in from another group." /></div>}
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Recent production</CardTitle></CardHeader>
        {recent.data?.length ? (
          <ul className="divide-y text-sm">
            {recent.data.slice(0, 30).map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-2">
                <span className="w-24 text-muted-foreground">{fmtDate(r.recordedOn)}</span>
                <span className="flex-1">{enumLabel(r.kind)}{r.patient ? ` — ${r.patient.name}` : ''}</span>
                <span className="tabular">{r.quantity} {r.unit}</span>
                {r.kind === 'MORTALITY' && <Badge variant="destructive">deaths</Badge>}
              </li>
            ))}
          </ul>
        ) : <p className="px-4 pb-4 text-sm text-muted-foreground">Nothing recorded yet.</p>}
      </Card>

      <BulkAnimalsDialog open={dialog === 'add'} onOpenChange={(o) => !o && setDialog(null)} groupId={g.id} onDone={refresh} />
      <MovementDialog open={dialog === 'move'} onOpenChange={(o) => !o && setDialog(null)} group={g} patientIds={[...selected]} groups={groups} onDone={refresh} />
      <MilkSheetDialog open={dialog === 'milk'} onOpenChange={(o) => !o && setDialog(null)} farmId={g.farmId} animals={g.animals} onDone={refresh} />
      <GroupTreatmentDialog open={dialog === 'treat'} onOpenChange={(o) => !o && setDialog(null)} farmId={g.farmId} groups={groups.length ? groups : [g]} defaultGroupId={g.id} onDone={refresh} />
      <ProductionDialog open={dialog === 'production'} onOpenChange={(o) => !o && setDialog(null)} farmId={g.farmId} groups={groups.length ? groups : [g]} animals={g.animals} defaultKind={prodKind} defaultGroupId={g.id} onDone={refresh} />
      <BreedingDialog open={!!breedFor} onOpenChange={(o) => !o && setBreedFor(null)} female={breedFor} males={males} onDone={refresh} />
    </>
  );
}

export default function GroupPage() {
  return (
    <RequirePermission anyOf={['livestock.read']}>
      <Suspense>
        <Group />
      </Suspense>
    </RequirePermission>
  );
}
