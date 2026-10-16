'use client';
import { useQuery } from '@tanstack/react-query';
import type { Paginated } from '@vcms/shared';
import { CreditCard, Download, Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { CommerceBadge } from './status';
import { TakePaymentDialog } from './take-payment-dialog';
import { DataTable } from '../data-table';
import { EmptyState } from '../page';
import { Button } from '../ui/button';
import { Card, CardHeader, CardTitle } from '../ui/card';
import { Table, TBody, TD, TH, THead, TR } from '../ui/table';
import { api, qs } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { Charge, Invoice, Statement } from '@/lib/types';

/** Client account: invoices, unbilled charges and a running statement (debits, credits, balance). */
export function ClientAccount({ clientId }: { clientId: string }) {
  const { can, currency } = useSession();
  const [paying, setPaying] = useState(false);
  const invoices = useQuery({ queryKey: ['invoices', 'client', clientId], queryFn: () => api.get<Paginated<Invoice>>(`/invoices${qs({ clientId, pageSize: 50 })}`) });
  const charges = useQuery({ queryKey: ['charges', 'pending', clientId], queryFn: () => api.get<Paginated<Charge> & { totalMinor: number }>(`/charges${qs({ clientId, status: 'PENDING', pageSize: 1 })}`) });
  const statement = useQuery({ queryKey: ['statement', clientId], queryFn: () => api.get<Statement>(`/clients/${clientId}/statement`) });
  const unbilled = charges.data?.meta.total ?? 0;
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2">
        {can('payments.take') && <Button size="sm" onClick={() => setPaying(true)}><CreditCard /> Take payment</Button>}
        {can('billing.write') && <Button size="sm" variant="outline" asChild><Link href={`/billing/invoices/new?clientId=${clientId}`}><Plus /> New invoice{unbilled ? ` (${unbilled} unbilled)` : ''}</Link></Button>}
        <Button size="sm" variant="outline" asChild><a href={`/api/v1/clients/${clientId}/statement.csv`} download><Download /> Statement CSV</a></Button>
      </div>
      {!!unbilled && (
        <Card className="border-warning/40 bg-warning/5 p-3 text-sm">
          {unbilled} unbilled charge{unbilled === 1 ? '' : 's'} worth {fmtMoney(charges.data?.totalMinor ?? 0, currency)} before tax. {can('billing.write') && <Link className="font-medium underline" href={`/billing/invoices/new?clientId=${clientId}`}>Create an invoice</Link>}
        </Card>
      )}
      <Card>
        <CardHeader><CardTitle>Invoices</CardTitle></CardHeader>
        <DataTable
          query={invoices}
          rowKey={(r) => r.id}
          empty={<EmptyState title="No invoices yet" className="py-8" />}
          columns={[
            { key: 'no', header: 'Invoice', cell: (r) => <Link className="font-medium hover:underline" href={`/billing/invoices/${r.id}`}>{r.invoiceNo}</Link> },
            { key: 'date', header: 'Date', cell: (r) => <span className="text-sm">{fmtDate(r.issuedAt ?? r.createdAt)}</span> },
            { key: 'total', header: 'Total', className: 'text-right tabular', headerClassName: 'text-right', cell: (r) => fmtMoney(r.totalMinor, r.currency) },
            { key: 'bal', header: 'Balance', className: 'text-right tabular', headerClassName: 'text-right', cell: (r) => (['DRAFT', 'VOID'].includes(r.status) ? '—' : fmtMoney(r.balanceMinor, r.currency)) },
            { key: 'st', header: 'Status', cell: (r) => <CommerceBadge status={r.status} overdue={r.overdue} /> },
          ]}
        />
      </Card>
      <Card>
        <CardHeader><CardTitle>Statement</CardTitle>{statement.data && <span className="text-sm">Balance <b className="tabular">{fmtMoney(statement.data.closingBalanceMinor, currency)}</b></span>}</CardHeader>
        {statement.data?.lines.length ? (
          <Table>
            <THead><TR><TH>Date</TH><TH>Reference</TH><TH>Description</TH><TH className="text-right">Charges</TH><TH className="text-right">Credits</TH><TH className="text-right">Balance</TH></TR></THead>
            <TBody>
              {statement.data.lines.map((l, i) => (
                <TR key={i}>
                  <TD className="whitespace-nowrap text-sm">{fmtDate(l.date)}</TD>
                  <TD className="text-sm font-medium">{l.reference}</TD>
                  <TD className="text-sm">{l.description}</TD>
                  <TD className="text-right tabular">{l.debitMinor ? fmtMoney(l.debitMinor, currency) : ''}</TD>
                  <TD className="text-right tabular">{l.creditMinor ? fmtMoney(l.creditMinor, currency) : ''}</TD>
                  <TD className="text-right tabular">{fmtMoney(l.balanceMinor, currency)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : <EmptyState title="No account activity yet" className="py-8" />}
      </Card>
      <TakePaymentDialog open={paying} onOpenChange={setPaying} clientId={clientId} />
    </div>
  );
}
