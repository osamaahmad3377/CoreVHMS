'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { enumLabel, fromMinor, toMinor, type Paginated } from '@vcms/shared';
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
import { fmtDate, fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { InsuranceClaim, InsurancePolicy, InsuranceProvider, Invoice, Referral, ReferralContact } from '@/lib/types';
import { localToday } from '@/lib/time';

// Claim and referral statuses get their own wording here (the shared labels are used across modules).
const CLAIM_LABEL: Record<string, string> = { DRAFT: 'Draft', SUBMITTED: 'Submitted', QUERIED: 'Query from insurer', APPROVED: 'Approved', PARTIALLY_APPROVED: 'Partly approved', REJECTED: 'Rejected', DECLINED: 'Declined', PAID: 'Paid', CLOSED: 'Closed' };
const CLAIM_VARIANT: Record<string, BadgeProps['variant']> = { DRAFT: 'secondary', SUBMITTED: 'info', QUERIED: 'warning', APPROVED: 'success', PARTIALLY_APPROVED: 'success', REJECTED: 'destructive', DECLINED: 'destructive', PAID: 'default', CLOSED: 'secondary' };
export function ClaimStatusBadge({ status }: { status: string }) {
  return <Badge variant={CLAIM_VARIANT[status] ?? 'secondary'}>{CLAIM_LABEL[status] ?? enumLabel(status)}</Badge>;
}
const REF_LABEL: Record<string, string> = { DRAFT: 'Draft', SENT: 'Sent', RECEIVED: 'Received', ACCEPTED: 'Accepted', COMPLETED: 'Completed', DECLINED: 'Declined', CANCELLED: 'Cancelled' };
const REF_VARIANT: Record<string, BadgeProps['variant']> = { DRAFT: 'secondary', SENT: 'info', RECEIVED: 'info', ACCEPTED: 'warning', COMPLETED: 'success', DECLINED: 'destructive', CANCELLED: 'secondary' };
export function ReferralStatusBadge({ status }: { status: string }) {
  return <Badge variant={REF_VARIANT[status] ?? 'secondary'}>{REF_LABEL[status] ?? enumLabel(status)}</Badge>;
}
export function PolicyStateBadge({ state }: { state: string }) {
  return <Badge variant={state === 'ACTIVE' ? 'success' : state === 'NOT_STARTED' ? 'info' : 'secondary'}>{state === 'ACTIVE' ? 'Active' : state === 'NOT_STARTED' ? 'Not started' : enumLabel(state)}</Badge>;
}

const money = (v: string, currency: string) => (v.trim() ? toMinor(v, currency) : null);

export function ProviderDialog({ open, onOpenChange, provider }: { open: boolean; onOpenChange: (o: boolean) => void; provider?: InsuranceProvider | null }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: '', phone: '', email: '', claimsEmail: '', website: '', notes: '', isActive: true });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setError(null); setF({ name: provider?.name ?? '', phone: provider?.phone ?? '', email: provider?.email ?? '', claimsEmail: provider?.claimsEmail ?? '', website: provider?.website ?? '', notes: provider?.notes ?? '', isActive: provider?.isActive ?? true }); } }, [open, provider]);
  const m = useMutation({
    mutationFn: () => (provider ? api.patch(`/insurance/providers/${provider.id}`, f) : api.post('/insurance/providers', f)),
    onSuccess: () => { toast.success('Insurer saved'); qc.invalidateQueries({ queryKey: ['insurers'] }); onOpenChange(false); },
    onError: (e: Error) => setError(e.message),
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{provider ? 'Edit insurer' : 'New insurer'}</DialogTitle></DialogHeader>
        {error && <FormError message={error} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" htmlFor="ip-name" required className="sm:col-span-2"><Input id="ip-name" value={f.name} maxLength={160} onChange={set('name')} /></Field>
          <Field label="Phone" htmlFor="ip-phone"><Input id="ip-phone" value={f.phone} onChange={set('phone')} /></Field>
          <Field label="Claims email" htmlFor="ip-claims"><Input id="ip-claims" type="email" value={f.claimsEmail} onChange={set('claimsEmail')} /></Field>
          <Field label="General email" htmlFor="ip-email"><Input id="ip-email" type="email" value={f.email} onChange={set('email')} /></Field>
          <Field label="Website" htmlFor="ip-web"><Input id="ip-web" value={f.website} maxLength={200} onChange={set('website')} /></Field>
          <Field label="Notes" htmlFor="ip-notes" className="sm:col-span-2"><Textarea id="ip-notes" value={f.notes} maxLength={1000} onChange={set('notes')} /></Field>
          {provider && <label className="flex items-center gap-2 text-sm"><Checkbox checked={f.isActive} onCheckedChange={(v) => setF({ ...f, isActive: !!v })} /> Active</label>}
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button loading={m.isPending} disabled={!f.name.trim()} onClick={() => { setError(null); m.mutate(); }}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PolicyDialog({ open, onOpenChange, patient, policy }: { open: boolean; onOpenChange: (o: boolean) => void; patient?: { id: string; name: string } | null; policy?: InsurancePolicy | null }) {
  const qc = useQueryClient();
  const { currency } = useSession();
  const providers = useQuery({ queryKey: ['insurers'], queryFn: () => api.get<InsuranceProvider[]>('/insurance/providers'), enabled: open });
  const [p, setP] = useState<PickedPatient | null>(null);
  const [f, setF] = useState({ providerId: '', policyNumber: '', planName: '', startDate: '', endDate: '', excess: '', coverLimit: '', coPayPercent: '', exclusions: '', notes: '', status: 'ACTIVE' });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setError(null);
    setP(null);
    setF({
      providerId: policy?.providerId ?? '', policyNumber: policy?.policyNumber ?? '', planName: policy?.planName ?? '', startDate: policy?.startDate.slice(0, 10) ?? '', endDate: policy?.endDate?.slice(0, 10) ?? '',
      excess: policy?.excessMinor != null ? fromMinor(policy.excessMinor, currency) : '', coverLimit: policy?.coverLimitMinor != null ? fromMinor(policy.coverLimitMinor, currency) : '', coPayPercent: policy?.coPayPercent?.toString() ?? '',
      exclusions: policy?.exclusions ?? '', notes: policy?.notes ?? '', status: policy?.status ?? 'ACTIVE',
    });
  }, [open, policy, currency]);
  const target = patient ?? p;
  const m = useMutation({
    mutationFn: () => {
      const common = { planName: f.planName || null, endDate: f.endDate || null, excessMinor: money(f.excess, currency), coverLimitMinor: money(f.coverLimit, currency), coPayPercent: f.coPayPercent || null, exclusions: f.exclusions || null, notes: f.notes || null };
      return policy ? api.patch(`/insurance/policies/${policy.id}`, { ...common, status: f.status }) : api.post('/insurance/policies', { ...common, providerId: f.providerId, patientId: target?.id, policyNumber: f.policyNumber, startDate: f.startDate });
    },
    onSuccess: () => { toast.success('Policy saved'); qc.invalidateQueries({ queryKey: ['policies'] }); onOpenChange(false); },
    onError: (e: Error) => setError(e.message),
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader><DialogTitle>{policy ? `Policy ${policy.policyNumber}` : 'Add insurance policy'}</DialogTitle></DialogHeader>
        {error && <FormError message={error} />}
        <div className="grid gap-3 sm:grid-cols-2">
          {!policy && <Field label="Animal" htmlFor="pol-patient" required className="sm:col-span-2">{patient ? <p className="text-sm font-medium">{patient.name}</p> : <PatientPicker id="pol-patient" value={p} onChange={setP} />}</Field>}
          <Field label="Insurer" htmlFor="pol-prov" required>
            <NativeSelect id="pol-prov" value={f.providerId} disabled={!!policy} onChange={set('providerId')}><option value="">{providers.data?.length === 0 ? 'Add an insurer first' : 'Choose…'}</option>{(providers.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</NativeSelect>
          </Field>
          <Field label="Policy number" htmlFor="pol-num" required><Input id="pol-num" value={f.policyNumber} disabled={!!policy} maxLength={60} onChange={set('policyNumber')} /></Field>
          <Field label="Plan" htmlFor="pol-plan"><Input id="pol-plan" value={f.planName} maxLength={120} onChange={set('planName')} /></Field>
          {policy && <Field label="Status" htmlFor="pol-status"><NativeSelect id="pol-status" value={f.status} onChange={set('status')}><option value="ACTIVE">Active</option><option value="EXPIRED">Expired</option><option value="CANCELLED">Cancelled</option></NativeSelect></Field>}
          <Field label="Start" htmlFor="pol-start" required><Input id="pol-start" type="date" disabled={!!policy} value={f.startDate} onChange={set('startDate')} /></Field>
          <Field label="End" htmlFor="pol-end"><Input id="pol-end" type="date" value={f.endDate} onChange={set('endDate')} /></Field>
          <Field label="Excess" htmlFor="pol-excess" help="The amount the client pays first on each claim before the insurer pays anything."><Input id="pol-excess" inputMode="decimal" value={f.excess} onChange={set('excess')} /></Field>
          <Field label="Cover limit" htmlFor="pol-limit"><Input id="pol-limit" inputMode="decimal" value={f.coverLimit} onChange={set('coverLimit')} /></Field>
          <Field label="Co-pay %" htmlFor="pol-copay" help="The share of each claim the client pays themselves. With 20%, the insurer pays 80% and the client pays 20%."><Input id="pol-copay" inputMode="numeric" value={f.coPayPercent} onChange={set('coPayPercent')} /></Field>
          <Field label="Exclusions" htmlFor="pol-excl" className="sm:col-span-2"><Textarea id="pol-excl" value={f.exclusions} maxLength={2000} onChange={set('exclusions')} placeholder="e.g. Pre-existing skin condition" /></Field>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button loading={m.isPending} disabled={!policy && (!target || !f.providerId || !f.policyNumber.trim() || !f.startDate)} onClick={() => { setError(null); m.mutate(); }}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** New claim against a policy: the issued invoices being claimed, condition and treatment period. */
export function ClaimDialog({ open, onOpenChange, policies }: { open: boolean; onOpenChange: (o: boolean) => void; policies: InsurancePolicy[] }) {
  const router = useRouter();
  const { currency, can } = useSession();
  const [f, setF] = useState({ policyId: '', condition: '', treatmentFrom: '', treatmentTo: '', payee: 'CLINIC', clinicalSummary: '' });
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const policy = policies.find((x) => x.id === f.policyId);
  useEffect(() => { if (open) { setError(null); setPicked([]); const first = policies.find((x) => x.state === 'ACTIVE'); setF({ policyId: first?.id ?? '', condition: '', treatmentFrom: '', treatmentTo: localToday(), payee: 'CLINIC', clinicalSummary: '' }); } }, [open, policies]);
  const invoices = useQuery({
    queryKey: ['invoices', 'claimable', policy?.client.id],
    queryFn: async () => (await api.get<Paginated<Invoice>>(`/invoices${qs({ clientId: policy!.client.id, pageSize: 100 })}`)).data.filter((i) => ['ISSUED', 'PARTIALLY_PAID', 'PAID'].includes(i.status)),
    enabled: open && !!policy && can('billing.read'),
  });
  const summary = useQuery({ queryKey: ['draft-summary', policy?.patient.id], queryFn: () => api.get<{ text: string }>(`/referrals/draft-summary?patientId=${policy!.patient.id}`), enabled: open && !!policy && can('clinical.read') });
  useEffect(() => { if (summary.data && !f.clinicalSummary) setF((x) => ({ ...x, clinicalSummary: summary.data!.text })); }, [summary.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = (invoices.data ?? []).filter((i) => picked.includes(i.id)).reduce((n, i) => n + i.totalMinor, 0);
  const m = useMutation({
    mutationFn: () => api.post<InsuranceClaim>('/insurance/claims', { ...f, clinicalSummary: f.clinicalSummary || null, invoices: picked.map((invoiceId) => ({ invoiceId })) }),
    onSuccess: (c) => { toast.success(`Claim ${c.claimNo} created`); onOpenChange(false); router.push(`/insurance/claims/${c.id}`); },
    onError: (e: Error) => setError(e.message),
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader><DialogTitle>New insurance claim</DialogTitle><DialogDescription>Choose the invoices being claimed. The clinical summary is pre-filled from signed records — check it before submitting.</DialogDescription></DialogHeader>
        {error && <FormError message={error} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Policy" htmlFor="cl-policy" required className="sm:col-span-2">
            <NativeSelect id="cl-policy" value={f.policyId} onChange={set('policyId')}><option value="">Choose…</option>{policies.map((x) => <option key={x.id} value={x.id}>{x.provider.name} {x.policyNumber} — {x.patient.name}{x.state !== 'ACTIVE' ? ` (${x.state.toLowerCase()})` : ''}</option>)}</NativeSelect>
          </Field>
          <Field label="Condition / reason for claim" htmlFor="cl-cond" required className="sm:col-span-2"><Input id="cl-cond" value={f.condition} maxLength={300} onChange={set('condition')} /></Field>
          <Field label="Treatment from" htmlFor="cl-from" required><Input id="cl-from" type="date" value={f.treatmentFrom} onChange={set('treatmentFrom')} /></Field>
          <Field label="Treatment to" htmlFor="cl-to" required><Input id="cl-to" type="date" value={f.treatmentTo} onChange={set('treatmentTo')} /></Field>
          <Field label="Insurer pays" htmlFor="cl-payee"><NativeSelect id="cl-payee" value={f.payee} onChange={set('payee')}><option value="CLINIC">The clinic (direct claim)</option><option value="CLIENT">The client (reimbursement)</option></NativeSelect></Field>
          <div className="sm:col-span-2">
            <p className="mb-1 text-sm font-medium">Invoices</p>
            {!can('billing.read') ? <p className="text-xs text-muted-foreground">You need billing access to attach invoices; a colleague can add them before submitting.</p> : invoices.data?.length ? (
              <div className="max-h-48 overflow-y-auto rounded-md border">
                {invoices.data.map((i) => (
                  <label key={i.id} className="flex items-center gap-2 border-b px-3 py-2 text-sm last:border-0">
                    <Checkbox checked={picked.includes(i.id)} onCheckedChange={(v) => setPicked(v ? [...picked, i.id] : picked.filter((x) => x !== i.id))} />
                    <span className="flex-1">{i.invoiceNo} · {fmtDate(i.issuedAt)}{i.patient ? ` · ${i.patient.name}` : ''}</span>
                    <span className="tabular">{fmtMoney(i.totalMinor, currency)}</span>
                  </label>
                ))}
              </div>
            ) : <p className="text-xs text-muted-foreground">{policy ? 'No issued invoices for this client.' : 'Choose a policy first.'}</p>}
            {picked.length > 0 && <p className="mt-1 text-sm">Claiming <b>{fmtMoney(total, currency)}</b></p>}
          </div>
          <Field label="Clinical summary" htmlFor="cl-sum" className="sm:col-span-2"><Textarea id="cl-sum" rows={6} value={f.clinicalSummary} maxLength={10000} onChange={set('clinicalSummary')} /></Field>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button loading={m.isPending} disabled={!f.policyId || !f.condition.trim() || !f.treatmentFrom || !f.treatmentTo} onClick={() => { setError(null); m.mutate(); }}>Create draft claim</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PreAuthDialog({ open, onOpenChange, policies }: { open: boolean; onOpenChange: (o: boolean) => void; policies: InsurancePolicy[] }) {
  const qc = useQueryClient();
  const { currency } = useSession();
  const [f, setF] = useState({ policyId: '', procedure: '', estimate: '', notes: '' });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setError(null); setF({ policyId: policies.find((x) => x.state === 'ACTIVE')?.id ?? '', procedure: '', estimate: '', notes: '' }); } }, [open, policies]);
  const m = useMutation({
    mutationFn: () => api.post('/insurance/pre-authorisations', { policyId: f.policyId, procedure: f.procedure, estimateMinor: toMinor(f.estimate, currency), notes: f.notes || null }),
    onSuccess: () => { toast.success('Pre-authorisation drafted'); qc.invalidateQueries({ queryKey: ['preauths'] }); onOpenChange(false); },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Request pre-authorisation</DialogTitle><DialogDescription>Ask the insurer to approve planned treatment before it is done.</DialogDescription></DialogHeader>
        {error && <FormError message={error} />}
        <div className="grid gap-3">
          <Field label="Policy" htmlFor="pa-policy" required><NativeSelect id="pa-policy" value={f.policyId} onChange={(e) => setF({ ...f, policyId: e.target.value })}><option value="">Choose…</option>{policies.filter((x) => x.state === 'ACTIVE').map((x) => <option key={x.id} value={x.id}>{x.provider.name} {x.policyNumber} — {x.patient.name}</option>)}</NativeSelect></Field>
          <Field label="Planned procedure" htmlFor="pa-proc" required><Input id="pa-proc" value={f.procedure} maxLength={300} onChange={(e) => setF({ ...f, procedure: e.target.value })} /></Field>
          <Field label="Estimated cost" htmlFor="pa-est" required><Input id="pa-est" inputMode="decimal" value={f.estimate} onChange={(e) => setF({ ...f, estimate: e.target.value })} /></Field>
          <Field label="Notes" htmlFor="pa-notes"><Textarea id="pa-notes" value={f.notes} maxLength={2000} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button loading={m.isPending} disabled={!f.policyId || !f.procedure.trim() || !f.estimate} onClick={() => { setError(null); m.mutate(); }}>Save draft</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Record what the insurer decided (claims and pre-authorisations). */
export function DecisionDialog({ open, onOpenChange, url, kind, maxMinor, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; url: string; kind: 'claim' | 'preauth'; maxMinor: number; onDone: () => void }) {
  const { currency } = useSession();
  const options = kind === 'claim' ? ['APPROVED', 'PARTIALLY_APPROVED', 'QUERIED', 'REJECTED'] : ['APPROVED', 'PARTIALLY_APPROVED', 'DECLINED'];
  const [f, setF] = useState({ decision: 'APPROVED', approved: '', insurerReference: '', decisionNotes: '' });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setError(null); setF({ decision: 'APPROVED', approved: fromMinor(maxMinor, currency), insurerReference: '', decisionNotes: '' }); } }, [open, maxMinor, currency]);
  const needsAmount = f.decision === 'APPROVED' || f.decision === 'PARTIALLY_APPROVED';
  const m = useMutation({
    mutationFn: () => api.post(url, { decision: f.decision, approvedMinor: needsAmount ? toMinor(f.approved, currency) : null, insurerReference: f.insurerReference || null, decisionNotes: f.decisionNotes || null }),
    onSuccess: () => { toast.success('Decision recorded'); onOpenChange(false); onDone(); },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Insurer’s decision</DialogTitle></DialogHeader>
        {error && <FormError message={error} />}
        <div className="grid gap-3">
          <Field label="Decision" htmlFor="dc-dec"><NativeSelect id="dc-dec" value={f.decision} onChange={(e) => setF({ ...f, decision: e.target.value })}>{options.map((o) => <option key={o} value={o}>{CLAIM_LABEL[o]}</option>)}</NativeSelect></Field>
          {needsAmount && <Field label={`Approved amount (max ${fmtMoney(maxMinor, currency)})`} htmlFor="dc-amt" required><Input id="dc-amt" inputMode="decimal" value={f.approved} onChange={(e) => setF({ ...f, approved: e.target.value })} /></Field>}
          <Field label="Insurer reference" htmlFor="dc-ref"><Input id="dc-ref" value={f.insurerReference} maxLength={80} onChange={(e) => setF({ ...f, insurerReference: e.target.value })} /></Field>
          <Field label={needsAmount ? 'Notes' : 'What the insurer said'} htmlFor="dc-notes" required={!needsAmount}><Textarea id="dc-notes" value={f.decisionNotes} maxLength={2000} onChange={(e) => setF({ ...f, decisionNotes: e.target.value })} /></Field>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button loading={m.isPending} disabled={(needsAmount && !f.approved) || (!needsAmount && !f.decisionNotes.trim())} onClick={() => { setError(null); m.mutate(); }}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ClaimPaymentDialog({ open, onOpenChange, claim, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; claim: InsuranceClaim; onDone: () => void }) {
  const { currency } = useSession();
  const [f, setF] = useState({ amount: '', reference: '', key: '' });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setError(null); setF({ amount: fromMinor(claim.outstandingMinor, currency), reference: '', key: crypto.randomUUID() }); } }, [open, claim.outstandingMinor, currency]);
  const m = useMutation({
    mutationFn: () => api.post(`/insurance/claims/${claim.id}/payment`, { amountMinor: toMinor(f.amount, currency), reference: f.reference || null, idempotencyKey: f.key }),
    onSuccess: () => { toast.success(claim.payee === 'CLINIC' ? 'Payment recorded against the invoices' : 'Payment to client recorded'); onOpenChange(false); onDone(); },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Record insurer payment</DialogTitle><DialogDescription>{claim.payee === 'CLINIC' ? 'Posted as an insurance payment against the claimed invoices; anything over their balance becomes client credit.' : 'The insurer paid the client directly — this only updates the claim.'}</DialogDescription></DialogHeader>
        {error && <FormError message={error} />}
        <div className="grid gap-3">
          <Field label={`Amount (outstanding ${fmtMoney(claim.outstandingMinor, currency)})`} htmlFor="cp-amt" required><Input id="cp-amt" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="Payment reference" htmlFor="cp-ref"><Input id="cp-ref" value={f.reference} maxLength={120} onChange={(e) => setF({ ...f, reference: e.target.value })} placeholder="e.g. bank transfer reference" /></Field>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button loading={m.isPending} disabled={!f.amount} onClick={() => { setError(null); m.mutate(); }}>Record payment</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ContactDialog({ open, onOpenChange, contact }: { open: boolean; onOpenChange: (o: boolean) => void; contact?: ReferralContact | null }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: '', practice: '', specialty: '', email: '', phone: '', address: '', notes: '', isActive: true });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setError(null); setF({ name: contact?.name ?? '', practice: contact?.practice ?? '', specialty: contact?.specialty ?? '', email: contact?.email ?? '', phone: contact?.phone ?? '', address: contact?.address ?? '', notes: contact?.notes ?? '', isActive: contact?.isActive ?? true }); } }, [open, contact]);
  const m = useMutation({
    mutationFn: () => (contact ? api.patch(`/referral-contacts/${contact.id}`, f) : api.post('/referral-contacts', f)),
    onSuccess: () => { toast.success('Contact saved'); qc.invalidateQueries({ queryKey: ['referral-contacts'] }); onOpenChange(false); },
    onError: (e: Error) => setError(e.message),
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{contact ? 'Edit specialist' : 'New specialist / referral practice'}</DialogTitle></DialogHeader>
        {error && <FormError message={error} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" htmlFor="rc-name" required><Input id="rc-name" value={f.name} maxLength={160} onChange={set('name')} placeholder="Dr. …" /></Field>
          <Field label="Practice" htmlFor="rc-practice"><Input id="rc-practice" value={f.practice} maxLength={160} onChange={set('practice')} /></Field>
          <Field label="Specialty" htmlFor="rc-spec"><Input id="rc-spec" value={f.specialty} maxLength={120} onChange={set('specialty')} placeholder="e.g. Orthopaedics" /></Field>
          <Field label="Email" htmlFor="rc-email" hint="Referral letters can be emailed here"><Input id="rc-email" type="email" value={f.email} onChange={set('email')} /></Field>
          <Field label="Phone" htmlFor="rc-phone"><Input id="rc-phone" value={f.phone} onChange={set('phone')} /></Field>
          <Field label="Address" htmlFor="rc-addr"><Input id="rc-addr" value={f.address} maxLength={300} onChange={set('address')} /></Field>
          {contact && <label className="flex items-center gap-2 text-sm"><Checkbox checked={f.isActive} onCheckedChange={(v) => setF({ ...f, isActive: !!v })} /> Active</label>}
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button loading={m.isPending} disabled={!f.name.trim()} onClick={() => { setError(null); m.mutate(); }}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ReferralDialog({ open, onOpenChange, patient, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; patient?: { id: string; name: string } | null; /** Called instead of opening the referral's page, so a consultation stays on screen. */ onSaved?: (r: Referral) => void }) {
  const router = useRouter();
  const { can } = useSession();
  const contacts = useQuery({ queryKey: ['referral-contacts'], queryFn: () => api.get<ReferralContact[]>('/referral-contacts'), enabled: open });
  const [p, setP] = useState<PickedPatient | null>(null);
  const [f, setF] = useState({ direction: 'OUTGOING', contactId: '', externalVet: '', urgency: 'ROUTINE', reason: '', clinicalSummary: '', questions: '' });
  const [error, setError] = useState<string | null>(null);
  const target = patient ?? p;
  useEffect(() => { if (open) { setError(null); setP(null); setF({ direction: 'OUTGOING', contactId: '', externalVet: '', urgency: 'ROUTINE', reason: '', clinicalSummary: '', questions: '' }); } }, [open]);
  const summary = useQuery({ queryKey: ['draft-summary', target?.id], queryFn: () => api.get<{ text: string }>(`/referrals/draft-summary?patientId=${target!.id}`), enabled: open && !!target && f.direction === 'OUTGOING' && can('clinical.read') });
  useEffect(() => { if (summary.data && !f.clinicalSummary) setF((x) => ({ ...x, clinicalSummary: summary.data!.text })); }, [summary.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const m = useMutation({
    mutationFn: () => api.post<Referral>('/referrals', { ...f, patientId: target?.id, contactId: f.contactId || null, externalVet: f.externalVet || null, clinicalSummary: f.clinicalSummary || null, questions: f.questions || null }),
    onSuccess: (r) => { toast.success(`Referral ${r.referralNo} saved`); onOpenChange(false); if (onSaved) onSaved(r); else router.push(`/insurance/referrals/${r.id}`); },
    onError: (e: Error) => setError(e.message),
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const out = f.direction === 'OUTGOING';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader><DialogTitle>New referral</DialogTitle><DialogDescription>{out ? 'The clinical summary is pre-filled from signed records — edit it before sending.' : 'Record a patient referred to you by another vet.'}</DialogDescription></DialogHeader>
        {error && <FormError message={error} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Direction" htmlFor="rf-dir"><NativeSelect id="rf-dir" value={f.direction} onChange={set('direction')}><option value="OUTGOING">We are referring out</option><option value="INCOMING">Referred to us</option></NativeSelect></Field>
          <Field label="Urgency" htmlFor="rf-urg"><NativeSelect id="rf-urg" value={f.urgency} onChange={set('urgency')}><option value="ROUTINE">Routine</option><option value="URGENT">Urgent</option><option value="EMERGENCY">Emergency</option></NativeSelect></Field>
          <Field label="Animal" htmlFor="rf-patient" required className="sm:col-span-2">{patient ? <p className="text-sm font-medium">{patient.name}</p> : <PatientPicker id="rf-patient" value={p} onChange={setP} />}</Field>
          <Field label={out ? 'Refer to' : 'Referring practice (if in your contacts)'} htmlFor="rf-contact" required={out}>
            <NativeSelect id="rf-contact" value={f.contactId} onChange={set('contactId')}><option value="">{contacts.data?.length ? 'Choose…' : 'Add specialists under Insurance & referrals → Specialists'}</option>{(contacts.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}{c.practice ? `, ${c.practice}` : ''}{c.specialty ? ` (${c.specialty})` : ''}</option>)}</NativeSelect>
          </Field>
          {!out && <Field label="Referring vet / practice" htmlFor="rf-ext"><Input id="rf-ext" value={f.externalVet} maxLength={160} onChange={set('externalVet')} /></Field>}
          <Field label="Reason for referral" htmlFor="rf-reason" required className="sm:col-span-2"><Input id="rf-reason" value={f.reason} maxLength={500} onChange={set('reason')} /></Field>
          <Field label="Clinical summary" htmlFor="rf-sum" className="sm:col-span-2"><Textarea id="rf-sum" rows={7} value={f.clinicalSummary} maxLength={10000} onChange={set('clinicalSummary')} /></Field>
          {out && <Field label="Questions for the specialist" htmlFor="rf-q" className="sm:col-span-2"><Textarea id="rf-q" value={f.questions} maxLength={2000} onChange={set('questions')} /></Field>}
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button loading={m.isPending} disabled={!target || !f.reason.trim() || (out ? !f.contactId : !f.contactId && !f.externalVet.trim())} onClick={() => { setError(null); m.mutate(); }}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
