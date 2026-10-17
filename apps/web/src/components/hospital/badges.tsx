import { enumLabel } from '@vcms/shared';
import { HeartOff, ShieldAlert } from 'lucide-react';
import { Badge, type BadgeProps } from '../ui/badge';

const CONDITION: Record<string, BadgeProps['variant']> = { STABLE: 'success', FAIR: 'info', GUARDED: 'warning', CRITICAL: 'destructive' };

export function ConditionBadge({ condition }: { condition: string }) {
  return <Badge variant={CONDITION[condition] ?? 'secondary'}>{enumLabel(condition)}</Badge>;
}

/** Resuscitation status must be visible at a glance; only shown when a decision has been recorded. */
export function CprBadge({ status }: { status: string }) {
  if (status === 'DNR') return <Badge variant="destructive" className="gap-1"><HeartOff className="h-3 w-3" /> DNR</Badge>;
  if (status === 'CPR') return <Badge variant="outline">CPR</Badge>;
  return null;
}

export function IsolationBadge() {
  return <Badge variant="warning" className="gap-1"><ShieldAlert className="h-3 w-3" /> Isolation</Badge>;
}

const SURGERY: Record<string, BadgeProps['variant']> = { SCHEDULED: 'secondary', PRE_OP: 'info', IN_PROGRESS: 'warning', RECOVERY: 'default', COMPLETED: 'success', CANCELLED: 'secondary' };
export function SurgeryStatusBadge({ status }: { status: string }) {
  return <Badge variant={SURGERY[status] ?? 'secondary'}>{enumLabel(status, 'surgery')}</Badge>;
}
