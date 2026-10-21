'use client';
import { addRepeat, CARE_REPEAT_UNITS, intervalFromDays, repeatLabel, repeatSummary, type CareRepeatUnit } from '@vcms/shared';
import { Repeat } from 'lucide-react';
import { Field } from '../forms/field';
import { Input, NativeSelect } from '../ui/input';
import { tabListClass, tabTriggerClass } from '../ui/tabs';
import { fmtDate } from '@/lib/format';
import { cn } from '@/lib/utils';

/** How a care item repeats, as edited in the form. */
export interface RepeatValue {
  /** 'protocol' = the protocol's own schedule; 'none' = once only; 'custom' = every N units; else a preset unit. */
  mode: 'protocol' | 'none' | 'custom' | CareRepeatUnit;
  every: string;
  unit: CareRepeatUnit;
  end: 'never' | 'times' | 'until';
  times: string;
  until: string;
}

const UNIT_PLURAL: Record<CareRepeatUnit, string> = { DAY: 'days', WEEK: 'weeks', MONTH: 'months', YEAR: 'years' };
const PRESET_LABEL: Record<CareRepeatUnit, string> = { DAY: 'Every day', WEEK: 'Every week', MONTH: 'Every month', YEAR: 'Every year' };

export const emptyRepeat = (hasProtocol = false): RepeatValue => ({ mode: hasProtocol ? 'protocol' : 'none', every: '2', unit: 'WEEK', end: 'never', times: '3', until: '' });

/** The form value for an existing item's stored repeat. */
export function repeatFromItem(i: { repeatEvery: number | null; repeatUnit: CareRepeatUnit | null; repeatTimes: number | null; repeatUntil: string | null; protocolId: string | null }): RepeatValue {
  const v = emptyRepeat(!!i.protocolId);
  if (i.repeatEvery === 0) return { ...v, mode: 'none' };
  if (!i.repeatEvery || !i.repeatUnit) return v;
  return {
    ...v,
    mode: i.repeatEvery === 1 ? i.repeatUnit : 'custom',
    every: String(i.repeatEvery),
    unit: i.repeatUnit,
    end: i.repeatTimes != null ? 'times' : i.repeatUntil ? 'until' : 'never',
    times: i.repeatTimes != null ? String(i.repeatTimes) : v.times,
    until: i.repeatUntil?.slice(0, 10) ?? '',
  };
}

/** The interval the value stands for (null when it does not repeat on its own). */
function interval(v: RepeatValue): { every: number; unit: CareRepeatUnit } | null {
  if (v.mode === 'protocol' || v.mode === 'none') return null;
  if (v.mode === 'custom') {
    const n = Number(v.every);
    return Number.isInteger(n) && n >= 1 && n <= 999 ? { every: n, unit: v.unit } : null;
  }
  return { every: 1, unit: v.mode };
}

/** Problems to show under the fields (only once the user has tried to save). */
export function repeatErrors(v: RepeatValue, dueDate: string): { every?: string; times?: string; until?: string } {
  const e: { every?: string; times?: string; until?: string } = {};
  if (v.mode === 'custom' && !interval(v)) e.every = 'Enter a number from 1 to 999';
  if (interval(v) || v.mode === 'custom') {
    if (v.end === 'times' && !(Number.isInteger(Number(v.times)) && Number(v.times) >= 1 && Number(v.times) <= 100)) e.times = 'Enter 1 to 100';
    if (v.end === 'until' && !v.until) e.until = 'Choose the last date';
    else if (v.end === 'until' && dueDate && v.until < dueDate) e.until = 'Must be on or after the due date';
  }
  return e;
}

/** The API fields for the value: nothing for the protocol's schedule, repeatEvery 0 for "does not repeat". */
export function repeatPayload(v: RepeatValue, hasProtocol: boolean) {
  if (v.mode === 'protocol') return {};
  const i = interval(v);
  if (!i) return hasProtocol || v.mode === 'none' ? { repeatEvery: 0, repeatUnit: null, repeatTimes: null, repeatUntil: null } : {};
  return { repeatEvery: i.every, repeatUnit: i.unit, repeatTimes: v.end === 'times' ? Number(v.times) : null, repeatUntil: v.end === 'until' ? v.until : null };
}

/**
 * "Repeat" for a vaccination or other care item: the protocol's schedule, once only, every day / week /
 * month / year, or every N days, weeks, months or years — ending never, after a number of doses or on a date.
 * Shows the next due date as a preview.
 */
