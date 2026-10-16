import { enumLabel } from '@vcms/shared';
import { Badge, type BadgeProps } from '../ui/badge';

const VARIANT: Record<string, BadgeProps['variant']> = { DRAFT: 'warning', AUTHORIZED: 'info', PARTIALLY_DISPENSED: 'default', DISPENSED: 'success', CANCELLED: 'outline' };

export function RxStatusBadge({ status }: { status: string }) {
  return <Badge variant={VARIANT[status] ?? 'secondary'}>{enumLabel(status)}</Badge>;
}
