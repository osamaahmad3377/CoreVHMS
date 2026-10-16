'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Paginated } from '@vcms/shared';
import { enumLabel } from '@vcms/shared';
import { ListChecks } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import { toast } from 'sonner';
import { CommerceBadge } from '@/components/billing/status';
import { BILLING_LINKS, SectionNav } from '@/components/billing/section-nav';
import { useConfirm } from '@/components/confirm';
import { DataTable } from '@/components/data-table';
import { EmptyState, PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useUrlState } from '@/hooks/use-url-state';
import { api, qs } from '@/lib/api';
import { fmtDateTime, fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { Charge } from '@/lib/types';
import { cn } from '@/lib/utils';

const SOURCE_LABEL: Record<string, string> = { Dispensation: 'Dispensed', Administration: 'Administered', DiagnosticOrderItem: 'Lab test', Encounter: 'Consultation' };

function Charges() {
  const { can, currency } = useSession();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const url = useUrlState();
  const params = { status: url.get('status', 'PENDING'), page: Number(url.get('page', '1')), pageSize: 50 };
  const query = useQuery({ queryKey: ['charges', params], queryFn: () => api.get<Paginated<Charge> & { totalMinor: number }>(`/charges${qs(params)}`), placeholderData: (p) => p });
  const act = useMutation({
    mutationFn: ({ id, action, reason }: { id: string; action: 'waive' | 'restore'; reason?: string }) => api.post(`/charges/${id}/${action}`, { reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['charges'] }),
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <>
      <PageHeader
        help="invoice" title="Unbilled charges" breadcrumbs={[{ label: 'Billing', href: '/billing' }, { label: 'Unbilled charges' }]} description="Captured automatically when medicines are dispensed or administered, lab tests ordered and consultations completed." />
      <SectionNav links={BILLING_LINKS} />
      <Card>
        <div className="flex flex-wrap items-center gap-1 border-b p-3" role="tablist">
          {['PENDING', 'INVOICED', 'WAIVED', 'ALL'].map((s) => (
            <button key={s} role="tab" aria-selected={params.status === s} onClick={() => url.set({ status: s, page: 1 })} className={cn('rounded-md px-3 py-1.5 text-sm', params.status === s ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}>
              {s === 'PENDING' ? 'Unbilled' : enumLabel(s)}
            </button>
          ))}
          {query.data && <span className="ml-auto text-sm text-muted-foreground">Total <b className="tabular text-foreground">{fmtMoney(query.data.totalMinor, currency)}</b> (before tax)</span>}
        </div>
        <DataTable
          query={query}
          rowKey={(r) => r.id}
          page={params.page}
          pageSize={50}
          onPage={(page) => url.set({ page })}
          empty={<EmptyState icon={ListChecks} title="No charges" description="Nothing is waiting to be invoiced." />}
          columns={[
            { key: 'client', header: 'Client', cell: (r) => <Link className="text-sm font-medium hover:underline" href={`/clients/${r.client.id}?tab=account`}>{r.client.displayName}</Link> },
            { key: 'item', header: 'Item', cell: (r) => <div><p className="text-sm">{r.description}</p><p className="text-xs text-muted-foreground">{SOURCE_LABEL[r.sourceType] ?? r.sourceType}{r.patient && ` · ${r.patient.name}`}{r.waivedReason && ` · waived: ${r.waivedReason}`}</p></div> },
            { key: 'when', header: 'Captured', cell: (r) => <span className="whitespace-nowrap text-xs">{fmtDateTime(r.createdAt)}{r.createdByName && <span className="block text-muted-foreground">{r.createdByName}</span>}</span> },
            { key: 'amt', header: 'Amount', className: 'text-right tabular', headerClassName: 'text-right', cell: (r) => <span>{r.quantity} × {fmtMoney(r.unitPriceMinor, currency)}<span className="block font-medium">{fmtMoney(Math.round(r.quantity * r.unitPriceMinor), currency)}</span></span> },
            { key: 'st', header: 'Status', cell: (r) => <CommerceBadge status={r.status} /> },
            {
              key: 'act',
              header: '',
              cell: (r) => (
                <div className="flex justify-end gap-1">
                  {r.status === 'PENDING' && can('billing.write') && <Button size="sm" variant="outline" asChild><Link href={`/billing/invoices/new?clientId=${r.clientId}`}>Invoice client</Link></Button>}
                  {r.status === 'PENDING' && can('billing.void') && (
                    <Button size="sm" variant="ghost" onClick={async () => { const c = await confirm({ title: 'Waive this charge?', description: `${r.description} will not be billed.`, requireReason: true, confirmLabel: 'Waive' }); if (c.confirmed) act.mutate({ id: r.id, action: 'waive', reason: c.reason }); }}>Waive</Button>
                  )}
                  {r.status === 'WAIVED' && can('billing.write') && <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: r.id, action: 'restore' })}>Restore</Button>}
                </div>
              ),
            },
          ]}
        />
      </Card>
    </>
  );
}

export default function ChargesPage() {
  return (
    <RequirePermission anyOf={['billing.read']}>
      <Suspense><Charges /></Suspense>
    </RequirePermission>
  );
}
