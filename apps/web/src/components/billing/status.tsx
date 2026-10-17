import { enumLabel } from '@vcms/shared';
import { STATUS_LABEL } from '@/lib/labels';
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

/** Status badge for invoices, charges, payments and estimates. `labels` overrides the wording (e.g. estimate statuses). */
export function CommerceBadge({ status, overdue, labels }: { status: string; overdue?: boolean; labels?: Record<string, string> }) {
  if (overdue) return <Badge variant="destructive">Overdue</Badge>;
  return <Badge variant={VARIANTS[status] ?? 'secondary'}>{labels?.[status] ?? (status === 'PENDING' ? 'Not yet invoiced' : STATUS_LABEL[status] ?? enumLabel(status))}</Badge>;
}
