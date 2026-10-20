'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ADMISSION_OUTCOMES, enumLabel } from '@vcms/shared';
import { AlertTriangle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { LetterFooter, Letterhead } from '../documents/letterhead';
import type { ClinicHeader } from '../billing/invoice-document';
import { Field } from '../forms/field';
import { FormError } from '../forms/form-error';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input, NativeSelect, Textarea } from '../ui/input';
import { api, qs } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtWeight } from '@/lib/format';
import { useSession } from '@/lib/session';
import { branchTime } from '@/lib/time';
import type { Admission, TreatmentOrder } from '@/lib/types';

export function DischargeDialog({ admission, open, onOpenChange }: { admission: Admission; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ outcome: 'DISCHARGED_HOME', dischargeSummary: '', homeCareInstructions: '', followUpAt: '' });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setF({ outcome: 'DISCHARGED_HOME', dischargeSummary: '', homeCareInstructions: '', followUpAt: '' }); setError(null); } }, [open]);
  const died = f.outcome === 'DECEASED' || f.outcome === 'EUTHANASED';
  const { session } = useSession();
  const tz = session.branch?.timezone ?? 'UTC';
  // Treatments that were due but never recorded are closed on discharge: list them so nothing is lost silently.
  const sheet = useQuery({
    queryKey: ['sheet', admission.id, 'missed'],
    queryFn: () => api.get<{ orders: TreatmentOrder[] }>(`/admissions/${admission.id}/sheet${qs({ from: admission.admittedAt, to: new Date().toISOString() })}`),
    enabled: open,
  });
  const missed = (sheet.data?.orders ?? []).flatMap((o) => o.tasks.filter((t) => t.status === 'DUE' && new Date(t.dueAt) < new Date()).map((t) => ({ o, t })));
  const m = useMutation({
    mutationFn: () => api.post(`/admissions/${admission.id}/discharge`, { ...f, homeCareInstructions: f.homeCareInstructions || null, followUpAt: f.followUpAt ? new Date(f.followUpAt).toISOString() : null }),
    onSuccess: () => { toast.success('Patient discharged'); qc.invalidateQueries(); onOpenChange(false); },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Discharge {admission.patient.name}</DialogTitle>
          <DialogDescription>Open treatments are stopped, the cage is freed and remaining hospital days are charged. The discharge summary can be printed for the owner.</DialogDescription>
        </DialogHeader>
        {error && <FormError message={error} />}
        {!!missed.length && (
          <div role="alert" className="flex gap-2 rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <div className="grid gap-1">
              <p className="font-medium">{missed.length === 1 ? '1 treatment is overdue and was never recorded' : `${missed.length} treatments are overdue and were never recorded`}:</p>
              <ul className="list-disc pl-4 text-xs">
                {missed.slice(0, 8).map(({ o, t }) => <li key={t.id}>{o.description} — due {branchTime(t.dueAt, tz, 'd MMM HH:mm')}</li>)}
                {missed.length > 8 && <li>and {missed.length - 8} more</li>}
              </ul>
              <p className="text-xs text-muted-foreground">Record them on the treatment sheet first (given or not done). Otherwise they are closed unrecorded when you discharge.</p>
            </div>
          </div>
        )}
        <div className="grid gap-3">
          <Field label="Outcome" htmlFor="dc-out" required>
            <NativeSelect id="dc-out" value={f.outcome} onChange={(e) => setF({ ...f, outcome: e.target.value })}>{ADMISSION_OUTCOMES.map((o) => <option key={o} value={o}>{enumLabel(o, 'outcome')}</option>)}</NativeSelect>
          </Field>
          {died && <p className="rounded-md bg-muted px-3 py-2 text-sm">The patient record will be marked as deceased.</p>}
          <Field label="Discharge summary" htmlFor="dc-sum" required hint="Diagnosis, treatment given and response."><Textarea id="dc-sum" rows={5} value={f.dischargeSummary} maxLength={5000} onChange={(e) => setF({ ...f, dischargeSummary: e.target.value })} /></Field>
          {!died && (
            <>
              <Field label="Home-care instructions for the client" htmlFor="dc-home" hint="Medication, feeding, activity, wound care and warning signs."><Textarea id="dc-home" rows={5} value={f.homeCareInstructions} maxLength={5000} onChange={(e) => setF({ ...f, homeCareInstructions: e.target.value })} /></Field>
              <Field label="Follow-up check" htmlFor="dc-fu" hint="Creates a recheck task for the responsible vet."><Input id="dc-fu" type="date" value={f.followUpAt} onChange={(e) => setF({ ...f, followUpAt: e.target.value })} /></Field>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={m.isPending} disabled={!f.dischargeSummary.trim()} onClick={() => { setError(null); m.mutate(); }}>{missed.length ? 'Discharge anyway' : 'Discharge'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Printable discharge summary for the owner. */
export function DischargeSummary({ admission: a, clinic }: { admission: Admission; clinic: ClinicHeader | null }) {
  return (
    <article className="mx-auto max-w-3xl bg-white p-8 text-[11pt] leading-relaxed text-black">
      <Letterhead clinic={clinic} title={<p className="text-base font-bold">Hospital discharge summary — {a.admissionNo}</p>} />
      <dl className="mb-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
        <div><dt className="inline font-semibold">Patient: </dt><dd className="inline">{a.patient.name} ({a.patient.species.name}{a.patient.breed ? `, ${a.patient.breed.name}` : ''})</dd></div>
        <div><dt className="inline font-semibold">Owner: </dt><dd className="inline">{a.client.displayName}</dd></div>
        <div><dt className="inline font-semibold">Admitted: </dt><dd className="inline">{fmtDateTime(a.admittedAt)}</dd></div>
        <div><dt className="inline font-semibold">Discharged: </dt><dd className="inline">{fmtDateTime(a.dischargedAt)}</dd></div>
        <div><dt className="inline font-semibold">Weight: </dt><dd className="inline">{fmtWeight(a.patient.latestWeightKg)}</dd></div>
        <div><dt className="inline font-semibold">Vet: </dt><dd className="inline">{a.responsibleClinician?.name ?? '—'}</dd></div>
      </dl>
      <h2 className="font-bold">Reason for admission</h2>
      <p className="mb-3">{a.reason}{a.diagnosis ? ` — ${a.diagnosis}` : ''}</p>
      <h2 className="font-bold">Summary</h2>
      <p className="mb-3 whitespace-pre-wrap">{a.dischargeSummary}</p>
      {a.homeCareInstructions && (
        <>
          <h2 className="font-bold">Care at home</h2>
          <p className="mb-3 whitespace-pre-wrap">{a.homeCareInstructions}</p>
        </>
      )}
      {a.followUpAt && <p className="font-semibold">Please book a check-up for {fmtDate(a.followUpAt)}.</p>}
      <p className="mt-6 text-sm">If you are worried about {a.patient.name} at any time, contact us{clinic?.phone ? ` on ${clinic.phone}` : ''}.</p>
      <LetterFooter />
    </article>
  );
}
