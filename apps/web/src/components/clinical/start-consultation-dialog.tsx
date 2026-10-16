'use client';
import { useMutation } from '@tanstack/react-query';
import { ENCOUNTER_TYPES, enumLabel } from '@vcms/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Field } from '../forms/field';
import { PatientPicker, type PickedPatient } from '../patients/patient-picker';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input, NativeSelect } from '../ui/input';
import { api } from '@/lib/api';

export function StartConsultationDialog({ open, onOpenChange, initial }: { open: boolean; onOpenChange: (o: boolean) => void; initial?: PickedPatient | null }) {
  const router = useRouter();
  const [patient, setPatient] = useState<PickedPatient | null>(initial ?? null);
  const [type, setType] = useState('CONSULTATION');
  const [complaint, setComplaint] = useState('');
  const m = useMutation({
    mutationFn: () => api.post<{ id: string }>('/encounters', { patientId: patient!.id, type, chiefComplaint: complaint }),
    onSuccess: (e) => router.push(`/consultations/${e.id}`),
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Start a consultation</DialogTitle>
          <DialogDescription>For visits without a booking — phone advice, field visits, walk-ins already examined.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="Patient" htmlFor="sc-p" required>
            <PatientPicker id="sc-p" value={patient} onChange={setPatient} />
          </Field>
          <Field label="Type" htmlFor="sc-t">
            <NativeSelect id="sc-t" value={type} onChange={(e) => setType(e.target.value)}>
              {ENCOUNTER_TYPES.map((t) => <option key={t} value={t}>{enumLabel(t)}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Chief complaint" htmlFor="sc-c">
            <Input id="sc-c" value={complaint} onChange={(e) => setComplaint(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!patient} loading={m.isPending} onClick={() => m.mutate()}>Start</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

