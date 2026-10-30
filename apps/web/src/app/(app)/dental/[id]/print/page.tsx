'use client';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { ClinicHeader } from '@/components/billing/invoice-document';
import { DentalReport } from '@/components/dental/dental-report';
import { ErrorState, LoadingRows } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import type { DentalChart } from '@/lib/types';

function Report() {
  const { id } = useParams<{ id: string }>();
  const chart = useQuery({ queryKey: ['dental-chart', id], queryFn: () => api.get<DentalChart>(`/dental/charts/${id}`) });
  const org = useQuery({ queryKey: ['organization'], queryFn: () => api.get<ClinicHeader>('/organization'), staleTime: 300_000 });
  if (chart.isLoading || org.isLoading) return <LoadingRows />;
  if (chart.error || !chart.data) return <ErrorState error={chart.error} onRetry={() => chart.refetch()} />;
  return (
    <>
      <div className="no-print mb-4 flex items-center justify-between">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/dental/${id}`}>
            <ArrowLeft /> Back to the chart
          </Link>
        </Button>
        <Button size="sm" onClick={() => window.print()}>
          <Printer /> Print
        </Button>
      </div>
      <div className="rounded-lg border shadow-sm print:border-0 print:shadow-none">
        <DentalReport chart={chart.data} clinic={org.data ?? null} />
      </div>
    </>
  );
}

export default function DentalReportPage() {
  return (
    <RequirePermission anyOf={['clinical.read']}>
      <Report />
    </RequirePermission>
  );
}
