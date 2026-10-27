'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  PLATFORM_PAYMENT_METHODS,
  PLATFORM_PAYMENT_METHOD_LABELS,
  addMonths,
  nextPeriodStart,
  type ClinicBill,
  type ClinicPaymentView,
  type PaymentState,
  type PaymentStateKind,
  type PlatformClinic,
  type PlatformPaymentMethod,
} from '@vcms/shared';
import { Ban, CalendarRange, Gift, ReceiptText, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { useConfirm } from '@/components/confirm';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { ApiError, api } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { amount } from './plan-ui';

// ── Where a clinic stands ──

export const PAYMENT_STATE: Record<PaymentStateKind, { label: string; variant: 'success' | 'info' | 'warning' | 'destructive' | 'secondary' | 'default' }> = {
  PAID: { label: 'Paid', variant: 'success' },
  DUE_SOON: { label: 'Due soon', variant: 'warning' },
  OVERDUE: { label: 'Overdue', variant: 'destructive' },
  UNPAID: { label: 'No payment yet', variant: 'warning' },
  TRIAL: { label: 'Free trial', variant: 'default' },
  FREE: { label: 'Free', variant: 'secondary' },
  NO_PLAN: { label: 'No plan', variant: 'secondary' },
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "Paid until 12 Mar 2027", "Overdue by 5 days", "Due in 3 days", "Free trial · 9 days left". */
export function paymentText(s: PaymentState) {
  switch (s.kind) {
    case 'PAID':
      return `Paid until ${fmtDate(s.date)}`;
    case 'DUE_SOON':
      return `Due ${s.days === 0 ? 'today' : `in ${plural(s.days ?? 0, 'day')}`} · ${fmtDate(s.date)}`;
    case 'OVERDUE':
      return s.days ? `Overdue by ${plural(s.days, 'day')} · since ${fmtDate(s.date)}` : `Due today · ${fmtDate(s.date)}`;
    case 'UNPAID':
      return 'No payment recorded';
    case 'TRIAL':
      return `Free trial · ${plural(s.days ?? 0, 'day')} left`;
    case 'FREE':
      return 'Plan costs nothing';
    default:
      return 'No limits, not charged';
  }
}

export function PaymentBadge({ state, className }: { state: PaymentState; className?: string }) {
  const s = PAYMENT_STATE[state.kind];
  return <Badge variant={s.variant} className={className}>{s.label}</Badge>;
}

/** A clinic's fee both ways — per month and per year upfront — with the one it pays on marked. */
export function FeeLines({ bill, align = 'left' }: { bill: ClinicBill; align?: 'left' | 'right' }) {
  const line = (on: boolean, value: number, unit: string) => (
    <div className={cn('flex items-baseline gap-1 whitespace-nowrap tabular-nums', align === 'right' && 'justify-end', on ? 'font-semibold text-foreground' : 'text-xs text-muted-foreground')}>
      {amount(value, bill.currency)}
      <span className={cn('font-normal', on ? 'text-xs text-muted-foreground' : '')}>/ {unit}</span>
    </div>
  );
  return (
    <div className="grid gap-0.5">
      {line(bill.cycle === 'MONTHLY', bill.monthlyFeeMinor, 'month')}
      {bill.yearlyFeeMinor != null ? line(bill.cycle === 'YEARLY', bill.yearlyFeeMinor, 'year') : <div className={cn('text-2xs text-muted-foreground', align === 'right' && 'text-right')}>No yearly option</div>}
    </div>
  );
}

function invalidateBilling(qc: ReturnType<typeof useQueryClient>) {
  for (const key of ['platform-clinics', 'platform-clinic', 'platform-payments', 'platform-billing-summary']) qc.invalidateQueries({ queryKey: [key] });
}

// ── Recording a payment ──

const todayLocal = () => new Date().toLocaleDateString('en-CA');
const toMinor = (major: string) => (major.trim() === '' ? NaN : Math.round(Number(major) * 100));
const toMajor = (minor: number) => String(minor / 100);

/**
 * Records what a clinic paid: a month, several months, or a year (or more) upfront — with free months on top when
 * NextCore gives them, e.g. one free month for paying a year upfront. Shows exactly which dates it covers.
 */
export function RecordPaymentDialog({ clinic, open, onOpenChange }: { clinic: PlatformClinic | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  // Keep showing the clinic while the dialog animates closed.
  const last = useRef<PlatformClinic | null>(clinic);
  if (clinic) last.current = clinic;
  const c = clinic ?? last.current;
  const bill = c?.bill ?? null;
  const yearlyOffered = bill?.yearlyFeeMinor != null;
  const [cycle, setCycle] = useState<'MONTHLY' | 'YEARLY'>('MONTHLY');
  const [months, setMonths] = useState(1);
  const [years, setYears] = useState(1);
  const [freeMonths, setFreeMonths] = useState(0);
  const [amountText, setAmountText] = useState('');
  const [amountEdited, setAmountEdited] = useState(false);
  const [paidOn, setPaidOn] = useState(todayLocal());
  const [method, setMethod] = useState<PlatformPaymentMethod>('BANK_TRANSFER');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [startOn, setStartOn] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [lastOpen, setLastOpen] = useState(false);

  const suggested = (cy: 'MONTHLY' | 'YEARLY', m: number, y: number) => (!bill ? 0 : cy === 'YEARLY' && bill.yearlyFeeMinor != null ? bill.yearlyFeeMinor * y : bill.monthlyFeeMinor * m);
  // Start again each time the dialog opens: the clinic's own cycle and what one period costs.
  if (open && !lastOpen && bill) {
    setLastOpen(true);
    const cy = bill.cycle;
    setCycle(cy);
    setMonths(1);
    setYears(1);
    setFreeMonths(0);
    setAmountText(toMajor(suggested(cy, 1, 1)));
    setAmountEdited(false);
    setPaidOn(todayLocal());
    setMethod('BANK_TRANSFER');
    setReference('');
    setNote('');
    setStartOn('');
    setErrors({});
    setError(null);
  }
  if (!open && lastOpen) setLastOpen(false);

  const reprice = (cy: 'MONTHLY' | 'YEARLY', m: number, y: number) => {
    if (!amountEdited) setAmountText(toMajor(suggested(cy, m, y)));
  };
  const paidMonths = cycle === 'YEARLY' ? years * 12 : months;
  const autoStart = c ? nextPeriodStart({ paidUntil: c.paidUntil, trialEndsAt: c.trialEndsAt, status: c.status }) : new Date();
  const start = startOn ? new Date(`${startOn}T12:00:00`) : autoStart;
  const lapsed = !startOn && autoStart.getTime() < Date.now() - 86400_000;
  const end = addMonths(start, paidMonths + freeMonths);
  const asMonthly = bill ? bill.monthlyFeeMinor * paidMonths : 0;
  const yearlySaving = cycle === 'YEARLY' && bill?.yearlyFeeMinor != null ? asMonthly - bill.yearlyFeeMinor * years : 0;
  const reactivates = c?.status === 'SUSPENDED' && (c.pausedReason === 'TRIAL_ENDED' || c.pausedReason === 'UNPAID');
  const startsLater = !startOn && start.getTime() > Date.now() + 60_000;

  const save = useMutation({
    mutationFn: () =>
      api.post<ClinicPaymentView>(`/platform/clinics/${c!.id}/payments`, {
        billingCycle: cycle,
        paidMonths,
        freeMonths,
        amountMinor: toMinor(amountText),
        paidAt: new Date(`${paidOn}T12:00:00`).toISOString(),
        method,
        periodStart: startOn ? start.toISOString() : null,
        reference: reference.trim() || null,
        note: note.trim() || null,
      }),
    onSuccess: (p) => {
      toast.success(`Payment recorded — receipt ${p.receipt}. ${c!.name} is paid until ${fmtDate(p.periodEnd)} and the owner has been emailed a receipt.`);
      invalidateBilling(qc);
      onOpenChange(false);
    },
    onError: (e: Error) => {
      if (e instanceof ApiError) setErrors(e.fieldErrors);
      setError(e.message);
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const minor = toMinor(amountText);
    if (!Number.isFinite(minor) || minor < 0) return setErrors({ amountMinor: 'Enter the amount received' });
    if (!paidOn) return setErrors({ paidAt: 'Choose the date it was paid' });
    setErrors({});
    save.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Wallet className="h-5 w-5 text-primary" /> Record payment{c ? ` — ${c.name}` : ''}</DialogTitle>
          <DialogDescription>{c?.planName ? `${c.planName} plan. ` : ''}The owner is emailed a receipt. Payments can be cancelled later if recorded by mistake, never deleted.</DialogDescription>
        </DialogHeader>
        {c && bill ? (
          <form id="record-payment" onSubmit={submit} className="grid gap-4" noValidate>
            {error && <FormError message={error} />}
            <div role="radiogroup" aria-label="What the clinic paid for" className="grid gap-2 sm:grid-cols-2">
              {([
                ['MONTHLY', 'Monthly', `${amount(bill.monthlyFeeMinor, bill.currency)} a month`],
                ['YEARLY', 'A year upfront', yearlyOffered ? `${amount(bill.yearlyFeeMinor!, bill.currency)} a year` : 'Not offered on this plan'],
              ] as const).map(([value, title, text]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={cycle === value}
                  disabled={value === 'YEARLY' && !yearlyOffered}
                  onClick={() => { setCycle(value); reprice(value, months, years); }}
                  className={cn('rounded-xl surface-flat p-3 text-left text-sm transition-colors disabled:opacity-50', cycle === value ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted')}
                >
                  <span className="block font-medium">{title}</span>
                  <span className="text-xs text-muted-foreground">{text}</span>
                </button>
              ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {cycle === 'MONTHLY' ? (
                <Field label="Months paid for" htmlFor="pay-months" error={errors.paidMonths}>
                  <NativeSelect id="pay-months" value={months} onChange={(e) => { const m = Number(e.target.value); setMonths(m); reprice(cycle, m, years); }}>
                    {[1, 2, 3, 4, 5, 6, 9, 12].map((m) => <option key={m} value={m}>{plural(m, 'month')}</option>)}
                  </NativeSelect>
                </Field>
              ) : (
                <Field label="Years paid for" htmlFor="pay-years" error={errors.paidMonths}>
                  <NativeSelect id="pay-years" value={years} onChange={(e) => { const y = Number(e.target.value); setYears(y); reprice(cycle, months, y); }}>
                    {[1, 2, 3].map((y) => <option key={y} value={y}>{plural(y, 'year')}</option>)}
                  </NativeSelect>
                </Field>
              )}
              <Field label="Free months on top" htmlFor="pay-free" error={errors.freeMonths} hint={freeMonths ? 'Added after the paid months, at no charge.' : 'e.g. one free month for paying a year upfront'}>
                <div className="flex flex-wrap items-center gap-1.5">
                  {[0, 1, 2].map((n) => (
                    <Button key={n} type="button" size="sm" variant={freeMonths === n ? 'secondary' : 'outline'} aria-pressed={freeMonths === n} onClick={() => setFreeMonths(n)} className="px-3">
                      {n === 0 ? 'None' : <><Gift /> {n}</>}
                    </Button>
                  ))}
                  <Input id="pay-free" type="number" min={0} max={12} aria-label="Free months" className="h-9 w-16 text-center" value={freeMonths} onChange={(e) => setFreeMonths(Math.max(0, Math.min(12, Number(e.target.value) || 0)))} />
                </div>
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Amount received" htmlFor="pay-amount" required error={errors.amountMinor} hint={amountEdited && toMinor(amountText) !== suggested(cycle, months, years) ? <button type="button" className="text-primary hover:underline" onClick={() => { setAmountEdited(false); setAmountText(toMajor(suggested(cycle, months, years))); }}>Use the price: {amount(suggested(cycle, months, years), bill.currency)}</button> : 'The plan price with extras. Change it for a discount.'}>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{bill.currency === 'AUD' ? 'A$' : 'Rs'}</span>
                  <Input id="pay-amount" type="number" min={0} inputMode="decimal" className="pl-10" value={amountText} onChange={(e) => { setAmountEdited(true); setAmountText(e.target.value); }} />
                </div>
              </Field>
              <Field label="Paid on" htmlFor="pay-date" required error={errors.paidAt}>
                <Input id="pay-date" type="date" max={todayLocal()} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
              </Field>
              <Field label="Paid by" htmlFor="pay-method">
                <NativeSelect id="pay-method" value={method} onChange={(e) => setMethod(e.target.value as PlatformPaymentMethod)}>
                  {PLATFORM_PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PLATFORM_PAYMENT_METHOD_LABELS[m]}</option>)}
                </NativeSelect>
              </Field>
              <Field label="Reference" htmlFor="pay-ref" error={errors.reference} hint="Transaction ID, cheque number…">
                <Input id="pay-ref" maxLength={80} value={reference} onChange={(e) => setReference(e.target.value)} />
              </Field>
            </div>
            <Field label="Note" htmlFor="pay-note" error={errors.note}>
              <Textarea id="pay-note" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Only NextCore sees this" />
            </Field>

            <div className="grid gap-1.5 rounded-xl bg-success/[0.07] p-3 text-sm ring-1 ring-inset ring-success/15">
              <p className="flex items-center gap-2 font-semibold"><CalendarRange className="h-4 w-4 text-success" /> Covers {fmtDate(start.toISOString())} → {fmtDate(end.toISOString())}</p>
              <p className="text-xs text-muted-foreground">
                {plural(paidMonths, 'month')} paid{freeMonths ? ` + ${plural(freeMonths, 'free month')}` : ''}
                {startOn
                  ? ' · start date chosen by you'
                  : lapsed
                    ? ` · carries on from ${fmtDate(start.toISOString())}, when the last payment ran out`
                    : startsLater
                      ? c.trialEndsAt && start.getTime() === new Date(c.trialEndsAt).getTime()
                        ? ' · starts when the free trial ends'
                        : ' · starts when what is already paid ends'
                      : ' · starts today'}
              </p>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <label htmlFor="pay-start" className="text-muted-foreground">Starts on</label>
                <Input id="pay-start" type="date" className="h-8 w-40 text-xs" value={startOn || start.toLocaleDateString('en-CA')} onChange={(e) => setStartOn(e.target.value)} />
                {startOn && <button type="button" className="text-primary hover:underline" onClick={() => setStartOn('')}>Use {fmtDate(autoStart.toISOString())}</button>}
              </div>
              {yearlySaving > 0 && <p className="text-xs text-success">Paying yearly saves the clinic {amount(yearlySaving, bill.currency)} compared with monthly.</p>}
              {c.trialEndsAt && <p className="text-xs text-muted-foreground">The free trial is marked as paid — the clinic will not be paused when it ends.</p>}
              {reactivates && <p className="text-xs font-medium text-primary">The clinic is reactivated straight away.</p>}
            </div>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">Choose a plan for this clinic first — a clinic without a plan is not charged.</p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {c && bill && <Button type="submit" form="record-payment" loading={save.isPending}><ReceiptText /> Record payment</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Cancelling a payment ──

function CancelPaymentDialog({ payment, onClose }: { payment: ClinicPaymentView | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const cancel = useMutation({
    mutationFn: () => api.post<ClinicPaymentView>(`/platform/payments/${payment!.id}/cancel`, { reason }),
    onSuccess: (p) => {
      toast.success(`Receipt ${p.receipt} cancelled`);
      invalidateBilling(qc);
      setReason('');
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog open={!!payment} onOpenChange={(o) => { if (!o) { onClose(); setReason(''); setError(null); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel receipt {payment?.receipt}?</DialogTitle>
          <DialogDescription>
            {payment && `${amount(payment.amountMinor, payment.currency)} from ${payment.clinicName} on ${fmtDate(payment.paidAt)}. `}The payment stays on record marked as cancelled, and the clinic’s “paid until” goes back to its other payments.
          </DialogDescription>
        </DialogHeader>
        {error && <FormError message={error} />}
        <Field label="Why is it cancelled?" htmlFor="cancel-reason" required>
          <Input id="cancel-reason" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Recorded twice, bank transfer bounced" autoFocus />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Keep it</Button>
          <Button variant="destructive" disabled={reason.trim().length < 3} loading={cancel.isPending} onClick={() => cancel.mutate()}><Ban /> Cancel payment</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Payments table ──

const period = (p: ClinicPaymentView) => `${plural(p.paidMonths, 'month')}${p.freeMonths ? ` + ${p.freeMonths} free` : ''}`;

/** Receipts, newest first. Cancelled ones stay visible, struck through, with the reason. */
export function PaymentsTable({ payments, showClinic, compact }: { payments: ClinicPaymentView[]; showClinic?: boolean; compact?: boolean }) {
  const [cancelling, setCancelling] = useState<ClinicPaymentView | null>(null);
  return (
    <>
      <Table>
        <THead>
          <TR>
            <TH>Receipt</TH>
            {showClinic && <TH>Clinic</TH>}
            <TH className={cn(compact && 'hidden sm:table-cell')}>Paid on</TH>
            <TH className="hidden md:table-cell">Covers</TH>
            {!compact && <TH className="hidden lg:table-cell">Method</TH>}
            <TH className="text-right">Amount</TH>
            {!compact && <TH className="w-px"><span className="sr-only">Actions</span></TH>}
          </TR>
        </THead>
        <TBody>
          {payments.map((p) => {
            const voided = !!p.voidedAt;
            return (
              <TR key={p.id} className={cn(voided && 'opacity-60')}>
                <TD>
                  <div className={cn('font-mono text-xs font-medium', voided && 'line-through')}>{p.receipt}</div>
                  <div className="whitespace-nowrap text-2xs text-muted-foreground">{p.planName ?? '—'} · {p.billingCycle === 'YEARLY' ? 'yearly' : 'monthly'}</div>
                  {voided && <div className="mt-0.5 max-w-[14rem] text-2xs text-destructive">Cancelled{p.voidedByName ? ` by ${p.voidedByName}` : ''}: {p.voidReason}</div>}
                </TD>
                {showClinic && (
                  <TD><Link href={`/platform/clinics/${p.clinicId}`} className="font-medium text-primary hover:underline">{p.clinicName}</Link></TD>
                )}
                <TD className={cn(compact && 'hidden sm:table-cell')}>
                  <div>{fmtDate(p.paidAt)}</div>
                  {!compact && p.recordedByName && <div className="text-2xs text-muted-foreground">by {p.recordedByName}</div>}
                </TD>
                <TD className="hidden md:table-cell">
                  <div className="whitespace-nowrap">{fmtDate(p.periodStart)} → {fmtDate(p.periodEnd)}</div>
                  <div className="text-2xs text-muted-foreground">{period(p)}</div>
                </TD>
                {!compact && (
                  <TD className="hidden lg:table-cell">
                    <div>{PLATFORM_PAYMENT_METHOD_LABELS[p.method]}</div>
                    {p.reference && <div className="max-w-[10rem] truncate text-2xs text-muted-foreground" title={p.reference}>Ref {p.reference}</div>}
                  </TD>
                )}
                <TD className={cn('whitespace-nowrap text-right font-semibold tabular-nums', voided && 'line-through')}>{amount(p.amountMinor, p.currency)}</TD>
                {!compact && (
                  <TD>
                    {!voided && (
                      <Button size="icon-sm" variant="ghost" aria-label={`Cancel receipt ${p.receipt}`} title="Cancel this payment" onClick={() => setCancelling(p)}><Ban /></Button>
                    )}
                  </TD>
                )}
              </TR>
            );
          })}
        </TBody>
      </Table>
      <CancelPaymentDialog payment={cancelling} onClose={() => setCancelling(null)} />
    </>
  );
}

/** Downloads payments as a CSV file (opens in Excel). */
export function downloadPaymentsCsv(payments: ClinicPaymentView[], name = 'nextcore-payments') {
  const cell = (v: string | number | null) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [
    ['Receipt', 'Clinic', 'Plan', 'Billing', 'Paid on', 'Period from', 'Period to', 'Months paid', 'Free months', 'Method', 'Reference', 'Amount', 'Currency', 'Recorded by', 'Cancelled', 'Cancel reason'],
    ...payments.map((p) => [
      p.receipt, p.clinicName, p.planName, p.billingCycle === 'YEARLY' ? 'Yearly' : 'Monthly', p.paidAt.slice(0, 10), p.periodStart.slice(0, 10), p.periodEnd.slice(0, 10),
      p.paidMonths, p.freeMonths, PLATFORM_PAYMENT_METHOD_LABELS[p.method], p.reference, (p.amountMinor / 100).toFixed(2), p.currency, p.recordedByName, p.voidedAt ? p.voidedAt.slice(0, 10) : '', p.voidReason,
    ]),
  ];
  const blob = new Blob([rows.map((r) => r.map(cell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Reminders and pausing for non-payment ──

/** "Send payment reminder" and "Pause for non-payment", with their confirmations. */
export function useBillingActions() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const remind = useMutation({
    mutationFn: (c: PlatformClinic) => api.post<{ to: string }>(`/platform/clinics/${c.id}/payment-reminder`, {}),
    onSuccess: (r, c) => {
      toast.success(`Reminder emailed to ${r.to}`);
      qc.invalidateQueries({ queryKey: ['platform-clinic', c.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const pause = useMutation({
    mutationFn: (c: PlatformClinic) => api.post(`/platform/clinics/${c.id}/suspend`, { reason: 'UNPAID' }),
    onSuccess: (_, c) => {
      toast.success(`${c.name} paused for non-payment. Recording a payment reactivates it.`);
      invalidateBilling(qc);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return {
    remind: async (c: PlatformClinic) => {
      const { confirmed } = await confirm({
        title: `Email a payment reminder to ${c.ownerName}?`,
        description: `${c.ownerEmail} is told that ${amount(c.payment.dueMinor, c.payment.currency)} ${c.payment.kind === 'OVERDUE' ? `was due on ${fmtDate(c.payment.date)}` : c.payment.kind === 'DUE_SOON' ? `is due on ${fmtDate(c.payment.date)}` : 'is due now'}, and how to pay.`,
        confirmLabel: 'Send reminder',
      });
      if (confirmed) remind.mutate(c);
    },
    pauseUnpaid: async (c: PlatformClinic) => {
      const { confirmed } = await confirm({
        title: `Pause ${c.name} for non-payment?`,
        description: 'Nobody at the clinic can sign in; they are told the subscription payment is overdue. No data is deleted. Recording a payment reactivates it straight away.',
        confirmLabel: 'Pause clinic',
        destructive: true,
      });
      if (confirmed) pause.mutate(c);
    },
    reminding: remind.isPending ? remind.variables?.id : undefined,
  };
}

export const canRemind = (c: PlatformClinic) => c.status === 'ACTIVE' && ['OVERDUE', 'DUE_SOON', 'UNPAID'].includes(c.payment.kind);
