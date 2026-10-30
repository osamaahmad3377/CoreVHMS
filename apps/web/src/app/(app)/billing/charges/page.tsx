'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Paginated } from '@vcms/shared';
import { ChevronDown, ChevronRight, ListChecks } from 'lucide-react';
import Link from 'next/link';
import { Fragment, Suspense, useState } from 'react';
import { toast } from 'sonner';
import { CommerceBadge } from '@/components/billing/status';
import { BILLING_LINKS, SectionNav } from '@/components/billing/section-nav';
import { useConfirm } from '@/components/confirm';
import { DataTable } from '@/components/data-table';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { SearchInput } from '@/components/search-input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useUrlState } from '@/hooks/use-url-state';
import { api, qs } from '@/lib/api';
import { chargeNet, fmtDate, fmtDateTime, fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { Charge } from '@/lib/types';
import { chargeSource, splitRef } from '@/lib/labels';
import { cn } from '@/lib/utils';

interface ClientGroup {
  client: { id: string; displayName: string };
  itemCount: number;
  totalMinor: number;
  latestAt: string;
  patients: string[];
}

const TABS = [
  { key: 'PENDING', label: 'Not yet invoiced' },
  { key: 'INVOICED', label: 'Invoiced' },
  { key: 'WAIVED', label: 'Waived' },
  { key: 'ALL', label: 'All' },
];

/** Item name with any internal record number ("RX-000010") moved to small grey text. */
function ItemName({ charge }: { charge: Charge }) {
  const [name, ref] = splitRef(charge.description);
  return (
    <div>
      <p className="text-sm">{name}</p>
      <p className="text-xs text-muted-foreground">
        {chargeSource(charge.sourceType)}
        {charge.patient && ` · ${charge.patient.name}`}
        {charge.waivedReason && ` · waived: ${charge.waivedReason}`}
        {ref && <span className="text-2xs opacity-70"> · {ref}</span>}
      </p>
    </div>
  );
}

function useChargeActions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, reason }: { id: string; action: 'waive' | 'restore'; reason?: string }) => api.post(`/charges/${id}/${action}`, { reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['charges'] }),
    onError: (e: Error) => toast.error(e.message),
  });
}

