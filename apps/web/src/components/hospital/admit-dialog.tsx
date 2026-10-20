'use client';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CPR_STATUSES, PATIENT_CONDITIONS, enumLabel } from '@vcms/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Field } from '../forms/field';
import { FormError } from '../forms/form-error';
import { PatientPicker, type PickedPatient } from '../patients/patient-picker';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input, NativeSelect, Textarea } from '../ui/input';
import { useClinicians } from '@/hooks/use-catalog';
import { api, qs } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { Admission, WardRow } from '@/lib/types';

/** Admit a patient to hospital: choose ward and an empty cage, reason, condition and resuscitation status. */
export function AdmitDialog({ open, onOpenChange, patient, encounterId, cageId, onAdmitted }: { open: boolean; onOpenChange: (o: boolean) => void; patient?: PickedPatient | null; encounterId?: string | null; cageId?: string | null; /** Called instead of opening the stay's page, so a consultation stays on screen. */ onAdmitted?: (a: Admission) => void }) {
  const router = useRouter();
  const { session } = useSession();
  const [p, setP] = useState<PickedPatient | null>(null);
  const [f, setF] = useState({ wardId: '', cageId: '', reason: '', diagnosis: '', condition: 'STABLE', cprStatus: 'UNDECIDED', isolation: false, feedingInstructions: '', responsibleClinicianId: '', expectedDischargeAt: '' });
  const [error, setError] = useState<string | null>(null);
  const wards = useQuery({ queryKey: ['wards', session.branch?.id], queryFn: () => api.get<WardRow[]>(`/wards${qs({ branchId: session.branch?.id })}`), enabled: open });
  const clinicians = useClinicians(session.branch?.id);
  useEffect(() => {
    if (!open) return;
    setP(patient ?? null);
    setError(null);
    const ward = cageId ? wards.data?.find((w) => w.cages.some((c) => c.id === cageId)) : undefined;
    setF((s) => ({ ...s, reason: '', diagnosis: '', condition: 'STABLE', cprStatus: 'UNDECIDED', isolation: false, feedingInstructions: '', expectedDischargeAt: '', wardId: ward?.id ?? '', cageId: cageId ?? '' }));
  }, [open, patient, cageId, wards.data]);
  const ward = wards.data?.find((w) => w.id === f.wardId);
  const m = useMutation({
    mutationFn: () =>
      api.post<Admission>('/admissions', {
        patientId: p?.id,
        encounterId: encounterId ?? null,
        ...f,
        wardId: f.wardId || null,
        cageId: f.cageId || null,
        responsibleClinicianId: f.responsibleClinicianId || null,
        expectedDischargeAt: f.expectedDischargeAt ? new Date(f.expectedDischargeAt).toISOString() : null,
      }),
    onSuccess: (a) => {
      toast.success(`${a.patient.name} admitted (${a.admissionNo})`);
      onOpenChange(false);
      if (onAdmitted) onAdmitted(a);
      else router.push(`/hospital/admissions/${a.id}`);
    },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Admit to hospital</DialogTitle>
          <DialogDescription>Daily hospital fees are added to the client’s unbilled charges automatically, based on the ward.</DialogDescription>
        </DialogHeader>
        {error && <FormError message={error} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Patient" htmlFor="adm-patient" required className="sm:col-span-2">
            {patient ? <p className="text-sm font-medium">{patient.name} · {patient.species?.name}</p> : <PatientPicker id="adm-patient" value={p} onChange={setP} />}
          </Field>
          <Field label="Ward" htmlFor="adm-ward">
            <NativeSelect id="adm-ward" value={f.wardId} onChange={(e) => setF({ ...f, wardId: e.target.value, cageId: '' })}>
              <option value="">{wards.data?.length ? 'Choose ward…' : 'No wards set up'}</option>
              {(wards.data ?? []).map((w) => <option key={w.id} value={w.id}>{w.name} ({w.cages.filter((c) => !c.occupant).length} free)</option>)}
            </NativeSelect>
          </Field>
          <Field label="Cage / kennel" htmlFor="adm-cage">
            <NativeSelect id="adm-cage" value={f.cageId} disabled={!ward} onChange={(e) => setF({ ...f, cageId: e.target.value })}>
              <option value="">Not assigned yet</option>
              {ward?.cages.filter((c) => !c.occupant).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Reason for admission" htmlFor="adm-reason" required className="sm:col-span-2">
            <Input id="adm-reason" value={f.reason} maxLength={500} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. Fluid therapy for dehydration" />
          </Field>
          <Field label="Working diagnosis" htmlFor="adm-dx" className="sm:col-span-2"><Input id="adm-dx" value={f.diagnosis} maxLength={500} onChange={(e) => setF({ ...f, diagnosis: e.target.value })} /></Field>
          <Field label="Condition" htmlFor="adm-cond">
            <NativeSelect id="adm-cond" value={f.condition} onChange={(e) => setF({ ...f, condition: e.target.value })}>{PATIENT_CONDITIONS.map((c) => <option key={c} value={c}>{enumLabel(c)}</option>)}</NativeSelect>
          </Field>
          <Field label="If the heart stops (resuscitation)" htmlFor="adm-cpr" hint="Agree this with the client and record it." help="Whether staff should try to restart the heart and breathing if they stop (CPR). Talk to the client, agree the choice, and record it here so everyone on every shift knows.">
            <NativeSelect id="adm-cpr" value={f.cprStatus} onChange={(e) => setF({ ...f, cprStatus: e.target.value })}>{CPR_STATUSES.map((c) => <option key={c} value={c}>{enumLabel(c)}</option>)}</NativeSelect>
          </Field>
          <Field label="Responsible vet" htmlFor="adm-vet">
            <NativeSelect id="adm-vet" value={f.responsibleClinicianId} onChange={(e) => setF({ ...f, responsibleClinicianId: e.target.value })}>
              <option value="">Me ({session.user.name})</option>
              {(clinicians.data ?? []).filter((c) => c.userId !== session.user.id).map((c) => <option key={c.membershipId} value={c.membershipId}>{c.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Expected discharge" htmlFor="adm-exp"><Input id="adm-exp" type="datetime-local" value={f.expectedDischargeAt} onChange={(e) => setF({ ...f, expectedDischargeAt: e.target.value })} /></Field>
          <Field label="Feeding instructions" htmlFor="adm-feed" className="sm:col-span-2"><Textarea id="adm-feed" value={f.feedingInstructions} maxLength={1000} onChange={(e) => setF({ ...f, feedingInstructions: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><Checkbox checked={f.isolation} onCheckedChange={(v) => setF({ ...f, isolation: !!v })} /> Isolation required (infectious risk)</label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={m.isPending} disabled={!p || !f.reason.trim()} onClick={() => { setError(null); m.mutate(); }}>Admit</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
