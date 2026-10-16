'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IMAGING_MODALITIES, LAB_CATEGORIES, PATIENT_SEXES, SAMPLE_TYPES, enumLabel, fromMinor, toMinor } from '@vcms/shared';
import { AlertTriangle, FlaskConical, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useConfirm } from '@/components/confirm';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { EmptyState, LoadingRows, PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input, NativeSelect } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { LabAnalyte, LabTest, Species } from '@/lib/types';
import { cn } from '@/lib/utils';

type AnalyteDraft = { id?: string; code: string; name: string; unit: string; resultType: 'NUMERIC' | 'TEXT' | 'OPTION'; options: string; decimals: number };

function toDraft(a: LabAnalyte): AnalyteDraft {
  return { id: a.id, code: a.code, name: a.name, unit: a.unit ?? '', resultType: a.resultType, options: a.options.join(', '), decimals: a.decimals };
}

function TestEditor({ test, onSaved }: { test: (LabTest & { analytes: LabAnalyte[] }) | null; onSaved: (id: string) => void }) {
  const { currency } = useSession();
  const qc = useQueryClient();
  const [f, setF] = useState({ code: '', name: '', category: 'HAEMATOLOGY', sampleType: 'WHOLE_BLOOD_EDTA', performedBy: 'IN_HOUSE', externalLabName: '', modality: '', price: '', turnaroundHours: '', instructions: '', isActive: true });
  const [analytes, setAnalytes] = useState<AnalyteDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setF({
      code: test?.code ?? '',
      name: test?.name ?? '',
      category: test?.category ?? 'HAEMATOLOGY',
      sampleType: test?.sampleType ?? 'WHOLE_BLOOD_EDTA',
      performedBy: test?.performedBy ?? 'IN_HOUSE',
      externalLabName: test?.externalLabName ?? '',
      modality: test?.modality ?? '',
      price: test?.priceMinor != null ? fromMinor(test.priceMinor, currency) : '',
      turnaroundHours: test?.turnaroundHours != null ? String(test.turnaroundHours) : '',
      instructions: test?.instructions ?? '',
      isActive: test?.isActive ?? true,
    });
    setAnalytes(test ? test.analytes.map(toDraft) : [{ code: '', name: '', unit: '', resultType: 'NUMERIC', options: '', decimals: 1 }]);
    setError(null);
  }, [test, currency]);
  const imaging = f.category === 'IMAGING';
  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...f,
        modality: imaging ? f.modality || 'XRAY' : null,
        sampleType: imaging ? 'NONE' : f.sampleType,
        priceMinor: f.price === '' ? null : toMinor(f.price, currency),
        turnaroundHours: f.turnaroundHours === '' ? null : Number(f.turnaroundHours),
        analytes: imaging ? [] : analytes.filter((a) => a.code.trim() && a.name.trim()).map((a) => ({ ...a, unit: a.unit || null, options: a.options.split(',').map((x) => x.trim()).filter(Boolean) })),
      };
      return test ? api.patch<LabTest>(`/lab-tests/${test.id}`, body) : api.post<LabTest>('/lab-tests', body);
    },
    onSuccess: (t) => {
      toast.success('Test saved');
      qc.invalidateQueries({ queryKey: ['lab-tests'] });
      qc.invalidateQueries({ queryKey: ['lab-test', t.id] });
      onSaved(t.id);
    },
    onError: (e: Error) => setError(e.message),
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  return (
    <Card>
      <CardHeader><CardTitle>{test ? `Edit ${test.name}` : 'New test'}</CardTitle></CardHeader>
      <CardContent className="grid gap-3">
        {error && <FormError message={error} />}
        <div className="grid gap-3 sm:grid-cols-[140px_1fr_200px]">
          <Field label="Code" htmlFor="lt-c" required><Input id="lt-c" className="uppercase" value={f.code} onChange={set('code')} /></Field>
          <Field label="Test name" htmlFor="lt-n" required><Input id="lt-n" value={f.name} onChange={set('name')} /></Field>
          <Field label="Category" htmlFor="lt-cat"><NativeSelect id="lt-cat" value={f.category} onChange={set('category')}>{LAB_CATEGORIES.map((c) => <option key={c} value={c}>{enumLabel(c)}</option>)}</NativeSelect></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          {imaging ? (
            <Field label="Modality" htmlFor="lt-mod"><NativeSelect id="lt-mod" value={f.modality} onChange={set('modality')}>{IMAGING_MODALITIES.map((m) => <option key={m} value={m}>{enumLabel(m)}</option>)}</NativeSelect></Field>
          ) : (
            <Field label="Sample" htmlFor="lt-s"><NativeSelect id="lt-s" value={f.sampleType} onChange={set('sampleType')}>{SAMPLE_TYPES.map((s) => <option key={s} value={s}>{enumLabel(s)}</option>)}</NativeSelect></Field>
          )}
          <Field label="Performed" htmlFor="lt-pb"><NativeSelect id="lt-pb" value={f.performedBy} onChange={set('performedBy')}><option value="IN_HOUSE">In-house</option><option value="EXTERNAL">External lab</option></NativeSelect></Field>
          <Field label={`Price (${currency})`} htmlFor="lt-pr"><Input id="lt-pr" inputMode="decimal" value={f.price} onChange={set('price')} /></Field>
          <Field label="Turnaround (h)" htmlFor="lt-ta"><Input id="lt-ta" type="number" value={f.turnaroundHours} onChange={set('turnaroundHours')} /></Field>
        </div>
        {f.performedBy === 'EXTERNAL' && <Field label="External laboratory" htmlFor="lt-ext" required><Input id="lt-ext" value={f.externalLabName} onChange={set('externalLabName')} /></Field>}
        {!imaging && (
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Result fields (analytes)</legend>
            {analytes.map((a, i) => (
              <div key={a.id ?? i} className="grid grid-cols-[90px_1fr_90px_110px_1fr_60px_auto] items-center gap-2 max-lg:grid-cols-3">
                <Input aria-label="Analyte code" placeholder="Code" className="h-8 uppercase" value={a.code} onChange={(e) => setAnalytes(analytes.map((x, j) => (j === i ? { ...x, code: e.target.value } : x)))} />
                <Input aria-label="Analyte name" placeholder="Name" className="h-8" value={a.name} onChange={(e) => setAnalytes(analytes.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <Input aria-label="Unit" placeholder="Unit" className="h-8" value={a.unit} onChange={(e) => setAnalytes(analytes.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))} />
                <NativeSelect aria-label="Result type" className="h-8 text-xs" value={a.resultType} onChange={(e) => setAnalytes(analytes.map((x, j) => (j === i ? { ...x, resultType: e.target.value as AnalyteDraft['resultType'] } : x)))}>
                  <option value="NUMERIC">Numeric</option><option value="TEXT">Text</option><option value="OPTION">Pick list</option>
                </NativeSelect>
                <Input aria-label="Options" placeholder={a.resultType === 'OPTION' ? 'Options, comma-separated' : '—'} disabled={a.resultType !== 'OPTION'} className="h-8" value={a.options} onChange={(e) => setAnalytes(analytes.map((x, j) => (j === i ? { ...x, options: e.target.value } : x)))} />
                <Input aria-label="Decimals" type="number" min={0} max={4} className="h-8" value={a.decimals} onChange={(e) => setAnalytes(analytes.map((x, j) => (j === i ? { ...x, decimals: Number(e.target.value) } : x)))} />
                <Button size="icon-sm" variant="ghost" aria-label="Remove analyte" onClick={() => setAnalytes(analytes.filter((_, j) => j !== i))}><Trash2 /></Button>
              </div>
            ))}
            <Button size="sm" variant="outline" className="w-fit" onClick={() => setAnalytes([...analytes, { code: '', name: '', unit: '', resultType: 'NUMERIC', options: '', decimals: 1 }])}><Plus /> Add field</Button>
          </fieldset>
        )}
        <Field label="Collection / preparation instructions" htmlFor="lt-i"><Input id="lt-i" value={f.instructions} onChange={set('instructions')} /></Field>
        {test && <label className="flex items-center gap-2 text-sm"><Checkbox checked={f.isActive} onCheckedChange={(v) => setF((s) => ({ ...s, isActive: v === true }))} /> Available to order</label>}
        <div className="flex justify-end"><Button loading={save.isPending} disabled={!f.code.trim() || !f.name.trim()} onClick={() => { setError(null); save.mutate(); }}>Save test</Button></div>
      </CardContent>
    </Card>
  );
}

