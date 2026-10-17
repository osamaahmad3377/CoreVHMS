'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { VITAL_LABELS, checkVital, type VitalKey } from '@vcms/shared';
import { Activity, ArrowDown, ArrowUp, Plus } from 'lucide-react';
import Link from 'next/link';
import { Fragment, forwardRef, useImperativeHandle, useState } from 'react';
import { toast } from 'sonner';
import { FormError } from '../forms/form-error';
import { Button } from '../ui/button';
import { Card, CardHeader, CardTitle } from '../ui/card';
import { Input, NativeSelect } from '../ui/input';
import { Label } from '../ui/label';
import { ApiError, api } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { Vitals } from '@/lib/types';
import { cn } from '@/lib/utils';

/** `label` for the entry form (plain words first), `short` for the narrow history table. */
const FIELDS = [
  { key: 'temperatureC', label: 'Temperature (°C)', short: 'Temp °C', step: '0.1' },
  { key: 'heartRate', label: 'Heart rate (beats/min)', short: 'Heart rate', step: '1' },
  { key: 'respiratoryRate', label: 'Breathing rate (breaths/min)', short: 'Breathing', step: '1' },
  { key: 'weightKg', label: 'Weight (kg)', short: 'Weight kg', step: '0.01' },
  { key: 'capillaryRefillSec', label: 'Gum refill time — CRT (seconds)', short: 'Gum refill s', step: '0.5' },
  { key: 'painScore', label: 'Pain score (0–10)', short: 'Pain 0–10', step: '1' },
  { key: 'systolicBp', label: 'Blood pressure — systolic', short: 'Blood pressure', step: '1' },
  { key: 'spo2', label: 'Oxygen level — SpO₂ %', short: 'Oxygen %', step: '1' },
] as const;

/** Descriptive mucous-membrane colours, shared by consultation vitals and hospital observations (no reference ranges). */
export const MUCOUS_MEMBRANES = ['Pink', 'Pale', 'White', 'Cyanotic', 'Injected', 'Icteric', 'Brick red'];

/** Columns of the history table; anything else recorded is listed in a line under the row. */
const COLUMNS = FIELDS.slice(0, 6);
const EXTRA = FIELDS.slice(6);

function Value({ v, k }: { v: Vitals; k: string }) {
  const value = (v as any)[k];
  if (value === null || value === undefined) return <span className="text-muted-foreground">—</span>;
  const flag = v.flags?.[k];
  return (
    <span
      className={cn('inline-flex items-center gap-0.5 tabular', flag && 'font-semibold text-destructive')}
      title={flag ? `${flag.flag === 'HIGH' ? 'Above' : 'Below'} reference ${flag.low}–${flag.high} (${flag.source})` : undefined}
    >
      {value}
      {flag?.flag === 'HIGH' && <ArrowUp className="h-3 w-3" aria-label="high" />}
      {flag?.flag === 'LOW' && <ArrowDown className="h-3 w-3" aria-label="low" />}
    </span>
  );
}

const without = (o: Record<string, string>, key: string) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== key));

export interface VitalsPanelHandle {
  /** Opens the entry form and scrolls to it (used by the consultation action bar). */
  openForm: () => void;
}

