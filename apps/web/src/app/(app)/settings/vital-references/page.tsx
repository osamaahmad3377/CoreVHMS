'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { VITAL_LABELS, VITAL_PARAMETERS } from '@vcms/shared';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useConfirm } from '@/components/confirm';
import { DataTable } from '@/components/data-table';
import { FormError } from '@/components/forms/form-error';
import { EmptyState } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, NativeSelect } from '@/components/ui/input';
import { api } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { Species } from '@/lib/types';

interface Ref {
  id: string;
  speciesId: string;
  species: { name: string };
  parameter: string;
  low: string;
  high: string;
  unit: string;
  source: string;
  reviewedByName: string | null;
  reviewedAt: string | null;
}

export default function VitalReferencesPage() {
  const { can } = useSession();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const species = useQuery({ queryKey: ['species'], queryFn: () => api.get<Species[]>('/species') });
  const refs = useQuery({ queryKey: ['vital-references'], queryFn: () => api.get<Ref[]>('/vital-references') });
  const [f, setF] = useState({ speciesId: '', parameter: 'heartRate', low: '', high: '', source: '' });
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api.post('/vital-references', { ...f, unit: VITAL_LABELS[f.parameter].unit }),
    onSuccess: () => {
      toast.success('Reference saved');
      setF({ ...f, low: '', high: '' });
      qc.invalidateQueries({ queryKey: ['vital-references'] });
    },
    onError: (e: Error) => setError(e.message),
  });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/vital-references/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['vital-references'] }) });
  return (
    <RequirePermission anyOf={['settings.manage']}>
      <div className="mb-4 flex gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <p>
          Reference intervals are clinical content. Enter values from a validated, current veterinary reference and name the source. NextCore ships with <b>no</b> default ranges; values without a configured range are never flagged. Only vets who can sign clinical notes can edit these; saving records you as the reviewer.
        </p>
      </div>
      <Card>
        <CardHeader><CardTitle>Vital-sign reference intervals</CardTitle></CardHeader>
        {!can('clinical.sign') && <p className="border-b px-4 py-2 text-xs text-muted-foreground">You can view these ranges. Only vets who can sign clinical notes can add or remove them.</p>}
        {can('clinical.sign') && (
          <form className="grid gap-2 border-b p-3" onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(); }}>
            {error && <FormError message={error} />}
            <div className="flex flex-wrap gap-2">
              <NativeSelect aria-label="Species" className="w-40" value={f.speciesId} onChange={(e) => setF({ ...f, speciesId: e.target.value })}>
                <option value="">Species…</option>
                {species.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </NativeSelect>
              <NativeSelect aria-label="Parameter" className="w-44" value={f.parameter} onChange={(e) => setF({ ...f, parameter: e.target.value })}>
                {VITAL_PARAMETERS.map((p) => <option key={p} value={p}>{VITAL_LABELS[p].label} ({VITAL_LABELS[p].unit})</option>)}
              </NativeSelect>
              <Input aria-label="Low" placeholder="Low" className="w-24" inputMode="decimal" value={f.low} onChange={(e) => setF({ ...f, low: e.target.value })} />
              <Input aria-label="High" placeholder="High" className="w-24" inputMode="decimal" value={f.high} onChange={(e) => setF({ ...f, high: e.target.value })} />
              <Input aria-label="Source" placeholder="Source (reference text, edition, page)" className="min-w-[220px] flex-1" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} />
              <Button type="submit" size="sm" disabled={!f.speciesId || !f.low || !f.high || !f.source.trim()} loading={save.isPending}><Plus /> Add</Button>
            </div>
          </form>
        )}
        <DataTable
          query={refs}
          rowKey={(r) => r.id}
          empty={<EmptyState title="No reference intervals configured" description="Vitals are recorded without flags until intervals are added." />}
          columns={[
            { key: 's', header: 'Species', cell: (r) => r.species.name },
            { key: 'p', header: 'Parameter', cell: (r) => VITAL_LABELS[r.parameter]?.label ?? r.parameter },
            { key: 'r', header: 'Interval', cell: (r) => <span className="tabular">{Number(r.low)} – {Number(r.high)} {r.unit}</span> },
            { key: 'src', header: 'Source', cell: (r) => <span className="text-xs">{r.source}</span> },
            { key: 'rev', header: 'Reviewed', cell: (r) => <span className="text-xs text-muted-foreground">{r.reviewedByName} · {fmtDate(r.reviewedAt)}</span> },
            { key: 'x', header: '', cell: (r) => can('settings.manage') && <Button size="icon-sm" variant="ghost" aria-label="Remove" onClick={async () => { const c = await confirm({ title: 'Remove this reference interval?', destructive: true, confirmLabel: 'Remove' }); if (c.confirmed) remove.mutate(r.id); }}><Trash2 /></Button> },
          ]}
        />
      </Card>
    </RequirePermission>
  );
}
