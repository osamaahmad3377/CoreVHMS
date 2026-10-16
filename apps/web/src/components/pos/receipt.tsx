import { enumLabel } from '@vcms/shared';
import type { ClinicHeader } from '../billing/invoice-document';
import { fmtDateTime, fmtMoney } from '@/lib/format';
import type { Invoice } from '@/lib/types';
import { cn } from '@/lib/utils';

export interface ReceiptPayment {
  method: string;
  amountMinor: number;
  receiptNo?: string;
  reference?: string | null;
}

/** 80 mm thermal-style receipt. Amounts come from the issued invoice and recorded payments. */
export function PosReceipt({
  invoice: i,
  clinic,
  payments,
  tenderedMinor,
  changeMinor,
  cashier,
  className,
}: {
  invoice: Invoice;
  clinic: ClinicHeader | null;
  payments: ReceiptPayment[];
  tenderedMinor?: number;
  changeMinor?: number;
  cashier?: string | null;
  className?: string;
}) {
  const cur = i.currency;
  const paid = payments.reduce((n, p) => n + p.amountMinor, 0);
  const due = i.totalMinor - i.creditedMinor - paid;
  const row = (label: React.ReactNode, value: React.ReactNode, strong = false) => (
    <div className={cn('flex justify-between gap-2', strong && 'font-bold')}><span>{label}</span><span className="tabular">{value}</span></div>
  );
  return (
    <article className={cn('mx-auto w-[72mm] bg-white px-1 py-2 font-mono text-[11px] leading-snug text-black', className)} aria-label={`Receipt ${i.invoiceNo}`}>
      <header className="text-center">
        <p className="text-[13px] font-bold">{clinic?.legalName || clinic?.name}</p>
        {[clinic?.addressLine1, clinic?.city].filter(Boolean).length > 0 && <p>{[clinic?.addressLine1, clinic?.city].filter(Boolean).join(', ')}</p>}
        {clinic?.phone && <p>Tel {clinic.phone}</p>}
        {clinic?.taxNumber && <p>Tax no. {clinic.taxNumber}</p>}
        <p className="mt-1 font-bold">{i.status === 'VOID' ? 'VOID — ' : ''}TAX INVOICE / RECEIPT</p>
      </header>
      <div className="my-1.5 border-t border-dashed border-black" />
      {row('Invoice', i.invoiceNo)}
      {row('Date', fmtDateTime(i.issuedAt ?? i.createdAt))}
      {(cashier ?? i.issuedByName) && row('Served by', cashier ?? i.issuedByName)}
      {i.client && row('Customer', i.client.displayName)}
      <div className="my-1.5 border-t border-dashed border-black" />
      {i.lines.map((l) => (
        <div key={l.id} className="mb-1">
          <p>{l.description}</p>
          <div className="flex justify-between pl-2">
            <span className="tabular">{l.quantity} × {fmtMoney(l.unitPriceMinor, cur)}{l.discountMinor ? ` −${fmtMoney(l.discountMinor, cur)}` : ''}</span>
            <span className="tabular">{fmtMoney(l.grossMinor, cur)}</span>
          </div>
        </div>
      ))}
      <div className="my-1.5 border-t border-dashed border-black" />
      {row('Subtotal (excl. tax)', fmtMoney(i.subtotalMinor, cur))}
      {row(`Tax${i.pricesIncludeTax ? ' (incl.)' : ''}`, fmtMoney(i.taxMinor, cur))}
      <div className="text-[13px]">{row('TOTAL', fmtMoney(i.totalMinor, cur), true)}</div>
      <div className="my-1.5 border-t border-dashed border-black" />
      {payments.map((p, idx) => (
        <div key={idx}>{row(`${enumLabel(p.method)}${p.reference ? ` (${p.reference})` : ''}`, fmtMoney(p.amountMinor, cur))}</div>
      ))}
      {tenderedMinor !== undefined && !!changeMinor && (
        <>
          {row('Cash tendered', fmtMoney(tenderedMinor, cur))}
          {row('Change', fmtMoney(changeMinor, cur), true)}
        </>
      )}
      {due > 0 && i.status !== 'VOID' && row('Balance due', fmtMoney(due, cur), true)}
      {payments.some((p) => p.receiptNo) && <p className="mt-1">Receipt {payments.map((p) => p.receiptNo).filter(Boolean).join(', ')}</p>}
      <div className="my-1.5 border-t border-dashed border-black" />
      <p className="text-center">Thank you for caring for your pet with us</p>
    </article>
  );
}

/** Print-only container that sizes the page for an 80 mm receipt printer. */
export function ReceiptPrintArea({ children }: { children: React.ReactNode }) {
  return (
    <div className="hidden print:block">
      <style>{'@media print { @page { size: 80mm auto; margin: 3mm; } }'}</style>
      {children}
    </div>
  );
}
