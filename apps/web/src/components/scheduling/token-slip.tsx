import type { CSSProperties } from 'react';
import { printReceipt } from '@/lib/print-receipt';

/** Thermal roll width for token slips. */
export const TOKEN_PAPER_MM = 80;

export interface TokenSlipData {
  clinic: string;
  branch: string;
  token: number;
  petName?: string | null;
  service?: string | null;
  /** People waiting before this token; null when unknown. */
  ahead?: number | null;
  /** Already formatted in the branch's time zone, e.g. "25 Oct 2026, 4:15 PM". */
  issuedAt: string;
  /** Booked time, e.g. "4:00 PM"; omitted for walk-ins. */
  bookedAt?: string | null;
  phone?: string | null;
}

export const padToken = (n: number) => String(n).padStart(3, '0');

/**
 * A waiting-room token on an 80 mm thermal roll: black on white, large number, inline styles only (it is printed in
 * a bare frame without the app's stylesheet).
 */
export function TokenSlip({ s }: { s: TokenSlipData }) {
  const page: CSSProperties = {
    width: `${TOKEN_PAPER_MM}mm`,
    boxSizing: 'border-box',
    padding: '4mm 5mm 6mm',
    background: '#fff',
    color: '#000',
    fontFamily: '"Helvetica Neue", Helvetica, Arial, "Segoe UI", sans-serif',
    fontSize: '13px',
    lineHeight: 1.35,
    textAlign: 'center',
    fontVariantNumeric: 'tabular-nums',
  };
  const rule: CSSProperties = { borderTop: '1px dashed #000', margin: '3mm 0' };
  const row: CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: '3mm', textAlign: 'left' };
  return (
    <div data-receipt style={page}>
      <div style={{ fontSize: '18px', fontWeight: 800, lineHeight: 1.2 }}>{s.clinic}</div>
      <div style={{ fontSize: '13px', marginTop: '1mm' }}>{s.branch}</div>
      <div style={rule} />
      <div style={{ fontSize: '13px', fontWeight: 700, letterSpacing: '4px' }}>YOUR TOKEN</div>
      <div style={{ fontSize: '84px', fontWeight: 900, lineHeight: 1, margin: '2mm 0 1mm', letterSpacing: '-2px' }}>{padToken(s.token)}</div>
      {s.petName && <div style={{ fontSize: '18px', fontWeight: 700 }}>{s.petName}</div>}
      {s.ahead !== null && s.ahead !== undefined && (
        <div style={{ display: 'inline-block', marginTop: '2mm', padding: '1mm 3mm', border: '1.5px solid #000', borderRadius: '2mm', fontSize: '14px', fontWeight: 700 }}>
          {s.ahead === 0 ? 'You are next' : `${s.ahead} ${s.ahead === 1 ? 'person' : 'people'} ahead of you`}
        </div>
      )}
      <div style={rule} />
      {s.service && (
        <div style={row}>
          <span>Visit</span>
          <span style={{ fontWeight: 700 }}>{s.service}</span>
        </div>
      )}
      {s.bookedAt && (
        <div style={row}>
          <span>Booked for</span>
          <span style={{ fontWeight: 700 }}>{s.bookedAt}</span>
        </div>
      )}
      <div style={row}>
        <span>Checked in</span>
        <span style={{ fontWeight: 700 }}>{s.issuedAt}</span>
      </div>
      <div style={rule} />
      <div style={{ fontSize: '13px', fontWeight: 700 }}>Please watch the screen.</div>
      <div style={{ fontSize: '12px' }}>We will call your token number. Keep this slip until you are called.</div>
      <div style={{ fontSize: '11px', marginTop: '2mm' }}>Emergencies are seen first.</div>
      {s.phone && <div style={{ fontSize: '11px', marginTop: '1mm' }}>Questions? Call {s.phone}</div>}
    </div>
  );
}

/** Prints one token slip on the 80 mm receipt printer. */
export function printTokenSlip(s: TokenSlipData) {
  return printReceipt(<TokenSlip s={s} />, TOKEN_PAPER_MM);
}
