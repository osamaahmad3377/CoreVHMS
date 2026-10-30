'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addMonthsIso, dayBeforeIso } from '@vcms/shared';
import { CalendarClock, CheckCircle2, FileText, HeartHandshake, MoreHorizontal, Plus, RefreshCw, RotateCcw, Sparkles, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { bpToPct } from '../billing/money';
import { useConfirm } from '../confirm';
import { Field } from '../forms/field';
import { FormError } from '../forms/form-error';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardHeader, CardTitle } from '../ui/card';
import { Checkbox, Switch } from '../ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { Input, NativeSelect, Textarea } from '../ui/input';
import { api } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { WellnessEnrolment, WellnessPlan, WellnessSettlement, WellnessState } from '@/lib/types';
import { cn } from '@/lib/utils';

export function WellnessStateBadge({ state, autoRenew, renewed }: { state: WellnessState; autoRenew?: boolean; renewed?: boolean }) {
  const v = { ACTIVE: 'success', UPCOMING: 'info', EXPIRED: 'secondary', CANCELLED: 'destructive' } as const;
  const label = { ACTIVE: 'Active', UPCOMING: 'Starts soon', EXPIRED: 'Ended', CANCELLED: 'Cancelled' }[state];
  return (
    <span className="inline-flex items-center gap-1">
      <Badge variant={v[state]}>{label}</Badge>
      {state === 'ACTIVE' && renewed && <Badge variant="info">Renewed</Badge>}
      {state === 'ACTIVE' && !renewed && autoRenew && <Badge variant="outline"><RefreshCw className="h-3 w-3" /> Auto-renews</Badge>}
    </span>
  );
}

const invalidate = (qc: ReturnType<typeof useQueryClient>, patientId: string) => {
  qc.invalidateQueries({ queryKey: ['patient-wellness', patientId] });
  qc.invalidateQueries({ queryKey: ['wellness-members'] });
  qc.invalidateQueries({ queryKey: ['wellness-overview'] });
  qc.invalidateQueries({ queryKey: ['timeline', patientId] });
  qc.invalidateQueries({ queryKey: ['charges'] });
};

