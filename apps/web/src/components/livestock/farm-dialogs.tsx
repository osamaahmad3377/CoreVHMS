'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ANIMAL_GROUP_KINDS, PATIENT_SEXES, PRODUCTION_PURPOSES, enumLabel, toMinor } from '@vcms/shared';
import { Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ClientPicker, type PickedClient } from '../clients/client-picker';
import { Field } from '../forms/field';
import { FormError } from '../forms/form-error';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input, NativeSelect, Textarea } from '../ui/input';
import { api } from '@/lib/api';
import { fmtNumber } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { AnimalGroupRow, FarmRow } from '@/lib/types';

interface SpeciesRow { id: string; name: string; category: string }
export const useFarmSpecies = (enabled = true) =>
  useQuery({ queryKey: ['species', 'farm'], queryFn: async () => (await api.get<SpeciesRow[]>('/species')).filter((s) => s.category !== 'COMPANION'), enabled, staleTime: 300_000 });

/** Create or edit a farm. A farm belongs to a client (the farm owner, who is billed). */
export function FarmDialog({ open, onOpenChange, farm, owner }: { open: boolean; onOpenChange: (o: boolean) => void; farm?: FarmRow | null; owner?: PickedClient | null }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [client, setClient] = useState<PickedClient | null>(null);
  const [f, setF] = useState({ name: '', registrationNumber: '', district: '', address: '', latitude: '', longitude: '', areaHectares: '', notes: '' });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setError(null);
    setClient(owner ?? (farm ? { id: farm.client.id, displayName: farm.client.displayName } : null));
    setF({
      name: farm?.name ?? '', registrationNumber: farm?.registrationNumber ?? '', district: farm?.district ?? '', address: farm?.address ?? '',
      latitude: farm?.latitude?.toString() ?? '', longitude: farm?.longitude?.toString() ?? '', areaHectares: farm?.areaHectares?.toString() ?? '', notes: farm?.notes ?? '',
    });
  }, [open, farm, owner]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const m = useMutation({
    mutationFn: () => (farm ? api.patch<FarmRow>(`/farms/${farm.id}`, f) : api.post<FarmRow>('/farms', { ...f, clientId: client?.id })),
    onSuccess: (r) => {
      toast.success(farm ? 'Farm updated' : `Farm ${r.farmNo} created`);
      qc.invalidateQueries({ queryKey: ['farms'] });
      qc.invalidateQueries({ queryKey: ['farm', r.id] });
      onOpenChange(false);
      if (!farm) router.push(`/livestock/farms/${r.id}`);
    },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{farm ? 'Edit farm' : 'New farm'}</DialogTitle>
          <DialogDescription>Work, medicines and visits on this farm are billed to the owner.</DialogDescription>
        </DialogHeader>
        {error && <FormError message={error} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Owner (client)" htmlFor="farm-owner" required className="sm:col-span-2" hint={!farm ? 'Register the farmer as a client first if they are new.' : undefined}>
            {farm ? <p className="text-sm font-medium">{farm.client.displayName}</p> : <ClientPicker id="farm-owner" value={client} onChange={setClient} />}
          </Field>
          <Field label="Farm name" htmlFor="farm-name" required><Input id="farm-name" value={f.name} maxLength={160} onChange={set('name')} placeholder="e.g. Green Valley Dairy" /></Field>
          <Field label="Registration number" htmlFor="farm-reg"><Input id="farm-reg" value={f.registrationNumber} maxLength={80} onChange={set('registrationNumber')} /></Field>
          <Field label="District / area" htmlFor="farm-district"><Input id="farm-district" value={f.district} maxLength={120} onChange={set('district')} /></Field>
          <Field label="Size (hectares)" htmlFor="farm-area"><Input id="farm-area" inputMode="decimal" value={f.areaHectares} onChange={set('areaHectares')} /></Field>
          <Field label="Address / directions" htmlFor="farm-address" className="sm:col-span-2"><Textarea id="farm-address" value={f.address} maxLength={300} onChange={set('address')} /></Field>
          <Field label="Latitude" htmlFor="farm-lat" hint="Optional, for directions on field visits"><Input id="farm-lat" inputMode="decimal" value={f.latitude} onChange={set('latitude')} placeholder="31.5204" /></Field>
          <Field label="Longitude" htmlFor="farm-lng"><Input id="farm-lng" inputMode="decimal" value={f.longitude} onChange={set('longitude')} placeholder="74.3587" /></Field>
          <Field label="Notes" htmlFor="farm-notes" className="sm:col-span-2"><Textarea id="farm-notes" value={f.notes} maxLength={2000} onChange={set('notes')} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={m.isPending} disabled={!f.name.trim() || (!farm && !client)} onClick={() => { setError(null); m.mutate(); }}>{farm ? 'Save' : 'Create farm'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** New herd, flock, pen or batch. Batches (e.g. broilers) are counted rather than registered one by one. */
export function GroupDialog({ open, onOpenChange, farmId }: { open: boolean; onOpenChange: (o: boolean) => void; farmId: string }) {
  const qc = useQueryClient();
  const species = useFarmSpecies(open);
  const [f, setF] = useState({ name: '', kind: 'HERD', speciesId: '', purpose: 'MIXED', tracksIndividuals: true, initialCount: '', placedOn: '', breedText: '', location: '' });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setError(null); setF({ name: '', kind: 'HERD', speciesId: '', purpose: 'MIXED', tracksIndividuals: true, initialCount: '', placedOn: '', breedText: '', location: '' }); } }, [open]);
  const sp = species.data?.find((s) => s.id === f.speciesId);
  const m = useMutation({
    mutationFn: () => api.post<AnimalGroupRow>('/animal-groups', { ...f, farmId, initialCount: f.tracksIndividuals ? null : f.initialCount, placedOn: f.placedOn || null }),
    onSuccess: (g) => { toast.success(`${g.name} created`); qc.invalidateQueries({ queryKey: ['farm', farmId] }); onOpenChange(false); },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader><DialogTitle>New herd, flock or batch</DialogTitle></DialogHeader>
        {error && <FormError message={error} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" htmlFor="grp-name" required><Input id="grp-name" value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Milking herd, Shed 2" /></Field>
          <Field label="Species" htmlFor="grp-species" required>
            <NativeSelect id="grp-species" value={f.speciesId} onChange={(e) => { const s = species.data?.find((x) => x.id === e.target.value); setF({ ...f, speciesId: e.target.value, tracksIndividuals: s?.category !== 'POULTRY', kind: s?.category === 'POULTRY' ? 'FLOCK' : f.kind }); }}>
              <option value="">Choose…</option>
              {(species.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Type" htmlFor="grp-kind"><NativeSelect id="grp-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{ANIMAL_GROUP_KINDS.map((k) => <option key={k} value={k}>{enumLabel(k)}</option>)}</NativeSelect></Field>
          <Field label="Purpose" htmlFor="grp-purpose"><NativeSelect id="grp-purpose" value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })}>{PRODUCTION_PURPOSES.map((k) => <option key={k} value={k}>{enumLabel(k)}</option>)}</NativeSelect></Field>
          <label className="flex items-start gap-2 text-sm sm:col-span-2">
            <Checkbox checked={!f.tracksIndividuals} onCheckedChange={(v) => setF({ ...f, tracksIndividuals: !v })} className="mt-0.5" />
            <span>Count animals as a batch instead of registering each one <span className="block text-xs text-muted-foreground">Use for poultry and other flocks where animals are not tagged individually.{sp?.category === 'POULTRY' ? ' Recommended for poultry.' : ''}</span></span>
          </label>
          {!f.tracksIndividuals && (
            <>
              <Field label="Number placed" htmlFor="grp-count" required><Input id="grp-count" inputMode="numeric" value={f.initialCount} onChange={(e) => setF({ ...f, initialCount: e.target.value })} /></Field>
              <Field label="Placement date" htmlFor="grp-placed"><Input id="grp-placed" type="date" value={f.placedOn} onChange={(e) => setF({ ...f, placedOn: e.target.value })} /></Field>
            </>
          )}
          <Field label="Breed / strain" htmlFor="grp-breed"><Input id="grp-breed" value={f.breedText} maxLength={120} onChange={(e) => setF({ ...f, breedText: e.target.value })} /></Field>
          <Field label="Location on farm" htmlFor="grp-loc"><Input id="grp-loc" value={f.location} maxLength={120} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="e.g. North shed" /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={m.isPending} disabled={!f.name.trim() || !f.speciesId || (!f.tracksIndividuals && !f.initialCount)} onClick={() => { setError(null); m.mutate(); }}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Row = { tag: string; name: string; sex: string; dateOfBirth: string };
const blank = (): Row => ({ tag: '', name: '', sex: 'FEMALE', dateOfBirth: '' });

/** Register several tagged animals into a herd at once (purchase, existing stock). */
export function BulkAnimalsDialog({ open, onOpenChange, groupId, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; groupId: string; onDone?: () => void }) {
  const [rows, setRows] = useState<Row[]>([blank()]);
  const [source, setSource] = useState('EXISTING');
  const [counterparty, setCounterparty] = useState('');
  const [breedText, setBreedText] = useState('');
  const [paste, setPaste] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setRows([blank()]); setSource('EXISTING'); setCounterparty(''); setBreedText(''); setPaste(''); setError(null); } }, [open]);
  const usable = rows.filter((r) => r.tag.trim());
  const m = useMutation({
    mutationFn: () => api.post<{ created: { id: string }[] }>('/livestock/animals/bulk', { groupId, source, counterparty: counterparty || null, breedText: breedText || null, animals: usable.map((r) => ({ tag: r.tag, name: r.name || null, sex: r.sex, dateOfBirth: r.dateOfBirth || null })) }),
    onSuccess: (r) => { toast.success(`${r.created.length} animal(s) registered`); onOpenChange(false); onDone?.(); },
    onError: (e: Error) => setError(e.message),
  });
  const applyPaste = () => {
    const tags = paste.split(/[\s,;]+/).map((t) => t.trim()).filter(Boolean);
    if (!tags.length) return;
    setRows([...rows.filter((r) => r.tag.trim()), ...tags.map((t) => ({ ...blank(), tag: t }))]);
    setPaste('');
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>Add animals</DialogTitle>
          <DialogDescription>Each animal gets its own record with the ear tag as identifier. Unnamed animals are named by tag.</DialogDescription>
        </DialogHeader>
        {error && <FormError message={error} />}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="How they arrived" htmlFor="bulk-src"><NativeSelect id="bulk-src" value={source} onChange={(e) => setSource(e.target.value)}><option value="EXISTING">Already on the farm</option><option value="PURCHASE">Purchased</option><option value="BIRTH">Born on the farm</option></NativeSelect></Field>
          {source === 'PURCHASE' && <Field label="Bought from" htmlFor="bulk-from"><Input id="bulk-from" value={counterparty} maxLength={160} onChange={(e) => setCounterparty(e.target.value)} /></Field>}
          <Field label="Breed (all)" htmlFor="bulk-breed"><Input id="bulk-breed" value={breedText} maxLength={120} onChange={(e) => setBreedText(e.target.value)} /></Field>
        </div>
        <div className="flex gap-2">
          <Input aria-label="Paste tag numbers" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Paste a list of tag numbers (separated by spaces, commas or new lines)" />
          <Button variant="outline" onClick={applyPaste} disabled={!paste.trim()}>Add tags</Button>
        </div>
        <div className="max-h-[45vh] overflow-y-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/60 text-left text-xs text-muted-foreground"><tr><th className="p-2">Ear tag *</th><th className="p-2">Name</th><th className="p-2">Sex</th><th className="p-2">Date of birth</th><th /></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t">
                  <td className="p-1"><Input aria-label={`Tag ${i + 1}`} value={r.tag} maxLength={40} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, tag: e.target.value } : x)))} /></td>
                  <td className="p-1"><Input aria-label={`Name ${i + 1}`} value={r.name} maxLength={80} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} /></td>
                  <td className="p-1"><NativeSelect aria-label={`Sex ${i + 1}`} value={r.sex} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, sex: e.target.value } : x)))}>{PATIENT_SEXES.map((s) => <option key={s} value={s}>{enumLabel(s)}</option>)}</NativeSelect></td>
                  <td className="p-1"><Input aria-label={`Date of birth ${i + 1}`} type="date" value={r.dateOfBirth} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, dateOfBirth: e.target.value } : x)))} /></td>
                  <td className="p-1"><Button variant="ghost" size="icon-sm" aria-label="Remove row" onClick={() => setRows(rows.length > 1 ? rows.filter((_, j) => j !== i) : [blank()])}><Trash2 /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button variant="outline" size="sm" className="w-fit" onClick={() => setRows([...rows, blank()])}><Plus /> Add row</Button>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={m.isPending} disabled={!usable.length} onClick={() => { setError(null); m.mutate(); }}>Register {usable.length || ''} animal{usable.length === 1 ? '' : 's'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const MOVE_TYPES = [
  { k: 'MOVE', label: 'Move to another group' },
  { k: 'SALE', label: 'Sold' },
  { k: 'TRANSFER', label: 'Transferred out' },
  { k: 'DEATH', label: 'Died' },
  { k: 'CULL', label: 'Culled' },
];

/** Move, sell, transfer, or record death/culling for selected animals, or a head count from a batch. */
export function MovementDialog({ open, onOpenChange, group, patientIds, groups, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; group: AnimalGroupRow; patientIds: string[]; groups: AnimalGroupRow[]; onDone?: () => void }) {
  const { currency } = useSession();
  const [f, setF] = useState({ type: 'MOVE', toGroupId: '', headCount: '', occurredAt: '', counterparty: '', price: '', reason: '' });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setError(null); setF({ type: group.tracksIndividuals ? 'MOVE' : 'SALE', toGroupId: '', headCount: '', occurredAt: new Date().toISOString().slice(0, 16), counterparty: '', price: '', reason: '' }); } }, [open, group.tracksIndividuals]);
  const targets = groups.filter((g) => g.id !== group.id && g.status === 'ACTIVE' && g.speciesId === group.speciesId && g.tracksIndividuals === group.tracksIndividuals);
  const types = MOVE_TYPES.filter((t) => group.tracksIndividuals || t.k !== 'DEATH');
  const m = useMutation({
    mutationFn: () =>
      api.post('/livestock/movements', {
        type: f.type,
        patientIds: group.tracksIndividuals ? patientIds : [],
        groupId: group.tracksIndividuals ? null : group.id,
        headCount: group.tracksIndividuals ? null : f.headCount,
        toGroupId: f.type === 'MOVE' ? f.toGroupId : null,
        occurredAt: new Date(f.occurredAt).toISOString(),
        counterparty: f.counterparty || null,
        priceMinor: f.price ? toMinor(f.price, currency) : null,
        reason: f.reason || null,
      }),
    onSuccess: () => { toast.success('Recorded'); onOpenChange(false); onDone?.(); },
    onError: (e: Error) => setError(e.message),
  });
  const n = group.tracksIndividuals ? patientIds.length : Number(f.headCount || 0);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{group.tracksIndividuals ? `Record movement — ${patientIds.length} animal${patientIds.length === 1 ? '' : 's'}` : `Record movement — ${group.name}`}</DialogTitle>
          <DialogDescription>Kept in the farm’s movement history. Sold and dead animals leave the active herd.</DialogDescription>
        </DialogHeader>
        {error && <FormError message={error} />}
        <div className="grid gap-3">
          <Field label="What happened" htmlFor="mv-type"><NativeSelect id="mv-type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{types.map((t) => <option key={t.k} value={t.k}>{t.label}</option>)}</NativeSelect></Field>
          {!group.tracksIndividuals && <Field label={`How many (of ${fmtNumber(group.headCount)})`} htmlFor="mv-count" required hint={f.type === 'MOVE' ? undefined : 'Record daily deaths under Production → Mortality.'}><Input id="mv-count" inputMode="numeric" value={f.headCount} onChange={(e) => setF({ ...f, headCount: e.target.value })} /></Field>}
          {f.type === 'MOVE' && (
            <Field label="Move to" htmlFor="mv-to" required>
              <NativeSelect id="mv-to" value={f.toGroupId} onChange={(e) => setF({ ...f, toGroupId: e.target.value })}>
                <option value="">{targets.length ? 'Choose group…' : 'No other group of this species'}</option>
                {targets.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </NativeSelect>
            </Field>
          )}
          <Field label="When" htmlFor="mv-at"><Input id="mv-at" type="datetime-local" value={f.occurredAt} onChange={(e) => setF({ ...f, occurredAt: e.target.value })} /></Field>
          {(f.type === 'SALE' || f.type === 'TRANSFER') && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={f.type === 'SALE' ? 'Buyer' : 'Transferred to'} htmlFor="mv-cp"><Input id="mv-cp" value={f.counterparty} maxLength={160} onChange={(e) => setF({ ...f, counterparty: e.target.value })} /></Field>
              {f.type === 'SALE' && <Field label="Total price" htmlFor="mv-price"><Input id="mv-price" inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>}
            </div>
          )}
          <Field label={f.type === 'DEATH' || f.type === 'CULL' ? 'Cause / reason' : 'Notes'} htmlFor="mv-reason" required={f.type === 'DEATH' || f.type === 'CULL'}><Textarea id="mv-reason" value={f.reason} maxLength={500} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={m.isPending} variant={f.type === 'DEATH' || f.type === 'CULL' ? 'destructive' : 'default'} disabled={!n || (f.type === 'MOVE' && !f.toGroupId) || ((f.type === 'DEATH' || f.type === 'CULL') && !f.reason.trim())} onClick={() => { setError(null); m.mutate(); }}>Record</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
