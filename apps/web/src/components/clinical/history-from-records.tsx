'use client';
import { useQuery } from '@tanstack/react-query';
import type { PatientHistorySummary } from '@vcms/shared';
import { Check, Database } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * A button beside "Past history": the animal's earlier care from the clinic's own records — vaccinations, deworming,
 * tick and flea, operations, hospital stays, medicines prescribed and given, grooming, boarding, earlier diagnoses and
 * long-term problems. When the vet has written nothing yet it is put in straight away (to edit like any text); the
 * button adds whatever is new later and never repeats a line.
 */
export function HistoryFromRecords({ patientId, encounterId, history, onAdd }: { patientId: string; encounterId: string; history: string; onAdd: (text: string) => void }) {
  const q = useQuery({ queryKey: ['history-summary', patientId, encounterId], queryFn: () => api.get<PatientHistorySummary>(`/patients/${patientId}/history-summary?exclude=${encounterId}`), staleTime: 60_000 });
  const filled = useRef(false);
  const sections = q.data?.sections ?? [];
  const lines = sections.map((s) => `${s.title}: ${s.items.join('; ')}.`);
  const fresh = lines.filter((l) => !history.includes(l));

  // First time on a draft with no history yet: write it in (saved automatically with the note).
  useEffect(() => {
    if (filled.current || !q.data) return;
    filled.current = true;
    if (!history.trim() && lines.length) onAdd(lines.join('\n'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);

  if (!q.data) return null;
  const title = lines.length ? `Found: ${sections.map((s) => s.title).join(', ')}` : 'Nothing is recorded for this animal yet';
  return (
    <button
      type="button"
      title={title}
      disabled={!lines.length}
      onClick={() => {
        if (fresh.length) onAdd(fresh.join('\n'));
        else toast.message('Past history already has everything from the record');
      }}
      className={cn('inline-flex h-7 items-center gap-1 rounded-lg border border-primary/40 bg-primary/10 px-2 text-xs font-medium text-primary transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50')}
    >
      {fresh.length === 0 && lines.length > 0 ? <Check className="h-3 w-3" /> : <Database className="h-3 w-3" />} From this animal’s record
    </button>
  );
}
