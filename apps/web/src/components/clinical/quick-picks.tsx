'use client';
import { phraseText, togglePhrase, type NotePhraseField } from '@vcms/shared';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import type { NotePhraseRow } from '@/lib/types';
import { cn } from '@/lib/utils';

const INITIAL = 12;

function Chip({ phrase, on, onClick }: { phrase: NotePhraseRow; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={phraseText(phrase)}
      onClick={onClick}
      className={cn(
        'inline-flex min-h-8 items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        on ? 'border-primary bg-primary text-primary-foreground shadow-sm' : 'border-border bg-card text-foreground hover:border-primary/50 hover:bg-primary/5',
      )}
    >
      {phrase.label}
    </button>
  );
}

/**
 * Tap-to-add buttons under a note field. A tap adds the phrase to the text and a second tap takes it out again;
 * the answers of one question (a group, e.g. "Eating") replace each other. The text stays fully editable.
 */
export function QuickPicks({ field, value, onChange, phrases }: { field: NotePhraseField; value: string; onChange: (next: string) => void; phrases: NotePhraseRow[] }) {
  const [showAll, setShowAll] = useState(false);
  const mine = phrases.filter((p) => p.field === field);
  if (!mine.length) return null;
  const groups = [...new Set(mine.filter((p) => p.groupName).map((p) => p.groupName as string))];
  const loose = mine.filter((p) => !p.groupName);
  const shownLoose = showAll ? loose : loose.slice(0, INITIAL);
  const on = (p: NotePhraseRow) => value.includes(phraseText(p));
  const tap = (p: NotePhraseRow) => onChange(togglePhrase(value, p, p.groupName ? mine.filter((x) => x.groupName === p.groupName) : []));

  return (
    <div className="grid gap-1.5" role="group" aria-label="Quick picks">
      {groups.map((g) => (
        <div key={g} className="flex flex-wrap items-center gap-1.5">
          <span className="w-20 shrink-0 text-xs font-medium text-muted-foreground">{g}</span>
          {mine.filter((p) => p.groupName === g).map((p) => <Chip key={p.id} phrase={p} on={on(p)} onClick={() => tap(p)} />)}
        </div>
      ))}
      {loose.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {groups.length > 0 && <span className="w-20 shrink-0 text-xs font-medium text-muted-foreground">Also</span>}
          {shownLoose.map((p) => <Chip key={p.id} phrase={p} on={on(p)} onClick={() => tap(p)} />)}
          {loose.length > INITIAL && (
            <button type="button" onClick={() => setShowAll((s) => !s)} className="inline-flex min-h-8 items-center gap-1 rounded-full px-2 text-xs font-medium text-primary hover:underline">
              {showAll ? 'Show fewer' : `More (${loose.length - INITIAL})`} <ChevronDown className={cn('h-3 w-3 transition-transform', showAll && 'rotate-180')} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
