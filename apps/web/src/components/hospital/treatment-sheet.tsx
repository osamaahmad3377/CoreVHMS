'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TREATMENT_KINDS, TREATMENT_OVERDUE_GRACE_MINUTES, TREATMENT_SCHEDULES, enumLabel, treatmentTiming } from '@vcms/shared';
import { Check, ChevronLeft, ChevronRight, Clock, Plus, Square, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useConfirm } from '../confirm';
import { Field } from '../forms/field';
import { FormError } from '../forms/form-error';
import { ProductPicker } from '../pharmacy/product-picker';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardHeader, CardTitle } from '../ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input, NativeSelect, Textarea } from '../ui/input';
import { ApiError, api, qs } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import { branchTime, dayLabel, shiftDate, todayIn, zonedInstant } from '@/lib/time';
import type { Product, TreatmentOrder, TreatmentTask } from '@/lib/types';
import { cn } from '@/lib/utils';

const VALUE_LABEL: Record<string, string> = { FEEDING: 'Amount eaten (e.g. 50%, 100 g)', FLUID: 'Volume given or rate check', OBSERVATION: 'Finding', NURSING: 'Result (e.g. urinated, walked)', OTHER: 'Result', MEDICATION: 'Note' };

export function orderSummary(o: TreatmentOrder) {
  const parts = [
    o.kind === 'MEDICATION' && o.dose ? `${o.dose} ${o.doseUnit} ${o.route}` : null,
    o.fluidRateMlPerHour ? `${o.fluidRateMlPerHour} mL/h` : null,
    o.schedule === 'INTERVAL' || (o.schedule === 'CONTINUOUS' && o.intervalHours) ? `every ${o.intervalHours} h` : enumLabel(o.schedule).toLowerCase(),
  ];
  return parts.filter(Boolean).join(' · ');
}

