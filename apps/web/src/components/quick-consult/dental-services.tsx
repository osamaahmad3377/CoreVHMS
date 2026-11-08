'use client';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { DENTAL_PROCEDURES, forDentition, teethFor, type Dentition } from '@vcms/shared';
import { Check, Plus, Smile } from 'lucide-react';
import { codeFromName } from '../billing/service-code';
import { MoneyInput, parseMoney } from '../billing/money';
import { Checkbox } from '../ui/checkbox';
import { Field } from '../forms/field';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useDentalPrices } from '../dental/chart-sections';
import { Odontogram } from '../dental/odontogram';
import { useVisitDental, type VisitDental } from '../dental/visit-dental';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { api } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { DentalChart } from '@/lib/types';
import { cn } from '@/lib/utils';

type Procedure = (typeof DENTAL_PROCEDURES)[number];

/**
 * Adds a procedure to a dental chart. A price given for a procedure without one is saved as its usual price (a
 * price-list entry used from now on) or charged for this visit only.
 */
export async function addDentalProcedure(qc: QueryClient, a: { chartId: string; code: string; teeth: string[]; priceMinor?: number | null; saveUsual?: boolean }) {
  if (a.priceMinor && a.saveUsual) {
    const label = DENTAL_PROCEDURES.find((p) => p.code === a.code)!.label;
    const codes = (await api.get<{ code: string }[]>('/services?all=true')).map((x) => x.code);
    const service = await api.post<{ id: string }>('/services', { code: codeFromName(label, codes), name: label, category: 'DENTAL', priceMinor: a.priceMinor, isActive: true });
    qc.setQueryData(['dental-prices'], await api.put('/dental/prices', { items: [{ code: a.code, serviceId: service.id }] }));
    qc.invalidateQueries({ queryKey: ['appointment-types'] });
  }
  return api.post<DentalChart>(`/dental/charts/${a.chartId}/procedures`, { code: a.code, teeth: a.teeth, serviceId: null, notes: null, priceMinor: a.saveUsual ? null : (a.priceMinor ?? null) });
}

/**
 * The dental services done at this visit, to tap in Treatment: a whole-mouth service (scale and polish, X-rays…) is
 * one tap on and off; a service on teeth (extraction, filling…) asks which teeth. They are recorded on the visit's
 * dental chart (started for the vet if needed), so each is priced and billed once, and shows on the chart.
 */
