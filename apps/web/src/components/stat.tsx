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
  const body = (
    <Card className={cn('flex h-full items-start gap-3 p-4 transition-colors', href && 'hover:border-primary/40 hover:bg-accent/30')}>
      {Icon && (
        <span
          className={cn(
            'rounded-md p-2',
            tone === 'default' && 'bg-primary/10 text-primary',
            tone === 'warning' && 'bg-warning/15 text-warning',
            tone === 'danger' && 'bg-destructive/10 text-destructive',
            tone === 'success' && 'bg-success/12 text-success',
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
      )}
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="mt-0.5 text-2xl font-semibold tabular tracking-tight">{value}</p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
    </Card>
  );
  return href ? (
    <Link href={href} className="block rounded-lg focus-visible:ring-2 focus-visible:ring-ring">
      {body}
    </Link>
  ) : (
    body
  );
}
