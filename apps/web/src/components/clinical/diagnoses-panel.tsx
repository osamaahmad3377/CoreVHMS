'use client';
import { useMutation } from '@tanstack/react-query';
import { DIAGNOSIS_STATUSES, DIAGNOSIS_TYPES, enumLabel } from '@vcms/shared';
import { ClipboardList, Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { EmptyState } from '../page';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardHeader, CardTitle } from '../ui/card';
import { Checkbox } from '../ui/checkbox';
import { Input, NativeSelect } from '../ui/input';
import { api } from '@/lib/api';
import type { Diagnosis } from '@/lib/types';

export function DiagnosesPanel({ encounterId, diagnoses, editable, onSaved }: { encounterId: string; diagnoses: Diagnosis[]; editable: boolean; onSaved: () => void }) {
  const [term, setTerm] = useState('');
  const [type, setType] = useState('PROVISIONAL');
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState(false);
  const add = useMutation({
    mutationFn: () => api.post(`/encounters/${encounterId}/diagnoses`, { term, type, code: code || null, codeSystem: code ? 'Local' : null, addToProblemList: problem }),
    onSuccess: () => {
      setTerm('');
      setCode('');
      setProblem(false);
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string; type?: string; status?: string }) => api.patch(`/diagnoses/${id}`, body),
    onSuccess: onSaved,
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-muted-foreground" /> Diagnoses
        </CardTitle>
      </CardHeader>
      {editable && (
        <form
          className="grid gap-2 border-b p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (term.trim()) add.mutate();
          }}
        >
          <Input placeholder="Diagnosis or differential (free text)" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Diagnosis" />
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect aria-label="Type" className="h-8 w-36 text-xs" value={type} onChange={(e) => setType(e.target.value)}>
              {DIAGNOSIS_TYPES.map((t) => <option key={t} value={t}>{enumLabel(t)}</option>)}
            </NativeSelect>
            <Input placeholder="Code (optional)" className="h-8 w-32 text-xs" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Code" />
            <label className="flex items-center gap-1.5 text-xs">
              <Checkbox checked={problem} onCheckedChange={(v) => setProblem(v === true)} /> Add to problem list
            </label>
            <Button type="submit" size="sm" className="ml-auto" disabled={!term.trim()} loading={add.isPending}>
              <Plus /> Add
            </Button>
          </div>
        </form>
      )}
      {diagnoses.length ? (
        <ul className="divide-y">
          {diagnoses.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span className={`text-sm font-medium ${d.status === 'RULED_OUT' ? 'text-muted-foreground line-through' : ''}`}>{d.term}</span>
              {d.code && <span className="font-mono text-2xs text-muted-foreground">{d.code}</span>}
              <div className="ml-auto flex items-center gap-1">
                {editable ? (
                  <>
                    <NativeSelect aria-label="Diagnosis type" className="h-7 w-32 text-xs" value={d.type} onChange={(e) => update.mutate({ id: d.id, type: e.target.value })}>
                      {DIAGNOSIS_TYPES.map((t) => <option key={t} value={t}>{enumLabel(t)}</option>)}
                    </NativeSelect>
                    <NativeSelect aria-label="Diagnosis status" className="h-7 w-28 text-xs" value={d.status} onChange={(e) => update.mutate({ id: d.id, status: e.target.value })}>
                      {DIAGNOSIS_STATUSES.map((t) => <option key={t} value={t}>{enumLabel(t)}</option>)}
                    </NativeSelect>
                  </>
                ) : (
                  <>
                    <Badge variant={d.type === 'CONFIRMED' ? 'default' : 'secondary'}>{enumLabel(d.type)}</Badge>
                    {d.status !== 'ACTIVE' && <Badge variant="outline">{enumLabel(d.status)}</Badge>}
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No diagnoses yet" className="py-6" />
      )}
    </Card>
  );
}
