'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PAYMENT_METHODS, enumLabel, fromMinor, type Paginated } from '@vcms/shared';
import { Wallet } from 'lucide-react';
import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { MoneyInput, parseMoney } from '@/components/billing/money';
import { BILLING_LINKS, SectionNav } from '@/components/billing/section-nav';
import { DataTable } from '@/components/data-table';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { EmptyState, PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { NativeSelect, Textarea } from '@/components/ui/input';
import { useUrlState } from '@/hooks/use-url-state';
import { api, qs } from '@/lib/api';
import { fmtDateTime, fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { Payment } from '@/lib/types';
import { cn } from '@/lib/utils';

function RefundDialog({ payment, onClose }: { payment: Payment | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { currency } = useSession();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('CASH');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const max = payment ? payment.amountMinor - payment.refundedMinor : 0;
  useEffect(() => {
    if (payment) { setAmount(fromMinor(payment.unallocatedMinor > 0 ? payment.unallocatedMinor : max, currency)); setMethod(payment.method); setReason(''); setError(null); }
  }, [payment, max, currency]);
  const minor = parseMoney(amount, currency);
  const m = useMutation({
    mutationFn: () => api.post(`/payments/${payment!.id}/refunds`, { amountMinor: minor, method, reason }),
    onSuccess: () => { toast.success('Refund recorded'); ['payments', 'invoices', 'invoice', 'client', 'statement', 'cash'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); onClose(); },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog open={!!payment} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Refund {payment?.receiptNo}</DialogTitle>
          <DialogDescription>Unused credit is refunded first. Refunding more re-opens the invoices this payment settled.</DialogDescription>
        </DialogHeader>
        {error && <FormError message={error} />}
        <Field label="Amount" htmlFor="rf-amount" required hint={payment ? `Unused credit ${fmtMoney(payment.unallocatedMinor, currency)} · can refund up to ${fmtMoney(max, currency)}` : undefined}>
          <MoneyInput id="rf-amount" currency={currency} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Refund method" htmlFor="rf-method" required>
          <NativeSelect id="rf-method" value={method} onChange={(e) => setMethod(e.target.value)}>
            {PAYMENT_METHODS.map((p) => <option key={p} value={p}>{enumLabel(p)}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Reason" htmlFor="rf-reason" required>
          <Textarea id="rf-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" loading={m.isPending} disabled={!minor || minor <= 0 || minor > max || !reason.trim()} onClick={() => { setError(null); m.mutate(); }}>Refund</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Payments() {
  const { can, currency } = useSession();
  const url = useUrlState();
  const [refunding, setRefunding] = useState<Payment | null>(null);
  const highlight = url.get('highlight');
  const params = { method: url.get('method'), page: Number(url.get('page', '1')), pageSize: 25 };
  const query = useQuery({ queryKey: ['payments', params], queryFn: () => api.get<Paginated<Payment>>(`/payments${qs(params)}`), placeholderData: (p) => p });
  return (
    <>
      <PageHeader
        help="payment" title="Payments" description="Money received, which invoice it paid, and refunds." />
      <SectionNav links={BILLING_LINKS} />
      <Card>
        <div className="flex border-b p-3">
          <NativeSelect aria-label="Method" className="sm:w-48" value={params.method} onChange={(e) => url.set({ method: e.target.value, page: 1 })}>
            <option value="">All methods</option>
            {PAYMENT_METHODS.map((p) => <option key={p} value={p}>{enumLabel(p)}</option>)}
          </NativeSelect>
        </div>
        <DataTable
          query={query}
          rowKey={(r) => r.id}
          page={params.page}
          onPage={(page) => url.set({ page })}
          empty={<EmptyState icon={Wallet} title="No payments yet" />}
          columns={[
            { key: 'no', header: 'Receipt', cell: (r) => <span className={cn('font-medium', r.id === highlight && 'rounded bg-warning/20 px-1')}>{r.receiptNo}</span> },
            { key: 'client', header: 'Client', cell: (r) => (r.client ? <Link className="text-sm hover:underline" href={`/clients/${r.client.id}?tab=account`}>{r.client.displayName}</Link> : <span className="text-sm text-muted-foreground">Counter sale</span>) },
            { key: 'when', header: 'Received', cell: (r) => <span className="whitespace-nowrap text-xs">{fmtDateTime(r.receivedAt)}<span className="block text-muted-foreground">{r.receivedByName}</span></span> },
            { key: 'method', header: 'Method', cell: (r) => <span className="text-sm">{enumLabel(r.method)}{r.reference && <span className="block text-xs text-muted-foreground">{r.reference}</span>}</span> },
            { key: 'alloc', header: 'Paid off', cell: (r) => <span className="text-xs">{r.allocations.map((a) => <Link key={a.id} href={`/billing/invoices/${a.invoice.id}`} className="mr-2 hover:underline">{a.invoice.invoiceNo} ({fmtMoney(a.amountMinor, currency)})</Link>)}{r.unallocatedMinor > 0 && <span className="text-success">{fmtMoney(r.unallocatedMinor, currency)} credit</span>}</span> },
            { key: 'amt', header: 'Amount', className: 'text-right tabular', headerClassName: 'text-right', cell: (r) => <span>{fmtMoney(r.amountMinor, currency)}{r.refundedMinor > 0 && <span className="block text-xs text-destructive">refunded {fmtMoney(r.refundedMinor, currency)}</span>}</span> },
            { key: 'act', header: '', cell: (r) => can('billing.refund') && r.amountMinor > r.refundedMinor && <Button size="sm" variant="ghost" onClick={() => setRefunding(r)}>Refund</Button> },
          ]}
        />
      </Card>
      <RefundDialog payment={refunding} onClose={() => setRefunding(null)} />
    </>
  );
}

export default function PaymentsPage() {
  return (
    <RequirePermission anyOf={['billing.read']}>
      <Suspense><Payments /></Suspense>
    </RequirePermission>
  );
}
