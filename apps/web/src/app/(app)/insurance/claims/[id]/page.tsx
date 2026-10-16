'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, Gavel, Pencil, Printer, Send } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ClaimPaymentDialog, ClaimStatusBadge, DecisionDialog } from '@/components/insurance/dialogs';
import { DescriptionList, ErrorState, LoadingRows, PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { AttachmentsPanel } from '@/components/shared/attachments-panel';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Textarea } from '@/components/ui/input';
import { api } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { InsuranceClaim } from '@/lib/types';

function Claim() {
  const { id } = useParams<{ id: string }>();
  const { can, currency } = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['claim', id], queryFn: () => api.get<InsuranceClaim>(`/insurance/claims/${id}`) });
  const [dlg, setDlg] = useState<null | 'decision' | 'payment'>(null);
  const [edit, setEdit] = useState<{ condition: string; clinicalSummary: string; notes: string } | null>(null);
  useEffect(() => { setEdit(null); }, [id]);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['claim', id] }); qc.invalidateQueries({ queryKey: ['claims'] }); };
  const submit = useMutation({ mutationFn: () => api.post(`/insurance/claims/${id}/submit`), onSuccess: () => { toast.success('Claim marked as submitted'); refresh(); }, onError: (e: Error) => toast.error(e.message) });
  const save = useMutation({ mutationFn: () => api.patch(`/insurance/claims/${id}`, edit), onSuccess: () => { toast.success('Claim updated'); setEdit(null); refresh(); }, onError: (e: Error) => toast.error(e.message) });
  if (q.isLoading) return <LoadingRows />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const c = q.data;
  const canWrite = can('insurance.write');
  const editable = canWrite && (c.status === 'DRAFT' || c.status === 'QUERIED');
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Insurance & referrals', href: '/insurance' }, { label: c.claimNo }]}
        title={<span className="flex items-center gap-2">{c.condition} <ClaimStatusBadge status={c.status} /></span>}
        help="insurance"
        description={`${c.patient.name} · ${c.client.displayName} · ${c.policy.provider.name} ${c.policy.policyNumber}`}
        actions={
          <>
            <Button size="sm" variant="outline" asChild><Link href={`/insurance/claims/${c.id}/form`}><Printer /> Claim form</Link></Button>
            {editable && !edit && <Button size="sm" variant="outline" onClick={() => setEdit({ condition: c.condition, clinicalSummary: c.clinicalSummary ?? '', notes: c.notes ?? '' })}><Pencil /> Edit</Button>}
            {editable && <Button size="sm" loading={submit.isPending} onClick={() => submit.mutate()}><Send /> {c.status === 'QUERIED' ? 'Resubmit' : 'Mark submitted'}</Button>}
            {canWrite && c.status === 'SUBMITTED' && <Button size="sm" onClick={() => setDlg('decision')}><Gavel /> Record decision</Button>}
            {canWrite && can('payments.take') && (c.status === 'APPROVED' || c.status === 'PARTIALLY_APPROVED') && <Button size="sm" onClick={() => setDlg('payment')}><Banknote /> Record payment</Button>}
          </>
        }
      />
      {c.status === 'QUERIED' && c.decisionNotes && <p className="mb-4 rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">Insurer query: {c.decisionNotes}</p>}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="grid min-w-0 grid-cols-1 content-start gap-4 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Invoices claimed</CardTitle></CardHeader>
            {c.invoices.length ? (
              <ul className="divide-y text-sm">
                {c.invoices.map((i) => (
                  <li key={i.id} className="flex items-center gap-3 px-4 py-2">
                    <Link href={`/billing/invoices/${i.invoiceId}`} className="flex-1 hover:underline">Invoice {i.invoice.number ? `INV-${String(i.invoice.number).padStart(6, '0')}` : ''} · {fmtDate(i.invoice.issuedAt)}</Link>
                    <span className="text-xs text-muted-foreground">balance {fmtMoney(i.invoice.balanceMinor, currency)}</span>
                    <span className="tabular font-medium">{fmtMoney(i.amountMinor, currency)}</span>
                  </li>
                ))}
              </ul>
            ) : <CardContent><p className="text-sm text-muted-foreground">No invoices attached yet.</p></CardContent>}
          </Card>
          <Card>
            <CardHeader><CardTitle>Clinical summary</CardTitle></CardHeader>
            <CardContent className="grid gap-3">
              {edit ? (
                <>
                  <Input aria-label="Condition" value={edit.condition} maxLength={300} onChange={(e) => setEdit({ ...edit, condition: e.target.value })} />
                  <Textarea aria-label="Clinical summary" rows={8} value={edit.clinicalSummary} maxLength={10000} onChange={(e) => setEdit({ ...edit, clinicalSummary: e.target.value })} />
                  <Textarea aria-label="Notes" value={edit.notes} maxLength={2000} placeholder="Internal notes" onChange={(e) => setEdit({ ...edit, notes: e.target.value })} />
                  <div className="flex gap-2"><Button size="sm" loading={save.isPending} onClick={() => save.mutate()}>Save</Button><Button size="sm" variant="ghost" onClick={() => setEdit(null)}>Cancel</Button></div>
                </>
              ) : <p className="whitespace-pre-wrap text-sm">{c.clinicalSummary || <span className="text-muted-foreground">No summary yet.</span>}</p>}
            </CardContent>
          </Card>
          <Card className="p-4"><p className="mb-2 text-sm font-medium">Supporting documents</p><AttachmentsPanel entityType="InsuranceClaim" entityId={c.id} canWrite={canWrite} /></Card>
        </div>
        <div className="grid min-w-0 grid-cols-1 content-start gap-4">
          <Card>
            <CardHeader><CardTitle>Amounts</CardTitle></CardHeader>
            <CardContent>
              <DescriptionList items={[
                { label: 'Claimed', value: fmtMoney(c.claimedMinor, currency) },
                { label: 'Approved', value: c.approvedMinor != null ? fmtMoney(c.approvedMinor, currency) : '—' },
                { label: 'Paid', value: fmtMoney(c.paidMinor, currency) },
                { label: 'Outstanding', value: c.approvedMinor != null ? fmtMoney(c.outstandingMinor, currency) : '—' },
                { label: 'Insurer pays', value: c.payee === 'CLINIC' ? 'The clinic' : 'The client' },
              ]} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Details</CardTitle></CardHeader>
            <CardContent>
              <DescriptionList items={[
                { label: 'Animal', value: <Link href={`/patients/${c.patient.id}?tab=insurance`} className="hover:underline">{c.patient.name}</Link> },
                { label: 'Treatment', value: `${fmtDate(c.treatmentFrom)} → ${fmtDate(c.treatmentTo)}` },
                { label: 'Policy', value: `${c.policy.provider.name} ${c.policy.policyNumber}` },
                { label: 'Claims contact', value: c.policy.provider.claimsEmail ?? c.policy.provider.email ?? c.policy.provider.phone ?? '—' },
                { label: 'Submitted', value: c.submittedAt ? `${fmtDateTime(c.submittedAt)} (${c.submittedByName})` : '—' },
                { label: 'Insurer reference', value: c.insurerReference ?? '—' },
                ...(c.decisionNotes && c.status !== 'QUERIED' ? [{ label: 'Insurer notes', value: c.decisionNotes }] : []),
              ]} />
            </CardContent>
          </Card>
        </div>
      </div>
      <DecisionDialog open={dlg === 'decision'} onOpenChange={(o) => !o && setDlg(null)} url={`/insurance/claims/${c.id}/decision`} kind="claim" maxMinor={c.claimedMinor} onDone={refresh} />
      <ClaimPaymentDialog open={dlg === 'payment'} onOpenChange={(o) => !o && setDlg(null)} claim={c} onDone={refresh} />
    </>
  );
}

export default function ClaimPage() {
  return (
    <RequirePermission anyOf={['insurance.read', 'billing.read']}>
      <Suspense>
        <Claim />
      </Suspense>
    </RequirePermission>
  );
}
