'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { OPTIONAL_MODULES, OPTIONAL_MODULE_INFO, type OptionalModule } from '@vcms/shared';
import { Info, Lock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FormError } from '@/components/forms/form-error';
import { ErrorState, LoadingRows } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/checkbox';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

interface ModulesState {
  enabled: OptionalModule[];
  available: OptionalModule[];
  /** Areas the clinic's plan does not include. */
  locked?: OptionalModule[];
  chosenAt: string | null;
}

function ModulesForm({ initial }: { initial: ModulesState }) {
  const qc = useQueryClient();
  const { refresh } = useSession();
  const [enabled, setEnabled] = useState<Set<OptionalModule>>(new Set(initial.enabled));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setEnabled(new Set(initial.enabled)), [initial.enabled]);
  const locked = new Set(initial.locked ?? []);
  const changed = OPTIONAL_MODULES.some((m) => !locked.has(m) && enabled.has(m) !== initial.enabled.includes(m));
  const save = useMutation({
    mutationFn: () => api.put<ModulesState>('/setup/modules', { enabled: OPTIONAL_MODULES.filter((m) => enabled.has(m)) }),
    onSuccess: async (d) => {
      qc.setQueryData(['clinic-modules'], d);
      qc.invalidateQueries({ queryKey: ['setup-status'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      await refresh();
      toast.success('Saved. The menu now shows only what you offer.');
    },
    onError: (e: Error) => setError(e.message),
  });
  const toggle = (m: OptionalModule, on: boolean) =>
    setEnabled((prev) => {
      const next = new Set(prev);
      if (on) next.add(m);
      else next.delete(m);
      return next;
    });

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Services you offer</CardTitle>
          <p className="text-xs text-muted-foreground">Switch off what your clinic does not do. Those menus, shortcuts and dashboard panels are hidden for everyone.</p>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          Turning a service off only hides it. Nothing is deleted: turn it back on at any time and all its records are still there.
        </p>
        {error && <FormError message={error} />}
        <ul className="divide-y rounded-md border">
          {OPTIONAL_MODULES.map((m) => {
            const id = `module-${m}`;
            if (locked.has(m)) {
              return (
                <li key={m} className="flex items-center gap-4 bg-muted/40 px-4 py-3 text-muted-foreground">
                  <Lock className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{OPTIONAL_MODULE_INFO[m].label}</span>
                    <span className="block text-xs">Not in your plan. Ask NextCore to add it.</span>
                  </span>
                </li>
              );
            }
            return (
              <li key={m} className="flex items-center gap-4 px-4 py-3">
                <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
                  <span className="block text-sm font-medium">{OPTIONAL_MODULE_INFO[m].label}</span>
                  <span className="block text-xs text-muted-foreground">{OPTIONAL_MODULE_INFO[m].description}</span>
                </label>
                <span className="w-8 text-right text-xs text-muted-foreground" aria-hidden>{enabled.has(m) ? 'On' : 'Off'}</span>
                <Switch id={id} checked={enabled.has(m)} onCheckedChange={(on) => toggle(m, on)} />
              </li>
            );
          })}
        </ul>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {!initial.chosenAt && !changed && <p className="mr-auto text-xs text-muted-foreground">Everything is on. Press Save to confirm, or switch off what you don’t offer first.</p>}
          <Button loading={save.isPending} disabled={!changed && !!initial.chosenAt} onClick={() => { setError(null); save.mutate(); }}>Save</Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ModulesSettingsPage() {
  const q = useQuery({ queryKey: ['clinic-modules'], queryFn: () => api.get<ModulesState>('/setup/modules') });
  return (
    <RequirePermission anyOf={['settings.manage', 'org.manage']}>
      {q.isLoading ? <LoadingRows rows={6} /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.data && <ModulesForm initial={q.data} />}
    </RequirePermission>
  );
}
