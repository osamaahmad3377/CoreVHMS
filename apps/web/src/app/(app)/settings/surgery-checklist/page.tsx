'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CHECKLIST_PHASES, enumLabel } from '@vcms/shared';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { RequirePermission } from '@/components/require';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';

interface Item { id: string; phase: string; label: string; sortOrder: number; isActive: boolean }

export default function SurgeryChecklistSettingsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['surgery-checklist'], queryFn: () => api.get<Item[]>('/surgery-checklist') });
  const [draft, setDraft] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: ({ id, body }: { id?: string; body: object }) => (id ? api.patch(`/surgery-checklist/${id}`, body) : api.post('/surgery-checklist', body)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['surgery-checklist'] }),
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <RequirePermission anyOf={['settings.manage']}>
      <div className="grid gap-4">
        <div>
          <h2 className="text-base font-semibold">Surgical safety checklist</h2>
          <p className="text-sm text-muted-foreground">Ticked before each surgery. Based on the WHO checklist.</p>
        </div>
        {CHECKLIST_PHASES.map((phase) => {
          const items = (q.data ?? []).filter((i) => i.phase === phase);
          return (
            <Card key={phase}>
              <CardHeader><CardTitle>{enumLabel(phase)}</CardTitle></CardHeader>
              <CardContent className="grid gap-2">
                {items.map((i) => (
                  <label key={i.id} className={`flex items-center gap-2 text-sm ${i.isActive ? '' : 'text-muted-foreground line-through'}`}>
                    <Checkbox checked={i.isActive} onCheckedChange={(v) => save.mutate({ id: i.id, body: { phase: i.phase, label: i.label, sortOrder: i.sortOrder, isActive: !!v } })} aria-label={`${i.isActive ? 'Disable' : 'Enable'} ${i.label}`} />
                    {i.label}
                  </label>
                ))}
                <div className="mt-1 flex gap-2">
                  <Input aria-label={`New item for ${enumLabel(phase)}`} className="h-8" placeholder="Add an item…" value={draft[phase] ?? ''} maxLength={200} onChange={(e) => setDraft((d) => ({ ...d, [phase]: e.target.value }))} />
                  <Button size="sm" variant="outline" disabled={!draft[phase]?.trim()} onClick={() => save.mutate({ body: { phase, label: draft[phase], sortOrder: items.length + 100, isActive: true } }, { onSuccess: () => setDraft((d) => ({ ...d, [phase]: '' })) })}><Plus /> Add</Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
        <p className="text-xs text-muted-foreground">Changes apply to surgeries scheduled from now on; existing surgeries keep the checklist they were created with.</p>
      </div>
    </RequirePermission>
  );
}
