'use client';
import { useQuery } from '@tanstack/react-query';
import { Download, Printer } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { ClinicHeader } from '@/components/billing/invoice-document';
import { ErrorState, LoadingRows } from '@/components/page';
import { PatientRecordDocument, type PatientRecordData } from '@/components/patients/patient-record-document';
import { RequirePermission } from '@/components/require';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

function Record() {
  const { id } = useParams<{ id: string }>();
  const { can, currency } = useSession();
  const q = useQuery({ queryKey: ['patient-record', id], queryFn: () => api.get<PatientRecordData>(`/patients/${id}/record`), staleTime: 0 });
  const org = useQuery({ queryKey: ['organization'], queryFn: () => api.get<ClinicHeader>('/organization'), staleTime: 300_000 });
  if (q.isLoading) return <LoadingRows rows={10} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const record = q.data!;
  return (
    <>
      <div className="no-print mb-4 flex flex-wrap items-center gap-2 rounded-xl surface p-3 shadow-card">
        <div className="mr-auto">
          <p className="text-sm font-semibold">Complete record — {record.patient.name}</p>
          <p className="text-xs text-muted-foreground">Everything the clinic holds about this patient. Use Print to save it as a PDF.</p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href={`/patients/${id}`}>Back to patient</Link>
        </Button>
        <Button size="sm" onClick={() => window.print()}>
          <Printer /> Print / save as PDF
        </Button>
        {can('patients.export') && (
          <Button size="sm" variant="outline" asChild>
            <a href={`/api/v1/patients/${id}/record-export`} download>
              <Download /> Download all data
            </a>
          </Button>
        )}
      </div>
      <div className="rounded-lg border bg-white shadow-card print:rounded-none print:border-0 print:shadow-none">
        <PatientRecordDocument record={record} clinic={org.data ?? null} currency={currency} />
      </div>
    </>
  );
}

export default function PatientRecordPage() {
  return (
    <RequirePermission anyOf={['patients.read']}>
      <Record />
    </RequirePermission>
  );
}
