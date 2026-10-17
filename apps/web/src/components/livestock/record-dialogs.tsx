'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BREEDING_EVENT_TYPES, GROUP_TREATMENT_KINDS, OUTBREAK_STATUSES, PATIENT_SEXES, PREGNANCY_RESULTS, PRODUCTION_UNITS, enumLabel } from '@vcms/shared';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Field } from '../forms/field';
import { FormError } from '../forms/form-error';
import { ProductPicker } from '../pharmacy/product-picker';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input, NativeSelect, Textarea } from '../ui/input';
import { BREEDING_LABELS } from './badges';
import { useClinicians } from '@/hooks/use-catalog';
import { api } from '@/lib/api';
import { fmtMoney, fmtNumber } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { AnimalGroupRow, GroupAnimal, OutbreakRow, Product, Service } from '@/lib/types';

const nowLocal = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
const today = () => nowLocal().slice(0, 10);

// ── Breeding ──

type Offspring = { tag: string; name: string; sex: string; alive: boolean };

/** Heat, service/AI, pregnancy check, birth (registers offspring), abortion, dry-off. */
export function BreedingDialog({ open, onOpenChange, female, males, onDone, defaultType }: { open: boolean; onOpenChange: (o: boolean) => void; female: { id: string; name: string } | null; males: { id: string; name: string; tag?: string | null }[]; onDone?: () => void; defaultType?: string }) {
  const [f, setF] = useState({ type: 'HEAT', occurredAt: '', sireId: '', sireText: '', semenBatch: '', technician: '', method: '', result: '', expectedDueDate: '', notes: '' });
  const [kids, setKids] = useState<Offspring[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setError(null);
    setKids([{ tag: '', name: '', sex: 'FEMALE', alive: true }]);
    setF({ type: defaultType ?? 'HEAT', occurredAt: nowLocal(), sireId: '', sireText: '', semenBatch: '', technician: '', method: '', result: '', expectedDueDate: '', notes: '' });
  }, [open, defaultType]);
  const m = useMutation({
    mutationFn: () =>
      api.post<{ expectedDueDate: string | null; offspring: { id: string }[] }>('/breeding-events', {
        patientId: female?.id,
        type: f.type,
        occurredAt: new Date(f.occurredAt).toISOString(),
        sireId: f.sireId || null,
        sireText: f.sireText || null,
        semenBatch: f.semenBatch || null,
        technician: f.technician || null,
        method: f.method || null,
        result: f.type === 'PREGNANCY_CHECK' ? f.result || null : null,
        expectedDueDate: f.expectedDueDate || null,
        notes: f.notes || null,
        offspring: f.type === 'BIRTH' ? kids.map((k) => ({ ...k, tag: k.tag || null, name: k.name || null })) : [],
      }),
    onSuccess: (r) => {
      toast.success(f.type === 'BIRTH' ? `Birth recorded — ${r.offspring.length} offspring registered` : r.expectedDueDate ? `Recorded — expected due ${r.expectedDueDate.slice(0, 10)}` : 'Recorded');
      onOpenChange(false);
      onDone?.();
    },
    onError: (e: Error) => setError(e.message),
  });
  const serviceLike = f.type === 'SERVICE' || f.type === 'INSEMINATION';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Breeding record{female ? ` — ${female.name}` : ''}</DialogTitle>
          <DialogDescription>Due dates are worked out from the species’ gestation length set in Settings → Livestock, or you can enter one.</DialogDescription>
        </DialogHeader>
        {error && <FormError message={error} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Event" htmlFor="br-type"><NativeSelect id="br-type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{BREEDING_EVENT_TYPES.map((t) => <option key={t} value={t}>{BREEDING_LABELS[t]}</option>)}</NativeSelect></Field>
          <Field label="When" htmlFor="br-at"><Input id="br-at" type="datetime-local" value={f.occurredAt} onChange={(e) => setF({ ...f, occurredAt: e.target.value })} /></Field>
          {(serviceLike || f.type === 'BIRTH') && (
            <>
              <Field label="Sire (registered)" htmlFor="br-sire"><NativeSelect id="br-sire" value={f.sireId} onChange={(e) => setF({ ...f, sireId: e.target.value })}><option value="">{f.type === 'BIRTH' ? 'From last service' : 'Not registered here'}</option>{males.map((x) => <option key={x.id} value={x.id}>{x.name}{x.tag && x.tag !== x.name ? ` (${x.tag})` : ''}</option>)}</NativeSelect></Field>
              <Field label={f.type === 'INSEMINATION' ? 'AI sire / straw code' : 'Sire name (if not registered)'} htmlFor="br-sire-text"><Input id="br-sire-text" value={f.sireText} maxLength={120} onChange={(e) => setF({ ...f, sireText: e.target.value })} /></Field>
            </>
          )}
          {f.type === 'INSEMINATION' && (
            <>
              <Field label="Semen batch" htmlFor="br-batch"><Input id="br-batch" value={f.semenBatch} maxLength={80} onChange={(e) => setF({ ...f, semenBatch: e.target.value })} /></Field>
              <Field label="Technician" htmlFor="br-tech"><Input id="br-tech" value={f.technician} maxLength={120} onChange={(e) => setF({ ...f, technician: e.target.value })} /></Field>
            </>
          )}
          {f.type === 'PREGNANCY_CHECK' && (
            <>
              <Field label="Result" htmlFor="br-result" required><NativeSelect id="br-result" value={f.result} onChange={(e) => setF({ ...f, result: e.target.value })}><option value="">Choose…</option>{PREGNANCY_RESULTS.map((r) => <option key={r} value={r}>{enumLabel(r)}</option>)}</NativeSelect></Field>
              <Field label="Method" htmlFor="br-method"><Input id="br-method" value={f.method} maxLength={120} onChange={(e) => setF({ ...f, method: e.target.value })} placeholder="e.g. Ultrasound, palpation" /></Field>
            </>
          )}
          {(serviceLike || (f.type === 'PREGNANCY_CHECK' && f.result === 'PREGNANT')) && (
            <Field label="Expected due date" htmlFor="br-due" hint="Leave blank to calculate from the gestation length."><Input id="br-due" type="date" value={f.expectedDueDate} onChange={(e) => setF({ ...f, expectedDueDate: e.target.value })} /></Field>
          )}
          {f.type === 'BIRTH' && (
            <div className="grid gap-2 sm:col-span-2">
              <p className="text-sm font-medium">Offspring</p>
              {kids.map((k, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_8rem_auto_auto] items-center gap-2">
                  <Input aria-label={`Offspring ${i + 1} tag`} placeholder="Ear tag" value={k.tag} maxLength={40} onChange={(e) => setKids(kids.map((x, j) => (j === i ? { ...x, tag: e.target.value } : x)))} />
                  <Input aria-label={`Offspring ${i + 1} name`} placeholder="Name (optional)" value={k.name} maxLength={80} onChange={(e) => setKids(kids.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                  <NativeSelect aria-label={`Offspring ${i + 1} sex`} value={k.sex} onChange={(e) => setKids(kids.map((x, j) => (j === i ? { ...x, sex: e.target.value } : x)))}>{PATIENT_SEXES.filter((s) => !s.includes('_')).map((s) => <option key={s} value={s}>{enumLabel(s)}</option>)}</NativeSelect>
                  <label className="flex items-center gap-1 text-xs"><Checkbox checked={k.alive} onCheckedChange={(v) => setKids(kids.map((x, j) => (j === i ? { ...x, alive: !!v } : x)))} /> Alive</label>
                  <Button variant="ghost" size="icon-sm" aria-label="Remove" disabled={kids.length === 1} onClick={() => setKids(kids.filter((_, j) => j !== i))}><Trash2 /></Button>
                </div>
              ))}
              <Button variant="outline" size="sm" className="w-fit" onClick={() => setKids([...kids, { tag: '', name: '', sex: 'FEMALE', alive: true }])}><Plus /> Add another</Button>
            </div>
          )}
          <Field label="Notes" htmlFor="br-notes" className="sm:col-span-2"><Textarea id="br-notes" value={f.notes} maxLength={2000} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={m.isPending} disabled={!female || (f.type === 'PREGNANCY_CHECK' && !f.result)} onClick={() => { setError(null); m.mutate(); }}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Production ──

const KIND_HINT: Record<string, string> = { MILK: 'Bulk tank or one animal', EGGS: 'Eggs collected', FEED: 'Feed given', BATCH_WEIGHT: 'Average weight of a sample of birds', MORTALITY: 'Deaths today (reduces the batch count)', WATER: 'Water consumed' };

export function ProductionDialog({ open, onOpenChange, farmId, groups, animals, defaultKind, defaultGroupId, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; farmId: string; groups: AnimalGroupRow[]; animals?: GroupAnimal[]; defaultKind?: string; defaultGroupId?: string; onDone?: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ kind: 'MILK', groupId: '', patientId: '', recordedOn: '', quantity: '', unit: '', session: '', notes: '' });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setError(null); setF({ kind: defaultKind ?? 'MILK', groupId: defaultGroupId ?? '', patientId: '', recordedOn: today(), quantity: '', unit: '', session: '', notes: '' }); } }, [open, defaultKind, defaultGroupId]);
  const batchOnly = f.kind === 'MORTALITY' || f.kind === 'BATCH_WEIGHT';
  const groupChoices = batchOnly ? groups.filter((g) => !g.tracksIndividuals && g.status === 'ACTIVE') : groups.filter((g) => g.status === 'ACTIVE');
  const m = useMutation({
    mutationFn: () => api.post('/production', { farmId, kind: f.kind, groupId: f.groupId || null, patientId: f.patientId || null, recordedOn: f.recordedOn, quantity: f.quantity, unit: f.unit || null, session: f.session || null, notes: f.notes || null }),
    onSuccess: () => { toast.success('Recorded'); qc.invalidateQueries({ queryKey: ['production'] }); onOpenChange(false); onDone?.(); },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Record production</DialogTitle><DialogDescription>{KIND_HINT[f.kind]}</DialogDescription></DialogHeader>
        {error && <FormError message={error} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Record" htmlFor="pr-kind"><NativeSelect id="pr-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value, groupId: '' })}>{Object.keys(PRODUCTION_UNITS).map((k) => <option key={k} value={k}>{enumLabel(k)}</option>)}</NativeSelect></Field>
          <Field label="Date" htmlFor="pr-date"><Input id="pr-date" type="date" value={f.recordedOn} onChange={(e) => setF({ ...f, recordedOn: e.target.value })} /></Field>
          <Field label={batchOnly ? 'Batch' : 'Group'} htmlFor="pr-group" required={batchOnly}>
            <NativeSelect id="pr-group" value={f.groupId} onChange={(e) => setF({ ...f, groupId: e.target.value })}>
              <option value="">{batchOnly ? (groupChoices.length ? 'Choose batch…' : 'No batch groups') : 'Whole farm'}</option>
              {groupChoices.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </NativeSelect>
          </Field>
          {f.kind === 'MILK' && animals && (
            <Field label="Animal" htmlFor="pr-animal"><NativeSelect id="pr-animal" value={f.patientId} onChange={(e) => setF({ ...f, patientId: e.target.value })}><option value="">Bulk / all</option>{animals.map((a) => <option key={a.id} value={a.id}>{a.name}{a.tag && a.tag !== a.name ? ` (${a.tag})` : ''}</option>)}</NativeSelect></Field>
          )}
          <Field label={`Quantity (${f.unit || PRODUCTION_UNITS[f.kind as keyof typeof PRODUCTION_UNITS]})`} htmlFor="pr-qty" required><Input id="pr-qty" inputMode="decimal" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></Field>
          {f.kind === 'MILK' && <Field label="Milking" htmlFor="pr-session"><NativeSelect id="pr-session" value={f.session} onChange={(e) => setF({ ...f, session: e.target.value })}><option value="">Whole day</option><option value="AM">Morning</option><option value="PM">Evening</option></NativeSelect></Field>}
          <Field label="Notes" htmlFor="pr-notes" className="sm:col-span-2"><Input id="pr-notes" value={f.notes} maxLength={500} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={m.isPending} disabled={!f.quantity || (batchOnly && !f.groupId)} onClick={() => { setError(null); m.mutate(); }}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Milk recording for a whole herd: one row per female. */
export function MilkSheetDialog({ open, onOpenChange, farmId, animals, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; farmId: string; animals: GroupAnimal[]; onDone?: () => void }) {
  const [date, setDate] = useState('');
  const [session, setSession] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setDate(today()); setSession(''); setValues({}); setError(null); } }, [open]);
  const females = animals.filter((a) => a.sex.startsWith('FEMALE'));
  const entries = females.filter((a) => values[a.id] && Number(values[a.id]) > 0).map((a) => ({ patientId: a.id, quantity: values[a.id] }));
  const total = entries.reduce((n, e) => n + Number(e.quantity), 0);
  const m = useMutation({
    mutationFn: () => api.post<{ recorded: number; totalLitres: number }>('/production/milk-sheet', { farmId, recordedOn: date, session: session || null, entries }),
    onSuccess: (r) => { toast.success(`${r.recorded} animals, ${r.totalLitres} L recorded`); onOpenChange(false); onDone?.(); },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader><DialogTitle>Milk recording sheet</DialogTitle><DialogDescription>Enter litres per animal. Leave blank for animals not milked.</DialogDescription></DialogHeader>
        {error && <FormError message={error} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Date" htmlFor="ms-date"><Input id="ms-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Milking" htmlFor="ms-session"><NativeSelect id="ms-session" value={session} onChange={(e) => setSession(e.target.value)}><option value="">Whole day</option><option value="AM">Morning</option><option value="PM">Evening</option></NativeSelect></Field>
        </div>
        <div className="max-h-[50vh] overflow-y-auto rounded-md border">
          {females.length ? (
            <table className="w-full text-sm">
              <tbody>
                {females.map((a) => (
                  <tr key={a.id} className="border-b last:border-0">
                    <td className="p-2"><span className="font-medium">{a.name}</span>{a.tag && a.tag !== a.name && <span className="ml-1 text-xs text-muted-foreground">{a.tag}</span>}</td>
                    <td className="w-32 p-1"><Input aria-label={`Litres for ${a.name}`} inputMode="decimal" value={values[a.id] ?? ''} onChange={(e) => setValues({ ...values, [a.id]: e.target.value })} placeholder="L" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="p-4 text-sm text-muted-foreground">No female animals in this group.</p>}
        </div>
        <DialogFooter>
          <span className="mr-auto text-sm text-muted-foreground">Total {Math.round(total * 10) / 10} L from {entries.length} animals</span>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={m.isPending} disabled={!entries.length} onClick={() => { setError(null); m.mutate(); }}>Save sheet</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Group treatment ──

export function GroupTreatmentDialog({ open, onOpenChange, farmId, groups, fieldVisitId, defaultGroupId, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; farmId: string; groups: AnimalGroupRow[]; fieldVisitId?: string; defaultGroupId?: string; onDone?: () => void }) {
  const { currency } = useSession();
  const [product, setProduct] = useState<Product | null>(null);
  const [f, setF] = useState({ kind: 'VACCINATION', groupId: '', productName: '', batchNumber: '', route: '', dosePerHead: '', headCount: '', quantityIssued: '', charge: true, administeredAt: '', notes: '' });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setError(null);
    setProduct(null);
    const g = groups.find((x) => x.id === defaultGroupId);
    setF({ kind: 'VACCINATION', groupId: defaultGroupId ?? '', productName: '', batchNumber: '', route: '', dosePerHead: '', headCount: g ? String(g.population) : '', quantityIssued: '', charge: true, administeredAt: nowLocal(), notes: '' });
  }, [open, defaultGroupId, groups]);
  const active = groups.filter((g) => g.status === 'ACTIVE');
  const m = useMutation({
    mutationFn: () =>
      api.post<{ animalsWithWithdrawal: number; withdrawalConfigured: boolean; meatClearAt: string | null; milkClearAt: string | null; eggClearAt: string | null }>('/group-treatments', {
        farmId, fieldVisitId: fieldVisitId ?? null, kind: f.kind, groupId: f.groupId || null, productId: product?.id ?? null, productName: product ? null : f.productName,
        batchNumber: f.batchNumber || null, route: f.route || null, dosePerHead: f.dosePerHead || null, headCount: f.headCount, quantityIssued: f.quantityIssued || null, charge: f.charge,
        administeredAt: new Date(f.administeredAt).toISOString(), notes: f.notes || null,
      }),
    onSuccess: (r) => {
      toast.success(r.withdrawalConfigured ? `Recorded. Withdrawal applied${r.animalsWithWithdrawal ? ` to ${r.animalsWithWithdrawal} animals` : ' to the batch'}.` : product ? 'Recorded. No withdrawal period is configured for this product and species — check the label.' : 'Recorded');
      onOpenChange(false);
      onDone?.();
    },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Treat a group</DialogTitle>
          <DialogDescription>Vaccination, parasite control or treatment for a whole group. Withdrawal periods come from the product’s configured, sourced periods for the species.</DialogDescription>
        </DialogHeader>
        {error && <FormError message={error} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Type" htmlFor="gt-kind"><NativeSelect id="gt-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{GROUP_TREATMENT_KINDS.map((k) => <option key={k} value={k}>{enumLabel(k)}</option>)}</NativeSelect></Field>
          <Field label="Group" htmlFor="gt-group">
            <NativeSelect id="gt-group" value={f.groupId} onChange={(e) => { const g = active.find((x) => x.id === e.target.value); setF({ ...f, groupId: e.target.value, headCount: g ? String(g.population) : f.headCount }); }}>
              <option value="">Whole farm / mixed</option>
              {active.map((g) => <option key={g.id} value={g.id}>{g.name} ({fmtNumber(g.population)} head)</option>)}
            </NativeSelect>
          </Field>
          <Field label="Product from stock" htmlFor="gt-product" className="sm:col-span-2" hint={product ? `${product.sellPriceMinor ? `${fmtMoney(product.sellPriceMinor, currency)} per ${product.dispensingUnit}` : 'No sell price set'}` : 'Or type what was given below if supplied by the farmer.'}>
            <ProductPicker id="gt-product" value={product} onChange={setProduct} />
          </Field>
          {!product && <Field label="Product given (not from stock)" htmlFor="gt-name" className="sm:col-span-2"><Input id="gt-name" value={f.productName} maxLength={160} onChange={(e) => setF({ ...f, productName: e.target.value })} /></Field>}
          <Field label="Animals treated" htmlFor="gt-heads" required><Input id="gt-heads" inputMode="numeric" value={f.headCount} onChange={(e) => setF({ ...f, headCount: e.target.value })} /></Field>
          <Field label="When" htmlFor="gt-at"><Input id="gt-at" type="datetime-local" value={f.administeredAt} onChange={(e) => setF({ ...f, administeredAt: e.target.value })} /></Field>
          <Field label="Dose per head" htmlFor="gt-dose" hint="As prescribed by the vet"><Input id="gt-dose" value={f.dosePerHead} maxLength={120} onChange={(e) => setF({ ...f, dosePerHead: e.target.value })} /></Field>
          <Field label="Route" htmlFor="gt-route"><Input id="gt-route" value={f.route} maxLength={60} onChange={(e) => setF({ ...f, route: e.target.value })} placeholder="e.g. SC, oral drench, water" /></Field>
          {product && (
            <>
              <Field label={`Stock used (${product.dispensingUnit})`} htmlFor="gt-qty" hint="Deducted from stock; leave empty if the farmer supplied it."><Input id="gt-qty" inputMode="decimal" value={f.quantityIssued} onChange={(e) => setF({ ...f, quantityIssued: e.target.value })} /></Field>
              <Field label="Batch number" htmlFor="gt-batch"><Input id="gt-batch" value={f.batchNumber} maxLength={60} onChange={(e) => setF({ ...f, batchNumber: e.target.value })} placeholder="Blank = first to expire" /></Field>
              {f.quantityIssued && <label className="flex items-center gap-2 text-sm sm:col-span-2"><Checkbox checked={f.charge} onCheckedChange={(v) => setF({ ...f, charge: !!v })} /> Bill the product to the farm owner</label>}
            </>
          )}
          <Field label="Notes" htmlFor="gt-notes" className="sm:col-span-2"><Textarea id="gt-notes" value={f.notes} maxLength={2000} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={m.isPending} disabled={!f.headCount || (!product && !f.productName.trim())} onClick={() => { setError(null); m.mutate(); }}>Record treatment</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Outbreaks ──

export function OutbreakDialog({ open, onOpenChange, farmId, groups, outbreak, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; farmId: string; groups: AnimalGroupRow[]; outbreak?: OutbreakRow | null; onDone?: () => void }) {
  const empty = { disease: '', groupId: '', notifiable: false, status: 'SUSPECTED', firstSeenOn: '', diagnosisMethod: '', populationAtRisk: '', affectedCount: '0', deathCount: '0', controlMeasures: '', reportedToAuthorityOn: '', authorityReference: '', notes: '' };
  const [f, setF] = useState(empty);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setError(null);
    setF(outbreak ? {
      disease: outbreak.disease, groupId: outbreak.group?.id ?? '', notifiable: outbreak.notifiable, status: outbreak.status, firstSeenOn: outbreak.firstSeenOn.slice(0, 10), diagnosisMethod: outbreak.diagnosisMethod ?? '',
      populationAtRisk: outbreak.populationAtRisk?.toString() ?? '', affectedCount: String(outbreak.affectedCount), deathCount: String(outbreak.deathCount), controlMeasures: outbreak.controlMeasures ?? '',
      reportedToAuthorityOn: outbreak.reportedToAuthorityOn?.slice(0, 10) ?? '', authorityReference: outbreak.authorityReference ?? '', notes: outbreak.notes ?? '',
    } : { ...empty, firstSeenOn: today() });
  }, [open, outbreak]); // eslint-disable-line react-hooks/exhaustive-deps
  const body = { ...f, groupId: f.groupId || null, populationAtRisk: f.populationAtRisk || null, reportedToAuthorityOn: f.reportedToAuthorityOn || null };
  const m = useMutation({
    mutationFn: () => (outbreak ? api.patch(`/outbreaks/${outbreak.id}`, { ...body, groupId: undefined }) : api.post('/outbreaks', { ...body, farmId })),
    onSuccess: () => { toast.success(outbreak ? 'Outbreak updated' : 'Outbreak recorded'); onOpenChange(false); onDone?.(); },
    onError: (e: Error) => setError(e.message),
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader><DialogTitle>{outbreak ? `Update ${outbreak.outbreakNo}` : 'Report a disease outbreak'}</DialogTitle><DialogDescription>Counts can only go up; note corrections in the notes.</DialogDescription></DialogHeader>
        {error && <FormError message={error} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Disease (suspected or confirmed)" htmlFor="ob-disease" required className="sm:col-span-2"><Input id="ob-disease" value={f.disease} maxLength={160} onChange={set('disease')} /></Field>
          {!outbreak && <Field label="Group affected" htmlFor="ob-group"><NativeSelect id="ob-group" value={f.groupId} onChange={set('groupId')}><option value="">Whole farm</option>{groups.filter((g) => g.status === 'ACTIVE').map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</NativeSelect></Field>}
          <Field label="Status" htmlFor="ob-status"><NativeSelect id="ob-status" value={f.status} onChange={set('status')}>{OUTBREAK_STATUSES.map((s) => <option key={s} value={s}>{enumLabel(s)}</option>)}</NativeSelect></Field>
          <Field label="First seen" htmlFor="ob-first"><Input id="ob-first" type="date" value={f.firstSeenOn} onChange={set('firstSeenOn')} /></Field>
          <Field label="Animals at risk" htmlFor="ob-risk"><Input id="ob-risk" inputMode="numeric" value={f.populationAtRisk} onChange={set('populationAtRisk')} /></Field>
          <Field label="Affected" htmlFor="ob-aff"><Input id="ob-aff" inputMode="numeric" value={f.affectedCount} onChange={set('affectedCount')} /></Field>
          <Field label="Deaths" htmlFor="ob-dead"><Input id="ob-dead" inputMode="numeric" value={f.deathCount} onChange={set('deathCount')} /></Field>
          <Field label="How diagnosed" htmlFor="ob-dx" className="sm:col-span-2"><Input id="ob-dx" value={f.diagnosisMethod} maxLength={300} onChange={set('diagnosisMethod')} placeholder="Clinical signs, lab test, post-mortem…" /></Field>
          <Field label="Control measures" htmlFor="ob-ctrl" className="sm:col-span-2"><Textarea id="ob-ctrl" value={f.controlMeasures} maxLength={4000} onChange={set('controlMeasures')} placeholder="Isolation, movement restriction, vaccination, disinfection…" /></Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><Checkbox checked={f.notifiable} onCheckedChange={(v) => setF({ ...f, notifiable: !!v })} /> Notifiable disease (must be reported to the authorities)</label>
          {f.notifiable && (
            <>
              <Field label="Reported on" htmlFor="ob-rep"><Input id="ob-rep" type="date" value={f.reportedToAuthorityOn} onChange={set('reportedToAuthorityOn')} /></Field>
              <Field label="Authority reference" htmlFor="ob-ref"><Input id="ob-ref" value={f.authorityReference} maxLength={120} onChange={set('authorityReference')} /></Field>
            </>
          )}
          <Field label="Notes" htmlFor="ob-notes" className="sm:col-span-2"><Textarea id="ob-notes" value={f.notes} maxLength={4000} onChange={set('notes')} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={m.isPending} disabled={!f.disease.trim()} onClick={() => { setError(null); m.mutate(); }}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Field visits ──

export function ScheduleVisitDialog({ open, onOpenChange, farm, appointmentId, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; farm: { id: string; name: string } | null; appointmentId?: string; onDone?: (id: string) => void }) {
  const { session } = useSession();
  const clinicians = useClinicians(session.branch?.id);
  const services = useQuery({ queryKey: ['services', 'active'], queryFn: () => api.get<Service[]>('/services'), enabled: open });
  const [f, setF] = useState({ scheduledAt: '', purpose: '', clinicianId: '', calloutServiceId: '' });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setError(null); setF({ scheduledAt: nowLocal(), purpose: '', clinicianId: '', calloutServiceId: '' }); } }, [open]);
  useEffect(() => {
    const def = services.data?.find((s) => s.isActive && s.category === 'FIELD_VISIT');
    if (open && def && !f.calloutServiceId) setF((x) => ({ ...x, calloutServiceId: def.id }));
  }, [services.data, open]); // eslint-disable-line react-hooks/exhaustive-deps
  const m = useMutation({
    mutationFn: () => api.post<{ id: string; visitNo: string }>('/field-visits', { farmId: farm?.id, appointmentId: appointmentId ?? null, scheduledAt: new Date(f.scheduledAt).toISOString(), purpose: f.purpose, clinicianId: f.clinicianId || null, calloutServiceId: f.calloutServiceId || null }),
    onSuccess: (v) => { toast.success(`Visit ${v.visitNo} scheduled`); onOpenChange(false); onDone?.(v.id); },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Schedule a farm visit{farm ? ` — ${farm.name}` : ''}</DialogTitle><DialogDescription>The call-out fee is billed to the farm owner when the visit is completed.</DialogDescription></DialogHeader>
        {error && <FormError message={error} />}
        <div className="grid gap-3">
          <Field label="When" htmlFor="fv-at" required><Input id="fv-at" type="datetime-local" value={f.scheduledAt} onChange={(e) => setF({ ...f, scheduledAt: e.target.value })} /></Field>
          <Field label="Purpose" htmlFor="fv-purpose" required><Input id="fv-purpose" value={f.purpose} maxLength={300} onChange={(e) => setF({ ...f, purpose: e.target.value })} placeholder="e.g. Herd vaccination, pregnancy checks, sick cow" /></Field>
          <Field label="Vet" htmlFor="fv-vet"><NativeSelect id="fv-vet" value={f.clinicianId} onChange={(e) => setF({ ...f, clinicianId: e.target.value })}><option value="">Not assigned</option>{(clinicians.data ?? []).map((c) => <option key={c.membershipId} value={c.membershipId}>{c.name}</option>)}</NativeSelect></Field>
          <Field label="Call-out fee" htmlFor="fv-fee"><NativeSelect id="fv-fee" value={f.calloutServiceId} onChange={(e) => setF({ ...f, calloutServiceId: e.target.value })}><option value="">No call-out fee</option>{(services.data ?? []).filter((s) => s.isActive).map((s) => <option key={s.id} value={s.id}>{s.name} — {fmtMoney(s.priceMinor, session.organization?.currency)}</option>)}</NativeSelect></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={m.isPending} disabled={!farm || !f.purpose.trim() || !f.scheduledAt} onClick={() => { setError(null); m.mutate(); }}>Schedule</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Opens a field-visit record for a booked farm-visit appointment (choose which of the client's farms). */
export function VisitFromAppointmentDialog({ open, onOpenChange, appointment, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; appointment: { id: string; startsAt: string; reason: string | null; client: { id: string; displayName: string }; clinician: { id: string } | null }; onDone?: (id: string) => void }) {
  const { currency } = useSession();
  const farms = useQuery({ queryKey: ['farms', 'owner', appointment.client.id], queryFn: () => api.get<{ id: string; name: string }[]>(`/farms?clientId=${appointment.client.id}`), enabled: open });
  const services = useQuery({ queryKey: ['services', 'active'], queryFn: () => api.get<Service[]>('/services'), enabled: open });
  const [f, setF] = useState({ farmId: '', purpose: '', calloutServiceId: '' });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setError(null); setF({ farmId: '', purpose: appointment.reason ?? 'Farm visit', calloutServiceId: '' }); } }, [open, appointment.reason]);
  useEffect(() => { if (open && farms.data?.length === 1 && !f.farmId) setF((x) => ({ ...x, farmId: farms.data![0].id })); }, [farms.data, open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const def = services.data?.find((s) => s.isActive && s.category === 'FIELD_VISIT'); if (open && def && !f.calloutServiceId) setF((x) => ({ ...x, calloutServiceId: def.id })); }, [services.data, open]); // eslint-disable-line react-hooks/exhaustive-deps
  const m = useMutation({
    mutationFn: () => api.post<{ id: string; visitNo: string }>('/field-visits', { farmId: f.farmId, appointmentId: appointment.id, scheduledAt: appointment.startsAt, purpose: f.purpose, clinicianId: appointment.clinician?.id ?? null, calloutServiceId: f.calloutServiceId || null }),
    onSuccess: (v) => { toast.success(`Visit record ${v.visitNo} opened`); onOpenChange(false); onDone?.(v.id); },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Open visit record</DialogTitle><DialogDescription>For {appointment.client.displayName}. Work, medicines and the call-out fee are recorded on the visit.</DialogDescription></DialogHeader>
        {error && <FormError message={error} />}
        <div className="grid gap-3">
          <Field label="Farm" htmlFor="va-farm" required hint={farms.data && !farms.data.length ? 'This client has no farm yet — create one under Livestock & farms.' : undefined}>
            <NativeSelect id="va-farm" value={f.farmId} onChange={(e) => setF({ ...f, farmId: e.target.value })}><option value="">Choose…</option>{(farms.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</NativeSelect>
          </Field>
          <Field label="Purpose" htmlFor="va-purpose" required><Input id="va-purpose" value={f.purpose} maxLength={300} onChange={(e) => setF({ ...f, purpose: e.target.value })} /></Field>
          <Field label="Call-out fee" htmlFor="va-fee"><NativeSelect id="va-fee" value={f.calloutServiceId} onChange={(e) => setF({ ...f, calloutServiceId: e.target.value })}><option value="">No call-out fee</option>{(services.data ?? []).filter((s) => s.isActive).map((s) => <option key={s.id} value={s.id}>{s.name} — {fmtMoney(s.priceMinor, currency)}</option>)}</NativeSelect></Field>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button loading={m.isPending} disabled={!f.farmId || !f.purpose.trim()} onClick={() => { setError(null); m.mutate(); }}>Open visit</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
