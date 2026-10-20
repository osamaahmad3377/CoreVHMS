import * as React from 'react';
import { cn, initials } from '@/lib/utils';

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('shimmer rounded-lg bg-muted', className)} {...props} />;
}

export function Separator({ className, vertical }: { className?: string; vertical?: boolean }) {
  return <div role="separator" className={cn(vertical ? 'h-full w-px' : 'h-px w-full', 'bg-border', className)} />;
}

export function Avatar({ name, src, className }: { name?: string | null; src?: string | null; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-primary/25 to-info/20 text-xs font-semibold text-accent-foreground ring-1 ring-inset ring-primary/20',
        className,
      )}
      aria-hidden
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : initials(name)}
    </span>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded-md border border-border/70 bg-card px-1.5 py-0.5 font-mono text-2xs text-muted-foreground shadow-[0_1px_0_hsl(var(--shadow)/0.08)]">{children}</kbd>;
}
