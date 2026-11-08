'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toothInfo, type Paginated } from '@vcms/shared';
import { ChevronDown, ScanLine } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { toothWords } from '../dental/odontogram';
import { ToothEditor, type ToothPayload } from '../dental/tooth-editor';
import { useVisitDental, type VisitDental } from '../dental/visit-dental';
import { LabStatusBadge } from '../lab/lab-status';
import { LabOrderDetail } from '../lab/order-detail';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog';
import { api, qs } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { DentalChart, DiagnosticOrder } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * In the diagnosis of a dental visit: the teeth that were X-rayed or tested, each with its tests and their results.
 * Tap a tooth to record what the X-ray or test showed (findings and a note, saved on the dental chart as you go), so
 * the diagnosis suggestions follow.
 */
export function TestedTeeth({ encounterId, patientId }: { encounterId: string; patientId: string }) {
  const qc = useQueryClient();
  const { can } = useSession();
  const orders = useQuery({
    queryKey: ['lab-orders', { patientId, encounterId }],
    queryFn: () => api.get<Paginated<DiagnosticOrder>>(`/lab-orders${qs({ patientId, encounterId, pageSize: 50 })}`),
    enabled: can('lab.read'),
  });
  const dental = useVisitDental(encounterId);
  const chart = (dental.data?.charts ?? []).find((c) => c.status === 'DRAFT') ?? dental.data?.charts[0] ?? null;
  const [open, setOpen] = useState<string | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);
  const editable = !!chart && chart.status === 'DRAFT' && can('clinical.write');

  const save = useMutation({
    mutationFn: (teeth: ToothPayload[]) => api.put<DentalChart>(`/dental/charts/${chart!.id}/teeth`, { teeth }),
    onSuccess: (c) => qc.setQueryData<VisitDental>(['encounter-dental', encounterId], (d) => (d ? { ...d, charts: d.charts.map((x) => (x.id === c.id ? c : x)) } : d)),
    onError: (e: Error) => toast.error(e.message),
  });

  // Each tooth with the orders made for it (cancelled ones left out).
  const byTooth = new Map<string, DiagnosticOrder[]>();
  for (const o of orders.data?.data ?? []) {
    if (o.status === 'CANCELLED') continue;
    for (const t of o.teeth ?? []) byTooth.set(t, [...(byTooth.get(t) ?? []), o]);
  }
  if (!chart || !byTooth.size) return null;
  const teeth = [...byTooth.keys()].sort();

  return (
    <section className="grid gap-2" aria-labelledby="qc-tested-teeth">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 id="qc-tested-teeth" className="flex items-center gap-2 text-[15px] font-medium">
          <ScanLine className="h-4 w-4 text-primary" /> Teeth X-rayed or tested
        </h2>
        <span className="text-xs text-muted-foreground">Tap a tooth to record what the X-ray or test showed.</span>
      </div>
      <ul className="grid gap-2">
        {teeth.map((t) => {
          const tooth = chart.teeth.find((x) => x.tooth === t);
          const words = [...toothWords(tooth), tooth?.notes].filter(Boolean);
          const isOpen = open === t;
          return (
            <li key={t} className={cn('rounded-xl border', isOpen ? 'border-primary/40 bg-primary/[0.03]' : 'bg-background')}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
                <button type="button" aria-expanded={isOpen} aria-label={`Tooth ${t}`} onClick={() => setOpen(isOpen ? null : t)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  <span className="grid h-8 min-w-11 place-items-center rounded-lg bg-primary/10 px-1.5 text-sm font-bold tabular text-primary">{t}</span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{(toothInfo(chart.dentition, t)?.name ?? '').replace(/\s*\(\d+\)$/, '')}</span>
                    <span className="block text-xs text-muted-foreground">{words.length ? words.join(' · ') : 'Nothing recorded yet'}</span>
                  </span>
                  <ChevronDown className={cn('ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-180')} />
                </button>
                <div className="flex flex-wrap items-center gap-1.5">
                  {byTooth.get(t)!.map((o) => (
                    <Button key={o.id} type="button" size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => setViewId(o.id)} title="Open the results">
                      {o.items.map((i) => i.test.name).join(', ')}
                      <LabStatusBadge status={o.status} />
                    </Button>
                  ))}
                </div>
              </div>
              {isOpen && editable && (
                <div className="border-t p-3">
                  <ToothEditor dentition={chart.dentition} selected={[t]} teeth={chart.teeth} saving={save.isPending} onSave={(p) => save.mutate(p)} onClear={() => setOpen(null)} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <Dialog open={!!viewId} onOpenChange={(o) => !o && setViewId(null)}>
        <DialogContent size="xl" className="max-h-[90vh] overflow-y-auto">
          <DialogTitle className="sr-only">Test or X-ray results</DialogTitle>
          <DialogDescription className="sr-only">The tests, results and reports for this order.</DialogDescription>
          {viewId && <LabOrderDetail id={viewId} embedded />}
        </DialogContent>
      </Dialog>
    </section>
  );
}
