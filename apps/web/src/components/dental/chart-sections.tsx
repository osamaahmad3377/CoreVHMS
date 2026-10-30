'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CALCULUS_INDEX,
  DENTAL_PROCEDURES,
  GINGIVAL_INDEX,
  OCCLUSION_LABELS,
  OCCLUSIONS,
  PERIODONTAL_STAGES,
  forDentition,
  type Occlusion,
} from '@vcms/shared';
import { Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useConfirm } from '../confirm';
import { Field } from '../forms/field';
import { FormError } from '../forms/form-error';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardHeader, CardTitle } from '../ui/card';
import { Checkbox } from '../ui/checkbox';
import { Input, NativeSelect, Textarea } from '../ui/input';
import { Table, TBody, TD, TH, THead, TR } from '../ui/table';
import { ScalePicker } from './tooth-editor';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { DentalChart, DentalPrice, Service } from '@/lib/types';
import { cn } from '@/lib/utils';

export function useDentalPrices() {
  return useQuery({ queryKey: ['dental-prices'], queryFn: () => api.get<DentalPrice[]>('/dental/prices'), staleTime: 60_000 });
}

function chargeBadge(c: NonNullable<DentalChart['procedures'][number]['charge']>, currency: string) {
  const net = c.unitPriceMinor - c.discountMinor;
  const label = c.status === 'INVOICED' ? 'Invoiced' : c.status === 'WAIVED' ? 'Waived' : 'To bill';
  return (
    <span className="flex flex-col items-end gap-0.5">
      <span className="tabular">
        {c.discountMinor > 0 && <s className="mr-1 text-xs text-muted-foreground">{fmtMoney(c.unitPriceMinor, currency)}</s>}
        {fmtMoney(net, currency)}
      </span>
      <Badge variant={c.status === 'INVOICED' ? 'success' : c.status === 'WAIVED' ? 'secondary' : 'info'}>{label}</Badge>
      {c.discountNote && <span className="max-w-[16rem] text-right text-2xs text-success">{c.discountNote}</span>}
    </span>
  );
}

