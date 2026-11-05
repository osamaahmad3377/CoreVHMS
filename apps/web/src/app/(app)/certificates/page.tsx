'use client';
import { useQuery } from '@tanstack/react-query';
import { CERTIFICATE_KIND_INFO, kindsFor, type CertificateKind, type CertificateSubject } from '@vcms/shared';
import { Award, Settings2, UserPlus, PawPrint } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CertificateStateBadge } from '@/components/certificates/badges';
import { IssueCertificateDialog } from '@/components/certificates/issue-dialog';
import type { CertificateRow } from '@/components/certificates/types';
import { DataTable } from '@/components/data-table';
import { EmptyState, PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { SearchInput } from '@/components/search-input';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, qs } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { useSession } from '@/lib/session';

export default function CertificatesPage() {
  const { can } = useSession();
  const router = useRouter();
  const subjects: CertificateSubject[] = [...(can('certificates.read') ? (['PATIENT'] as const) : []), ...(can('certificates.staff') ? (['STAFF'] as const) : [])];
  const [subject, setSubject] = useState<CertificateSubject>(subjects[0] ?? 'PATIENT');
  const [kind, setKind] = useState<CertificateKind | ''>('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [issuing, setIssuing] = useState<CertificateSubject | null>(null);
  const list = useQuery({
    queryKey: ['certificates', subject, kind, status, q, page],
    queryFn: () => api.get<{ data: CertificateRow[]; meta: { total: number; page: number; pageSize: number } }>(`/certificates${qs({ subject, kind: kind || undefined, status: status || undefined, q: q || undefined, page })}`),
  });
  const reset = () => setPage(1);

  return (
    <RequirePermission anyOf={['certificates.read', 'certificates.staff']}>
      <PageHeader
        title="Certificates"
        description="Vaccination, health, travel and other patient certificates, and certificates for your staff — each with a QR code anyone can scan to check it."
        actions={
          <>
            {can('certificates.templates') && (
              <Button size="sm" variant="ghost" asChild>
                <Link href="/settings/certificate-templates"><Settings2 /> Templates</Link>
              </Button>
            )}
            {can('certificates.staff') && <Button size="sm" variant="outline" onClick={() => setIssuing('STAFF')}><UserPlus /> Staff certificate</Button>}
            {can('certificates.issue') && <Button size="sm" onClick={() => setIssuing('PATIENT')}><PawPrint /> Patient certificate</Button>}
          </>
        }
      />
      <Card>
        <CardHeader className="flex-wrap gap-2">
          {subjects.length > 1 ? (
            <Tabs value={subject} onValueChange={(v) => { setSubject(v as CertificateSubject); setKind(''); reset(); }}>
              <TabsList>
                <TabsTrigger value="PATIENT">Patients</TabsTrigger>
                <TabsTrigger value="STAFF">Staff</TabsTrigger>
              </TabsList>
            </Tabs>
          ) : <span />}
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect aria-label="Kind" className="h-9 w-auto" value={kind} onChange={(e) => { setKind(e.target.value as CertificateKind | ''); reset(); }}>
              <option value="">All kinds</option>
              {kindsFor(subject).map((k) => <option key={k} value={k}>{CERTIFICATE_KIND_INFO[k].label}</option>)}
            </NativeSelect>
            <NativeSelect aria-label="Status" className="h-9 w-auto" value={status} onChange={(e) => { setStatus(e.target.value); reset(); }}>
              <option value="">Any status</option>
              <option value="ISSUED">Valid</option>
              <option value="EXPIRED">Expired</option>
              <option value="REVOKED">Revoked</option>
            </NativeSelect>
            <SearchInput value={q} onChange={(v) => { setQ(v); reset(); }} placeholder="Name, number or code" />
          </div>
        </CardHeader>
        <DataTable
          query={list}
          rowKey={(c) => c.id}
          onRowClick={(c) => router.push(`/certificates/${c.id}`)}
          page={page}
          onPage={setPage}
          empty={<EmptyState icon={Award} title="No certificates yet" description={subject === 'PATIENT' ? 'Issue one from here, or from the patient’s Certificates tab.' : 'Issue one from here, or from Settings → Staff accounts.'} />}
          columns={[
            { key: 'no', header: 'Number', className: 'whitespace-nowrap', cell: (c) => <span className="font-medium tabular">{c.certificateNo}</span> },
            { key: 'title', header: 'Certificate', cell: (c) => <span className="text-sm">{c.title}</span> },
            {
              key: 'for',
              header: subject === 'PATIENT' ? 'Patient' : 'Staff member',
              cell: (c) =>
                c.patient ? (
                  <span className="text-sm">{c.patient.name} <span className="text-xs text-muted-foreground">{c.patient.species} · {c.patient.patientNo}</span></span>
                ) : (
                  <span className="text-sm">{c.subjectName}{c.membership?.jobTitle ? <span className="text-xs text-muted-foreground"> · {c.membership.jobTitle}</span> : null}</span>
                ),
            },
            { key: 'issued', header: 'Issued', className: 'whitespace-nowrap', cell: (c) => <span className="text-sm">{fmtDate(c.issuedAt)}<span className="block text-xs text-muted-foreground">{c.issuedByName}</span></span> },
            { key: 'valid', header: 'Valid until', className: 'whitespace-nowrap', cell: (c) => <span className="text-sm">{c.validUntil ? fmtDate(c.validUntil) : 'No expiry'}</span> },
            { key: 'state', header: 'Status', className: 'whitespace-nowrap', cell: (c) => <CertificateStateBadge state={c.state} /> },
          ]}
        />
      </Card>
      {issuing && <IssueCertificateDialog open onOpenChange={(o) => !o && setIssuing(null)} subject={issuing} />}
    </RequirePermission>
  );
}
