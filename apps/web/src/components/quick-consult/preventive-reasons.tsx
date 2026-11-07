'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bug, CheckCircle2, Plus, Syringe } from 'lucide-react';
import { useState } from 'react';
import { AddVaccinationDialog } from '../preventive/add-vaccination-dialog';
import { CompleteDialog } from '../preventive/care-plan';
import type { PickedPatient } from '../patients/patient-picker';
import { Button } from '../ui/button';
import { api } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import { localDate } from '@/lib/time';
import type { CareItem, Encounter } from '@/lib/types';
import { cn } from '@/lib/utils';

export type PreventiveKind = 'VACCINATION' | 'DEWORMING';

const KINDS: Record<PreventiveKind, { label: string; icon: typeof Syringe; record: string }> = {
  VACCINATION: { label: 'Vaccination', icon: Syringe, record: 'Record vaccination' },
  DEWORMING: { label: 'Deworming', icon: Bug, record: 'Record deworming' },
};

const tile = 'flex items-center gap-3 rounded-xl border p-3.5 text-left transition-all active:scale-[0.98]';

/**
 * Vaccination and deworming, always first among the reasons for the visit. They belong to preventive care, not to
 * a consultation template: tapping one shows the animal's open vaccinations (or dewormings) to record as given in
 * this visit — or, when there is none, asks to add the animal for one first.
 */
export function PreventiveTiles({ selected, onSelect }: { selected: PreventiveKind | null; onSelect: (k: PreventiveKind) => void }) {
  return (
    <>
      {(Object.keys(KINDS) as PreventiveKind[]).map((k) => {
        const { label, icon: Icon } = KINDS[k];
        const on = selected === k;
        return (
          <button key={k} type="button" onClick={() => onSelect(k)} aria-pressed={on} className={cn(tile, on ? 'border-primary bg-primary/10 ring-1 ring-primary' : 'border-border bg-background hover:border-primary/50 hover:bg-primary/5')}>
            <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-lg', on ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary')}>
              <Icon className="h-5 w-5" />
            </span>
            <span className="text-[15px] font-medium leading-tight">{label}</span>
          </button>
        );
      })}
    </>
  );
}

/** What is due for the chosen kind, with “Record vaccination” for each; “Add … for vaccination” when nothing is. */
export function PreventivePanel({ kind, enc, adding, onAddingChange }: { kind: PreventiveKind; enc: Encounter; adding: boolean; onAddingChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { session } = useSession();
  const today = localDate(new Date(), session.branch?.timezone ?? 'UTC');
  const [recording, setRecording] = useState<CareItem | null>(null);
  const plan = useQuery({ queryKey: ['care-plan', enc.patient.id], queryFn: () => api.get<{ items: CareItem[] }>(`/patients/${enc.patient.id}/care-plan`) });
  const { label, record } = KINDS[kind];
  const word = label.toLowerCase();
  const items = (plan.data?.items ?? []).filter((i) => i.kind === kind);
  const open = items.filter((i) => i.status === 'DUE' || i.status === 'DEFERRED');
  const doneToday = items.filter((i) => i.status === 'COMPLETED' && i.completedAt && localDate(new Date(i.completedAt), session.branch?.timezone ?? 'UTC') === today);
  const patient = { ...enc.patient, species: { ...enc.patient.species }, alerts: enc.patient.alerts ?? [] } as unknown as PickedPatient;

  return (
    <section aria-label={label} className="grid gap-3 rounded-xl border border-primary/25 bg-primary/[0.03] p-4">
      {plan.isLoading ? (
        <p className="text-sm text-muted-foreground">Checking {enc.patient.name}’s {word}s…</p>
      ) : (
        <>
          {doneToday.map((i) => (
            <p key={i.id} className="flex items-center gap-2 text-sm font-medium text-success">
              <CheckCircle2 className="h-4 w-4" /> {i.title} recorded today{i.batchNumber ? ` · batch ${i.batchNumber}` : ''}
            </p>
          ))}
          {open.map((i) => (
            <div key={i.id} className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{i.title}</span>
                <span className={cn('block text-xs', i.overdue ? 'text-destructive' : 'text-muted-foreground')}>
                  {i.overdue ? 'Overdue since' : 'Due'} {fmtDate(i.effectiveDueDate)}
                </span>
              </span>
              <Button onClick={() => setRecording(i)}>
                <Syringe /> {record}
              </Button>
            </div>
          ))}
          {!open.length && !doneToday.length && <p className="text-sm text-muted-foreground">{enc.patient.name} has no {word} due.</p>}
          <Button variant={open.length ? 'ghost' : 'default'} className="w-fit" onClick={() => onAddingChange(true)}>
            <Plus /> {open.length || doneToday.length ? `Add another ${word}` : `Add ${enc.patient.name} for ${word}`}
          </Button>
        </>
      )}
      <AddVaccinationDialog
        open={adding}
        onOpenChange={onAddingChange}
        patient={patient}
        kind={kind}
        onAdded={() => qc.invalidateQueries({ queryKey: ['care-plan', enc.patient.id] })}
      />
      <CompleteDialog item={recording} onClose={() => setRecording(null)} encounterId={enc.id} onRecorded={() => qc.invalidateQueries({ queryKey: ['encounter', enc.id] })} />
    </section>
  );
}