function Intervals({ test }: { test: LabTest & { analytes: LabAnalyte[] } }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const species = useQuery({ queryKey: ['species'], queryFn: () => api.get<Species[]>('/species') });
  const numeric = test.analytes.filter((a) => a.resultType === 'NUMERIC');
  const [f, setF] = useState({ analyteId: numeric[0]?.id ?? '', speciesId: '', sex: '', ageMinMonths: '', ageMaxMonths: '', low: '', high: '', criticalLow: '', criticalHigh: '', source: '' });
  const [error, setError] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: () => api.post('/reference-intervals', { ...f, sex: f.sex || null }),
    onSuccess: () => { toast.success('Interval added'); setF({ ...f, low: '', high: '', criticalLow: '', criticalHigh: '' }); qc.invalidateQueries({ queryKey: ['lab-test', test.id] }); },
    onError: (e: Error) => setError(e.message),
  });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/reference-intervals/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['lab-test', test.id] }) });
  if (!numeric.length) return null;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  return (
    <Card>
      <CardHeader><CardTitle>Reference intervals</CardTitle></CardHeader>
      <div className="flex gap-2 border-b bg-warning/10 p-3 text-xs">
        <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
        <p>Use intervals from your analyser manufacturer, reference laboratory or a validated publication, and cite the source. Without an interval, results are recorded unflagged.</p>
      </div>
      <form className="grid gap-2 border-b p-3" onSubmit={(e) => { e.preventDefault(); setError(null); add.mutate(); }}>
        {error && <FormError message={error} />}
        <div className="flex flex-wrap gap-2">
          <NativeSelect aria-label="Analyte" className="w-40" value={f.analyteId} onChange={set('analyteId')}>{numeric.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</NativeSelect>
          <NativeSelect aria-label="Species" className="w-36" value={f.speciesId} onChange={set('speciesId')}><option value="">Species…</option>{species.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</NativeSelect>
          <NativeSelect aria-label="Sex" className="w-32" value={f.sex} onChange={set('sex')}><option value="">Any sex</option>{PATIENT_SEXES.filter((s) => s === 'MALE' || s === 'FEMALE').map((s) => <option key={s} value={s}>{enumLabel(s)}</option>)}</NativeSelect>
          <Input aria-label="Min age months" placeholder="Age from (m)" className="w-28" value={f.ageMinMonths} onChange={set('ageMinMonths')} />
          <Input aria-label="Max age months" placeholder="Age to (m)" className="w-28" value={f.ageMaxMonths} onChange={set('ageMaxMonths')} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Input aria-label="Low" placeholder="Low" className="w-24" value={f.low} onChange={set('low')} />
          <Input aria-label="High" placeholder="High" className="w-24" value={f.high} onChange={set('high')} />
          <Input aria-label="Critical low" placeholder="Critical ≤" className="w-28" value={f.criticalLow} onChange={set('criticalLow')} />
          <Input aria-label="Critical high" placeholder="Critical ≥" className="w-28" value={f.criticalHigh} onChange={set('criticalHigh')} />
          <Input aria-label="Source" placeholder="Source (analyser / lab / publication)" className="min-w-[200px] flex-1" value={f.source} onChange={set('source')} />
          <Button type="submit" size="sm" disabled={!f.analyteId || !f.speciesId || !f.source.trim()} loading={add.isPending}><Plus /> Add</Button>
        </div>
      </form>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/60 text-muted-foreground"><tr><th className="px-3 py-1.5 text-left">Analyte</th><th className="px-3 py-1.5 text-left">Species</th><th className="px-3 py-1.5 text-left">Sex / age</th><th className="px-3 py-1.5 text-left">Interval</th><th className="px-3 py-1.5 text-left">Critical</th><th className="px-3 py-1.5 text-left">Source</th><th /></tr></thead>
          <tbody>
            {numeric.flatMap((a) => (a.intervals ?? []).map((i) => (
              <tr key={i.id} className="border-t">
                <td className="px-3 py-1.5 font-medium">{a.name}</td>
                <td className="px-3 py-1.5">{i.species.name}</td>
                <td className="px-3 py-1.5">{i.sex ? enumLabel(i.sex) : 'Any'}{(i.ageMinMonths != null || i.ageMaxMonths != null) && ` · ${i.ageMinMonths ?? 0}–${i.ageMaxMonths ?? '∞'} m`}</td>
                <td className="px-3 py-1.5 tabular">{i.low ?? '–'} – {i.high ?? '–'} {a.unit}</td>
                <td className="px-3 py-1.5 tabular">{i.criticalLow != null && `≤${i.criticalLow} `}{i.criticalHigh != null && `≥${i.criticalHigh}`}</td>
                <td className="px-3 py-1.5">{i.source}</td>
                <td className="px-2"><Button size="icon-sm" variant="ghost" aria-label="Remove interval" onClick={async () => { const c = await confirm({ title: 'Remove this interval?', destructive: true, confirmLabel: 'Remove' }); if (c.confirmed) remove.mutate(i.id); }}><Trash2 /></Button></td>
              </tr>
            )))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function CataloguePage() {
  const tests = useQuery({ queryKey: ['lab-tests', 'all'], queryFn: () => api.get<LabTest[]>('/lab-tests?all=true') });
  const [selected, setSelected] = useState<string | 'new' | null>(null);
  const detail = useQuery({ queryKey: ['lab-test', selected], queryFn: () => api.get<LabTest & { analytes: LabAnalyte[] }>(`/lab-tests/${selected}`), enabled: !!selected && selected !== 'new' });
  return (
    <RequirePermission anyOf={['settings.manage']}>
      <PageHeader title="Test catalogue" breadcrumbs={[{ label: 'Laboratory', href: '/lab' }, { label: 'Catalogue' }]} description="Laboratory tests, result fields, sourced reference intervals and imaging studies" />
      <div className="grid gap-4 xl:grid-cols-[280px_1fr]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Tests</CardTitle>
            <Button size="sm" variant="outline" onClick={() => setSelected('new')}><Plus /> New</Button>
          </CardHeader>
          {tests.isLoading ? <LoadingRows rows={3} /> : tests.data?.length ? (
            <ul className="max-h-[70vh] overflow-y-auto p-1">
              {tests.data.map((t) => (
                <li key={t.id}>
                  <button onClick={() => setSelected(t.id)} className={cn('w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted', selected === t.id && 'bg-muted font-medium', !t.isActive && 'text-muted-foreground line-through')}>
                    {t.name}
                    <span className="block text-2xs text-muted-foreground">{t.code} · {enumLabel(t.category)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <EmptyState icon={FlaskConical} title="No tests yet" className="py-6" />}
        </Card>
        <div className="grid content-start gap-4">
          {selected === 'new' && <TestEditor test={null} onSaved={(id) => setSelected(id)} />}
          {selected && selected !== 'new' && (detail.isLoading ? <LoadingRows /> : detail.data && (
            <>
              <TestEditor test={detail.data} onSaved={() => detail.refetch()} />
              <Intervals test={detail.data} />
            </>
          ))}
          {!selected && <EmptyState icon={FlaskConical} title="Select a test or create one" />}
        </div>
      </div>
    </RequirePermission>
  );
}
