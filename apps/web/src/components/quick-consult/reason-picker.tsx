'use client';
import { Check, Search, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Input } from '../ui/input';
import { type CareKind, type VisitCategory, type VisitReason } from './visit-reasons';
import { cn } from '@/lib/utils';

interface Props {
  categories: VisitCategory[];
  reasons: VisitReason[];
  /** Appointment types chosen for this visit. */
  chosenIds: string[];
  /** Vaccination / deworming / grooming chosen for this visit. */
  care: CareKind[];
  openCategoryId?: string;
  onTapCategory: (id: string) => void;
  onToggleCare: (k: CareKind) => void;
  onPickReason: (r: VisitReason) => void;
  /** Where a manager edits the appointment types (none for other staff). */
  editHref?: string;
}

const questionsLabel = (n: number) => (n ? `${n} question${n === 1 ? '' : 's'}` : 'No questions');

/**
 * Step 1 of the consultation: the visit category, then its appointment type (several may apply). A search finds an
 * appointment type in any category. Vaccination, deworming and grooming are chosen by their category alone.
 */
export function ReasonPicker({ categories, reasons, chosenIds, care, openCategoryId, onTapCategory, onToggleCare, onPickReason, editHref }: Props) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const clinical = categories.filter((c) => !c.care);
  const preventive = categories.filter((c) => c.care);
  const open = clinical.find((c) => c.id === openCategoryId);
  const catName = (id: string) => categories.find((c) => c.id === id)?.name ?? '';

  // Searching looks across every category; otherwise the open category's appointment types.
  const shown = q ? reasons.filter((r) => r.name.toLowerCase().includes(q) || catName(r.categoryId).toLowerCase().includes(q)) : open ? reasons.filter((r) => r.categoryId === open.id) : [];
  const careHits = q ? preventive.filter((c) => c.name.toLowerCase().includes(q)) : [];

  const chip = (selected: boolean) =>
    cn(
      'inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-foreground/80 hover:border-primary/40 hover:text-foreground',
    );

  return (
    <div className="grid gap-5">
      <section className="grid gap-2" aria-labelledby="qc-cat-h">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="qc-cat-h" className="text-sm font-medium text-muted-foreground">
            Category
          </h2>
          {editHref && (
            <Link href={editHref} className="text-xs text-muted-foreground hover:text-primary hover:underline">
              Edit appointment types
            </Link>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Category">
          {clinical.map((c) => {
            const count = reasons.filter((r) => r.categoryId === c.id && chosenIds.includes(r.id)).length;
            const isOpen = c.id === open?.id;
            return (
              <button
                key={c.id}
                type="button"
                title={isOpen ? 'Tap again to deselect' : undefined}
                aria-pressed={isOpen || count > 0}
                aria-expanded={isOpen}
                onClick={() => onTapCategory(c.id)}
                className={cn(chip(isOpen), !isOpen && count > 0 && 'border-primary text-primary')}
              >
                {c.name}
                {count > 0 && <span className={cn('grid h-5 min-w-5 place-items-center rounded-full px-1 text-[11px] font-semibold', isOpen ? 'bg-primary-foreground text-primary' : 'bg-primary text-primary-foreground')}>{count}</span>}
              </button>
            );
          })}
          {preventive.length > 0 && <span className="mx-1 h-5 w-px bg-border" aria-hidden />}
          {preventive.map((c) => {
            const on = care.includes(c.care!);
            return (
              <button key={c.id} type="button" aria-pressed={on} onClick={() => onToggleCare(c.care!)} className={chip(on)}>
                {on && <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />}
                {c.name}
              </button>
            );
          })}
        </div>
      </section>

      <section className="grid gap-2" aria-labelledby="qc-type-h">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <h2 id="qc-type-h" className="text-sm font-medium text-muted-foreground">
            Appointment type
            {!q && open && <span> · {open.name}</span>}
            {q && <span> · results for “{query.trim()}”</span>}
          </h2>
          <div className="relative w-full sm:w-60">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              type="search"
              aria-label="Search appointment types"
              placeholder="Search…"
              className="h-9 rounded-full pl-9 pr-9 text-sm [&::-webkit-search-cancel-button]:hidden"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setQuery('');
                if (e.key === 'Enter' && shown.length + careHits.length === 1) {
                  e.preventDefault();
                  if (shown[0]) onPickReason(shown[0]);
                  else onToggleCare(careHits[0].care!);
                }
              }}
            />
            {query && (
              <button type="button" aria-label="Clear search" onClick={() => setQuery('')} className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {!q && !open ? (
          <p className="rounded-lg bg-muted/40 px-4 py-3 text-sm text-muted-foreground">Choose a category above, or search for an appointment type.</p>
        ) : shown.length + careHits.length === 0 ? (
          <p className="rounded-lg bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            {q ? `No appointment type matches “${query.trim()}”.` : `${open?.name} has no appointment types for this animal.`}
          </p>
        ) : (
          <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3" role="group" aria-label="Appointment types">
            {careHits.map((c) => {
              const on = care.includes(c.care!);
              return (
                <TypeRow key={c.id} name={c.name} sub="Preventive" hint="Preventive care" selected={on} onClick={() => onToggleCare(c.care!)} />
              );
            })}
            {shown.map((r) => (
              <TypeRow
                key={r.id}
                name={r.name} sub={q ? catName(r.categoryId) : ''} hint={questionsLabel(r.questions.length)} selected={chosenIds.includes(r.id)} onClick={() => onPickReason(r)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function TypeRow({ name, sub, hint, selected, onClick }: { name: string; sub: string; hint: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={name}
      title={hint}
      onClick={onClick}
      className={cn(
        'flex min-h-10 w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected ? 'border-primary bg-primary/[0.07] font-medium text-primary' : 'border-border/80 bg-background hover:border-primary/40',
      )}
    >
      <span className="min-w-0 flex-1 leading-tight">{name}</span>
      {sub && <span className="shrink-0 text-[11px] text-muted-foreground">{sub}</span>}
      {selected && <Check className="h-4 w-4 shrink-0" strokeWidth={2.5} aria-hidden />}
    </button>
  );
}
