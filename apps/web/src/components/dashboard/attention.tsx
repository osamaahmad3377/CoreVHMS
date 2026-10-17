'use client';
import { AlertOctagon, AlertTriangle, ArrowRight, BedDouble, Boxes, CalendarClock, CheckCircle2, FileWarning, FlaskConical, ListChecks, MessageSquare, Pill, Receipt, Scissors, ShieldAlert, Siren, Syringe, Users } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
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

/** Widgets come from GET /dashboard; each is only present when the user may see it. */
export function buildAttention(w: any, opts: { money: (minor: number) => string; portal: boolean; can: (p: string) => boolean }): AttentionItem[] {
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

  add(appts?.staleOpen, { key: 'stale-open', severity: 'warning', icon: CalendarClock, text: `${plural(appts?.staleOpen, 'visit')} from an earlier day still open`, detail: 'Checked in or in consultation but never completed', action: 'Resolve', href: `/calendar?date=${appts?.staleDate ?? ''}` });
  add(appts?.staleUnresolved, { key: 'stale-booked', severity: 'warning', icon: CalendarClock, text: `${plural(appts?.staleUnresolved, 'past appointment')} not marked arrived or no-show`, detail: 'Check them in late, or mark them as no-show', action: 'Resolve', href: `/calendar?date=${appts?.staleDate ?? ''}` });
  add(appts?.notArrived, { key: 'not-arrived', severity: 'warning', icon: CalendarClock, text: `${plural(appts?.notArrived, 'booked patient')} not arrived yet`, detail: 'More than 15 minutes past their time', action: 'Calendar', href: '/calendar' });
  add(waiting, { key: 'waiting', severity: 'warning', icon: Users, text: `${plural(waiting, 'patient')} waiting to be seen`, action: 'Waiting list', href: '/front-desk' });
  add(w?.clinicalWork?.unsignedNotes?.length, {
    key: 'unsigned', severity: 'warning', icon: FileWarning, text: `${plural(w?.clinicalWork?.unsignedNotes?.length, 'of your notes', 'of your notes')} not signed yet`,
    detail: w?.clinicalWork?.unsignedNotes?.slice(0, 3).map((n: { patient: string }) => n.patient).join(', '),
    action: 'Sign notes', href: w?.clinicalWork?.unsignedNotes?.length === 1 ? `/consultations/${w.clinicalWork.unsignedNotes[0].encounterId}` : '/consultations?mine=true',
  });
  add(w?.pharmacy?.awaitingAuthorization, { key: 'rx-auth', severity: 'warning', icon: Pill, text: `${plural(w?.pharmacy?.awaitingAuthorization, 'prescription')} waiting for authorisation`, action: 'Review', href: '/pharmacy?status=DRAFT' });
  add(opts.can('lab.approve') && w?.lab?.awaitingValidation, { key: 'lab-validate', severity: 'warning', icon: FlaskConical, text: `${plural(w?.lab?.awaitingValidation, 'lab result')} waiting for validation`, action: 'Validate', href: '/lab?tab=AWAITING_VALIDATION' });
  const overdueTasks = (w?.tasks?.dueOrOverdue ?? []).filter((t: { overdue: boolean }) => t.overdue).length;
  add(overdueTasks, { key: 'tasks', severity: 'warning', icon: ListChecks, text: `${plural(overdueTasks, 'follow-up')} overdue`, action: 'See below', href: '#follow-ups' });
  add(w?.finance?.unbilledCount, { key: 'unbilled', severity: 'warning', icon: Receipt, text: `${plural(w?.finance?.unbilledCount, 'charge')} not invoiced yet`, detail: `${opts.money(w?.finance?.unbilledMinor ?? 0)} before tax`, ...(opts.can('billing.write') ? { action: 'Invoice them', href: '/billing/charges' } : { action: 'View', href: '/billing/charges' }) });
  add(w?.finance?.overdueInvoices, { key: 'overdue-inv', severity: 'warning', icon: Receipt, text: `${plural(w?.finance?.overdueInvoices, 'invoice')} overdue for payment`, action: 'Follow up', href: '/billing?tab=overdue' });
  add(w?.inventory?.lowStockCount, { key: 'low-stock', severity: 'warning', icon: Boxes, text: `${plural(w?.inventory?.lowStockCount, 'product')} below reorder level`, detail: w?.inventory?.lowStock?.slice(0, 3).map((p: { name: string }) => p.name).join(', '), ...(opts.can('procurement.write') ? { action: 'Reorder', href: '/inventory/purchase-orders' } : { action: 'View', href: '/inventory?filter=low' }) });
  add(w?.insurance?.claimsQueried, { key: 'claims-queried', severity: 'warning', icon: ShieldAlert, text: `${plural(w?.insurance?.claimsQueried, 'insurance claim')} queried by the insurer`, action: 'Answer', href: '/insurance?tab=claims&status=QUERIED' });
  add(opts.portal && w?.communications?.unreadMessages, { key: 'unread', severity: 'warning', icon: MessageSquare, text: `${plural(w?.communications?.unreadMessages, 'unread client message')}`, action: 'Inbox', href: '/communications?tab=inbox' });
  add(opts.portal && w?.communications?.pendingRequests, { key: 'requests', severity: 'warning', icon: CalendarClock, text: `${plural(w?.communications?.pendingRequests, 'online appointment request')}`, action: 'Book', href: '/communications?tab=requests' });

  add(w?.pharmacy?.readyToDispense, { key: 'dispense', severity: 'info', icon: Pill, text: `${plural(w?.pharmacy?.readyToDispense, 'prescription')} ready to dispense`, action: 'Pharmacy', href: '/pharmacy' });
  add(w?.lab?.toCollect, { key: 'samples', severity: 'info', icon: FlaskConical, text: `${plural(w?.lab?.toCollect, 'sample')} to collect`, action: 'Laboratory', href: '/lab?tab=ORDERED' });
  add(w?.boarding?.grooming?.ready, { key: 'groom-ready', severity: 'info', icon: Scissors, text: `${plural(w?.boarding?.grooming?.ready, 'pet')} groomed and ready for collection`, action: 'Grooming board', href: '/boarding?tab=grooming' });
  add(w?.boarding?.arrivingToday || w?.boarding?.departingToday, { key: 'boarding-today', severity: 'info', icon: BedDouble, text: `Boarding today: ${w?.boarding?.arrivingToday ?? 0} arriving, ${w?.boarding?.departingToday ?? 0} going home`, action: 'Boarding', href: '/boarding' });
  add(w?.preventive?.overdue, { key: 'preventive', severity: 'info', icon: Syringe, text: `${plural(w?.preventive?.overdue, 'animal')} overdue for vaccination or preventive care`, action: 'Worklist', href: '/preventive?range=overdue' });
  add(w?.inventory?.expiringCount, { key: 'expiring', severity: 'info', icon: CalendarClock, text: `${plural(w?.inventory?.expiringCount, 'product')} expiring within 60 days`, action: 'Check stock', href: '/inventory?filter=exp90' });
  add(w?.livestock?.animalsUnderWithdrawal, { key: 'withdrawal', severity: 'info', icon: ShieldAlert, text: `${plural(w?.livestock?.animalsUnderWithdrawal, 'farm animal')} under a withdrawal period`, action: 'Withdrawals', href: '/livestock?tab=withdrawals' });

  return items.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
}

