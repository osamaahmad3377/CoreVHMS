'use client';
import {
  CALCULUS_INDEX,
  DENTAL_FINDINGS,
  FURCATION_INDEX,
  GINGIVAL_INDEX,
  MOBILITY_INDEX,
  PERIODONTAL_STAGES,
  TOOTH_STATE_LABELS,
  TOOTH_STATES,
  TR_STAGES,
  forDentition,
  toothInfo,
  type Dentition,
  type ScaleStep,
} from '@vcms/shared';
import { Save, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Field } from '../forms/field';
import { Button } from '../ui/button';
import { Input, Textarea } from '../ui/input';
import type { DentalTooth } from '@/lib/types';
import { cn } from '@/lib/utils';

export interface ToothForm {
  state: DentalTooth['state'];
  findings: string[];
  trStage: number | null;
  pdStage: number | null;
  mobility: number | null;
  furcation: number | null;
  calculus: number | null;
  gingivitis: number | null;
  probingMm: string;
  recessionMm: string;
  notes: string;
}

export const blankTooth = (): ToothForm => ({ state: 'PRESENT', findings: [], trStage: null, pdStage: null, mobility: null, furcation: null, calculus: null, gingivitis: null, probingMm: '', recessionMm: '', notes: '' });

function fromTooth(t: DentalTooth | undefined): ToothForm {
  if (!t) return blankTooth();
  return {
    state: t.state,
    findings: [...t.findings],
    trStage: t.trStage,
    pdStage: t.pdStage,
    mobility: t.mobility,
    furcation: t.furcation,
    calculus: t.calculus,
    gingivitis: t.gingivitis,
    probingMm: t.probingMm == null ? '' : String(t.probingMm),
    recessionMm: t.recessionMm == null ? '' : String(t.recessionMm),
    notes: t.notes ?? '',
  };
}

const same = (a: ToothForm, b: ToothForm) => JSON.stringify({ ...a, findings: [...a.findings].sort() }) === JSON.stringify({ ...b, findings: [...b.findings].sort() });

