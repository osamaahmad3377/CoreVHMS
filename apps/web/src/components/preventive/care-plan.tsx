'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CARE_KINDS, enumLabel } from '@vcms/shared';
import { Ban, CalendarClock, CheckCircle2, ClipboardPlus, Plus, Printer, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useConfirm } from '../confirm';
import { Field } from '../forms/field';
import { FormError } from '../forms/form-error';
import { EmptyState } from '../page';
import { BatchPicker } from '../pharmacy/batch-picker';
import { ProductPicker } from '../pharmacy/product-picker';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardHeader, CardTitle } from '../ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input, NativeSelect, Textarea } from '../ui/input';
import { ApiError, api } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { Administration, CareItem, Product } from '@/lib/types';
import { cn } from '@/lib/utils';

export function CareStatusBadge({ item }: { item: Pick<CareItem, 'status' | 'overdue'> }) {
  if (item.overdue) return <Badge variant="destructive">Overdue</Badge>;
  const v = { DUE: 'info', COMPLETED: 'success', CANCELLED: 'secondary', DEFERRED: 'warning' } as const;
  return <Badge variant={v[item.status]}>{enumLabel(item.status)}</Badge>;
}

function CompleteDialog({ item, onClose }: { item: CareItem | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { can } = useSession();
  const [mode, setMode] = useState<'ADMINISTER' | 'ELSEWHERE' | 'DONE'>('ADMINISTER');
  const [product, setProduct] = useState<Product | null>(null);
  const [f, setF] = useState({ dose: '', doseUnit: '', route: '', batchNumber: '', expiryDate: '', productName: '', notes: '', completedAt: '' });
  const [override, setOverride] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const prescribable = item?.kind === 'VACCINATION' || item?.kind === 'DEWORMING' || item?.kind === 'PARASITE_PREVENTION';
  const prefilled = useRef<string | null>(null);
  useEffect(() => {
    prefilled.current = null;
    if (!item) return;
    setMode(prescribable && can('clinical.write') ? 'ADMINISTER' : prescribable ? 'ELSEWHERE' : 'DONE');
    setProduct(null);
    setF({ dose: '', doseUnit: '', route: '', batchNumber: '', expiryDate: '', productName: '', notes: '', completedAt: '' });
    setOverride(null);
    setError(null);
  }, [item, prescribable, can]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  // Prefill from the protocol's product, and dose, unit and route from the last time this animal had it.
  const protocolProductId = item?.protocol?.productId ?? null;
  const protocolProduct = useQuery({ queryKey: ['product', protocolProductId], queryFn: () => api.get<Product>(`/products/${protocolProductId}`), enabled: !!item && !!protocolProductId && can('clinical.write') });
  const previous = useQuery({ queryKey: ['administrations', item?.patientId, 'care'], queryFn: () => api.get<Administration[]>(`/patients/${item!.patientId}/administrations`), enabled: !!item && !!protocolProductId && can('clinical.read') });
  useEffect(() => {
    if (!item || !protocolProduct.data || prefilled.current === item.id || previous.isLoading) return;
    prefilled.current = item.id;
    const p = protocolProduct.data;
    const last = previous.data?.find((a) => a.product.id === p.id && a.status === 'GIVEN');
    // The dose is in the product's own unit, so the stock it comes from is deducted and charged.
    const sameUnit = last && last.doseUnit.toLowerCase() === p.dispensingUnit.toLowerCase();
    setProduct(p);
    setF((s) => ({ ...s, doseUnit: s.doseUnit || p.dispensingUnit, dose: s.dose || (sameUnit ? String(last.dose) : ''), route: s.route || last?.route || '' }));
  }, [item, protocolProduct.data, previous.data, previous.isLoading]);
  const unitMismatch = !!product && !!f.doseUnit && f.doseUnit.toLowerCase() !== product.dispensingUnit.toLowerCase();
  const m = useMutation({
    mutationFn: () =>
      api.post(`/care-items/${item!.id}/complete`, {
        mode,
        productId: mode === 'ADMINISTER' ? product?.id : null,
        dose: f.dose || null,
        doseUnit: f.doseUnit || null,
        route: f.route || null,
        batchNumber: f.batchNumber || null,
        expiryDate: f.expiryDate || null,
        productName: f.productName || null,
        notes: f.notes || null,
        completedAt: f.completedAt ? new Date(f.completedAt).toISOString() : null,
        overrideReason: override || null,
      }),
    onSuccess: () => {
      toast.success(`${item!.title} recorded`);
      qc.invalidateQueries({ queryKey: ['care-plan'] });
      qc.invalidateQueries({ queryKey: ['care-items'] });
      onClose();
    },
    onError: (e: Error) => {
      if (e instanceof ApiError && e.code === 'SAFETY_OVERRIDE_REQUIRED') setOverride('');
      setError(e.message);
    },
  });
  if (!item) return null;
  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record: {item.title}</DialogTitle>
          <DialogDescription>{item.protocol?.intervalDays ? `The next one is scheduled automatically ${item.protocol.intervalDays} days later.` : 'This item does not repeat automatically.'}</DialogDescription>
        </DialogHeader>
        {error && <FormError message={error} />}
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="How was it done">
          {([['ADMINISTER', 'Given here'], ['ELSEWHERE', 'Given elsewhere'], ['DONE', 'Done (no product)']] as const).map(([k, label]) => (
            <button key={k} type="button" role="radio" aria-checked={mode === k} disabled={k === 'ADMINISTER' && !can('clinical.write')} onClick={() => setMode(k)} className={cn('rounded-md border p-2 text-sm disabled:opacity-40', mode === k ? 'border-primary bg-primary/10 font-medium text-primary' : 'hover:bg-muted')}>
              {label}
            </button>
          ))}
        </div>
        {mode === 'ADMINISTER' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Product" htmlFor="cc-prod" required className="sm:col-span-2" hint={protocolProductId && product?.id === protocolProductId ? 'From the protocol' : undefined}><ProductPicker id="cc-prod" value={product} onChange={(p) => { setProduct(p); setF((s) => ({ ...s, batchNumber: '', expiryDate: '', doseUnit: p ? s.doseUnit || p.dispensingUnit : s.doseUnit })); }} prescribable /></Field>
            <Field label="Dose" htmlFor="cc-dose" required><Input id="cc-dose" inputMode="decimal" value={f.dose} onChange={set('dose')} /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Unit" htmlFor="cc-unit" required><Input id="cc-unit" value={f.doseUnit} onChange={set('doseUnit')} /></Field>
              <Field label="How given" htmlFor="cc-route" required help="SC = under the skin, IM = into a muscle, PO = by mouth, IN = into the nose."><Input id="cc-route" value={f.route} onChange={set('route')} placeholder="SC, IM, PO…" /></Field>
            </div>
            {unitMismatch && (
              <p className="text-xs text-warning sm:col-span-2">Stock is deducted and charged only when the dose is in the product’s unit ({product!.dispensingUnit}). In {f.doseUnit}, nothing is taken from stock or billed.</p>
            )}
            {product && (
              <div className="sm:col-span-2">
                <BatchPicker id="cc-batch" productId={product.id} quantity={!unitMismatch && Number(f.dose) > 0 ? Number(f.dose) : undefined} value={{ batchNumber: f.batchNumber, expiryDate: f.expiryDate }} onChange={(v) => setF((s) => ({ ...s, ...v }))} />
              </div>
            )}
          </div>
        )}
        {mode === 'ELSEWHERE' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Product given" htmlFor="cc-pname" required className="sm:col-span-2"><Input id="cc-pname" value={f.productName} onChange={set('productName')} /></Field>
            <Field label="Batch (if known)" htmlFor="cc-ebatch"><Input id="cc-ebatch" value={f.batchNumber} onChange={set('batchNumber')} /></Field>
            <Field label="Date given" htmlFor="cc-date"><Input id="cc-date" type="date" value={f.completedAt} onChange={set('completedAt')} /></Field>
          </div>
        )}
        <Field label="Notes" htmlFor="cc-notes"><Textarea id="cc-notes" value={f.notes} onChange={set('notes')} /></Field>
        {override !== null && <Field label="Allergy override reason (vet decision)" htmlFor="cc-ovr" required><Textarea id="cc-ovr" value={override} onChange={(e) => setOverride(e.target.value)} /></Field>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button loading={m.isPending} onClick={() => { setError(null); m.mutate(); }}>Record</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeferDialog({ item, onClose }: { item: CareItem | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [until, setUntil] = useState('');
  const [reason, setReason] = useState('');
  useEffect(() => { setUntil(''); setReason(''); }, [item]);
  const m = useMutation({
    mutationFn: () => api.post(`/care-items/${item!.id}/defer`, { until, reason }),
    onSuccess: () => { toast.success('Deferred'); qc.invalidateQueries({ queryKey: ['care-plan'] }); qc.invalidateQueries({ queryKey: ['care-items'] }); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <DialogHeader><DialogTitle>Defer {item?.title}</DialogTitle><DialogDescription>The client is reminded again before the new date.</DialogDescription></DialogHeader>
        <Field label="New date" htmlFor="df-until" required><Input id="df-until" type="date" value={until} onChange={(e) => setUntil(e.target.value)} /></Field>
        <Field label="Reason" htmlFor="df-reason" required><Input id="df-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Patient unwell, owner travelling" /></Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!until || !reason.trim()} loading={m.isPending} onClick={() => m.mutate()}>Defer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddItemDialog({ patientId, open, onOpenChange }: { patientId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ kind: 'HEALTH_CHECK', title: '', dueDate: '', notes: '' });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setF({ kind: 'HEALTH_CHECK', title: '', dueDate: '', notes: '' }); setError(null); } }, [open]);
  const m = useMutation({
    mutationFn: () => api.post('/care-items', { patientId, ...f, notes: f.notes || null }),
    onSuccess: () => { toast.success('Added to the care plan'); qc.invalidateQueries({ queryKey: ['care-plan'] }); onOpenChange(false); },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader><DialogTitle>Add to care plan</DialogTitle><DialogDescription>A one-off item, such as a weight check or a dental recheck.</DialogDescription></DialogHeader>
        {error && <FormError message={error} />}
        <Field label="Type" htmlFor="ai-kind"><NativeSelect id="ai-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{CARE_KINDS.map((k) => <option key={k} value={k}>{enumLabel(k)}</option>)}</NativeSelect></Field>
        <Field label="What" htmlFor="ai-title" required><Input id="ai-title" value={f.title} maxLength={160} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Due" htmlFor="ai-due" required><Input id="ai-due" type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
        <Field label="Notes" htmlFor="ai-notes"><Textarea id="ai-notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!f.title.trim() || !f.dueDate} loading={m.isPending} onClick={() => { setError(null); m.mutate(); }}>Add</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Patient care plan: vaccinations, parasite control and health checks, with history and certificate. */
export function CarePlan({ patientId, active }: { patientId: string; active: boolean }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { can } = useSession();
  const [completing, setCompleting] = useState<CareItem | null>(null);
  const [deferring, setDeferring] = useState<CareItem | null>(null);
  const [adding, setAdding] = useState(false);
  const q = useQuery({ queryKey: ['care-plan', patientId], queryFn: () => api.get<{ items: CareItem[]; availableProtocols: { id: string; name: string; kind: string }[] }>(`/patients/${patientId}/care-plan`) });
  const apply = useMutation({
    mutationFn: () => api.post<{ created: number }>(`/patients/${patientId}/care-plan/apply`, {}),
    onSuccess: (r) => { toast.success(r.created ? `${r.created} item(s) added from your protocols` : 'The care plan is already up to date'); qc.invalidateQueries({ queryKey: ['care-plan', patientId] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const cancel = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.post(`/care-items/${id}/cancel`, { reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['care-plan', patientId] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const remind = useMutation({
    mutationFn: (id: string) => api.post<{ status: string }>(`/care-items/${id}/remind`),
    onSuccess: (r) => toast.success(r.status === 'OPTED_OUT' ? 'The owner has opted out of reminders' : r.status === 'SKIPPED' ? 'Not sent: no provider or contact for the preferred channel (see Messages)' : 'Reminder queued'),
    onError: (e: Error) => toast.error(e.message),
  });
  const items = q.data?.items ?? [];
  const open = items.filter((i) => i.status === 'DUE' || i.status === 'DEFERRED');
  const history = items.filter((i) => i.status === 'COMPLETED' || i.status === 'CANCELLED').sort((a, b) => (b.completedAt ?? b.dueDate).localeCompare(a.completedAt ?? a.dueDate));
  const writable = active && can('preventive.write');
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" /> Due & upcoming</CardTitle>
          <div className="flex flex-wrap gap-2">
            {writable && !!q.data?.availableProtocols.length && <Button size="sm" variant="outline" loading={apply.isPending} onClick={() => apply.mutate()}><ClipboardPlus /> Add from protocols ({q.data.availableProtocols.length})</Button>}
            {writable && <Button size="sm" variant="outline" onClick={() => setAdding(true)}><Plus /> Add item</Button>}
            <Button size="sm" variant="outline" asChild><Link href={`/patients/${patientId}/certificate`}><Printer /> Vaccination certificate</Link></Button>
          </div>
        </CardHeader>
        {open.length ? (
          <ul className="divide-y border-t">
            {open.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{i.title} <span className="text-xs font-normal text-muted-foreground">· {enumLabel(i.kind)}</span></p>
                  <p className={cn('text-xs', i.overdue ? 'font-medium text-destructive' : 'text-muted-foreground')}>
                    Due {fmtDate(i.effectiveDueDate)}{i.status === 'DEFERRED' && ` (deferred: ${i.deferReason})`}{i.remindedAt && ` · reminder sent ${fmtDate(i.remindedAt)}`}
                  </p>
                </div>
                <CareStatusBadge item={i} />
                {writable && (
                  <div className="flex gap-1">
                    <Button size="sm" onClick={() => setCompleting(i)}><CheckCircle2 /> Record</Button>
                    <Button size="sm" variant="ghost" onClick={() => setDeferring(i)}><CalendarClock /> Defer</Button>
                    {can('communications.send') && <Button size="sm" variant="ghost" loading={remind.isPending && remind.variables === i.id} onClick={() => remind.mutate(i.id)}>Remind</Button>}
                    <Button size="sm" variant="ghost" aria-label={`Cancel ${i.title}`} onClick={async () => { const r = await confirm({ title: `Cancel ${i.title}?`, requireReason: true, confirmLabel: 'Cancel item' }); if (r.confirmed) cancel.mutate({ id: i.id, reason: r.reason! }); }}><Ban /></Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="Nothing due"
            description={
              q.data?.availableProtocols.length
                ? writable
                  ? 'Use “Add from protocols” to build this animal’s care plan from your approved protocols.'
                  : active
                    ? 'A vet can add protocols to build this care plan.'
                    : 'No care plan items were recorded for this animal.'
                : writable
                  ? 'Approved protocols for this species are already in the plan, or none have been set up yet (Preventive care → Protocols).'
                  : 'No preventive care is scheduled for this animal yet.'
            }
            className="py-8"
          />
        )}
      </Card>
      <Card>
        <CardHeader><CardTitle>History</CardTitle></CardHeader>
        {history.length ? (
          <ul className="divide-y border-t">
            {history.map((i) => (
              <li key={i.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                <span className="w-28 text-xs text-muted-foreground">{fmtDate(i.completedAt ?? i.dueDate)}</span>
                <span className="min-w-0 flex-1">{i.title}{i.givenElsewhere && <span className="text-xs text-muted-foreground"> · given elsewhere{i.productName ? ` (${i.productName})` : ''}</span>}{i.batchNumber && <span className="text-xs text-muted-foreground"> · batch {i.batchNumber}</span>}{i.cancelReason && <span className="text-xs text-muted-foreground"> · {i.cancelReason}</span>}</span>
                <span className="text-xs text-muted-foreground">{i.completedByName}</span>
                <CareStatusBadge item={i} />
              </li>
            ))}
          </ul>
        ) : <p className="px-4 pb-4 text-sm text-muted-foreground">No completed care yet.</p>}
      </Card>
      <CompleteDialog item={completing} onClose={() => setCompleting(null)} />
      <DeferDialog item={deferring} onClose={() => setDeferring(null)} />
      <AddItemDialog patientId={patientId} open={adding} onOpenChange={setAdding} />
    </div>
  );
}
