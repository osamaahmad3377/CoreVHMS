'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ORDER_PRIORITIES, enumLabel } from '@vcms/shared';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Field } from '../forms/field';
import { FormError } from '../forms/form-error';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input, NativeSelect, Textarea } from '../ui/input';
import { api } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { DiagnosticOrder, LabTest } from '@/lib/types';

export function LabOrderDialog({ open, onOpenChange, patient, encounterId, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; patient: { id: string; name: string }; encounterId?: string | null; onCreated?: (o: DiagnosticOrder) => void }) {
  const { currency } = useSession();
  const qc = useQueryClient();
  const tests = useQuery({ queryKey: ['lab-tests'], queryFn: () => api.get<LabTest[]>('/lab-tests'), enabled: open, staleTime: 120_000 });
  const [selected, setSelected] = useState<string[]>([]);
  const [priority, setPriority] = useState('ROUTINE');
  const [notes, setNotes] = useState('');
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setSelected([]);
      setPriority('ROUTINE');
      setNotes('');
      setFilter('');
      setError(null);
    }
  }, [open]);
  const grouped = useMemo(() => {
    const list = (tests.data ?? []).filter((t) => !filter || `${t.name} ${t.code}`.toLowerCase().includes(filter.toLowerCase()));
    return list.reduce<Record<string, LabTest[]>>((acc, t) => ((acc[t.category] ??= []).push(t), acc), {});
  }, [tests.data, filter]);
  const total = (tests.data ?? []).filter((t) => selected.includes(t.id)).reduce((n, t) => n + (t.priceMinor ?? 0), 0);
  const m = useMutation({
    mutationFn: () => api.post<DiagnosticOrder>('/lab-orders', { patientId: patient.id, encounterId, testIds: selected, priority, clinicalNotes: notes }),
    onSuccess: (o) => {
      toast.success(`${o.orderNo} ordered`);
      qc.invalidateQueries({ queryKey: ['lab-orders'] });
      qc.invalidateQueries({ queryKey: ['encounter'] });
      onCreated?.(o);
      onOpenChange(false);
    },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Order diagnostics — {patient.name}</DialogTitle>
          <DialogDescription>Laboratory tests and imaging. Samples are collected and labelled from the lab worklist.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {error && <FormError message={error} />}
          <Input placeholder="Filter tests…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter tests" />
          <div className="max-h-72 overflow-y-auto rounded-md border p-2">
            {tests.isLoading && <p className="p-2 text-sm text-muted-foreground">Loading catalogue…</p>}
            {!tests.isLoading && !Object.keys(grouped).length && <p className="p-2 text-sm text-muted-foreground">No tests in the catalogue. Add them under Laboratory → Catalogue.</p>}
            {Object.entries(grouped).map(([cat, list]) => (
              <fieldset key={cat} className="mb-2">
                <legend className="px-1 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{enumLabel(cat)}</legend>
                {list.map((t) => (
                  <label key={t.id} className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted">
                    <Checkbox checked={selected.includes(t.id)} onCheckedChange={(v) => setSelected((s) => (v === true ? [...s, t.id] : s.filter((x) => x !== t.id)))} />
                    <span className="flex-1">{t.name} <span className="text-xs text-muted-foreground">{t.code}{t.performedBy === 'EXTERNAL' && ` · ${t.externalLabName}`}</span></span>
                    {t.priceMinor != null && <span className="text-xs tabular text-muted-foreground">{fmtMoney(t.priceMinor, currency)}</span>}
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
            <Field label="Priority" htmlFor="lo-p">
              <NativeSelect id="lo-p" value={priority} onChange={(e) => setPriority(e.target.value)}>{ORDER_PRIORITIES.map((p) => <option key={p} value={p}>{enumLabel(p)}</option>)}</NativeSelect>
            </Field>
            <Field label="Clinical notes for the laboratory" htmlFor="lo-n"><Textarea id="lo-n" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          </div>
        </div>
        <DialogFooter className="sm:items-center">
          {total > 0 && <span className="mr-auto text-sm text-muted-foreground">Estimated {fmtMoney(total, currency)}</span>}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!selected.length} loading={m.isPending} onClick={() => { setError(null); m.mutate(); }}>Order {selected.length || ''} test{selected.length === 1 ? '' : 's'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