export function RepeatField({
  value,
  onChange,
  dueDate,
  protocolIntervalDays,
  hasProtocol,
  showErrors,
  idPrefix = 'rp',
}: {
  value: RepeatValue;
  onChange: (v: RepeatValue) => void;
  /** The first due date (yyyy-MM-dd), for the preview and the end-date check. */
  dueDate: string;
  /** The protocol's interval in days, when the item follows a protocol that repeats. */
  protocolIntervalDays?: number | null;
  hasProtocol?: boolean;
  showErrors?: boolean;
  idPrefix?: string;
}) {
  const set = (p: Partial<RepeatValue>) => onChange({ ...value, ...p });
  const own = interval(value);
  const errors = showErrors ? repeatErrors(value, dueDate) : {};
  const protocolLabel = protocolIntervalDays ? repeatLabel(intervalFromDays(protocolIntervalDays).every, intervalFromDays(protocolIntervalDays).unit) : null;
  const shown = own ?? (value.mode === 'protocol' && protocolIntervalDays ? intervalFromDays(protocolIntervalDays) : null);
  const next = shown && dueDate ? addRepeat(new Date(`${dueDate}T00:00:00Z`), shown.every, shown.unit).toISOString().slice(0, 10) : null;
  const lastByTimes = own && value.end === 'times' && Number(value.times) >= 1 ? Number(value.times) : null;

  return (
    <div className="grid gap-3">
      <Field label="Repeat" htmlFor={`${idPrefix}-mode`}>
        <NativeSelect
          id={`${idPrefix}-mode`}
          value={value.mode}
          onChange={(e) => {
            const mode = e.target.value as RepeatValue['mode'];
            set({ mode, ...(mode !== 'custom' && mode !== 'protocol' && mode !== 'none' ? { unit: mode } : {}) });
          }}
        >
          {hasProtocol && <option value="protocol">{protocolLabel ? `As the protocol: ${protocolLabel.toLowerCase()}` : 'As the protocol (does not repeat)'}</option>}
          <option value="none">Does not repeat</option>
          {CARE_REPEAT_UNITS.map((u) => (
            <option key={u} value={u}>
              {PRESET_LABEL[u]}
            </option>
          ))}
          <option value="custom">Custom…</option>
        </NativeSelect>
      </Field>

      {value.mode === 'custom' && (
        <Field label="Repeat every" htmlFor={`${idPrefix}-every`} error={errors.every}>
          <div className="flex gap-2">
            <Input id={`${idPrefix}-every`} type="number" inputMode="numeric" min={1} max={999} className="w-24" value={value.every} onChange={(e) => set({ every: e.target.value })} aria-invalid={!!errors.every} />
            <NativeSelect aria-label="Unit" className="flex-1" value={value.unit} onChange={(e) => set({ unit: e.target.value as CareRepeatUnit })}>
              {CARE_REPEAT_UNITS.map((u) => (
                <option key={u} value={u}>
                  {UNIT_PLURAL[u]}
                </option>
              ))}
            </NativeSelect>
          </div>
        </Field>
      )}

      {(own || value.mode === 'custom') && (
        <div className="grid gap-2">
          <span className="text-sm font-medium">Ends</span>
          <div className={tabListClass} role="radiogroup" aria-label="Ends">
            {(
              [
                ['never', 'Never'],
                ['times', 'After a number of doses'],
                ['until', 'On a date'],
              ] as const
            ).map(([k, l]) => (
              <button key={k} type="button" role="radio" aria-checked={value.end === k} className={tabTriggerClass(value.end === k)} onClick={() => set({ end: k })}>
                {l}
              </button>
            ))}
          </div>
          {value.end === 'times' && (
            <Field label="More doses after this one" htmlFor={`${idPrefix}-times`} error={errors.times}>
              <Input id={`${idPrefix}-times`} type="number" inputMode="numeric" min={1} max={100} className="w-24" value={value.times} onChange={(e) => set({ times: e.target.value })} aria-invalid={!!errors.times} />
            </Field>
          )}
          {value.end === 'until' && (
            <Field label="Last date" htmlFor={`${idPrefix}-until`} error={errors.until}>
              <Input id={`${idPrefix}-until`} type="date" min={dueDate || undefined} className="w-48" value={value.until} onChange={(e) => set({ until: e.target.value })} aria-invalid={!!errors.until} />
            </Field>
          )}
        </div>
      )}

      {next && (
        <p className={cn('flex items-start gap-2 rounded-lg bg-primary/[0.06] px-3 py-2 text-xs text-foreground/80 ring-1 ring-inset ring-primary/15')}>
          <Repeat className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
          <span>
            {repeatSummary({ every: shown!.every, unit: shown!.unit, times: lastByTimes, until: own && value.end === 'until' && value.until ? value.until : null }, fmtDate)}. If it is given on {fmtDate(dueDate)}, the next one is due{' '}
            <strong className="font-semibold">{fmtDate(next)}</strong> — counted from the day each dose is actually given.
          </span>
        </p>
      )}
    </div>
  );
}
