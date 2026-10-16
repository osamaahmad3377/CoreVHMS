'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { FormError } from '../forms/form-error';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Table, TBody, TD, TH, THead, TR } from '../ui/table';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import { branchTime } from '@/lib/time';
import { cn } from '@/lib/utils';

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

const FIELDS: { key: string; label: string; unit?: string; mode?: 'decimal' | 'numeric' | 'text' }[] = [
  { key: 'temperatureC', label: 'Temp', unit: '°C', mode: 'decimal' },
  { key: 'heartRate', label: 'Heart rate', unit: '/min', mode: 'numeric' },
  { key: 'respiratoryRate', label: 'Resp. rate', unit: '/min', mode: 'numeric' },
  { key: 'painScore', label: 'Pain (0–10)', mode: 'numeric' },
  { key: 'mucousMembranes', label: 'Mucous membranes', mode: 'text' },
  { key: 'capillaryRefillSec', label: 'CRT', unit: 's', mode: 'decimal' },
  { key: 'weightKg', label: 'Weight', unit: 'kg', mode: 'decimal' },
];

/** Inpatient observations: quick entry, trend chart and flagged table (flags use the clinic's sourced reference ranges). */
export function Observations({ admissionId, active }: { admissionId: string; active: boolean }) {
  const qc = useQueryClient();
  const { can, session } = useSession();
  const tz = session.branch?.timezone ?? 'UTC';
  const [values, setValues] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['admission-vitals', admissionId], queryFn: () => api.get<{ vitals: VitalRow[] }>(`/admissions/${admissionId}/vitals`) });
  const m = useMutation({
    mutationFn: () => api.post(`/admissions/${admissionId}/vitals`, { ...Object.fromEntries(Object.entries(values).filter(([, v]) => v !== '')), notes: notes || null }),
    onSuccess: () => { toast.success('Observations recorded'); setValues({}); setNotes(''); qc.invalidateQueries({ queryKey: ['admission-vitals', admissionId] }); qc.invalidateQueries({ queryKey: ['flowboard'] }); },
    onError: (e: Error) => setError(e.message),
  });
  const rows = q.data?.vitals ?? [];
  const chart = [...rows].reverse().map((v) => ({ time: branchTime(v.recordedAt, tz, 'dd/MM HH:mm'), Temp: v.temperatureC, HR: v.heartRate, RR: v.respiratoryRate }));
  return (
    <div className="grid gap-4">
      {active && can('hospital.write') && (
        <Card>
          <CardHeader><CardTitle>Record observations</CardTitle></CardHeader>
          <CardContent className="grid gap-3">
            {error && <FormError message={error} />}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
              {FIELDS.map((f) => (
                <label key={f.key} className="grid gap-1 text-xs text-muted-foreground">
                  {f.label}{f.unit ? ` (${f.unit})` : ''}
                  <Input inputMode={f.mode === 'text' ? 'text' : f.mode} value={values[f.key] ?? ''} onChange={(e) => setValues((s) => ({ ...s, [f.key]: e.target.value }))} />
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
                <Line yAxisId="t" type="monotone" dataKey="Temp" stroke="hsl(var(--destructive))" dot connectNulls />
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
              <THead><TR><TH>Time</TH>{FIELDS.map((f) => <TH key={f.key} className="text-right">{f.label}</TH>)}<TH>Notes</TH></TR></THead>
              <TBody>
                {rows.map((v) => (
                  <TR key={v.id}>
                    <TD className="whitespace-nowrap text-xs">{fmtDateTime(v.recordedAt)}<span className="block text-muted-foreground">{v.recordedByName}</span></TD>
                    {FIELDS.map((f) => {
                      const val = (v as any)[f.key];
                      const flag = v.flags[f.key];
                      return <TD key={f.key} className={cn('text-right tabular', flag && 'font-semibold text-destructive')} title={flag ? `${flag.flag} (range ${flag.low}–${flag.high}, ${flag.source})` : undefined}>{val ?? '—'}{flag ? (flag.flag === 'HIGH' ? ' ↑' : ' ↓') : ''}</TD>;
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
