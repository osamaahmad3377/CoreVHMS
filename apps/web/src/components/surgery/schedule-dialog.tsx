'use client';
import { useMutation, useQuery } from '@tanstack/react-query';
import { SURGERY_PRIORITIES, enumLabel } from '@vcms/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { MoneyInput, parseMoney } from '../billing/money';
import { Field } from '../forms/field';
import { FormError } from '../forms/form-error';
import { PatientPicker, type PickedPatient } from '../patients/patient-picker';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input, NativeSelect } from '../ui/input';
import { useAppointmentTypes, useClinicians, useResources } from '@/hooks/use-catalog';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { todayIn, zonedInstant, parseHhmm } from '@/lib/time';
import type { Service, Surgery } from '@/lib/types';

const PROCEDURE_FEE_CATEGORIES = ['SURGERY', 'PROCEDURE', 'DENTAL'];

/** Schedules a surgery: books the surgeon and theatre in the calendar (with double-booking protection). */
export function ScheduleSurgeryDialog({ open, onOpenChange, patient, admissionId }: { open: boolean; onOpenChange: (o: boolean) => void; patient?: PickedPatient | null; admissionId?: string | null }) {
  const router = useRouter();
  const { session, currency } = useSession();
  const tz = session.branch?.timezone ?? 'UTC';
  const types = useAppointmentTypes();
  const clinicians = useClinicians(session.branch?.id);
  const resources = useResources(session.branch?.id);
  const services = useQuery({ queryKey: ['services', 'active'], queryFn: () => api.get<Service[]>('/services'), enabled: open });
  const surgeryTypes = (types.data ?? []).filter((t) => t.category === 'SURGERY' && t.isActive);
  const theatres = (resources.data ?? []).filter((r) => r.type === 'THEATRE' && r.isActive);
  const [p, setP] = useState<PickedPatient | null>(null);
  const [f, setF] = useState({ appointmentTypeId: '', surgeonId: '', theatreId: '', date: todayIn(tz), time: '09:00', durationMinutes: '60', procedure: '', serviceId: '', priority: 'ELECTIVE', estimate: '', allowOutsideHours: false });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setP(patient ?? null);
    setError(null);
    setF((s) => ({ ...s, procedure: '', serviceId: '', estimate: '', allowOutsideHours: false, appointmentTypeId: s.appointmentTypeId || surgeryTypes[0]?.id || '', theatreId: s.theatreId || theatres[0]?.id || '' }));
  }, [open, patient]); // eslint-disable-line react-hooks/exhaustive-deps
  // The surgeon defaults to the signed-in user when they are a clinician at this branch.
  useEffect(() => {
    if (!open) return;
    const me = clinicians.data?.find((c) => c.userId === session.user.id);
    if (me) setF((s) => (s.surgeonId ? s : { ...s, surgeonId: me.membershipId }));
  }, [open, clinicians.data, session.user.id]);
  // Procedure fees: surgical, procedural and dental services only (not grooming, boarding or consultations).
  const procedureFees = (services.data ?? []).filter((s) => s.isActive && PROCEDURE_FEE_CATEGORIES.includes(s.category));
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const m = useMutation({
    mutationFn: () =>
      api.post<Surgery>('/surgeries', {
        patientId: p?.id,
        appointmentTypeId: f.appointmentTypeId,
        surgeonId: f.surgeonId,
        theatreId: f.theatreId || null,
        startsAt: zonedInstant(f.date, parseHhmm(f.time), tz).toISOString(),
        durationMinutes: Number(f.durationMinutes),
        procedure: f.procedure,
        serviceId: f.serviceId || null,
        priority: f.priority,
        admissionId: admissionId ?? null,
        estimateMinor: parseMoney(f.estimate, currency),
        allowOutsideHours: f.allowOutsideHours,
      }),
    onSuccess: (s) => { toast.success(`${s.surgeryNo} scheduled`); onOpenChange(false); router.push(`/surgery/${s.id}`); },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Schedule surgery</DialogTitle>
          <DialogDescription>Books the surgeon and theatre in the calendar. Conflicting bookings are refused.</DialogDescription>
        </DialogHeader>
        {error && <FormError message={error} />}
        {!surgeryTypes.length && types.isSuccess && <p className="rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">Create an appointment type with category “Surgery” in Settings → Appointment types first.</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Patient" htmlFor="sx-patient" required className="sm:col-span-2">{patient ? <p className="text-sm font-medium">{patient.name}</p> : <PatientPicker id="sx-patient" value={p} onChange={setP} />}</Field>
          <Field label="Procedure" htmlFor="sx-proc" required className="sm:col-span-2"><Input id="sx-proc" value={f.procedure} maxLength={200} onChange={set('procedure')} placeholder="e.g. Ovariohysterectomy, dental extraction" /></Field>
          <Field label="Surgeon" htmlFor="sx-surgeon" required>
            <NativeSelect id="sx-surgeon" value={f.surgeonId} onChange={set('surgeonId')}><option value="">Choose…</option>{(clinicians.data ?? []).map((c) => <option key={c.membershipId} value={c.membershipId}>{c.name}</option>)}</NativeSelect>
          </Field>
          <Field label="Theatre" htmlFor="sx-theatre">
            <NativeSelect id="sx-theatre" value={f.theatreId} onChange={set('theatreId')}><option value="">{theatres.length ? 'No theatre' : 'No theatres set up'}</option>{theatres.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</NativeSelect>
          </Field>
          <Field label="Date" htmlFor="sx-date" required><Input id="sx-date" type="date" value={f.date} onChange={set('date')} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Start time" htmlFor="sx-time" required><Input id="sx-time" type="time" value={f.time} onChange={set('time')} /></Field>
            <Field label="Minutes" htmlFor="sx-dur" required><Input id="sx-dur" inputMode="numeric" value={f.durationMinutes} onChange={set('durationMinutes')} /></Field>
          </div>
          <Field label="Appointment type" htmlFor="sx-type" required>
            <NativeSelect id="sx-type" value={f.appointmentTypeId} onChange={set('appointmentTypeId')}>{surgeryTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</NativeSelect>
          </Field>
          <Field label="How urgent" htmlFor="sx-prio" help="Emergency means the patient needs surgery now. Urgent means today or very soon. Elective means a planned operation that can wait for a convenient date.">
            <NativeSelect id="sx-prio" value={f.priority} onChange={set('priority')}>{SURGERY_PRIORITIES.map((s) => <option key={s} value={s}>{enumLabel(s)}</option>)}</NativeSelect>
          </Field>
          <Field label="Procedure fee (service)" htmlFor="sx-svc" hint="Charged when the surgery is completed.">
            <NativeSelect id="sx-svc" value={f.serviceId} onChange={set('serviceId')}><option value="">No fee</option>{procedureFees.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</NativeSelect>
          </Field>
          <Field label="Estimate given to the client" htmlFor="sx-est"><MoneyInput id="sx-est" currency={currency} value={f.estimate} onChange={set('estimate')} /></Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><Checkbox checked={f.allowOutsideHours} onCheckedChange={(v) => setF((s) => ({ ...s, allowOutsideHours: !!v }))} /> Allow outside the surgeon’s rostered hours (emergencies)</label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={m.isPending} disabled={!p || !f.procedure.trim() || !f.surgeonId || !f.appointmentTypeId} onClick={() => { setError(null); m.mutate(); }}>Schedule</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
