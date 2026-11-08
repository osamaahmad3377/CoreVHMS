'use client';
import { EXAM_SYSTEMS } from '@vcms/shared';
import { AlertTriangle, Check, CheckCheck, Minus, RotateCcw } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Button } from '../ui/button';
import { Input, NativeSelect } from '../ui/input';
import type { ExamFinding } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Same body systems the classic examination starts with. */
const DEFAULT_SYSTEMS = ['General appearance', 'Eyes', 'Ears', 'Oral cavity & teeth', 'Lymph nodes', 'Cardiovascular', 'Respiratory', 'Abdomen', 'Musculoskeletal', 'Neurological', 'Skin & coat'];

/** Describing words to tap for an abnormal system (the same words as the classic examination). */
const ABNORMAL_PICKS: Record<string, string[]> = {
  default: ['Mild', 'Moderate', 'Severe', 'Painful', 'Swollen', 'Red / inflamed', 'Discharge'],
  'General appearance': ['Dull', 'Depressed', 'Thin', 'Overweight', 'Dehydrated', 'Weak'],
  Eyes: ['Discharge', 'Red', 'Cloudy', 'Squinting', 'Ulcer', 'Swollen eyelid'],
  Ears: ['Red', 'Brown discharge', 'Smelly', 'Painful', 'Head shaking', 'Swollen'],
  'Oral cavity & teeth': ['Tartar', 'Gingivitis', 'Broken tooth', 'Loose tooth', 'Pale gums', 'Ulcers', 'Bad breath', 'Oral mass'],
  'Lymph nodes': ['Enlarged', 'Painful', 'Firm'],
  Cardiovascular: ['Murmur', 'Fast rate', 'Slow rate', 'Irregular rhythm', 'Weak pulse'],
  Respiratory: ['Fast breathing', 'Laboured', 'Wheeze', 'Crackles', 'Cough'],
  Abdomen: ['Painful', 'Tense', 'Distended', 'Mass felt', 'Fluid'],
  Musculoskeletal: ['Limping', 'Painful joint', 'Swollen joint', 'Reduced movement', 'Muscle loss'],
  Neurological: ['Weak', 'Wobbly', 'Head tilt', 'Seizure history', 'Reduced reflexes'],
  'Skin & coat': ['Itchy', 'Red', 'Hair loss', 'Scabs', 'Fleas seen', 'Lump', 'Wound'],
  // Dental visits
  Gums: ['Red', 'Swollen', 'Bleeds when touched', 'Receding', 'Overgrown', 'Ulcers', 'Pale'],
  Breath: ['Mild odour', 'Strong odour'],
  'Face & jaw': ['Facial swelling', 'Pain on opening the mouth', 'Draining tract', 'Jaw asymmetry', 'Cannot close the mouth'],
  'Mandibular lymph nodes': ['Enlarged', 'Painful', 'Firm'],
};

type Status = ExamFinding['status'];

const toggleWord = (notes: string, word: string) => {
  const parts = notes.split(', ').map((x) => x.trim()).filter(Boolean);
  return (parts.includes(word) ? parts.filter((x) => x !== word) : [...parts, word]).join(', ');
};

/**
 * The physical examination as a checklist of body systems, each set to Normal, Abnormal or Not examined.
 * "All normal" does a normal visit in one tap; each abnormal system gets a card to describe it with tap-words.
 */