const TONE: Record<Severity, { dot: string; icon: string; label: string }> = {
  danger: { dot: 'bg-destructive', icon: 'bg-destructive/10 text-destructive', label: 'Urgent' },
  warning: { dot: 'bg-warning', icon: 'bg-warning/15 text-warning', label: 'To do' },
  info: { dot: 'bg-primary', icon: 'bg-primary/10 text-primary', label: 'For today' },
};

/** "Needs your attention": the next things to do, most urgent first; nothing is shown for zero counts. */
export function AttentionList({ items }: { items: AttentionItem[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, 7);
  if (!items.length) {
    return (
      <div className="flex items-center gap-3 rounded-lg border bg-success/5 px-4 py-3">
        <CheckCircle2 className="h-5 w-5 text-success" />
        <div>
          <p className="text-sm font-medium">You’re all caught up</p>
          <p className="text-xs text-muted-foreground">Nothing needs your attention right now. New work appears here as it comes in.</p>
        </div>
      </div>
    );
  }
  return (
    <section aria-label="Needs your attention" className="overflow-hidden rounded-lg border bg-card shadow-sm">
      <header className="flex items-center justify-between border-b px-4 py-2.5">
        <h2 className="text-sm font-semibold">Needs your attention</h2>
        <span className="flex gap-3 text-2xs text-muted-foreground">
          {(['danger', 'warning', 'info'] as const).map((s) => {
            const n = items.filter((i) => i.severity === s).length;
            return n ? <span key={s} className="flex items-center gap-1"><span className={cn('h-2 w-2 rounded-full', TONE[s].dot)} />{n} {TONE[s].label.toLowerCase()}</span> : null;
          })}
        </span>
      </header>
      <ul className="divide-y">
        {shown.map((i) => (
          <li key={i.key}>
            <Link href={i.href} className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none">
              <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-md', TONE[i.severity].icon)}><i.icon className="h-4 w-4" /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{i.text}</span>
                {i.detail && <span className="block truncate text-xs text-muted-foreground">{i.detail}</span>}
              </span>
              <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-primary">
                {i.action} <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {items.length > 7 && (
        <button type="button" onClick={() => setAll((v) => !v)} className="w-full border-t px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground">
          {all ? 'Show fewer' : `Show ${items.length - 7} more`}
        </button>
      )}
    </section>
  );
}