/** Choose a plan, start date and how the client pays; shows exactly what will be billed. */
export function EnrolDialog({ patientId, patientName, plans, today, open, onOpenChange }: { patientId: string; patientName: string; plans: WellnessPlan[]; today: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { currency } = useSession();
  const qc = useQueryClient();
  const [planId, setPlanId] = useState('');
  const [billing, setBilling] = useState<'UPFRONT' | 'MONTHLY'>('UPFRONT');
  const [start, setStart] = useState(today);
  const [autoRenew, setAutoRenew] = useState(true);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setPlanId(plans.length === 1 ? plans[0].id : '');
      setBilling('UPFRONT');
      setStart(today);
      setAutoRenew(true);
      setNotes('');
      setError(null);
    }
  }, [open, plans, today]);
  const plan = plans.find((p) => p.id === planId);
  const end = plan && start ? dayBeforeIso(addMonthsIso(start, plan.durationMonths)) : null;
  const first = plan ? (billing === 'MONTHLY' && plan.monthlyPriceMinor != null ? plan.monthlyPriceMinor : plan.priceMinor) + plan.joiningFeeMinor : 0;
  const enrol = useMutation({
    mutationFn: () => api.post<WellnessEnrolment>('/wellness/enrolments', { planId, patientId, billing, startDate: start, autoRenew, notes: notes.trim() || null }),
    onSuccess: (e) => {
      toast.success(`${patientName} joined ${e.planName}`);
      invalidate(qc, patientId);
      onOpenChange(false);
    },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Join a wellness plan</DialogTitle>
          <DialogDescription>For {patientName}. The first payment goes on the bill today; included items and the member discount apply automatically.</DialogDescription>
        </DialogHeader>
        {error && <FormError message={error} />}
        <div role="radiogroup" aria-label="Plan" className="grid gap-2 sm:grid-cols-2">
          {plans.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={planId === p.id}
              onClick={() => {
                setPlanId(p.id);
                if (p.monthlyPriceMinor == null) setBilling('UPFRONT');
              }}
              className={cn('rounded-xl surface-flat p-3 text-left transition-colors', planId === p.id ? 'border-primary bg-primary/[0.07] ring-2 ring-primary/30' : 'hover:bg-muted/60')}
            >
              <p className="flex items-center justify-between gap-2 font-semibold">
                {p.name}
                {planId === p.id && <CheckCircle2 className="h-4 w-4 text-primary" />}
              </p>
              <p className="text-sm">
                <span className="font-semibold tabular">{fmtMoney(p.priceMinor, currency)}</span>
                <span className="text-muted-foreground"> / {p.durationMonths} months</span>
                {p.monthlyPriceMinor != null && <span className="text-muted-foreground"> · or {fmtMoney(p.monthlyPriceMinor, currency)}/month</span>}
              </p>
              {p.description && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{p.description}</p>}
              <ul className="mt-2 grid gap-0.5 text-xs">
                {p.items.map((i) => <li key={i.id}>✓ {i.quantity} × {i.label}</li>)}
                {(p.serviceDiscountBp > 0 || p.productDiscountBp > 0) && (
                  <li className="text-success">
                    {[p.serviceDiscountBp > 0 && `${bpToPct(p.serviceDiscountBp)} off services`, p.productDiscountBp > 0 && `${bpToPct(p.productDiscountBp)} off products`].filter(Boolean).join(', ')}
                  </li>
                )}
              </ul>
            </button>
          ))}
        </div>
        {plan && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Starts" htmlFor="we-start" hint={end ? `Covers ${fmtDate(start)} to ${fmtDate(end)}` : undefined}>
              <Input id="we-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Field label="Payment" htmlFor="we-billing">
              <NativeSelect id="we-billing" value={billing} onChange={(e) => setBilling(e.target.value as 'UPFRONT' | 'MONTHLY')}>
                <option value="UPFRONT">Up front — {fmtMoney(plan.priceMinor, currency)}</option>
                {plan.monthlyPriceMinor != null && <option value="MONTHLY">Monthly — {fmtMoney(plan.monthlyPriceMinor, currency)} × {plan.durationMonths}</option>}
              </NativeSelect>
            </Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <Checkbox checked={autoRenew} onCheckedChange={(v) => setAutoRenew(v === true)} /> Renew automatically when it ends
            </label>
            <Field label="Notes" htmlFor="we-notes" className="sm:col-span-2">
              <Textarea id="we-notes" value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. owner prefers reminders by WhatsApp" />
            </Field>
            <div className="rounded-lg bg-muted/60 p-3 text-sm sm:col-span-2">
              <p>
                Billed now: <b className="tabular">{fmtMoney(first, currency)}</b>
                {plan.joiningFeeMinor > 0 && <span className="text-muted-foreground"> (includes {fmtMoney(plan.joiningFeeMinor, currency)} joining fee)</span>}
              </p>
              {billing === 'MONTHLY' && plan.monthlyPriceMinor != null && <p className="text-muted-foreground">Then {fmtMoney(plan.monthlyPriceMinor, currency)} on the same day each month, {plan.durationMonths - 1} more times.</p>}
              {plan.includedValueMinor > plan.priceMinor && <p className="text-success">Included items are worth {fmtMoney(plan.includedValueMinor, currency)} at today’s prices.</p>}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!plan || !start} loading={enrol.isPending} onClick={() => enrol.mutate()}>
            <HeartHandshake /> Join plan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CancelDialog({ e, open, onOpenChange }: { e: WellnessEnrolment; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { currency } = useSession();
  const qc = useQueryClient();
  const s = useQuery({ queryKey: ['wellness-settlement', e.id], queryFn: () => api.get<WellnessSettlement>(`/wellness/enrolments/${e.id}/settlement`), enabled: open });
  const [reason, setReason] = useState('');
  const [chargeShortfall, setChargeShortfall] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setReason('');
      setChargeShortfall(true);
      setError(null);
    }
  }, [open]);
  const cancel = useMutation({
    mutationFn: () => api.post<WellnessEnrolment>(`/wellness/enrolments/${e.id}/cancel`, { reason, chargeShortfall: chargeShortfall && (s.data?.shortfallMinor ?? 0) > 0 }),
    onSuccess: () => {
      toast.success(`${e.planName} cancelled`);
      invalidate(qc, e.patient.id);
      onOpenChange(false);
    },
    onError: (err: Error) => setError(err.message),
  });
  const d = s.data;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel {e.planName}?</DialogTitle>
          <DialogDescription>Benefits stop today. Payments not yet invoiced are dropped.</DialogDescription>
        </DialogHeader>
        {error && <FormError message={error} />}
        {d && (
          <dl className="grid gap-1.5 rounded-lg bg-muted/60 p-3 text-sm">
            <div className="flex justify-between"><dt>Invoiced so far</dt><dd className="tabular">{fmtMoney(d.billedMinor, currency)}</dd></div>
            {d.unbilledChargesMinor > 0 && <div className="flex justify-between text-muted-foreground"><dt>Charged but not invoiced (dropped)</dt><dd className="tabular">{fmtMoney(d.unbilledChargesMinor, currency)}</dd></div>}
            {d.scheduledMinor > 0 && <div className="flex justify-between text-muted-foreground"><dt>Payments not due yet (dropped)</dt><dd className="tabular">{fmtMoney(d.scheduledMinor, currency)}</dd></div>}
            <div className="flex justify-between"><dt>Benefits used (normal prices)</dt><dd className="tabular">{fmtMoney(d.usedValueMinor, currency)}</dd></div>
            {d.shortfallMinor > 0 && <div className="flex justify-between border-t pt-1.5 font-semibold text-warning"><dt>Used beyond what was paid</dt><dd className="tabular">{fmtMoney(d.shortfallMinor, currency)}</dd></div>}
            {d.unusedMinor > 0 && <div className="flex justify-between border-t pt-1.5 font-semibold text-success"><dt>Paid but not used</dt><dd className="tabular">{fmtMoney(d.unusedMinor, currency)}</dd></div>}
          </dl>
        )}
        {d && d.shortfallMinor > 0 && (
          <label className="flex items-start gap-2 text-sm">
            <Checkbox className="mt-0.5" checked={chargeShortfall} onCheckedChange={(v) => setChargeShortfall(v === true)} />
            <span>Charge the client {fmtMoney(d.shortfallMinor, currency)} for benefits used beyond their payments</span>
          </label>
        )}
        {d && d.unusedMinor > 0 && <p className="text-xs text-muted-foreground">To refund what wasn’t used, issue a credit note on the plan invoice in Billing.</p>}
        <Field label="Reason" htmlFor="wc-reason" required>
          <Input id="wc-reason" value={reason} maxLength={500} onChange={(ev) => setReason(ev.target.value)} placeholder="e.g. Moving abroad, pet passed away" />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Keep plan</Button>
          <Button variant="destructive" disabled={!reason.trim()} loading={cancel.isPending} onClick={() => cancel.mutate()}>Cancel plan</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UsageDialog({ e, open, onOpenChange }: { e: WellnessEnrolment; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const left = e.entitlements.filter((x) => x.remaining > 0);
  const [entitlementId, setEntitlementId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setEntitlementId(left[0]?.id ?? '');
      setQuantity('1');
      setNote('');
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const ent = e.entitlements.find((x) => x.id === entitlementId);
  const save = useMutation({
    mutationFn: () => api.post<WellnessEnrolment>(`/wellness/enrolments/${e.id}/usage`, { entitlementId, quantity: Number(quantity), note }),
    onSuccess: () => {
      toast.success('Recorded');
      invalidate(qc, e.patient.id);
      onOpenChange(false);
    },
    onError: (err: Error) => setError(err.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Record an included item</DialogTitle>
          <DialogDescription>For an included item given without a charge (charges are covered automatically).</DialogDescription>
        </DialogHeader>
        {error && <FormError message={error} />}
        <Field label="Item" htmlFor="wu-item">
          <NativeSelect id="wu-item" value={entitlementId} onChange={(ev) => setEntitlementId(ev.target.value)}>
            {left.map((x) => <option key={x.id} value={x.id}>{x.label} ({x.remaining} left)</option>)}
          </NativeSelect>
        </Field>
        <Field label="How many" htmlFor="wu-qty">
          <Input id="wu-qty" type="number" min={1} max={ent?.remaining ?? 1} value={quantity} onChange={(ev) => setQuantity(ev.target.value)} className="w-28" />
        </Field>
        <Field label="Note" htmlFor="wu-note" required>
          <Input id="wu-note" value={note} maxLength={300} onChange={(ev) => setNote(ev.target.value)} placeholder="e.g. nail clip at the counter" />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!ent || !note.trim() || !(Number(quantity) >= 1)} loading={save.isPending} onClick={() => save.mutate()}>Record</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RenewDialog({ e, plans, open, onOpenChange }: { e: WellnessEnrolment; plans: WellnessPlan[]; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { currency } = useSession();
  const qc = useQueryClient();
  const [planId, setPlanId] = useState(e.planId);
  const [billing, setBilling] = useState(e.billing);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setPlanId(plans.some((p) => p.id === e.planId) ? e.planId : (plans[0]?.id ?? ''));
      setBilling(e.billing);
      setError(null);
    }
  }, [open, e, plans]);
  const plan = plans.find((p) => p.id === planId);
  const renew = useMutation({
    mutationFn: () => api.post<WellnessEnrolment>(`/wellness/enrolments/${e.id}/renew`, { planId, billing: plan?.monthlyPriceMinor == null ? 'UPFRONT' : billing }),
    onSuccess: (r) => {
      toast.success(`Renewed: ${r.planName} from ${fmtDate(r.startDate)}`);
      invalidate(qc, e.patient.id);
      onOpenChange(false);
    },
    onError: (err: Error) => setError(err.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Renew {e.planName}</DialogTitle>
          <DialogDescription>The new term starts the day after this one ends ({fmtDate(dayAfter(e.endDate))}). Its first payment is billed then. No joining fee.</DialogDescription>
        </DialogHeader>
        {error && <FormError message={error} />}
        {!plans.length ? (
          <p className="text-sm text-muted-foreground">No plans are on offer for this patient.</p>
        ) : (
          <>
            <Field label="Plan" htmlFor="wr-plan" hint={plan && plan.id !== e.planId ? 'Switching plans: the new plan’s benefits apply from the renewal date.' : undefined}>
              <NativeSelect id="wr-plan" value={planId} onChange={(ev) => setPlanId(ev.target.value)}>
                {plans.map((p) => <option key={p.id} value={p.id}>{p.name} · {fmtMoney(p.priceMinor, currency)}</option>)}
              </NativeSelect>
            </Field>
            {plan?.monthlyPriceMinor != null && (
              <Field label="Payment" htmlFor="wr-billing">
                <NativeSelect id="wr-billing" value={billing} onChange={(ev) => setBilling(ev.target.value as 'UPFRONT' | 'MONTHLY')}>
                  <option value="UPFRONT">Up front — {fmtMoney(plan.priceMinor, currency)}</option>
                  <option value="MONTHLY">Monthly — {fmtMoney(plan.monthlyPriceMinor, currency)} × {plan.durationMonths}</option>
                </NativeSelect>
              </Field>
            )}
          </>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!plan} loading={renew.isPending} onClick={() => renew.mutate()}><RefreshCw /> Renew</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const dayAfter = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) + 86400_000).toISOString().slice(0, 10);

function Progress({ value, max, tone = 'primary' }: { value: number; max: number; tone?: 'primary' | 'success' | 'muted' }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/10" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <div className={cn('h-full rounded-full transition-[width]', tone === 'success' ? 'bg-success' : tone === 'muted' ? 'bg-muted-foreground/50' : 'bg-primary')} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** One membership in full: term, benefits used and left, payments and their invoices, and the benefit history. */
export function MembershipCard({ e, plans, compact }: { e: WellnessEnrolment; plans: WellnessPlan[]; compact?: boolean }) {
  const { currency, can } = useSession();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [dlg, setDlg] = useState<null | 'cancel' | 'usage' | 'renew'>(null);
  const [showAll, setShowAll] = useState(false);
  const [allPayments, setAllPayments] = useState(false);
  const writable = can('wellness.enrol') && e.status === 'ACTIVE';
  const termDays = Math.max(1, Math.round((Date.parse(e.endDate) - Date.parse(e.startDate)) / 86400_000) + 1);
  const autoRenew = useMutation({
    mutationFn: (v: boolean) => api.post<WellnessEnrolment>(`/wellness/enrolments/${e.id}/auto-renew`, { autoRenew: v }),
    onSuccess: (r) => {
      toast.success(r.autoRenew ? 'Will renew automatically' : 'Won’t renew automatically');
      invalidate(qc, e.patient.id);
    },
    onError: (err: Error) => toast.error(err.message),
  });
  const apply = useMutation({
    mutationFn: () => api.post<{ applied: number }>(`/wellness/enrolments/${e.id}/apply`),
    onSuccess: (r) => {
      toast.success(r.applied ? `Plan applied to ${r.applied} unbilled item(s)` : 'No unbilled items to apply the plan to');
      invalidate(qc, e.patient.id);
    },
    onError: (err: Error) => toast.error(err.message),
  });
  const reverse = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.post(`/wellness/usages/${id}/reverse`, { reason }),
    onSuccess: () => {
      toast.success('Benefit given back');
      invalidate(qc, e.patient.id);
    },
    onError: (err: Error) => toast.error(err.message),
  });
  const usages = showAll ? e.usages : e.usages.slice(0, 5);
  // Long monthly schedules: payments already billed, then the next two; the rest on request.
  const nextIdx = e.instalments.findIndex((i) => i.status === 'SCHEDULED');
  const cut = nextIdx === -1 ? e.instalments.length : nextIdx + 2;
  const payments = allPayments || e.instalments.length <= 4 ? e.instalments : e.instalments.slice(0, Math.max(cut, 3));
  const renewable = writable && !e.renewedTo && (e.state === 'ACTIVE' || e.state === 'EXPIRED');

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle className="flex flex-wrap items-center gap-2">
            <HeartHandshake className="h-4 w-4 text-primary" /> {e.planName}
            <WellnessStateBadge state={e.state} autoRenew={e.autoRenew} renewed={!!e.renewedTo} />
          </CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {e.enrolmentNo} · {fmtDate(e.startDate)} – {fmtDate(e.endDate)} · {e.billing === 'MONTHLY' ? 'paid monthly' : 'paid up front'}
            {e.state === 'ACTIVE' && e.daysLeft != null && ` · ${e.daysLeft} days left`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {renewable && (
            <Button size="sm" variant={e.daysLeft != null && e.daysLeft <= 30 ? 'default' : 'outline'} onClick={() => setDlg('renew')}>
              <RefreshCw /> Renew
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" aria-label="More plan actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuItem asChild>
                <Link href={`/wellness/${e.id}/agreement`}><FileText /> Print agreement</Link>
              </DropdownMenuItem>
              {writable && e.state === 'ACTIVE' && (
                <>
                  <DropdownMenuItem onSelect={() => setDlg('usage')} disabled={!e.entitlements.some((x) => x.remaining > 0)}>
                    <Plus /> Record an included item
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => apply.mutate()}>
                    <Sparkles /> Apply to unbilled items
                  </DropdownMenuItem>
                </>
              )}
              {writable && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem destructive onSelect={() => setDlg('cancel')}>
                    <XCircle /> Cancel plan
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>

      <div className="grid gap-5 border-t p-4">
        {e.state === 'ACTIVE' && (
          <div className="grid gap-1.5">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Plan year</span>
              <span>{termDays - (e.daysLeft ?? 0)} of {termDays} days</span>
            </div>
            <Progress value={termDays - (e.daysLeft ?? 0)} max={termDays} tone="muted" />
          </div>
        )}
        {e.state === 'CANCELLED' && (
          <p className="rounded-lg bg-destructive/5 px-3 py-2 text-sm">
            Cancelled {fmtDateTime(e.cancelledAt)} by {e.cancelledByName}: {e.cancelReason}
          </p>
        )}
        {e.renewedTo && (
          <p className="text-sm text-muted-foreground">
            <CalendarClock className="mr-1 inline h-4 w-4" />
            Renewed as {e.renewedTo.enrolmentNo}, starting {fmtDate(e.renewedTo.startDate)}.
          </p>
        )}

        <div className="grid gap-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <div className="grid content-start gap-3">
            <p className="text-sm font-semibold">Included</p>
            {e.entitlements.length ? (
              e.entitlements.map((x) => (
                <div key={x.id} className="grid gap-1">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate">{x.label}</span>
                    <span className={cn('shrink-0 tabular text-xs', x.remaining === 0 ? 'text-muted-foreground' : 'font-medium')}>
                      {x.used} of {x.quantity} used{x.remaining > 0 && ` · ${x.remaining} left`}
                    </span>
                  </div>
                  <Progress value={x.used} max={x.quantity} tone={x.remaining === 0 ? 'success' : 'primary'} />
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No included items — member discount only.</p>
            )}
            {(e.serviceDiscountBp > 0 || e.productDiscountBp > 0) && (
              <p className="text-sm text-success">
                Member discount: {[e.serviceDiscountBp > 0 && `${bpToPct(e.serviceDiscountBp)} off services and lab tests`, e.productDiscountBp > 0 && `${bpToPct(e.productDiscountBp)} off products`].filter(Boolean).join(', ')}
              </p>
            )}
          </div>
          <div className="grid content-start gap-3">
            <div className="rounded-xl bg-success/[0.07] p-3 ring-1 ring-inset ring-success/20">
              <p className="text-xs font-medium text-muted-foreground">Saved so far</p>
              <p className="text-2xl font-semibold tabular text-success">{fmtMoney(e.savedMinor, currency)}</p>
              <p className="text-xs text-muted-foreground">Plan price {fmtMoney(e.totalMinor, currency)}{e.joiningFeeMinor > 0 ? ` incl. ${fmtMoney(e.joiningFeeMinor, currency)} joining fee` : ''}</p>
            </div>
            {e.nextPayment && e.status === 'ACTIVE' && (
              <p className="text-sm">
                Next payment <b className="tabular">{fmtMoney(e.nextPayment.amountMinor, currency)}</b> on {fmtDate(e.nextPayment.dueDate)}
              </p>
            )}
            {writable && (
              <label className="flex items-center justify-between gap-2 text-sm">
                <span>Renew automatically</span>
                <Switch checked={e.autoRenew} disabled={autoRenew.isPending || !!e.renewedTo} onCheckedChange={(v) => autoRenew.mutate(v)} aria-label="Renew automatically" />
              </label>
            )}
          </div>
        </div>

        {!compact && (
          <>
            <div>
              <p className="mb-2 text-sm font-semibold">Payments</p>
              <ul className="divide-y rounded-lg border text-sm">
                {payments.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                    <span className="w-24 text-xs text-muted-foreground">{fmtDate(i.dueDate)}</span>
                    <span className="min-w-0 flex-1">{e.billing === 'UPFRONT' ? 'Full term' : `Payment ${i.seq} of ${e.instalments.length}`}</span>
                    <span className="tabular">{fmtMoney(i.amountMinor, currency)}</span>
                    <span className="w-36 text-right">
                      {i.status === 'CANCELLED' ? (
                        <Badge variant="secondary">Cancelled</Badge>
                      ) : i.status === 'SCHEDULED' ? (
                        <Badge variant="outline">Not due yet</Badge>
                      ) : i.invoice ? (
                        can('billing.read') ? (
                          <Link href={`/billing/invoices/${i.invoice.id}`} className="hover:underline">
                            <Badge variant={i.invoice.status === 'PAID' ? 'success' : i.invoice.status === 'VOID' ? 'secondary' : 'warning'}>{i.invoice.invoiceNo} · {i.invoice.status === 'PAID' ? 'Paid' : i.invoice.status === 'DRAFT' ? 'Draft' : i.invoice.status === 'VOID' ? 'Void' : 'Owing'}</Badge>
                          </Link>
                        ) : (
                          <Badge variant={i.invoice.status === 'PAID' ? 'success' : 'warning'}>{i.invoice.status === 'PAID' ? 'Paid' : 'Invoiced'}</Badge>
                        )
                      ) : i.chargeStatus === 'WAIVED' ? (
                        <Badge variant="secondary">Waived</Badge>
                      ) : (
                        <Badge variant="info">To invoice</Badge>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              {payments.length < e.instalments.length && (
                <Button size="sm" variant="ghost" className="mt-1" onClick={() => setAllPayments(true)}>
                  Show all {e.instalments.length} payments
                </Button>
              )}
            </div>

            <div>
              <p className="mb-2 text-sm font-semibold">Benefits used</p>
              {e.usages.length ? (
                <ul className="divide-y rounded-lg border text-sm">
                  {usages.map((u) => (
                    <li key={u.id} className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2', u.reversedAt && 'opacity-60')}>
                      <span className="w-24 text-xs text-muted-foreground">{fmtDate(u.usedAt)}</span>
                      <span className="min-w-0 flex-1">
                        <span className={cn(u.reversedAt && 'line-through')}>{u.description}</span>
                        <span className="text-xs text-muted-foreground"> · {u.kind === 'DISCOUNT' ? 'member discount' : u.kind === 'MANUAL' ? `recorded: ${u.note}` : 'included'}</span>
                        {u.reversedAt && <span className="block text-xs text-muted-foreground">Given back: {u.reversedReason}</span>}
                      </span>
                      <span className="tabular text-success">−{fmtMoney(u.savedMinor, currency)}</span>
                      {writable && !u.reversedAt && (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Give back ${u.description}`}
                          title="Give this benefit back (e.g. recorded on the wrong patient)"
                          onClick={async () => {
                            const r = await confirm({ title: 'Give this benefit back?', description: u.chargeId ? 'The full price goes back on the unbilled charge.' : 'The item counts as not used.', requireReason: true, confirmLabel: 'Give back' });
                            if (r.confirmed) reverse.mutate({ id: u.id, reason: r.reason! });
                          }}
                        >
                          <RotateCcw />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">Nothing used yet. Included items and discounts are taken off the bill automatically.</p>
              )}
              {e.usages.length > 5 && (
                <Button size="sm" variant="ghost" className="mt-1" onClick={() => setShowAll(!showAll)}>
                  {showAll ? 'Show fewer' : `Show all ${e.usages.length}`}
                </Button>
              )}
            </div>
            {e.notes && <p className="text-sm text-muted-foreground">Notes: {e.notes}</p>}
          </>
        )}
      </div>
      <CancelDialog e={e} open={dlg === 'cancel'} onOpenChange={(o) => setDlg(o ? 'cancel' : null)} />
      <UsageDialog e={e} open={dlg === 'usage'} onOpenChange={(o) => setDlg(o ? 'usage' : null)} />
      <RenewDialog e={e} plans={plans} open={dlg === 'renew'} onOpenChange={(o) => setDlg(o ? 'renew' : null)} />
    </Card>
  );
}