/** Procedures done at this dental: added for the selected teeth or the whole mouth, charged as they are added. */
export function ProceduresCard({ chart, selected, editable, onChanged }: { chart: DentalChart; selected: string[]; editable: boolean; onChanged: (c: DentalChart) => void }) {
  const { currency, can } = useSession();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const prices = useDentalPrices();
  const services = useQuery({ queryKey: ['services', 'active'], queryFn: () => api.get<Service[]>('/services'), enabled: editable });
  const codes = forDentition(DENTAL_PROCEDURES, chart.dentition);
  const [code, setCode] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const proc = codes.find((c) => c.code === code);
  const mapped = prices.data?.find((p) => p.code === code)?.service ?? null;
  useEffect(() => setServiceId(mapped?.id ?? ''), [code, mapped?.id]);
  const forTeeth = proc?.scope === 'tooth' || (proc?.scope === 'both' && selected.length > 0);
  const add = useMutation({
    mutationFn: () => api.post<DentalChart>(`/dental/charts/${chart.id}/procedures`, { code, teeth: forTeeth ? selected : [], serviceId: serviceId || null, notes: notes.trim() || null }),
    onSuccess: (c) => {
      onChanged(c);
      toast.success(`${proc?.label} recorded${forTeeth ? ` on ${selected.length} ${selected.length === 1 ? 'tooth' : 'teeth'}` : ''}`);
      setNotes('');
      setError(null);
      qc.invalidateQueries({ queryKey: ['charges'] });
    },
    onError: (e: Error) => setError(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del<DentalChart>(`/dental/charts/${chart.id}/procedures/${id}`),
    onSuccess: (c) => {
      onChanged(c);
      toast.success('Procedure removed; its charge was waived');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const needTeeth = proc?.scope === 'tooth' && !selected.length;
  const total = chart.procedures.reduce((n, p) => n + (p.charge && p.charge.status !== 'WAIVED' ? p.charge.unitPriceMinor - p.charge.discountMinor : 0), 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Procedures</CardTitle>
        {total > 0 && <span className="text-sm text-muted-foreground">Charged: <span className="font-semibold tabular text-foreground">{fmtMoney(total, currency)}</span></span>}
      </CardHeader>
      {chart.procedures.length ? (
        <Table>
          <THead>
            <TR>
              <TH className="w-20">Tooth</TH>
              <TH>Procedure</TH>
              <TH className="hidden md:table-cell">By</TH>
              <TH className="text-right">Charge</TH>
              {editable && <TH className="w-10"><span className="sr-only">Remove</span></TH>}
            </TR>
          </THead>
          <TBody>
            {chart.procedures.map((p) => (
              <TR key={p.id}>
                <TD className="font-semibold tabular">{p.tooth ?? <span className="font-normal text-muted-foreground">Mouth</span>}</TD>
                <TD>
                  <p className="font-medium">{p.label}</p>
                  {p.notes && <p className="text-xs text-muted-foreground">{p.notes}</p>}
                </TD>
                <TD className="hidden text-xs text-muted-foreground md:table-cell">{p.recordedByName}</TD>
                <TD className="text-right text-sm">{p.charge ? chargeBadge(p.charge, currency) : <span className="text-xs text-muted-foreground">Not charged</span>}</TD>
                {editable && (
                  <TD>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Remove ${p.label}${p.tooth ? ` on ${p.tooth}` : ''}`}
                      disabled={p.charge?.status === 'INVOICED'}
                      title={p.charge?.status === 'INVOICED' ? 'Already invoiced' : 'Remove'}
                      onClick={async () => {
                        const r = await confirm({ title: `Remove ${p.label.toLowerCase()}${p.tooth ? ` on ${p.tooth}` : ''}?`, description: p.charge?.status === 'PENDING' ? 'Its charge is waived, so it won’t be billed.' : undefined, confirmLabel: 'Remove', destructive: true });
                        if (r.confirmed) remove.mutate(p.id);
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </TD>
                )}
              </TR>
            ))}
          </TBody>
        </Table>
      ) : (
        <p className="border-t px-4 py-4 text-sm text-muted-foreground">No procedures recorded{editable ? ' yet. Select teeth on the chart, then choose the procedure below.' : '.'}</p>
      )}
      {editable && (
        <div className="grid gap-3 border-t p-4">
          {error && <FormError message={error} />}
          <div className="grid gap-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <Field label="Procedure" htmlFor="dp-code">
              <NativeSelect id="dp-code" value={code} onChange={(e) => { setCode(e.target.value); setError(null); }}>
                <option value="">Choose…</option>
                <optgroup label="Whole mouth">
                  {codes.filter((c) => c.scope !== 'tooth').map((c) => <option key={c.code} value={c.code}>{c.label} ({c.abbr})</option>)}
                </optgroup>
                <optgroup label="On a tooth">
                  {codes.filter((c) => c.scope === 'tooth').map((c) => <option key={c.code} value={c.code}>{c.label} ({c.abbr})</option>)}
                </optgroup>
              </NativeSelect>
            </Field>
            <Field
              label="Charge with"
              htmlFor="dp-svc"
              hint={!code ? undefined : mapped ? 'From Settings → Dental prices' : can('settings.manage') ? 'No price set for this procedure (Settings → Dental prices)' : 'No price set — it won’t be charged'}
            >
              <NativeSelect id="dp-svc" value={serviceId} onChange={(e) => setServiceId(e.target.value)} disabled={!code}>
                <option value="">Don’t charge</option>
                {(services.data ?? []).filter((s) => s.isActive).map((s) => <option key={s.id} value={s.id}>{s.name} · {fmtMoney(s.priceMinor, currency)}</option>)}
              </NativeSelect>
            </Field>
          </div>
          <Field label="Notes" htmlFor="dp-notes">
            <Input id="dp-notes" value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. sectioned, flap closed with 5-0 absorbable" />
          </Field>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className={cn('text-xs', needTeeth ? 'text-warning' : 'text-muted-foreground')}>
              {!proc ? 'Choose a procedure.' : proc.scope === 'mouth' ? 'Recorded once for the whole mouth.' : needTeeth ? 'Select the teeth on the chart first.' : forTeeth ? `For ${selected.join(', ')}${serviceId ? ' — one charge per tooth' : ''}.` : 'Recorded for the whole mouth (select teeth to record it per tooth).'}
            </p>
            <Button size="sm" disabled={!proc || needTeeth} loading={add.isPending} onClick={() => add.mutate()}>
              <Plus /> Add procedure
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

interface MouthForm {
  occlusion: string;
  periodontalStage: number | null;
  calculusIndex: number | null;
  gingivalIndex: number | null;
  anaesthetised: boolean;
  oralFindings: string;
  homeCare: string;
  notes: string;
  recheckDate: string;
}

const mouthOf = (c: DentalChart): MouthForm => ({
  occlusion: c.occlusion ?? '',
  periodontalStage: c.periodontalStage,
  calculusIndex: c.calculusIndex,
  gingivalIndex: c.gingivalIndex,
  anaesthetised: c.anaesthetised,
  oralFindings: c.oralFindings ?? '',
  homeCare: c.homeCare ?? '',
  notes: c.notes ?? '',
  recheckDate: c.recheckDate ?? '',
});

/** Whole-mouth findings: bite, overall periodontal stage, tartar and gum scores, soft tissue, home care and recheck. */
export function MouthCard({ chart, editable, onChanged }: { chart: DentalChart; editable: boolean; onChanged: (c: DentalChart) => void }) {
  const [f, setF] = useState<MouthForm>(mouthOf(chart));
  useEffect(() => setF(mouthOf(chart)), [chart]);
  const dirty = JSON.stringify(f) !== JSON.stringify(mouthOf(chart));
  const save = useMutation({
    mutationFn: () =>
      api.patch<DentalChart>(`/dental/charts/${chart.id}`, {
        occlusion: f.occlusion || null,
        periodontalStage: f.periodontalStage,
        calculusIndex: f.calculusIndex,
        gingivalIndex: f.gingivalIndex,
        anaesthetised: f.anaesthetised,
        oralFindings: f.oralFindings,
        homeCare: f.homeCare,
        notes: f.notes,
        recheckDate: f.recheckDate || null,
      }),
    onSuccess: (c) => {
      onChanged(c);
      toast.success('Whole-mouth findings saved');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const set = <K extends keyof MouthForm>(k: K, v: MouthForm[K]) => setF((s) => ({ ...s, [k]: v }));
  const worst = chart.worstToothStage;

  if (!editable) {
    const rows: [string, React.ReactNode][] = [
      ['Bite', chart.occlusion ? OCCLUSION_LABELS[chart.occlusion as Occlusion] : '—'],
      ['Periodontal stage', chart.periodontalStage != null ? `${PERIODONTAL_STAGES[chart.periodontalStage].label} — ${PERIODONTAL_STAGES[chart.periodontalStage].hint}` : worst != null ? `Worst tooth PD${worst}` : '—'],
      ['Tartar', chart.calculusIndex != null ? `${CALCULUS_INDEX[chart.calculusIndex].label} — ${CALCULUS_INDEX[chart.calculusIndex].hint}` : '—'],
      ['Gums', chart.gingivalIndex != null ? `${GINGIVAL_INDEX[chart.gingivalIndex].label} — ${GINGIVAL_INDEX[chart.gingivalIndex].hint}` : '—'],
      ['Under anaesthetic', chart.anaesthetised ? 'Yes' : 'No'],
      ['Mouth, gums and soft tissue', chart.oralFindings || '—'],
      ['Home care', chart.homeCare || '—'],
      ['Notes', chart.notes || '—'],
      ['Recheck', chart.recheckDate ? fmtDate(chart.recheckDate) : '—'],
    ];
    return (
      <Card>
        <CardHeader><CardTitle>Whole mouth</CardTitle></CardHeader>
        <dl className="grid gap-x-6 gap-y-3 border-t p-4 text-sm sm:grid-cols-2">
          {rows.map(([k, v]) => (
            <div key={k} className={cn(typeof v === 'string' && v.length > 60 && 'sm:col-span-2')}>
              <dt className="text-xs font-medium text-muted-foreground">{k}</dt>
              <dd className="whitespace-pre-wrap">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Whole mouth</CardTitle>
        <Button size="sm" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
          <Save /> Save
        </Button>
      </CardHeader>
      <div className="grid gap-4 border-t p-4">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Bite (occlusion)" htmlFor="dm-occ">
            <NativeSelect id="dm-occ" value={f.occlusion} onChange={(e) => set('occlusion', e.target.value)}>
              <option value="">Not recorded</option>
              {OCCLUSIONS.map((o) => <option key={o} value={o}>{OCCLUSION_LABELS[o]}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Overall periodontal stage" htmlFor="dm-pd" hint={worst != null ? `Worst tooth on the chart: PD${worst}` : undefined} help={PERIODONTAL_STAGES.map((s) => `${s.label}: ${s.hint}`).join('. ')}>
            <ScalePicker id="dm-pd" steps={PERIODONTAL_STAGES} value={f.periodontalStage} onChange={(v) => set('periodontalStage', v)} />
          </Field>
          <Field label="Tartar, whole mouth" htmlFor="dm-ci" help={CALCULUS_INDEX.map((s) => `${s.label}: ${s.hint}`).join('. ')}>
            <ScalePicker id="dm-ci" steps={CALCULUS_INDEX} value={f.calculusIndex} onChange={(v) => set('calculusIndex', v)} />
          </Field>
          <Field label="Gum inflammation, whole mouth" htmlFor="dm-gi" help={GINGIVAL_INDEX.map((s) => `${s.label}: ${s.hint}`).join('. ')}>
            <ScalePicker id="dm-gi" steps={GINGIVAL_INDEX} value={f.gingivalIndex} onChange={(v) => set('gingivalIndex', v)} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={f.anaesthetised} onCheckedChange={(v) => set('anaesthetised', v === true)} /> Examined under general anaesthetic
        </label>
        <Field label="Mouth, gums and soft tissue" htmlFor="dm-oral">
          <Textarea id="dm-oral" value={f.oralFindings} maxLength={4000} onChange={(e) => set('oralFindings', e.target.value)} placeholder="e.g. halitosis, oral mass on the left mandible, tongue and palate normal" />
        </Field>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Home care advice" htmlFor="dm-home" hint="Printed on the client report.">
            <Textarea id="dm-home" value={f.homeCare} maxLength={2000} onChange={(e) => set('homeCare', e.target.value)} placeholder="e.g. brush daily with pet toothpaste; dental chews; soft food for 10 days" />
          </Field>
          <Field label="Notes" htmlFor="dm-notes">
            <Textarea id="dm-notes" value={f.notes} maxLength={4000} onChange={(e) => set('notes', e.target.value)} />
          </Field>
        </div>
        <Field label="Recheck" htmlFor="dm-recheck" className="max-w-xs">
          <Input id="dm-recheck" type="date" value={f.recheckDate} onChange={(e) => set('recheckDate', e.target.value)} />
        </Field>
      </div>
    </Card>
  );
}
