'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ROUTES, enumLabel } from '@vcms/shared';
import { AlertTriangle, CheckCircle2, Edit, Plus, Trash2 } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { useConfirm } from '@/components/confirm';
import { FormError } from '@/components/forms/form-error';
import { DescriptionList, EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/page';
import { ProductDialog } from '@/components/pharmacy/product-dialog';
import { productStrength } from '@/components/pharmacy/product-picker';
import { RequirePermission } from '@/components/require';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, NativeSelect } from '@/components/ui/input';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { ProductDetail, Species } from '@/lib/types';

function Detail() {
  const { id } = useParams<{ id: string }>();
  const { can, currency } = useSession();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ['product', id], queryFn: () => api.get<ProductDetail>(`/products/${id}`) });
  const species = useQuery({ queryKey: ['species'], queryFn: () => api.get<Species[]>('/species') });
  const [edit, setEdit] = useState(false);
  const [ref, setRef] = useState({ speciesId: '', route: 'PO', doseMin: '', doseMax: '', doseUnit: 'mg/kg', frequency: '', maxPerDose: '', indication: '', source: '' });
  const [wd, setWd] = useState({ speciesId: '', meatDays: '', milkHours: '', eggDays: '', source: '' });
  const [error, setError] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['product', id] });
  const act = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn(), onSuccess: refresh, onError: (e: Error) => setError(e.message) });

  if (q.isLoading) return <LoadingRows />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const p = q.data!;
  const manage = can('formulary.manage');
  const livestock = (species.data ?? []).filter((s) => ['LIVESTOCK', 'POULTRY', 'EQUINE'].includes(s.category));

  return (
    <>
      <PageHeader
        title={p.name}
        breadcrumbs={[{ label: 'Pharmacy', href: '/pharmacy' }, { label: 'Formulary', href: '/pharmacy/formulary' }, { label: p.name }]}
        description={`${enumLabel(p.type)}${p.form ? ` · ${enumLabel(p.form)}` : ''} · ${productStrength(p)}`}
        actions={(manage || can('inventory.write')) && <Button size="sm" variant="outline" onClick={() => setEdit(true)}><Edit /> Edit</Button>}
      />
      {error && <FormError message={error} />}
      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Dose references</CardTitle>
            </CardHeader>
            <div className="flex gap-2 border-b bg-warning/10 p-3 text-xs">
              <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
              <p>Enter doses only from a current, validated veterinary reference and cite it. New references are <b>drafts</b> until a veterinarian approves them; the calculator only uses approved references.</p>
            </div>
            {manage && (
              <form className="grid gap-2 border-b p-3" onSubmit={(e) => { e.preventDefault(); setError(null); act.mutate(() => api.post('/dose-references', { ...ref, productId: p.id, maxPerDose: ref.maxPerDose || null }).then(() => setRef({ ...ref, doseMin: '', doseMax: '', source: '' }))); }}>
                <div className="flex flex-wrap gap-2">
                  <NativeSelect aria-label="Species" className="w-36" value={ref.speciesId} onChange={(e) => setRef({ ...ref, speciesId: e.target.value })}><option value="">Species…</option>{species.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</NativeSelect>
                  <NativeSelect aria-label="Route" className="w-28" value={ref.route} onChange={(e) => setRef({ ...ref, route: e.target.value })}>{ROUTES.map((r) => <option key={r}>{r}</option>)}</NativeSelect>
                  <Input aria-label="Minimum" placeholder="Min" className="w-20" inputMode="decimal" value={ref.doseMin} onChange={(e) => setRef({ ...ref, doseMin: e.target.value })} />
                  <Input aria-label="Maximum" placeholder="Max" className="w-20" inputMode="decimal" value={ref.doseMax} onChange={(e) => setRef({ ...ref, doseMax: e.target.value })} />
                  <NativeSelect aria-label="Unit" className="w-28" value={ref.doseUnit} onChange={(e) => setRef({ ...ref, doseUnit: e.target.value })}>{['mg/kg', 'mcg/kg', 'IU/kg', 'mL/kg', 'mg/animal'].map((u) => <option key={u}>{u}</option>)}</NativeSelect>
                  <Input aria-label="Frequency" placeholder="Frequency (e.g. q12h)" className="w-36" value={ref.frequency} onChange={(e) => setRef({ ...ref, frequency: e.target.value })} />
                  <Input aria-label="Indication" placeholder="Indication" className="w-40" value={ref.indication} onChange={(e) => setRef({ ...ref, indication: e.target.value })} />
                </div>
                <div className="flex gap-2">
                  <Input aria-label="Source" placeholder="Source — reference title, edition, page / product datasheet" value={ref.source} onChange={(e) => setRef({ ...ref, source: e.target.value })} />
                  <Button type="submit" size="sm" disabled={!ref.speciesId || !ref.doseMin || !ref.doseMax || !ref.source.trim()}><Plus /> Add draft</Button>
                </div>
              </form>
            )}
            {p.doseReferences.length ? (
              <ul className="divide-y">
                {p.doseReferences.map((r) => (
                  <li key={r.id} className={`flex flex-wrap items-center gap-2 px-3 py-2 ${r.status === 'RETIRED' ? 'opacity-50' : ''}`}>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{r.species.name} · {r.route} · {r.doseMin}–{r.doseMax} {r.doseUnit}{r.frequency && ` · ${r.frequency}`}</p>
                      <p className="text-xs text-muted-foreground">{r.indication && `${r.indication} · `}{r.source}</p>
                      <p className="text-2xs text-muted-foreground">Added by {r.createdByName}{r.approvedByName && ` · approved by ${r.approvedByName} ${fmtDate(r.approvedAt)}`}</p>
                    </div>
                    <Badge variant={r.status === 'APPROVED' ? 'success' : r.status === 'DRAFT' ? 'warning' : 'outline'}>{enumLabel(r.status)}</Badge>
                    {manage && r.status === 'DRAFT' && can('clinical.sign') && (
                      <Button size="sm" variant="outline" onClick={async () => { const c = await confirm({ title: 'Approve this dose reference?', description: `You confirm ${r.doseMin}–${r.doseMax} ${r.doseUnit} for ${r.species.name} matches: ${r.source}`, confirmLabel: 'Approve' }); if (c.confirmed) act.mutate(() => api.post(`/dose-references/${r.id}/approve`)); }}>
                        <CheckCircle2 /> Approve
                      </Button>
                    )}
                    {manage && r.status !== 'RETIRED' && <Button size="sm" variant="ghost" onClick={() => act.mutate(() => api.post(`/dose-references/${r.id}/retire`))}>Retire</Button>}
                  </li>
                ))}
              </ul>
            ) : <EmptyState title="No dose references" className="py-6" />}
          </Card>
          <Card>
            <CardHeader><CardTitle>Withdrawal periods (food-producing species)</CardTitle></CardHeader>
            {manage && (
              <form className="flex flex-wrap gap-2 border-b p-3" onSubmit={(e) => { e.preventDefault(); setError(null); act.mutate(() => api.post(`/products/${p.id}/withdrawals`, wd).then(() => setWd({ speciesId: '', meatDays: '', milkHours: '', eggDays: '', source: '' }))); }}>
                <NativeSelect aria-label="Species" className="w-36" value={wd.speciesId} onChange={(e) => setWd({ ...wd, speciesId: e.target.value })}><option value="">Species…</option>{livestock.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</NativeSelect>
                <Input aria-label="Meat days" placeholder="Meat (days)" className="w-28" value={wd.meatDays} onChange={(e) => setWd({ ...wd, meatDays: e.target.value })} />
                <Input aria-label="Milk hours" placeholder="Milk (hours)" className="w-28" value={wd.milkHours} onChange={(e) => setWd({ ...wd, milkHours: e.target.value })} />
                <Input aria-label="Egg days" placeholder="Eggs (days)" className="w-28" value={wd.eggDays} onChange={(e) => setWd({ ...wd, eggDays: e.target.value })} />
                <Input aria-label="Source" placeholder="Source (product label / regulator)" className="min-w-[200px] flex-1" value={wd.source} onChange={(e) => setWd({ ...wd, source: e.target.value })} />
                <Button type="submit" size="sm" disabled={!wd.speciesId || !wd.source.trim()}><Plus /> Save</Button>
              </form>
            )}
            {p.withdrawals.length ? (
              <ul className="divide-y">
                {p.withdrawals.map((w) => (
                  <li key={w.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <span className="flex-1"><b>{w.species.name}</b>: meat {w.meatDays ?? '—'} d · milk {w.milkHours ?? '—'} h · eggs {w.eggDays ?? '—'} d <span className="text-xs text-muted-foreground">({w.source})</span></span>
                    {manage && <Button size="icon-sm" variant="ghost" aria-label="Remove" onClick={() => act.mutate(() => api.del(`/products/${p.id}/withdrawals/${w.id}`))}><Trash2 /></Button>}
                  </li>
                ))}
              </ul>
            ) : <EmptyState title="No withdrawal periods" className="py-6" />}
          </Card>
        </div>
        <Card className="h-fit">
          <CardHeader><CardTitle>Product</CardTitle></CardHeader>
          <CardContent>
            <DescriptionList
              className="sm:grid-cols-1"
              items={[
                { label: 'Generic name', value: p.genericName },
                { label: 'Active ingredients', value: p.activeIngredients.join(', ') },
                { label: 'Strength', value: productStrength(p) },
                { label: 'Smallest amount', value: `${p.minDispenseIncrement} ${p.dispensingUnit}` },
                { label: 'Price', value: p.sellPriceMinor != null && `${fmtMoney(p.sellPriceMinor, currency)} per ${p.dispensingUnit}` },
                { label: 'Labelled species', value: p.targetSpecies.map(enumLabel).join(', ') || 'Any' },
                { label: 'Legal category', value: [p.requiresPrescription ? 'Prescription-only' : 'OTC', p.isControlled && `Controlled${p.controlledSchedule ? ` (${p.controlledSchedule})` : ''}`].filter(Boolean).join(' · ') },
                { label: 'SKU / barcode', value: [p.sku, p.barcode].filter(Boolean).join(' · ') },
                { label: 'Manufacturer', value: p.manufacturer },
                { label: 'Notes', value: p.notes },
              ]}
            />
          </CardContent>
        </Card>
      </div>
      {edit && <ProductDialog product={p} open={edit} onOpenChange={setEdit} onSaved={refresh} />}
    </>
  );
}

export default function ProductPage() {
  return (
    <RequirePermission anyOf={['formulary.manage', 'inventory.read', 'prescriptions.read']}>
      <Detail />
    </RequirePermission>
  );
}
