'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Play, Plus, Receipt, RotateCcw, Trash2, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { GroomingStatusBadge } from '@/components/boarding/dialogs';
import { useConfirm } from '@/components/confirm';
import { Field } from '@/components/forms/field';
import { DescriptionList, ErrorState, LoadingRows, PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { AttachmentsPanel } from '@/components/shared/attachments-panel';
import { AlertChip } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { useClinicians } from '@/hooks/use-catalog';
import { api } from '@/lib/api';
import { fmtDateTime, fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { GroomingJob, Invoice, Service } from '@/lib/types';

function Job() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can, currency, session } = useSession();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const staffList = useClinicians(session.branch?.id);
  const q = useQuery({ queryKey: ['grooming-job', id], queryFn: () => api.get<GroomingJob>(`/grooming/jobs/${id}`) });
  const services = useQuery({ queryKey: ['services', 'active'], queryFn: () => api.get<Service[]>('/services') });
  const [notes, setNotes] = useState({ groomerId: '', coatCondition: '', behaviour: '', groomerNotes: '' });
  const [svc, setSvc] = useState('');
  useEffect(() => { if (q.data) setNotes({ groomerId: q.data.groomer?.id ?? '', coatCondition: q.data.coatCondition ?? '', behaviour: q.data.behaviour ?? '', groomerNotes: q.data.groomerNotes ?? '' }); }, [q.data]);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['grooming-job', id] }); qc.invalidateQueries({ queryKey: ['grooming-board'] }); };
  const save = useMutation({ mutationFn: () => api.patch(`/grooming/jobs/${id}`, { ...notes, groomerId: notes.groomerId || null }), onSuccess: () => { toast.success('Saved'); refresh(); }, onError: (e: Error) => toast.error(e.message) });
  const add = useMutation({ mutationFn: () => api.post(`/grooming/jobs/${id}/services`, { serviceId: svc }), onSuccess: () => { setSvc(''); refresh(); }, onError: (e: Error) => toast.error(e.message) });
  const remove = useMutation({ mutationFn: (lineId: string) => api.del(`/grooming/jobs/${id}/services/${lineId}`), onSuccess: refresh, onError: (e: Error) => toast.error(e.message) });
  const move = useMutation({
    mutationFn: ({ action, reason }: { action: string; reason?: string }) => api.post(`/grooming/jobs/${id}/transition`, { action, reason }),
    onSuccess: (_d, v) => { toast.success(v.action === 'ready' ? 'Ready — services added to the owner’s charges' : v.action === 'collected' ? 'Collected' : 'Updated'); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const invoice = useMutation({
    mutationFn: (chargeIds: string[]) => api.post<Invoice>('/invoices', { clientId: q.data!.client.id, chargeIds, lines: [] }),
    onSuccess: (inv) => router.push(`/billing/invoices/${inv.id}`),
    onError: (e: Error) => toast.error(e.message),
  });
  if (q.isLoading) return <LoadingRows />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const j = q.data;
  const canWrite = can('boarding.write');
  const open = !['COLLECTED', 'CANCELLED'].includes(j.status);
  const pending = (j.charges ?? []).filter((c) => c.status === 'PENDING').map((c) => c.id);
  const changed = notes.groomerId !== (j.groomer?.id ?? '') || notes.coatCondition !== (j.coatCondition ?? '') || notes.behaviour !== (j.behaviour ?? '') || notes.groomerNotes !== (j.groomerNotes ?? '');
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Boarding & grooming', href: '/boarding?tab=grooming' }, { label: j.groomingNo }]}
        title={<span className="flex items-center gap-2">{j.patient.name} <GroomingStatusBadge status={j.status} /></span>}
        help="boarding"
        description={`${j.patient.breed?.name ?? j.patient.breedText ?? j.patient.species.name} · ${j.client.displayName}${j.appointment ? ` · booked ${fmtDateTime(j.appointment.startsAt)}` : ' · walk-in'}`}
        actions={
          canWrite && (
            <>
              {j.status === 'WAITING' && <Button size="sm" variant="outline" onClick={() => move.mutate({ action: 'start' })}><Play /> Start grooming</Button>}
              {(j.status === 'WAITING' || j.status === 'IN_PROGRESS') && <Button size="sm" onClick={() => move.mutate({ action: 'ready' })}><CheckCircle2 /> Ready for collection</Button>}
              {j.status === 'READY' && <Button size="sm" onClick={() => move.mutate({ action: 'collected' })}><CheckCircle2 /> Collected</Button>}
              {j.status === 'READY' && <Button size="sm" variant="ghost" onClick={() => move.mutate({ action: 'reopen' })}><RotateCcw /> Back to grooming</Button>}
              {(j.status === 'WAITING' || j.status === 'IN_PROGRESS') && <Button size="sm" variant="ghost" onClick={async () => { const c = await confirm({ title: 'Cancel this grooming job?', destructive: true, confirmLabel: 'Cancel job', requireReason: true }); if (c.confirmed) move.mutate({ action: 'cancel', reason: c.reason }); }}><XCircle /> Cancel</Button>}
            </>
          )
        }
      />
      {!!j.patient.alerts.length && <div className="mb-4 flex flex-wrap gap-1">{j.patient.alerts.map((a) => <AlertChip key={a.id} alert={a} />)}</div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="grid min-w-0 grid-cols-1 content-start gap-4 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Services</CardTitle></CardHeader>
            <CardContent className="grid gap-2">
              {j.services.map((s) => (
                <div key={s.id} className="flex items-center gap-2 text-sm">
                  <span className="flex-1">{s.description}</span>
                  <span className="tabular">{fmtMoney(s.priceMinor, currency)}</span>
                  {canWrite && open && <Button size="icon-sm" variant="ghost" aria-label={`Remove ${s.description}`} onClick={() => remove.mutate(s.id)}><Trash2 /></Button>}
                </div>
              ))}
              {!j.services.length && <p className="text-sm text-muted-foreground">No services added yet.</p>}
              {j.services.length > 0 && <div className="flex justify-between border-t pt-2 text-sm font-medium"><span>Total (before tax)</span><span className="tabular">{fmtMoney(j.totalMinor, currency)}</span></div>}
              {canWrite && open && (
                <div className="mt-2 flex gap-2">
                  <NativeSelect aria-label="Add service" value={svc} onChange={(e) => setSvc(e.target.value)}>
                    <option value="">Add a service…</option>
                    {(services.data ?? []).filter((s) => s.isActive).sort((a, b) => (a.category === 'GROOMING' ? -1 : 1) - (b.category === 'GROOMING' ? -1 : 1)).map((s) => <option key={s.id} value={s.id}>{s.name} — {fmtMoney(s.priceMinor, currency)}</option>)}
                  </NativeSelect>
                  <Button size="sm" disabled={!svc} loading={add.isPending} onClick={() => add.mutate()}><Plus /> Add</Button>
                </div>
              )}
              {j.status === 'READY' && <p className="text-xs text-muted-foreground">Services added now are billed straight away.</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Groomer’s notes</CardTitle></CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <Field label="Groomer" htmlFor="gj-groomer"><NativeSelect id="gj-groomer" value={notes.groomerId} disabled={!canWrite || !open} onChange={(e) => setNotes({ ...notes, groomerId: e.target.value })}><option value="">Not assigned</option>{(staffList.data ?? []).map((c) => <option key={c.membershipId} value={c.membershipId}>{c.name}</option>)}</NativeSelect></Field>
              <Field label="Coat & skin" htmlFor="gj-coat"><Input id="gj-coat" value={notes.coatCondition} disabled={!canWrite || !open} maxLength={500} onChange={(e) => setNotes({ ...notes, coatCondition: e.target.value })} placeholder="e.g. Matted behind ears, mild dandruff" /></Field>
              <Field label="Behaviour" htmlFor="gj-beh"><Input id="gj-beh" value={notes.behaviour} disabled={!canWrite || !open} maxLength={500} onChange={(e) => setNotes({ ...notes, behaviour: e.target.value })} /></Field>
              <Field label="Notes for the owner / next time" htmlFor="gj-notes" className="sm:col-span-2"><Textarea id="gj-notes" value={notes.groomerNotes} disabled={!canWrite || !open} maxLength={2000} onChange={(e) => setNotes({ ...notes, groomerNotes: e.target.value })} /></Field>
              {canWrite && open && changed && <Button size="sm" className="w-fit" loading={save.isPending} onClick={() => save.mutate()}>Save notes</Button>}
            </CardContent>
          </Card>
          <Card className="p-4"><p className="mb-2 text-sm font-medium">Before & after photos</p><AttachmentsPanel entityType="GroomingJob" entityId={j.id} canWrite={canWrite} /></Card>
        </div>
        <div className="grid min-w-0 grid-cols-1 content-start gap-4">
          <Card>
            <CardHeader><CardTitle>Details</CardTitle></CardHeader>
            <CardContent>
              <DescriptionList items={[
                { label: 'Owner', value: <Link href={`/clients/${j.client.id}`} className="hover:underline">{j.client.displayName}</Link> },
                { label: 'Phone', value: j.client.mobilePhone ?? '—' },
                { label: 'Instructions', value: j.instructions || '—' },
                { label: 'Checked in', value: fmtDateTime(j.createdAt) },
                { label: 'Ready', value: fmtDateTime(j.readyAt) },
                { label: 'Collected', value: fmtDateTime(j.collectedAt) },
                ...(j.cancelReason ? [{ label: 'Cancelled', value: j.cancelReason }] : []),
              ]} />
              {can('billing.write') && pending.length > 0 && <Button size="sm" className="mt-3" loading={invoice.isPending} onClick={() => invoice.mutate(pending)}><Receipt /> Create invoice</Button>}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

export default function GroomingJobPage() {
  return (
    <RequirePermission anyOf={['boarding.read']}>
      <Suspense>
        <Job />
      </Suspense>
    </RequirePermission>
  );
}
