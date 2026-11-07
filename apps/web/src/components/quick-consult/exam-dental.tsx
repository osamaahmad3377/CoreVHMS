'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DENTITION_LABELS, DENTITIONS, teethFor, type Dentition } from '@vcms/shared';
import { ExternalLink, Smile } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Odontogram, OdontogramLegend } from '../dental/odontogram';
import { ToothEditor, toothPayload, type ToothForm } from '../dental/tooth-editor';
import { dentalSummary, useVisitDental, type VisitDental } from '../dental/visit-dental';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { api } from '@/lib/api';
import { useModuleOn, useSession } from '@/lib/session';
import type { DentalChart } from '@/lib/types';
import { cn } from '@/lib/utils';

const QUADRANTS = ['Upper right', 'Upper left', 'Lower left', 'Lower right'];

/**
 * The dental chart inside the Examination step of a dental visit: start it with one tap (the species' tooth chart,
 * starting from the last signed one), tap teeth to record findings, and open the full chart for procedures and signing.
 * It is the visit's own dental chart, so its procedures go on this visit's bill.
 */
export function ExamDental({ encounterId, patientId, editable }: { encounterId: string; patientId: string; editable: boolean }) {
  const qc = useQueryClient();
  const moduleOn = useModuleOn();
  const { can } = useSession();
  const q = useVisitDental(encounterId);
  const [pick, setPick] = useState<Dentition | ''>('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const charts = q.data?.charts ?? [];
  const chart = charts.find((c) => c.status === 'DRAFT') ?? charts[0] ?? null;
  const dentition = pick || q.data?.suggestedDentition || '';
  const canWrite = editable && can('clinical.write');
  const canEdit = !!chart && chart.status === 'DRAFT' && canWrite;

  const putChart = (c: DentalChart) => {
    qc.setQueryData<VisitDental>(['encounter-dental', encounterId], (d) => (d ? { ...d, charts: d.charts.some((x) => x.id === c.id) ? d.charts.map((x) => (x.id === c.id ? c : x)) : [c, ...d.charts] } : d));
    qc.invalidateQueries({ queryKey: ['patient-dental', patientId] });
    qc.invalidateQueries({ queryKey: ['dental-chart', c.id] });
  };
  const start = useMutation({
    mutationFn: () => api.post<DentalChart>('/dental/charts', { patientId, dentition, showDeciduous: false, carryForward: true, encounterId }),
    onSuccess: putChart,
    onError: (e: Error) => toast.error(e.message),
  });
  const save = useMutation({
    mutationFn: (f: ToothForm) => api.put<DentalChart>(`/dental/charts/${chart!.id}/teeth`, { teeth: [...selected].map((t) => toothPayload(t, f)) }),
    onSuccess: (c) => {
      putChart(c);
      toast.success(`Saved ${selected.size === 1 ? [...selected][0] : `${selected.size} teeth`}`);
      setSelected(new Set());
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const adult = useMemo(() => (chart ? teethFor(chart.dentition) : []), [chart]);
  const baby = useMemo(() => (chart ? teethFor(chart.dentition, true) : []), [chart]);
  if (!moduleOn('dental') || !can('clinical.read') || q.isLoading) return null;

  const toggle = (t: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(t)) n.delete(t);
      else n.add(t);
      return n;
    });
  const sel = [...selected].sort();

  return (
    <section className="grid gap-3 rounded-xl border p-3 sm:p-4" aria-labelledby="qc-dental-h">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="qc-dental-h" className="flex items-center gap-2 text-sm font-semibold">
          <Smile className="h-4 w-4 text-primary" /> Dental chart
        </h3>
        {chart && (
          <>
            <Badge variant={chart.status === 'SIGNED' ? 'success' : 'warning'}>{chart.status === 'SIGNED' ? 'Signed' : 'Draft'}</Badge>
            <span className="text-xs text-muted-foreground">{chart.chartNo} · {DENTITION_LABELS[chart.dentition]}</span>
            <Button size="sm" variant="ghost" className="ml-auto h-8 text-xs" asChild>
              <Link href={`/dental/${chart.id}`}>
                Open full chart <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </>
        )}
      </div>

      {!chart ? (
        canWrite ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="w-full text-sm text-muted-foreground">Chart the mouth tooth by tooth. Teeth missing at the last signed chart are marked already.</p>
            <div className="inline-flex rounded-lg border p-0.5" role="group" aria-label="Tooth chart">
              {DENTITIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={dentition === d}
                  onClick={() => setPick(d)}
                  className={cn('h-8 rounded-md px-3 text-xs font-medium', dentition === d ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}
                >
                  {DENTITION_LABELS[d]}
                </button>
              ))}
            </div>
            <Button size="sm" disabled={!dentition} loading={start.isPending} onClick={() => start.mutate()}>
              <Smile /> Start dental chart
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No dental chart for this visit yet.</p>
        )
      ) : (
        <>
          {canEdit && (
            <div className="flex flex-wrap items-center gap-1">
              {[1, 2, 3, 4].map((quad, i) => (
                <Button key={quad} size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setSelected(new Set(adult.filter((t) => t.quadrant === quad).map((t) => t.id)))}>
                  {QUADRANTS[i]}
                </Button>
              ))}
              {selected.size > 0 && (
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground" onClick={() => setSelected(new Set())}>
                  Clear
                </Button>
              )}
              <span className="ml-auto text-xs text-muted-foreground">{selected.size ? `${selected.size} selected` : 'Tap teeth to record findings'}</span>
            </div>
          )}
          <div className="overflow-x-auto">
            <Odontogram teeth={adult} findings={chart.teeth} procedures={chart.procedures} selected={selected} onToggle={canEdit ? toggle : undefined} readOnly={!canEdit} title="Adult teeth" />
            {chart.showDeciduous && <Odontogram teeth={baby} findings={chart.teeth} procedures={chart.procedures} selected={selected} onToggle={canEdit ? toggle : undefined} readOnly={!canEdit} title="Baby teeth" className="mt-3" />}
          </div>
          <OdontogramLegend />
          {canEdit && sel.length > 0 && (
            <div className="rounded-lg border bg-muted/20 p-3">
              <ToothEditor dentition={chart.dentition} selected={sel} teeth={chart.teeth} saving={save.isPending} onSave={(f) => save.mutate(f)} onClear={() => setSelected(new Set())} />
            </div>
          )}
          {!sel.length && <p className="text-xs text-muted-foreground">{dentalSummary(chart) || 'Nothing recorded yet.'} Procedures and signing are in the full chart.</p>}
        </>
      )}
    </section>
  );
}
