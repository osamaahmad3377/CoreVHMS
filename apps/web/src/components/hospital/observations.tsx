'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { FormError } from '../forms/form-error';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { MUCOUS_MEMBRANES } from '../clinical/vitals-panel';
import { Input, NativeSelect } from '../ui/input';
import { Table, TBody, TD, TH, THead, TR } from '../ui/table';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import { branchTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import { useUnits, type UnitHelpers } from '@/lib/units';

interface VitalRow {
  id: string;
  recordedAt: string;
  recordedByName: string | null;
  temperatureC: number | null;
  heartRate: number | null;
  respiratoryRate: number | null;
  painScore: number | null;
  mucousMembranes: string | null;
  capillaryRefillSec: number | null;
  weightKg: number | null;
  notes: string | null;
  flags: Record<string, { flag: 'LOW' | 'HIGH'; low: number; high: number; source: string }>;
}

type Obs = { key: string; label: string; unit?: string; mode?: 'decimal' | 'numeric' | 'text' };
const FIELDS: Obs[] = [
  { key: 'temperatureC', label: 'Temp', unit: '°C', mode: 'decimal' },
  { key: 'heartRate', label: 'Heart rate', unit: '/min', mode: 'numeric' },
  { key: 'respiratoryRate', label: 'Resp. rate', unit: '/min', mode: 'numeric' },
  { key: 'painScore', label: 'Pain (0–10)', mode: 'numeric' },
  { key: 'mucousMembranes', label: 'Mucous membranes', mode: 'text' },
  { key: 'capillaryRefillSec', label: 'CRT', unit: 's', mode: 'decimal' },
  { key: 'weightKg', label: 'Weight', unit: 'kg', mode: 'decimal' },
];

/** The fields with the clinic's temperature and weight units. */
const fieldsIn = (u: UnitHelpers): Obs[] => FIELDS.map((f) => (f.key === 'temperatureC' ? { ...f, unit: u.t } : f.key === 'weightKg' ? { ...f, unit: u.w } : f));
/** A stored value (°C, kg) in the clinic's unit. */
const shown = (key: string, v: unknown, u: UnitHelpers) => (v == null ? v : key === 'temperatureC' ? u.fromC(v as number) : key === 'weightKg' ? u.fromKg(v as number) : v);

/** Inpatient observations: quick entry, trend chart and flagged table (flags use the clinic's sourced reference ranges). */
export function Observations({ admissionId, active }: { admissionId: string; active: boolean }) {
  const qc = useQueryClient();
  const { can, session } = useSession();
  const tz = session.branch?.timezone ?? 'UTC';
  const u = useUnits();
  const fields = fieldsIn(u);
  const [values, setValues] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['admission-vitals', admissionId], queryFn: () => api.get<{ vitals: VitalRow[] }>(`/admissions/${admissionId}/vitals`) });
  const m = useMutation({
    // Typed in the clinic's units; stored as °C and kg.
    mutationFn: () =>
      api.post(`/admissions/${admissionId}/vitals`, {
        ...Object.fromEntries(Object.entries(values).filter(([, v]) => v !== '').map(([k, v]) => [k, k === 'temperatureC' ? u.toC(v) : k === 'weightKg' ? u.toKg(v) : v])),
        notes: notes || null,
      }),
    onSuccess: () => { toast.success('Observations recorded'); setValues({}); setNotes(''); qc.invalidateQueries({ queryKey: ['admission-vitals', admissionId] }); qc.invalidateQueries({ queryKey: ['flowboard'] }); },
    onError: (e: Error) => setError(e.message),
  });
  const rows = q.data?.vitals ?? [];
  const chart = [...rows].reverse().map((v) => ({ time: branchTime(v.recordedAt, tz, 'dd/MM HH:mm'), Temp: u.fromC(v.temperatureC), HR: v.heartRate, RR: v.respiratoryRate }));
  return (
    <div className="grid gap-4">
      {active && can('hospital.write') && (
        <Card>
          <CardHeader><CardTitle>Record observations</CardTitle></CardHeader>
          <CardContent className="grid gap-3">
            {error && <FormError message={error} />}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
              {fields.map((f) => (
                <label key={f.key} className="grid gap-1 text-xs text-muted-foreground">
                  {f.label}{f.unit ? ` (${f.unit})` : ''}
                  {f.key === 'mucousMembranes' ? (
                    <NativeSelect value={values[f.key] ?? ''} onChange={(e) => setValues((s) => ({ ...s, [f.key]: e.target.value }))}>
                      <option value=""></option>
                      {MUCOUS_MEMBRANES.map((x) => <option key={x}>{x}</option>)}
                    </NativeSelect>
                  ) : (
                    <Input inputMode={f.mode === 'text' ? 'text' : f.mode} value={values[f.key] ?? ''} onChange={(e) => setValues((s) => ({ ...s, [f.key]: e.target.value }))} />
                  )}
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <Input aria-label="Observation notes" placeholder="Notes (demeanour, urine, faeces, vomiting…)" value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />
              <Button loading={m.isPending} disabled={!Object.values(values).some((v) => v !== '') && !notes} onClick={() => { setError(null); m.mutate(); }}>Save</Button>
            </div>
          </CardContent>
        </Card>
      )}
      {rows.length > 1 && (
        <Card>
          <CardHeader><CardTitle>Trends</CardTitle></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chart} margin={{ left: -15, right: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                <YAxis yAxisId="t" domain={['auto', 'auto']} tick={{ fontSize: 10 }} />
                <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                 <Line yAxisId="t" type="monotone" dataKey="Temp" name={`Temp ${u.t}`} stroke="hsl(var(--destructive))" dot connectNulls />
                <Line yAxisId="r" type="monotone" dataKey="HR" stroke="hsl(var(--primary))" dot connectNulls />
                <Line yAxisId="r" type="monotone" dataKey="RR" stroke="hsl(var(--info))" dot connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader><CardTitle>Observation history</CardTitle></CardHeader>
        {rows.length ? (
          <div className="overflow-x-auto">
            <Table>
              <THead><TR><TH>Time</TH>{fields.map((f) => <TH key={f.key} className="text-right">{f.label}{f.key === 'temperatureC' || f.key === 'weightKg' ? ` (${f.unit})` : ''}</TH>)}<TH>Notes</TH></TR></THead>
              <TBody>
                {rows.map((v) => (
                  <TR key={v.id}>
                    <TD className="whitespace-nowrap text-xs">{fmtDateTime(v.recordedAt)}<span className="block text-muted-foreground">{v.recordedByName}</span></TD>
                    {fields.map((f) => {
                      const val = shown(f.key, (v as any)[f.key], u) as React.ReactNode;
                      const flag = v.flags[f.key];
                      return <TD key={f.key} className={cn('text-right tabular', flag && 'font-semibold text-destructive')} title={flag ? `${flag.flag} (range ${shown(f.key, flag.low, u)}–${shown(f.key, flag.high, u)}, ${flag.source})` : undefined}>{val ?? '—'}{flag ? (flag.flag === 'HIGH' ? ' ↑' : ' ↓') : ''}</TD>;
                    })}
                    <TD className="text-xs">{v.notes}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        ) : <p className="px-4 pb-4 text-sm text-muted-foreground">No observations recorded during this stay.</p>}
      </Card>
    </div>
  );
}
