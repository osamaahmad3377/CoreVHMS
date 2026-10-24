'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { bookingIcs } from '@vcms/shared';
import { CalendarCheck, CalendarPlus, CalendarX, Clock, PawPrint, Phone, RefreshCw, Stethoscope, User } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { BookingFrame } from '@/components/booking/booking-frame';
import type { BookingSummary, FreeTime } from '@/components/booking/booking-types';
import { SlotPicker } from '@/components/booking/slot-picker';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { LoadingRows } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { branchTime } from '@/lib/time';

interface Manage {
  booking: BookingSummary;
  changeable: boolean;
  cancelNoticeHours: number;
  slug: string | null;
  clinic: { name: string; phone: string | null; branding: import('@vcms/shared').Branding | null };
}

const STATUS: Record<string, { label: string; variant: 'success' | 'warning' | 'destructive' | 'secondary' }> = {
  BOOKED: { label: 'Waiting for the clinic to confirm', variant: 'warning' },
  CONFIRMED: { label: 'Confirmed', variant: 'success' },
  CANCELLED: { label: 'Cancelled', variant: 'destructive' },
  COMPLETED: { label: 'Visit done', variant: 'secondary' },
};

/** The client's private page for one booking: see it, move it to another free time, or cancel it. */
function ManageBooking() {
  const { token } = useParams<{ token: string }>();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['manage-booking', token], queryFn: () => api.get<Manage>(`/public/booking/manage/${token}`), retry: false });
  const [moving, setMoving] = useState(false);
  const [time, setTime] = useState<FreeTime | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const done = (r: Manage) => {
    qc.setQueryData(['manage-booking', token], r);
    setMoving(false);
    setCancelling(false);
    setTime(null);
  };
  const move = useMutation({
    mutationFn: () => api.post<Manage>(`/public/booking/manage/${token}/reschedule`, { startsAt: time!.startsAt, clinicianId: q.data?.booking.clinicianId && time!.clinicianIds.includes(q.data.booking.clinicianId) ? q.data.booking.clinicianId : '' }),
    onSuccess: (r) => {
      done(r);
      toast.success('Your appointment has been moved');
    },
    onError: (e: Error) => setError(e.message),
  });
  const cancel = useMutation({
    mutationFn: () => api.post<Manage>(`/public/booking/manage/${token}/cancel`, { reason }),
    onSuccess: (r) => {
      done(r);
      toast.success('Your appointment has been cancelled');
    },
    onError: (e: Error) => setError(e.message),
  });

  if (q.isLoading)
    return (
      <div className="app-canvas min-h-screen p-6">
        <LoadingRows rows={5} className="mx-auto max-w-2xl" />
      </div>
    );
  if (q.error || !q.data)
    return (
      <div className="app-canvas grid min-h-screen place-items-center p-6">
        <div className="surface-strong max-w-md rounded-2xl p-8 text-center">
          <CalendarX className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
          <h1 className="text-xl font-semibold">We could not find this booking</h1>
          <p className="mt-2 text-sm text-muted-foreground">The link may be incomplete. Please open it again from your confirmation message, or call the clinic.</p>
        </div>
      </div>
    );

  const { booking: b, clinic } = q.data;
  const tz = b.branch.timezone;
  const st = STATUS[b.status] ?? { label: b.status, variant: 'secondary' as const };
  const phone = b.branch.phone ?? clinic.phone;

  return (
    <BookingFrame name={clinic.name} branding={clinic.branding} logoSrc={clinic.branding?.logoUrl} address={b.branch.address} phone={phone}>
      <div className="mx-auto grid max-w-2xl gap-6">
        <div className="surface-strong grid gap-6 rounded-2xl p-6 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-2xl font-bold tracking-tight">Your appointment</h2>
            <Badge variant={st.variant}>{st.label}</Badge>
          </div>
          <ul className="grid gap-3">
            {[
              { icon: Clock, label: 'When', value: `${branchTime(b.startsAt, tz, 'EEEE d MMMM')} at ${branchTime(b.startsAt, tz, 'h:mm a')}` },
              { icon: Stethoscope, label: 'Service', value: b.service },
              { icon: PawPrint, label: 'For', value: b.petName ?? '—' },
              { icon: User, label: 'Vet', value: b.vet ?? 'The first free vet' },
              { icon: CalendarCheck, label: 'Where', value: [b.branch.name, b.branch.address].filter(Boolean).join(' · ') },
            ].map((r) => (
              <li key={r.label} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <r.icon className="h-4 w-4" />
                </span>
                <span>
                  <span className="block text-xs text-muted-foreground">{r.label}</span>
                  <span className="block text-sm font-semibold">{r.value}</span>
                </span>
              </li>
            ))}
          </ul>
          {b.status !== 'CANCELLED' && (
            <div className="grid gap-2 sm:grid-cols-3">
              <Button
                variant="outline"
                onClick={() => {
                  const ics = bookingIcs({ uid: `${b.id}@nextcore`, startsAt: b.startsAt, endsAt: b.endsAt, title: `${b.service}${b.petName ? ` — ${b.petName}` : ''} at ${clinic.name}`, location: [b.branch.name, b.branch.address].filter(Boolean).join(', ') });
                  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
                  Object.assign(document.createElement('a'), { href: url, download: 'appointment.ics' }).click();
                  URL.revokeObjectURL(url);
                }}
              >
                <CalendarPlus /> Add to calendar
              </Button>
              {q.data.changeable && q.data.slug && (
                <Button variant="outline" onClick={() => { setMoving((m) => !m); setError(null); }}>
                  <RefreshCw /> Change time
                </Button>
              )}
              {q.data.changeable && (
                <Button variant="ghost" className="text-destructive" onClick={() => { setCancelling(true); setError(null); }}>
                  <CalendarX /> Cancel
                </Button>
              )}
            </div>
          )}
          {!q.data.changeable && ['BOOKED', 'CONFIRMED'].includes(b.status) && (
            <p className="rounded-xl surface-flat p-4 text-sm text-muted-foreground">
              Online changes close {q.data.cancelNoticeHours} hours before the appointment.{' '}
              {phone && (
                <a href={`tel:${phone.replace(/\s/g, '')}`} className="inline-flex items-center gap-1 font-semibold text-primary">
                  <Phone className="h-3.5 w-3.5" /> Call {phone}
                </a>
              )}
            </p>
          )}
        </div>

        {moving && q.data.slug && (
          <div className="surface grid grid-cols-[minmax(0,1fr)] gap-5 rounded-2xl p-6 sm:p-8">
            <h3 className="text-lg font-semibold">Choose a new time</h3>
            {error && <FormError message={error} />}
            <SlotPicker slug={q.data.slug} branchId={b.branch.id} appointmentTypeId={b.appointmentTypeId} timezone={tz} value={time} onChange={(t) => { setTime(t); setError(null); }} />
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="ghost" onClick={() => setMoving(false)}>
                Keep my time
              </Button>
              <Button size="lg" disabled={!time} loading={move.isPending} onClick={() => move.mutate()}>
                {time ? `Move to ${branchTime(time.startsAt, tz, 'EEE d MMM, h:mm a')}` : 'Choose a time'}
              </Button>
            </div>
          </div>
        )}
      </div>

      <Dialog open={cancelling} onOpenChange={setCancelling}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Cancel this appointment?</DialogTitle>
            <DialogDescription>
              {b.petName ? `${b.petName}, ` : ''}
              {branchTime(b.startsAt, tz, 'EEEE d MMMM, h:mm a')}. The time becomes free for someone else.
            </DialogDescription>
          </DialogHeader>
          {error && <FormError message={error} />}
          <Field label="Reason (optional)" htmlFor="m-reason">
            <Input id="m-reason" maxLength={300} placeholder="e.g. Feeling better" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelling(false)}>
              Keep it
            </Button>
            <Button variant="destructive" loading={cancel.isPending} onClick={() => cancel.mutate()}>
              Cancel appointment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BookingFrame>
  );
}

export default function ManageBookingPage() {
  return <ManageBooking />;
}
