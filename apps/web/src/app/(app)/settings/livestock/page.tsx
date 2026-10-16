'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { enumLabel } from '@vcms/shared';
import { useState } from 'react';
import { toast } from 'sonner';
import { RequirePermission } from '@/components/require';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';

interface Row { id: string; name: string; category: string; gestationDays: number | null; gestationSource: string | null }

function SpeciesRow({ s }: { s: Row }) {
  const qc = useQueryClient();
  const [days, setDays] = useState(s.gestationDays?.toString() ?? '');
  const [source, setSource] = useState(s.gestationSource ?? '');
  const changed = days !== (s.gestationDays?.toString() ?? '') || source !== (s.gestationSource ?? '');
  const m = useMutation({
    mutationFn: () => api.patch(`/livestock/species/${s.id}`, { gestationDays: days || null, gestationSource: source || null }),
    onSuccess: () => { toast.success(`${s.name} saved`); qc.invalidateQueries({ queryKey: ['livestock-species'] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <tr className="border-t">
      <td className="p-2 font-medium">{s.name}<span className="block text-xs font-normal text-muted-foreground">{enumLabel(s.category)}</span></td>
      <td className="p-2"><Input aria-label={`${s.name} gestation days`} className="w-24" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} placeholder="days" /></td>
      <td className="p-2"><Input aria-label={`${s.name} source`} value={source} maxLength={300} onChange={(e) => setSource(e.target.value)} placeholder="Where this figure comes from (reference, vet)" /></td>
      <td className="p-2 text-right"><Button size="sm" variant={changed ? 'default' : 'ghost'} disabled={!changed || (!!days && !source.trim())} loading={m.isPending} onClick={() => m.mutate()}>Save</Button></td>
    </tr>
  );
}

export default function LivestockSettingsPage() {
  const q = useQuery({ queryKey: ['livestock-species'], queryFn: () => api.get<Row[]>('/livestock/species') });
  return (
    <RequirePermission anyOf={['settings.manage']}>
      <div className="grid gap-4">
        <div>
          <h2 className="text-base font-semibold">Livestock — gestation lengths</h2>
          <p className="text-sm text-muted-foreground">Used to work out expected due dates after a service, insemination or positive pregnancy check. Nothing is pre-filled: enter your clinic’s reviewed figure and its source. Leave blank and due dates must be entered by hand.</p>
        </div>
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr><th className="p-2">Species</th><th className="p-2">Gestation (days)</th><th className="p-2">Source</th><th /></tr></thead>
            <tbody>{(q.data ?? []).map((s) => <SpeciesRow key={`${s.id}:${s.gestationDays}:${s.gestationSource}`} s={s} />)}</tbody>
          </table>
        </Card>
        <p className="text-xs text-muted-foreground">Withdrawal periods for medicines are set per product and species in Pharmacy → Medicines, each with its source.</p>
      </div>
    </RequirePermission>
  );
}
