'use client';
import { ArrowRight, CheckCircle2, Lightbulb } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '../ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { useSuggestions } from '@/hooks/use-suggestions';
import { cn } from '@/lib/utils';

const DOT = { danger: 'bg-destructive', warning: 'bg-warning', info: 'bg-primary' } as const;

/**
 * "What's next?" in the top bar: a short, plain list of what the system suggests doing now, with one click to
 * each. A count shows when there is something to do, so nobody has to go looking for work.
 */
export function SuggestionsMenu({ onOpenFinder }: { onOpenFinder: () => void }) {
  const { items, ready } = useSuggestions();
  const [open, setOpen] = useState(false);
  const urgent = items.some((i) => i.severity === 'danger');
  const shown = items.slice(0, 6);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="relative gap-1.5" aria-label={items.length ? `What’s next? ${items.length} suggestions` : 'What’s next?'} title="What should I do next?">
          <Lightbulb className={cn(urgent && 'text-destructive')} />
          <span className="hidden md:inline">What’s next?</span>
          {items.length > 0 && (
            <span className={cn('grid h-5 min-w-5 place-items-center rounded-full px-1 text-2xs font-semibold text-white', urgent ? 'bg-destructive' : 'bg-primary')}>{items.length > 9 ? '9+' : items.length}</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-1.5rem))] p-0">
        <div className="border-b px-4 py-3">
          <p className="text-sm font-semibold">Suggested for you now</p>
          <p className="text-xs text-muted-foreground">The most important jobs first. Click one to go straight there.</p>
        </div>
        {!ready ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">Checking what needs doing…</p>
        ) : shown.length ? (
          <ul className="max-h-[60vh] divide-y overflow-y-auto">
            {shown.map((i) => (
              <li key={i.key}>
                <Link href={i.href} onClick={() => setOpen(false)} className="group flex items-start gap-3 px-4 py-2.5 hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none">
                  <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', DOT[i.severity])} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{i.text}</span>
                    {i.detail && <span className="block text-xs text-muted-foreground">{i.detail}</span>}
                  </span>
                  <span className="flex shrink-0 items-center gap-1 pt-0.5 text-xs font-medium text-primary">
                    {i.action} <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex items-center gap-3 px-4 py-6">
            <CheckCircle2 className="h-6 w-6 shrink-0 text-success" />
            <div>
              <p className="text-sm font-medium">You’re all caught up</p>
              <p className="text-xs text-muted-foreground">Nothing needs doing right now. New work shows up here as it comes in.</p>
            </div>
          </div>
        )}
        <div className="flex items-center justify-between gap-2 border-t bg-muted/30 px-4 py-2.5 text-xs">
          {items.length > shown.length ? (
            <Link href="/dashboard" onClick={() => setOpen(false)} className="font-medium text-primary hover:underline">See all {items.length}</Link>
          ) : (
            <span className="text-muted-foreground">Want to do something else?</span>
          )}
          <button
            type="button"
            className="font-medium text-primary hover:underline"
            onClick={() => {
              setOpen(false);
              onOpenFinder();
            }}
          >
            Tell me what you want to do
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
