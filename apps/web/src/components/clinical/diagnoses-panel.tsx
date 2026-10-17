'use client';
import { useMutation } from '@tanstack/react-query';
import { DIAGNOSIS_STATUSES, DIAGNOSIS_TYPES, enumLabel } from '@vcms/shared';
import { ClipboardList, Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardHeader, CardTitle } from '../ui/card';
import { Checkbox } from '../ui/checkbox';
import { Input, NativeSelect } from '../ui/input';
import { api } from '@/lib/api';
import type { Diagnosis } from '@/lib/types';
import { cn } from '@/lib/utils';

/** "How sure?" in plain words, mapped to the stored diagnosis types. */
const SURE = [
  { type: 'PROVISIONAL', label: 'Suspected' },
  { type: 'CONFIRMED', label: 'Confirmed' },
] as const;

/** Local wording for the diagnosis type list behind "More". */
const TYPE_LABEL: Record<string, string> = { DIFFERENTIAL: 'Possible (differential)', PROVISIONAL: 'Suspected', CONFIRMED: 'Confirmed' };

function HowSure({ value, onChange, name, disabled }: { value: string; onChange: (type: string) => void; name: string; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label={`How sure? ${name}`} className="inline-flex overflow-hidden rounded-md border text-xs">
      {SURE.map((o) => (
        <button
          key={o.type}
          type="button"
          role="radio"
          aria-checked={value === o.type}
          disabled={disabled}
          onClick={() => onChange(o.type)}
          className={cn('px-2.5 py-1 transition-colors', value === o.type ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-muted')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

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
      setType('PROVISIONAL');
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
    <Card id="diagnoses-card">
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
          <Input id="diagnosis-term" placeholder="What is the problem? e.g. Ear infection" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Diagnosis" />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">How sure?</span>
            <HowSure value={type} onChange={setType} name="new diagnosis" />
            <Button type="submit" size="sm" className="ml-auto" disabled={!term.trim()} loading={add.isPending}>
              <Plus /> Add diagnosis
            </Button>
          </div>
          <label className="flex items-center gap-1.5 text-xs">
            <Checkbox checked={problem} onCheckedChange={(v) => setProblem(v === true)} /> Long-term problem (shows on the patient summary)
          </label>
          <details className="text-xs">
            <summary className="w-fit cursor-pointer text-muted-foreground hover:text-foreground">More</summary>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <NativeSelect aria-label="Type" className="h-8 w-44 text-xs" value={type} onChange={(e) => setType(e.target.value)}>
                {DIAGNOSIS_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t] ?? enumLabel(t)}</option>)}
              </NativeSelect>
              <Input placeholder="Code (optional)" className="h-8 w-32 text-xs" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Code" />
            </div>
          </details>
        </form>
      )}
      {diagnoses.length ? (
        <ul className="divide-y">
          {diagnoses.map((d) => (
            <li key={d.id} className="grid gap-1 px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 break-words">
                  <span className={`text-sm font-medium ${d.status === 'RULED_OUT' ? 'text-muted-foreground line-through' : ''}`}>{d.term}</span>
                  {d.code && <span className="ml-2 font-mono text-2xs text-muted-foreground">{d.code}</span>}
                </span>
                {editable ? (
                  <HowSure value={d.type} onChange={(t) => update.mutate({ id: d.id, type: t })} name={d.term} disabled={update.isPending} />
                ) : (
                  <Badge variant={d.type === 'CONFIRMED' ? 'default' : 'secondary'}>{TYPE_LABEL[d.type] ?? enumLabel(d.type)}</Badge>
                )}
                {d.status !== 'ACTIVE' && <Badge variant="outline">{enumLabel(d.status)}</Badge>}
              </div>
              {editable && (
                <details className="text-xs">
                  <summary className="w-fit cursor-pointer text-muted-foreground hover:text-foreground">More</summary>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <NativeSelect aria-label="Diagnosis type" className="h-7 w-44 text-xs" value={d.type} onChange={(e) => update.mutate({ id: d.id, type: e.target.value })}>
                      {DIAGNOSIS_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t] ?? enumLabel(t)}</option>)}
                    </NativeSelect>
                    <NativeSelect aria-label="Diagnosis status" className="h-7 w-32 text-xs" value={d.status} onChange={(e) => update.mutate({ id: d.id, status: e.target.value })}>
                      {DIAGNOSIS_STATUSES.map((t) => <option key={t} value={t}>{enumLabel(t)}</option>)}
                    </NativeSelect>
                  </div>
                </details>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-3 py-2 text-xs text-muted-foreground">No diagnoses yet.</p>
      )}
    </Card>
  );
}
