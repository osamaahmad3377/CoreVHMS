import { allergyMatches, enumLabel } from '@vcms/shared';
import { Badge, type BadgeProps } from '../ui/badge';
import type { Prescription } from '@/lib/types';

const VARIANT: Record<string, BadgeProps['variant']> = { DRAFT: 'warning', AUTHORIZED: 'info', PARTIALLY_DISPENSED: 'default', DISPENSED: 'success', CANCELLED: 'outline' };
/** Words the pharmacy uses: an authorised prescription is waiting to be handed over. */
const LABEL: Record<string, string> = { AUTHORIZED: 'Ready to hand over' };

/** Every medicine on the prescription is bought outside the clinic, so the pharmacy has nothing to hand out. */
export const outsideOnly = (rx: Pick<Prescription, 'items'>) => rx.items.length > 0 && rx.items.every((i) => i.outside);

export function RxStatusBadge({ status, outsideOnly }: { status: string; /** Only medicines bought outside: shown as "To buy outside" once authorised. */ outsideOnly?: boolean }) {
  if (outsideOnly && status === 'DISPENSED') return <Badge variant="info">To buy outside</Badge>;
  return <Badge variant={VARIANT[status] ?? 'secondary'}>{LABEL[status] ?? enumLabel(status)}</Badge>;
}

/** Items on a prescription whose medicine matches one of the patient's allergy alerts. */
export function allergyItems(rx: Pick<Prescription, 'items' | 'patient'>) {
  return rx.items.filter((i) => allergyMatches(rx.patient.alerts, i.product ?? { name: i.name }).length > 0);
}

/** Red chip for the pharmacy: the medicine may conflict with an allergy, so the vet should confirm. */
export function AllergyConflictChip({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded bg-destructive px-1.5 py-0.5 text-2xs font-semibold text-destructive-foreground ${className ?? ''}`}>
      ⚠ May conflict with allergy — ask the vet
    </span>
  );
}
