import { enumLabel } from '@vcms/shared';
import { cn } from '@/lib/utils';

export function ResultFlag({ flag }: { flag: string | null }) {
  if (!flag || flag === 'NORMAL') return null;
  const critical = flag.startsWith('CRITICAL');
  return (
    <span className={cn('rounded px-1 text-2xs font-bold uppercase', critical ? 'bg-destructive text-destructive-foreground' : 'bg-warning/15 text-warning')}>
      {critical ? (flag === 'CRITICAL_LOW' ? 'LL' : 'HH') : flag === 'LOW' ? 'L' : flag === 'HIGH' ? 'H' : enumLabel(flag)}
      <span className="sr-only"> {enumLabel(flag)}</span>
    </span>
  );
}

/** Client-side preview flag (the server computes the authoritative flag on save). */
export function previewFlag(v: number, i?: { low: number | null; high: number | null; criticalLow: number | null; criticalHigh: number | null }) {
  if (!i) return null;
  if (i.criticalLow != null && v <= i.criticalLow) return 'CRITICAL_LOW';
  if (i.criticalHigh != null && v >= i.criticalHigh) return 'CRITICAL_HIGH';
  if (i.low != null && v < i.low) return 'LOW';
  if (i.high != null && v > i.high) return 'HIGH';
  return 'NORMAL';
}
