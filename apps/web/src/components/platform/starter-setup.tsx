'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { StarterPlanSection, StarterSection } from '@vcms/shared';
import { ChevronRight, PackagePlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { LoadingRows } from '../page';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Checkbox } from '../ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

/** Overview card on a clinic: adds the new-clinic starter set-up to a clinic that started without it. */
export function StarterSetupCard({ clinicId, clinicName }: { clinicId: string; clinicName: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><PackagePlus className="h-4 w-4" /> Starter set-up</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <p className="text-muted-foreground">Common services (price 0), appointment types, rooms, wards, kennels, tests, store rooms and the “Local Purchase” supplier — only what this clinic doesn’t have yet.</p>
        <Button variant="outline" onClick={() => setOpen(true)}><PackagePlus /> Add starter set-up…</Button>
      </CardContent>
      {open && <StarterSetupDialog clinicId={clinicId} clinicName={clinicName} onOpenChange={setOpen} />}
    </Card>
  );
}

function StarterSetupDialog({ clinicId, clinicName, onOpenChange }: { clinicId: string; clinicName: string; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const key = ['platform-starter', clinicId];
  const plan = useQuery({ queryKey: key, queryFn: () => api.get<StarterPlanSection[]>(`/platform/clinics/${clinicId}/starter-setup`) });
  const [chosen, setChosen] = useState<Set<StarterSection>>(new Set());
  const [shown, setShown] = useState<StarterSection | null>(null);
  // Every part with something missing starts ticked; the preview shows exactly what each would add.
  useEffect(() => {
    if (plan.data) setChosen(new Set(plan.data.filter((s) => s.items.length).map((s) => s.key)));
  }, [plan.data]);

  const sections = plan.data ?? [];
  const total = sections.filter((s) => chosen.has(s.key)).reduce((n, s) => n + s.items.length, 0);
  const add = useMutation({
    mutationFn: () => api.post<{ total: number; plan: StarterPlanSection[] }>(`/platform/clinics/${clinicId}/starter-setup`, { sections: [...chosen] }),
    onSuccess: (r) => {
      toast.success(r.total ? `Added ${r.total} ${r.total === 1 ? 'item' : 'items'} to ${clinicName}` : 'Nothing was missing');
      qc.setQueryData(key, r.plan);
      qc.invalidateQueries({ queryKey: ['platform-clinic', clinicId] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const toggle = (k: StarterSection, on: boolean) => setChosen((c) => {
    const n = new Set(c);
    if (on) n.add(k);
    else n.delete(k);
    return n;
  });
  const nothing = !!plan.data && sections.every((s) => !s.items.length);

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Add starter set-up to {clinicName}</DialogTitle>
          <DialogDescription>
            The same set-up every new clinic gets. Only what the clinic doesn’t have yet is added — anything with the same name or code is left as it is, and new prices start at 0. Untick a part the clinic already covers under other names.
          </DialogDescription>
        </DialogHeader>
        {plan.isLoading ? (
          <LoadingRows rows={6} />
        ) : nothing ? (
          <p className="rounded-xl bg-success/10 px-4 py-6 text-center text-sm">This clinic already has everything in the starter set-up.</p>
        ) : (
          <ul className="grid max-h-[55vh] gap-1.5 overflow-y-auto pr-1">
            {sections.map((s) => {
              const empty = !s.items.length;
              const open = shown === s.key;
              return (
                <li key={s.key} className={cn('rounded-xl border', empty && 'opacity-60')}>
                  <div className="flex items-center gap-3 px-3 py-2.5">
                    <Checkbox id={`st-${s.key}`} checked={chosen.has(s.key)} disabled={empty} onCheckedChange={(v) => toggle(s.key, v === true)} aria-label={s.label} />
                    <label htmlFor={`st-${s.key}`} className="min-w-0 flex-1 text-sm font-medium">{s.label}</label>
                    {empty ? (
                      <span className="text-xs text-muted-foreground">{s.note}</span>
                    ) : (
                      <button type="button" aria-expanded={open} onClick={() => setShown(open ? null : s.key)} className="flex items-center gap-1 rounded-pill px-2 py-0.5 text-xs text-primary hover:bg-primary/5">
                        {s.items.length} to add <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-90')} />
                      </button>
                    )}
                  </div>
                  {open && <p className="border-t px-3 py-2 text-xs leading-relaxed text-muted-foreground">{s.items.join(' · ')}</p>}
                </li>
              );
            })}
          </ul>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{nothing ? 'Close' : 'Cancel'}</Button>
          {!nothing && (
            <Button disabled={!total} loading={add.isPending} onClick={() => add.mutate()}>
              <PackagePlus /> {total ? `Add ${total} ${total === 1 ? 'item' : 'items'}` : 'Add'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
