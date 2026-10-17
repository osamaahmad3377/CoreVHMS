import { enumLabel } from '@vcms/shared';
import type { CSSProperties } from 'react';
import { fmtDateTime, fmtMoney } from '@/lib/format';
import type { Invoice, ReceiptContext } from '@/lib/types';

export interface ReceiptPayment {
  method: string;
  amountMinor: number;
  receiptNo?: string;
  reference?: string | null;
}

/** What is printed, independent of where it came from (counter sale, invoice payment, reprint). */
export interface ReceiptData {
  number: string;
  isVoid: boolean;
  date: string;
  branchId: string | null;
  currency: string;
  pricesIncludeTax: boolean;
  servedBy: string | null;
  customer: string | null;
  patient: string | null;
  lines: { id: string; description: string; code: string | null; quantity: number; unitPriceMinor: number; discountMinor: number; grossMinor: number }[];
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  creditedMinor: number;
  payments: ReceiptPayment[];
  tenderedMinor?: number;
  changeMinor?: number;
}

export function receiptFromInvoice(i: Invoice, payments: ReceiptPayment[], extra: { tenderedMinor?: number; changeMinor?: number; servedBy?: string | null } = {}): ReceiptData {
  return {
    number: i.invoiceNo,
    isVoid: i.status === 'VOID',
    date: i.issuedAt ?? i.createdAt,
    branchId: i.branchId ?? null,
    currency: i.currency,
    pricesIncludeTax: i.pricesIncludeTax,
    servedBy: extra.servedBy ?? i.issuedByName ?? null,
    customer: i.client?.displayName ?? null,
    patient: i.patient?.name ?? null,
    lines: i.lines.map((l) => ({ id: l.id, description: l.description, code: l.code ?? null, quantity: l.quantity, unitPriceMinor: l.unitPriceMinor, discountMinor: l.discountMinor, grossMinor: l.grossMinor })),
    subtotalMinor: i.subtotalMinor,
    taxMinor: i.taxMinor,
    totalMinor: i.totalMinor,
    creditedMinor: i.creditedMinor,
    payments,
    tenderedMinor: extra.tenderedMinor,
    changeMinor: extra.changeMinor,
  };
}

const BASE_PX = { SMALL: 10.5, NORMAL: 12, LARGE: 13.5 } as const;

/**
 * A thermal receipt laid out in millimetres, with inline styles only, so the same markup renders on screen
 * (previews) and in the dedicated print frame (see lib/print-receipt.ts) without the app's stylesheet.
 */