export const VitalsPanel = forwardRef<VitalsPanelHandle, { encounterId: string; vitals: Vitals[]; editable: boolean; onSaved: () => void }>(function VitalsPanel({ encounterId, vitals, editable, onSaved }, ref) {
  const qc = useQueryClient();
  const { can } = useSession();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  /** Field messages: typed-in checks first, then the server's answer. */
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  useImperativeHandle(ref, () => ({
    openForm: () => {
      setOpen(true);
      setTimeout(() => {
        document.getElementById('vitals-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        document.getElementById('v-temperatureC')?.focus();
      }, 50);
    },
  }));
  const m = useMutation({
    mutationFn: () => api.post<Vitals>(`/encounters/${encounterId}/vitals`, form),
    onSuccess: (v) => {
      const flagged = Object.keys(v.flags ?? {});
      if (flagged.length) toast.warning(`Outside the normal range: ${flagged.map((f) => VITAL_LABELS[f]?.label ?? f).join(', ')}`);
      else toast.success('Vitals recorded');
      setForm({});
      setFieldErrors({});
      setOpen(false);
      qc.invalidateQueries({ queryKey: ['patient-vitals'] });
      onSaved();
    },
    onError: (e: Error) => {
      if (e instanceof ApiError && Object.keys(e.fieldErrors).length) {
        setFieldErrors(e.fieldErrors);
        setError(null);
      } else setError(e);
    },
  });
  const local = (key: string) => checkVital(key as VitalKey, form[key]);
  const submit = () => {
    const problems = Object.fromEntries(FIELDS.map((f) => [f.key, local(f.key)?.message]).filter(([, msg]) => msg));
    setFieldErrors(problems as Record<string, string>);
    setError(null);
    if (Object.keys(problems).length) {
      document.getElementById(`v-${Object.keys(problems)[0]}`)?.focus();
      return;
    }
    m.mutate();
  };
  return (
    <Card id="vitals-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" /> Vital signs
        </CardTitle>
        {editable && !open && (
          <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
            <Plus /> Record vitals
          </Button>
        )}
      </CardHeader>
      {open && (
        <form
          className="grid gap-2 border-b p-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {!!error && <FormError error={error} />}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {FIELDS.map((f) => {
              const msg = fieldErrors[f.key];
              const hint = msg ? local(f.key) : null;
              return (
                <div key={f.key} className="grid content-start gap-1">
                  <Label htmlFor={`v-${f.key}`} className={cn('text-xs', msg && 'text-destructive')}>
                    {f.label}
                  </Label>
                  <Input
                    id={`v-${f.key}`}
                    type="number"
                    step={f.step}
                    inputMode="decimal"
                    className="h-8"
                    aria-invalid={msg ? true : undefined}
                    aria-describedby={msg ? `v-${f.key}-error` : undefined}
                    value={form[f.key] ?? ''}
                    onChange={(e) => {
                      setForm((s) => ({ ...s, [f.key]: e.target.value }));
                      if (fieldErrors[f.key]) setFieldErrors((errs) => without(errs, f.key));
                    }}
                  />
                  {msg && (
                    <p id={`v-${f.key}-error`} role="alert" className="text-2xs text-destructive">
                      {msg}.
                      {hint?.suggestion != null && (
                        <button
                          type="button"
                          className="ml-1 font-semibold underline"
                          onClick={() => {
                            setForm((s) => ({ ...s, [f.key]: String(hint.suggestion) }));
                            setFieldErrors((errs) => without(errs, f.key));
                          }}
                        >
                          Did you mean {hint.suggestion}?
                        </button>
                      )}
                    </p>
                  )}
                </div>
              );
            })}
            <div className="col-span-2 grid content-start gap-1">
              <Label htmlFor="v-mm" className="text-xs">
                Gum colour (mucous membranes)
              </Label>
              <NativeSelect id="v-mm" className="h-8" value={form.mucousMembranes ?? ''} onChange={(e) => setForm((s) => ({ ...s, mucousMembranes: e.target.value }))}>
                <option value=""></option>
                {MUCOUS_MEMBRANES.map((x) => <option key={x}>{x}</option>)}
              </NativeSelect>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => { setOpen(false); setFieldErrors({}); setError(null); }}>
              Cancel
            </Button>
            <Button type="submit" size="sm" loading={m.isPending}>
              Save vitals
            </Button>
          </div>
        </form>
      )}
      {vitals.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/60 text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium">Time</th>
                {COLUMNS.map((f) => (
                  <th key={f.key} className="px-2 py-1.5 text-right font-medium" title={f.label}>
                    {f.short}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {vitals.map((v) => {
                const extra = EXTRA.filter((f) => v[f.key] !== null && v[f.key] !== undefined);
                const more = extra.length > 0 || !!v.mucousMembranes || !!v.notes;
                return (
                  <Fragment key={v.id}>
                    <tr className="border-t">
                      <td className="whitespace-nowrap px-2 py-1.5 text-muted-foreground">{fmtDateTime(v.recordedAt).split(', ')[1]}</td>
                      {COLUMNS.map((f) => (
                        <td key={f.key} className="px-2 py-1.5 text-right">
                          <Value v={v} k={f.key} />
                        </td>
                      ))}
                    </tr>
                    {more && (
                      <tr>
                        <td colSpan={COLUMNS.length + 1} className="px-2 pb-1.5 text-muted-foreground">
                          <span className="flex flex-wrap gap-x-3 gap-y-0.5">
                            {extra.map((f) => (
                              <span key={f.key}>
                                {f.short}: <Value v={v} k={f.key} />
                                {f.key === 'systolicBp' && v.diastolicBp !== null && <span className="tabular">/{v.diastolicBp}</span>}
                              </span>
                            ))}
                            {v.mucousMembranes && <span>Gum colour: <span className="text-foreground">{v.mucousMembranes}</span></span>}
                            {v.notes && <span className="min-w-0 break-words">{v.notes}</span>}
                          </span>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        !open && <p className="px-3 py-2 text-xs text-muted-foreground">No vitals recorded yet.</p>
      )}
      {vitals.length > 0 && (
        <p className="px-3 py-2 text-2xs text-muted-foreground">
          Values outside the normal range turn red.
          {can('settings.manage') && (
            <>
              {' '}
              Set the ranges in{' '}
              <Link href="/settings/vital-references" className="underline">
                Settings → Normal vital-sign ranges
              </Link>
              .
            </>
          )}
        </p>
      )}
    </Card>
  );
});
