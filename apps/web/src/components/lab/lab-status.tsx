import { enumLabel } from '@vcms/shared';
import { Badge, type BadgeProps } from '../ui/badge';

const V: Record<string, BadgeProps['variant']> = { ORDERED: 'secondary', COLLECTED: 'info', IN_PROGRESS: 'info', AWAITING_VALIDATION: 'warning', RELEASED: 'success', CANCELLED: 'outline' };
export function LabStatusBadge({ status }: { status: string }) {
  return <Badge variant={V[status] ?? 'secondary'}>{enumLabel(status, 'lab')}</Badge>;
}

/** Sample type for use inside a sentence: lower-case first letter only, so "Whole blood (EDTA)" → "whole blood (EDTA)". */
export function sampleInSentence(type: string) {
  const label = enumLabel(type, 'sample');
  return label.charAt(0).toLowerCase() + label.slice(1);
}