/** The items waiting for one client, shown when their row is opened. */
function ClientItems({ clientId }: { clientId: string }) {
  const { can, currency } = useSession();
  const confirm = useConfirm();
  const act = useChargeActions();
  const q = useQuery({ queryKey: ['charges', 'pending', clientId], queryFn: () => api.get<Paginated<Charge> & { totalMinor: number }>(`/charges${qs({ clientId, status: 'PENDING', pageSize: 200 })}`) });
  if (q.isLoading) return <p className="px-4 py-3 text-sm text-muted-foreground">Loading…</p>;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <ul className="divide-y">
      {(q.data?.data ?? []).map((c) => (
        <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
          <div className="min-w-0 flex-1"><ItemName charge={c} /></div>
          <span className="whitespace-nowrap text-xs text-muted-foreground">Added on {fmtDateTime(c.createdAt)}{c.createdByName && ` by ${c.createdByName}`}</span>
          <span className="w-36 text-right text-sm tabular">
            {c.quantity !== 1 && <span className="text-xs text-muted-foreground">{c.quantity} × {fmtMoney(c.unitPriceMinor, currency)} = </span>}
            {c.discountMinor > 0 && <s className="mr-1 text-xs text-muted-foreground">{fmtMoney(Math.round(c.quantity * c.unitPriceMinor), currency)}</s>}
            {fmtMoney(chargeNet(c), currency)}
            {c.discountNote && <span className="block text-2xs text-success">{c.discountNote}</span>}
          </span>
          {can('billing.void') && (
            <Button size="sm" variant="ghost" onClick={async () => { const r = await confirm({ title: 'Waive this item?', description: `${splitRef(c.description)[0]} will not be charged to the client.`, requireReason: true, confirmLabel: 'Waive' }); if (r.confirmed) act.mutate({ id: c.id, action: 'waive', reason: r.reason }); }}>Waive</Button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** One row per client: how many items are waiting, their total and when the latest was added. */
function ByClient({ search, page, onPage }: { search: string; page: number; onPage: (p: number) => void }) {
  const { can, currency } = useSession();
  const [openIds, setOpenIds] = useState<string[]>([]);
  const params = { q: search || undefined, page, pageSize: 50 };
  const q = useQuery({ queryKey: ['charges', 'by-client', params], queryFn: () => api.get<Paginated<ClientGroup> & { totalMinor: number }>(`/charges/by-client${qs(params)}`), placeholderData: (p) => p });
  if (q.isLoading) return <LoadingRows />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const rows = q.data?.data ?? [];
  if (!rows.length) return <EmptyState icon={ListChecks} title={search ? `No client matches “${search}”` : 'Nothing is waiting to be invoiced'} description="Work done in the clinic (consultations, medicines, lab tests, hospital days, surgery, boarding, grooming, farm visits) appears here until it is invoiced." />;
  const meta = q.data!.meta;
  const pages = Math.max(1, Math.ceil(meta.total / meta.pageSize));
  const toggle = (id: string) => setOpenIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  return (
    <div className={cn(q.isFetching && 'opacity-70 transition-opacity')}>
      <Table>
        <THead>
          <TR><TH>Client</TH><TH className="text-right">Items</TH><TH className="text-right">Total</TH><TH>Added on</TH><TH /></TR>
        </THead>
        <TBody>
          {rows.map((g) => {
            const isOpen = openIds.includes(g.client.id);
            return (
              <Fragment key={g.client.id}>
                <TR>
                  <TD>
                    <button type="button" className="flex items-start gap-2 text-left" aria-expanded={isOpen} aria-label={`${isOpen ? 'Hide' : 'Show'} items for ${g.client.displayName}`} onClick={() => toggle(g.client.id)}>
                      {isOpen ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0" />}
                      <span>
                        <span className="block text-sm font-medium">{g.client.displayName}</span>
                        {!!g.patients.length && <span className="block text-xs text-muted-foreground">{g.patients.join(', ')}</span>}
                      </span>
                    </button>
                  </TD>
                  <TD className="text-right tabular">{g.itemCount} {g.itemCount === 1 ? 'item' : 'items'}</TD>
                  <TD className="text-right font-medium tabular">{fmtMoney(g.totalMinor, currency)}</TD>
                  <TD className="whitespace-nowrap text-sm">{fmtDate(g.latestAt)}</TD>
                  <TD>
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => toggle(g.client.id)}>{isOpen ? 'Hide items' : 'Show items'}</Button>
                      {can('billing.write') && <Button size="sm" asChild><Link href={`/billing/invoices/new?clientId=${g.client.id}`}>Make invoice</Link></Button>}
                    </div>
                  </TD>
                </TR>
                {isOpen && (
                  <TR>
                    <TD colSpan={5} className="bg-muted/30 p-0"><ClientItems clientId={g.client.id} /></TD>
                  </TR>
                )}
              </Fragment>
            );
          })}
        </TBody>
      </Table>
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
          <span className="tabular">Page {page} of {pages}</span>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}

function Charges() {
  const { can, currency } = useSession();
  const act = useChargeActions();
  const url = useUrlState();
  const status = url.get('status', 'PENDING');
  const page = Number(url.get('page', '1'));
  const search = url.get('q', '');
  const params = { status, page, pageSize: 50 };
  const list = useQuery({ queryKey: ['charges', params], queryFn: () => api.get<Paginated<Charge> & { totalMinor: number }>(`/charges${qs(params)}`), placeholderData: (p) => p, enabled: status !== 'PENDING' });
  const pending = useQuery({ queryKey: ['charges', 'pending-count'], queryFn: () => api.get<Paginated<unknown> & { totalMinor: number }>(`/charges${qs({ status: 'PENDING', pageSize: 1 })}`) });
  const total = status === 'PENDING' ? pending.data?.totalMinor : list.data?.totalMinor;
  return (
    <>
      <PageHeader
        help="invoice" title="Not yet invoiced" description="Work done in the clinic waits here until it is put on an invoice. Open a client to see their items, then press “Make invoice”." />
      <SectionNav links={BILLING_LINKS} />
      <Card>
        <div className="flex flex-col gap-2 border-b p-3 lg:flex-row lg:items-center">
          <div className="flex flex-wrap items-center gap-1" role="tablist">
            {TABS.map((t) => (
              <button key={t.key} role="tab" aria-selected={status === t.key} onClick={() => url.set({ status: t.key, page: 1 })} className={cn('rounded-md px-3 py-1.5 text-sm', status === t.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}>
                {t.label}
              </button>
            ))}
          </div>
          {status === 'PENDING' && <SearchInput className="lg:ml-auto" value={search} onChange={(q) => url.set({ q, page: 1 })} placeholder="Client name" />}
          {total !== undefined && <span className={cn('text-sm text-muted-foreground', status !== 'PENDING' && 'lg:ml-auto')}>Total <b className="tabular text-foreground">{fmtMoney(total, currency)}</b> (before tax)</span>}
        </div>
        {status === 'PENDING' ? (
          <ByClient search={search} page={page} onPage={(p) => url.set({ page: p })} />
        ) : (
          <DataTable
            query={list}
            rowKey={(r) => r.id}
            page={page}
            pageSize={50}
            onPage={(p) => url.set({ page: p })}
            empty={<EmptyState icon={ListChecks} title="Nothing here" />}
            columns={[
              { key: 'client', header: 'Client', cell: (r) => <Link className="text-sm font-medium hover:underline" href={`/clients/${r.client.id}?tab=account`}>{r.client.displayName}</Link> },
              { key: 'item', header: 'Item', cell: (r) => <ItemName charge={r} /> },
              { key: 'when', header: 'Added on', cell: (r) => <span className="whitespace-nowrap text-xs">{fmtDateTime(r.createdAt)}{r.createdByName && <span className="block text-muted-foreground">{r.createdByName}</span>}</span> },
              { key: 'amt', header: 'Amount', className: 'text-right tabular', headerClassName: 'text-right', cell: (r) => <span>{r.quantity} × {fmtMoney(r.unitPriceMinor, currency)}<span className="block font-medium">{fmtMoney(chargeNet(r), currency)}</span>{r.discountNote && <span className="block text-2xs text-success">{r.discountNote}</span>}</span> },
              { key: 'st', header: 'Status', cell: (r) => <CommerceBadge status={r.status} /> },
              {
                key: 'act',
                header: '',
                cell: (r) => (
                  <div className="flex justify-end gap-1">
                    {r.status === 'PENDING' && can('billing.write') && <Button size="sm" variant="outline" asChild><Link href={`/billing/invoices/new?clientId=${r.clientId}`}>Make invoice</Link></Button>}
                    {r.status === 'WAIVED' && can('billing.write') && <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: r.id, action: 'restore' })}>Restore</Button>}
                  </div>
                ),
              },
            ]}
          />
        )}
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
