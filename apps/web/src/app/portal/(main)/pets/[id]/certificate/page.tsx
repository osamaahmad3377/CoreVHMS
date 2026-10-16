'use client';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { useParams } from 'next/navigation';
import { LoadingRows } from '@/components/page';
import { usePortal } from '@/components/portal/shell';
import { CertificateDocument } from '@/components/preventive/certificate';
import { Button } from '@/components/ui/button';
import { portalApi } from '@/lib/portal-api';
import type { VaccinationCertificate } from '@/lib/types';

export default function PortalCertificate() {
  const { id } = useParams<{ id: string }>();
  const s = usePortal();
  const q = useQuery({ queryKey: ['portal', 'certificate', id], queryFn: () => portalApi.get<VaccinationCertificate>(`/pets/${id}/certificate`) });
  if (!q.data) return <LoadingRows />;
  return (
    <div className="grid gap-3">
      <div className="no-print flex justify-end"><Button size="sm" onClick={() => window.print()}><Printer /> Print</Button></div>
      <div className="rounded-lg border bg-white shadow-sm print:border-0 print:shadow-none"><CertificateDocument cert={q.data} clinic={{ name: s.clinic.name, phone: s.clinic.phone, email: s.clinic.email }} /></div>
    </div>
  );
}