export function ReceiptDocument({ ctx, data, logoUrl, copyLabel }: { ctx: ReceiptContext; data: ReceiptData; logoUrl: string | null; copyLabel?: string | null }) {
  const s = ctx.settings;
  const cur = data.currency;
  const px = BASE_PX[s.fontSize];
  const branch = ctx.branches.find((b) => b.id === data.branchId) ?? null;
  const paid = data.payments.reduce((n, p) => n + p.amountMinor, 0);
  const due = data.totalMinor - data.creditedMinor - paid;
  const address = s.showBranchAddress ? [branch?.addressLine1 ?? ctx.clinic.addressLine1, branch?.addressLine2 ?? (branch ? null : ctx.clinic.addressLine2), [branch?.city ?? ctx.clinic.city, branch?.postcode ?? ctx.clinic.postcode].filter(Boolean).join(' ')].filter(Boolean) : [];
  const phone = s.showPhone ? branch?.phone ?? ctx.clinic.phone : null;
  const email = s.showEmail ? branch?.email ?? ctx.clinic.email : null;

  const page: CSSProperties = {
    width: `${s.paperWidthMm}mm`,
    boxSizing: 'border-box',
    padding: `3mm ${s.sideMarginMm}mm 4mm`,
    background: '#fff',
    color: '#000',
    fontFamily: '"Helvetica Neue", Helvetica, Arial, "Segoe UI", sans-serif',
    fontSize: `${px}px`,
    lineHeight: 1.35,
    fontVariantNumeric: 'tabular-nums',
    WebkitPrintColorAdjust: 'exact',
    printColorAdjust: 'exact',
  };
  const center: CSSProperties = { textAlign: 'center' };
  const rule: CSSProperties = { borderTop: '1px dashed #000', margin: '2.2mm 0' };
  const solid: CSSProperties = { borderTop: '1.5px solid #000', margin: '2.2mm 0' };
  const row: CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: '2mm' };
  const muted: CSSProperties = { fontSize: `${px - 1.5}px` };
  const Row = ({ label, value, bold, big }: { label: React.ReactNode; value: React.ReactNode; bold?: boolean; big?: boolean }) => (
    <div style={{ ...row, fontWeight: bold ? 700 : 400, fontSize: big ? `${px + 4}px` : undefined }}>
      <span>{label}</span>
      <span style={{ whiteSpace: 'nowrap' }}>{value}</span>
    </div>
  );
  const align = s.logoAlign === 'LEFT' ? 'flex-start' : s.logoAlign === 'RIGHT' ? 'flex-end' : 'center';

  return (
    <article style={page} aria-label={`Receipt ${data.number}`} data-receipt="">
      {s.showLogo && logoUrl && (
        <div style={{ display: 'flex', justifyContent: align, marginBottom: '2mm' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={logoUrl}
            alt=""
            style={{ width: `${s.logoWidthPercent}%`, height: 'auto', display: 'block', filter: s.logoMonochrome ? 'grayscale(1) contrast(1.6)' : undefined }}
          />
        </div>
      )}
      <header style={center}>
        <div style={{ fontSize: `${px + 3}px`, fontWeight: 700, letterSpacing: '0.01em' }}>{ctx.clinic.name}</div>
        {s.showLegalName && ctx.clinic.legalName && ctx.clinic.legalName !== ctx.clinic.name && <div style={muted}>{ctx.clinic.legalName}</div>}
        {branch && ctx.branches.length > 1 && <div style={{ fontWeight: 600 }}>{branch.name}</div>}
        {address.map((a, i) => <div key={i} style={muted}>{a}</div>)}
        {(phone || email) && <div style={muted}>{[phone && `Tel ${phone}`, email].filter(Boolean).join(' · ')}</div>}
        {s.showTaxNumber && ctx.clinic.taxNumber && <div style={muted}>Tax no. {ctx.clinic.taxNumber}</div>}
        {s.headerText && <div style={{ marginTop: '1.5mm', whiteSpace: 'pre-wrap' }}>{s.headerText}</div>}
      </header>

      <div style={{ ...solid, marginBottom: '1.5mm' }} />
      <div style={{ ...center, fontWeight: 800, letterSpacing: '0.08em', fontSize: `${px + 1}px` }}>{data.isVoid ? `VOID — ${s.title}` : s.title}</div>
      {copyLabel && <div style={{ ...center, ...muted }}>{copyLabel}</div>}
      <div style={{ ...solid, marginTop: '1.5mm' }} />

      <Row label="No." value={<b>{data.number}</b>} />
      <Row label="Date" value={fmtDateTime(data.date)} />
      {s.showServedBy && data.servedBy && <Row label="Served by" value={data.servedBy} />}
      {s.showCustomer && data.customer && <Row label="Customer" value={data.customer} />}
      {s.showPatient && data.patient && <Row label="Patient" value={data.patient} />}

      <div style={rule} />
      {data.lines.map((l) => (
        <div key={l.id} style={{ marginBottom: '1.4mm', breakInside: 'avoid' }}>
          <div style={{ ...row, alignItems: 'baseline' }}>
            <span style={{ fontWeight: 600 }}>{l.description}</span>
            <span style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{fmtMoney(l.grossMinor, cur)}</span>
          </div>
          <div style={{ ...muted, display: 'flex', gap: '2mm' }}>
            <span>{l.quantity} × {fmtMoney(l.unitPriceMinor, cur)}</span>
            {l.discountMinor > 0 && <span>disc. −{fmtMoney(l.discountMinor, cur)}</span>}
            {s.showItemCodes && l.code && <span style={{ marginLeft: 'auto' }}>{l.code}</span>}
          </div>
        </div>
      ))}
      <div style={rule} />

      {s.showTaxLine && <Row label={`Subtotal${data.pricesIncludeTax ? '' : ' (excl. tax)'}`} value={fmtMoney(data.pricesIncludeTax ? data.totalMinor - data.taxMinor : data.subtotalMinor, cur)} />}
      {s.showTaxLine && <Row label={`Tax${data.pricesIncludeTax ? ' (included)' : ''}`} value={fmtMoney(data.taxMinor, cur)} />}
      {data.creditedMinor > 0 && <Row label="Credited" value={`−${fmtMoney(data.creditedMinor, cur)}`} />}
      <div style={{ ...solid, margin: '1.5mm 0' }} />
      <Row label="TOTAL" value={fmtMoney(data.totalMinor, cur)} bold big />
      <div style={{ ...solid, margin: '1.5mm 0 2mm' }} />

      {data.payments.map((p, i) => (
        <Row key={i} label={`${enumLabel(p.method)}${p.reference ? ` (${p.reference})` : ''}`} value={fmtMoney(p.amountMinor, cur)} />
      ))}
      {data.tenderedMinor !== undefined && !!data.changeMinor && (
        <>
          <Row label="Cash given" value={fmtMoney(data.tenderedMinor, cur)} />
          <Row label="Change" value={fmtMoney(data.changeMinor, cur)} bold />
        </>
      )}
      {due > 0 && !data.isVoid && <Row label="Balance due" value={fmtMoney(due, cur)} bold />}
      {data.payments.some((p) => p.receiptNo) && <div style={{ ...muted, marginTop: '1mm' }}>Payment ref. {data.payments.map((p) => p.receiptNo).filter(Boolean).join(', ')}</div>}

      {(s.footerText || s.policyText) && <div style={rule} />}
      {s.footerText && <div style={{ ...center, fontWeight: 600, whiteSpace: 'pre-wrap' }}>{s.footerText}</div>}
      {s.policyText && <div style={{ ...center, ...muted, marginTop: '1.2mm', whiteSpace: 'pre-wrap' }}>{s.policyText}</div>}
      <div style={{ ...center, fontSize: `${px - 2.5}px`, marginTop: '3mm', color: '#333' }}>{data.number} · {fmtDateTime(data.date)}</div>
    </article>
  );
}

/** Copy labels when more than one copy is printed. */
export const copyLabels = (copies: number) => (copies <= 1 ? [null] : Array.from({ length: copies }, (_, i) => (i === 0 ? 'Customer copy' : i === 1 ? 'Clinic copy' : `Copy ${i + 1}`)));

export const receiptLogoUrl = (ctx: ReceiptContext | undefined) => (ctx?.settings.showLogo && ctx.logoVersion ? `/api/v1/receipt-settings/logo?v=${ctx.logoVersion}` : null);
