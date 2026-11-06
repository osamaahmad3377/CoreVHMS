'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { issuePermissionFor, pageMm } from '@vcms/shared';
import { Ban, Copy, ExternalLink, FilePenLine, Printer, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { CertificateStateBadge } from '@/components/certificates/badges';
import { CertificatePage, FitCertificate, type CertificateData } from '@/components/certificates/certificate-page';
import { SendToOwner } from '@/components/diary/send-buttons';
import { IssueCertificateDialog } from '@/components/certificates/issue-dialog';
import type { CertificateDetail } from '@/components/certificates/types';
import { FormError } from '@/components/forms/form-error';
import { ErrorState, LoadingRows, PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/input';
import { api } from '@/lib/api';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';

/** Puts the print copy straight into <body>, so printing can leave out the rest of the app entirely. */
function PrintRoot({ children }: { children: React.ReactNode }) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const el = document.createElement('div');
    el.className = 'cert-print-root';
    el.style.display = 'none';
    document.body.appendChild(el);
    setNode(el);
    return () => el.remove();
  }, []);
  return node ? createPortal(children, node) : null;
}

/** A diagonal stamp across a certificate that is no longer valid (on screen and on paper). */
function Stamp({ text }: { text: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <span style={{ transform: 'rotate(-28deg)', border: '1.4mm solid rgba(220,38,38,0.55)', color: 'rgba(220,38,38,0.55)', fontSize: '44pt', fontWeight: 800, letterSpacing: '6pt', padding: '2mm 8mm', borderRadius: '3mm' }}>{text}</span>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-sm">{children}</dd>
    </div>
  );
}

