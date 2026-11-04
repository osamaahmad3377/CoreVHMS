'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DENTITION_LABELS, DENTITIONS, dentitionForSpecies, teethFor, type Dentition } from '@vcms/shared';
import { Check, History, PawPrint, Smile, UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { FormError } from '../forms/form-error';
import { PatientPicker, type PickedPatient } from '../patients/patient-picker';
import { QuickAddClientPatient } from '../patients/quick-add-client-patient';
import { useSession } from '@/lib/session';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Label } from '../ui/label';
import { api } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import type { DentalChart } from '@/lib/types';
import { cn } from '@/lib/utils';

/** The patient the chart is for, when the dialog is opened from a patient or a consultation. */
export interface ChartPatient {
  id: string;
  name: string;
  patientNo?: string | null;
  species?: { name: string; category?: string | null } | null;
  ownerName?: string | null;
}

const TOOTH_COUNTS: Record<Dentition, string> = {
  CANINE: `${teethFor('CANINE').length} adult · ${teethFor('CANINE', true).length} baby teeth`,
  FELINE: `${teethFor('FELINE').length} adult · ${teethFor('FELINE', true).length} baby teeth`,
  EQUINE: `${teethFor('EQUINE').length} adult · ${teethFor('EQUINE', true).length} baby teeth`,
};

function Step({ n, title, children, muted }: { n: number; title: string; children: React.ReactNode; muted?: boolean }) {
  return (
    <div className={cn("grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2.5", muted && "pointer-events-none opacity-50")} inert={muted || undefined}>
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-2xs font-bold text-primary">{n}</span>
        {title}
      </h3>
      {children}
    </div>
  );
}

/**
 * Start a dental chart in one step: the patient (searched, or added on the spot when not found), the tooth chart
 * to use (suggested from the species) and whether to start from the last signed chart.
 */
