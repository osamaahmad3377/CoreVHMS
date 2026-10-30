'use client';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { bpToPct } from '@/components/billing/money';
import type { ClinicHeader } from '@/components/billing/invoice-document';
import { LetterFooter, Letterhead } from '@/components/documents/letterhead';
import { ErrorState, LoadingRows } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { WellnessEnrolment } from '@/lib/types';

/** Membership agreement for the client to keep and sign: the plan, what's included, the payments and the terms. */
function Agreement() {
  const { id } = useParams<{ id: string }>();
  const { currency } = useSession();
  const e = useQuery({ queryKey: ['wellness-enrolment', id], queryFn: () => api.get<WellnessEnrolment>(`/wellness/enrolments/${id}`) });
  const org = useQuery({ queryKey: ['organization'], queryFn: () => api.get<ClinicHeader>('/organization'), staleTime: 300_000 });
  if (e.isLoading || org.isLoading) return <LoadingRows />;
  if (e.error || !e.data) return <ErrorState error={e.error} onRetry={() => e.refetch()} />;
  const m = e.data;
  return (
    <>
      <div className="no-print mb-4 flex items-center justify-between">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/patients/${m.patient.id}?tab=wellness`}>
            <ArrowLeft /> Back to {m.patient.name}
          </Link>
        </Button>
        <Button size="sm" onClick={() => window.print()}>
          <Printer /> Print
        </Button>
      </div>
      <div className="rounded-lg border shadow-sm print:border-0 print:shadow-none">
        <article className="mx-auto max-w-3xl bg-white p-8 text-[10.5pt] text-black">
          <Letterhead clinic={org.data ?? null} title={<p className="text-center text-xl font-bold tracking-wide">WELLNESS PLAN AGREEMENT</p>} />
          <dl className="mb-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
            <div><dt className="inline font-semibold">Plan: </dt><dd className="inline">{m.planName} ({m.enrolmentNo})</dd></div>
            <div><dt className="inline font-semibold">Cover: </dt><dd className="inline">{fmtDate(m.startDate)} to {fmtDate(m.endDate)}</dd></div>
            <div><dt className="inline font-semibold">Animal: </dt><dd className="inline">{m.patient.name} ({m.patient.patientNo}, {m.patient.species.name})</dd></div>
            <div><dt className="inline font-semibold">Owner: </dt><dd className="inline">{m.client.displayName}{m.client.mobilePhone ? ` · ${m.client.mobilePhone}` : ''}</dd></div>
            <div><dt className="inline font-semibold">Payment: </dt><dd className="inline">{m.billing === 'MONTHLY' ? `Monthly, ${m.instalments.length} payments` : 'Up front'} · total {fmtMoney(m.totalMinor, currency)}{m.joiningFeeMinor > 0 ? ` (incl. ${fmtMoney(m.joiningFeeMinor, currency)} joining fee)` : ''}</dd></div>
            <div><dt className="inline font-semibold">Renews automatically: </dt><dd className="inline">{m.autoRenew ? 'Yes' : 'No'}</dd></div>
          </dl>

          <h2 className="mb-1 text-sm font-bold uppercase">Included during the cover period</h2>
          {m.entitlements.length ? (
            <table className="mb-3 w-full border-collapse text-sm">
              <thead>
                <tr className="border-y border-black text-left [&>th]:px-2 [&>th]:py-1 [&>th:first-child]:pl-0"><th>Item</th><th className="text-right">Included</th><th className="text-right">Normal price each</th></tr>
              </thead>
              <tbody>
                {m.entitlements.map((x) => (
                  <tr key={x.id} className="border-b border-gray-300 [&>td]:px-2 [&>td]:py-1 [&>td:first-child]:pl-0">
                    <td>{x.label}</td>
                    <td className="text-right">{x.quantity}</td>
                    <td className="text-right">{fmtMoney(x.unitValueMinor, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="mb-3 text-sm">No included items.</p>
          )}
          {(m.serviceDiscountBp > 0 || m.productDiscountBp > 0) && (
            <p className="mb-3 text-sm">
              <b>Member discount:</b> {[m.serviceDiscountBp > 0 && `${bpToPct(m.serviceDiscountBp)} off other services and lab tests`, m.productDiscountBp > 0 && `${bpToPct(m.productDiscountBp)} off products and medicines`].filter(Boolean).join('; ')}, for {m.patient.name} during the cover period.
            </p>
          )}

          <h2 className="mb-1 text-sm font-bold uppercase">Payments</h2>
          <table className="mb-4 w-full border-collapse text-sm">
            <thead>
              <tr className="border-y border-black text-left [&>th]:px-2 [&>th]:py-1 [&>th:first-child]:pl-0"><th>Due</th><th>Payment</th><th className="text-right">Amount</th></tr>
            </thead>
            <tbody>
              {m.instalments.map((i) => (
                <tr key={i.id} className="border-b border-gray-300 [&>td]:px-2 [&>td]:py-1 [&>td:first-child]:pl-0">
                  <td>{fmtDate(i.dueDate)}</td>
                  <td>{m.billing === 'UPFRONT' ? 'Full term' : `${i.seq} of ${m.instalments.length}`}{i.status === 'CANCELLED' ? ' (cancelled)' : ''}</td>
                  <td className="text-right">{fmtMoney(i.amountMinor, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {m.terms && (
            <>
              <h2 className="mb-1 text-sm font-bold uppercase">Terms and conditions</h2>
              <p className="mb-4 whitespace-pre-wrap text-sm">{m.terms}</p>
            </>
          )}
          <p className="text-sm">Included items are for {m.patient.name} only, during the cover period, and are not exchangeable for cash. Prices shown are the clinic’s normal prices on {fmtDate(m.createdAt)}.</p>
          <div className="mt-12 grid grid-cols-2 gap-8 text-sm">
            <p className="border-t border-black pt-1">Client signature · {m.client.displayName}</p>
            <p className="border-t border-black pt-1">For the clinic · {m.createdByName ?? ''} · {fmtDate(m.createdAt)}</p>
          </div>
          <LetterFooter />
        </article>
      </div>
    </>
  );
}

export default function AgreementPage() {
  return (
    <RequirePermission anyOf={['wellness.read']}>
      <Agreement />
    </RequirePermission>
  );
}
