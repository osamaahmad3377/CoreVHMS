'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PAYMENT_METHODS, enumLabel, type Paginated } from '@vcms/shared';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { FormError } from '../forms/form-error';
import { Field } from '../forms/field';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input, NativeSelect } from '../ui/input';
import { MoneyInput, parseMoney } from './money';
import { api, qs } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { Invoice, Payment } from '@/lib/types';
import { fromMinor } from '@vcms/shared';

/**
 * Records a payment for a client (or a counter sale) and allocates it to outstanding invoices.
 * Any unallocated remainder stays on the client's account as credit. A fresh idempotency key per
 * dialog opening means a double-click or network retry cannot take the payment twice.
 */
export function TakePaymentDialog({
  open,
  onOpenChange,
  clientId,
  invoice,
  onPaid,
  silent = false,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clientId: string | null;
  /** Pre-select this invoice (and for counter sales, the only allowed invoice). */
  invoice?: Invoice;
  onPaid?: (p: Payment) => void;
  /** The caller shows its own confirmation (e.g. with a "Print receipt" button). */
  silent?: boolean;
}) {
  const qc = useQueryClient();
  const { currency } = useSession();
  const [key, setKey] = useState('');
  const [method, setMethod] = useState<string>('CASH');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  // Allocations follow the amount (oldest invoice first) until the user edits an allocation themselves.
  const [manual, setManual] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const outstanding = useQuery({
    queryKey: ['invoices', 'outstanding', clientId],
    queryFn: () => api.get<Paginated<Invoice>>(`/invoices${qs({ clientId, status: 'ISSUED,PARTIALLY_PAID', pageSize: 100 })}`),
    enabled: open && !!clientId,
  });
  const invoices = useMemo(() => (clientId ? (outstanding.data?.data ?? []) : invoice ? [invoice] : []).slice().sort((a, b) => (a.issuedAt ?? '').localeCompare(b.issuedAt ?? '')), [clientId, outstanding.data, invoice]);

  useEffect(() => {
    if (!open) return;
    setKey(crypto.randomUUID());
    setMethod('CASH');
    setReference('');
    setError(null);
    setManual(false);
    if (invoice) {
      setAmount(fromMinor(invoice.balanceMinor, currency));
      setAlloc({ [invoice.id]: fromMinor(invoice.balanceMinor, currency) });
    } else {
      setAmount('');
      setAlloc({});
    }
  }, [open, invoice, currency]);

  const amountMinor = parseMoney(amount, currency);
  const allocations = Object.entries(alloc)
    .map(([invoiceId, v]) => ({ invoiceId, amountMinor: parseMoney(v, currency) ?? 0 }))
    .filter((a) => a.amountMinor > 0);
  const allocated = allocations.reduce((n, a) => n + a.amountMinor, 0);
  const remainder = (amountMinor ?? 0) - allocated;

  /** Fills allocations oldest-first up to the amount entered. */
  const autoAllocate = (total: number) => {
    let left = total;
    const next: Record<string, string> = {};
    for (const i of invoices) {
      if (left <= 0) break;
      const take = Math.min(left, i.balanceMinor);
      next[i.id] = fromMinor(take, currency);
      left -= take;
    }
    setAlloc(next);
  };
  useEffect(() => {
    if (!open || manual || amountMinor === null) return;
    autoAllocate(Math.max(0, amountMinor));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amountMinor, invoices, manual, open]);
  const editAlloc = (fn: (s: Record<string, string>) => Record<string, string>) => { setManual(true); setAlloc(fn); };

  const m = useMutation({
    mutationFn: () =>
      api.post<Payment>('/payments', { clientId, amountMinor, method, reference: reference || null, allocations, idempotencyKey: key }),
    onSuccess: (p) => {
      if (!silent) toast.success(`Payment ${p.receiptNo} recorded`);
      ['invoices', 'invoice', 'payments', 'client', 'statement', 'dashboard', 'cash'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onPaid?.(p);
      onOpenChange(false);
    },
    onError: (e: Error) => setError(e.message),
  });

  const problems = [
    amountMinor === null || amountMinor <= 0 ? 'Enter the amount received' : null,
    remainder < 0 ? 'Allocations exceed the amount received' : null,
    !clientId && remainder !== 0 ? 'A counter sale payment must be fully allocated to the sale' : null,
    allocations.some((a) => a.amountMinor > (invoices.find((i) => i.id === a.invoiceId)?.balanceMinor ?? 0)) ? 'An allocation is larger than the invoice balance' : null,
  ].filter(Boolean) as string[];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Take payment</DialogTitle>
          <DialogDescription>Allocate the payment to invoices. Anything left over is kept as credit on the client&apos;s account.</DialogDescription>
        </DialogHeader>
        {error && <FormError message={error} />}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Amount received" htmlFor="pay-amount" required>
            <MoneyInput
              id="pay-amount"
              currency={currency}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field label="Method" htmlFor="pay-method" required>
            <NativeSelect id="pay-method" value={method} onChange={(e) => setMethod(e.target.value)}>
              {PAYMENT_METHODS.map((p) => <option key={p} value={p}>{enumLabel(p)}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Reference" htmlFor="pay-ref" hint="Card auth code, transfer ID…">
            <Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} />
          </Field>
        </div>
        {clientId && (
          <div className="rounded-md border">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <p className="text-sm font-medium">Outstanding invoices</p>
              <Button type="button" size="sm" variant="ghost" disabled={!amountMinor || !manual} onClick={() => setManual(false)}>Allocate oldest first</Button>
            </div>
            {outstanding.isLoading ? (
              <p className="p-3 text-sm text-muted-foreground">Loading…</p>
            ) : invoices.length ? (
              <ul className="max-h-64 divide-y overflow-y-auto">
                {invoices.map((i) => (
                  <li key={i.id} className="grid grid-cols-[auto_1fr_140px] items-center gap-3 px-3 py-2">
                    <Checkbox
                      aria-label={`Allocate to ${i.invoiceNo}`}
                      checked={i.id in alloc}
                      onCheckedChange={(c) => editAlloc((s) => { const n = { ...s }; if (c) n[i.id] = fromMinor(Math.min(i.balanceMinor, Math.max(0, remainder)) || i.balanceMinor, currency); else delete n[i.id]; return n; })}
                    />
                    <div className="text-sm">
                      <p className="font-medium">{i.invoiceNo} <span className="font-normal text-muted-foreground">· {fmtDate(i.issuedAt)}</span></p>
                      <p className="text-xs text-muted-foreground">Balance {fmtMoney(i.balanceMinor, currency)} of {fmtMoney(i.totalMinor, currency)}{i.overdue && ' · overdue'}</p>
                    </div>
                    <MoneyInput aria-label={`Amount for ${i.invoiceNo}`} currency={currency} value={alloc[i.id] ?? ''} onChange={(e) => editAlloc((s) => ({ ...s, [i.id]: e.target.value }))} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-3 text-sm text-muted-foreground">No outstanding invoices. The full amount will be held as account credit.</p>
            )}
          </div>
        )}
        <dl className="grid grid-cols-3 gap-2 rounded-md bg-muted/50 p-3 text-sm">
          <div><dt className="text-xs text-muted-foreground">Received</dt><dd className="font-medium tabular">{fmtMoney(amountMinor ?? 0, currency)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Allocated</dt><dd className="font-medium tabular">{fmtMoney(allocated, currency)}</dd></div>
          {remainder < 0 ? (
            <div><dt className="text-xs text-muted-foreground">Over-allocated by</dt><dd className="font-medium tabular text-destructive">{fmtMoney(-remainder, currency)}</dd></div>
          ) : (
            <div><dt className="text-xs text-muted-foreground">To account credit</dt><dd className="font-medium tabular">{fmtMoney(remainder, currency)}</dd></div>
          )}
        </dl>
        {problems[0] && amount && <p className="text-xs text-destructive" role="alert">{problems[0]}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={m.isPending} disabled={problems.length > 0} onClick={() => { setError(null); m.mutate(); }}>Record payment</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
