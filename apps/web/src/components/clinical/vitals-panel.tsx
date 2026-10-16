'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { VITAL_LABELS } from '@vcms/shared';
import { Activity, ArrowDown, ArrowUp, Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormError } from '../forms/form-error';
import { EmptyState } from '../page';
import { Button } from '../ui/button';
import { Card, CardHeader, CardTitle } from '../ui/card';
import { Input, NativeSelect } from '../ui/input';
import { Label } from '../ui/label';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import type { Vitals } from '@/lib/types';
import { cn } from '@/lib/utils';

const FIELDS = [
  { key: 'temperatureC', label: 'Temp °C', step: '0.1' },
  { key: 'heartRate', label: 'HR /min', step: '1' },
  { key: 'respiratoryRate', label: 'RR /min', step: '1' },
  { key: 'weightKg', label: 'Weight kg', step: '0.01' },
  { key: 'capillaryRefillSec', label: 'CRT s', step: '0.5' },
  { key: 'painScore', label: 'Pain 0–10', step: '1' },
  { key: 'systolicBp', label: 'Sys BP', step: '1' },
  { key: 'spo2', label: 'SpO₂ %', step: '1' },
] as const;

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

export function VitalsPanel({ encounterId, vitals, editable, onSaved }: { encounterId: string; vitals: Vitals[]; editable: boolean; onSaved: () => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => api.post<Vitals>(`/encounters/${encounterId}/vitals`, form),
    onSuccess: (v) => {
      const flagged = Object.keys(v.flags ?? {});
      if (flagged.length) toast.warning(`Outside reference range: ${flagged.map((f) => VITAL_LABELS[f]?.label ?? f).join(', ')}`);
      else toast.success('Vitals recorded');
      setForm({});
      setOpen(false);
      qc.invalidateQueries({ queryKey: ['patient-vitals'] });
      onSaved();
    },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" /> Vital signs
        </CardTitle>
        {editable && !open && (
          <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
            <Plus /> Record
          </Button>
        )}
      </CardHeader>
      {open && (
        <form
          className="grid gap-2 border-b p-3"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            m.mutate();
          }}
        >
          {error && <FormError message={error} />}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {FIELDS.map((f) => (
              <div key={f.key} className="grid gap-1">
                <Label htmlFor={`v-${f.key}`} className="text-xs">
                  {f.label}
                </Label>
                <Input id={`v-${f.key}`} type="number" step={f.step} inputMode="decimal" className="h-8" value={form[f.key] ?? ''} onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))} />
              </div>
            ))}
            <div className="col-span-2 grid gap-1">
              <Label htmlFor="v-mm" className="text-xs">
                Mucous membranes
              </Label>
              <NativeSelect id="v-mm" className="h-8" value={form.mucousMembranes ?? ''} onChange={(e) => setForm((s) => ({ ...s, mucousMembranes: e.target.value }))}>
                <option value=""></option>
                {['Pink', 'Pale', 'White', 'Cyanotic', 'Injected', 'Icteric', 'Brick red'].map((x) => <option key={x}>{x}</option>)}
              </NativeSelect>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
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
                {FIELDS.slice(0, 6).map((f) => (
                  <th key={f.key} className="px-2 py-1.5 text-right font-medium">
                    {f.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {vitals.map((v) => (
                <tr key={v.id} className="border-t">
                  <td className="whitespace-nowrap px-2 py-1.5 text-muted-foreground">{fmtDateTime(v.recordedAt).split(', ')[1]}</td>
                  {FIELDS.slice(0, 6).map((f) => (
                    <td key={f.key} className="px-2 py-1.5 text-right">
                      <Value v={v} k={f.key} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        !open && <EmptyState title="No vitals recorded" className="py-6" />
      )}
      <p className="px-3 py-2 text-2xs text-muted-foreground">Flags use your clinic's configured, sourced reference ranges (Settings → Vital references). Values without a configured range are not flagged.</p>
    </Card>
  );
}