export function DentalServices({ encounterId, patientId }: { encounterId: string; patientId: string }) {
  const qc = useQueryClient();
  const { can, currency } = useSession();
  const editable = can('clinical.write');
  const q = useVisitDental(encounterId);
  const prices = useDentalPrices();
  const chart = (q.data?.charts ?? []).find((c) => c.status === 'DRAFT') ?? null;
  const signed = !chart && (q.data?.charts ?? []).some((c) => c.status === 'SIGNED');
  const dentition: Dentition | null = chart?.dentition ?? q.data?.suggestedDentition ?? null;
  // The service being added when it needs teeth chosen and/or a price.
  const [asking, setAsking] = useState<Procedure | null>(null);

  const put = (c: DentalChart) => {
    qc.setQueryData<VisitDental>(['encounter-dental', encounterId], (d) => (d ? { ...d, charts: d.charts.some((x) => x.id === c.id) ? d.charts.map((x) => (x.id === c.id ? c : x)) : [c, ...d.charts] } : d));
    qc.invalidateQueries({ queryKey: ['patient-dental', patientId] });
    qc.invalidateQueries({ queryKey: ['charges'] });
  };
  /** The visit's draft chart, started when there is none yet. */
  const ensureChart = async () => chart ?? (await api.post<DentalChart>('/dental/charts', { patientId, dentition, showDeciduous: false, carryForward: true, encounterId }));
  const add = useMutation({
    mutationFn: async ({ code, teeth, priceMinor, saveUsual }: { code: string; teeth: string[]; priceMinor?: number | null; saveUsual?: boolean }) => {
      const c = await ensureChart();
      if (!chart) put(c);
      return addDentalProcedure(qc, { chartId: c.id, code, teeth, priceMinor, saveUsual });
    },
    onSuccess: (c, v) => {
      put(c);
      toast.success(`${DENTAL_PROCEDURES.find((p) => p.code === v.code)?.label} added${v.teeth.length ? ` for ${v.teeth.join(', ')}` : ''} — on the bill`);
      setAsking(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del<DentalChart>(`/dental/charts/${chart!.id}/procedures/${id}`),
    onSuccess: (c) => {
      put(c);
      toast.success('Removed; its charge was taken off the bill');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!dentition || q.isLoading) return null;
  const list = forDentition(DENTAL_PROCEDURES, dentition);
  const price = (code: string) => {
    const s = prices.data?.find((p) => p.code === code)?.service ?? null;
    return s && s.priceMinor > 0 ? s : null;
  };
  const done = (code: string) => (chart?.procedures ?? []).filter((p) => p.code === code);

  return (
    <section className="grid gap-2" aria-labelledby="qc-dental-services">
      <div className="flex items-baseline gap-2">
        <h2 id="qc-dental-services" className="flex items-center gap-2 text-[15px] font-medium">
          <Smile className="h-4 w-4 text-primary" /> Dental services
        </h2>
        <span className="text-xs text-muted-foreground">Tap what you did — it goes on the dental chart and the bill.</span>
      </div>
      {signed && <p className="text-sm text-muted-foreground">The dental chart for this visit is signed. Add an addendum on the chart for anything else.</p>}
      <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="Dental services">
        {list.map((p) => {
          const rows = done(p.code);
          const mouthRow = rows.find((r) => !r.tooth);
          const teeth = rows.map((r) => r.tooth).filter(Boolean) as string[];
          const on = rows.length > 0;
          const s = price(p.code);
          const perTooth = p.scope === 'tooth';
          return (
            <button
              key={p.code}
              type="button"
              aria-pressed={on}
              disabled={!editable || signed || add.isPending || remove.isPending}
              onClick={() => {
                if (mouthRow) return remove.mutate(mouthRow.id);
                if (perTooth || !s) return setAsking(p);
                add.mutate({ code: p.code, teeth: [] });
              }}
              className={cn(
                'flex min-h-14 items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors disabled:opacity-60',
                on ? 'border-success/50 bg-success/[0.07]' : 'border-border bg-background hover:border-primary/40',
              )}
            >
              <span className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-full border', on ? 'border-success bg-success text-success-foreground' : 'border-foreground/20 text-muted-foreground')}>
                {on ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : perTooth ? <Plus className="h-3.5 w-3.5" /> : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium leading-tight">{p.label}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {teeth.length ? `Teeth ${teeth.join(', ')}` : perTooth ? 'Choose the teeth' : on ? 'Done' : 'Whole mouth'}
                </span>
              </span>
              <span className="shrink-0 text-right text-xs tabular text-muted-foreground">
                {s ? fmtMoney(s.priceMinor, currency) : 'No price yet'}
                {perTooth && s ? <span className="block">per tooth</span> : null}
              </span>
            </button>
          );
        })}
      </div>
      {asking && (
        <AddDialog
          procedure={asking}
          dentition={dentition}
          chart={chart}
          needsPrice={!price(asking.code)}
          canSavePrice={can('settings.manage')}
          saving={add.isPending}
          onClose={() => setAsking(null)}
          onAdd={(teeth, priceMinor, saveUsual) => add.mutate({ code: asking.code, teeth, priceMinor, saveUsual })}
          onRemove={(id) => remove.mutate(id)}
        />
      )}
    </section>
  );
}

/**
 * Adding a service that needs more: the teeth (tap them on a small chart; teeth already done can be taken off) and/or
 * its price when it has none yet — saved as the usual price, or charged for this visit only.
 */
export function AddDialog({
  procedure,
  dentition,
  chart,
  initialTeeth,
  needsPrice,
  canSavePrice,
  saving,
  onClose,
  onAdd,
  onRemove,
}: {
  procedure: Procedure;
  dentition: Dentition;
  chart: DentalChart | null;
  /** Teeth already chosen (e.g. selected on the chart). */
  initialTeeth?: string[];
  needsPrice: boolean;
  canSavePrice: boolean;
  saving: boolean;
  onClose: () => void;
  onAdd: (teeth: string[], priceMinor: number | null, saveUsual: boolean) => void;
  onRemove: (procedureId: string) => void;
}) {
  const { currency } = useSession();
  const perTooth = procedure.scope === 'tooth';
  const [selected, setSelected] = useState<Set<string>>(new Set(initialTeeth ?? []));
  const [price, setPrice] = useState('');
  const [saveUsual, setSaveUsual] = useState(canSavePrice);
  const adult = useMemo(() => teethFor(dentition), [dentition]);
  const done = (chart?.procedures ?? []).filter((p) => p.code === procedure.code && p.tooth);
  const toggle = (t: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(t)) n.delete(t);
      else n.add(t);
      return n;
    });
  const sel = [...selected].sort();
  const parsed = parseMoney(price, currency);
  const priceOk = !needsPrice || (parsed !== null && parsed > 0);
  const ready = (!perTooth || sel.length > 0) && priceOk;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size={perTooth ? 'xl' : 'md'}>
        <DialogHeader>
          <DialogTitle>{perTooth ? `${procedure.label}: which teeth?` : procedure.label}</DialogTitle>
          <DialogDescription>{perTooth ? 'Tap each tooth, then add. Each tooth is charged once.' : 'This service has no price yet. Enter what you charge.'}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {perTooth && <Odontogram teeth={adult} findings={chart?.teeth ?? []} procedures={chart?.procedures ?? []} selected={selected} onToggle={toggle} title="Choose teeth" />}
          {perTooth && done.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-sm">
              <span className="text-muted-foreground">Already done:</span>
              {done.map((p) => (
                <span key={p.id} className="inline-flex items-center gap-1 rounded-full border bg-success/10 px-2.5 py-0.5 text-xs font-medium">
                  {p.tooth}
                  <button type="button" aria-label={`Remove ${procedure.label} on ${p.tooth}`} className="text-muted-foreground hover:text-destructive" onClick={() => onRemove(p.id)}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          {needsPrice && (
            <div className="grid gap-2 rounded-lg border bg-muted/30 p-3">
              <Field label={perTooth ? 'Price per tooth' : 'Price'} htmlFor="ds-price" required>
                <MoneyInput id="ds-price" currency={currency} className="sm:w-48" value={price} autoFocus={!perTooth || !!initialTeeth?.length} placeholder="0.00" onChange={(e) => setPrice(e.target.value)} />
              </Field>
              {canSavePrice ? (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={saveUsual} onCheckedChange={(v) => setSaveUsual(v === true)} />
                  Save as the usual price for {procedure.label.toLowerCase()}
                </label>
              ) : (
                <p className="text-xs text-muted-foreground">Charged for this visit only. A manager can set the usual price in Appointment types.</p>
              )}
            </div>
          )}
        </div>
        <DialogFooter className="sm:items-center">
          {needsPrice && parsed !== null && parsed > 0 && (
            <span className="mr-auto text-sm text-muted-foreground">
              On the bill: <b className="text-foreground">{fmtMoney(parsed * Math.max(1, perTooth ? sel.length : 1), currency)}</b>
            </span>
          )}
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!ready} loading={saving} onClick={() => onAdd(sel, needsPrice ? parsed : null, needsPrice && canSavePrice && saveUsual)}>
            {perTooth ? `Add for ${sel.length ? (sel.length === 1 ? `tooth ${sel[0]}` : `${sel.length} teeth`) : 'the chosen teeth'}` : 'Add'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