function TaskDialog({ task, order, onClose }: { task: TreatmentTask | null; order: TreatmentOrder | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<'DONE' | 'SKIPPED'>('DONE');
  const [value, setValue] = useState('');
  const [notes, setNotes] = useState('');
  const [skipReason, setSkipReason] = useState('');
  const [batch, setBatch] = useState('');
  const [override, setOverride] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (task || order) { setStatus('DONE'); setValue(''); setNotes(''); setSkipReason(''); setBatch(''); setOverride(null); setError(null); }
  }, [task, order]);
  const o = order;
  const m = useMutation({
    mutationFn: () => {
      const body = { status, value: value || null, notes: notes || null, skipReason: status === 'SKIPPED' ? skipReason : null, batchNumber: batch || null, overrideReason: override || null };
      return task ? api.post(`/treatment-tasks/${task.id}/complete`, body) : api.post(`/treatment-orders/${o!.id}/give`, body);
    },
    onSuccess: () => {
      toast.success(status === 'DONE' ? 'Treatment recorded' : 'Recorded as not done');
      qc.invalidateQueries({ queryKey: ['sheet'] });
      qc.invalidateQueries({ queryKey: ['flowboard'] });
      onClose();
    },
    onError: (e: Error) => {
      if (e instanceof ApiError && e.code === 'SAFETY_OVERRIDE_REQUIRED') setOverride('');
      setError(e.message);
    },
  });
  if (!o) return null;
  return (
    <Dialog open={!!o} onOpenChange={(v) => !v && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{o.description}</DialogTitle>
          <DialogDescription>{orderSummary(o)}{task ? ` · due ${fmtDateTime(task.dueAt)}` : ' · given now'}{o.instructions ? ` — ${o.instructions}` : ''}</DialogDescription>
        </DialogHeader>
        {error && <FormError message={error} />}
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Outcome">
          {(['DONE', 'SKIPPED'] as const).map((s) => (
            <button key={s} type="button" role="radio" aria-checked={status === s} onClick={() => setStatus(s)} className={cn('flex items-center justify-center gap-2 rounded-lg surface-flat p-3 text-sm font-medium', status === s ? (s === 'DONE' ? 'border-success bg-success/10 text-success' : 'border-warning bg-warning/10 text-warning') : 'hover:bg-muted')}>
              {s === 'DONE' ? <><Check className="h-4 w-4" /> {o.kind === 'MEDICATION' ? 'Given' : 'Done'}</> : <><X className="h-4 w-4" /> Not done</>}
            </button>
          ))}
        </div>
        {status === 'SKIPPED' ? (
          <Field label="Why was it not done?" htmlFor="tk-skip" required><Input id="tk-skip" value={skipReason} maxLength={500} onChange={(e) => setSkipReason(e.target.value)} placeholder="e.g. patient vomiting, refused" /></Field>
        ) : (
          <>
            {o.kind === 'MEDICATION' ? (
              <Field label="Batch (optional)" htmlFor="tk-batch" hint="Leave empty to use the batch that expires first."><Input id="tk-batch" value={batch} maxLength={60} onChange={(e) => setBatch(e.target.value)} /></Field>
            ) : (
              <Field label={VALUE_LABEL[o.kind] ?? 'Result'} htmlFor="tk-value"><Input id="tk-value" value={value} maxLength={200} onChange={(e) => setValue(e.target.value)} /></Field>
            )}
          </>
        )}
        <Field label="Notes" htmlFor="tk-notes"><Textarea id="tk-notes" value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} /></Field>
        {override !== null && (
          <Field label="Allergy override reason (vet decision)" htmlFor="tk-override" required><Textarea id="tk-override" value={override} onChange={(e) => setOverride(e.target.value)} /></Field>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button loading={m.isPending} disabled={(status === 'SKIPPED' && !skipReason.trim()) || (override !== null && !override.trim())} onClick={() => { setError(null); m.mutate(); }}>Record</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OrderDialog({ admissionId, open, onOpenChange }: { admissionId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { can } = useSession();
  const blank = { kind: 'NURSING', schedule: 'INTERVAL', description: '', dose: '', doseUnit: '', route: '', fluidRateMlPerHour: '', intervalHours: '8', instructions: '', startAt: '', endAt: '' };
  const [f, setF] = useState(blank);
  const [product, setProduct] = useState<Product | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setF(blank); setProduct(null); setError(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const m = useMutation({
    mutationFn: () =>
      api.post(`/admissions/${admissionId}/orders`, {
        ...f,
        productId: f.kind === 'MEDICATION' ? product?.id : null,
        description: f.description || product?.name || '',
        dose: f.dose || null,
        fluidRateMlPerHour: f.fluidRateMlPerHour || null,
        intervalHours: f.intervalHours || null,
        startAt: f.startAt ? new Date(f.startAt).toISOString() : null,
        endAt: f.endAt ? new Date(f.endAt).toISOString() : null,
      }),
    onSuccess: () => { toast.success('Treatment added to the sheet'); qc.invalidateQueries({ queryKey: ['sheet'] }); onOpenChange(false); },
    onError: (e: Error) => setError(e.message),
  });
  const kinds = TREATMENT_KINDS.filter((k) => k !== 'MEDICATION' || can('prescriptions.write'));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Add treatment</DialogTitle>
          <DialogDescription>Doses, rates and intervals are your clinical decision — the system does not suggest them. Scheduled treatments appear on the sheet for nursing staff to tick off.</DialogDescription>
        </DialogHeader>
        {error && <FormError message={error} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Type" htmlFor="or-kind">
            <NativeSelect id="or-kind" value={f.kind} onChange={set('kind')}>{kinds.map((k) => <option key={k} value={k}>{enumLabel(k, 'treatment')}</option>)}</NativeSelect>
          </Field>
          <Field label="When" htmlFor="or-sched">
            <NativeSelect id="or-sched" value={f.schedule} onChange={set('schedule')}>{TREATMENT_SCHEDULES.map((k) => <option key={k} value={k}>{enumLabel(k, 'treatment')}</option>)}</NativeSelect>
          </Field>
          {f.kind === 'MEDICATION' && (
            <>
              <Field label="Medicine" htmlFor="or-prod" required className="sm:col-span-2"><ProductPicker id="or-prod" value={product} onChange={(p) => { setProduct(p); if (p) setF((s) => ({ ...s, doseUnit: s.doseUnit || p.dispensingUnit })); }} prescribable /></Field>
              <Field label="Dose per administration" htmlFor="or-dose" required><Input id="or-dose" inputMode="decimal" value={f.dose} onChange={set('dose')} /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Unit" htmlFor="or-unit" required><Input id="or-unit" value={f.doseUnit} onChange={set('doseUnit')} /></Field>
                <Field label="How given" htmlFor="or-route" required help="PO = by mouth, IV = into a vein, IM = into a muscle, SC = under the skin."><Input id="or-route" value={f.route} onChange={set('route')} placeholder="PO, IV, SC…" /></Field>
              </div>
            </>
          )}
          {f.kind !== 'MEDICATION' && <Field label="What to do" htmlFor="or-desc" required className="sm:col-span-2"><Input id="or-desc" value={f.description} maxLength={200} onChange={set('description')} placeholder={f.kind === 'FLUID' ? 'e.g. Hartmann’s IV' : f.kind === 'FEEDING' ? 'e.g. Recovery diet' : 'e.g. Walk outside, turn patient'} /></Field>}
          {f.kind === 'FLUID' && <Field label="Rate (mL/hour)" htmlFor="or-rate" required={f.schedule === 'CONTINUOUS'}><Input id="or-rate" inputMode="decimal" value={f.fluidRateMlPerHour} onChange={set('fluidRateMlPerHour')} /></Field>}
          {(f.schedule === 'INTERVAL' || f.schedule === 'CONTINUOUS') && (
            <Field label={f.schedule === 'CONTINUOUS' ? 'Check every (hours)' : 'Every (hours)'} htmlFor="or-int" required={f.schedule === 'INTERVAL'}><Input id="or-int" inputMode="numeric" value={f.intervalHours} onChange={set('intervalHours')} /></Field>
          )}
          <Field label="Start" htmlFor="or-start" hint="Empty = now"><Input id="or-start" type="datetime-local" value={f.startAt} onChange={set('startAt')} /></Field>
          <Field label="Stop after" htmlFor="or-end" hint="Optional"><Input id="or-end" type="datetime-local" value={f.endAt} onChange={set('endAt')} /></Field>
          <Field label="Instructions" htmlFor="or-ins" className="sm:col-span-2"><Textarea id="or-ins" value={f.instructions} maxLength={1000} onChange={set('instructions')} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={m.isPending} onClick={() => { setError(null); m.mutate(); }}>Add to sheet</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TaskChip({ t, onClick }: { t: TreatmentTask; onClick: () => void }) {
  const timing = t.status === 'DUE' ? treatmentTiming(t.dueAt) : null;
  const title = t.status === 'DUE' ? `${timing === 'OVERDUE' ? 'Overdue — was due' : timing === 'DUE_NOW' ? 'Due now —' : 'Due'} ${fmtDateTime(t.dueAt)}` : `${t.status === 'DONE' ? 'Done' : 'Not done'} ${fmtDateTime(t.doneAt)} by ${t.doneByName}${t.value ? ` — ${t.value}` : ''}${t.skipReason ? ` — ${t.skipReason}` : ''}`;
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={t.status !== 'DUE'}
      onClick={onClick}
      className={cn(
        'flex h-7 w-7 items-center justify-center rounded-md border text-xs',
        t.status === 'DONE' && 'border-success/40 bg-success/15 text-success',
        t.status === 'SKIPPED' && 'border-warning/40 bg-warning/15 text-warning',
        t.status === 'DUE' && (timing === 'OVERDUE' ? 'animate-pulse border-destructive bg-destructive/10 text-destructive hover:bg-destructive/20' : timing === 'DUE_NOW' ? 'border-warning bg-warning/10 text-warning hover:bg-warning/20' : 'border-primary/40 text-primary hover:bg-primary/10'),
      )}
    >
      {t.status === 'DONE' ? <Check className="h-3.5 w-3.5" /> : t.status === 'SKIPPED' ? <X className="h-3.5 w-3.5" /> : <Square className="h-3 w-3" />}
    </button>
  );
}

/** Treatment sheet: a "due now" list for nursing staff plus a 24-hour grid of every order. */
export function TreatmentSheet({ admissionId, active }: { admissionId: string; active: boolean }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { session, can } = useSession();
  const tz = session.branch?.timezone ?? 'UTC';
  const [day, setDay] = useState(() => todayIn(tz));
  const [adding, setAdding] = useState(false);
  const [recording, setRecording] = useState<{ task: TreatmentTask | null; order: TreatmentOrder } | null>(null);
  const from = zonedInstant(day, 0, tz).toISOString();
  const to = zonedInstant(shiftDate(day, 1), 0, tz).toISOString();
  const sheet = useQuery({ queryKey: ['sheet', admissionId, day], queryFn: () => api.get<{ orders: TreatmentOrder[] }>(`/admissions/${admissionId}/sheet${qs({ from, to })}`), refetchInterval: 60_000 });
  // Due now: everything overdue or due within the next two hours (independent of the day shown).
  const nowSheet = useQuery({
    queryKey: ['sheet', admissionId, 'now'],
    queryFn: () => api.get<{ orders: TreatmentOrder[] }>(`/admissions/${admissionId}/sheet${qs({ from: new Date(Date.now() - 48 * 3600_000).toISOString(), to: new Date(Date.now() + 2 * 3600_000).toISOString() })}`),
    refetchInterval: 60_000,
    enabled: active,
  });
  const stop = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.post(`/treatment-orders/${id}/stop`, { reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sheet'] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const due = useMemo(
    () => (nowSheet.data?.orders ?? []).flatMap((o) => o.tasks.filter((t) => t.status === 'DUE').map((t) => ({ t, o }))).sort((a, b) => a.t.dueAt.localeCompare(b.t.dueAt)),
    [nowSheet.data],
  );
  const hours = Array.from({ length: 24 }, (_, h) => h);
  const hourOf = (iso: string) => Number(branchTime(iso, tz, 'H'));
  const writable = active && can('hospital.write');

  return (
    <div className="grid gap-4">
      {active && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Clock className="h-4 w-4" /> Due now</CardTitle>
            {writable && <Button size="sm" onClick={() => setAdding(true)}><Plus /> Add treatment</Button>}
          </CardHeader>
          {due.length ? (
            <ul className="divide-y border-t">
              {due.map(({ t, o }) => {
                const timing = treatmentTiming(t.dueAt);
                return (
                  <li key={t.id} className="flex items-center gap-3 px-4 py-2">
                    <span className={cn('w-14 text-sm font-semibold tabular', timing === 'OVERDUE' ? 'text-destructive' : timing === 'DUE_NOW' ? 'text-warning' : 'text-muted-foreground')}>{branchTime(t.dueAt, tz)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{o.description}</span>
                      <span className="block truncate text-xs text-muted-foreground">{orderSummary(o)}{o.instructions ? ` · ${o.instructions}` : ''}</span>
                    </span>
                    {timing === 'OVERDUE' && <Badge variant="destructive">Overdue</Badge>}
                    {timing === 'DUE_NOW' && <Badge variant="warning">Due now</Badge>}
                    {writable && <Button size="sm" onClick={() => setRecording({ task: t, order: o })}>Record</Button>}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-4 pb-4 text-sm text-muted-foreground">Nothing due in the next two hours.</p>
          )}
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Treatment sheet</CardTitle>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon-sm" aria-label="Previous day" onClick={() => setDay((d) => shiftDate(d, -1))}><ChevronLeft /></Button>
            <span className="w-28 text-center text-sm font-medium">{day === todayIn(tz) ? 'Today' : dayLabel(day)}</span>
            <Button variant="outline" size="icon-sm" aria-label="Next day" onClick={() => setDay((d) => shiftDate(d, 1))}><ChevronRight /></Button>
          </div>
        </CardHeader>
        {sheet.data?.orders.length ? (
          <div className="overflow-x-auto border-t">
            <table className="w-full min-w-[1100px] text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                  <th className="sticky left-0 z-10 w-64 bg-muted/40 px-3 py-2 text-left font-medium">Treatment</th>
                  {hours.map((h) => <th key={h} className="w-9 px-0.5 py-2 text-center font-normal tabular">{String(h).padStart(2, '0')}</th>)}
                </tr>
              </thead>
              <tbody>
                {sheet.data.orders.map((o) => (
                  <tr key={o.id} className={cn('border-b last:border-0', o.status !== 'ACTIVE' && 'opacity-60')}>
                    <td className="sticky left-0 z-10 bg-card px-3 py-2 align-top">
                      <p className="font-medium">{o.description} <span className="whitespace-nowrap text-2xs font-normal text-muted-foreground">· {enumLabel(o.kind, 'treatment')}</span></p>
                      <p className="text-xs text-muted-foreground">{orderSummary(o)}</p>
                      <p className="text-2xs text-muted-foreground">{o.status === 'ACTIVE' ? `by ${o.orderedByName}` : `${enumLabel(o.status)}${o.stopReason ? `: ${o.stopReason}` : ''}`}</p>
                      {writable && o.status === 'ACTIVE' && (
                        <div className="mt-1 flex gap-1">
                          {(o.schedule === 'AS_NEEDED' || o.schedule === 'CONTINUOUS') && <Button size="sm" variant="outline" className="h-6 px-2 text-2xs" onClick={() => setRecording({ task: null, order: o })}>Give now</Button>}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-2xs"
                            onClick={async () => { const r = await confirm({ title: `Stop ${o.description}?`, requireReason: true, confirmLabel: 'Stop treatment' }); if (r.confirmed) stop.mutate({ id: o.id, reason: r.reason! }); }}
                          >
                            Stop
                          </Button>
                        </div>
                      )}
                    </td>
                    {hours.map((h) => (
                      <td key={h} className="border-l px-0.5 py-1 text-center align-top">
                        <div className="flex flex-col items-center gap-0.5">
                          {o.tasks.filter((t) => hourOf(t.dueAt) === h).map((t) => <TaskChip key={t.id} t={t} onClick={() => writable && setRecording({ task: t, order: o })} />)}
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-4 pb-4 text-sm text-muted-foreground">{sheet.isLoading ? 'Loading…' : 'No treatments on the sheet yet.'}</p>
        )}
        <p className="border-t px-4 py-2 text-2xs text-muted-foreground">
          <Square className="mr-1 inline h-3 w-3 text-primary" />due · <Check className="mx-1 inline h-3 w-3 text-success" />done · <X className="mx-1 inline h-3 w-3 text-warning" />not done · amber = due now · red = overdue (more than {TREATMENT_OVERDUE_GRACE_MINUTES} min late) · times in {tz}
        </p>
      </Card>
      <TaskDialog task={recording?.task ?? null} order={recording?.order ?? null} onClose={() => setRecording(null)} />
      <OrderDialog admissionId={admissionId} open={adding} onOpenChange={setAdding} />
    </div>
  );
}