export function ExamChips({ findings, onChange, systems, focus = [] }: { findings: ExamFinding[]; onChange: (next: ExamFinding[]) => void; systems?: string[]; focus?: string[] }) {
  const lastFlagged = useRef<string | null>(null);
  // The systems that matter for this visit's reason come first.
  const base = systems?.length ? systems : DEFAULT_SYSTEMS;
  const start = [...focus, ...base.filter((s) => !focus.includes(s))];
  // Until the vet sets something, every system shows as not examined yet.
  const list: ExamFinding[] = findings.length ? findings : start.map((system) => ({ system, status: 'NOT_EXAMINED', notes: '' }));

  // Put the cursor in the description of the system just flagged, so the vet can type or tap straight away.
  useEffect(() => {
    if (!lastFlagged.current) return;
    document.getElementById(`exam-note-${lastFlagged.current}`)?.focus({ preventScroll: false });
    lastFlagged.current = null;
  }, [findings]);

  const setAt = (i: number, patch: Partial<ExamFinding>) => onChange(list.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const setStatus = (i: number, status: Status) => {
    if (list[i].status === status) return;
    if (status === 'ABNORMAL') lastFlagged.current = list[i].system;
    setAt(i, { status, notes: status === 'ABNORMAL' ? list[i].notes ?? '' : '' });
  };
  const counts = { normal: list.filter((f) => f.status === 'NORMAL').length, abnormal: list.filter((f) => f.status === 'ABNORMAL').length, not: list.filter((f) => f.status === 'NOT_EXAMINED').length };
  const started = counts.normal + counts.abnormal > 0;

  return (
    <div className="grid gap-4">
      {/* Summary and quick actions */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium" aria-live="polite">
          <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2.5 py-1 text-success"><Check className="h-3 w-3" strokeWidth={3} />{counts.normal} normal</span>
          <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-1', counts.abnormal ? 'bg-warning/15 text-warning' : 'bg-muted text-muted-foreground')}><AlertTriangle className="h-3 w-3" />{counts.abnormal} abnormal</span>
          {counts.not > 0 && <span className="rounded-full bg-muted px-2.5 py-1 text-muted-foreground">{counts.not} not examined</span>}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {counts.not > 0 && (
            <Button type="button" size="sm" id="qc-exam-start" variant={started ? 'outline' : 'default'} onClick={() => onChange(list.map((f) => (f.status === 'NOT_EXAMINED' ? { ...f, status: 'NORMAL', notes: '' } : f)))}>
              <CheckCheck /> {started ? 'Mark the rest normal' : 'All normal'}
            </Button>
          )}
          <NativeSelect
            aria-label="Add a body system"
            className="h-9 w-40 text-sm"
            value=""
            onChange={(e) => e.target.value && onChange([...list, { system: e.target.value, status: 'NORMAL', notes: '' }])}
          >
            <option value="">Add system…</option>
            {EXAM_SYSTEMS.filter((s) => !list.some((f) => f.system === s)).map((s) => (
              <option key={s}>{s}</option>
            ))}
          </NativeSelect>
          {findings.length > 0 && (
            <Button type="button" size="icon-sm" variant="ghost" aria-label="Start the examination again" title="Start again" onClick={() => onChange([])}>
              <RotateCcw className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* The checklist: an abnormal system opens a small description right under its name. */}
      <ul className="grid items-start gap-2 sm:grid-cols-2" aria-label="Body systems">
        {list.map((f, i) => (
          <li
            key={f.system}
            className={cn(
              'grid min-w-0 gap-2 rounded-xl border py-1.5 pl-3.5 pr-1.5 transition-colors',
              f.status === 'NORMAL' && 'border-success/30 bg-success/[0.06]',
              f.status === 'ABNORMAL' && 'border-warning/60 bg-warning/10 pb-2.5',
              f.status === 'NOT_EXAMINED' && 'border-border/80 bg-background',
            )}
          >
            <div className="flex min-h-9 items-center gap-2">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium leading-tight">{f.system}</span>
                {focus.includes(f.system) && <span className="text-[11px] text-primary">Check first today</span>}
              </span>
              <StatusSwitch system={f.system} value={f.status} onChange={(s) => setStatus(i, s)} />
            </div>
            {f.status === 'ABNORMAL' && (
              <div className="grid gap-1.5 pr-2">
                <div className="flex flex-wrap gap-1">
                  {(ABNORMAL_PICKS[f.system] ?? ABNORMAL_PICKS.default).map((w) => {
                    const on = (f.notes ?? '').split(', ').includes(w);
                    return (
                      <button
                        key={w}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setAt(i, { notes: toggleWord(f.notes ?? '', w) })}
                        className={cn(
                          'inline-flex h-6 items-center gap-0.5 rounded-full border px-2 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          on ? 'border-warning bg-warning text-warning-foreground' : 'border-border bg-background hover:border-warning/60',
                        )}
                      >
                        {on && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                        {w}
                      </button>
                    );
                  })}
                </div>
                <Input id={`exam-note-${f.system}`} aria-label={`${f.system} findings`} className="h-8 bg-background px-3 text-xs" placeholder="Describe what you found" value={f.notes ?? ''} onChange={(e) => setAt(i, { notes: e.target.value })} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

const OPTIONS: { value: Status; label: string; short?: boolean }[] = [
  { value: 'NORMAL', label: 'Normal' },
  { value: 'ABNORMAL', label: 'Abnormal' },
  { value: 'NOT_EXAMINED', label: 'Not examined', short: true },
];

/** Normal / Abnormal / Not examined for one body system. */
function StatusSwitch({ system, value, onChange }: { system: string; value: Status; onChange: (s: Status) => void }) {
  return (
    <div role="group" aria-label={system} className="inline-flex shrink-0 rounded-lg border border-border/80 bg-background p-0.5">
      {OPTIONS.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            aria-label={`${system}: ${o.label}`}
            title={o.label}
            onClick={() => onChange(o.value)}
            className={cn(
              'h-8 rounded-md px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              o.short && 'px-2',
              on && o.value === 'NORMAL' && 'bg-success text-success-foreground',
              on && o.value === 'ABNORMAL' && 'bg-warning text-warning-foreground',
              on && o.value === 'NOT_EXAMINED' && 'bg-muted text-foreground',
              !on && 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {o.short ? <Minus className="h-3.5 w-3.5" /> : o.label}
          </button>
        );
      })}
    </div>
  );
}
