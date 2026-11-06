'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SEROLOGY_OUTCOME_LABELS, SEROLOGY_OUTCOMES, type SerologyOutcome, type SerologyTestView } from '@vcms/shared';
import { Ban, CalendarClock, FlaskConical, Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Field } from '../forms/field';
import { FormError } from '../forms/form-error';
import { EmptyState, ErrorState, LoadingRows } from '../page';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardHeader, CardTitle } from '../ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input, NativeSelect, Textarea } from '../ui/input';
import { ApiError, api } from '@/lib/api';
import { fmtDateOnly } from '@/lib/format';
import { useSession } from '@/lib/session';

type Row = SerologyTestView & { voidedAt: string | null; voidedByName: string | null };
const today = () => new Date().toLocaleDateString('en-CA');

const blank = { status: 'COMPLETED' as 'COMPLETED' | 'PLANNED', plannedFor: '', sampleDate: today(), laboratory: '', reference: '', resultValue: '', resultUnit: 'IU/mL', outcome: '' as '' | SerologyOutcome, validFrom: '', validUntil: '', notes: '' };

/** Record a rabies antibody test result, plan one, or finish a planned one. */
function TestDialog({ patientId, test, open, onOpenChange }: { patientId: string; test: Row | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ ...blank, ...(test ? { status: 'COMPLETED' as const, plannedFor: test.plannedFor ?? '', notes: test.notes ?? '' } : {}) });
  const [error, setError] = useState<unknown>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const planning = f.status === 'PLANNED';
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, resultValue: f.resultValue === '' ? null : f.resultValue, outcome: f.outcome || null };
      return test ? api.patch(`/serology/${test.id}`, body) : api.post(`/patients/${patientId}/serology`, body);
    },
    onSuccess: () => {
      toast.success(planning ? 'Test planned' : 'Test recorded');
      qc.invalidateQueries({ queryKey: ['serology', patientId] });
      qc.invalidateQueries({ queryKey: ['diary', patientId] });
      onOpenChange(false);
    },
    onError: (e) => {
      if (e instanceof ApiError && Object.keys(e.fieldErrors).length) setFieldErrors(e.fieldErrors);
      setError(e);
    },
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{test ? 'Record the result' : 'Rabies antibody test'}</DialogTitle>
          <DialogDescription>Rabies serology (titre): a blood test showing the antibody level. A recorded result can’t be edited — it can be voided with a reason.</DialogDescription>
        </DialogHeader>
        {!!error && <FormError error={error} />}
        <div className="grid gap-3">
          {!test && (
            <div role="radiogroup" aria-label="What to record" className="grid grid-cols-2 gap-2">
              {([['COMPLETED', 'Result received'], ['PLANNED', 'Plan a future test']] as const).map(([v, label]) => (
                <Button key={v} type="button" role="radio" aria-checked={f.status === v} variant={f.status === v ? 'default' : 'outline'} onClick={() => setF((s) => ({ ...s, status: v }))}>{label}</Button>
              ))}
            </div>
          )}
          {planning ? (
            <>
              <Field label="Planned for" htmlFor="sr-plan" required error={fieldErrors.plannedFor}><Input id="sr-plan" type="date" value={f.plannedFor} onChange={set('plannedFor')} /></Field>
              <Field label="Notes" htmlFor="sr-notes"><Textarea id="sr-notes" rows={2} maxLength={500} value={f.notes} placeholder="e.g. before travel to the UK" onChange={set('notes')} /></Field>
            </>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Sample taken on" htmlFor="sr-date" required error={fieldErrors.sampleDate}><Input id="sr-date" type="date" value={f.sampleDate} onChange={set('sampleDate')} /></Field>
                <Field label="Laboratory" htmlFor="sr-lab"><Input id="sr-lab" value={f.laboratory} maxLength={160} onChange={set('laboratory')} /></Field>
                <Field label="Lab reference" htmlFor="sr-ref"><Input id="sr-ref" value={f.reference} maxLength={120} onChange={set('reference')} /></Field>
                <Field label="Result" htmlFor="sr-res" error={fieldErrors.resultValue}>
                  <div className="flex gap-2">
                    <Input id="sr-res" inputMode="decimal" value={f.resultValue} placeholder="e.g. 1.8" onChange={set('resultValue')} />
                    <Input aria-label="Unit" className="w-24" value={f.resultUnit} maxLength={20} onChange={set('resultUnit')} />
                  </div>
                </Field>
                <Field label="Outcome" htmlFor="sr-out" required error={fieldErrors.outcome}>
                  <NativeSelect id="sr-out" value={f.outcome} onChange={set('outcome')}>
                    <option value="">Choose…</option>
                    {SEROLOGY_OUTCOMES.map((o) => <option key={o} value={o}>{SEROLOGY_OUTCOME_LABELS[o]}</option>)}
                  </NativeSelect>
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Valid from" htmlFor="sr-from" hint="From the destination’s rules (e.g. after the waiting period)." error={fieldErrors.validFrom}><Input id="sr-from" type="date" value={f.validFrom} onChange={set('validFrom')} /></Field>
                <Field label="Valid until" htmlFor="sr-until" error={fieldErrors.validUntil}><Input id="sr-until" type="date" value={f.validUntil} onChange={set('validUntil')} /></Field>
              </div>
              <Field label="Notes" htmlFor="sr-notes2"><Textarea id="sr-notes2" rows={2} maxLength={500} value={f.notes} onChange={set('notes')} /></Field>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={save.isPending} onClick={() => { setError(null); setFieldErrors({}); save.mutate(); }}>{planning ? 'Plan test' : 'Save result'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VoidDialog({ test, patientId, onClose }: { test: Row; patientId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => api.post(`/serology/${test.id}/void`, { reason }),
    onSuccess: () => {
      toast.success('Test voided');
      qc.invalidateQueries({ queryKey: ['serology', patientId] });
      qc.invalidateQueries({ queryKey: ['diary', patientId] });
      onClose();
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Void this test?</DialogTitle>
          <DialogDescription>It disappears from the pet diary but stays in the record, marked as voided.</DialogDescription>
        </DialogHeader>
        {m.error && <FormError error={m.error} />}
        <Field label="Reason" htmlFor="sr-void"><Textarea id="sr-void" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" disabled={reason.trim().length < 3} loading={m.isPending} onClick={() => m.mutate()}><Ban /> Void</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A patient's rabies antibody tests: results, planned tests, and recording or voiding them. */
export function SerologyCard({ patientId }: { patientId: string }) {
  const { can } = useSession();
  const q = useQuery({ queryKey: ['serology', patientId], queryFn: () => api.get<Row[]>(`/patients/${patientId}/serology`) });
  const [dialog, setDialog] = useState<{ test: Row | null } | null>(null);
  const [voiding, setVoiding] = useState<Row | null>(null);
  const canWrite = can('preventive.write');
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><FlaskConical className="h-4 w-4 text-muted-foreground" /> Rabies antibody tests</CardTitle>
        {canWrite && <Button size="sm" variant="outline" onClick={() => setDialog({ test: null })}><Plus /> Record or plan a test</Button>}
      </CardHeader>
      {q.isLoading ? (
        <LoadingRows />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data?.length ? (
        <ul className="divide-y">
          {q.data.map((t) => (
            <li key={t.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {t.status === 'PLANNED' ? (
                    <><CalendarClock className="h-4 w-4 text-info" /> Planned for {fmtDateOnly(t.plannedFor!)}</>
                  ) : (
                    <>Sample {t.sampleDate ? fmtDateOnly(t.sampleDate) : '—'}{t.resultValue != null && <span className="tabular">· {t.resultValue} {t.resultUnit}</span>}</>
                  )}
                  {t.status === 'COMPLETED' && t.outcome && <Badge variant={t.outcome === 'SATISFACTORY' ? 'success' : 'destructive'}>{SEROLOGY_OUTCOME_LABELS[t.outcome]}</Badge>}
                  {t.status === 'PLANNED' && <Badge variant="info">Planned</Badge>}
                  {t.status === 'VOIDED' && <Badge variant="secondary">Voided</Badge>}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {[t.laboratory, t.reference && `ref. ${t.reference}`, t.validFrom && `valid from ${fmtDateOnly(t.validFrom)}`, t.validUntil && `until ${fmtDateOnly(t.validUntil)}`, t.notes, `by ${t.recordedByName}`].filter(Boolean).join(' · ')}
                </p>
                {t.status === 'VOIDED' && <p className="mt-0.5 text-xs text-destructive">Voided by {t.voidedByName}: {t.voidedReason}</p>}
              </div>
              {canWrite && t.status === 'PLANNED' && <Button size="sm" onClick={() => setDialog({ test: t })}>Record the result</Button>}
              {canWrite && t.status !== 'VOIDED' && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setVoiding(t)}>Void</Button>}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={FlaskConical} title="No antibody tests yet" description="Many countries ask for a rabies antibody test before a pet travels. Record the result here and it prints in the pet diary." />
      )}
      {dialog && <TestDialog key={dialog.test?.id ?? 'new'} patientId={patientId} test={dialog.test} open onOpenChange={(o) => !o && setDialog(null)} />}
      {voiding && <VoidDialog test={voiding} patientId={patientId} onClose={() => setVoiding(null)} />}
    </Card>
  );
}
