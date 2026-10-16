import { TRIAGE_COLOURS, enumLabel, type TriagePriority } from '@vcms/shared';
import { Badge, type BadgeProps } from '../ui/badge';
import { cn } from '@/lib/utils';

const VARIANT: Record<string, BadgeProps['variant']> = {
  BOOKED: 'secondary',
  CONFIRMED: 'info',
  CHECKED_IN: 'warning',
  IN_CONSULTATION: 'default',
  COMPLETED: 'success',
  CANCELLED: 'outline',
  NO_SHOW: 'destructive',
};

export function AppointmentStatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge variant={VARIANT[status] ?? 'secondary'} className={className}>
      {enumLabel(status)}
    </Badge>
  );
}

export function PriorityDot({ priority, withLabel, className }: { priority?: string | null; withLabel?: boolean; className?: string }) {
  if (!priority) return null;
  const colour = TRIAGE_COLOURS[priority as TriagePriority] ?? '#64748b';
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-medium', className)} title={`Triage: ${enumLabel(priority)}`}>
      <span className="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white dark:ring-card" style={{ backgroundColor: colour }} aria-hidden />
      {withLabel ? enumLabel(priority) : <span className="sr-only">Triage {enumLabel(priority)}</span>}
    </span>
  );
}
