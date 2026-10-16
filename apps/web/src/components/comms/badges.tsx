import { enumLabel } from '@vcms/shared';
import { Badge, type BadgeProps } from '../ui/badge';

const V: Record<string, BadgeProps['variant']> = { QUEUED: 'info', SENDING: 'info', SENT: 'success', FAILED: 'destructive', CANCELLED: 'secondary', SKIPPED: 'warning' };
export function MessageStatusBadge({ status }: { status: string }) {
  return <Badge variant={V[status] ?? 'secondary'}>{enumLabel(status)}</Badge>;
}
