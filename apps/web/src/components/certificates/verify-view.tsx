'use client';
import { useQuery } from '@tanstack/react-query';
import { formatVerificationCode, normaliseVerificationCode, type CertificateVerification } from '@vcms/shared';
import { BadgeCheck, CircleAlert, Clock, Loader2, Search, ShieldCheck, ShieldX } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { api } from '@/lib/api';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Type or scan a code (barcode scanners type it in and press Enter). */
export function VerifyForm({ initial = '' }: { initial?: string }) {
  const router = useRouter();
  const [code, setCode] = useState(initial);
  const clean = normaliseVerificationCode(code);
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (clean.length === 12) router.push(`/verify/${clean}`);
      }}
    >
      <Input aria-label="Verification code" autoFocus={!initial} className="font-mono uppercase tracking-wider" placeholder="XXXX-XXXX-XXXX" value={code} onChange={(e) => setCode(e.target.value)} />
      <Button type="submit" disabled={clean.length !== 12}><Search /> Check</Button>
    </form>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[9rem_1fr] sm:gap-3">
      <dt className="text-xs text-muted-foreground sm:pt-0.5">{label}</dt>
      <dd className="min-w-0 break-words text-sm font-medium">{children}</dd>
    </div>
  );
}

/** The public answer for one code: genuine and valid, expired, revoked — or not found. */
export function VerifyResult({ code }: { code: string }) {
  const q = useQuery({ queryKey: ['verify', code], queryFn: () => api.get<CertificateVerification>(`/public/certificates/${encodeURIComponent(code)}`), retry: false });
  if (q.isLoading) return <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Checking…</p>;
  if (q.error) return <p className="py-6 text-center text-sm text-destructive">{(q.error as Error).message}</p>;
  const v = q.data!;
  if (!v.found) {
    return (
      <div className="grid justify-items-center gap-2 py-6 text-center">
        <ShieldX className="h-12 w-12 text-destructive" />
        <p className="text-lg font-semibold">No certificate has this code</p>
        <p className="max-w-sm text-sm text-muted-foreground">Check the code ({formatVerificationCode(normaliseVerificationCode(code))}) and try again. A certificate that can’t be found here was not issued by this clinic.</p>
      </div>
    );
  }
  const tone = v.status === 'VALID' ? 'success' : v.status === 'EXPIRED' ? 'warning' : 'destructive';
  const Icon = v.status === 'VALID' ? BadgeCheck : v.status === 'EXPIRED' ? Clock : CircleAlert;
  return (
    <div className="grid gap-5">
      <div className={cn('flex items-center gap-3 rounded-xl p-4 ring-1 ring-inset', tone === 'success' && 'bg-success/10 ring-success/25', tone === 'warning' && 'bg-warning/10 ring-warning/30', tone === 'destructive' && 'bg-destructive/10 ring-destructive/25')}>
        <Icon className={cn('h-10 w-10 shrink-0', tone === 'success' && 'text-success', tone === 'warning' && 'text-warning', tone === 'destructive' && 'text-destructive')} />
        <div>
          <p className="text-lg font-semibold">
            {v.status === 'VALID' ? 'Genuine and valid' : v.status === 'EXPIRED' ? `Genuine, but expired on ${fmtDate(v.validUntil)}` : 'This certificate was revoked'}
          </p>
          <p className="text-sm text-muted-foreground">
            {v.status === 'REVOKED' ? `${v.revokedAt ? `On ${fmtDate(v.revokedAt)}` : ''}${v.revokedReason ? ` — ${v.revokedReason}` : ''}${v.replacedBy ? `. Replaced by ${v.replacedBy}.` : ''}` : `Issued by ${v.clinic}.`}
          </p>
        </div>
      </div>
      <dl className="grid gap-3">
        <Row label="Certificate">{v.title}</Row>
        <Row label="Number">{v.number}</Row>
        <Row label="For">{v.subject}</Row>
        {v.owner && <Row label="Owner">{v.owner}</Row>}
        <Row label="Issued">{v.issuedAt ? fmtDateTime(v.issuedAt) : ''} by {v.issuedBy}</Row>
        <Row label="Valid until">{v.validUntil ? fmtDate(v.validUntil) : 'No expiry'}</Row>
        <Row label="Clinic">{v.clinic}</Row>
        <Row label="Fingerprint"><span className="break-all font-mono text-2xs font-normal text-muted-foreground">{v.contentHash}</span></Row>
      </dl>
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        Compare these details with the paper certificate. If anything differs, the paper copy has been altered — contact the clinic.
      </p>
    </div>
  );
}

export function VerifyShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-canvas flex min-h-screen items-start justify-center px-4 py-10 sm:py-16">
      <div className="w-full max-w-xl rounded-2xl surface-strong p-6 shadow-pop sm:p-8">
        <h1 className="mb-1 flex items-center gap-2 text-xl font-semibold tracking-tight"><ShieldCheck className="h-6 w-6 text-primary" /> Certificate check</h1>
        <p className="mb-5 text-sm text-muted-foreground">Scan the QR code on a certificate, or type its verification code.</p>
        {children}
      </div>
    </div>
  );
}
