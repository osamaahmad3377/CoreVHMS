import { enumLabel } from '@vcms/shared';
import { bpToPct } from './money';
import { fmtDate, fmtMoney } from '@/lib/format';
import type { Invoice } from '@/lib/types';

export interface ClinicHeader {
  name: string;
  legalName?: string | null;
  taxNumber?: string | null;
  phone?: string | null;
  email?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  postcode?: string | null;
}

/** Printable tax invoice. Totals are the stored, issued amounts — never recomputed here. */
export function InvoiceDocument({ invoice: i, clinic }: { invoice: Invoice; clinic: ClinicHeader | null }) {
  const cur = i.currency;
  const addr = i.client?.addresses?.[0];
  return (
    <article className="mx-auto max-w-3xl bg-white p-8 text-[10.5pt] text-black">
      <header className="flex justify-between gap-6 border-b border-black pb-4">
        <div>
          <p className="text-lg font-bold">{clinic?.legalName || clinic?.name}</p>
          {clinic?.legalName && clinic.legalName !== clinic.name && <p>{clinic.name}</p>}
          <p>{[clinic?.addressLine1, clinic?.addressLine2, clinic?.city, clinic?.postcode].filter(Boolean).join(', ')}</p>
          <p>{[clinic?.phone, clinic?.email].filter(Boolean).join(' · ')}</p>
          {clinic?.taxNumber && <p>Tax number: {clinic.taxNumber}</p>}
        </div>
        <div className="text-right">
          <p className="text-lg font-bold">{i.status === 'DRAFT' ? 'DRAFT INVOICE' : 'TAX INVOICE'}</p>
          <p>{i.invoiceNo}</p>
          <p>Date: {fmtDate(i.issuedAt ?? i.createdAt)}</p>
          {i.dueAt && <p>Due: {fmtDate(i.dueAt)}</p>}
          {i.status === 'VOID' && <p className="font-bold">VOID — {i.voidReason}</p>}
        </div>
      </header>
      <section className="py-4">
        <p className="text-xs uppercase">Bill to</p>
        {i.client ? (
          <>
            <p className="font-semibold">{i.client.displayName}</p>
            {addr && <p>{[addr.line1, addr.line2, addr.city].filter(Boolean).join(', ')}</p>}
            <p>{[i.client.mobilePhone, i.client.email].filter(Boolean).join(' · ')}</p>
          </>
        ) : (
          <p>Counter sale</p>
        )}
        {i.patient && <p className="mt-1">Patient: {i.patient.name}</p>}
      </section>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-black text-left">
            <th className="py-1">Description</th>
            <th className="py-1 text-right">Qty</th>
            <th className="py-1 text-right">Unit</th>
            <th className="py-1 text-right">Disc.</th>
            <th className="py-1 text-right">Tax</th>
            <th className="py-1 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {i.lines.map((l) => (
            <tr key={l.id} className="border-b border-gray-300 align-top">
              <td className="py-1 pr-2">{l.description}</td>
              <td className="py-1 text-right">{l.quantity}</td>
              <td className="py-1 text-right">{fmtMoney(l.unitPriceMinor, cur)}</td>
              <td className="py-1 text-right">{l.discountMinor ? fmtMoney(l.discountMinor, cur) : ''}</td>
              <td className="py-1 text-right">{bpToPct(l.taxRateBasisPoints)}</td>
              <td className="py-1 text-right">{fmtMoney(l.grossMinor, cur)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="ml-auto mt-3 grid w-64 gap-0.5">
        <div className="flex justify-between"><dt>Subtotal (excl. tax)</dt><dd>{fmtMoney(i.subtotalMinor, cur)}</dd></div>
        <div className="flex justify-between"><dt>Tax{i.pricesIncludeTax ? ' (included)' : ''}</dt><dd>{fmtMoney(i.taxMinor, cur)}</dd></div>
        <div className="flex justify-between border-t border-black font-bold"><dt>Total</dt><dd>{fmtMoney(i.totalMinor, cur)}</dd></div>
        {!!i.creditedMinor && <div className="flex justify-between"><dt>Credited</dt><dd>−{fmtMoney(i.creditedMinor, cur)}</dd></div>}
        {!!i.paidMinor && <div className="flex justify-between"><dt>Paid</dt><dd>−{fmtMoney(i.paidMinor, cur)}</dd></div>}
        {i.status !== 'DRAFT' && i.status !== 'VOID' && <div className="flex justify-between font-bold"><dt>Balance due</dt><dd>{fmtMoney(i.balanceMinor, cur)}</dd></div>}
      </dl>
      {!!i.allocations.length && (
        <p className="mt-4 text-xs">Payments: {i.allocations.map((a) => `${a.payment.receiptNo} ${enumLabel(a.payment.method)} ${fmtMoney(a.amountMinor, cur)} (${fmtDate(a.payment.receivedAt)})`).join('; ')}</p>
      )}
      {i.notes && <p className="mt-4 whitespace-pre-wrap">{i.notes}</p>}
    </article>
  );
}
