'use client';
import { useQuery } from '@tanstack/react-query';
import { formatVerificationCode, normaliseVerificationCode, type CertificateLayout, type CertificateVerification, type HostInfo } from '@vcms/shared';
import { BadgeCheck, CalendarClock, CircleAlert, Clock, Globe, Loader2, Mail, MapPin, PawPrint, Phone, Search, ShieldCheck, ShieldX, Stethoscope, User } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FitCertificate, type CertificateData } from './certificate-page';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { api } from '@/lib/api';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

/** The clinic whose address this is: its name, logo and colours (public; the colours are applied by the layout). */
export function useClinic() {
  const q = useQuery({ queryKey: ['host-info'], queryFn: () => api.get<HostInfo>('/tenant'), staleTime: 300_000, retry: false });
  const { resolvedTheme } = useTheme();
  const b = q.data?.clinic?.branding;
  const logo = resolvedTheme === 'dark' ? (b?.logoDarkUrl ?? b?.logoUrl) : b?.logoUrl;
  return { name: b?.brandName ?? q.data?.clinic?.name ?? null, logo: logo ?? null, color: b?.primaryColor ?? null };
}

/** Type or scan a code (barcode scanners type it in and press Enter). */
export function VerifyForm({ initial = '' }: { initial?: string }) {
  const router = useRouter();
  const [code, setCode] = useState(initial);
  const clean = normaliseVerificationCode(code);
  return (
    <form
      className="flex flex-col gap-2 sm:flex-row"
      onSubmit={(e) => {
        e.preventDefault();
        if (clean.length === 12) router.push(`/verify/${clean}`);
      }}
    >
      <Input aria-label="Verification code" autoFocus={!initial} autoComplete="off" spellCheck={false} className="h-11 flex-1 font-mono text-base uppercase tracking-[0.18em]" placeholder="XXXX-XXXX-XXXX" value={code} onChange={(e) => setCode(e.target.value)} />
      <Button type="submit" size="lg" disabled={clean.length !== 12}><Search /> Check</Button>
    </form>
  );
}

function Fact({ icon: Icon, label, children }: { icon: React.ComponentType<{ className?: string }>; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <dt className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</dt>
        <dd className="mt-0.5 break-words text-sm font-medium">{children}</dd>
      </div>
    </div>
  );
}

const TONES = {
  VALID: { band: 'bg-success text-white', icon: BadgeCheck, title: 'Genuine and valid', ring: 'ring-success/30' },
  EXPIRED: { band: 'bg-warning text-warning-foreground', icon: Clock, title: 'Genuine, but expired', ring: 'ring-warning/40' },
  REVOKED: { band: 'bg-destructive text-white', icon: CircleAlert, title: 'This certificate has been revoked', ring: 'ring-destructive/30' },
} as const;

