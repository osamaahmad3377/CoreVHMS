'use client';
import { ArrowRight, Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * One step of the consultation note: a header that shows what has been written (or that nothing has), and a body
 * that opens when needed. The body stays in the page when closed so nothing typed is ever lost.
 */
export function NoteSection({
  index,
  title,
  hint,
  summary,
  filled,
  open,
  onToggle,
  onNext,
  nextLabel,
  children,
}: {
  index: number;
  title: string;
  hint: string;
  summary: string | null;
  filled: boolean;
  open: boolean;
  onToggle: () => void;
  onNext?: () => void;
  nextLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn('overflow-hidden rounded-xl surface-flat transition-shadow', open ? 'border-primary/40 shadow-card' : 'hover:border-primary/30')}>
      <h3>
        <button type="button" aria-expanded={open} onClick={onToggle} className="flex w-full items-center gap-3 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
          <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-semibold', filled ? 'bg-success text-white' : open ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
            {filled ? <Check className="h-4 w-4" aria-hidden /> : index}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">{title}</span>
            <span className={cn('block truncate text-xs', summary ? 'text-foreground/70' : 'text-muted-foreground')}>{open ? hint : (summary ?? 'Not written yet')}</span>
          </span>
          <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} aria-hidden />
        </button>
      </h3>
      <div hidden={!open} className="grid gap-4 border-t px-4 pb-4 pt-4">
        {children}
        {onNext && (
          <button type="button" onClick={onNext} className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/15">
            Next: {nextLabel} <ArrowRight className="h-4 w-4" />
          </button>
        )}
      </div>
    </section>
  );
}
