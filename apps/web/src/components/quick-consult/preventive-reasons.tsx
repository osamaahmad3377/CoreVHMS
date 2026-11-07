'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bug, Check, CheckCircle2, Loader2, Plus, Scissors, Syringe } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { AddVaccinationDialog } from '../preventive/add-vaccination-dialog';
import { CompleteDialog } from '../preventive/care-plan';
import type { PickedPatient } from '../patients/patient-picker';
import { Button } from '../ui/button';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import { localDate } from '@/lib/time';
import type { CareItem, Encounter } from '@/lib/types';
import { cn } from '@/lib/utils';

/** The fixed tiles at the start of step 1: preventive care, and grooming. None needs a consultation fee on its own. */
export type PreventiveKind = 'VACCINATION' | 'DEWORMING' | 'GROOMING';

export const KINDS: Record<PreventiveKind, { label: string; icon: typeof Syringe; record: string }> = {
  VACCINATION: { label: 'Vaccination', icon: Syringe, record: 'Record vaccination' },
  DEWORMING: { label: 'Deworming', icon: Bug, record: 'Record deworming' },
  GROOMING: { label: 'Grooming', icon: Scissors, record: '' },
};

/**
 * Vaccination, deworming and grooming are categories in step 1 (tap to add, tap again to remove). They are not
 * consultation questions: vaccination or deworming shows the animal's open vaccinations (or dewormings) to record as
 * given in this visit — or, when there is none, asks to add one first; grooming shows the clinic's grooming services
 * from Services & prices to tick off.
 */

/** What is due for the chosen kind, with “Record vaccination” for each; “Add … for vaccination” when nothing is. */
export function PreventivePanel(props: { kind: PreventiveKind; enc: Encounter; adding: boolean; onAddingChange: (o: boolean) => void }) {
  return props.kind === 'GROOMING' ? <GroomingPanel enc={props.enc} /> : <CarePanel {...props} kind={props.kind} />;
}

function CarePanel({ kind, enc, adding, onAddingChange }: { kind: Exclude<PreventiveKind, 'GROOMING'>; enc: Encounter; adding: boolean; onAddingChange: (o: boolean) => void }) {
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

export interface VisitServices {
  options: { id: string; name: string; priceMinor: number }[];
  added: { id: string; serviceId: string | null; description: string; unitPriceMinor: number; status: string }[];
}
export const groomingKey = (encounterId: string) => ['visit-services', encounterId, 'GROOMING'] as const;
export const fetchGrooming = (encounterId: string) => api.get<VisitServices>(`/encounters/${encounterId}/services?category=GROOMING`);

/**
 * The clinic's grooming services (the “Grooming” group in Settings → Services & prices), with their prices. Tap one
 * to add it to this visit's bill, tap again to take it off.
 */
function GroomingPanel({ enc }: { enc: Encounter }) {
  const qc = useQueryClient();
  const { can, currency } = useSession();
  const q = useQuery({ queryKey: groomingKey(enc.id), queryFn: () => fetchGrooming(enc.id) });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: groomingKey(enc.id) });
    void qc.invalidateQueries({ queryKey: ['charges', { encounterId: enc.id }] });
  };
  const toggle = useMutation({
    mutationFn: async (serviceId: string) => {
      const line = q.data?.added.find((a) => a.serviceId === serviceId);
      return line ? api.del(`/encounters/${enc.id}/services/${line.id}`) : api.post(`/encounters/${enc.id}/services`, { serviceId });
    },
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });
  const options = q.data?.options ?? [];
  const added = q.data?.added ?? [];
  const total = added.reduce((n, a) => n + a.unitPriceMinor, 0);
  const closed = enc.status !== 'OPEN';

  return (
    <section aria-label="Grooming" className="grid gap-3 rounded-xl border border-primary/25 bg-primary/[0.03] p-4">
      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading grooming services…</p>
      ) : !options.length ? (
        <p className="text-sm text-muted-foreground">
          No grooming services yet.{' '}
          {can('settings.manage') ? (
            <Link href="/settings/services" className="font-medium text-primary underline">
              Add them in Services &amp; prices (group: Grooming)
            </Link>
          ) : (
            'Ask a manager to add them in Settings → Services & prices.'
          )}
        </p>
      ) : (
        <>
          <p className="text-sm font-medium">What grooming is done for {enc.patient.name}?</p>
          <div className="flex flex-wrap gap-2">
            {options.map((o) => {
              const on = added.some((a) => a.serviceId === o.id);
              const busy = toggle.isPending && toggle.variables === o.id;
              const noPrice = o.priceMinor <= 0;
              return (
                <button
                  key={o.id}
                  type="button"
                  aria-pressed={on}
                  disabled={closed || toggle.isPending || (noPrice && !on)}
                  title={noPrice ? 'Give this service a price in Services & prices first' : undefined}
                  onClick={() => toggle.mutate(o.id)}
                  className={cn(
                    'inline-flex min-h-11 items-center gap-2 rounded-lg border px-4 py-2 text-[15px] font-medium transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60',
                    on ? 'border-primary bg-primary text-primary-foreground shadow-sm' : 'border-border bg-background hover:border-primary/50 hover:bg-primary/5',
                  )}
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : on && <Check className="h-4 w-4" />}
                  {o.name}
                  <span className={cn('tabular text-sm', on ? 'text-primary-foreground/80' : 'text-muted-foreground')}>{noPrice ? 'No price' : fmtMoney(o.priceMinor, currency)}</span>
                </button>
              );
            })}
          </div>
          {added.length > 0 && (
            <p className="text-sm font-medium text-success">
              <CheckCircle2 className="mr-1.5 inline h-4 w-4 align-[-3px]" />
              Added to the bill: {added.map((a) => a.description).join(', ')} · {fmtMoney(total, currency)}
            </p>
          )}
          {can('settings.manage') && (
            <Link href="/settings/services" className="w-fit text-xs font-medium text-primary hover:underline">
              Change grooming services and prices
            </Link>
          )}
        </>
      )}
    </section>
  );
}
