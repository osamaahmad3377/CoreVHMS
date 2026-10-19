'use client';
import { contrastRatio, type Branding } from '@vcms/shared';
import type { ClinicHeader } from '@/components/billing/invoice-document';
import { useOptionalSession } from '@/lib/session';
import { cn } from '@/lib/utils';

/** Accent colour for printouts: the clinic's main colour when it prints legibly on white, otherwise black. */
function accentOf(b: Branding | null | undefined) {
  if (!b?.printUseBrandColour || !b.primaryColor) return '#000000';
  return contrastRatio(b.primaryColor, '#ffffff') >= 3 ? b.primaryColor : '#000000';
}

export interface LetterheadBranch {
  name?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  postcode?: string | null;
  phone?: string | null;
  email?: string | null;
}

/**
 * The clinic's letterhead at the top of every printed document (invoices, certificates, lab reports, discharge
 * summaries, surgical reports, purchase orders, letters and claim forms): logo placed as chosen in Settings →
 * Branding, the clinic's name and contact details, an optional header line and an accent rule in the brand colour.
 * `aside` is the document's own block (title, number, dates), shown beside the letterhead or below it.
 */
export function Letterhead({
  clinic,
  branch,
  aside,
  title,
  branding: given,
}: {
  clinic: ClinicHeader | null;
  branch?: LetterheadBranch | null;
  aside?: React.ReactNode;
  /** A heading under the letterhead, e.g. "VACCINATION CERTIFICATE". */
  title?: React.ReactNode;
  /** Defaults to the signed-in clinic's branding; the Branding page passes its unsaved draft for the preview. */
  branding?: Branding | null;
}) {
  const session = useOptionalSession();
  const b = given !== undefined ? given : (session?.session.organization?.branding ?? null);
  const accent = accentOf(b);
  const position = b?.printLogoPosition ?? 'LEFT';
  const name = clinic?.legalName || clinic?.name;
  const address = [branch?.addressLine1 ?? clinic?.addressLine1, branch ? branch.addressLine2 : clinic?.addressLine2, branch?.city ?? clinic?.city, branch?.postcode ?? clinic?.postcode]
    .filter(Boolean)
    .join(', ');
  const contact = [branch?.phone ?? clinic?.phone, branch?.email ?? clinic?.email].filter(Boolean).join(' · ');
  const centred = position === 'CENTER';
  const logo = b?.logoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={b.logoUrl} alt="" className={cn('max-h-16 max-w-[180px] object-contain', centred && 'mx-auto')} />
  ) : null;
  const details = (
    <div className={cn('min-w-0', centred && 'text-center')}>
      <p className="text-lg font-bold leading-tight" style={{ color: accent }}>{name}</p>
      {clinic?.legalName && clinic.name && clinic.legalName !== clinic.name && <p className="text-[9.5pt]">{clinic.name}</p>}
      {b?.printHeaderText && <p className="text-[9.5pt] italic">{b.printHeaderText}</p>}
      {branch?.name && <p className="font-semibold">{branch.name}</p>}
      {address && <p>{address}</p>}
      {contact && <p>{contact}</p>}
      {clinic?.taxNumber && <p>Tax number: {clinic.taxNumber}</p>}
    </div>
  );
  // The document's block sits beside the letterhead when the logo is on the left, otherwise underneath.
  const asideBeside = position === 'LEFT' && aside;
  return (
    <header className="mb-4">
      <div className="mb-3 h-1.5 rounded-sm print:[-webkit-print-color-adjust:exact] print:[print-color-adjust:exact]" style={{ background: accent }} />
      <div className={cn('flex gap-4 pb-3', centred ? 'flex-col items-center' : 'items-start justify-between')} style={{ borderBottom: `1px solid ${accent}` }}>
        {position === 'RIGHT' ? (
          <>
            {details}
            {logo}
          </>
        ) : (
          <div className={cn('flex gap-4', centred ? 'flex-col items-center' : 'items-start')}>
            {logo}
            {details}
          </div>
        )}
        {asideBeside && <div className="shrink-0 text-right">{aside}</div>}
      </div>
      {aside && !asideBeside && <div className="mt-2 text-right">{aside}</div>}
      {title && <div className={cn('mt-3', centred && 'text-center')}>{title}</div>}
    </header>
  );
}

/** The clinic's footer line at the end of a printed document (Settings → Branding). */
export function LetterFooter({ branding: given }: { branding?: Branding | null }) {
  const session = useOptionalSession();
  const b = given !== undefined ? given : (session?.session.organization?.branding ?? null);
  if (!b?.printFooterText) return null;
  return (
    <footer className="mt-8 border-t pt-2 text-center text-[9pt] text-gray-600" style={{ borderColor: accentOf(b) }}>
      <p className="whitespace-pre-line">{b.printFooterText}</p>
    </footer>
  );
}