export function NewDentalChartDialog({
  patient: given,
  suggested,
  encounterId,
  open,
  onOpenChange,
}: {
  patient?: ChartPatient | null;
  suggested?: Dentition | null;
  encounterId?: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const { can } = useSession();
  const canAdd = can('clients.write') && can('patients.write');
  const [picked, setPicked] = useState<PickedPatient | null>(null);
  const [adding, setAdding] = useState(false);
  const [dentition, setDentition] = useState<Dentition | ''>('');
  const [baby, setBaby] = useState(false);
  const [carry, setCarry] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const patient: ChartPatient | null = given ?? (picked ? { id: picked.id, name: picked.name, patientNo: picked.patientNo, species: picked.species, ownerName: picked.owner?.displayName ?? null } : null);
  // The patient's charts: the species' suggested chart, and the last signed chart to start from.
  const history = useQuery({
    queryKey: ['patient-dental', patient?.id],
    queryFn: () => api.get<{ suggestedDentition: Dentition | null; charts: DentalChart[] }>(`/patients/${patient!.id}/dental`),
    enabled: open && !!patient,
  });
  const suggestion = suggested ?? history.data?.suggestedDentition ?? (patient?.species ? dentitionForSpecies(patient.species.name, patient.species.category) : null);
  const lastSigned = history.data?.charts.find((c) => c.status === 'SIGNED' && (!dentition || c.dentition === dentition));
  const draft = history.data?.charts.find((c) => c.status === 'DRAFT' && (!encounterId || c.encounterId === encounterId));

  useEffect(() => {
    if (!open) return;
    setPicked(null);
    setAdding(false);
    setDentition('');
    setBaby(false);
    setCarry(true);
    setError(null);
  }, [open]);
  // Pick the species' chart as soon as the patient is known (the vet can still change it).
  useEffect(() => {
    if (open && suggestion && !dentition) setDentition(suggestion);
  }, [open, suggestion, dentition]);

  const create = useMutation({
    mutationFn: () => api.post<DentalChart>('/dental/charts', { patientId: patient!.id, dentition, showDeciduous: baby, carryForward: carry, encounterId: encounterId ?? null }),
    onSuccess: (c) => {
      if (encounterId) qc.invalidateQueries({ queryKey: ['encounter-dental', encounterId] });
      qc.invalidateQueries({ queryKey: ['patient-dental', c.patientId] });
      qc.invalidateQueries({ queryKey: ['dental-charts'] });
      router.push(`/dental/${c.id}`);
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/20">
              <Smile className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <DialogTitle>New dental chart</DialogTitle>
              <DialogDescription>Chart the mouth tooth by tooth, add any procedures, then sign.</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        {error && <FormError message={error} />}

        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5">
          <Step n={1} title="Patient">
            {patient ? (
              <div className="flex items-center gap-3 rounded-xl border bg-muted/30 p-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-card ring-1 ring-foreground/10">
                  <PawPrint className="h-5 w-5 text-muted-foreground" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{patient.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{[patient.patientNo, patient.species?.name, patient.ownerName].filter(Boolean).join(' · ')}</p>
                </div>
                {!given && (
                  <Button size="sm" variant="ghost" onClick={() => { setPicked(null); setDentition(''); }}>
                    Change
                  </Button>
                )}
              </div>
            ) : adding ? (
              <QuickAddClientPatient
                seed=""
                onCancel={() => setAdding(false)}
                onCreated={(p) => {
                  setAdding(false);
                  setPicked(p);
                }}
              />
            ) : (
              <div className="grid gap-2">
                <Label htmlFor="nd-patient" className="sr-only">Patient</Label>
                <PatientPicker id="nd-patient" value={picked} onChange={setPicked} placeholder="Search by pet, owner or phone…" allowCreate />
                {canAdd && (
                  <div className="flex items-center gap-3">
                    <span className="h-px flex-1 bg-foreground/10" />
                    <span className="text-xs text-muted-foreground">or</span>
                    <span className="h-px flex-1 bg-foreground/10" />
                  </div>
                )}
                {canAdd && (
                  <Button type="button" variant="outline" className="w-full" onClick={() => setAdding(true)}>
                    <UserPlus /> Add a new patient
                  </Button>
                )}
              </div>
            )}
            {draft && (
              <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs">
                {draft.chartNo} ({DENTITION_LABELS[draft.dentition].toLowerCase()} chart) for this patient is still a draft{encounterId ? ' for this visit' : ''} —{' '}
                <button type="button" className="font-semibold text-primary underline" onClick={() => router.push(`/dental/${draft.id}`)}>
                  open it
                </button>{' '}
                instead of starting another.
              </p>
            )}
          </Step>

          <Step n={2} title="Tooth chart" muted={!patient}>
            <div role="radiogroup" aria-label="Tooth chart" className="grid grid-cols-3 gap-1.5 sm:gap-2">
              {DENTITIONS.map((d) => {
                const on = dentition === d;
                return (
                  <button
                    key={d}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setDentition(d)}
                    className={cn(
                      'relative grid min-w-0 gap-0.5 rounded-xl border p-2.5 text-left sm:p-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      on ? 'border-primary bg-primary/[0.07] ring-1 ring-primary/40' : 'border-foreground/10 hover:bg-muted/60',
                    )}
                  >
                    {on && <Check className="absolute right-2 top-2 h-4 w-4 text-primary" />}
                    <span className="text-sm font-semibold">{DENTITION_LABELS[d]}</span>
                    <span className="text-2xs leading-tight text-muted-foreground">{TOOTH_COUNTS[d]}</span>
                    {suggestion === d && <Badge variant="secondary" className="mt-1 w-fit">For {patient?.species?.name?.toLowerCase() ?? 'this species'}</Badge>}
                  </button>
                );
              })}
            </div>
            {patient && !suggestion && <p className="text-xs text-muted-foreground">There’s no standard tooth chart for {patient.species?.name ?? 'this species'} — choose the closest one.</p>}
          </Step>

          <Step n={3} title="Options" muted={!patient}>
            <div className="divide-y rounded-xl border">
              <label className="flex cursor-pointer items-start gap-3 p-3">
                <Checkbox className="mt-0.5" checked={baby} onCheckedChange={(v) => setBaby(v === true)} />
                <span className="grid gap-0.5">
                  <span className="text-sm font-medium">Include baby teeth</span>
                  <span className="text-xs text-muted-foreground">For young animals, or adults with retained baby teeth.</span>
                </span>
              </label>
              {lastSigned ? (
                <label className="flex cursor-pointer items-start gap-3 p-3">
                  <Checkbox className="mt-0.5" checked={carry} onCheckedChange={(v) => setCarry(v === true)} />
                  <span className="grid gap-0.5">
                    <span className="flex items-center gap-1.5 text-sm font-medium"><History className="h-3.5 w-3.5 text-muted-foreground" /> Start from the last chart</span>
                    <span className="text-xs text-muted-foreground">
                      Teeth missing or extracted on {lastSigned.chartNo} ({fmtDate(lastSigned.examinedAt)}) are marked already.
                    </span>
                  </span>
                </label>
              ) : (
                patient && history.isSuccess && <p className="p-3 text-xs text-muted-foreground">This is {patient.name}’s first {dentition ? DENTITION_LABELS[dentition].toLowerCase() + ' ' : ''}dental chart.</p>
              )}
            </div>
          </Step>
        </div>

        <DialogFooter className="mt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!patient || !dentition} loading={create.isPending} onClick={() => { setError(null); create.mutate(); }}>
            <Smile /> Start chart
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
