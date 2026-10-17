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
import { fmtDate, fmtMoney, fmtNumber } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { ClinicalSummary, InsuranceClaim } from '@/lib/types';

interface ClaimForm {
  claim: InsuranceClaim;
  lines: { id: string; invoiceId: string; description: string; quantity: number; unitPriceMinor: number; lineTotalMinor?: number; grossMinor?: number }[];
  history: ClinicalSummary;
  organization: { name: string; legalName: string | null; phone: string | null; email: string | null; taxNumber: string | null };
  payments: { id: string; number: number; amountMinor: number; receivedAt: string; reference: string | null }[];
}

function Form() {
  const { id } = useParams<{ id: string }>();
  const { currency } = useSession();
  const q = useQuery({ queryKey: ['claim-form', id], queryFn: () => api.get<ClaimForm>(`/insurance/claims/${id}/form`) });
  if (q.isLoading) return <LoadingRows />;
  if (q.error || !q.data) return <ErrorState error={q.error} />;
  const { claim: c, lines, history, organization: org } = q.data;
  // One name for the practice everywhere on the form (header, payee), as on invoices.
  const practice = org.legalName ?? org.name;
  const lineTotal = (l: ClaimForm['lines'][number]) => l.grossMinor ?? l.lineTotalMinor ?? Math.round(l.quantity * l.unitPriceMinor);
  const row = (label: string, value: React.ReactNode) => <tr><th className="w-48 py-1 pr-3 text-left align-top font-medium text-muted-foreground">{label}</th><td className="py-1">{value}</td></tr>;
  return (
    <>
      <div className="no-print mb-4 flex items-center justify-between">
        <Button variant="ghost" size="sm" asChild><Link href={`/insurance/claims/${id}`}><ArrowLeft /> Back to claim</Link></Button>
        <Button size="sm" onClick={() => window.print()}><Printer /> Print</Button>
      </div>
      <article className="mx-auto max-w-3xl rounded-lg border bg-background p-8 text-sm shadow-sm print:border-0 print:p-0 print:shadow-none">
        <header className="mb-6 flex items-start justify-between border-b pb-4">
          <div><h1 className="text-lg font-semibold">{practice}</h1><p className="text-muted-foreground">{[org.phone, org.email].filter(Boolean).join(' · ')}</p>{org.taxNumber && <p className="text-muted-foreground">Tax no. {org.taxNumber}</p>}</div>
          <div className="text-right"><p className="text-base font-semibold">Insurance claim</p><p>{c.claimNo}</p><p className="text-muted-foreground">{fmtDate(c.submittedAt ?? c.createdAt)}</p></div>
        </header>
        <section className="mb-5 grid gap-6 sm:grid-cols-2">
          <table><tbody>
            {row('Insurer', c.policy.provider.name)}
            {row('Policy number', c.policy.policyNumber)}
            {row('Policy holder', c.client.displayName)}
            {row('Contact', [c.client.mobilePhone, c.client.email].filter(Boolean).join(' · ') || '—')}
            {row('Pay to', c.payee === 'CLINIC' ? practice : c.client.displayName)}
          </tbody></table>
          <table><tbody>
            {row('Animal', c.patient.name)}
            {row('Species / breed', `${c.patient.species.name}${c.patient.breed?.name || c.patient.breedText ? ` · ${c.patient.breed?.name ?? c.patient.breedText}` : ''}`)}
            {row('Sex', enumLabel(c.patient.sex))}
            {row('Date of birth', fmtDate(c.patient.dateOfBirth))}
            {row('Microchip', c.patient.identifiers[0]?.value ?? '—')}
          </tbody></table>
        </section>
        <section className="mb-5">
          <h2 className="mb-1 font-semibold">Condition and treatment</h2>
          <table><tbody>
            {row('Condition', c.condition)}
            {row('Treatment period', `${fmtDate(c.treatmentFrom)} to ${fmtDate(c.treatmentTo)}`)}
            {history.diagnoses.length > 0 && row('Diagnoses recorded', [...new Set(history.diagnoses.map((d) => `${d.term} (${d.type.toLowerCase()})`))].join('; '))}
            {history.problems.length > 0 && row('Active problems', history.problems.map((p) => p.term).join('; '))}
          </tbody></table>
          {c.clinicalSummary && <p className="mt-2 whitespace-pre-wrap">{c.clinicalSummary}</p>}
        </section>
        <section className="mb-5">
          <h2 className="mb-1 font-semibold">Itemised costs</h2>
          <table className="w-full">
            <thead className="border-b text-left text-xs text-muted-foreground"><tr><th className="py-1">Description</th><th className="py-1 text-right">Qty</th><th className="py-1 text-right">Unit price</th><th className="py-1 text-right">Line total</th></tr></thead>
            <tbody>{lines.map((l) => <tr key={l.id} className="border-b"><td className="py-1 pr-2">{l.description}</td><td className="py-1 text-right tabular">{fmtNumber(l.quantity)}</td><td className="whitespace-nowrap py-1 pl-2 text-right tabular">{fmtMoney(l.unitPriceMinor, currency)}</td><td className="whitespace-nowrap py-1 pl-2 text-right tabular">{fmtMoney(lineTotal(l), currency)}</td></tr>)}</tbody>
          </table>
          <p className="mt-2 text-right">Total claimed: <b>{fmtMoney(c.claimedMinor, currency)}</b> <span className="text-xs text-muted-foreground">(per issued invoices, tax included)</span></p>
        </section>
        <section className="mt-10 grid gap-10 sm:grid-cols-2">
          <div><div className="h-10 border-b" /><p className="mt-1 text-xs text-muted-foreground">Veterinarian’s signature and date — I confirm the treatment above was provided at this clinic.</p></div>
          <div><div className="h-10 border-b" /><p className="mt-1 text-xs text-muted-foreground">Policy holder’s signature and date</p></div>
        </section>
      </article>
    </>
  );
}

export default function ClaimFormPage() {
  return (
    <RequirePermission anyOf={['insurance.read']}>
      <Form />
    </RequirePermission>
  );
}
