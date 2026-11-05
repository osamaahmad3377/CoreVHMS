'use client';
import { useQuery } from '@tanstack/react-query';
import { Award, Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { EmptyState, ErrorState, LoadingRows } from '../page';
import { Button } from '../ui/button';
import { Card, CardHeader, CardTitle } from '../ui/card';
import { api } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import { CertificateStateBadge } from './badges';
import { IssueCertificateDialog } from './issue-dialog';
import type { CertificateRow } from './types';

/** A patient's certificates, newest first, with "Issue certificate". */
export function PatientCertificates({ patientId, patientName, encounterId }: { patientId: string; patientName: string; encounterId?: string | null }) {
  const { can } = useSession();
  const [issuing, setIssuing] = useState(false);
  const q = useQuery({ queryKey: ['certificates', 'patient', patientId], queryFn: () => api.get<{ data: CertificateRow[] }>(`/certificates?patientId=${patientId}&pageSize=100`) });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Award className="h-4 w-4 text-muted-foreground" /> Certificates</CardTitle>
        {can('certificates.issue') && <Button size="sm" onClick={() => setIssuing(true)}><Plus /> Issue certificate</Button>}
      </CardHeader>
      {q.isLoading ? (
        <LoadingRows />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data?.data.length ? (
        <ul className="divide-y">
          {q.data.data.map((c) => (
            <li key={c.id}>
              <Link href={`/certificates/${c.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-muted/40">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{c.title}</span>
                  <span className="block text-xs text-muted-foreground">{c.certificateNo} · issued {fmtDate(c.issuedAt)} by {c.issuedByName}{c.validUntil ? ` · valid until ${fmtDate(c.validUntil)}` : ''}</span>
                </span>
                <CertificateStateBadge state={c.state} />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={Award} title="No certificates yet" description="Vaccination, health, travel, microchip and other certificates for this patient appear here." />
      )}
      {issuing && <IssueCertificateDialog open onOpenChange={setIssuing} subject="PATIENT" patient={{ id: patientId, name: patientName }} encounterId={encounterId} />}
    </Card>
  );
}
