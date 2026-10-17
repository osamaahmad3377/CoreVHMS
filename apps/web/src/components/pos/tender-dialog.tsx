'use client';
import { enumLabel, fromMinor } from '@vcms/shared';
import { Banknote, CreditCard, Landmark, Smartphone, Trash2, Wallet, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { MoneyInput, parseMoney } from '../billing/money';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { quickCash, type Tender } from './model';
import { fmtMoney } from '@/lib/format';
import { cn } from '@/lib/utils';

const METHODS: { key: string; icon: LucideIcon }[] = [
  { key: 'CASH', icon: Banknote },
  { key: 'CARD', icon: CreditCard },
  { key: 'MOBILE_WALLET', icon: Smartphone },
  { key: 'BANK_TRANSFER', icon: Landmark },
  { key: 'CHEQUE', icon: Wallet },
  { key: 'OTHER', icon: Wallet },
];

/**
 * Split-tender payment. Non-cash tenders cannot exceed what is still due; cash may exceed it and the
 * difference is returned as change (only cash can produce change).
 */
export function TenderDialog({
  open,
  onOpenChange,
  dueMinor,
  currency,
  cashBlocked,
  canManageCash,
  busy,
  onComplete,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  dueMinor: number;
  currency: string;
  cashBlocked: boolean;
  canManageCash: boolean;
  busy: boolean;
  onComplete: (tenders: Tender[], changeMinor: number) => void;
}) {
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [method, setMethod] = useState('CASH');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const amountRef = useRef<HTMLInputElement>(null);

  const paid = tenders.reduce((n, t) => n + t.amountMinor, 0);
  const remaining = Math.max(0, dueMinor - paid);
  const entry = parseMoney(amount, currency);

  useEffect(() => {
    if (!open) return;
    setTenders([]);
    const m = cashBlocked ? 'CARD' : 'CASH';
    setMethod(m);
    setAmount(fromMinor(dueMinor, currency));
    setReference('');
    setTimeout(() => amountRef.current?.select(), 50);
  }, [open, dueMinor, currency, cashBlocked]);

  const entryError = entry === null || entry <= 0 ? null : method !== 'CASH' && entry > remaining ? `${enumLabel(method)} cannot exceed the ${fmtMoney(remaining, currency)} still due` : null;
  // Tenders that would be recorded if the cashier completes now (including the amount being typed).
  const pending = entry && entry > 0 && !entryError && remaining > 0 ? [...tenders, { key: crypto.randomUUID(), method, amountMinor: entry, reference }] : tenders;
  const pendingPaid = pending.reduce((n, t) => n + t.amountMinor, 0);
  const change = Math.max(0, pendingPaid - dueMinor);
  const cashTotal = pending.filter((t) => t.method === 'CASH').reduce((n, t) => n + t.amountMinor, 0);
  const canComplete = pendingPaid >= dueMinor && change <= cashTotal && !busy;

  const add = () => {
    if (!entry || entry <= 0 || entryError) return;
    const next = [...tenders, { key: crypto.randomUUID(), method, amountMinor: entry, reference: reference.trim() }];
    setTenders(next);
    const left = Math.max(0, dueMinor - next.reduce((n, t) => n + t.amountMinor, 0));
    setAmount(left ? fromMinor(left, currency) : '');
    setReference('');
    amountRef.current?.focus();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Take payment</DialogTitle>
          <DialogDescription>Choose a method and amount. Add several payments to split the bill.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-2 rounded-lg bg-muted/50 p-3 text-center">
          <div><p className="text-xs text-muted-foreground">Total due</p><p className="text-xl font-bold tabular">{fmtMoney(dueMinor, currency)}</p></div>
          <div><p className="text-xs text-muted-foreground">Tendered</p><p className="text-xl font-semibold tabular">{fmtMoney(pendingPaid, currency)}</p></div>
          <div>
            <p className="text-xs text-muted-foreground">{change > 0 ? 'Change due' : 'Remaining'}</p>
            <p className={cn('text-xl font-bold tabular', change > 0 ? 'text-success' : pendingPaid < dueMinor ? 'text-warning' : '')}>{fmtMoney(change > 0 ? change : Math.max(0, dueMinor - pendingPaid), currency)}</p>
          </div>
        </div>

        {remaining > 0 && (
          <>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6" role="radiogroup" aria-label="Payment method">
              {METHODS.map(({ key, icon: Icon }) => {
                const disabled = key === 'CASH' && cashBlocked;
                return (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={method === key}
                    disabled={disabled}
                    onClick={() => { setMethod(key); amountRef.current?.focus(); }}
                    className={cn('flex flex-col items-center gap-1 rounded-lg border p-2.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40', method === key ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted')}
                  >
                    <Icon className="h-5 w-5" /> {enumLabel(key)}
                  </button>
                );
              })}
            </div>
            {cashBlocked && <p className="text-xs text-destructive">Cash is unavailable: no register is open at this branch. {canManageCash && <Link className="underline" href="/billing/cash">Open a register</Link>}</p>}
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <MoneyInput
                ref={amountRef}
                aria-label="Amount"
                currency={currency}
                className="h-11 text-lg"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  if (canComplete) onComplete(pending, change);
                  else add();
                }}
              />
              {method !== 'CASH' ? <Input aria-label="Reference" placeholder="Reference / auth code" className="h-11" value={reference} maxLength={120} onChange={(e) => setReference(e.target.value)} /> : <div className="hidden sm:block" />}
              <Button variant="outline" className="h-11" disabled={!entry || entry <= 0 || !!entryError || entry >= remaining} onClick={add}>Add split</Button>
            </div>
            {entryError && <p className="text-xs text-destructive" role="alert">{entryError}</p>}
            {method === 'CASH' && (
              <div className="flex flex-wrap gap-2" aria-label="Quick cash amounts">
                {quickCash(remaining, currency).map((v, i) => (
                  <Button key={v} type="button" variant="secondary" size="sm" className="tabular" onClick={() => { setAmount(fromMinor(v, currency)); amountRef.current?.focus(); }}>
                    {i === 0 ? `Exact ${fmtMoney(v, currency)}` : fmtMoney(v, currency)}
                  </Button>
                ))}
              </div>
            )}
          </>
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

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Back to sale</Button>
          <Button size="lg" disabled={!canComplete} loading={busy} onClick={() => onComplete(pending, change)}>
            {change > 0 ? `Complete · change ${fmtMoney(change, currency)}` : 'Complete sale'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
