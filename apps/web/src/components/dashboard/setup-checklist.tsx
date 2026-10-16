'use client';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Circle, Rocket, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

interface SetupStatus {
  steps: { key: string; title: string; description: string; href: string; done: boolean }[];
  completed: number;
  total: number;
}

/** Guided setup for administrators; disappears when complete or when hidden on this device. */
export function SetupChecklist() {
  const { canAny, session } = useSession();
  const allowed = canAny('org.manage', 'settings.manage');
  const key = `vcms.setup.hidden.${session.organization?.id}`;
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    try {
      setHidden(localStorage.getItem(key) === '1');
    } catch {
      setHidden(false);
    }
  }, [key]);
  const q = useQuery({ queryKey: ['setup-status'], queryFn: () => api.get<SetupStatus>('/setup/status'), enabled: allowed && !hidden });
  if (!allowed || hidden || !q.data || q.data.completed === q.data.total) return null;
  const { steps, completed, total } = q.data;
  const next = steps.find((s) => !s.done);
  const hide = () => {
    try {
      localStorage.setItem(key, '1');
    } catch {
      /* not persisted */
    }
    setHidden(true);
  };
  return (
    <Card className="border-primary/30">
      <CardHeader>
        <div className="flex items-center gap-3">
          <span className="rounded-md bg-primary/10 p-2 text-primary"><Rocket className="h-5 w-5" /></span>
          <div>
            <CardTitle>Set up your clinic</CardTitle>
            <p className="text-xs text-muted-foreground">{completed} of {total} done — each step ticks itself off when it is complete.</p>
          </div>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Hide setup checklist" onClick={hide}><X /></Button>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={completed}>
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(completed / total) * 100}%` }} />
        </div>
        <ul className="grid gap-1 md:grid-cols-2">
          {steps.map((s) => (
            <li key={s.key}>
              <Link href={s.href} className={cn('flex items-start gap-2 rounded-md px-2 py-2 hover:bg-muted', s.key === next?.key && 'bg-primary/5 ring-1 ring-primary/30')}>
                {s.done ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                <span className="min-w-0">
                  <span className={cn('block text-sm font-medium', s.done && 'text-muted-foreground line-through')}>{s.title}</span>
                  {!s.done && <span className="block text-xs text-muted-foreground">{s.description}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
