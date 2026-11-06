'use client';
import { useQuery } from '@tanstack/react-query';
import type { Paginated } from '@vcms/shared';
import { CalendarCheck, CalendarPlus, FileText, Receipt } from 'lucide-react';
import Link from 'next/link';
import { api, qs } from '@/lib/api';
import { chargeNet, fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { Appointment, Charge, Encounter } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Quick choices for when the animal should come back. */
const NEXT_IN = [
  { label: '3 days', days: 3 },
  { label: '1 week', days: 7 },
  { label: '2 weeks', days: 14 },
  { label: '1 month', days: 30 },
];

const tile = 'group flex flex-col items-start gap-3 rounded-2xl surface-flat p-5 text-left shadow-card transition-colors';
const clickable = 'hover:border-primary/50 hover:bg-primary/5';

/**
 * What a finished consultation shows: three clean tiles — bill it, view & print it, book the next visit.
 * Everything else about the visit is one click away under “Show full details”.
 */
export function FinishedVisitActions({
  encounter,
  recheck,
  recheckWhen,
  onViewRecord,
  onBookNext,
}: {
  encounter: Encounter;
  /** The next visit already booked from this consultation, if any. */
  recheck: Appointment | null;
  recheckWhen: string | null;
  /** Opens the record window (it has its own Print button). */
  onViewRecord: () => void;
  /** Opens the booking window `days` from today (null: let the user pick the date). */
  onBookNext?: (days: number | null) => void;
}) {
  const { can, currency } = useSession();
  const charges = useQuery({
    queryKey: ['charges', { encounterId: encounter.id }],
    queryFn: () => api.get<Paginated<Charge> & { totalMinor: number }>(`/charges${qs({ encounterId: encounter.id, status: 'ALL', pageSize: 50 })}`),
    enabled: can('billing.read'),
  });
  const live = (charges.data?.data ?? []).filter((c) => c.status !== 'WAIVED');
  const pending = live.filter((c) => c.status === 'PENDING');
  const invoice = live.find((c) => c.invoice)?.invoice ?? null;
  const billed = live.length > 0 && pending.length === 0 && !!invoice;
  const amount = (list: Charge[]) => fmtMoney(list.reduce((n, c) => n + chargeNet(c), 0), currency);

  return (
    <section aria-label="Consultation finished" className="mb-4 grid gap-3 md:grid-cols-3">
      {can('billing.write') &&
        (billed ? (
          <Link href={`/billing/invoices/${invoice!.id}`} className={cn(tile, clickable)}>
            <Icon icon={Receipt} done />
            <Text title="Billed" line={`${invoice!.invoiceNo} · ${amount(live)}`} />
          </Link>
        ) : (
          <Link href={`/billing/invoices/new?clientId=${encounter.client.id}`} className={cn(tile, clickable)}>
            <Icon icon={Receipt} primary />
            <Text title="Bill this consultation" line={charges.isLoading ? '…' : pending.length ? amount(pending) : 'Make the invoice'} />
          </Link>
        ))}

      <button type="button" onClick={onViewRecord} className={cn(tile, clickable)}>
        <Icon icon={FileText} />
        <Text title="View & print consultation" line="The clinical record of this visit" />
      </button>

      {onBookNext &&
        (recheck ? (
          <button type="button" onClick={() => onBookNext(null)} className={cn(tile, clickable)} title="Book another visit">
            <Icon icon={CalendarCheck} done />
            <Text title="Next consultation booked" line={`${recheckWhen}${recheck.clinician ? ` · ${recheck.clinician.name}` : ''}`} />
          </button>
        ) : (
          <div className={tile}>
            <Icon icon={CalendarPlus} />
            <Text title="Next consultation in" />
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Next consultation in">
              {[...NEXT_IN, { label: 'Other', days: null }].map((n) => (
                <button key={n.label} type="button" onClick={() => onBookNext(n.days)} className="rounded-pill border bg-card px-3 py-1 text-sm hover:border-primary hover:bg-primary/5">
                  {n.label}
                </button>
              ))}
            </div>
          </div>
        ))}
    </section>
  );
}

function Icon({ icon: I, primary, done }: { icon: React.ComponentType<{ className?: string }>; primary?: boolean; done?: boolean }) {
  return (
    <span className={cn('rounded-xl p-2.5', primary ? 'bg-primary text-primary-foreground' : done ? 'bg-success/15 text-success' : 'bg-muted text-foreground')}>
      <I className="h-5 w-5" />
    </span>
  );
}

function Text({ title, line }: { title: string; line?: string }) {
  return (
    <span className="grid gap-0.5">
      <span className="text-[15px] font-semibold">{title}</span>
      {line && <span className="text-sm tabular text-muted-foreground">{line}</span>}
    </span>
  );
}
