'use client';
import { fillNormalAnswers, phraseText, togglePhrase, type NotePhraseField } from '@vcms/shared';
import { Check, ChevronDown, Wand2 } from 'lucide-react';
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
        'inline-flex min-h-8 items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]',
        on ? 'border-primary bg-primary text-primary-foreground shadow-sm' : 'border-border bg-card text-foreground hover:border-primary/50 hover:bg-primary/5',
      )}
    >
      {on && <Check className="h-3 w-3" aria-hidden />}
      {phrase.label}
    </button>
  );
}

/**
 * Tap-to-add buttons under a note field. A tap adds the phrase to the text and a second tap takes it out again;
 * the answers of one question (a group, e.g. "Eating") replace each other. "Fill in the normal answers" adds the
 * usual answer to every question not yet answered. The text stays fully editable.
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
  const hasNormals = mine.some((p) => p.isDefault);
  const normalsMissing = hasNormals && fillNormalAnswers(value, mine) !== value;

  return (
    <div className="grid gap-2 rounded-lg border border-border/70 bg-muted/30 p-2.5" role="group" aria-label="Quick picks">
      {hasNormals && (
        <button
          type="button"
          disabled={!normalsMissing}
          onClick={() => onChange(fillNormalAnswers(value, mine))}
          className="inline-flex w-fit items-center gap-1.5 rounded-md border border-success/40 bg-success/10 px-2.5 py-1 text-xs font-semibold text-success transition-colors hover:bg-success/15 disabled:cursor-default disabled:opacity-50"
        >
          <Wand2 className="h-3.5 w-3.5" /> {normalsMissing ? 'Fill in the normal answers' : 'Normal answers filled in'}
        </button>
      )}
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