/** A row of buttons for a 0–N score; pressing the chosen one again clears it. */
export function ScalePicker({ id, steps, value, onChange, disabled }: { id: string; steps: ScaleStep[]; value: number | null; onChange: (v: number | null) => void; disabled?: boolean }) {
  return (
    <div id={id} role="radiogroup" className="flex flex-wrap gap-1">
      {steps.map((s) => (
        <button
          key={s.value}
          type="button"
          role="radio"
          aria-checked={value === s.value}
          title={s.hint}
          disabled={disabled}
          onClick={() => onChange(value === s.value ? null : s.value)}
          className={cn(
            'min-w-[3rem] rounded-md border px-2 py-1 text-xs font-semibold tabular transition-colors disabled:opacity-50',
            value === s.value ? 'border-primary bg-primary text-primary-foreground' : 'border-foreground/15 hover:bg-muted',
          )}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Findings for the selected teeth. One tooth: its current record. Several: what they have in common, and saving
 * gives them all the same record.
 */
export function ToothEditor({
  dentition,
  selected,
  teeth,
  saving,
  onSave,
  onClear,
}: {
  dentition: Dentition;
  selected: string[];
  teeth: DentalTooth[];
  saving: boolean;
  onSave: (form: ToothForm) => void;
  onClear: () => void;
}) {
  const byTooth = useMemo(() => new Map(teeth.map((t) => [t.tooth, t])), [teeth]);
  const forms = selected.map((id) => fromTooth(byTooth.get(id)));
  const allSame = forms.every((f) => same(f, forms[0]));
  const key = selected.join(',') + '|' + teeth.map((t) => `${t.tooth}:${JSON.stringify(t)}`).join(';');
  const [f, setF] = useState<ToothForm>(blankTooth());
  useEffect(() => {
    setF(allSame && forms[0] ? forms[0] : blankTooth());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const findings = forDentition(DENTAL_FINDINGS, dentition);
  const present = f.state === 'PRESENT';
  const set = <K extends keyof ToothForm>(k: K, v: ToothForm[K]) => setF((s) => ({ ...s, [k]: v }));
  const toggleFinding = (code: string) => setF((s) => ({ ...s, findings: s.findings.includes(code) ? s.findings.filter((x) => x !== code) : [...s.findings, code], trStage: code === 'TR' && s.findings.includes('TR') ? null : s.trStage }));
  const single = selected.length === 1 ? toothInfo(dentition, selected[0]) : null;
  const mmOk = (v: string) => v === '' || (/^\d{1,2}(\.\d)?$/.test(v) && Number(v) <= 30);

  return (
    <div className="grid gap-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{single ? single.name : `${selected.length} teeth selected`}</p>
          {!single && <p className="truncate text-xs text-muted-foreground">{selected.join(', ')}</p>}
          {!single && !allSame && <p className="mt-1 text-xs text-warning">These teeth have different records. Saving gives all of them what is shown here.</p>}
        </div>
        <Button size="icon-sm" variant="ghost" onClick={onClear} aria-label="Clear selection">
          <X />
        </Button>
      </div>

      <Field label="Tooth" htmlFor="te-state">
        <div id="te-state" role="radiogroup" className="grid grid-cols-2 gap-1 sm:grid-cols-4">
          {TOOTH_STATES.map((s) => (
            <button key={s} type="button" role="radio" aria-checked={f.state === s} onClick={() => set('state', s)} className={cn('rounded-md border px-2 py-1.5 text-xs font-medium', f.state === s ? 'border-primary bg-primary/10 text-primary' : 'border-foreground/15 hover:bg-muted')}>
              {TOOTH_STATE_LABELS[s]}
            </button>
          ))}
        </div>
      </Field>

      {present && (
        <>
          <Field label="Findings" htmlFor="te-findings" help="Standard veterinary dental abbreviations are printed on the chart.">
            <div id="te-findings" className="flex flex-wrap gap-1.5">
              {findings.map((c) => {
                const on = f.findings.includes(c.code);
                return (
                  <button key={c.code} type="button" aria-pressed={on} title={c.hint ?? c.label} onClick={() => toggleFinding(c.code)} className={cn('rounded-pill border px-2.5 py-1 text-xs transition-colors', on ? 'border-warning bg-warning/15 font-semibold text-foreground' : 'border-foreground/15 text-muted-foreground hover:bg-muted hover:text-foreground')}>
                    <span className="font-semibold">{c.abbr}</span> · {c.label}
                  </button>
                );
              })}
            </div>
          </Field>
          {f.findings.includes('TR') && (
            <Field label="Resorption stage" htmlFor="te-tr">
              <ScalePicker id="te-tr" steps={TR_STAGES} value={f.trStage} onChange={(v) => set('trStage', v)} />
            </Field>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Periodontal stage" htmlFor="te-pd" help={PERIODONTAL_STAGES.map((s) => `${s.label}: ${s.hint}`).join('. ')}>
              <ScalePicker id="te-pd" steps={PERIODONTAL_STAGES} value={f.pdStage} onChange={(v) => set('pdStage', v)} />
            </Field>
            <Field label="Mobility (loose)" htmlFor="te-mob" help={MOBILITY_INDEX.map((s) => `${s.label}: ${s.hint}`).join('. ')}>
              <ScalePicker id="te-mob" steps={MOBILITY_INDEX} value={f.mobility} onChange={(v) => set('mobility', v)} />
            </Field>
            <Field label="Tartar (calculus)" htmlFor="te-ci" help={CALCULUS_INDEX.map((s) => `${s.label}: ${s.hint}`).join('. ')}>
              <ScalePicker id="te-ci" steps={CALCULUS_INDEX} value={f.calculus} onChange={(v) => set('calculus', v)} />
            </Field>
            <Field label="Gum inflammation" htmlFor="te-gi" help={GINGIVAL_INDEX.map((s) => `${s.label}: ${s.hint}`).join('. ')}>
              <ScalePicker id="te-gi" steps={GINGIVAL_INDEX} value={f.gingivitis} onChange={(v) => set('gingivitis', v)} />
            </Field>
            <Field label="Furcation" htmlFor="te-fur" help={FURCATION_INDEX.map((s) => `${s.label}: ${s.hint}`).join('. ')}>
              <ScalePicker id="te-fur" steps={FURCATION_INDEX} value={f.furcation} onChange={(v) => set('furcation', v)} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Pocket (mm)" htmlFor="te-probe" error={mmOk(f.probingMm) ? undefined : '0–30'}>
                <Input id="te-probe" inputMode="decimal" value={f.probingMm} onChange={(e) => set('probingMm', e.target.value)} />
              </Field>
              <Field label="Recession (mm)" htmlFor="te-rec" error={mmOk(f.recessionMm) ? undefined : '0–30'}>
                <Input id="te-rec" inputMode="decimal" value={f.recessionMm} onChange={(e) => set('recessionMm', e.target.value)} />
              </Field>
            </div>
          </div>
        </>
      )}
      <Field label="Notes" htmlFor="te-notes">
        <Textarea id="te-notes" value={f.notes} maxLength={1000} onChange={(e) => set('notes', e.target.value)} placeholder={present ? 'e.g. slab fracture, mesial root exposed' : 'e.g. extracted elsewhere 2024'} />
      </Field>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => setF(blankTooth())} title="Clear the form (save to remove what is recorded)">
          Reset
        </Button>
        <Button size="sm" loading={saving} disabled={!mmOk(f.probingMm) || !mmOk(f.recessionMm)} onClick={() => onSave(f)}>
          <Save /> Save {selected.length > 1 ? `${selected.length} teeth` : 'tooth'}
        </Button>
      </div>
    </div>
  );
}

/** The API body for saving the form to each selected tooth. */
export function toothPayload(tooth: string, f: ToothForm) {
  const present = f.state === 'PRESENT';
  return {
    tooth,
    state: f.state,
    findings: present ? f.findings : [],
    trStage: present && f.findings.includes('TR') ? f.trStage : null,
    pdStage: present ? f.pdStage : null,
    mobility: present ? f.mobility : null,
    furcation: present ? f.furcation : null,
    calculus: present ? f.calculus : null,
    gingivitis: present ? f.gingivitis : null,
    probingMm: present && f.probingMm !== '' ? Number(f.probingMm) : null,
    recessionMm: present && f.recessionMm !== '' ? Number(f.recessionMm) : null,
    notes: f.notes.trim() || null,
  };
}
