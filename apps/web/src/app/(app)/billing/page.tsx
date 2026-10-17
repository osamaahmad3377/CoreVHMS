'use client';
import { useQuery } from '@tanstack/react-query';
import type { Paginated } from '@vcms/shared';
import { Plus, Receipt } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Suspense } from 'react';
import { CommerceBadge } from '@/components/billing/status';
import { BILLING_LINKS, SectionNav } from '@/components/billing/section-nav';
import { DataTable } from '@/components/data-table';
import { EmptyState, PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { SearchInput } from '@/components/search-input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useUrlState } from '@/hooks/use-url-state';
import { api, qs } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { Invoice } from '@/lib/types';
import { cn } from '@/lib/utils';

const TABS = [
  { key: 'open', label: 'Waiting for payment', params: { status: 'ISSUED,PARTIALLY_PAID' } },
  { key: 'overdue', label: 'Overdue', params: { overdue: 'true' } },
  { key: 'draft', label: 'Drafts', params: { status: 'DRAFT' } },
  { key: 'paid', label: 'Paid', params: { status: 'PAID' } },
  { key: 'void', label: 'Cancelled', params: { status: 'VOID' } },
  { key: 'all', label: 'All', params: {} },
];

function Invoices() {
  const router = useRouter();
  const { can, currency } = useSession();
  const url = useUrlState();
  const tab = TABS.find((t) => t.key === url.get('tab', 'open')) ?? TABS[0];
  const params = { ...tab.params, q: url.get('q'), page: Number(url.get('page', '1')), pageSize: 25 };
  const query = useQuery({ queryKey: ['invoices', params], queryFn: () => api.get<Paginated<Invoice>>(`/invoices${qs(params)}`), placeholderData: (p) => p });
  // Guide the user to the next step when nothing is invoiced yet but work is waiting to be billed.
  const unbilled = useQuery({ queryKey: ['charges', 'pending-count'], queryFn: () => api.get<Paginated<unknown> & { totalMinor: number }>(`/charges${qs({ status: 'PENDING', pageSize: 1 })}`), enabled: can('billing.read') });
  const waiting = unbilled.data?.meta.total ?? 0;
  return (
    <>
      <PageHeader
        help="invoice"
        title="Billing"
        description="Invoices, payments and refunds. Work done in the clinic waits in “Not yet invoiced” until you bill it."
        actions={can('billing.write') && <Button size="sm" asChild><Link href="/billing/invoices/new"><Plus /> New invoice</Link></Button>}
      />
      <SectionNav links={BILLING_LINKS} />
      <Card>
        <div className="flex flex-col gap-2 border-b p-3 lg:flex-row lg:items-center">
          <div className="flex flex-wrap gap-1" role="tablist">
            {TABS.map((t) => (
              <button key={t.key} role="tab" aria-selected={tab.key === t.key} onClick={() => url.set({ tab: t.key, page: 1 })} className={cn('rounded-md px-3 py-1.5 text-sm', tab.key === t.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}>
                {t.label}
              </button>
            ))}
          </div>
          <SearchInput className="lg:ml-auto" value={params.q} onChange={(q) => url.set({ q, page: 1 })} placeholder="Client or invoice number" />
        </div>
        <DataTable
          query={query}
          rowKey={(r) => r.id}
          onRowClick={(r) => router.push(`/billing/invoices/${r.id}`)}
          page={params.page}
          onPage={(page) => url.set({ page })}
          empty={
            waiting > 0 && (tab.key === 'open' || tab.key === 'draft') ? (
              <EmptyState
                icon={Receipt}
                title={`No ${tab.key === 'open' ? 'unpaid' : 'draft'} invoices — but ${waiting} ${waiting === 1 ? 'item is' : 'items are'} not yet invoiced`}
                description={`${fmtMoney(unbilled.data?.totalMinor ?? 0, currency)} of work from consultations, pharmacy, lab and other services.`}
                action={can('billing.write') ? <Button size="sm" asChild><Link href="/billing/charges">See items not yet invoiced</Link></Button> : undefined}
              />
            ) : (
              <EmptyState icon={Receipt} title={tab.key === 'open' ? 'Nothing owed — every finished invoice is paid' : 'No invoices here'} />
            )
          }
          columns={[
            { key: 'no', header: 'Invoice', cell: (r) => <div><Link href={`/billing/invoices/${r.id}`} className="font-medium hover:underline">{r.number ? r.invoiceNo : 'Draft'}</Link>{!r.number && <p className="text-2xs text-muted-foreground">started {fmtDate(r.createdAt)}{r.createdByName ? ` by ${r.createdByName}` : ''}</p>}</div> },
            { key: 'client', header: 'Client', cell: (r) => <span className="text-sm">{r.client?.displayName ?? <span className="text-muted-foreground">Counter sale</span>}</span> },
            { key: 'date', header: 'Date', cell: (r) => <span className="whitespace-nowrap text-sm">{fmtDate(r.issuedAt ?? r.createdAt)}</span> },
            { key: 'due', header: 'Due', cell: (r) => <span className={cn('whitespace-nowrap text-sm', r.overdue && 'font-medium text-destructive')}>{fmtDate(r.dueAt)}</span> },
            { key: 'total', header: 'Total', className: 'text-right tabular', headerClassName: 'text-right', cell: (r) => fmtMoney(r.totalMinor, r.currency ?? currency) },
            { key: 'bal', header: 'Amount owed', className: 'text-right tabular', headerClassName: 'text-right', cell: (r) => (r.status === 'VOID' || r.status === 'DRAFT' ? '—' : fmtMoney(r.balanceMinor, r.currency ?? currency)) },
            { key: 'st', header: 'Status', cell: (r) => <CommerceBadge status={r.status} overdue={r.overdue} /> },
          ]}
        />
      </Card>
    </>
  );
}

export default function BillingPage() {
  return (
    <RequirePermission anyOf={['billing.read']}>
      <Suspense>
        <Invoices />
      </Suspense>
    </RequirePermission>
  );
}
