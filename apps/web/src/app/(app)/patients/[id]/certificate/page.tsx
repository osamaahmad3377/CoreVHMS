'use client';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { ClinicHeader } from '@/components/billing/invoice-document';
import { ErrorState, LoadingRows } from '@/components/page';
import { CertificateDocument } from '@/components/preventive/certificate';
import { RequirePermission } from '@/components/require';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import type { VaccinationCertificate } from '@/lib/types';

function Certificate() {
  const { id } = useParams<{ id: string }>();
  const cert = useQuery({ queryKey: ['certificate', id], queryFn: () => api.get<VaccinationCertificate>(`/patients/${id}/vaccination-certificate`) });
  const org = useQuery({ queryKey: ['organization'], queryFn: () => api.get<ClinicHeader>('/organization'), staleTime: 300_000 });
  if (cert.isLoading || org.isLoading) return <LoadingRows />;
  if (cert.error || !cert.data) return <ErrorState error={cert.error} onRetry={() => cert.refetch()} />;
  return (
    <>
      <div className="no-print mb-4 flex items-center justify-between">
        <Button variant="ghost" size="sm" asChild><Link href={`/patients/${id}`}><ArrowLeft /> Back to {cert.data.patient.name}</Link></Button>
        <Button size="sm" onClick={() => window.print()}><Printer /> Print</Button>
      </div>
      <div className="rounded-lg border shadow-sm print:border-0 print:shadow-none">
        <CertificateDocument cert={cert.data} clinic={org.data ?? null} />
      </div>
    </>
  );
}

export default function CertificatePage() {
  return (
    <RequirePermission anyOf={['preventive.read']}>
      <Certificate />
    </RequirePermission>
  );
}
