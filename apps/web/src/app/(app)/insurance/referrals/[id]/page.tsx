'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Mail, Pencil, Printer, Send, ThumbsUp, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { toast } from 'sonner';
import { useConfirm } from '@/components/confirm';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { ReferralStatusBadge } from '@/components/insurance/dialogs';
import { DescriptionList, ErrorState, LoadingRows, PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { AttachmentsPanel } from '@/components/shared/attachments-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { Referral } from '@/lib/types';

function Ref() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ['referral', id], queryFn: () => api.get<Referral>(`/referrals/${id}`) });
  const [edit, setEdit] = useState<{ reason: string; clinicalSummary: string; questions: string } | null>(null);
  const [dlg, setDlg] = useState<null | 'accept' | 'complete'>(null);
  const [form, setForm] = useState({ appointmentAt: '', outcome: '' });
  const [error, setError] = useState<string | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['referral', id] }); qc.invalidateQueries({ queryKey: ['referrals'] }); };
  const save = useMutation({ mutationFn: () => api.patch(`/referrals/${id}`, edit), onSuccess: () => { toast.success('Saved'); setEdit(null); refresh(); }, onError: (e: Error) => toast.error(e.message) });
  const move = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post(`/referrals/${id}/transition`, body),
    onSuccess: (_d, b) => { toast.success(b.action === 'send' ? (b.email ? 'Referral sent — letter emailed to the specialist' : 'Marked as sent') : 'Updated'); setDlg(null); refresh(); },
    onError: (e: Error) => (dlg ? setError(e.message) : toast.error(e.message)),
  });
  if (q.isLoading) return <LoadingRows />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const r = q.data;
  const canWrite = can('insurance.write');
  const closed = ['COMPLETED', 'DECLINED', 'CANCELLED'].includes(r.status);
  const who = r.contact ? [r.contact.name, r.contact.practice].filter(Boolean).join(', ') : r.externalVet ?? '—';
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Insurance & referrals', href: '/insurance?tab=referrals' }, { label: r.referralNo }]}
        title={<span className="flex items-center gap-2">{r.direction === 'OUTGOING' ? 'Referral to' : 'Referral from'} {who} <ReferralStatusBadge status={r.status} /></span>}
        help="insurance"
        description={`${r.patient.name} (${r.patient.species.name}) · ${r.client.displayName} · ${r.reason}`}
        actions={
          <>
            {r.direction === 'OUTGOING' && <Button size="sm" variant="outline" asChild><Link href={`/insurance/referrals/${r.id}/letter`}><Printer /> Letter</Link></Button>}
            {canWrite && r.status === 'DRAFT' && !edit && <Button size="sm" variant="outline" onClick={() => setEdit({ reason: r.reason, clinicalSummary: r.clinicalSummary ?? '', questions: r.questions ?? '' })}><Pencil /> Edit</Button>}
            {canWrite && r.status === 'DRAFT' && r.contact?.email && <Button size="sm" onClick={() => move.mutate({ action: 'send', email: true })}><Mail /> Email letter</Button>}
            {canWrite && r.status === 'DRAFT' && <Button size="sm" variant={r.contact?.email ? 'outline' : 'default'} onClick={() => move.mutate({ action: 'send', email: false })}><Send /> Mark sent</Button>}
            {canWrite && (r.status === 'SENT' || r.status === 'RECEIVED') && <Button size="sm" variant="outline" onClick={() => { setError(null); setForm({ appointmentAt: '', outcome: '' }); setDlg('accept'); }}><ThumbsUp /> Accepted</Button>}
            {canWrite && ['SENT', 'RECEIVED', 'ACCEPTED'].includes(r.status) && <Button size="sm" onClick={() => { setError(null); setForm({ appointmentAt: '', outcome: '' }); setDlg('complete'); }}><CheckCircle2 /> Complete</Button>}
            {canWrite && !closed && <Button size="sm" variant="ghost" onClick={async () => { const c = await confirm({ title: r.status === 'DRAFT' ? 'Cancel this referral?' : 'Close this referral?', description: 'Choose decline if the specialist could not take the case.', confirmLabel: r.status === 'DRAFT' ? 'Cancel referral' : 'Declined / cancelled', destructive: true, requireReason: true }); if (c.confirmed) move.mutate({ action: r.status === 'DRAFT' ? 'cancel' : 'decline', reason: c.reason }); }}><XCircle /> {r.status === 'DRAFT' ? 'Cancel' : 'Declined'}</Button>}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="grid min-w-0 grid-cols-1 content-start gap-4 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Referral</CardTitle></CardHeader>
            <CardContent className="grid gap-3 text-sm">
              {edit ? (
                <>
                  <Field label="Reason" htmlFor="re-reason"><Input id="re-reason" value={edit.reason} maxLength={500} onChange={(e) => setEdit({ ...edit, reason: e.target.value })} /></Field>
                  <Field label="Clinical summary" htmlFor="re-sum"><Textarea id="re-sum" rows={8} value={edit.clinicalSummary} maxLength={10000} onChange={(e) => setEdit({ ...edit, clinicalSummary: e.target.value })} /></Field>
                  <Field label="Questions" htmlFor="re-q"><Textarea id="re-q" value={edit.questions} maxLength={2000} onChange={(e) => setEdit({ ...edit, questions: e.target.value })} /></Field>
                  <div className="flex gap-2"><Button size="sm" loading={save.isPending} onClick={() => save.mutate()}>Save</Button><Button size="sm" variant="ghost" onClick={() => setEdit(null)}>Cancel</Button></div>
                </>
              ) : (
                <>
                  <div><p className="text-xs font-medium text-muted-foreground">Reason</p><p>{r.reason}</p></div>
                  <div><p className="text-xs font-medium text-muted-foreground">Clinical summary</p><p className="whitespace-pre-wrap">{r.clinicalSummary || <span className="text-muted-foreground">Not written yet — needed before sending.</span>}</p></div>
                  {r.questions && <div><p className="text-xs font-medium text-muted-foreground">Questions</p><p className="whitespace-pre-wrap">{r.questions}</p></div>}
                </>
              )}
            </CardContent>
          </Card>
          {r.outcome && <Card><CardHeader><CardTitle>Outcome</CardTitle></CardHeader><CardContent><p className="whitespace-pre-wrap text-sm">{r.outcome}</p></CardContent></Card>}
          <Card className="p-4"><p className="mb-2 text-sm font-medium">Documents (radiographs, reports)</p><AttachmentsPanel entityType="Referral" entityId={r.id} canWrite={canWrite} /></Card>
        </div>
        <div className="grid min-w-0 grid-cols-1 content-start gap-4">
          <Card>
            <CardHeader><CardTitle>Details</CardTitle></CardHeader>
            <CardContent>
              <DescriptionList items={[
                { label: 'Animal', value: <Link href={`/patients/${r.patient.id}?tab=insurance`} className="hover:underline">{r.patient.name}</Link> },
                { label: 'Owner', value: <Link href={`/clients/${r.client.id}`} className="hover:underline">{r.client.displayName}</Link> },
                { label: 'Urgency', value: r.urgency === 'ROUTINE' ? 'Routine' : <Badge variant={r.urgency === 'EMERGENCY' ? 'destructive' : 'warning'}>{r.urgency === 'EMERGENCY' ? 'Emergency' : 'Urgent'}</Badge> },
                { label: r.direction === 'OUTGOING' ? 'Specialist' : 'From', value: who },
                ...(r.contact ? [{ label: 'Contact', value: [r.contact.phone, r.contact.email].filter(Boolean).join(' · ') || '—' }] : []),
                { label: 'Sent', value: r.sentAt ? `${fmtDateTime(r.sentAt)} (${r.sentByName})` : '—' },
                { label: 'Appointment', value: fmtDateTime(r.appointmentAt) },
                ...(r.declineReason ? [{ label: 'Closed because', value: r.declineReason }] : []),
              ]} />
            </CardContent>
          </Card>
        </div>
      </div>
      <Dialog open={!!dlg} onOpenChange={(o) => !o && setDlg(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{dlg === 'accept' ? 'Referral accepted' : 'Complete referral'}</DialogTitle><DialogDescription>{dlg === 'complete' ? 'Summarise the specialist’s findings or the report received. Attach the report under Documents.' : 'Record the appointment date if known.'}</DialogDescription></DialogHeader>
          {error && <FormError message={error} />}
          {dlg === 'accept' ? (
            <Field label="Appointment" htmlFor="ra-at"><Input id="ra-at" type="datetime-local" value={form.appointmentAt} onChange={(e) => setForm({ ...form, appointmentAt: e.target.value })} /></Field>
          ) : (
            <Field label="Outcome" htmlFor="ra-out" required><Textarea id="ra-out" rows={6} value={form.outcome} maxLength={10000} onChange={(e) => setForm({ ...form, outcome: e.target.value })} /></Field>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDlg(null)}>Cancel</Button>
            <Button loading={move.isPending} disabled={dlg === 'complete' && !form.outcome.trim()} onClick={() => { setError(null); move.mutate(dlg === 'accept' ? { action: 'accept', appointmentAt: form.appointmentAt ? new Date(form.appointmentAt).toISOString() : null } : { action: 'complete', outcome: form.outcome }); }}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function ReferralPage() {
  return (
    <RequirePermission anyOf={['insurance.read']}>
      <Suspense>
        <Ref />
      </Suspense>
    </RequirePermission>
  );
}
