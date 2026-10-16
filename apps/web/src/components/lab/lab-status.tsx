import { enumLabel } from '@vcms/shared';
import { Badge, type BadgeProps } from '../ui/badge';

const V: Record<string, BadgeProps['variant']> = { ORDERED: 'secondary', COLLECTED: 'info', IN_PROGRESS: 'info', AWAITING_VALIDATION: 'warning', RELEASED: 'success', CANCELLED: 'outline' };
export function LabStatusBadge({ status }: { status: string }) {
  return <Badge variant={V[status] ?? 'secondary'}>{enumLabel(status)}</Badge>;
}
