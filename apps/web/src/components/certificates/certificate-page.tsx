'use client';
import {
  VACCINATION_COLUMNS,
  code128,
  fillCertificateText,
  fillPlaceholders,
  pageMm,
  type CertificateElement,
  type CertificateLayout,
  type CertificateVaccinationRow,
} from '@vcms/shared';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

/** What a certificate prints: placeholder values, the vaccinations table and the verification code. */
export interface CertificateData {
  fields: Record<string, string>;
  table: CertificateVaccinationRow[];
  /** The verification address (QR code). */
  qrValue: string;
  /** The verification code (barcode). */
  barcodeValue: string;
  /** The clinic's logo, or null when it has none. */
  logoUrl: string | null;
}

export const MM_TO_PX = 96 / 25.4;

const FONT: Record<string, string> = {
  sans: 'var(--font-sans, Inter), ui-sans-serif, system-ui, sans-serif',
  serif: 'Georgia, "Times New Roman", Cambria, serif',
  script: '"Brush Script MT", "Segoe Script", "Lucida Handwriting", cursive',
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};

/** An SVG QR code for the verification address. */
function useQr(value: string, color: string) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    QRCode.toString(value || 'https://example.com', { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: color, light: '#0000' } })
      .then((s) => live && setSvg(s.replace('<svg ', '<svg width="100%" height="100%" ')))
      .catch(() => live && setSvg(null));
    return () => {
      live = false;
    };
  }, [value, color]);
  return svg;
}

function Qr({ value, color }: { value: string; color: string }) {
  const svg = useQr(value, color);
  return svg ? <div className="h-full w-full" dangerouslySetInnerHTML={{ __html: svg }} /> : <div className="h-full w-full bg-muted/40" />;
}

/** Code 128 bars, scaled to the element. */
function Barcode({ value, color, showText }: { value: string; color: string; showText?: boolean }) {
  let bars: number[] = [];
  try {
    bars = code128(value || 'CERT');
  } catch {
    bars = code128('CERT');
  }
  const quiet = 10;
  const total = bars.reduce((n, b) => n + b, 0) + quiet * 2;
  let x = quiet;
  const rects = bars.map((b, i) => {
    const r = i % 2 === 0 ? <rect key={i} x={x} y={0} width={b} height={1} fill={color} /> : null;
    x += b;
    return r;
  });
  return (
    <div className="flex h-full w-full flex-col">
      <svg viewBox={`0 0 ${total} 1`} preserveAspectRatio="none" className="min-h-0 w-full flex-1" aria-label={`Barcode ${value}`}>
        {rects}
      </svg>
      {showText && <div style={{ fontSize: '6.5pt', color, fontFamily: FONT.mono, textAlign: 'center', letterSpacing: '0.1em' }}>{value}</div>}
    </div>
  );
}

