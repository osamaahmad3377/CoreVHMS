'use client';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ENCOUNTER_TYPES, enumLabel } from '@vcms/shared';
import { Armchair } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Field } from '../forms/field';
import { PatientPicker, type PickedPatient } from '../patients/patient-picker';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input, NativeSelect } from '../ui/input';
import { api, qs } from '@/lib/api';
import { useSession } from '@/lib/session';
import { branchTime, shiftDate, todayIn, zonedInstant } from '@/lib/time';
import type { Appointment } from '@/lib/types';

/**
 * Starts a consultation. When the patient is already checked in today, the main action starts that
 * appointment's consultation (so the waiting list, triage and booking stay linked); a separate
 * consultation is still possible.
 */
export function StartConsultationDialog({ open, onOpenChange, initial }: { open: boolean; onOpenChange: (o: boolean) => void; initial?: PickedPatient | null }) {
  const router = useRouter();
  const { can, session } = useSession();
  const tz = session.branch?.timezone ?? 'UTC';
  const [patient, setPatient] = useState<PickedPatient | null>(initial ?? null);
  const [type, setType] = useState('CONSULTATION');
  const [complaint, setComplaint] = useState('');
  const [separate, setSeparate] = useState(false);
  useEffect(() => setSeparate(false), [patient?.id]);

  const today = todayIn(tz);
  const waiting = useQuery({
    queryKey: ['appointments', 'checked-in', patient?.id, today],
    queryFn: () =>
      api.get<Appointment[]>(
        `/appointments${qs({ patientId: patient!.id, status: 'CHECKED_IN', from: zonedInstant(today, 0, tz).toISOString(), to: zonedInstant(shiftDate(today, 1), 0, tz).toISOString() })}`,
      ),
    enabled: open && !!patient && can('appointments.read'),
  });
  const appt = waiting.data?.[0] ?? null;

  const m = useMutation({
    mutationFn: () => api.post<{ id: string }>('/encounters', { patientId: patient!.id, type, chiefComplaint: complaint }),
    onSuccess: (e) => router.push(`/consultations/${e.id}`),
    onError: (e: Error) => toast.error(e.message),
  });
  const startAppt = useMutation({
    mutationFn: (id: string) => api.post<Appointment & { encounterId: string | null }>(`/appointments/${id}/status`, { action: 'start' }),
    onSuccess: (a) => (a.encounterId ? router.push(`/consultations/${a.encounterId}`) : toast.error('The consultation could not be opened')),
    onError: (e: Error) => toast.error(e.message),
  });
  const showForm = !appt || separate;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Start a consultation</DialogTitle>
          <DialogDescription>{appt ? 'This patient is waiting to be seen.' : 'For visits without a booking — phone advice, field visits, walk-ins already examined.'}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="Patient" htmlFor="sc-p" required>
            <PatientPicker id="sc-p" value={patient} onChange={setPatient} />
          </Field>
          {appt && (
            <div className="grid gap-2 rounded-md border border-primary/40 bg-primary/5 p-3 text-sm">
              <p className="flex items-start gap-2">
                <Armchair className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span>
                  <b>{patient?.name}</b> is in the waiting room (since {branchTime(appt.checkedInAt ?? appt.startsAt, tz)}
                  {(appt.triage?.presentingComplaint || appt.reason) && `, ${appt.triage?.presentingComplaint || appt.reason}`}).
                </span>
              </p>
              {!separate && (
                <div className="flex flex-wrap items-center gap-3">
                  <Button loading={startAppt.isPending} onClick={() => startAppt.mutate(appt.id)}>
                    Start this consultation
                  </Button>
                  <button type="button" className="text-xs text-muted-foreground underline hover:text-foreground" onClick={() => setSeparate(true)}>
                    Start a separate consultation
                  </button>
                </div>
              )}
            </div>
          )}
          {showForm && (
            <>
              <Field label="Type" htmlFor="sc-t">
                <NativeSelect id="sc-t" value={type} onChange={(e) => setType(e.target.value)}>
                  {ENCOUNTER_TYPES.map((t) => <option key={t} value={t}>{enumLabel(t)}</option>)}
                </NativeSelect>
              </Field>
              <Field label="Chief complaint" htmlFor="sc-c" hint="Why the animal is here today">
                <Input id="sc-c" value={complaint} onChange={(e) => setComplaint(e.target.value)} />
              </Field>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {showForm && (
            <Button variant={appt ? 'outline' : 'default'} disabled={!patient} loading={m.isPending} onClick={() => m.mutate()}>
              Start
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
