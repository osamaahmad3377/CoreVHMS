'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { enumLabel } from '@vcms/shared';
import { ListChecks, Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, LoadingRows } from '../page';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardHeader, CardTitle } from '../ui/card';
import { Checkbox } from '../ui/checkbox';
import { Input } from '../ui/input';
import { api } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import type { Problem } from '@/lib/types';

/** Patient-level problem list (chronic and ongoing conditions across visits). */
export function ProblemsPanel({ patientId, editable }: { patientId: string; editable: boolean }) {
  const qc = useQueryClient();
  const key = ['problems', patientId];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<Problem[]>(`/patients/${patientId}/problems`) });
  const [term, setTerm] = useState('');
  const [chronic, setChronic] = useState(false);
  const add = useMutation({
    mutationFn: () => api.post(`/patients/${patientId}/problems`, { term, isChronic: chronic, onsetDate: new Date().toISOString().slice(0, 10) }),
    onSuccess: () => {
      setTerm('');
      setChronic(false);
      qc.invalidateQueries({ queryKey: key });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.patch(`/patients/${patientId}/problems/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-muted-foreground" /> Problem list
        </CardTitle>
      </CardHeader>
      {editable && (
        <form className="flex flex-wrap items-center gap-2 border-b p-3" onSubmit={(e) => { e.preventDefault(); if (term.trim()) add.mutate(); }}>
          <Input className="h-8 min-w-[160px] flex-1" placeholder="Add a problem" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Problem" />
          <label className="flex items-center gap-1.5 text-xs">
            <Checkbox checked={chronic} onCheckedChange={(v) => setChronic(v === true)} /> Chronic
          </label>
          <Button type="submit" size="sm" disabled={!term.trim()} loading={add.isPending}>
            <Plus /> Add
          </Button>
        </form>
      )}
      {q.isLoading ? (
        <LoadingRows rows={2} />
      ) : q.data?.length ? (
        <ul className="divide-y">
          {q.data.map((p) => (
            <li key={p.id} className="flex items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className={`text-sm ${p.status === 'RESOLVED' ? 'text-muted-foreground line-through' : 'font-medium'}`}>{p.term}</p>
                <p className="text-2xs text-muted-foreground">
                  {p.onsetDate && `Since ${fmtDate(p.onsetDate)}`}
                  {p.resolvedDate && ` · resolved ${fmtDate(p.resolvedDate)}`}
                </p>
              </div>
              {p.isChronic && <Badge variant="info">Chronic</Badge>}
              {editable && p.status !== 'RESOLVED' ? (
                <Button size="sm" variant="ghost" onClick={() => setStatus.mutate({ id: p.id, status: 'RESOLVED' })}>
                  Resolve
                </Button>
              ) : (
                <Badge variant="outline">{enumLabel(p.status)}</Badge>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No problems recorded" className="py-6" />
      )}
    </Card>
  );
}
