'use client';
import { useMutation, useQuery } from '@tanstack/react-query';
import { enumLabel } from '@vcms/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Field } from '../forms/field';
import { FormError } from '../forms/form-error';
import { PatientPicker, type PickedPatient } from '../patients/patient-picker';
import { Badge, type BadgeProps } from '../ui/badge';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input, NativeSelect, Textarea } from '../ui/input';
import { api, qs } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import { shiftDate, todayIn } from '@/lib/time';
import type { BoardingStay, GroomingJob, Service, UnitAvailability } from '@/lib/types';

const STAY: Record<string, BadgeProps['variant']> = { RESERVED: 'info', CHECKED_IN: 'success', CHECKED_OUT: 'secondary', CANCELLED: 'secondary', NO_SHOW: 'warning' };
export function StayStatusBadge({ status }: { status: string }) {
  return <Badge variant={STAY[status] ?? 'secondary'}>{status === 'CHECKED_IN' ? 'Boarding' : enumLabel(status)}</Badge>;
}
const GROOM: Record<string, BadgeProps['variant']> = { WAITING: 'info', IN_PROGRESS: 'warning', READY: 'success', COLLECTED: 'secondary', CANCELLED: 'secondary' };
const GROOM_LABEL: Record<string, string> = { WAITING: 'Waiting', IN_PROGRESS: 'Being groomed', READY: 'Ready for collection', COLLECTED: 'Collected' };
export function GroomingStatusBadge({ status }: { status: string }) {
  return <Badge variant={GROOM[status] ?? 'secondary'}>{GROOM_LABEL[status] ?? enumLabel(status)}</Badge>;
}

