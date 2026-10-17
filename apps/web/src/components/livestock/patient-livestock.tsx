'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { enumLabel } from '@vcms/shared';
import { Baby, Tractor } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useConfirm } from '../confirm';
import { EmptyState } from '../page';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { NativeSelect } from '../ui/input';
import { BREEDING_LABELS, ReproBadge } from './badges';
import { BreedingDialog } from './record-dialogs';
import { api } from '@/lib/api';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { AnimalBreeding, FarmDetail, FarmRow, GroupDetail, MovementRow } from '@/lib/types';

/** Farm, group, pedigree, breeding history and movements for a farm animal. */
export function PatientLivestock({ patient, ownerId, active }: { patient: { id: string; name: string; sex: string; speciesId: string; farmId?: string | null; groupId?: string | null }; ownerId: string | null; active: boolean }) {
  const { can } = useSession();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const canWrite = can('livestock.write') && active;
  const breeding = useQuery({ queryKey: ['animal-breeding', patient.id], queryFn: () => api.get<AnimalBreeding>(`/livestock/animals/${patient.id}/breeding`) });
  const movements = useQuery({ queryKey: ['movements', 'patient', patient.id], queryFn: () => api.get<MovementRow[]>(`/livestock/movements?patientId=${patient.id}`) });
  const farms = useQuery({ queryKey: ['farms', 'owner', ownerId], queryFn: () => api.get<FarmRow[]>(`/farms?clientId=${ownerId}`), enabled: !!ownerId });
  const [farmId, setFarmId] = useState(patient.farmId ?? '');
  const [groupId, setGroupId] = useState(patient.groupId ?? '');
  useEffect(() => { setFarmId(patient.farmId ?? ''); setGroupId(patient.groupId ?? ''); }, [patient.farmId, patient.groupId]);
  const farm = useQuery({ queryKey: ['farm', farmId], queryFn: () => api.get<FarmDetail>(`/farms/${farmId}`), enabled: !!farmId });
  const groups = (farm.data?.groups ?? []).filter((g) => g.tracksIndividuals && g.speciesId === patient.speciesId);
  const males = useQuery({
    queryKey: ['farm-males', farmId],
    queryFn: async () => (await Promise.all(groups.map((g) => api.get<GroupDetail>(`/animal-groups/${g.id}`)))).flatMap((g) => g.animals.filter((a) => a.sex.startsWith('MALE'))),
    enabled: !!farm.data && patient.sex.startsWith('FEMALE'),
  });
  const [recording, setRecording] = useState(false);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['animal-breeding', patient.id] }); qc.invalidateQueries({ queryKey: ['movements'] }); qc.invalidateQueries({ queryKey: ['patient', patient.id] }); qc.invalidateQueries({ queryKey: ['timeline', patient.id] }); };
  const assign = useMutation({
    mutationFn: () => api.post('/livestock/animals/assign', { patientId: patient.id, farmId: farmId || null, groupId: groupId || null }),
    onSuccess: () => { toast.success('Farm and group saved'); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const voidM = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.post(`/breeding-events/${id}/void`, { reason }),
    onSuccess: () => { toast.success('Record voided'); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const b = breeding.data;
  const female = patient.sex.startsWith('FEMALE');
  const changed = (farmId || null) !== (patient.farmId ?? null) || (groupId || null) !== (patient.groupId ?? null);
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
      <div className="grid min-w-0 grid-cols-1 content-start gap-4">
        {female && (
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">Breeding {b?.status && <ReproBadge state={b.status.state} />}</CardTitle>
              {canWrite && <Button size="sm" onClick={() => setRecording(true)}><Baby /> Record breeding event</Button>}
            </CardHeader>
            {b?.status?.expectedDueDate && <p className="px-4 pb-2 text-sm">Expected to give birth <b>{fmtDate(b.status.expectedDueDate)}</b></p>}
            {b?.events.filter((e) => e.patientId === patient.id).length ? (
              <ul className="divide-y text-sm">
                {b.events.filter((e) => e.patientId === patient.id).map((e) => (
                  <li key={e.id} className={`flex items-start gap-3 px-4 py-2 ${e.voidedAt ? 'opacity-50' : ''}`}>
                    <span className="w-28 shrink-0 text-muted-foreground">{fmtDate(e.occurredAt)}</span>
                    <div className="min-w-0 flex-1">
                      <p className={e.voidedAt ? 'line-through' : 'font-medium'}>
                        {BREEDING_LABELS[e.type]}{e.result ? `: ${enumLabel(e.result)}` : ''}{e.type === 'BIRTH' ? ` — ${e.liveCount ?? 0} alive of ${e.offspringCount ?? 0}` : ''}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {[e.sire?.name ?? e.sireText, e.semenBatch && `batch ${e.semenBatch}`, e.method, e.technician, e.expectedDueDate && `due ${fmtDate(e.expectedDueDate)}`].filter(Boolean).join(' · ')}
                        {e.dueDateSource && <span className="block">Due date: {e.dueDateSource}</span>}
                        {e.notes && <span className="block">{e.notes}</span>}
                        {e.voidedAt && <span className="block">Voided: {e.voidReason}</span>}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground">{e.recordedByName}</span>
                    {canWrite && !e.voidedAt && e.type !== 'BIRTH' && <Button size="sm" variant="ghost" onClick={async () => { const c = await confirm({ title: 'Void this breeding record?', description: 'It stays visible, marked void.', confirmLabel: 'Void', requireReason: true }); if (c.confirmed) voidM.mutate({ id: e.id, reason: c.reason! }); }}>Void</Button>}
                  </li>
                ))}
              </ul>
            ) : <CardContent><p className="text-sm text-muted-foreground">No breeding records yet.</p></CardContent>}
          </Card>
        )}
        <Card>
          <CardHeader><CardTitle>Movement history</CardTitle></CardHeader>
          {movements.data?.length ? (
            <ul className="divide-y text-sm">
              {movements.data.map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-4 py-2">
                  <span className="w-36 shrink-0 text-muted-foreground">{fmtDateTime(m.occurredAt)}</span>
                  <Badge variant={m.type === 'DEATH' || m.type === 'CULL' ? 'destructive' : 'secondary'}>{enumLabel(m.type, 'movement')}</Badge>
                  <span className="flex-1 text-xs text-muted-foreground">{m.fromGroup?.name ?? m.fromFarm?.name ?? ''}{(m.toGroup || m.toFarm) && ` → ${m.toGroup?.name ?? m.toFarm?.name}`}{m.counterparty ? ` · ${m.counterparty}` : ''}{m.reason ? ` · ${m.reason}` : ''}</span>
                </li>
              ))}
            </ul>
          ) : <CardContent><p className="text-sm text-muted-foreground">No movements recorded.</p></CardContent>}
        </Card>
      </div>
      <div className="grid min-w-0 grid-cols-1 content-start gap-4">
        <Card>
          <CardHeader><CardTitle>Farm & group</CardTitle></CardHeader>
          <CardContent className="grid gap-3">
            {canWrite ? (
              <>
                <NativeSelect aria-label="Farm" value={farmId} onChange={(e) => { setFarmId(e.target.value); setGroupId(''); }}>
                  <option value="">Not on a farm</option>
                  {(farms.data ?? []).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </NativeSelect>
                <NativeSelect aria-label="Group" value={groupId} disabled={!farmId} onChange={(e) => setGroupId(e.target.value)}>
                  <option value="">No group</option>
                  {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </NativeSelect>
                {changed && <Button size="sm" loading={assign.isPending} onClick={() => assign.mutate()}>Save</Button>}
                {!farms.data?.length && farms.isSuccess && <p className="text-xs text-muted-foreground">The owner has no farm yet. <Link href="/livestock" className="text-primary hover:underline">Create one</Link>.</p>}
              </>
            ) : farm.data ? (
              <p className="text-sm"><Link href={`/livestock/farms/${farm.data.id}`} className="font-medium hover:underline">{farm.data.name}</Link>{groupId && <span className="text-muted-foreground"> · {farm.data.groups.find((g) => g.id === groupId)?.name}</span>}</p>
            ) : <EmptyState icon={Tractor} title="Not on a farm" />}
            {farm.data && canWrite && <Link href={`/livestock/farms/${farm.data.id}`} className="text-sm text-primary hover:underline">Open farm</Link>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Pedigree</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 gap-2 text-sm">
            <p><span className="text-muted-foreground">Sire: </span>{b?.pedigree.sire ? <Link href={`/patients/${b.pedigree.sire.id}?tab=farm`} className="hover:underline">{b.pedigree.sire.name}</Link> : '—'}</p>
            <p><span className="text-muted-foreground">Dam: </span>{b?.pedigree.dam ? <Link href={`/patients/${b.pedigree.dam.id}?tab=farm`} className="hover:underline">{b.pedigree.dam.name}</Link> : '—'}</p>
            <div>
              <p className="text-muted-foreground">Offspring ({b?.pedigree.offspring.length ?? 0})</p>
              <ul className="mt-1 grid gap-1">
                {b?.pedigree.offspring.map((o) => (
                  <li key={o.id}><Link href={`/patients/${o.id}?tab=farm`} className="hover:underline">{o.name}</Link> <span className="text-xs text-muted-foreground">{enumLabel(o.sex)} · {fmtDate(o.dateOfBirth)}{o.status !== 'ACTIVE' ? ` · ${enumLabel(o.status).toLowerCase()}` : ''}</span></li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
      <BreedingDialog open={recording} onOpenChange={setRecording} female={patient} males={males.data ?? []} onDone={refresh} />
    </div>
  );
}
