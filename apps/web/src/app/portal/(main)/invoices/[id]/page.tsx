'use client';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { useParams } from 'next/navigation';
import { InvoiceDocument, type ClinicHeader } from '@/components/billing/invoice-document';
import { ErrorState, LoadingRows } from '@/components/page';
import { Button } from '@/components/ui/button';
import { portalApi } from '@/lib/portal-api';
import type { Invoice } from '@/lib/types';

export default function PortalInvoice() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: ['portal', 'invoice', id], queryFn: () => portalApi.get<{ invoice: Invoice; clinic: ClinicHeader }>(`/invoices/${id}`) });
  if (q.isLoading) return <LoadingRows />;
  if (q.error || !q.data) return <ErrorState error={q.error} />;
  return (
    <div className="grid gap-3">
      <div className="no-print flex justify-end"><Button size="sm" onClick={() => window.print()}><Printer /> Print or save as PDF</Button></div>
      <div className="overflow-x-auto rounded-lg border bg-white shadow-sm print:border-0 print:shadow-none"><InvoiceDocument invoice={q.data.invoice} clinic={q.data.clinic} /></div>
    </div>
  );
}
