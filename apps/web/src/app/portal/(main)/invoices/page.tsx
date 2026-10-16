'use client';
import { useQuery } from '@tanstack/react-query';
import { enumLabel } from '@vcms/shared';
import Link from 'next/link';
import { CommerceBadge } from '@/components/billing/status';
import { LoadingRows } from '@/components/page';
import { usePortal } from '@/components/portal/shell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fmtDate, fmtMoney } from '@/lib/format';
import { portalApi } from '@/lib/portal-api';

interface Data {
  balanceMinor: number;
  invoices: { id: string; invoiceNo: string; status: string; issuedAt: string; dueAt: string | null; totalMinor: number; balanceMinor: number; currency: string }[];
  payments: { id: string; receiptNo: string; amountMinor: number; refundedMinor: number; method: string; receivedAt: string }[];
}

export default function PortalInvoices() {
  const s = usePortal();
  const q = useQuery({ queryKey: ['portal', 'invoices'], queryFn: () => portalApi.get<Data>('/invoices') });
  if (!q.data) return <LoadingRows />;
  const d = q.data;
  const cur = s.clinic.currency;
  return (
    <div className="grid gap-4">
      <h1 className="text-xl font-semibold">Invoices & payments</h1>
      <Card><CardContent className="pt-4"><p className="text-sm text-muted-foreground">{d.balanceMinor > 0 ? 'Balance to pay' : d.balanceMinor < 0 ? 'Credit on your account' : 'Your account is up to date'}</p><p className="text-2xl font-semibold tabular">{fmtMoney(Math.abs(d.balanceMinor), cur)}</p>{d.balanceMinor > 0 && <p className="text-xs text-muted-foreground">Please pay at the clinic{s.clinic.phone ? ` or call ${s.clinic.phone}` : ''}.</p>}</CardContent></Card>
      <Card>
        <CardHeader><CardTitle>Invoices</CardTitle></CardHeader>
        <ul className="divide-y border-t">
          {d.invoices.map((i) => (
            <li key={i.id}>
              <Link href={`/portal/invoices/${i.id}`} className="flex items-center justify-between gap-2 px-4 py-3 hover:bg-muted/50">
                <span><span className="font-medium">{i.invoiceNo}</span><span className="block text-xs text-muted-foreground">{fmtDate(i.issuedAt)}{i.balanceMinor > 0 && i.dueAt ? ` · due ${fmtDate(i.dueAt)}` : ''}</span></span>
                <span className="text-right"><span className="block font-medium tabular">{fmtMoney(i.totalMinor, i.currency)}</span><CommerceBadge status={i.status} /></span>
              </Link>
            </li>
          ))}
          {!d.invoices.length && <li className="px-4 py-3 text-sm text-muted-foreground">No invoices yet.</li>}
        </ul>
      </Card>
      <Card>
        <CardHeader><CardTitle>Payments</CardTitle></CardHeader>
        <ul className="divide-y border-t">
          {d.payments.map((p) => (
            <li key={p.id} className="flex items-center justify-between px-4 py-2.5 text-sm"><span>{fmtDate(p.receivedAt)} · {enumLabel(p.method)} <span className="text-xs text-muted-foreground">{p.receiptNo}</span></span><span className="tabular">{fmtMoney(p.amountMinor, cur)}{p.refundedMinor > 0 && <span className="block text-xs text-muted-foreground">refunded {fmtMoney(p.refundedMinor, cur)}</span>}</span></li>
          ))}
          {!d.payments.length && <li className="px-4 py-3 text-sm text-muted-foreground">No payments yet.</li>}
        </ul>
      </Card>
    </div>
  );
}