function RevokeDialog({ c, open, onOpenChange }: { c: CertificateDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => api.post(`/certificates/${c.id}/revoke`, { reason }),
    onSuccess: () => {
      toast.success(`${c.certificateNo} revoked`);
      qc.invalidateQueries({ queryKey: ['certificate', c.id] });
      qc.invalidateQueries({ queryKey: ['certificates'] });
      onOpenChange(false);
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Revoke {c.certificateNo}?</DialogTitle>
          <DialogDescription>Anyone who scans its QR code will see it is revoked, and why. This can’t be undone — to fix a mistake, use “Correct” instead, which issues a new one.</DialogDescription>
        </DialogHeader>
        {m.error && <FormError error={m.error} />}
        <label className="grid gap-1 text-sm font-medium">
          Reason
          <Textarea rows={3} maxLength={500} value={reason} placeholder="e.g. issued for the wrong animal" onChange={(e) => setReason(e.target.value)} />
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" disabled={reason.trim().length < 3} loading={m.isPending} onClick={() => m.mutate()}><Ban /> Revoke</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CertificateView() {
  const { id } = useParams<{ id: string }>();
  const { can, session } = useSession();
  const q = useQuery({ queryKey: ['certificate', id], queryFn: () => api.get<CertificateDetail>(`/certificates/${id}`) });
  const [revoking, setRevoking] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  if (q.isLoading) return <LoadingRows />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const c = q.data;
  const data: CertificateData = { fields: c.data.fields, table: c.data.table, qrValue: c.verifyUrl, barcodeValue: c.verificationCode.replace(/-/g, ''), logoUrl: session.organization?.logoUrl ?? null };
  const { w, h } = pageMm(c.layout.page);
  const mayIssue = can(issuePermissionFor(c.kind) as 'certificates.issue');
  const stamp = c.state === 'REVOKED' ? 'REVOKED' : c.state === 'EXPIRED' ? 'EXPIRED' : null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(c.verifyUrl);
      toast.success('Verification link copied');
    } catch {
      toast.error('Could not copy');
    }
  };

  return (
    <>
      {/* Print exactly one page at the certificate's own size: the certificate sits directly in <body>, everything else is left out. */}
      <style>{`@media print { @page { size: ${w}mm ${h}mm; margin: 0 } html, body { margin: 0 !important; padding: 0 !important; height: auto !important; min-height: 0 !important; background: #fff !important } body > *:not(.cert-print-root) { display: none !important } .cert-print-root { display: block !important } }`}</style>
      <PrintRoot>
        <CertificatePage layout={c.layout} data={data}>{stamp && <Stamp text={stamp} />}</CertificatePage>
      </PrintRoot>

      <PageHeader
        breadcrumbs={[{ label: 'Certificates', href: '/certificates' }, { label: c.certificateNo }]}
        title={<span className="flex flex-wrap items-center gap-2">{c.title} <CertificateStateBadge state={c.state} /></span>}
        description={`${c.certificateNo} · ${c.subjectName} · issued ${fmtDate(c.issuedAt)} by ${c.issuedByName}`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={copy}><Copy /> Verification link</Button>
            {c.subject === 'PATIENT' && c.status === 'ISSUED' && <SendToOwner path={`/certificates/${c.id}/send`} />}
            {mayIssue && c.status === 'ISSUED' && <Button variant="outline" size="sm" onClick={() => setCorrecting(true)}><FilePenLine /> Correct</Button>}
            {mayIssue && c.status === 'ISSUED' && <Button variant="outline" size="sm" className="text-destructive" onClick={() => setRevoking(true)}><Ban /> Revoke</Button>}
            <Button size="sm" onClick={() => window.print()}><Printer /> Print</Button>
          </>
        }
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="relative min-w-0 rounded-xl bg-muted/40 p-3 sm:p-5">
          <div className="relative">
            <FitCertificate layout={c.layout} data={data} maxWidth={860} />
          </div>
          {stamp && (
            <p className="mt-3 text-center text-sm font-medium text-destructive">
              {stamp === 'REVOKED' ? `Revoked ${c.revokedAt ? fmtDate(c.revokedAt) : ''} by ${c.revokedByName}: ${c.revokedReason}` : `Expired on ${fmtDate(c.validUntil)}`} — printed copies show “{stamp}”.
            </p>
          )}
        </div>
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Details</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid gap-3">
                <Detail label="For">
                  {c.patient ? <Link className="text-primary hover:underline" href={`/patients/${c.patient.id}?tab=certificates`}>{c.patient.name} ({c.patient.species}, {c.patient.patientNo})</Link> : <>{c.subjectName}{c.membership?.jobTitle ? ` — ${c.membership.jobTitle}` : ''}</>}
                </Detail>
                <Detail label="Kind">{c.kindLabel}</Detail>
                <Detail label="Issued">{fmtDateTime(c.issuedAt)} by {c.issuedByName}</Detail>
                <Detail label="Valid until">{c.validUntil ? fmtDate(c.validUntil) : 'No expiry'}</Detail>
                <Detail label="Template">{c.templateName}</Detail>
                {c.encounterId && <Detail label="Consultation"><Link className="text-primary hover:underline" href={`/consultations/${c.encounterId}`}>Open the consultation</Link></Detail>}
                {c.replaces && <Detail label="Corrects"><Link className="text-primary hover:underline" href={`/certificates/${c.replaces.id}`}>{c.replaces.certificateNo}</Link></Detail>}
                {c.replacedBy && <Detail label="Replaced by"><Link className="text-primary hover:underline" href={`/certificates/${c.replacedBy.id}`}>{c.replacedBy.certificateNo}</Link></Detail>}
                {c.status === 'REVOKED' && <Detail label="Revoked">{c.revokedAt ? fmtDateTime(c.revokedAt) : ''} by {c.revokedByName} — {c.revokedReason}</Detail>}
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4 text-success" /> Verification</CardTitle></CardHeader>
            <CardContent className="grid gap-3 text-sm">
              <Detail label="Code"><span className="font-mono tracking-wider">{c.verificationCode}</span></Detail>
              <Detail label="Checked at">
                <a href={c.verifyUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 break-all text-primary hover:underline">{c.verifyUrl.replace(/^https?:\/\//, '')} <ExternalLink className="h-3 w-3 shrink-0" /></a>
              </Detail>
              <Detail label="Fingerprint (SHA-256)"><span className="break-all font-mono text-2xs text-muted-foreground">{c.contentHash}</span></Detail>
              <p className="text-xs text-muted-foreground">Scanning the QR code shows whether it is valid, expired or revoked. The certificate itself can never be changed.</p>
            </CardContent>
          </Card>
        </div>
      </div>
      {revoking && <RevokeDialog c={c} open onOpenChange={setRevoking} />}
      {correcting && (
        <IssueCertificateDialog
          open
          onOpenChange={setCorrecting}
          subject={c.subject}
          patient={c.patient ? { id: c.patient.id, name: c.patient.name } : null}
          membership={c.membership ? { id: c.membership.id, name: c.membership.name } : null}
          encounterId={c.encounterId}
          reissue={{ id: c.id, certificateNo: c.certificateNo, kind: c.kind, inputs: c.inputs, validUntil: c.validUntil, templateId: c.templateId }}
        />
      )}
    </>
  );
}

export default function CertificatePageRoute() {
  return (
    <RequirePermission anyOf={['certificates.read', 'certificates.staff']}>
      <CertificateView />
    </RequirePermission>
  );
}
