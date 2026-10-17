'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Edit, FileCheck2, FileText, Plus, Send, ShieldCheck, Stethoscope } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Suspense, useState } from 'react';
import { toast } from 'sonner';
import { DataTable } from '@/components/data-table';
import { ClaimDialog, ClaimStatusBadge, ContactDialog, DecisionDialog, PolicyDialog, PolicyStateBadge, PreAuthDialog, ProviderDialog, ReferralDialog, ReferralStatusBadge } from '@/components/insurance/dialogs';
import { EmptyState, PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Stat } from '@/components/stat';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useUrlState } from '@/hooks/use-url-state';
import { api, qs } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { InsuranceClaim, InsurancePolicy, InsuranceProvider, PreAuthRow, Referral, ReferralContact } from '@/lib/types';
import { cn } from '@/lib/utils';

const TABS = [
  { key: 'claims', label: 'Claims' },
  { key: 'preauth', label: 'Pre-authorisations' },
  { key: 'policies', label: 'Policies' },
  { key: 'referrals', label: 'Referrals' },
  { key: 'insurers', label: 'Insurers' },
  { key: 'specialists', label: 'Specialists' },
];

function Filters({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="flex flex-wrap gap-1 border-b p-3">
      {options.map(([k, l]) => <button key={k} onClick={() => onChange(k)} className={cn('rounded-md px-3 py-1.5 text-sm', value === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}>{l}</button>)}
    </div>
  );
}

function Claims() {
  const router = useRouter();
  const { can, currency } = useSession();
  const url = useUrlState();
  const status = url.get('status', 'OPEN');
  const statusParam = status === 'OPEN' ? 'DRAFT,SUBMITTED,QUERIED,APPROVED,PARTIALLY_APPROVED' : status === 'ALL' ? undefined : status;
  const q = useQuery({ queryKey: ['claims', status], queryFn: () => api.get<InsuranceClaim[]>(`/insurance/claims${qs({ status: statusParam })}`) });
  return (
    <Card>
      <Filters value={status} onChange={(v) => url.set({ status: v })} options={[['OPEN', 'Open'], ['SUBMITTED', 'Awaiting insurer'], ['QUERIED', 'Queried'], ['PAID', 'Paid'], ['REJECTED', 'Rejected'], ['ALL', 'All']]} />
      <DataTable
        query={q}
        rowKey={(c) => c.id}
        onRowClick={(c) => router.push(`/insurance/claims/${c.id}`)}
        empty={<EmptyState icon={FileText} title="No claims" description={can('insurance.write') ? 'Create claims with New claim, or from an animal’s Insurance tab.' : 'Claims appear here once a colleague with insurance access creates them.'} />}
        columns={[
          { key: 'claim', header: 'Claim', cell: (c) => <div><Link href={`/insurance/claims/${c.id}`} className="font-medium hover:underline">{c.condition}</Link><p className="text-xs text-muted-foreground">{c.claimNo} · {c.patient.name} · {c.client.displayName}</p></div> },
          { key: 'ins', header: 'Insurer', cell: (c) => <span className="text-sm">{c.policy.provider.name}<span className="block text-xs text-muted-foreground">{c.policy.policyNumber}</span></span> },
          { key: 'amt', header: 'Claimed / approved / paid', cell: (c) => <span className="text-sm tabular">{fmtMoney(c.claimedMinor, currency)}{c.approvedMinor != null ? ` / ${fmtMoney(c.approvedMinor, currency)}` : ''}{c.paidMinor ? ` / ${fmtMoney(c.paidMinor, currency)}` : ''}</span> },
          { key: 'sub', header: 'Submitted', cell: (c) => <span className="text-sm">{fmtDate(c.submittedAt)}</span> },
          { key: 'st', header: 'Status', cell: (c) => <ClaimStatusBadge status={c.status} /> },
        ]}
      />
    </Card>
  );
}

function PreAuths() {
  const qc = useQueryClient();
  const { can, currency } = useSession();
  const q = useQuery({ queryKey: ['preauths'], queryFn: () => api.get<PreAuthRow[]>('/insurance/pre-authorisations') });
  const [deciding, setDeciding] = useState<PreAuthRow | null>(null);
  const submit = useMutation({ mutationFn: (id: string) => api.post(`/insurance/pre-authorisations/${id}/submit`), onSuccess: () => { toast.success('Marked as submitted'); qc.invalidateQueries({ queryKey: ['preauths'] }); }, onError: (e: Error) => toast.error(e.message) });
  return (
    <Card>
      <DataTable
        query={q}
        rowKey={(r) => r.id}
        empty={<EmptyState icon={FileCheck2} title="No pre-authorisations" />}
        columns={[
          { key: 'p', header: 'Procedure', cell: (r) => <div><span className="font-medium">{r.procedure}</span><p className="text-xs text-muted-foreground">{r.preAuthNo} · {r.policy.patient.name} · {r.policy.provider.name}</p></div> },
          { key: 'e', header: 'Estimate / approved', cell: (r) => <span className="text-sm tabular">{fmtMoney(r.estimateMinor, currency)}{r.approvedMinor != null ? ` / ${fmtMoney(r.approvedMinor, currency)}` : ''}</span> },
          { key: 'ref', header: 'Reference', cell: (r) => <span className="text-xs text-muted-foreground">{r.insurerReference ?? '—'}{r.decisionNotes ? ` · ${r.decisionNotes}` : ''}</span> },
          { key: 's', header: 'Status', cell: (r) => <ClaimStatusBadge status={r.status} /> },
          {
            key: 'a', header: '', cell: (r) => can('insurance.write') && (
              <span className="flex justify-end gap-1">
                {r.status === 'DRAFT' && <Button size="sm" variant="outline" onClick={() => submit.mutate(r.id)}>Mark submitted</Button>}
                {r.status === 'SUBMITTED' && <Button size="sm" variant="outline" onClick={() => setDeciding(r)}>Record decision</Button>}
              </span>
            ),
          },
        ]}
      />
      {deciding && <DecisionDialog open={!!deciding} onOpenChange={(o) => !o && setDeciding(null)} url={`/insurance/pre-authorisations/${deciding.id}/decision`} kind="preauth" maxMinor={deciding.estimateMinor} onDone={() => qc.invalidateQueries({ queryKey: ['preauths'] })} />}
    </Card>
  );
}

function Policies() {
  const { can, currency } = useSession();
  const q = useQuery({ queryKey: ['policies', 'all'], queryFn: () => api.get<InsurancePolicy[]>('/insurance/policies') });
  return (
    <Card>
      <DataTable
        query={q}
        rowKey={(p) => p.id}
        empty={<EmptyState icon={ShieldCheck} title="No policies recorded" description={can('insurance.write') ? 'Add a policy from the animal’s Insurance tab.' : 'Policies appear here once they are added on an animal’s Insurance tab.'} />}
        columns={[
          { key: 'a', header: 'Animal', cell: (p) => <div><Link href={`/patients/${p.patient.id}?tab=insurance`} className="font-medium hover:underline">{p.patient.name}</Link><p className="text-xs text-muted-foreground">{p.patient.species.name} · {p.client.displayName}</p></div> },
          { key: 'i', header: 'Insurer', cell: (p) => <span className="text-sm">{p.provider.name}<span className="block text-xs text-muted-foreground">{p.policyNumber}{p.planName ? ` · ${p.planName}` : ''}</span></span> },
          { key: 'd', header: 'Cover', cell: (p) => <span className="text-sm">{fmtDate(p.startDate)} → {p.endDate ? fmtDate(p.endDate) : 'open'}{p.excessMinor != null && <span className="block text-xs text-muted-foreground">excess {fmtMoney(p.excessMinor, currency)}</span>}</span> },
          { key: 's', header: 'Status', cell: (p) => <PolicyStateBadge state={p.state} /> },
        ]}
      />
    </Card>
  );
}

function Referrals() {
  const router = useRouter();
  const url = useUrlState();
  const status = url.get('status', 'OPEN');
  const q = useQuery({ queryKey: ['referrals', status], queryFn: () => api.get<Referral[]>(`/referrals${qs({ status: status === 'ALL' ? undefined : status })}`) });
  return (
    <Card>
      <Filters value={status} onChange={(v) => url.set({ status: v })} options={[['OPEN', 'Open'], ['COMPLETED', 'Completed'], ['ALL', 'All']]} />
      <DataTable
        query={q}
        rowKey={(r) => r.id}
        onRowClick={(r) => router.push(`/insurance/referrals/${r.id}`)}
        empty={<EmptyState icon={Send} title="No referrals" />}
        columns={[
          { key: 'p', header: 'Animal', cell: (r) => <div><span className="font-medium">{r.patient.name}</span><p className="text-xs text-muted-foreground">{r.referralNo} · {r.client.displayName}</p></div> },
          { key: 'd', header: 'Referral', cell: (r) => <span className="text-sm">{r.direction === 'OUTGOING' ? 'To' : 'From'} {r.contact ? [r.contact.name, r.contact.practice].filter(Boolean).join(', ') : r.externalVet}<span className="block text-xs text-muted-foreground">{r.reason}</span></span> },
          { key: 'u', header: 'Urgency', cell: (r) => (r.urgency === 'ROUTINE' ? <span className="text-xs text-muted-foreground">Routine</span> : <Badge variant={r.urgency === 'EMERGENCY' ? 'destructive' : 'warning'}>{r.urgency === 'EMERGENCY' ? 'Emergency' : 'Urgent'}</Badge>) },
          { key: 'w', header: 'Date', cell: (r) => <span className="text-sm">{fmtDate(r.sentAt ?? r.createdAt)}</span> },
          { key: 's', header: 'Status', cell: (r) => <ReferralStatusBadge status={r.status} /> },
        ]}
      />
    </Card>
  );
}

function Insurers() {
  const { can } = useSession();
  const q = useQuery({ queryKey: ['insurers', 'all'], queryFn: () => api.get<InsuranceProvider[]>('/insurance/providers?all=true') });
  const [dlg, setDlg] = useState<{ open: boolean; p: InsuranceProvider | null }>({ open: false, p: null });
  return (
    <Card>
      <div className="flex justify-end border-b p-3">{can('insurance.write') && <Button size="sm" onClick={() => setDlg({ open: true, p: null })}><Plus /> New insurer</Button>}</div>
      <DataTable
        query={q}
        rowKey={(p) => p.id}
        empty={<EmptyState icon={Building2} title="No insurers yet" />}
        columns={[
          { key: 'n', header: 'Insurer', cell: (p) => <span className="font-medium">{p.name}{!p.isActive && <Badge variant="secondary" className="ml-2">Inactive</Badge>}</span> },
          { key: 'c', header: 'Contact', cell: (p) => <span className="text-sm">{[p.phone, p.claimsEmail ?? p.email].filter(Boolean).join(' · ') || '—'}</span> },
          { key: 'e', header: '', cell: (p) => can('insurance.write') && <Button size="icon-sm" variant="ghost" aria-label={`Edit ${p.name}`} onClick={() => setDlg({ open: true, p })}><Edit /></Button> },
        ]}
      />
      <ProviderDialog open={dlg.open} onOpenChange={(open) => setDlg((d) => ({ ...d, open }))} provider={dlg.p} />
    </Card>
  );
}

function Specialists() {
  const { can } = useSession();
  const q = useQuery({ queryKey: ['referral-contacts', 'all'], queryFn: () => api.get<ReferralContact[]>('/referral-contacts?all=true') });
  const [dlg, setDlg] = useState<{ open: boolean; c: ReferralContact | null }>({ open: false, c: null });
  return (
    <Card>
      <div className="flex justify-end border-b p-3">{can('insurance.write') && <Button size="sm" onClick={() => setDlg({ open: true, c: null })}><Plus /> New specialist</Button>}</div>
      <DataTable
        query={q}
        rowKey={(c) => c.id}
        empty={<EmptyState icon={Stethoscope} title="No specialists yet" description="Add the referral practices and specialists you work with." />}
        columns={[
          { key: 'n', header: 'Name', cell: (c) => <div><span className="font-medium">{c.name}</span>{!c.isActive && <Badge variant="secondary" className="ml-2">Inactive</Badge>}<p className="text-xs text-muted-foreground">{[c.practice, c.specialty].filter(Boolean).join(' · ')}</p></div> },
          { key: 'c', header: 'Contact', cell: (c) => <span className="text-sm">{[c.phone, c.email].filter(Boolean).join(' · ') || '—'}</span> },
          { key: 'e', header: '', cell: (c) => can('insurance.write') && <Button size="icon-sm" variant="ghost" aria-label={`Edit ${c.name}`} onClick={() => setDlg({ open: true, c })}><Edit /></Button> },
        ]}
      />
      <ContactDialog open={dlg.open} onOpenChange={(open) => setDlg((d) => ({ ...d, open }))} contact={dlg.c} />
    </Card>
  );
}

function Insurance() {
  const { can, currency } = useSession();
  const url = useUrlState();
  const tab = url.get('tab', 'claims');
  const [dlg, setDlg] = useState<null | 'claim' | 'preauth' | 'policy' | 'referral'>(null);
  const policies = useQuery({ queryKey: ['policies', 'all'], queryFn: () => api.get<InsurancePolicy[]>('/insurance/policies'), enabled: dlg === 'claim' || dlg === 'preauth' });
  const dash = useQuery({ queryKey: ['dashboard', 'insurance'], queryFn: () => api.get<{ widgets: { insurance?: { claimsAwaitingDecision: number; claimsQueried: number; insurerOwedMinor: number; openReferrals: number } } }>('/dashboard') });
  const w = dash.data?.widgets.insurance;
  return (
    <>
      <PageHeader
        title="Insurance & referrals"
        help="insurance"
        description="Policies, pre-authorisations and claims with insurer payments, and referrals to and from specialists."
        actions={can('insurance.write') && (
          <>
            <Button size="sm" variant="outline" onClick={() => setDlg('referral')}><Send /> New referral</Button>
            <Button size="sm" variant="outline" onClick={() => setDlg('preauth')}><FileCheck2 /> Pre-authorisation</Button>
            <Button size="sm" onClick={() => setDlg('claim')}><FileText /> New claim</Button>
          </>
        )}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Awaiting insurer" value={w?.claimsAwaitingDecision ?? '—'} icon={FileText} href="/insurance?tab=claims&status=SUBMITTED" />
        <Stat label="Queries to answer" value={w?.claimsQueried ?? '—'} icon={FileText} tone={w?.claimsQueried ? 'warning' : 'default'} href="/insurance?tab=claims&status=QUERIED" />
        <Stat label="Owed by insurers" value={w ? fmtMoney(w.insurerOwedMinor, currency) : '—'} icon={ShieldCheck} />
        <Stat label="Open referrals" value={w?.openReferrals ?? '—'} icon={Send} href="/insurance?tab=referrals" />
      </div>
      <div className="mb-4 flex gap-1 overflow-x-auto border-b" role="tablist">
        {TABS.map((t) => <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => url.set({ tab: t.key, status: null })} className={cn('-mb-px whitespace-nowrap border-b-2 px-3 pb-2 pt-1 text-sm font-medium', tab === t.key ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>{t.label}</button>)}
      </div>
      {tab === 'preauth' ? <PreAuths /> : tab === 'policies' ? <Policies /> : tab === 'referrals' ? <Referrals /> : tab === 'insurers' ? <Insurers /> : tab === 'specialists' ? <Specialists /> : <Claims />}
      <ClaimDialog open={dlg === 'claim'} onOpenChange={(o) => !o && setDlg(null)} policies={policies.data ?? []} />
      <PreAuthDialog open={dlg === 'preauth'} onOpenChange={(o) => !o && setDlg(null)} policies={policies.data ?? []} />
      <PolicyDialog open={dlg === 'policy'} onOpenChange={(o) => !o && setDlg(null)} />
      <ReferralDialog open={dlg === 'referral'} onOpenChange={(o) => !o && setDlg(null)} />
    </>
  );
}

export default function InsurancePage() {
  return (
    <RequirePermission anyOf={['insurance.read']}>
      <Suspense>
        <Insurance />
      </Suspense>
    </RequirePermission>
  );
}
