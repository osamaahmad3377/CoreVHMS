'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PREFERRED_TIMES, enumLabel } from '@vcms/shared';
import { CalendarPlus } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useConfirm } from '@/components/confirm';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { LoadingRows } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { fmtDate } from '@/lib/format';
import { portalApi } from '@/lib/portal-api';
import { branchTime } from '@/lib/time';

interface Data {
  cancelHours: number;
  appointments: { id: string; startsAt: string; status: string; patient: string | null; type: string; branch: string; timezone: string; canCancel: boolean }[];
  requests: { id: string; reason: string; preferredDate: string; preferredTime: string; status: string; declineReason: string | null; createdAt: string }[];
}

function RequestForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const pets = useQuery({ queryKey: ['portal', 'overview'], queryFn: () => portalApi.get<{ pets: { id: string; name: string }[] }>('/overview') });
  const [f, setF] = useState({ patientId: '', reason: '', preferredDate: '', preferredTime: 'ANY', notes: '' });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (pets.data?.pets.length === 1) setF((s) => ({ ...s, patientId: pets.data!.pets[0].id })); }, [pets.data]);
  const m = useMutation({
    mutationFn: () => portalApi.post('/appointment-requests', { ...f, patientId: f.patientId || null, notes: f.notes || null }),
    onSuccess: () => { toast.success('Request sent — the clinic will confirm a time'); qc.invalidateQueries({ queryKey: ['portal'] }); onDone(); },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Card className="border-primary/40">
      <CardHeader><CardTitle>Request an appointment</CardTitle></CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        {error && <div className="sm:col-span-2"><FormError message={error} /></div>}
        <Field label="Animal" htmlFor="rq-pet"><NativeSelect id="rq-pet" value={f.patientId} onChange={(e) => setF({ ...f, patientId: e.target.value })}><option value="">Choose…</option>{(pets.data?.pets ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect></Field>
        <Field label="Reason" htmlFor="rq-reason" required><Input id="rq-reason" value={f.reason} maxLength={500} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. Vaccination, limping, check-up" /></Field>
        <Field label="Preferred date" htmlFor="rq-date" required><Input id="rq-date" type="date" value={f.preferredDate} onChange={(e) => setF({ ...f, preferredDate: e.target.value })} /></Field>
        <Field label="Preferred time" htmlFor="rq-time"><NativeSelect id="rq-time" value={f.preferredTime} onChange={(e) => setF({ ...f, preferredTime: e.target.value })}>{PREFERRED_TIMES.map((t) => <option key={t} value={t}>{enumLabel(t)}</option>)}</NativeSelect></Field>
        <Field label="Anything else we should know?" htmlFor="rq-notes" className="sm:col-span-2"><Textarea id="rq-notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <p className="text-xs text-muted-foreground sm:col-span-2">For emergencies, please phone the clinic instead.</p>
        <div className="flex gap-2 sm:col-span-2"><Button loading={m.isPending} disabled={!f.reason.trim() || !f.preferredDate} onClick={() => { setError(null); m.mutate(); }}>Send request</Button><Button variant="outline" onClick={onDone}>Cancel</Button></div>
      </CardContent>
    </Card>
  );
}

function Appointments() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [requesting, setRequesting] = useState(useSearchParams().get('request') === '1');
  const q = useQuery({ queryKey: ['portal', 'appointments'], queryFn: () => portalApi.get<Data>('/appointments') });
  const cancel = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => portalApi.post(`/appointments/${id}/cancel`, { reason }),
    onSuccess: () => { toast.success('Appointment cancelled'); qc.invalidateQueries({ queryKey: ['portal'] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!q.data) return <LoadingRows />;
  const now = Date.now();
  const upcoming = q.data.appointments.filter((a) => new Date(a.startsAt).getTime() >= now && !['CANCELLED', 'NO_SHOW'].includes(a.status)).reverse();
  const past = q.data.appointments.filter((a) => !upcoming.includes(a));
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Appointments</h1>
        {!requesting && <Button size="sm" onClick={() => setRequesting(true)}><CalendarPlus /> Request appointment</Button>}
      </div>
      {requesting && <RequestForm onDone={() => setRequesting(false)} />}
      {q.data.requests.some((r) => r.status === 'PENDING' || r.status === 'DECLINED') && (
        <Card>
          <CardHeader><CardTitle>Your requests</CardTitle></CardHeader>
          <ul className="divide-y border-t">
            {q.data.requests.filter((r) => r.status !== 'CANCELLED').slice(0, 10).map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <span><span className="font-medium">{r.reason}</span><span className="block text-xs text-muted-foreground">Preferred {fmtDate(r.preferredDate)}, {enumLabel(r.preferredTime).toLowerCase()}{r.declineReason ? ` · ${r.declineReason}` : ''}</span></span>
                <Badge variant={r.status === 'PENDING' ? 'info' : r.status === 'BOOKED' ? 'success' : 'secondary'}>{r.status === 'PENDING' ? 'Waiting for the clinic' : enumLabel(r.status)}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card>
        <CardHeader><CardTitle>Upcoming</CardTitle></CardHeader>
        <ul className="divide-y border-t">
          {upcoming.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <span><span className="font-medium">{fmtDate(a.startsAt)} at {branchTime(a.startsAt, a.timezone)}</span><span className="block text-xs text-muted-foreground">{a.patient ? `${a.patient} · ` : ''}{a.type} · {a.branch}</span></span>
              {a.canCancel ? (
                <Button size="sm" variant="outline" onClick={async () => { const r = await confirm({ title: 'Cancel this appointment?', requireReason: true, reasonLabel: 'Reason (helps the clinic)', confirmLabel: 'Cancel appointment', destructive: true }); if (r.confirmed) cancel.mutate({ id: a.id, reason: r.reason! }); }}>Cancel</Button>
              ) : <span className="text-xs text-muted-foreground">To change, please phone the clinic</span>}
            </li>
          ))}
          {!upcoming.length && <li className="px-4 py-3 text-sm text-muted-foreground">No upcoming appointments.</li>}
        </ul>
        <CardContent className="pt-2 text-xs text-muted-foreground">Online cancellation is possible up to {q.data.cancelHours} hours before the appointment.</CardContent>
      </Card>
      {!!past.length && (
        <Card>
          <CardHeader><CardTitle>Past & cancelled</CardTitle></CardHeader>
          <ul className="divide-y border-t">
            {past.slice(0, 30).map((a) => (
              <li key={a.id} className="flex items-center justify-between px-4 py-2 text-sm"><span>{fmtDate(a.startsAt)} · {a.patient ?? ''} {a.type}</span><span className="text-xs text-muted-foreground">{enumLabel(a.status)}</span></li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

export default function PortalAppointments() {
  return <Suspense><Appointments /></Suspense>;
}
