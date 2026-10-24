'use client';
import { AlertOctagon, AlertTriangle, ArrowRight, BedDouble, Boxes, CalendarClock, CheckCircle2, FileWarning, FlaskConical, ListChecks, MessageSquare, Pill, Receipt, Scissors, ShieldAlert, Siren, Syringe, Users, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { fmtDate } from '@/lib/format';
import { cn } from '@/lib/utils';

export type Severity = 'danger' | 'warning' | 'info';

export interface AttentionItem {
  key: string;
  severity: Severity;
  icon: React.ComponentType<{ className?: string }>;
  /** Plain-language sentence, e.g. "3 patients are waiting to be seen". */
  text: string;
  detail?: string;
  action: string;
  href: string;
}

const ORDER: Record<Severity, number> = { danger: 0, warning: 1, info: 2 };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Stock items, left out of the front-desk list ("Still to do"): stock is not reception's job. */
const STOCK_KEYS = new Set(['low-stock', 'expiring']);

/**
 * Widgets come from GET /dashboard; each is only present when the user may see it (and, for optional
 * modules, while the clinic offers that module). `hideStock` drops stock items for front-desk staff.
 */
export function buildAttention(w: any, opts: { money: (minor: number) => string; portal: boolean; can: (p: string) => boolean; hideStock?: boolean }): AttentionItem[] {
  const items: AttentionItem[] = [];
  const add = (cond: unknown, item: AttentionItem) => { if (cond) items.push(item); };
  const appts = w?.appointmentsToday;
  const waiting = appts?.byStatus?.CHECKED_IN ?? 0;

  add(appts?.emergencies, { key: 'emergency', severity: 'danger', icon: Siren, text: `${plural(appts?.emergencies, 'emergency', 'emergencies')} in the clinic`, action: 'Front desk', href: '/front-desk' });
  add(w?.hospital?.overdueTreatments, { key: 'overdue-tx', severity: 'danger', icon: AlertOctagon, text: `${plural(w?.hospital?.overdueTreatments, 'treatment')} overdue in hospital`, action: 'Treatment sheet', href: '/hospital' });
  add(w?.hospital?.critical?.length, { key: 'critical-inpatients', severity: 'danger', icon: BedDouble, text: `${plural(w?.hospital?.critical?.length, 'inpatient')} in critical condition`, detail: w?.hospital?.critical?.map((c: { patient: { name: string } }) => c.patient.name).join(', '), action: 'Hospital', href: '/hospital' });
  add(w?.lab?.critical?.length, { key: 'critical-results', severity: 'danger', icon: FlaskConical, text: `${plural(w?.lab?.critical?.length, 'critical lab result')} this week`, action: 'Review', href: '/lab?tab=critical' });
  add(w?.livestock?.openOutbreaks, { key: 'outbreaks', severity: 'danger', icon: AlertTriangle, text: `${plural(w?.livestock?.openOutbreaks, 'open disease outbreak')}`, action: 'Outbreaks', href: '/livestock?tab=outbreaks' });
  add(w?.communications?.failedMessages, { key: 'failed-msgs', severity: 'danger', icon: MessageSquare, text: `${plural(w?.communications?.failedMessages, 'message')} could not be sent`, detail: 'Last 7 days', action: 'Message log', href: '/communications?status=FAILED' });

  add(appts?.staleOpen, { key: 'stale-open', severity: 'warning', icon: CalendarClock, text: `${plural(appts?.staleOpen, 'visit')} from an earlier day still open`, detail: 'Checked in or in consultation but never completed', action: 'Open that day', href: `/calendar?view=day&date=${appts?.staleDate ?? ''}` });
  add(appts?.staleUnresolved, { key: 'stale-booked', severity: 'warning', icon: CalendarClock, text: `${plural(appts?.staleUnresolved, 'past appointment')} not marked arrived or no-show`, detail: 'Open each one on the calendar and choose Check in or No-show', action: 'Mark arrived or no-show', href: `/calendar?view=day&date=${appts?.staleDate ?? ''}` });
  add(appts?.notArrived, { key: 'not-arrived', severity: 'warning', icon: CalendarClock, text: `${plural(appts?.notArrived, 'booked patient')} not arrived yet`, detail: 'More than 15 minutes past their time', action: 'Calendar', href: '/calendar' });
  add(waiting, { key: 'waiting', severity: 'warning', icon: Users, text: `${plural(waiting, 'patient')} waiting to be seen`, action: 'Waiting list', href: '/front-desk' });
  add(w?.clinicalWork?.unsignedNotes?.length, {
    key: 'unsigned', severity: 'warning', icon: FileWarning, text: `${plural(w?.clinicalWork?.unsignedNotes?.length, 'of your notes', 'of your notes')} not signed yet`,
    detail: w?.clinicalWork?.unsignedNotes?.slice(0, 3).map((n: { patient: string }) => n.patient).join(', '),
    action: 'Sign notes', href: w?.clinicalWork?.unsignedNotes?.length === 1 ? `/consultations/${w.clinicalWork.unsignedNotes[0].encounterId}` : '/consultations?mine=true',
  });
  add(w?.onlineBookings?.toConfirm, { key: 'online-bookings', severity: 'warning', icon: CalendarClock, text: `${plural(w?.onlineBookings?.toConfirm, 'online booking')} to confirm`, detail: 'Clients booked these themselves on your booking page', action: 'Open calendar', href: `/calendar${w?.onlineBookings?.firstDate ? `?date=${w.onlineBookings.firstDate}` : ''}` });
  add(w?.pharmacy?.awaitingAuthorization, { key: 'rx-auth', severity: 'warning', icon: Pill, text: `${plural(w?.pharmacy?.awaitingAuthorization, 'prescription')} waiting for authorisation`, action: 'Review', href: '/pharmacy?status=DRAFT' });
  add(opts.can('lab.approve') && w?.lab?.awaitingValidation, { key: 'lab-validate', severity: 'warning', icon: FlaskConical, text: `${plural(w?.lab?.awaitingValidation, 'lab result')} waiting for validation`, action: 'Validate', href: '/lab?tab=AWAITING_VALIDATION' });
  const overdueTasks = (w?.tasks?.dueOrOverdue ?? []).filter((t: { overdue: boolean }) => t.overdue).length;
  add(overdueTasks, { key: 'tasks', severity: 'warning', icon: ListChecks, text: `${plural(overdueTasks, 'follow-up')} overdue`, action: 'See below', href: '#follow-ups' });
  add(w?.finance?.unbilledCount, { key: 'unbilled', severity: 'warning', icon: Receipt, text: `${plural(w?.finance?.unbilledCount, 'charge')} not invoiced yet`, detail: `${opts.money(w?.finance?.unbilledMinor ?? 0)} before tax`, ...(opts.can('billing.write') ? { action: 'Make invoices', href: '/billing/charges' } : { action: 'View', href: '/billing/charges' }) });
  for (const d of (opts.can('cash.manage') ? w?.cashDrawers?.notClosed ?? [] : []).slice(0, 3) as { sessionId: string; register: string; openedAt: string }[]) {
    add(true, { key: `cash-${d.sessionId}`, severity: 'warning', icon: Wallet, text: `Cash drawer at ${d.register} not closed since ${fmtDate(d.openedAt)}`, detail: 'Count the cash and close the drawer', action: 'Count cash', href: '/billing/cash' });
  }
  add(w?.finance?.overdueInvoices, { key: 'overdue-inv', severity: 'warning', icon: Receipt, text: `${plural(w?.finance?.overdueInvoices, 'invoice')} overdue for payment`, action: 'Follow up', href: '/billing?tab=overdue' });
  add(w?.inventory?.lowStockCount, { key: 'low-stock', severity: 'warning', icon: Boxes, text: `${plural(w?.inventory?.lowStockCount, 'product')} below reorder level`, detail: w?.inventory?.lowStock?.slice(0, 3).map((p: { name: string }) => p.name).join(', '), ...(opts.can('procurement.write') ? { action: 'Reorder', href: '/inventory/purchase-orders' } : { action: 'View', href: '/inventory?filter=low' }) });
  add(w?.insurance?.claimsQueried, { key: 'claims-queried', severity: 'warning', icon: ShieldAlert, text: `${plural(w?.insurance?.claimsQueried, 'insurance claim')} queried by the insurer`, action: 'Answer', href: '/insurance?tab=claims&status=QUERIED' });
  add(opts.portal && w?.communications?.unreadMessages, { key: 'unread', severity: 'warning', icon: MessageSquare, text: `${plural(w?.communications?.unreadMessages, 'unread client message')}`, action: 'Inbox', href: '/communications?tab=inbox' });
  add(opts.portal && w?.communications?.pendingRequests, { key: 'requests', severity: 'warning', icon: CalendarClock, text: `${plural(w?.communications?.pendingRequests, 'online appointment request')}`, action: 'Book', href: '/communications?tab=requests' });

  add(w?.pharmacy?.readyToDispense, { key: 'dispense', severity: 'info', icon: Pill, text: `${plural(w?.pharmacy?.readyToDispense, 'prescription')} ready to dispense`, action: 'Pharmacy', href: '/pharmacy' });
  add(w?.lab?.toCollect, { key: 'samples', severity: 'info', icon: FlaskConical, text: `${plural(w?.lab?.toCollect, 'sample')} to collect`, action: 'Laboratory', href: '/lab?tab=ORDERED' });
  add(w?.boarding?.grooming?.ready, { key: 'groom-ready', severity: 'info', icon: Scissors, text: `${plural(w?.boarding?.grooming?.ready, 'pet')} groomed and ready for collection`, action: 'Grooming board', href: '/boarding?tab=grooming' });
  add(w?.boarding?.arrivingToday || w?.boarding?.departingToday, { key: 'boarding-today', severity: 'info', icon: BedDouble, text: `Boarding today: ${w?.boarding?.arrivingToday ?? 0} arriving, ${w?.boarding?.departingToday ?? 0} going home`, action: 'Boarding', href: '/boarding' });
  add(w?.preventive?.overdue, { key: 'preventive', severity: 'info', icon: Syringe, text: `${plural(w?.preventive?.overdue, 'animal')} overdue for vaccination or preventive care`, action: 'See list', href: '/preventive?range=overdue' });
  add(w?.inventory?.expiringCount, { key: 'expiring', severity: 'info', icon: CalendarClock, text: `${plural(w?.inventory?.expiringCount, 'product')} expiring within 60 days`, action: 'Check stock', href: '/inventory?filter=exp90' });
  add(w?.livestock?.animalsUnderWithdrawal, { key: 'withdrawal', severity: 'info', icon: ShieldAlert, text: `${plural(w?.livestock?.animalsUnderWithdrawal, 'farm animal')} under a withdrawal period`, action: 'Withdrawals', href: '/livestock?tab=withdrawals' });

  return items.filter((i) => !(opts.hideStock && STOCK_KEYS.has(i.key))).sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
}

const TONE: Record<Severity, { dot: string; icon: string; label: string }> = {
  danger: { dot: 'bg-destructive', icon: 'bg-destructive/10 text-destructive', label: 'Urgent' },
  warning: { dot: 'bg-warning', icon: 'bg-warning/15 text-warning', label: 'To do' },
  info: { dot: 'bg-primary', icon: 'bg-primary/10 text-primary', label: 'Today' },
};

/** "Needs your attention": the next things to do, most urgent first; nothing is shown for zero counts. */
export function AttentionList({ items, title = 'Needs your attention' }: { items: AttentionItem[]; title?: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, 7);
  if (!items.length) {
    return (
      <div className="surface flex items-center gap-4 rounded-xl px-6 py-5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-success/10 text-success ring-1 ring-inset ring-success/20"><CheckCircle2 className="h-5 w-5" /></span>
        <div>
          <p className="text-sm font-medium">You’re all caught up</p>
          <p className="text-xs text-muted-foreground">Nothing needs your attention right now. New work appears here as it comes in.</p>
        </div>
      </div>
    );
  }
  return (
    <section aria-label={title} className="surface overflow-hidden rounded-xl">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-foreground/[0.06] px-6 py-4">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        <span className="flex flex-wrap gap-1.5 text-2xs">
          {(['danger', 'warning', 'info'] as const).map((s) => {
            const n = items.filter((i) => i.severity === s).length;
            return n ? (
              <span key={s} className="flex items-center gap-1.5 rounded-pill bg-foreground/[0.05] px-2.5 py-1 font-semibold ring-1 ring-inset ring-foreground/[0.06]">
                <span className={cn('h-2 w-2 rounded-full', TONE[s].dot)} />
                {TONE[s].label} <span className="tabular">{n}</span>
              </span>
            ) : null;
          })}
        </span>
      </header>
      <ul className="divide-y divide-foreground/[0.05]">
        {shown.map((i) => (
          <li key={i.key}>
            {/* Phones: the action wraps under the text, so nothing scrolls sideways. */}
            <Link href={i.href} className="group flex flex-wrap items-center gap-x-3 gap-y-1 px-6 py-3 transition-colors duration-200 hover:bg-[hsl(var(--glass)/0.5)] focus-visible:bg-[hsl(var(--glass)/0.5)] focus-visible:outline-none sm:flex-nowrap">
              <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', TONE[i.severity].icon)}><i.icon className="h-4 w-4" /></span>
              <span className="min-w-0 flex-1">
                <span className="block break-words text-sm font-medium">{i.text}</span>
                {i.detail && <span className="block break-words text-xs text-muted-foreground sm:truncate">{i.detail}</span>}
              </span>
              <span className="flex basis-full items-center gap-1 pl-12 text-xs font-semibold text-primary sm:basis-auto sm:shrink-0 sm:pl-0">
                {i.action} <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {items.length > 7 && (
        <button type="button" onClick={() => setAll((v) => !v)} className="min-h-11 w-full border-t border-foreground/[0.06] px-6 py-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-[hsl(var(--glass)/0.5)] hover:text-foreground">
          {all ? 'Show fewer' : `Show ${items.length - 7} more`}
        </button>
      )}
    </section>
  );
}
