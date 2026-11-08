'use client';
import { EXAM_SYSTEMS } from '@vcms/shared';
import { AlertTriangle, Check, CheckCircle2, Minus } from 'lucide-react';
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
  'Oral cavity & teeth': ['Tartar', 'Gingivitis', 'Broken tooth', 'Pale gums', 'Ulcers', 'Bad breath'],
  'Lymph nodes': ['Enlarged', 'Painful', 'Firm'],
  Cardiovascular: ['Murmur', 'Fast rate', 'Slow rate', 'Irregular rhythm', 'Weak pulse'],
  Respiratory: ['Fast breathing', 'Laboured', 'Wheeze', 'Crackles', 'Cough'],
  Abdomen: ['Painful', 'Tense', 'Distended', 'Mass felt', 'Fluid'],
  Musculoskeletal: ['Limping', 'Painful joint', 'Swollen joint', 'Reduced movement', 'Muscle loss'],
  Neurological: ['Weak', 'Wobbly', 'Head tilt', 'Seizure history', 'Reduced reflexes'],
  'Skin & coat': ['Itchy', 'Red', 'Hair loss', 'Scabs', 'Fleas seen', 'Lump', 'Wound'],
};

const toggleWord = (notes: string, word: string) => {
  const parts = notes.split(', ').map((x) => x.trim()).filter(Boolean);
  return (parts.includes(word) ? parts.filter((x) => x !== word) : [...parts, word]).join(', ');
};

/**
 * The physical examination as one grid of body systems. A normal visit is one tap ("All normal"); a tap on a system
 * flags it abnormal and opens a line to describe it with tap-words. Nothing is marked until the vet chooses.
 */
export function ExamChips({ findings, onChange, systems, focus = [] }: { findings: ExamFinding[]; onChange: (next: ExamFinding[]) => void; systems?: string[]; focus?: string[] }) {
  const lastFlagged = useRef<string | null>(null);
  // The systems that matter for this visit's reason come first.
  const base = systems?.length ? systems : DEFAULT_SYSTEMS;
  const start = [...focus, ...base.filter((s) => !focus.includes(s))];

  // Put the cursor in the description of the system just flagged, so the vet can type or tap straight away.
  useEffect(() => {
    if (!lastFlagged.current) return;
    document.getElementById(`exam-note-${lastFlagged.current}`)?.focus();
    lastFlagged.current = null;
  }, [findings]);

  if (!findings.length) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="lg" id="qc-exam-start" className="h-14 px-6 text-base" onClick={() => onChange(start.map((system) => ({ system, status: 'NORMAL', notes: '' })))}>
          <CheckCircle2 /> Everything looks normal
        </Button>
        <Button type="button" size="lg" variant="outline" className="h-14" onClick={() => onChange(start.map((system) => ({ system, status: 'NOT_EXAMINED', notes: '' })))}>
          I’ll go one by one
        </Button>
        {focus.length > 0 && <p className="w-full text-sm text-muted-foreground">For this visit, check first: <b className="text-foreground">{focus.join(', ')}</b></p>}
      </div>
    );
  }

  const setAt = (i: number, patch: Partial<ExamFinding>) => onChange(findings.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const tap = (i: number) => {
    const f = findings[i];
    // Normal → abnormal (the usual reason to tap); abnormal or not examined → normal.
    if (f.status === 'NORMAL') {
      lastFlagged.current = f.system;
      setAt(i, { status: 'ABNORMAL' });
    } else setAt(i, { status: 'NORMAL', notes: f.status === 'ABNORMAL' ? '' : f.notes });
  };
  const counts = { normal: findings.filter((f) => f.status === 'NORMAL').length, abnormal: findings.filter((f) => f.status === 'ABNORMAL').length, not: findings.filter((f) => f.status === 'NOT_EXAMINED').length };
  const abnormal = findings.map((f, i) => ({ f, i })).filter(({ f }) => f.status === 'ABNORMAL');

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Body systems — tap to flag as abnormal">
        {findings.map((f, i) => (
          <button
            key={f.system}
            type="button"
            onClick={() => tap(i)}
            aria-label={`${f.system}: ${f.status === 'NORMAL' ? 'normal' : f.status === 'ABNORMAL' ? 'abnormal' : 'not examined'}`}
            title={focus.includes(f.system) ? 'Check this one for today’s problem' : undefined}
            className={cn(
              'inline-flex h-11 items-center gap-1.5 rounded-pill border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]',
              focus.includes(f.system) && 'ring-2 ring-primary/40 ring-offset-1',
              f.status === 'NORMAL' && 'border-success/40 bg-success/10 text-success hover:bg-success/15',
              f.status === 'ABNORMAL' && 'border-warning bg-warning text-warning-foreground',
              f.status === 'NOT_EXAMINED' && 'border-dashed border-foreground/25 bg-card text-muted-foreground hover:bg-muted',
            )}
          >
            {f.status === 'NORMAL' ? <Check className="h-3.5 w-3.5" /> : f.status === 'ABNORMAL' ? <AlertTriangle className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
            {f.system}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span aria-live="polite">
          {counts.normal} normal · {counts.abnormal} abnormal{counts.not ? ` · ${counts.not} not examined` : ''}
        </span>
        {counts.not > 0 && (
          <button type="button" className="font-medium text-primary hover:underline" onClick={() => onChange(findings.map((f) => (f.status === 'NOT_EXAMINED' ? { ...f, status: 'NORMAL' } : f)))}>
            Mark the rest normal
          </button>
        )}
        <NativeSelect
          aria-label="Add a body system"
          className="ml-auto h-7 w-44 text-xs"
          value=""
          onChange={(e) => e.target.value && onChange([...findings, { system: e.target.value, status: 'NORMAL', notes: '' }])}
        >
          <option value="">Add system…</option>
          {EXAM_SYSTEMS.filter((s) => !findings.some((f) => f.system === s)).map((s) => (
            <option key={s}>{s}</option>
          ))}
        </NativeSelect>
      </div>
      {abnormal.map(({ f, i }) => (
        <div key={f.system} className="grid gap-1.5 rounded-lg border border-warning/50 bg-warning/5 p-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-sm font-semibold">{f.system}</span>
            {(ABNORMAL_PICKS[f.system] ?? ABNORMAL_PICKS.default).map((w) => {
              const on = (f.notes ?? '').split(', ').includes(w);
              return (
                <button
                  key={w}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setAt(i, { notes: toggleWord(f.notes ?? '', w) })}
                  className={cn('h-7 rounded-pill border px-2.5 text-xs font-medium', on ? 'border-warning bg-warning/25' : 'border-border bg-card hover:bg-muted')}
                >
                  {w}
                </button>
              );
            })}
            <button type="button" className="ml-auto text-xs text-muted-foreground hover:text-foreground hover:underline" onClick={() => setAt(i, { status: 'NOT_EXAMINED', notes: '' })}>
              Not examined
            </button>
          </div>
          <Input id={`exam-note-${f.system}`} aria-label={`${f.system} findings`} className="h-9" placeholder="Describe what you found" value={f.notes ?? ''} onChange={(e) => setAt(i, { notes: e.target.value })} />
        </div>
      ))}
    </div>
  );
}
