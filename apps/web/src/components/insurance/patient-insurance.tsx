'use client';
import { useQuery } from '@tanstack/react-query';
import { FileText, Plus, Send, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { ClaimDialog, ClaimStatusBadge, PolicyDialog, PolicyStateBadge, ReferralDialog, ReferralStatusBadge } from './dialogs';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { InsuranceClaim, InsurancePolicy, Referral } from '@/lib/types';

/** Empty card body with the next step, so an empty tab never leaves staff guessing. */
function Empty({ icon: Icon, title, hint, action }: { icon: typeof FileText; title: string; hint: string; action?: React.ReactNode }) {
  return (
    <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
      <Icon className="h-6 w-6 text-muted-foreground" />
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-sm text-xs text-muted-foreground">{hint}</p>
      {action && <div className="mt-1">{action}</div>}
    </CardContent>
  );
}

/** Policies, claims and referrals for one animal. */
export function PatientInsurance({ patient, active }: { patient: { id: string; name: string }; active: boolean }) {
  const { can, currency } = useSession();
  const canWrite = can('insurance.write');
  const policies = useQuery({ queryKey: ['policies', 'patient', patient.id], queryFn: () => api.get<InsurancePolicy[]>(`/insurance/policies?patientId=${patient.id}`) });
  const claims = useQuery({ queryKey: ['claims', 'patient', patient.id], queryFn: () => api.get<InsuranceClaim[]>(`/insurance/claims?patientId=${patient.id}`) });
  const referrals = useQuery({ queryKey: ['referrals', 'patient', patient.id], queryFn: () => api.get<Referral[]>(`/referrals?patientId=${patient.id}`) });
  const [dlg, setDlg] = useState<null | 'policy' | 'claim' | 'referral'>(null);
  const [editing, setEditing] = useState<InsurancePolicy | null>(null);
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Insurance policies</CardTitle>
          {canWrite && active && !!policies.data?.length && <Button size="sm" variant="outline" onClick={() => { setEditing(null); setDlg('policy'); }}><Plus /> Add policy</Button>}
        </CardHeader>
        {policies.data?.length ? (
          <ul className="divide-y text-sm">
            {policies.data.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                <button type="button" className="min-w-0 flex-1 text-left" disabled={!canWrite} onClick={() => { setEditing(p); setDlg('policy'); }}>
                  <p className="font-medium">{p.provider.name} · {p.policyNumber}</p>
                  <p className="text-xs text-muted-foreground">{p.planName ? `${p.planName} · ` : ''}{fmtDate(p.startDate)} → {p.endDate ? fmtDate(p.endDate) : 'open'}{p.excessMinor != null ? ` · excess ${fmtMoney(p.excessMinor, currency)}` : ''}</p>
                </button>
                <PolicyStateBadge state={p.state} />
              </li>
            ))}
          </ul>
        ) : policies.isLoading ? null : (
          <Empty
            icon={ShieldCheck}
            title="No insurance recorded"
            hint={canWrite ? `Add ${patient.name}’s policy to make claims and check cover.` : 'A colleague with insurance access can add the policy.'}
            action={canWrite && active && <Button size="sm" onClick={() => { setEditing(null); setDlg('policy'); }}><Plus /> Add policy</Button>}
          />
        )}
      </Card>
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Claims</CardTitle>
          {canWrite && !!policies.data?.length && !!claims.data?.length && <Button size="sm" variant="outline" onClick={() => setDlg('claim')}><FileText /> New claim</Button>}
        </CardHeader>
        {claims.data?.length ? (
          <ul className="divide-y text-sm">
            {claims.data.map((c) => (
              <li key={c.id}>
                <Link href={`/insurance/claims/${c.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40">
                  <div className="min-w-0 flex-1"><p className="font-medium">{c.condition}</p><p className="text-xs text-muted-foreground">{c.claimNo} · {c.policy.provider.name} · {fmtMoney(c.claimedMinor, currency)}</p></div>
                  <ClaimStatusBadge status={c.status} />
                </Link>
              </li>
            ))}
          </ul>
        ) : claims.isLoading || policies.isLoading ? null : (
          <Empty
            icon={FileText}
            title="No claims"
            hint={!canWrite ? 'Claims appear here once a colleague with insurance access creates them.' : policies.data?.length ? 'Claim issued invoices against the policy.' : 'Add a policy first, then claim issued invoices against it.'}
            action={canWrite && (policies.data?.length ? <Button size="sm" onClick={() => setDlg('claim')}><FileText /> New claim</Button> : active && <Button size="sm" variant="outline" onClick={() => { setEditing(null); setDlg('policy'); }}><Plus /> Add policy</Button>)}
          />
        )}
      </Card>
      <Card className="xl:col-span-2">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Referrals</CardTitle>
          {canWrite && !!referrals.data?.length && <Button size="sm" variant="outline" onClick={() => setDlg('referral')}><Send /> New referral</Button>}
        </CardHeader>
        {referrals.data?.length ? (
          <ul className="divide-y text-sm">
            {referrals.data.map((r) => (
              <li key={r.id}>
                <Link href={`/insurance/referrals/${r.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40">
                  <div className="min-w-0 flex-1"><p className="font-medium">{r.direction === 'OUTGOING' ? 'To' : 'From'} {r.contact ? [r.contact.name, r.contact.practice].filter(Boolean).join(', ') : r.externalVet}</p><p className="text-xs text-muted-foreground">{r.referralNo} · {r.reason}</p></div>
                  <ReferralStatusBadge status={r.status} />
                </Link>
              </li>
            ))}
          </ul>
        ) : referrals.isLoading ? null : (
          <Empty
            icon={Send}
            title="No referrals"
            hint={canWrite ? `Refer ${patient.name} to a specialist, or record a referral you received.` : 'Referrals to and from specialists appear here.'}
            action={canWrite && <Button size="sm" onClick={() => setDlg('referral')}><Send /> New referral</Button>}
          />
        )}
      </Card>
      <PolicyDialog open={dlg === 'policy'} onOpenChange={(o) => !o && setDlg(null)} patient={patient} policy={editing} />
      <ClaimDialog open={dlg === 'claim'} onOpenChange={(o) => !o && setDlg(null)} policies={policies.data ?? []} />
      <ReferralDialog open={dlg === 'referral'} onOpenChange={(o) => !o && setDlg(null)} patient={patient} />
    </div>
  );
}