/** Reserve a boarding stay: animal, dates and (optionally) a free unit, plus care instructions. */
export function ReserveDialog({ open, onOpenChange, patient }: { open: boolean; onOpenChange: (o: boolean) => void; patient?: PickedPatient | null }) {
  const router = useRouter();
  const { session, currency } = useSession();
  const tz = session.branch?.timezone ?? 'UTC';
  const [p, setP] = useState<PickedPatient | null>(null);
  const [f, setF] = useState({ startDate: '', endDate: '', unitId: '', feedingInstructions: '', medicationInstructions: '', belongings: '', behaviourNotes: '', emergencyContact: '' });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const today = todayIn(tz);
    setP(patient ?? null);
    setError(null);
    setF({ startDate: today, endDate: shiftDate(today, 3), unitId: '', feedingInstructions: '', medicationInstructions: '', belongings: '', behaviourNotes: '', emergencyContact: '' });
  }, [open, patient, tz]);
  const datesOk = !!f.startDate && !!f.endDate && f.endDate > f.startDate;
  const avail = useQuery({
    queryKey: ['boarding-availability', session.branch?.id, f.startDate, f.endDate],
    queryFn: () => api.get<UnitAvailability[]>(`/boarding/availability${qs({ branchId: session.branch?.id, from: f.startDate, to: f.endDate })}`),
    enabled: open && datesOk,
  });
  const free = (avail.data ?? []).filter((u) => !u.stays.length);
  const nights = datesOk ? Math.round((new Date(f.endDate).getTime() - new Date(f.startDate).getTime()) / 86400_000) : 0;
  const unit = avail.data?.find((u) => u.id === f.unitId);
  const m = useMutation({
    mutationFn: () => api.post<BoardingStay>('/boarding/stays', { patientId: p?.id, ...f, unitId: f.unitId || null }),
    onSuccess: (s) => { toast.success(`Booked ${s.patient.name} (${s.stayNo})`); onOpenChange(false); router.push(`/boarding/stays/${s.id}`); },
    onError: (e: Error) => setError(e.message),
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader><DialogTitle>New boarding booking</DialogTitle><DialogDescription>Nights are billed at check-out, at the rate shown when booking.</DialogDescription></DialogHeader>
        {error && <FormError message={error} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Animal" htmlFor="rs-patient" required className="sm:col-span-2">{patient ? <p className="text-sm font-medium">{patient.name}</p> : <PatientPicker id="rs-patient" value={p} onChange={setP} />}</Field>
          <Field label="Arrival" htmlFor="rs-start" required><Input id="rs-start" type="date" value={f.startDate} onChange={set('startDate')} /></Field>
          <Field label="Departure" htmlFor="rs-end" required hint={nights ? `${nights} night${nights === 1 ? '' : 's'}` : 'Must be after arrival'}><Input id="rs-end" type="date" value={f.endDate} onChange={set('endDate')} /></Field>
          <Field label="Kennel / unit" htmlFor="rs-unit" className="sm:col-span-2" hint={unit?.nightlyService ? `${fmtMoney(unit.nightlyService.priceMinor, currency)} per night · about ${fmtMoney(unit.nightlyService.priceMinor * nights, currency)} in total` : 'You can also assign the unit at check-in.'}>
            <NativeSelect id="rs-unit" value={f.unitId} onChange={set('unitId')}>
              <option value="">{avail.data && !avail.data.length ? 'No units set up (Settings → Boarding kennels)' : 'Assign at check-in'}</option>
              {free.map((u) => <option key={u.id} value={u.id}>{u.name}{u.nightlyService ? ` — ${fmtMoney(u.nightlyService.priceMinor, currency)}/night` : ''}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Feeding" htmlFor="rs-feed" className="sm:col-span-2"><Textarea id="rs-feed" value={f.feedingInstructions} maxLength={2000} onChange={set('feedingInstructions')} placeholder="Food, amount, times" /></Field>
          <Field label="Medication" htmlFor="rs-med" className="sm:col-span-2"><Textarea id="rs-med" value={f.medicationInstructions} maxLength={2000} onChange={set('medicationInstructions')} /></Field>
          <Field label="Belongings left with us" htmlFor="rs-bel"><Input id="rs-bel" value={f.belongings} maxLength={1000} onChange={set('belongings')} placeholder="Bed, toys, lead…" /></Field>
          <Field label="Emergency contact" htmlFor="rs-ec"><Input id="rs-ec" value={f.emergencyContact} maxLength={200} onChange={set('emergencyContact')} /></Field>
          <Field label="Behaviour notes" htmlFor="rs-beh" className="sm:col-span-2"><Input id="rs-beh" value={f.behaviourNotes} maxLength={1000} onChange={set('behaviourNotes')} placeholder="e.g. Nervous with other dogs" /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={m.isPending} disabled={!p || !datesOk} onClick={() => { setError(null); m.mutate(); }}>Book</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Check an animal in for grooming: from a booked appointment, or as a walk-in. */
export function GroomingCheckInDialog({ open, onOpenChange, appointment }: { open: boolean; onOpenChange: (o: boolean) => void; appointment?: { id: string; patient: { id: string; name: string } | null; reason: string | null } | null }) {
  const router = useRouter();
  const { currency } = useSession();
  const [p, setP] = useState<PickedPatient | null>(null);
  const [instructions, setInstructions] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const services = useQuery({ queryKey: ['services', 'active'], queryFn: () => api.get<Service[]>('/services'), enabled: open });
  useEffect(() => { if (open) { setP(null); setInstructions(appointment?.reason ?? ''); setPicked([]); setError(null); } }, [open, appointment]);
  const grooming = (services.data ?? []).filter((s) => s.isActive && (s.category === 'GROOMING' || picked.includes(s.id)));
  const m = useMutation({
    mutationFn: () => api.post<GroomingJob>('/grooming/jobs', { appointmentId: appointment?.id ?? null, patientId: appointment ? null : p?.id, instructions: instructions || null, serviceIds: picked }),
    onSuccess: (j) => { toast.success(`${j.patient.name} checked in for grooming`); onOpenChange(false); router.push(`/boarding/grooming/${j.id}`); },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Check in for grooming</DialogTitle><DialogDescription>Services are billed when the groomer marks the job ready.</DialogDescription></DialogHeader>
        {error && <FormError message={error} />}
        <div className="grid gap-3">
          <Field label="Animal" htmlFor="gr-patient" required>{appointment ? <p className="text-sm font-medium">{appointment.patient?.name ?? 'No animal on the appointment'}</p> : <PatientPicker id="gr-patient" value={p} onChange={setP} />}</Field>
          <Field label="Client’s instructions" htmlFor="gr-ins"><Textarea id="gr-ins" value={instructions} maxLength={1000} onChange={(e) => setInstructions(e.target.value)} placeholder="e.g. Short summer cut, keep ears long" /></Field>
          <div className="grid gap-1.5">
            <p className="text-sm font-medium">Services</p>
            {grooming.length ? grooming.map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-sm"><Checkbox checked={picked.includes(s.id)} onCheckedChange={(v) => setPicked(v ? [...picked, s.id] : picked.filter((x) => x !== s.id))} /> <span className="flex-1">{s.name}</span><span className="tabular text-muted-foreground">{fmtMoney(s.priceMinor, currency)}</span></label>
            )) : <p className="text-xs text-muted-foreground">No grooming services yet — add them in Settings → Services & prices (category Grooming). You can add services later.</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={m.isPending} disabled={appointment ? !appointment.patient : !p} onClick={() => { setError(null); m.mutate(); }}>Check in</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