/** One element's content (position and size are the caller's). */
export function ElementView({ el, data, designer }: { el: CertificateElement; data: CertificateData; designer?: boolean }) {
  switch (el.type) {
    case 'text': {
      const content = fillCertificateText(el.text, data.fields);
      return (
        <div
          style={{
            fontSize: `${el.fontSize}pt`,
            fontFamily: FONT[el.fontFamily],
            fontWeight: el.fontWeight,
            fontStyle: el.italic ? 'italic' : undefined,
            textTransform: el.uppercase ? 'uppercase' : undefined,
            letterSpacing: el.letterSpacing ? `${el.letterSpacing}pt` : undefined,
            lineHeight: el.lineHeight ?? 1.4,
            textAlign: el.align,
            color: el.color,
            whiteSpace: 'pre-wrap',
            overflowWrap: 'break-word',
          }}
        >
          {content || (designer ? <span style={{ opacity: 0.35 }}>Empty text</span> : null)}
        </div>
      );
    }
    case 'image': {
      const src = el.src === 'logo' ? data.logoUrl : el.src;
      if (!src) return designer ? <div className="flex h-full w-full items-center justify-center rounded border border-dashed border-gray-400 text-[8pt] text-gray-500">{el.src === 'logo' ? 'Clinic logo' : 'Image'}</div> : null;
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={src} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: el.fit, opacity: el.opacity ?? 1 }} />;
    }
    case 'qr':
      return <Qr value={data.qrValue} color={el.color} />;
    case 'barcode':
      return <Barcode value={data.barcodeValue} color={el.color} showText={el.showText} />;
    case 'line': {
      const vertical = el.h > el.w;
      return <div style={vertical ? { height: '100%', borderLeft: `${el.thickness}mm ${el.style} ${el.color}`, width: 0, margin: '0 auto' } : { width: '100%', borderTop: `${el.thickness}mm ${el.style} ${el.color}` }} />;
    }
    case 'box':
      return (
        <div
          style={{
            width: '100%',
            height: '100%',
            border: el.borderWidth ? `${el.borderStyle === 'double' ? Math.max(el.borderWidth, 0.9) : el.borderWidth}mm ${el.borderStyle} ${el.borderColor}` : undefined,
            background: el.fill === 'transparent' ? undefined : el.fill,
            borderRadius: `${el.radius}mm`,
          }}
        />
      );
    case 'table': {
      const rows = data.table;
      return (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: `${el.fontSize}pt`, color: el.color }}>
          <thead>
            <tr>
              {VACCINATION_COLUMNS.map((c) => (
                <th key={c.key} style={{ background: el.headerColor, color: '#fff', textAlign: 'left', padding: '1.2mm 1.6mm', fontWeight: 600 }}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((r, i) => (
                <tr key={i} style={{ background: i % 2 ? 'rgba(0,0,0,0.035)' : undefined }}>
                  {VACCINATION_COLUMNS.map((c) => (
                    <td key={c.key} style={{ padding: '1mm 1.6mm', borderBottom: '0.2mm solid rgba(0,0,0,0.12)' }}>
                      {r[c.key] || '—'}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={VACCINATION_COLUMNS.length} style={{ padding: '2mm', textAlign: 'center', opacity: 0.6 }}>
                  No vaccinations
                </td>
              </tr>
            )}
          </tbody>
        </table>
      );
    }
    case 'signature': {
      const name = data.fields['issuer.name'];
      const reg = data.fields['issuer.registration'];
      return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', color: el.color, fontSize: `${el.fontSize}pt`, textAlign: 'center', lineHeight: 1.35 }}>
          <div style={{ borderTop: `0.3mm solid ${el.color}`, paddingTop: '1.2mm' }}>
            {el.showName && name && <div style={{ fontWeight: 600 }}>{name}</div>}
            <div style={{ opacity: 0.75 }}>{fillPlaceholders(el.label, data.fields)}</div>
            {el.showName && reg && <div style={{ opacity: 0.65, fontSize: '0.85em' }}>Reg. {reg}</div>}
          </div>
        </div>
      );
    }
  }
}

/** The page's frame: plain, double, thick or ornate, inset from the edge. */
function Frame({ page }: { page: CertificateLayout['page'] }) {
  const { style, color, inset } = page.border;
  if (style === 'none') return null;
  const box = (offset: number, width: number, extra: React.CSSProperties = {}) => (
    <div style={{ position: 'absolute', inset: `${offset}mm`, border: `${width}mm solid ${color}`, pointerEvents: 'none', ...extra }} />
  );
  if (style === 'simple') return box(inset, 0.5);
  if (style === 'thick') return box(inset, 2.5);
  if (style === 'double') return (
    <>
      {box(inset, 1.2)}
      {box(inset + 2.6, 0.35)}
    </>
  );
  // Ornate: double frame with corner ornaments.
  const corner = (pos: React.CSSProperties, rotate: number) => (
    <svg viewBox="0 0 40 40" style={{ position: 'absolute', width: '16mm', height: '16mm', pointerEvents: 'none', transform: `rotate(${rotate}deg)`, ...pos }}>
      <path d="M2 2h22M2 2v22M7 7h12M7 7v12" stroke={color} strokeWidth="1.6" fill="none" />
      <path d="M12 12c8 0 12 4 12 12M12 12c0 8 4 12 12 12" stroke={color} strokeWidth="1" fill="none" />
      <circle cx="12" cy="12" r="2.2" fill={color} />
    </svg>
  );
  const o = `${inset - 1}mm`;
  return (
    <>
      {box(inset, 0.8)}
      {box(inset + 2.4, 0.3)}
      {corner({ top: o, left: o }, 0)}
      {corner({ top: o, right: o }, 90)}
      {corner({ bottom: o, right: o }, 180)}
      {corner({ bottom: o, left: o }, 270)}
    </>
  );
}

/** Position and size of an element on the page, in millimetres. */
export const placeStyle = (el: CertificateElement): React.CSSProperties => ({
  position: 'absolute',
  left: `${el.x}mm`,
  top: `${el.y}mm`,
  width: `${el.w}mm`,
  height: `${el.h}mm`,
  transform: el.rotate ? `rotate(${el.rotate}deg)` : undefined,
});

/** The page itself at true size (millimetres): background, frame and every element. */
export function CertificatePage({ layout, data, className, children, renderElement }: { layout: CertificateLayout; data: CertificateData; className?: string; children?: React.ReactNode; renderElement?: (el: CertificateElement, index: number) => React.ReactNode }) {
  const { w, h } = pageMm(layout.page);
  return (
    <div
      className={cn('cert-page relative overflow-hidden text-left', className)}
      style={{
        width: `${w}mm`,
        height: `${h}mm`,
        background: layout.page.background,
        backgroundImage: layout.page.backgroundImage ? `url(${layout.page.backgroundImage})` : undefined,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        color: '#111827',
        printColorAdjust: 'exact',
        WebkitPrintColorAdjust: 'exact',
      }}
    >
      <Frame page={layout.page} />
      {layout.elements.map((el, i) =>
        renderElement ? (
          renderElement(el, i)
        ) : (
          <div key={el.id} style={{ ...placeStyle(el), overflow: el.type === 'text' ? 'visible' : 'hidden' }}>
            <ElementView el={el} data={data} />
          </div>
        ),
      )}
      {children}
    </div>
  );
}

/** The page scaled to fit a width on screen (the page keeps its true millimetre size inside). */
export function ScaledCertificate({ layout, data, width, className }: { layout: CertificateLayout; data: CertificateData; width: number; className?: string }) {
  const { w, h } = pageMm(layout.page);
  const scale = width / (w * MM_TO_PX);
  return (
    <div className={cn('overflow-hidden rounded-md bg-white shadow-sm ring-1 ring-black/10', className)} style={{ width, height: h * MM_TO_PX * scale }}>
      <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}>
        <CertificatePage layout={layout} data={data} />
      </div>
    </div>
  );
}

/** Fills the available width, re-measuring when it changes. */
export function FitCertificate({ layout, data, maxWidth = 900, className }: { layout: CertificateLayout; data: CertificateData; maxWidth?: number; className?: string }) {
  const [width, setWidth] = useState(0);
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!node) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.min(maxWidth, Math.floor(e.contentRect.width))));
    ro.observe(node);
    return () => ro.disconnect();
  }, [node, maxWidth]);
  return (
    <div ref={setNode} className={cn('w-full min-w-0', className)}>
      {width > 0 && <ScaledCertificate layout={layout} data={data} width={width} className="mx-auto" />}
    </div>
  );
}

/** The sample data a template is previewed with. */
export function sampleData(fields: Record<string, string>, table: CertificateVaccinationRow[], logoUrl: string | null): CertificateData {
  return { fields, table, qrValue: fields['certificate.verifyUrl'] ?? 'https://example.com/verify/K7Q2M9XP4TRA', barcodeValue: (fields['certificate.code'] ?? 'K7Q2-M9XP-4TRA').replace(/-/g, ''), logoUrl };
}
