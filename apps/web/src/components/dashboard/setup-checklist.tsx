'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Rocket, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

export interface SetupStatus {
  steps: { key: string; title: string; description: string; href: string; done: boolean; skipped: boolean; startAction?: 'store-room' }[];
  completed: number;
  total: number;
  hidden: boolean;
  minutes: number;
}

/**
 * "Get your clinic ready": one numbered list. Steps tick themselves off from real data; the owner can skip a
 * step or hide the whole list (stored for the clinic, not the device) and bring it back with "Show setup again".
 */
export function SetupChecklist() {
  const { canAny } = useSession();
  const allowed = canAny('org.manage', 'settings.manage');
  const qc = useQueryClient();
  const router = useRouter();
  const q = useQuery({ queryKey: ['setup-status'], queryFn: () => api.get<SetupStatus>('/setup/status'), enabled: allowed });
  const save = (data: SetupStatus) => qc.setQueryData(['setup-status'], data);
  const skip = useMutation({ mutationFn: (key: string) => api.post<SetupStatus>(`/setup/steps/${key}/skip`), onSuccess: save, onError: (e: Error) => toast.error(e.message) });
  const hide = useMutation({
    mutationFn: () => api.post<SetupStatus>('/setup/hide'),
    onSuccess: (d) => { save(d); toast.success('Setup list hidden. Bring it back any time from Settings → Clinic details.'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const start = useMutation({
    mutationFn: async (s: SetupStatus['steps'][number]) => {
      if (s.startAction === 'store-room') await api.post('/setup/store-room');
      return s.href;
    },
    onSuccess: (href) => router.push(href),
    onError: (e: Error) => toast.error(e.message),
  });

  if (!allowed || !q.data || q.data.hidden) return null;
  const { steps, completed, total, minutes } = q.data;
  const next = steps.find((s) => !s.done && !s.skipped);
  if (!next) return null; // everything is done or skipped
  return (
    <Card className="border-primary/30">
      <CardHeader>
        <div className="flex items-center gap-3">
          <span className="rounded-md bg-primary/10 p-2 text-primary"><Rocket className="h-5 w-5" /></span>
          <div>
            <CardTitle>Get your clinic ready — about {minutes} minutes</CardTitle>
            <p className="text-xs text-muted-foreground">{completed} of {total} done. A step ticks itself when it is finished.</p>
          </div>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Hide the setup list" title="Hide the setup list" loading={hide.isPending} onClick={() => hide.mutate()}><X /></Button>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={completed}>
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(completed / total) * 100}%` }} />
        </div>
        <ol className="grid gap-1">
          {steps.map((s, i) => {
            const current = s.key === next.key;
            return (
              <li key={s.key} className={cn('flex flex-wrap items-start gap-x-3 gap-y-2 rounded-md px-2 py-2', current && 'bg-primary/5 ring-1 ring-primary/30')}>
                <span
                  aria-hidden
                  className={cn(
                    'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                    s.done ? 'bg-success/15 text-success' : current ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                  )}
                >
                  {s.done ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn('block text-sm font-medium', s.done && 'text-muted-foreground line-through')}>
                    <span className="sr-only">Step {i + 1}: </span>
                    {s.title}
                    {s.done && <span className="sr-only"> (done)</span>}
                  </span>
                  {!s.done && <span className="block text-xs text-muted-foreground">{s.skipped ? 'Skipped for now.' : s.description}</span>}
                </span>
                {!s.done && (
                  <span className="flex basis-full items-center gap-2 pl-9 sm:basis-auto sm:pl-0">
                    {current ? (
                      <Button size="sm" loading={start.isPending && start.variables?.key === s.key} onClick={() => start.mutate(s)}>Start</Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => start.mutate(s)}>{s.skipped ? 'Do it now' : 'Open'}</Button>
                    )}
                    {!s.skipped && (
                      <Button size="sm" variant="ghost" loading={skip.isPending && skip.variables === s.key} onClick={() => skip.mutate(s.key)}>Skip for now</Button>
                    )}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}

/**
 * "Show setup again": brings the setup list back for the whole clinic (including skipped steps) and opens
 * the dashboard. Only shown to administrators while the list is hidden or has skipped steps.
 */
export function ShowSetupAgainLink({ className }: { className?: string }) {
  const { canAny } = useSession();
  const allowed = canAny('org.manage', 'settings.manage');
  const qc = useQueryClient();
  const router = useRouter();
  const q = useQuery({ queryKey: ['setup-status'], queryFn: () => api.get<SetupStatus>('/setup/status'), enabled: allowed });
  const show = useMutation({
    mutationFn: () => api.post<SetupStatus>('/setup/show'),
    onSuccess: (d) => { qc.setQueryData(['setup-status'], d); router.push('/dashboard'); },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!allowed || !q.data) return null;
  const hasHidden = q.data.hidden || q.data.steps.some((s) => s.skipped);
  if (!hasHidden || q.data.completed === q.data.total) return null;
  return (
    <button type="button" onClick={() => show.mutate()} disabled={show.isPending} className={cn('text-sm font-medium text-primary hover:underline disabled:opacity-60', className)}>
      Show setup again
    </button>
  );
}
