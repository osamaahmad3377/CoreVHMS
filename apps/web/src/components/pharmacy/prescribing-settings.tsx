'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldQuestion } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { api } from '@/lib/api';

/**
 * Clinic setting for the prescribing screen's "This is 9 tablets per dose — is that correct?" prompt.
 * A typing-mistake check only, not a dose limit: the vet ticks to confirm and carries on.
 */
export function PrescribingPromptSetting() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['pharmacy-settings'], queryFn: () => api.get<{ confirmUnitsPerDoseAbove: number }>('/pharmacy-settings') });
  const [value, setValue] = useState('');
  useEffect(() => {
    if (q.data) setValue(String(q.data.confirmUnitsPerDoseAbove));
  }, [q.data]);
  const save = useMutation({
    mutationFn: () => api.patch<{ confirmUnitsPerDoseAbove: number }>('/pharmacy-settings', { confirmUnitsPerDoseAbove: Number(value) }),
    onSuccess: (r) => {
      toast.success(`Saved: vets confirm doses of more than ${r.confirmUnitsPerDoseAbove} tablets or units`);
      qc.invalidateQueries({ queryKey: ['pharmacy-settings'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const valid = /^\d+$/.test(value) && Number(value) >= 1;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg surface-flat px-3 py-2 text-sm">
      <ShieldQuestion className="h-4 w-4 text-muted-foreground" />
      <label htmlFor="rx-confirm-above">Ask the vet to confirm when a dose is more than</label>
      <Input id="rx-confirm-above" inputMode="numeric" className="h-8 w-16" value={value} onChange={(e) => setValue(e.target.value)} />
      <span>tablets, capsules or units.</span>
      <Button size="sm" variant="outline" disabled={!valid || !q.data || Number(value) === q.data.confirmUnitsPerDoseAbove} loading={save.isPending} onClick={() => save.mutate()}>
        Save
      </Button>
      <span className="basis-full text-xs text-muted-foreground">A check for typing mistakes, not a dose limit. Liquids (mL) are not counted.</span>
    </div>
  );
}
