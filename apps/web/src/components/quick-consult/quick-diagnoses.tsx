'use client';
import { useMutation, useQuery } from '@tanstack/react-query';
import { History, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Input } from '../ui/input';
import { api } from '@/lib/api';
import type { Diagnosis } from '@/lib/types';
import { cn } from '@/lib/utils';

type Row = Record<string, any>;
interface PastData {
  sections: { name: string; data: any }[];
}

/** Plain words for how sure the vet is (stored as the usual provisional / confirmed / differential). */
const TYPE_LABEL: Record<string, string> = { PROVISIONAL: 'Likely', CONFIRMED: 'Sure', DIFFERENTIAL: 'Possible' };
/** A tap on the label moves it on: possible → likely → sure → possible. */
const NEXT_TYPE: Record<string, string> = { DIFFERENTIAL: 'PROVISIONAL', PROVISIONAL: 'CONFIRMED', CONFIRMED: 'DIFFERENTIAL' };

/**
 * Diagnoses in one line: type the name and press Enter. It is saved as provisional; one tap on its label makes it
 * confirmed. Diagnoses from this animal's earlier visits are offered as one-tap chips (useful at rechecks).
 * Removing one marks it "ruled out", as the classic screen does — nothing in the record is deleted.
 */
export function QuickDiagnoses({
  encounterId,
  patientId,
  diagnoses,
  editable,
  onSaved,
  suggestions = [],
}: {
  encounterId: string;
  patientId: string;
  diagnoses: Diagnosis[];
  editable: boolean;
  onSaved: () => void;
  /** Diagnoses usual for the reason of visit, offered as large one-tap buttons. */
  suggestions?: string[];
}) {
  const [term, setTerm] = useState('');
  // Same request and cache as the "Past records" panel, so it is fetched once.
  const record = useQuery({ queryKey: ['patient-record', patientId], queryFn: () => api.get<PastData>(`/patients/${patientId}/record`), staleTime: 30_000, enabled: editable });

  const add = useMutation({
    mutationFn: (d: { term: string; code?: string | null; codeSystem?: string | null }) =>
      api.post(`/encounters/${encounterId}/diagnoses`, { term: d.term, type: 'PROVISIONAL', code: d.code ?? null, codeSystem: d.code ? (d.codeSystem ?? 'Local') : null, addToProblemList: false }),
    onSuccess: () => {
      setTerm('');
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string; type?: string; status?: string }) => api.patch(`/diagnoses/${id}`, body),
    onSuccess: onSaved,
    onError: (e: Error) => toast.error(e.message),
  });

  const shown = diagnoses.filter((d) => d.status !== 'RULED_OUT');
  const here = new Set(shown.map((d) => d.term.toLowerCase()));
  const visits = ((record.data?.sections.find((s) => s.name === 'consultations')?.data as Row[] | undefined) ?? []).filter((c) => c.id !== encounterId);
  const earlier: Row[] = [];
  for (const c of visits.sort((a, b) => b.startedAt.localeCompare(a.startedAt))) for (const d of c.diagnoses ?? []) if (!here.has(String(d.term).toLowerCase()) && !earlier.some((e) => e.term.toLowerCase() === String(d.term).toLowerCase())) earlier.push(d);

  const submit = () => {
    const t = term.trim();
    if (!t) return;
    if (here.has(t.toLowerCase())) {
      toast.message('That diagnosis is already on this visit');
      return;
    }
    add.mutate({ term: t });
  };

  const offered = suggestions.filter((s) => !here.has(s.toLowerCase()));
  return (
    <div className="grid gap-3">
      {editable && offered.length > 0 && (
        <div className="grid gap-1.5">
          <span className="text-sm text-muted-foreground">Usual for this problem — tap to add:</span>
          <div className="flex flex-wrap gap-2">
            {offered.map((s) => (
              <button key={s} type="button" disabled={add.isPending} onClick={() => add.mutate({ term: s })} className="h-12 rounded-xl border-2 border-border bg-card px-4 text-base font-medium transition-colors hover:border-primary hover:bg-primary/5 disabled:opacity-50">
                + {s}
              </button>
            ))}
          </div>
        </div>
      )}
      {shown.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="This visit’s diagnoses">
          {shown.map((d) => (
            <li key={d.id} className="inline-flex h-11 items-center gap-1.5 rounded-pill border-2 border-primary/50 bg-primary/5 pl-4 pr-1.5 text-base">
              <span className="font-semibold">{d.term}</span>
              <button
                type="button"
                disabled={!editable}
                title="How sure are you? Tap to change: possible → likely → sure"
                onClick={() => update.mutate({ id: d.id, type: NEXT_TYPE[d.type] ?? 'PROVISIONAL' })}
                className={cn('rounded-pill px-2 py-0.5 text-xs font-medium', d.type === 'CONFIRMED' ? 'bg-success text-white' : d.type === 'DIFFERENTIAL' ? 'bg-muted text-muted-foreground' : 'bg-info/15 text-info')}
              >
                {TYPE_LABEL[d.type] ?? d.type}
              </button>
              {editable && (
                <button type="button" aria-label={`Rule out ${d.term}`} title="Rule out (stays in the record as ruled out)" onClick={() => update.mutate({ id: d.id, status: 'RULED_OUT' })} className="grid h-6 w-6 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <div className="relative">
          <Input
            id="qc-diagnosis"
            className="h-10 pr-24"
            placeholder="Something else? Type it and press Enter"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), submit())}
            disabled={add.isPending}
          />
          <button type="button" onClick={submit} disabled={!term.trim() || add.isPending} className="absolute right-1.5 top-1/2 inline-flex h-7 -translate-y-1/2 items-center gap-1 rounded-md px-2 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-40">
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
        </div>
      )}
      {editable && earlier.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="flex items-center gap-1 text-muted-foreground">
            <History className="h-3.5 w-3.5" /> Earlier visits:
          </span>
          {earlier.slice(0, 6).map((d) => (
            <button key={d.id ?? d.term} type="button" onClick={() => add.mutate({ term: d.term, code: d.code, codeSystem: d.codeSystem })} className="h-7 rounded-pill border border-dashed border-primary/40 px-2.5 font-medium text-primary hover:bg-primary/5">
              + {d.term}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
