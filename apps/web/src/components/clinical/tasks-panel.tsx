'use client';
import { useMutation } from '@tanstack/react-query';
import { TASK_TYPES, enumLabel } from '@vcms/shared';
import { CalendarCheck, Check, Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { EmptyState } from '../page';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardHeader, CardTitle } from '../ui/card';
import { Input, NativeSelect } from '../ui/input';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import type { Task } from '@/lib/types';

export function TasksPanel({
  encounterId,
  patientId,
  tasks,
  editable,
  onSaved,
  onBookFollowUp,
}: {
  encounterId: string;
  patientId: string;
  tasks: Task[];
  editable: boolean;
  onSaved: () => void;
  onBookFollowUp?: () => void;
}) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState('FOLLOW_UP_CALL');
  const [due, setDue] = useState(() => new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10));
  const add = useMutation({
    mutationFn: () => api.post('/tasks', { title, type, dueAt: new Date(`${due}T09:00:00`).toISOString(), patientId, encounterId }),
    onSuccess: () => {
      setTitle('');
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const done = useMutation({ mutationFn: (id: string) => api.post(`/tasks/${id}/status`, { status: 'DONE' }), onSuccess: onSaved });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarCheck className="h-4 w-4 text-muted-foreground" /> Follow-up
        </CardTitle>
        {onBookFollowUp && (
          <Button size="sm" variant="ghost" onClick={onBookFollowUp}>
            <Plus /> Book recheck
          </Button>
        )}
      </CardHeader>
      {editable && (
        <form className="grid gap-2 border-b p-3" onSubmit={(e) => { e.preventDefault(); if (title.trim()) add.mutate(); }}>
          <Input placeholder="e.g. Call owner with lab results" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Task" className="h-8" />
          <div className="flex gap-2">
            <NativeSelect aria-label="Task type" className="h-8 text-xs" value={type} onChange={(e) => setType(e.target.value)}>
              {TASK_TYPES.map((t) => <option key={t} value={t}>{enumLabel(t)}</option>)}
            </NativeSelect>
            <Input type="date" aria-label="Due date" className="h-8 w-[150px]" value={due} onChange={(e) => setDue(e.target.value)} />
            <Button type="submit" size="sm" disabled={!title.trim()} loading={add.isPending}>
              Add
            </Button>
          </div>
        </form>
      )}
      {tasks.length ? (
        <ul className="divide-y">
          {tasks.map((t) => (
            <li key={t.id} className="flex items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className={`text-sm ${t.status === 'DONE' ? 'text-muted-foreground line-through' : ''}`}>{t.title}</p>
                <p className="text-2xs text-muted-foreground">
                  {enumLabel(t.type)} · due {fmtDateTime(t.dueAt)}
                </p>
              </div>
              {t.status === 'OPEN' ? (
                <Button size="icon-sm" variant="ghost" aria-label="Mark done" onClick={() => done.mutate(t.id)}>
                  <Check />
                </Button>
              ) : (
                <Badge variant="success">{enumLabel(t.status)}</Badge>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No follow-up tasks" className="py-6" />
      )}
    </Card>
  );
}
