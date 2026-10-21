import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { ApiError } from '@/lib/api';
import { HelpLink } from './help/help-link';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import { Skeleton } from './ui/misc';

export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
  help,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** Help centre guide id; shows a "How to" link. */
  help?: string;
  breadcrumbs?: { label: string; href?: string }[];
  className?: string;
}) {
  return (
    <div className={cn('mb-8 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between', className)}>
      <div className="min-w-0 lg:max-w-[50%] lg:shrink-0">
        {breadcrumbs && (
          <nav aria-label="Breadcrumb" className="mb-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            {breadcrumbs.map((b, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <span aria-hidden>/</span>}
                {b.href ? (
                  <Link href={b.href} className="hover:text-foreground hover:underline">
                    {b.label}
                  </Link>
                ) : (
                  <span>{b.label}</span>
                )}
              </span>
            ))}
          </nav>
        )}
        <h1 className="truncate text-[1.75rem] font-bold leading-tight tracking-[-0.03em] sm:text-[2.125rem]">{title}</h1>
        {description && <p className="mt-1.5 text-[0.9375rem] text-muted-foreground">{description}</p>}
      </div>
      {(actions || help) && (
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          {help && <HelpLink topic={help} />}
          {actions}
        </div>
      )}
    </div>
  );
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 px-6 py-12 text-center', className)}>
      <div className="relative mb-3">
        <span aria-hidden className="absolute inset-0 -z-10 scale-150 rounded-full bg-gradient-to-br from-primary/25 to-brand-2/25 blur-2xl" />
        <div className="surface-flat flex h-16 w-16 items-center justify-center rounded-2xl shadow-card">
          <Icon className="h-7 w-7 text-primary" />
        </div>
      </div>
      <p className="text-base font-semibold tracking-tight">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const e = error as ApiError | Error | undefined;
  const forbidden = e instanceof ApiError && e.status === 403;
  const notFound = e instanceof ApiError && e.status === 404;
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 px-6 py-12 text-center', className)} role="alert">
      <div className="mb-1 rounded-full bg-destructive/10 p-3">
        <AlertTriangle className="h-5 w-5 text-destructive" />
      </div>
      <p className="text-base font-semibold">{forbidden ? 'Access denied' : notFound ? 'Not found' : 'Something went wrong'}</p>
      <p className="max-w-md text-sm text-muted-foreground">
        {forbidden ? 'Your role does not include permission to view this.' : e?.message ?? 'Something went wrong. Please try again.'}
      </p>
      {e instanceof ApiError && e.requestId && <p className="font-mono text-2xs text-muted-foreground">Reference: {e.requestId}</p>}
      {onRetry && !forbidden && !notFound && (
        <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
          <RefreshCw /> Try again
        </Button>
      )}
    </div>
  );
}

export function LoadingRows({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('grid gap-4 p-6', className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
          <div className="grid flex-1 gap-2">
            <Skeleton className="h-3.5 rounded-pill" style={{ width: `${70 - ((i * 13) % 30)}%` }} />
            <Skeleton className="h-3 rounded-pill" style={{ width: `${45 - ((i * 7) % 20)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function DescriptionList({ items, className }: { items: { label: string; value: React.ReactNode }[]; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2', className)}>
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{it.label}</dt>
          <dd className="mt-0.5 break-words text-sm">{it.value || <span className="text-muted-foreground">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}
