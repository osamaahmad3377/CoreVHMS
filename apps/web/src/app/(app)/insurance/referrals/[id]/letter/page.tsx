'use client';
import { useQuery } from '@tanstack/react-query';
import { enumLabel } from '@vcms/shared';
import { ArrowLeft, Printer } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ErrorState, LoadingRows } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import type { ClinicalSummary, Referral } from '@/lib/types';
import { LetterFooter, Letterhead } from '@/components/documents/letterhead';

interface Letter { referral: Referral; organization: { name: string; legalName: string | null; phone: string | null; email: string | null }; summary: ClinicalSummary }

function LetterView() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: ['referral-letter', id], queryFn: () => api.get<Letter>(`/referrals/${id}/letter`) });
  if (q.isLoading) return <LoadingRows />;
  if (q.error || !q.data) return <ErrorState error={q.error} />;
  const { referral: r, organization: org, summary } = q.data;
  const p = r.patient;
  // Same practice name in the letterhead and the sign-off.
  const practice = org.legalName ?? org.name;
  return (
    <>
      <div className="no-print mb-4 flex items-center justify-between">
        <Button variant="ghost" size="sm" asChild><Link href={`/insurance/referrals/${id}`}><ArrowLeft /> Back to referral</Link></Button>
        <Button size="sm" onClick={() => window.print()}><Printer /> Print</Button>
      </div>
      <article className="mx-auto max-w-3xl rounded-lg border bg-background p-10 text-sm leading-relaxed shadow-sm print:border-0 print:p-0 print:shadow-none">
        <div className="mb-8">
          <Letterhead
            clinic={org}
            aside={<><p className="font-semibold">Referral letter</p><p>{r.referralNo}</p><p className="text-muted-foreground">{fmtDate(r.sentAt ?? r.createdAt)}</p>{r.urgency !== 'ROUTINE' && <p className="font-semibold uppercase text-destructive">{r.urgency.toLowerCase()}</p>}</>}
          />
        </div>
        {r.contact && <p className="mb-6">{r.contact.name}<br />{r.contact.practice}{r.contact.address && <><br />{r.contact.address}</>}</p>}
        <p className="mb-4">Dear {r.contact?.name ?? 'colleague'},</p>
        <p className="mb-4">Thank you for seeing the following patient. {r.reason}.</p>
        <table className="mb-4"><tbody>
          <tr><th className="w-40 py-0.5 pr-3 text-left font-medium text-muted-foreground">Patient</th><td>{p.name} — {p.species.name}{p.breed?.name || p.breedText ? `, ${p.breed?.name ?? p.breedText}` : ''}</td></tr>
          <tr><th className="py-0.5 pr-3 text-left font-medium text-muted-foreground">Sex / born</th><td>{enumLabel(p.sex)}{p.dateOfBirth ? ` · ${fmtDate(p.dateOfBirth)}` : ''}</td></tr>
          {summary.weight && <tr><th className="py-0.5 pr-3 text-left font-medium text-muted-foreground">Weight</th><td>{summary.weight.weightKg} kg ({fmtDate(summary.weight.measuredAt)})</td></tr>}
          {p.identifiers[0] && <tr><th className="py-0.5 pr-3 text-left font-medium text-muted-foreground">Microchip</th><td>{p.identifiers[0].value}</td></tr>}
          <tr><th className="py-0.5 pr-3 text-left font-medium text-muted-foreground">Owner</th><td>{r.client.displayName}{r.client.mobilePhone ? ` · ${r.client.mobilePhone}` : ''}</td></tr>
          {summary.problems.length > 0 && <tr><th className="py-0.5 pr-3 text-left align-top font-medium text-muted-foreground">Active problems</th><td>{summary.problems.map((x) => x.term).join('; ')}</td></tr>}
        </tbody></table>
        <h2 className="mb-1 font-semibold">Clinical summary</h2>
        <p className="mb-4 whitespace-pre-wrap">{r.clinicalSummary}</p>
        {r.questions && <><h2 className="mb-1 font-semibold">Questions</h2><p className="mb-4 whitespace-pre-wrap">{r.questions}</p></>}
        <p className="mt-8">Kind regards,</p>
        <div className="mt-10 w-64 border-b" />
        <p>{r.sentByName ?? r.createdByName}</p>
        <p className="text-muted-foreground">{practice}</p>
        <LetterFooter />
      </article>
    </>
  );
}

export default function ReferralLetterPage() {
  return (
    <RequirePermission anyOf={['insurance.read']}>
      <LetterView />
    </RequirePermission>
  );
}