/** The public answer for one code: genuine and valid, expired, revoked — or not found. */
export function VerifyResult({ code }: { code: string }) {
  const q = useQuery({ queryKey: ['verify', code], queryFn: () => api.get<CertificateVerification>(`/public/certificates/${encodeURIComponent(code)}`), retry: false });
  if (q.isLoading) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl surface-strong px-6 py-16 text-center shadow-pop">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Checking the certificate…</p>
      </div>
    );
  }
  if (q.error) {
    return <div className="rounded-2xl surface-strong p-8 text-center text-sm text-destructive shadow-pop">{(q.error as Error).message}</div>;
  }
  const v = q.data!;
  if (!v.found) {
    return (
      <div className="overflow-hidden rounded-2xl surface-strong shadow-pop ring-1 ring-destructive/25">
        <div className="flex items-center gap-3 bg-destructive px-6 py-4 text-white">
          <ShieldX className="h-7 w-7 shrink-0" />
          <p className="text-lg font-semibold">Certificate not found</p>
        </div>
        <div className="grid gap-3 p-6 text-sm">
          <p>
            No certificate was issued with the code <span className="font-mono font-semibold tracking-wider">{formatVerificationCode(normaliseVerificationCode(code)) || code}</span>.
          </p>
          <p className="text-muted-foreground">Check the code on the certificate and try again. A certificate that can’t be found here was not issued by this clinic — please contact the clinic if you are unsure.</p>
        </div>
      </div>
    );
  }
  const tone = TONES[v.status!];
  const Icon = tone.icon;
  const staff = !v.owner;
  return (
    <article className={cn('overflow-hidden rounded-2xl surface-strong shadow-pop ring-1', tone.ring)} aria-label="Certificate check result">
      {/* The answer, first and unmistakable. */}
      <div className={cn('flex items-center gap-4 px-5 py-5 sm:px-8', tone.band)} role="status">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white/20">
          <Icon className="h-8 w-8" />
        </span>
        <div className="min-w-0">
          <p className="text-xl font-bold leading-tight sm:text-2xl">{v.status === 'EXPIRED' ? `${tone.title} on ${fmtDate(v.validUntil)}` : tone.title}</p>
          <p className="mt-0.5 text-sm opacity-90">
            {v.status === 'VALID' && `Issued by ${v.clinic}.`}
            {v.status === 'EXPIRED' && `Issued by ${v.clinic}. It was valid when issued, but is no longer current.`}
            {v.status === 'REVOKED' && `${v.revokedAt ? `Revoked on ${fmtDate(v.revokedAt)}. ` : ''}${v.replacedBy ? `Replaced by ${v.replacedBy}.` : 'Do not accept it.'}`}
          </p>
        </div>
      </div>

      <div className="grid gap-6 p-5 sm:p-8">
        {v.status === 'REVOKED' && v.revokedReason && (
          <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <span className="font-semibold">Reason: </span>
            {v.revokedReason}
          </p>
        )}
        <header className="flex flex-wrap items-start justify-between gap-3 border-b pb-5">
          <div className="min-w-0">
            <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">{v.kindLabel}</p>
            <h2 className="mt-1 text-2xl font-bold leading-tight tracking-tight">{v.title}</h2>
          </div>
          <span className="rounded-pill bg-primary/10 px-3 py-1 font-mono text-sm font-semibold tracking-wider text-primary">{v.number}</span>
        </header>

        <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          <Fact icon={staff ? User : PawPrint} label={staff ? 'Issued to' : 'Patient'}>{v.subject}</Fact>
          {v.owner && <Fact icon={User} label="Owner">{v.owner}</Fact>}
          <Fact icon={CalendarClock} label="Issued">{v.issuedAt ? fmtDateTime(v.issuedAt) : '—'}</Fact>
          <Fact icon={Clock} label="Valid until">{v.validUntil ? fmtDate(v.validUntil) : 'No expiry'}</Fact>
          <Fact icon={Stethoscope} label="Issued by">{v.issuedBy}</Fact>
          <Fact icon={ShieldCheck} label="Clinic">{v.clinic}</Fact>
        </dl>

        <div className="rounded-xl bg-muted/50 p-4 text-xs leading-relaxed text-muted-foreground">
          <p className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span>
              <b className="text-foreground">Compare these details with the paper certificate.</b> If anything differs, the copy you hold has been altered — please contact the clinic.
            </span>
          </p>
          {v.contentHash && (
            <details className="mt-3 pl-6">
              <summary className="cursor-pointer select-none font-medium text-foreground">Technical details</summary>
              <p className="mt-2">Fingerprint (SHA-256) of what was printed:</p>
              <p className="mt-1 break-all font-mono text-2xs">{v.contentHash}</p>
            </details>
          )}
        </div>

        {v.clinicContact && (v.clinicContact.phone || v.clinicContact.email || v.clinicContact.website || v.clinicContact.address) && (
          <footer className="grid gap-2 border-t pt-5 text-sm sm:grid-cols-2">
            {v.clinicContact.phone && (
              <a href={`tel:${v.clinicContact.phone.replace(/\s/g, '')}`} className="flex items-center gap-2 hover:text-primary"><Phone className="h-4 w-4 text-muted-foreground" /> {v.clinicContact.phone}</a>
            )}
            {v.clinicContact.email && (
              <a href={`mailto:${v.clinicContact.email}`} className="flex min-w-0 items-center gap-2 break-all hover:text-primary"><Mail className="h-4 w-4 shrink-0 text-muted-foreground" /> {v.clinicContact.email}</a>
            )}
            {v.clinicContact.website && (
              <a href={/^https?:\/\//.test(v.clinicContact.website) ? v.clinicContact.website : `https://${v.clinicContact.website}`} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-2 break-all hover:text-primary"><Globe className="h-4 w-4 shrink-0 text-muted-foreground" /> {v.clinicContact.website.replace(/^https?:\/\//, '')}</a>
            )}
            {v.clinicContact.address && <p className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /> {v.clinicContact.address}</p>}
          </footer>
        )}
      </div>
    </article>
  );
}


/** The certificate as printed, for the owner behind the link (patient certificates that are still in force). */
export function CertificateCopy({ code }: { code: string }) {
  const { logo } = useClinic();
  const q = useQuery({
    queryKey: ['verify-document', code],
    queryFn: () => api.get<{ fields: Record<string, string>; table: CertificateData['table']; layout: CertificateLayout; qrValue: string; barcodeValue: string }>(`/public/certificates/${encodeURIComponent(code)}/document`),
    retry: false,
  });
  if (!q.data) return null;
  const d = q.data;
  return (
    <section className="grid gap-3 rounded-2xl surface-strong p-5 shadow-card" aria-label="The certificate">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">The certificate</p>
        <Button variant="outline" size="sm" onClick={() => window.print()}>Print</Button>
      </div>
      <div className="overflow-hidden rounded-lg border bg-white p-2">
        <FitCertificate layout={d.layout} data={{ fields: d.fields, table: d.table, qrValue: d.qrValue, barcodeValue: d.barcodeValue, logoUrl: logo }} maxWidth={620} />
      </div>
    </section>
  );
}

/** The clinic's logo and name over the page, then whatever the page shows. */
export function VerifyShell({ children, title = 'Certificate verification', note = 'Certificates carry a QR code and a verification code. Anyone can check one here, without signing in.', wide }: { children: React.ReactNode; title?: string; note?: string; wide?: boolean }) {
  const { name, logo } = useClinic();
  return (
    <div className="app-canvas min-h-screen">
      <div className={cn('mx-auto w-full px-4 pb-16 pt-8 sm:pt-12', wide ? 'max-w-4xl' : 'max-w-2xl')}>
        <header className="mb-6 flex flex-col items-center gap-3 text-center sm:mb-8">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt={name ?? ''} className="h-16 max-w-[220px] object-contain sm:h-20" />
          ) : (
            <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-brand-2 text-3xl font-bold text-white shadow-glow" aria-hidden>
              {(name ?? 'C').trim().charAt(0).toUpperCase()}
            </span>
          )}
          <div>
            {name && <p className="text-xl font-bold tracking-tight sm:text-2xl">{name}</p>}
            <p className="mt-1 flex items-center justify-center gap-1.5 text-sm font-medium text-muted-foreground">
              <ShieldCheck className="h-4 w-4 text-primary" /> {title}
            </p>
          </div>
        </header>
        {children}
        <p className="mt-8 text-center text-xs text-muted-foreground">{note}</p>
      </div>
    </div>
  );
}
