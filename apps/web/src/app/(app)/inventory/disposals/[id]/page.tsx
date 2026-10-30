'use client';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { ClinicHeader } from '@/components/billing/invoice-document';
import { LetterFooter, Letterhead } from '@/components/documents/letterhead';
import { ErrorState, LoadingRows } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { StockDisposal } from '@/lib/types';

/** The permanent record of one disposal, laid out to print and sign (disposer, witness, waste contractor). */
function Record() {
  const { id } = useParams<{ id: string }>();
  const { currency } = useSession();
  const q = useQuery({ queryKey: ['disposal', id], queryFn: () => api.get<StockDisposal>(`/stock/disposals/${id}`) });
  const org = useQuery({ queryKey: ['organization'], queryFn: () => api.get<ClinicHeader>('/organization'), staleTime: 300_000 });
  if (q.isLoading || org.isLoading) return <LoadingRows />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const th = 'border border-gray-400 bg-gray-100 px-2 py-1 text-left font-semibold';
  const td = 'border border-gray-400 px-2 py-1 align-top';
  return (
    <>
      <div className="no-print mb-4 flex items-center justify-between">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/inventory/disposals?tab=records"><ArrowLeft /> Disposal records</Link>
        </Button>
        <Button size="sm" onClick={() => window.print()}><Printer /> Print</Button>
      </div>
      <div className="rounded-lg border shadow-sm print:border-0 print:shadow-none">
        <article className="mx-auto max-w-3xl bg-white p-8 text-[10.5pt] text-black">
          <Letterhead
            clinic={org.data ?? null}
            aside={
              <div className="text-right">
                <p className="text-lg font-bold">STOCK DISPOSAL RECORD</p>
                <p>No. <b>{d.disposalNo}</b></p>
                <p>{fmtDateTime(d.disposedAt)}</p>
              </div>
            }
          />
          <dl className="mb-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
            <div><dt className="inline font-semibold">Store room: </dt><dd className="inline">{d.location.name}</dd></div>
            <div><dt className="inline font-semibold">Reason: </dt><dd className="inline">{d.reasonLabel}</dd></div>
            <div className="col-span-2"><dt className="inline font-semibold">Method: </dt><dd className="inline">{d.methodLabel}</dd></div>
            {d.contractor && <div><dt className="inline font-semibold">Waste contractor: </dt><dd className="inline">{d.contractor}</dd></div>}
            {d.reference && <div><dt className="inline font-semibold">Consignment note: </dt><dd className="inline">{d.reference}</dd></div>}
            <div><dt className="inline font-semibold">Disposed by: </dt><dd className="inline">{d.createdByName}</dd></div>
            <div><dt className="inline font-semibold">Witness: </dt><dd className="inline">{d.witnessName ?? '—'}</dd></div>
          </dl>
          <table className="mb-3 w-full border-collapse text-[9.5pt]">
            <thead>
              <tr>
                <th className={th}>Product</th>
                <th className={th}>Batch</th>
                <th className={th}>Expiry</th>
                <th className={`${th} text-right`}>Quantity</th>
                <th className={`${th} text-right`}>Cost each</th>
                <th className={`${th} text-right`}>Value</th>
              </tr>
            </thead>
            <tbody>
              {d.lines.map((l) => (
                <tr key={l.id}>
                  <td className={td}>
                    {l.product.name}
                    {l.product.isControlled && <span className="block text-[8.5pt]">Controlled{l.product.controlledSchedule ? ` — ${l.product.controlledSchedule}` : ''}</span>}
                  </td>
                  <td className={td}>{l.batch.batchNumber}</td>
                  <td className={td}>{l.batch.expiryDate ? fmtDate(l.batch.expiryDate) : '—'}{l.wasExpired && <span className="block text-[8.5pt]">expired</span>}</td>
                  <td className={`${td} text-right`}>{l.quantity} {l.product.dispensingUnit}</td>
                  <td className={`${td} text-right`}>{fmtMoney(l.unitCostMinor, currency)}</td>
                  <td className={`${td} text-right`}>{fmtMoney(l.totalMinor, currency)}</td>
                </tr>
              ))}
              <tr>
                <td className={`${td} text-right font-semibold`} colSpan={5}>Total written off at cost</td>
                <td className={`${td} text-right font-semibold`}>{fmtMoney(d.totalMinor, currency)}</td>
              </tr>
            </tbody>
          </table>
          {d.notes && <p className="mb-3 whitespace-pre-wrap text-sm"><b>Notes:</b> {d.notes}</p>}
          <p className="text-xs text-gray-600">Recorded {fmtDateTime(d.createdAt)}. This record and the matching write-offs in the stock history cannot be changed.</p>
          <div className="mt-12 grid grid-cols-3 gap-6 text-sm">
            <p className="border-t border-black pt-1">Disposed by · {d.createdByName}</p>
            <p className="border-t border-black pt-1">Witness{d.witnessName ? ` · ${d.witnessName}` : ''}</p>
            <p className="border-t border-black pt-1">Waste contractor{d.contractor ? ` · ${d.contractor}` : ''}</p>
          </div>
          <LetterFooter />
        </article>
      </div>
    </>
  );
}

export default function DisposalRecordPage() {
  return (
    <RequirePermission anyOf={['inventory.read']}>
      <Record />
    </RequirePermission>
  );
}
