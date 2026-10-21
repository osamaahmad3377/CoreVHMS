import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Card } from './ui/card';

export function Stat({
  label,
  value,
  hint,
  href,
  icon: Icon,
  tone = 'default',
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  href?: string;
  icon?: React.ComponentType<{ className?: string }>;
  tone?: 'default' | 'warning' | 'danger' | 'success';
}) {
  const tones = {
    default: { chip: 'bg-primary/10 text-primary ring-primary/20', glow: 'from-primary/12' },
    warning: { chip: 'bg-warning/15 text-warning ring-warning/25', glow: 'from-warning/15' },
    danger: { chip: 'bg-destructive/10 text-destructive ring-destructive/20', glow: 'from-destructive/12' },
    success: { chip: 'bg-success/12 text-success ring-success/20', glow: 'from-success/12' },
  }[tone];
  const body = (
    <Card className={cn('group relative flex h-full items-start gap-3 overflow-hidden p-4 sm:gap-3.5 sm:p-5 transition-all duration-200', href && 'hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-card-hover')}>
      {/* A soft wash of the tile's colour in the corner. */}
      <span aria-hidden className={cn('pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-gradient-to-br to-transparent opacity-80 blur-xl transition-opacity group-hover:opacity-100', tones.glow)} />
      {Icon && (
        <span className={cn('relative hidden rounded-xl p-2.5 ring-1 min-[480px]:block ring-inset', tones.chip)}>
          <Icon className="h-[18px] w-[18px]" />
        </span>
      )}
      <div className="relative min-w-0">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="mt-1 text-[1.35rem] font-semibold sm:text-[1.65rem] leading-none tabular tracking-tight">{value}</p>
        {hint && <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
    </Card>
  );
  return href ? (
    <Link href={href} className="block rounded-xl focus-visible:ring-2 focus-visible:ring-ring">
      {body}
    </Link>
  ) : (
    body
  );
}
