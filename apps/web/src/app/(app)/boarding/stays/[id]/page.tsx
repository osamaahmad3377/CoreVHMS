'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BOARDING_LOG_KINDS, enumLabel } from '@vcms/shared';
import { AlertTriangle, LogIn, LogOut, Receipt, Send, UserX, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { StayStatusBadge } from '@/components/boarding/dialogs';
import { useConfirm } from '@/components/confirm';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { DescriptionList, ErrorState, LoadingRows, PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { AttachmentsPanel } from '@/components/shared/attachments-panel';
import { AlertChip } from '@/components/status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect } from '@/components/ui/input';
import { api, ApiError, qs } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { BoardingStayDetail, Invoice, UnitAvailability } from '@/lib/types';

function CheckInDialog({ open, onOpenChange, stay, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; stay: BoardingStayDetail; onDone: () => void }) {
  const { session } = useSession();
  const [unitId, setUnitId] = useState('');
  const [override, setOverride] = useState('');
  const [error, setError] = useState<string | null>(null);
  const avail = useQuery({ queryKey: ['boarding-availability', stay.branchId, stay.startDate, stay.endDate], queryFn: () => api.get<UnitAvailability[]>(`/boarding/availability${qs({ branchId: session.branch?.id, from: stay.startDate.slice(0, 10), to: stay.endDate.slice(0, 10) })}`), enabled: open });
  useEffect(() => { if (open) { setUnitId(stay.unit?.id ?? ''); setOverride(''); setError(null); } }, [open, stay.unit?.id]);
  const free = (avail.data ?? []).filter((u) => u.id === stay.unit?.id || !u.stays.some((s) => s.id !== stay.id));
  const overdue = stay.overdueVaccinations;
  const m = useMutation({
    mutationFn: () => api.post(`/boarding/stays/${stay.id}/check-in`, { unitId: unitId || null, vaccinationOverride: override || null }),
    onSuccess: () => { toast.success(`${stay.patient.name} checked in`); onOpenChange(false); onDone(); },
    onError: (e: Error) => setError(e instanceof ApiError ? e.message : String(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Check in {stay.patient.name}</DialogTitle><DialogDescription>Confirm the kennel, belongings and care instructions with the owner.</DialogDescription></DialogHeader>
        {error && <FormError message={error} />}
        <div className="grid gap-3">
          <Field label="Kennel / unit" htmlFor="ci-unit" required>
            <NativeSelect id="ci-unit" value={unitId} onChange={(e) => setUnitId(e.target.value)}><option value="">Choose…</option>{free.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</NativeSelect>
          </Field>
          {overdue.length > 0 && (
            <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
              <p className="flex items-center gap-2 font-medium text-warning"><AlertTriangle className="h-4 w-4" /> Vaccinations overdue</p>
              <ul className="mt-1 list-disc pl-5">{overdue.map((o) => <li key={o.id}>{o.title} — due {fmtDate(o.dueDate)}</li>)}</ul>
              <Field label="Accept anyway — who agreed and why" htmlFor="ci-override" className="mt-2"><Input id="ci-override" value={override} maxLength={300} onChange={(e) => setOverride(e.target.value)} placeholder="e.g. Owner bringing certificate tomorrow; agreed by Dr. Ali" /></Field>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={m.isPending} disabled={!unitId || (overdue.length > 0 && !override.trim())} onClick={() => { setError(null); m.mutate(); }}>Check in</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stay() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can, currency } = useSession();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [checkingIn, setCheckingIn] = useState(false);
  const [log, setLog] = useState({ kind: 'FEEDING', text: '' });
  const q = useQuery({ queryKey: ['boarding-stay', id], queryFn: () => api.get<BoardingStayDetail>(`/boarding/stays/${id}`) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['boarding-stay', id] }); qc.invalidateQueries({ queryKey: ['boarding-board'] }); qc.invalidateQueries({ queryKey: ['boarding-availability'] }); };
  const act = useMutation({
    mutationFn: ({ action, reason }: { action: 'check-out' | 'cancel' | 'no-show'; reason?: string }) => api.post(`/boarding/stays/${id}/${action}`, action === 'cancel' ? { reason } : {}),
    onSuccess: (_d, v) => { toast.success(v.action === 'check-out' ? 'Checked out — nights added to the owner’s charges' : v.action === 'cancel' ? 'Booking cancelled' : 'Marked as no-show'); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const addLog = useMutation({
    mutationFn: () => api.post(`/boarding/stays/${id}/logs`, log),
    onSuccess: () => { setLog({ ...log, text: '' }); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const invoice = useMutation({
    mutationFn: () => api.post<Invoice>('/invoices', { clientId: q.data!.client.id, chargeIds: [q.data!.charge!.id], lines: [] }),
    onSuccess: (inv) => router.push(`/billing/invoices/${inv.id}`),
    onError: (e: Error) => toast.error(e.message),
  });
  if (q.isLoading) return <LoadingRows />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data;
  const canWrite = can('boarding.write');
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Boarding & grooming', href: '/boarding' }, { label: s.stayNo }]}
        title={<span className="flex items-center gap-2">{s.patient.name} <StayStatusBadge status={s.status} /></span>}
        help="boarding"
        description={`${s.patient.species.name}${s.patient.breed ? ` · ${s.patient.breed.name}` : ''} · ${fmtDate(s.startDate)} → ${fmtDate(s.endDate)} (${s.nights} night${s.nights === 1 ? '' : 's'})${s.unit ? ` · ${s.unit.name}` : ''}`}
        actions={
          canWrite && (
            <>
              {s.status === 'RESERVED' && <Button size="sm" onClick={() => setCheckingIn(true)}><LogIn /> Check in</Button>}
              {s.status === 'CHECKED_IN' && <Button size="sm" onClick={async () => { const c = await confirm({ title: `Check out ${s.patient.name}?`, description: 'The nights stayed are added to the owner’s unbilled charges.', confirmLabel: 'Check out' }); if (c.confirmed) act.mutate({ action: 'check-out' }); }}><LogOut /> Check out</Button>}
              {s.status === 'RESERVED' && <Button size="sm" variant="ghost" onClick={() => act.mutate({ action: 'no-show' })}><UserX /> No-show</Button>}
              {s.status === 'RESERVED' && <Button size="sm" variant="ghost" onClick={async () => { const c = await confirm({ title: 'Cancel this booking?', destructive: true, confirmLabel: 'Cancel booking', requireReason: true }); if (c.confirmed) act.mutate({ action: 'cancel', reason: c.reason }); }}><XCircle /> Cancel</Button>}
            </>
          )
        }
      />
      {!!s.patient.alerts.length && <div className="mb-4 flex flex-wrap gap-1">{s.patient.alerts.map((a) => <AlertChip key={a.id} alert={a} />)}</div>}
      {s.status === 'RESERVED' && s.overdueVaccinations.length > 0 && <p className="mb-4 flex items-center gap-2 rounded-md bg-warning/10 px-3 py-2 text-sm text-warning"><AlertTriangle className="h-4 w-4" /> Vaccinations overdue: {s.overdueVaccinations.map((o) => o.title).join(', ')}</p>}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="grid min-w-0 grid-cols-1 content-start gap-4 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Care instructions</CardTitle></CardHeader>
            <CardContent>
              <DescriptionList items={[
                { label: 'Feeding', value: <span className="whitespace-pre-wrap">{s.feedingInstructions || '—'}</span> },
                { label: 'Medication', value: <span className="whitespace-pre-wrap">{s.medicationInstructions || '—'}</span> },
                { label: 'Behaviour', value: s.behaviourNotes || '—' },
                { label: 'Belongings', value: s.belongings || '—' },
                { label: 'Emergency contact', value: s.emergencyContact || '—' },
                ...(s.vaccinationOverride ? [{ label: 'Vaccination exception', value: s.vaccinationOverride }] : []),
              ]} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Daily care log</CardTitle></CardHeader>
            {canWrite && s.status === 'CHECKED_IN' && (
              <div className="flex flex-wrap gap-2 border-b px-4 pb-3">
                <NativeSelect aria-label="Log type" className="w-36" value={log.kind} onChange={(e) => setLog({ ...log, kind: e.target.value })}>{BOARDING_LOG_KINDS.map((k) => <option key={k} value={k}>{k === 'FEEDING' ? 'Feeding' : enumLabel(k)}</option>)}</NativeSelect>
                <Input aria-label="Log entry" className="min-w-48 flex-1" value={log.text} maxLength={1000} onChange={(e) => setLog({ ...log, text: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter' && log.text.trim()) addLog.mutate(); }} placeholder="e.g. Ate all breakfast, walked 20 min" />
                <Button size="sm" loading={addLog.isPending} disabled={!log.text.trim()} onClick={() => addLog.mutate()}><Send /> Add</Button>
              </div>
            )}
            {s.logs.length ? (
              <ul className="divide-y text-sm">
                {s.logs.map((l) => (
                  <li key={l.id} className="flex items-start gap-3 px-4 py-2">
                    <span className="w-32 shrink-0 text-xs text-muted-foreground">{fmtDateTime(l.recordedAt)}</span>
                    <Badge variant={l.kind === 'INCIDENT' ? 'destructive' : l.kind === 'MEDICATION' ? 'info' : 'secondary'}>{l.kind === 'FEEDING' ? 'Feeding' : enumLabel(l.kind)}</Badge>
                    <span className="flex-1">{l.text}</span>
                    <span className="text-xs text-muted-foreground">{l.recordedByName}</span>
                  </li>
                ))}
              </ul>
            ) : <CardContent><p className="text-sm text-muted-foreground">{s.status === 'CHECKED_IN' ? 'Nothing logged yet today.' : 'The log starts at check-in.'}</p></CardContent>}
          </Card>
          <Card>
            <CardHeader><CardTitle>Documents & photos</CardTitle></CardHeader>
            <CardContent><AttachmentsPanel entityType="BoardingStay" entityId={s.id} canWrite={canWrite} /></CardContent>
          </Card>
        </div>
        <div className="grid min-w-0 grid-cols-1 content-start gap-4">
          <Card>
            <CardHeader><CardTitle>Owner</CardTitle></CardHeader>
            <CardContent>
              <DescriptionList items={[
                { label: 'Owner', value: <Link href={`/clients/${s.client.id}`} className="hover:underline">{s.client.displayName}</Link> },
                { label: 'Phone', value: s.client.mobilePhone ?? '—' },
                { label: 'Animal', value: <Link href={`/patients/${s.patient.id}`} className="hover:underline">{s.patient.name}</Link> },
              ]} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Billing</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 gap-2 text-sm">
              <p>{s.nightlyRateMinor ? `${fmtMoney(s.nightlyRateMinor, currency)} per night` : 'No nightly charge'}</p>
              {s.charge ? (
                <>
                  <p>{s.charge.quantity} night{s.charge.quantity === 1 ? '' : 's'} billed: <b>{fmtMoney(s.charge.quantity * s.charge.unitPriceMinor, currency)}</b> <Badge variant="secondary">{enumLabel(s.charge.status)}</Badge></p>
                  {s.charge.status === 'PENDING' && can('billing.write') && <Button size="sm" loading={invoice.isPending} onClick={() => invoice.mutate()}><Receipt /> Create invoice</Button>}
                </>
              ) : s.status === 'CHECKED_IN' || s.status === 'RESERVED' ? <p className="text-xs text-muted-foreground">Nights are billed at check-out.</p> : null}
              <p className="text-xs text-muted-foreground">{s.checkedInAt && `In ${fmtDateTime(s.checkedInAt)} (${s.checkedInByName})`}{s.checkedOutAt && ` · Out ${fmtDateTime(s.checkedOutAt)}`}</p>
              {s.cancelReason && <p className="text-xs text-muted-foreground">Cancelled: {s.cancelReason}</p>}
            </CardContent>
          </Card>
        </div>
      </div>
      <CheckInDialog open={checkingIn} onOpenChange={setCheckingIn} stay={s} onDone={refresh} />
    </>
  );
}

export default function StayPage() {
  return (
    <RequirePermission anyOf={['boarding.read']}>
      <Suspense>
        <Stay />
      </Suspense>
    </RequirePermission>
  );
}

