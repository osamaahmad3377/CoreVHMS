'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { enumLabel, fromMinor, type Paginated } from '@vcms/shared';
import { Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { FormError } from '../forms/form-error';
import { Field } from '../forms/field';
import { CashClosedNote, MethodTiles } from '../pos/tender-dialog';
import { quickCash } from '../pos/model';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { MoneyInput, parseMoney } from './money';
import { ApiError, api, qs } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { BillingSettings, CashRegister, Invoice, Payment } from '@/lib/types';
import { cn } from '@/lib/utils';

interface Tender {
  /** Also the payment's idempotency key, so a double-click or network retry cannot take the payment twice. */
  key: string;
  method: string;
  amountMinor: number;
  reference: string;
}

interface PlannedPayment extends Tender {
  /** What this payment keeps after change is given (cash only). */
  applied: number;
  allocations: { invoiceId: string; amountMinor: number }[];
}

/**
 * Splits the money taken into one payment per method. Card, wallet and transfer payments are used first and
 * cash last, so change always comes out of cash. Each payment pays off invoices oldest first; anything left
 * on the last payment stays on the client's account as credit.
 */
export function planPayments(tenders: Tender[], changeMinor: number, allocations: { invoiceId: string; amountMinor: number }[]): PlannedPayment[] {
  const ordered = [...tenders.filter((t) => t.method !== 'CASH'), ...tenders.filter((t) => t.method === 'CASH')];
  let change = changeMinor;
  const withChange = [...ordered]
    .reverse()
    .map((t) => {
      if (t.method !== 'CASH' || change <= 0) return { ...t, applied: t.amountMinor };
      const cut = Math.min(change, t.amountMinor);
      change -= cut;
      return { ...t, applied: t.amountMinor - cut };
    })
    .reverse();
  const queue = allocations.map((a) => ({ ...a }));
  return withChange
    .filter((t) => t.applied > 0)
    .map((t) => {
      let left = t.applied;
      const slices: { invoiceId: string; amountMinor: number }[] = [];
      for (const a of queue) {
        if (left <= 0) break;
        if (a.amountMinor <= 0) continue;
        const take = Math.min(left, a.amountMinor);
        slices.push({ invoiceId: a.invoiceId, amountMinor: take });
        a.amountMinor -= take;
        left -= take;
      }
      return { ...t, allocations: slices };
    });
}

/**
 * Takes a payment from a client (or for a shop sale) and uses it to pay off unpaid invoices. The client can
 * split the payment across methods (part card, part cash). Extra money is either given back as change
 * (cash only) or kept on the client's account as credit.
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
  /** Pay this invoice first (and for shop sales, the only invoice that can be paid). */
  invoice?: Invoice;
  /** Called with every payment that was recorded (one per method) and the change given. */
  onPaid?: (payments: Payment[], extra: { changeMinor: number }) => void;
  /** The caller shows its own confirmation (e.g. with a "Print receipt" button). */
  silent?: boolean;
}) {
  const qc = useQueryClient();
  const { currency, session, can } = useSession();
  const amountRef = useRef<HTMLInputElement>(null);
  const [entryKey, setEntryKey] = useState('');
  const [method, setMethod] = useState('CASH');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  // Invoices are paid off automatically (this invoice first, then oldest first) until the user edits them.
  const [manual, setManual] = useState(false);
  const [giveChange, setGiveChange] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const outstanding = useQuery({
    queryKey: ['invoices', 'outstanding', clientId],
    queryFn: () => api.get<Paginated<Invoice>>(`/invoices${qs({ clientId, status: 'ISSUED,PARTIALLY_PAID', pageSize: 100 })}`),
    enabled: open && !!clientId,
  });
  const settings = useQuery({ queryKey: ['billing-settings'], queryFn: () => api.get<BillingSettings>('/billing/settings'), enabled: open, retry: false });
  const registers = useQuery({
    queryKey: ['cash', 'registers', session.branch?.id],
    queryFn: () => api.get<CashRegister[]>(`/cash/registers${qs({ branchId: session.branch?.id })}`),
    enabled: open && !!session.branch,
    retry: false,
  });
  const cashBlocked = !!settings.data?.requireCashSession && registers.isSuccess && !(registers.data ?? []).some((r) => r.sessions.length);

  const invoices = useMemo(
    () => (clientId ? (outstanding.data?.data ?? []) : invoice ? [invoice] : []).slice().sort((a, b) => (a.issuedAt ?? '').localeCompare(b.issuedAt ?? '')),
    [clientId, outstanding.data, invoice],
  );
  const owed = invoices.reduce((n, i) => n + i.balanceMinor, 0);
  const counterSale = !clientId;

  // Fresh form each time the dialog opens.
  const invoiceId = invoice?.id;
  const invoiceBalance = invoice?.balanceMinor;
  useEffect(() => {
    if (!open) return;
    setEntryKey(crypto.randomUUID());
    setTenders([]);
    setReference('');
    setError(null);
    setManual(false);
    setGiveChange(true);
    setAlloc({});
    setAmount(invoiceBalance ? fromMinor(invoiceBalance, currency) : '');
    setTimeout(() => amountRef.current?.select(), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, invoiceId]);
  useEffect(() => {
    if (open && cashBlocked && method === 'CASH') setMethod('CARD');
  }, [open, cashBlocked, method]);
  // A client paying their account: suggest the full amount owed once it is known.
  useEffect(() => {
    if (open && clientId && !invoiceId && !amount && !tenders.length && owed > 0) setAmount(fromMinor(owed, currency));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, owed]);

  const takenSoFar = tenders.reduce((n, t) => n + t.amountMinor, 0);
  const stillOwed = Math.max(0, owed - takenSoFar);
  const entry = parseMoney(amount, currency);
  const entryError =
    entry === null || entry <= 0 ? null : counterSale && method !== 'CASH' && entry > stillOwed ? `${enumLabel(method)} cannot be more than the ${fmtMoney(stillOwed, currency)} still owed` : null;
  const all = entry && entry > 0 && !entryError ? [...tenders, { key: entryKey, method, amountMinor: entry, reference: reference.trim() }] : tenders;
  const paid = all.reduce((n, t) => n + t.amountMinor, 0);
  const cashTotal = all.filter((t) => t.method === 'CASH').reduce((n, t) => n + t.amountMinor, 0);

  /** Fills invoices up to the amount: the chosen invoice first, then oldest first. */
  useEffect(() => {
    if (!open || manual) return;
    let left = Math.max(0, paid);
    const next: Record<string, string> = {};
    const order = invoiceId ? [...invoices.filter((i) => i.id === invoiceId), ...invoices.filter((i) => i.id !== invoiceId)] : invoices;
    for (const i of order) {
      if (left <= 0) break;
      const take = Math.min(left, i.balanceMinor);
      if (take > 0) next[i.id] = fromMinor(take, currency);
      left -= take;
    }
    setAlloc(next);
  }, [paid, invoices, invoiceId, manual, open, currency]);
  const editAlloc = (fn: (s: Record<string, string>) => Record<string, string>) => { setManual(true); setAlloc(fn); };

  const allocations = invoices
    .map((i) => ({ invoiceId: i.id, amountMinor: parseMoney(alloc[i.id] ?? '', currency) ?? 0 }))
    .filter((a) => a.amountMinor > 0);
  const allocated = allocations.reduce((n, a) => n + a.amountMinor, 0);
  const extra = paid - allocated;
  const change = extra > 0 && (counterSale || giveChange) ? Math.min(extra, cashTotal) : 0;
  const credit = Math.max(0, extra - change);

  const problems = [
    paid <= 0 ? 'Enter the amount paid now' : null,
    entryError,
    extra < 0 ? 'You are paying off more than the amount paid now' : null,
    counterSale && credit > 0 ? 'A shop sale cannot be paid with more than it costs, except in cash (the extra is given as change)' : null,
    allocations.some((a) => a.amountMinor > (invoices.find((i) => i.id === a.invoiceId)?.balanceMinor ?? 0)) ? 'An invoice is being paid more than it owes' : null,
    all.some((t) => t.method === 'CASH') && cashBlocked ? 'The cash drawer is closed, so cash cannot be taken' : null,
  ].filter(Boolean) as string[];

  const addSplit = () => {
    if (!entry || entry <= 0 || entryError) return;
    const next = [...tenders, { key: entryKey, method, amountMinor: entry, reference: reference.trim() }];
    setTenders(next);
    setEntryKey(crypto.randomUUID());
    const left = Math.max(0, owed - next.reduce((n, t) => n + t.amountMinor, 0));
    setAmount(left ? fromMinor(left, currency) : '');
    setReference('');
    amountRef.current?.focus();
  };

  const save = async () => {
    setError(null);
    setBusy(true);
    const plan = planPayments(all, change, allocations);
    const tenderedCash = cashTotal;
    const recorded: Payment[] = [];
    let failure: string | null = null;
    for (const t of plan) {
      try {
        recorded.push(
          await api.post<Payment>('/payments', {
            clientId,
            amountMinor: t.applied,
            method: t.method,
            reference: t.reference || null,
            notes: t.method === 'CASH' && change ? `Cash given ${fmtMoney(tenderedCash, currency)}, change ${fmtMoney(change, currency)}` : null,
            allocations: t.allocations,
            idempotencyKey: t.key,
          }),
        );
      } catch (e) {
        failure = `${enumLabel(t.method)} ${fmtMoney(t.applied, currency)} was not saved: ${e instanceof ApiError || e instanceof Error ? e.message : 'network error'}`;
        break;
      }
    }
    setBusy(false);
    ['invoices', 'invoice', 'payments', 'client', 'statement', 'dashboard', 'cash'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    const receiptsText = recorded.map((p) => p.receiptNo).join(', ');
    if (recorded.length) onPaid?.(recorded, { changeMinor: failure ? 0 : change });
    if (failure) {
      // Keep only what still has to be taken; the saved payments are not sent again.
      const saved = new Set(plan.slice(0, recorded.length).map((t) => t.key));
      const left = all.filter((t) => !saved.has(t.key));
      setTenders(left.filter((t) => t.key !== entryKey));
      if (!left.some((t) => t.key === entryKey)) { setAmount(''); setEntryKey(crypto.randomUUID()); }
      setManual(false);
      setError(recorded.length ? `Saved: ${receiptsText}. ${failure}. Check the amounts and save the rest again.` : failure);
      return;
    }
    if (!silent) {
      const title = recorded.length === 1 ? `Payment ${receiptsText} recorded` : `${recorded.length} payments recorded (${receiptsText})`;
      toast.success(title, change ? { description: `Give ${fmtMoney(change, currency)} change` } : undefined);
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Take payment</DialogTitle>
          <DialogDescription>Choose how the client pays. To split the payment (part card, part cash), enter the first amount and press “Add split”.</DialogDescription>
        </DialogHeader>
        {error && <FormError message={error} />}

        <dl className="grid grid-cols-2 gap-2 rounded-lg bg-muted/50 p-3 text-center sm:grid-cols-4">
          <div><dt className="text-xs text-muted-foreground">Amount owed</dt><dd className="text-lg font-bold tabular">{fmtMoney(owed, currency)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Amount paid now</dt><dd className="text-lg font-semibold tabular">{fmtMoney(paid, currency)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Paying off invoices</dt><dd className={cn('text-lg font-semibold tabular', extra < 0 && 'text-destructive')}>{fmtMoney(allocated, currency)}</dd></div>
          {change > 0 || counterSale ? (
            <div><dt className="text-xs text-muted-foreground">Change to give</dt><dd className={cn('text-lg font-bold tabular', change > 0 && 'text-success')}>{fmtMoney(change, currency)}</dd></div>
          ) : (
            <div><dt className="text-xs text-muted-foreground">Extra kept as credit</dt><dd className={cn('text-lg font-semibold tabular', credit > 0 && 'text-success')}>{fmtMoney(credit, currency)}</dd></div>
          )}
        </dl>

        <MethodTiles value={method} cashBlocked={cashBlocked} onChange={(m) => { setMethod(m); amountRef.current?.focus(); }} />
        {cashBlocked && <CashClosedNote canManageCash={can('cash.manage')} />}

        <div className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <Field label="Amount paid now" htmlFor="pay-amount" required>
            <MoneyInput
              ref={amountRef}
              id="pay-amount"
              currency={currency}
              className="h-11 text-lg"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                if (!problems.length && !busy) void save();
              }}
            />
          </Field>
          {method !== 'CASH' ? (
            <Field label="Receipt / slip no. (optional)" htmlFor="pay-ref">
              <Input id="pay-ref" className="h-11" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} placeholder="Card slip, transfer ID…" />
            </Field>
          ) : <div className="hidden sm:block" />}
          <Button type="button" variant="outline" className="h-11" disabled={!entry || entry <= 0 || !!entryError} onClick={addSplit}>Add split</Button>
        </div>
        {method === 'CASH' && stillOwed > 0 && (
          <div className="flex flex-wrap gap-2" aria-label="Quick cash amounts">
            {quickCash(stillOwed, currency).map((v, i) => (
              <Button key={v} type="button" variant="secondary" size="sm" className="tabular" onClick={() => { setAmount(fromMinor(v, currency)); amountRef.current?.focus(); }}>
                {i === 0 ? `Exact ${fmtMoney(v, currency)}` : fmtMoney(v, currency)}
              </Button>
            ))}
          </div>
        )}

        {!!tenders.length && (
          <ul className="divide-y rounded-md border" aria-label="Payments added">
            {tenders.map((t) => (
              <li key={t.key} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="font-medium">{enumLabel(t.method)}</span>
                {t.reference && <span className="text-xs text-muted-foreground">{t.reference}</span>}
                <span className="ml-auto tabular">{fmtMoney(t.amountMinor, currency)}</span>
                <Button variant="ghost" size="icon-sm" aria-label={`Remove ${enumLabel(t.method)} payment`} onClick={() => setTenders((ts) => ts.filter((x) => x.key !== t.key))}><Trash2 /></Button>
              </li>
            ))}
          </ul>
        )}

        {clientId && (
          <div className="rounded-md border">
            <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
              <p className="text-sm font-medium">Paying off invoices <span className="font-normal text-muted-foreground tabular">· {fmtMoney(allocated, currency)}</span></p>
              <Button type="button" size="sm" variant="ghost" disabled={!paid || !manual} onClick={() => setManual(false)}>Pay oldest first</Button>
            </div>
            {outstanding.isLoading ? (
              <p className="p-3 text-sm text-muted-foreground">Loading…</p>
            ) : invoices.length ? (
              <ul className="max-h-56 divide-y overflow-y-auto">
                {invoices.map((i) => (
                  <li key={i.id} className="grid grid-cols-[auto_1fr_140px] items-center gap-3 px-3 py-2">
                    <Checkbox
                      aria-label={`Pay ${i.invoiceNo}`}
                      checked={i.id in alloc}
                      onCheckedChange={(c) => editAlloc((s) => { const n = { ...s }; if (c) n[i.id] = fromMinor(Math.min(i.balanceMinor, Math.max(0, extra)) || i.balanceMinor, currency); else delete n[i.id]; return n; })}
                    />
                    <div className="text-sm">
                      <p className="font-medium">{i.invoiceNo} <span className="font-normal text-muted-foreground">· {fmtDate(i.issuedAt)}</span></p>
                      <p className="text-xs text-muted-foreground">Owes {fmtMoney(i.balanceMinor, currency)} of {fmtMoney(i.totalMinor, currency)}{i.overdue && ' · overdue'}</p>
                    </div>
                    <MoneyInput aria-label={`Amount for ${i.invoiceNo}`} currency={currency} value={alloc[i.id] ?? ''} onChange={(e) => editAlloc((s) => ({ ...s, [i.id]: e.target.value }))} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-3 text-sm text-muted-foreground">No unpaid invoices. The whole amount will be kept as credit for the client.</p>
            )}
          </div>
        )}

        {clientId && extra > 0 && cashTotal > 0 && (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={giveChange} onCheckedChange={(c) => setGiveChange(c === true)} />
            Give the extra {fmtMoney(Math.min(extra, cashTotal), currency)} back as change (untick to keep it as credit)
          </label>
        )}
        {problems[0] && (amount || tenders.length > 0) && <p className="text-xs text-destructive" role="alert">{problems[0]}</p>}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={busy} disabled={problems.length > 0} onClick={() => void save()}>
            {change > 0 ? `Save payment · give ${fmtMoney(change, currency)} change` : 'Save payment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
