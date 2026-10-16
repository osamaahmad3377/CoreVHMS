import { AlertOctagon, AlertTriangle, Info } from 'lucide-react';
import { enumLabel } from '@vcms/shared';
import { Badge, type BadgeProps } from './ui/badge';
import { cn } from '@/lib/utils';

const STATUS_VARIANTS: Record<string, BadgeProps['variant']> = {
  ACTIVE: 'success',
  INVITED: 'info',
  SUSPENDED: 'destructive',
  ARCHIVED: 'secondary',
  MERGED: 'secondary',
  DECEASED: 'secondary',
  TRANSFERRED: 'secondary',
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge variant={STATUS_VARIANTS[status] ?? 'secondary'} className={className}>
      {enumLabel(status)}
    </Badge>
  );
}

export interface AlertLike {
  id: string;
  severity: string;
  title: string;
  type?: string;
}

/** Medical alert chip, colour-coded by severity. Always visible in patient context. */
export function AlertChip({ alert, className }: { alert: AlertLike; className?: string }) {
  const Icon = alert.severity === 'CRITICAL' ? AlertOctagon : alert.severity === 'WARNING' ? AlertTriangle : Info;
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium',
        alert.severity === 'CRITICAL' && 'bg-destructive/12 text-destructive ring-1 ring-destructive/30 dark:bg-destructive/25',
        alert.severity === 'WARNING' && 'bg-warning/15 text-warning ring-1 ring-warning/30',
        alert.severity === 'INFO' && 'bg-info/10 text-info ring-1 ring-info/25',
        className,
      )}
      title={`${enumLabel(alert.type)}: ${alert.title}`}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      <span className="truncate">{alert.title}</span>
    </span>
  );
}
