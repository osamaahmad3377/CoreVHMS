import { enumLabel } from '@vcms/shared';
import { Badge, type BadgeProps } from '../ui/badge';
import { fmtDate, fmtDateTime } from '@/lib/format';
import type { ReproStatus, WithdrawalBoardRow } from '@/lib/types';

const REPRO: Record<ReproStatus['state'], { label: string; variant: BadgeProps['variant'] }> = {
  OPEN: { label: 'Open', variant: 'secondary' },
  SERVED: { label: 'Served', variant: 'info' },
  PREGNANT: { label: 'Pregnant', variant: 'success' },
  DUE_SOON: { label: 'Due soon', variant: 'warning' },
  OVERDUE: { label: 'Overdue', variant: 'destructive' },
  DRY: { label: 'Dry', variant: 'outline' },
};

export function ReproBadge({ state }: { state: ReproStatus['state'] }) {
  const r = REPRO[state];
  return <Badge variant={r.variant}>{r.label}</Badge>;
}

const VISIT: Record<string, BadgeProps['variant']> = { SCHEDULED: 'info', IN_PROGRESS: 'warning', COMPLETED: 'success', CANCELLED: 'secondary' };
export function VisitStatusBadge({ status }: { status: string }) {
  return <Badge variant={VISIT[status] ?? 'secondary'}>{status === 'IN_PROGRESS' ? 'On site' : enumLabel(status)}</Badge>;
}

const OUTBREAK: Record<string, BadgeProps['variant']> = { SUSPECTED: 'warning', CONFIRMED: 'destructive', CONTROLLED: 'info', CLOSED: 'secondary' };
export function OutbreakStatusBadge({ status }: { status: string }) {
  return <Badge variant={OUTBREAK[status] ?? 'secondary'}>{enumLabel(status)}</Badge>;
}

/** Which products (meat, milk, eggs) may not be used yet, and until when. */
export function WithdrawalChips({ w }: { w: Pick<WithdrawalBoardRow, 'meatActive' | 'milkActive' | 'eggActive' | 'meatClearAt' | 'milkClearAt' | 'eggClearAt'> }) {
  const items = [
    w.meatActive && { k: 'Meat', at: w.meatClearAt },
    w.milkActive && { k: 'Milk', at: w.milkClearAt },
    w.eggActive && { k: 'Eggs', at: w.eggClearAt },
  ].filter(Boolean) as { k: string; at: string | null }[];
  if (!items.length) return <span className="text-xs text-muted-foreground">Cleared</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {items.map((i) => (
        <Badge key={i.k} variant="destructive" title={`Do not use ${i.k.toLowerCase()} before ${fmtDateTime(i.at)}`}>
          {i.k} until {fmtDate(i.at)}
        </Badge>
      ))}
    </span>
  );
}

export const BREEDING_LABELS: Record<string, string> = {
  HEAT: 'Heat observed',
  SERVICE: 'Natural service',
  INSEMINATION: 'Artificial insemination',
  PREGNANCY_CHECK: 'Pregnancy check',
  BIRTH: 'Birth',
  ABORTION: 'Abortion',
  DRY_OFF: 'Dried off',
};
