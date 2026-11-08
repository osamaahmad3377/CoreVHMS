'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DENTAL_PROCEDURES, forDentition, toothInfo } from '@vcms/shared';
import { Check, CircleSlash, FlaskConical, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { blankTooth, toothPayload, type ToothForm, type ToothPayload } from './tooth-editor';
import { LabOrderDialog } from '../lab/order-dialog';
import { addDentalProcedure, AddDialog } from '../quick-consult/dental-services';
import { useDentalPrices } from './chart-sections';
import { Button } from '../ui/button';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { DentalChart } from '@/lib/types';

/** The procedures done on single teeth most often, with the word on their button. */
const QUICK: Record<string, string> = { X: 'Extract', R: 'Filling', RP: 'Root planing', WOLF: 'Remove wolf tooth' };

/**
 * One bar for the selected teeth: record them as fine or missing, or add a common procedure — one tap each. The
 * full tooth editor is for anything else.
 */
export function ToothActions({
  chart,
  selected,
  saving,
  onSaveTeeth,
  onChanged,
  onClear,
  onMoreProcedures,
}: {
  chart: DentalChart;
  selected: string[];
  saving: boolean;
  onSaveTeeth: (teeth: ToothPayload[], done: () => void) => void;
  onChanged: (c: DentalChart) => void;
  onClear: () => void;
  /** Where the other procedures are (e.g. scroll to the procedures list). */
  onMoreProcedures?: () => void;
}) {
  const qc = useQueryClient();
  const { can } = useSession();
  const [ordering, setOrdering] = useState(false);
  const prices = useDentalPrices();
  // A procedure without a price yet asks for it (with the selected teeth), so it reaches the bill.
  const [asking, setAsking] = useState<(typeof DENTAL_PROCEDURES)[number] | null>(null);
  const priced = (code: string) => (prices.data?.find((p) => p.code === code)?.service?.priceMinor ?? 0) > 0;
  const label = selected.length === 1 ? `${selected[0]} · ${(toothInfo(chart.dentition, selected[0])?.name ?? '').replace(/\s*\(\d+\)$/, '')}` : `${selected.length} teeth · ${selected.join(', ')}`;
  const quick = (f: ToothForm, what: string) =>
    onSaveTeeth(selected.map((t) => toothPayload(t, f)), () => {
      toast.success(`${selected.length === 1 ? selected[0] : `${selected.length} teeth`}: ${what}`);
      onClear();
    });
  const procedures = forDentition(DENTAL_PROCEDURES, chart.dentition).filter((p) => QUICK[p.code] && p.scope !== 'mouth');
  const add = useMutation({
    mutationFn: (v: { code: string; teeth?: string[]; priceMinor?: number | null; saveUsual?: boolean }) => addDentalProcedure(qc, { chartId: chart.id, code: v.code, teeth: v.teeth ?? selected, priceMinor: v.priceMinor, saveUsual: v.saveUsual }),
    onSuccess: (c, v) => {
      onChanged(c);
      qc.invalidateQueries({ queryKey: ['charges'] });
      const teeth = v.teeth ?? selected;
      toast.success(`${DENTAL_PROCEDURES.find((p) => p.code === v.code)?.label} recorded on ${teeth.length === 1 ? teeth[0] : `${teeth.length} teeth`}`);
      setAsking(null);
      onClear();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="grid gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3" role="region" aria-label="Selected teeth">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{label}</span>
        <Button size="icon-sm" variant="ghost" aria-label="Clear the selection" onClick={onClear}>
          <X />
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant="outline" className="h-9" disabled={saving} onClick={() => quick(blankTooth(), 'nothing found')}>
          <Check /> Nothing found
        </Button>
        <Button size="sm" variant="outline" className="h-9" disabled={saving} onClick={() => quick({ ...blankTooth(), state: 'MISSING' }, 'missing')}>
          <CircleSlash /> Missing
        </Button>
        {procedures.length > 0 && <span className="mx-1 h-6 w-px bg-border" aria-hidden />}
        {procedures.map((p) => (
          <Button key={p.code} size="sm" variant="outline" className="h-9" disabled={add.isPending} title={p.label} onClick={() => (priced(p.code) ? add.mutate({ code: p.code }) : setAsking(p))}>
            {QUICK[p.code]}
          </Button>
        ))}
        {can('lab.order') && (
          <>
            <span className="mx-1 h-6 w-px bg-border" aria-hidden />
            <Button size="sm" variant="outline" className="h-9" onClick={() => setOrdering(true)}>
              <FlaskConical /> Test / X-ray…
            </Button>
          </>
        )}
        {onMoreProcedures && (
          <Button size="sm" variant="ghost" className="h-9 text-muted-foreground" onClick={onMoreProcedures}>
            Other procedure…
          </Button>
        )}
      </div>
      {asking && (
        <AddDialog
          procedure={asking}
          dentition={chart.dentition}
          chart={chart}
          initialTeeth={selected}
          needsPrice
          canSavePrice={can('settings.manage')}
          saving={add.isPending}
          onClose={() => setAsking(null)}
          onAdd={(teeth, priceMinor, saveUsual) => add.mutate({ code: asking.code, teeth, priceMinor, saveUsual })}
          onRemove={() => undefined}
        />
      )}
      <LabOrderDialog
        open={ordering}
        onOpenChange={setOrdering}
        patient={{ id: chart.patientId, name: chart.patient.name }}
        encounterId={chart.encounterId}
        firstCategory="IMAGING"
        teeth={selected}
        initialNotes={selected.map((t) => `Tooth ${t}${toothInfo(chart.dentition, t) ? ` — ${(toothInfo(chart.dentition, t)!.name).replace(/\s*\(\d+\)$/, '')}` : ''}`).join('; ')}
        onCreated={() => onClear()}
      />
    </div>
  );
}
