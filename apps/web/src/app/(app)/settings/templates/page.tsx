'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EXAM_SYSTEMS, SPECIES_CATEGORIES, enumLabel } from '@vcms/shared';
import { FileText, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { EmptyState, LoadingRows } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { api } from '@/lib/api';
import type { ClinicalTemplateRow } from '@/lib/types';
import { cn } from '@/lib/utils';

const blank = (): Omit<ClinicalTemplateRow, 'id'> => ({ name: '', speciesCategory: null, presentingComplaint: '', subjective: '', objective: '', assessment: '', plan: '', examSystems: [], isActive: true });

export default function TemplatesPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['clinical-templates', 'all'], queryFn: () => api.get<ClinicalTemplateRow[]>('/clinical-templates?all=true') });
  const [selected, setSelected] = useState<string | 'new' | null>(null);
  const current = selected === 'new' ? null : q.data?.find((t) => t.id === selected) ?? null;
  const [f, setF] = useState(blank());
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setF(current ? { ...current } : blank());
    setError(null);
  }, [current, selected]);
  const save = useMutation({
    mutationFn: () => (current ? api.patch<ClinicalTemplateRow>(`/clinical-templates/${current.id}`, f) : api.post<ClinicalTemplateRow>('/clinical-templates', f)),
    onSuccess: (t) => {
      toast.success('Template saved');
      qc.invalidateQueries({ queryKey: ['clinical-templates'] });
      setSelected(t.id);
    },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <RequirePermission anyOf={['settings.manage']}>
      <div className="grid gap-4 xl:grid-cols-[260px_1fr]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Consultation templates</CardTitle>
            <Button size="sm" variant="outline" onClick={() => setSelected('new')}><Plus /> Add template</Button>
          </CardHeader>
          {q.isLoading ? <LoadingRows rows={3} /> : q.data?.length ? (
            <ul className="p-1">
              {q.data.map((t) => (
                <li key={t.id}>
                  <button onClick={() => setSelected(t.id)} className={cn('w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted', selected === t.id && 'bg-muted font-medium', !t.isActive && 'text-muted-foreground line-through')}>
                    {t.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : <EmptyState icon={FileText} title="No templates" className="py-6" />}
        </Card>
        {selected ? (
          <Card>
            <CardContent className="grid gap-3 pt-4">
              {error && <FormError message={error} />}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Template name" htmlFor="t-n" required><Input id="t-n" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
                <Field label="Species group" htmlFor="t-s">
                  <NativeSelect id="t-s" value={f.speciesCategory ?? ''} onChange={(e) => setF({ ...f, speciesCategory: e.target.value || null })}>
                    <option value="">Any</option>
                    {SPECIES_CATEGORIES.map((c) => <option key={c} value={c}>{enumLabel(c)}</option>)}
                  </NativeSelect>
                </Field>
              </div>
              {(['presentingComplaint', 'subjective', 'objective', 'assessment', 'plan'] as const).map((k) => (
                <Field key={k} label={{ presentingComplaint: 'Presenting complaint', subjective: 'Subjective', objective: 'Objective', assessment: 'Assessment', plan: 'Plan' }[k]} htmlFor={`t-${k}`}>
                  <Textarea id={`t-${k}`} rows={k === 'presentingComplaint' ? 1 : 3} value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
                </Field>
              ))}
              <fieldset>
                <legend className="mb-1 text-sm font-medium">Examination checklist</legend>
                <div className="grid gap-1 sm:grid-cols-3">
                  {EXAM_SYSTEMS.map((s) => (
                    <label key={s} className="flex items-center gap-2 text-sm">
                      <Checkbox checked={f.examSystems.includes(s)} onCheckedChange={(v) => setF({ ...f, examSystems: v === true ? [...f.examSystems, s] : f.examSystems.filter((x) => x !== s) })} /> {s}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={f.isActive} onCheckedChange={(v) => setF({ ...f, isActive: v === true })} /> Active</label>
              <div className="flex justify-end"><Button loading={save.isPending} disabled={!f.name.trim()} onClick={() => save.mutate()}>Save template</Button></div>
            </CardContent>
          </Card>
        ) : (
          <EmptyState icon={FileText} title="Select or create a template" description="Templates pre-fill the note sections and the examination checklist. They never contain doses — clinicians write treatment plans." />
        )}
      </div>
    </RequirePermission>
  );
}
