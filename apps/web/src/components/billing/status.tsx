import { enumLabel } from '@vcms/shared';
import { Badge, type BadgeProps } from '../ui/badge';

const VARIANTS: Record<string, BadgeProps['variant']> = {
  DRAFT: 'secondary',
  ISSUED: 'info',
  PARTIALLY_PAID: 'warning',
  PAID: 'success',
  VOID: 'destructive',
  PENDING: 'warning',
  INVOICED: 'success',
  WAIVED: 'secondary',
  SENT: 'info',
  ACCEPTED: 'success',
  DECLINED: 'destructive',
  CONVERTED: 'success',
  OPEN: 'info',
  CLOSED: 'secondary',
  SUBMITTED: 'info',
  APPROVED: 'default',
  PARTIALLY_RECEIVED: 'warning',
  RECEIVED: 'success',
  CANCELLED: 'secondary',
  COMPLETED: 'success',
  AVAILABLE: 'success',
  QUARANTINED: 'warning',
  RECALLED: 'destructive',
  ORDERED: 'success',
  REJECTED: 'destructive',
};

export function CommerceBadge({ status, overdue }: { status: string; overdue?: boolean }) {
  if (overdue) return <Badge variant="destructive">Overdue</Badge>;
  return <Badge variant={VARIANTS[status] ?? 'secondary'}>{enumLabel(status)}</Badge>;
}
