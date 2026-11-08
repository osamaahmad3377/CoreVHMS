'use client';
import { useMutation } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { vitalsText } from '../clinical/note-editor';
import { VitalsPanel } from '../clinical/vitals-panel';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { api } from '@/lib/api';
import type { Vitals } from '@/lib/types';
import { useUnits } from '@/lib/units';
import { cn } from '@/lib/utils';

type Form = { temperatureC: string; weightKg: string; heartRate: string; respiratoryRate: string };
const blank: Form = { temperatureC: '', weightKg: '', heartRate: '', respiratoryRate: '' };

/**
 * The four measurements taken at almost every visit, typed in one row and saved with Enter. Temperature and weight
 * are in the clinic's units. Blood pressure, pain, gums and the rest are under "More measurements" (the full form).
 */
export function QuickVitals({ encounterId, vitals, lastWeightKg, editable, onSaved }: { encounterId: string; vitals: Vitals[]; lastWeightKg: number | null; editable: boolean; onSaved: () => void }) {
  const u = useUnits();
  const [form, setForm] = useState<Form>(blank);
  const [adding, setAdding] = useState(vitals.length === 0);
  const [more, setMore] = useState(false);
  const latest = vitals[0] ?? null;
  const filled = Object.values(form).some((v) => v.trim());

  const save = useMutation({
    mutationFn: () =>
      api.post<Vitals>(`/encounters/${encounterId}/vitals`, {
        ...(form.temperatureC ? { temperatureC: u.toC(form.temperatureC) } : {}),
        ...(form.weightKg ? { weightKg: u.toKg(form.weightKg) } : {}),
        ...(form.heartRate ? { heartRate: Number(form.heartRate) } : {}),
        ...(form.respiratoryRate ? { respiratoryRate: Number(form.respiratoryRate) } : {}),
      }),
    onSuccess: () => {
      setForm(blank);
      setAdding(false);
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const field = (key: keyof Form, label: string, unit: string, step: string, placeholder?: string) => (
    <label className="grid min-w-0 gap-1 text-xs font-medium text-muted-foreground">
      {label}
      <div className="relative">
        <Input
          id={key === 'temperatureC' ? 'qc-vitals-first' : undefined}
          type="number"
          inputMode="decimal"
          step={step}
          className="h-10 pr-12 text-base text-foreground"
          placeholder={placeholder}
          value={form[key]}
          onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
          onKeyDown={(e) => e.key === 'Enter' && filled && (e.preventDefault(), save.mutate())}
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{unit}</span>
      </div>
    </label>
  );

  const flagged = latest?.flags ? Object.keys(latest.flags) : [];
  return (
    <div className="grid gap-2">
      {latest && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className={cn('rounded-lg bg-muted/60 px-2.5 py-1.5', flagged.length && 'ring-1 ring-warning')}>
            {vitalsText(latest) || 'Measurements recorded'}
            {flagged.length > 0 && <span className="ml-2 text-xs font-medium text-warning">outside the clinic’s range: {flagged.join(', ')}</span>}
          </span>
          {editable && !adding && (
            <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(true)}>
              <Plus /> New reading
            </Button>
          )}
        </div>
      )}
      {editable && adding && (
        <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
          {field('temperatureC', 'Temperature', u.t, '0.1')}
          {field('weightKg', 'Weight', u.w, '0.01', lastWeightKg ? `last ${u.fromKg(lastWeightKg)}` : undefined)}
          {field('heartRate', 'Heart rate', '/min', '1')}
          {field('respiratoryRate', 'Breathing', '/min', '1')}
          <Button type="button" className="col-span-2 h-10 sm:col-span-1" disabled={!filled} loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </div>
      )}
      <button type="button" onClick={() => setMore((m) => !m)} className="w-fit text-xs font-medium text-primary hover:underline">
        {more ? 'Hide more measurements' : 'More measurements (blood pressure, pain, gums…)'}
      </button>
      {more && <VitalsPanel encounterId={encounterId} vitals={vitals} editable={editable} onSaved={onSaved} />}
    </div>
  );
}
