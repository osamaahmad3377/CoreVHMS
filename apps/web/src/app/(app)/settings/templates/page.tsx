'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { answersToText, enumLabel, EXAM_SYSTEMS, SPECIES_CATEGORIES, STANDARD_EXAM_SYSTEMS, TEMPLATE_ICONS, type TemplateIcon } from '@vcms/shared';
import { ArrowDown, ArrowLeft, ArrowUp, Check, Copy, Eye, FileText, MessageSquareText, Plus, RotateCcw, Save, Stethoscope, X } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { EmptyState, LoadingRows } from '@/components/page';
import { reasonIcon } from '@/components/quick-consult/visit-reasons';
import { RequirePermission } from '@/components/require';
import { Button } from '@/components/ui/button';
import { Checkbox, Switch } from '@/components/ui/checkbox';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { useAppointmentTypes } from '@/hooks/use-catalog';
import { api } from '@/lib/api';
import type { ClinicalTemplateRow } from '@/lib/types';
import { cn } from '@/lib/utils';

/* An editable copy of a template. Keys keep rows stable while questions and answers move around. */
interface DAnswer {
  key: string;
  label: string;
  text: string;
}
interface DQuestion {
  key: string;
  ask: string;
  multi: boolean;
  answers: DAnswer[];
}
interface Draft {
  id: string | null;
  name: string;
  icon: TemplateIcon;
  speciesCategory: string;
  isActive: boolean;
  presentingComplaint: string;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  examSystems: string[];
  diagnoses: string[];
  advice: string[];
  questions: DQuestion[];
}

let seq = 0;
const key = () => `k${++seq}`;
const blankAnswer = (): DAnswer => ({ key: key(), label: '', text: '' });
const blankQuestion = (): DQuestion => ({ key: key(), ask: '', multi: false, answers: [blankAnswer(), blankAnswer()] });
const blankDraft = (): Draft => ({ id: null, name: '', icon: 'stethoscope', speciesCategory: '', isActive: true, presentingComplaint: '', subjective: '', objective: '', assessment: '', plan: '', examSystems: [...STANDARD_EXAM_SYSTEMS], diagnoses: [], advice: [], questions: [blankQuestion()] });
const toDraft = (t: ClinicalTemplateRow, copy = false): Draft => ({
  id: copy ? null : t.id,
  name: copy ? `${t.name} (copy)` : t.name,
  icon: (TEMPLATE_ICONS as readonly string[]).includes(t.icon) ? (t.icon as TemplateIcon) : 'file',
  speciesCategory: t.speciesCategory ?? '',
  isActive: t.isActive,
  presentingComplaint: t.presentingComplaint ?? '',
  subjective: t.subjective ?? '',
  objective: t.objective ?? '',
  assessment: t.assessment ?? '',
  plan: t.plan ?? '',
  examSystems: t.examSystems,
  diagnoses: t.diagnoses ?? [],
  advice: t.advice ?? [],
  questions: (t.questions ?? []).map((q) => ({ key: key(), ask: q.ask, multi: q.multi, answers: q.answers.map((a) => ({ key: key(), label: a.label, text: a.text })) })),
});
const toBody = (d: Draft) => ({
  name: d.name,
  icon: d.icon,
  speciesCategory: d.speciesCategory || null,
  isActive: d.isActive,
  presentingComplaint: d.presentingComplaint,
  subjective: d.subjective,
  objective: d.objective,
  assessment: d.assessment,
  plan: d.plan,
  examSystems: d.examSystems,
  diagnoses: d.diagnoses,
  advice: d.advice,
  // Rows added but left empty are not saved.
  questions: d.questions.filter((q) => q.ask.trim()).map((q) => ({ ask: q.ask, multi: q.multi, answers: q.answers.filter((a) => a.label.trim()).map((a) => ({ label: a.label, text: a.text })) })),
});
const move = <T,>(list: T[], i: number, by: number) => {
  const j = i + by;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
};

function Section({ title, hint, icon: Icon, aside, children }: { title: string; hint?: string; icon?: React.ComponentType<{ className?: string }>; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="grid gap-3 border-t pt-5 first:border-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="flex items-center gap-1.5 text-sm font-semibold">
          {Icon && <Icon className="h-4 w-4 text-primary" />} {title}
        </h4>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
        {aside && <div className="ml-auto">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

/** A list of short sentences (diagnoses, advice): type and press Enter to add, × to remove. */
function ListEditor({ id, items, onChange, placeholder }: { id: string; items: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [v, setV] = useState('');
  const add = () => {
    const t = v.trim();
    if (t && !items.includes(t)) onChange([...items, t]);
    setV('');
  };
  return (
    <div className="grid gap-2">
      {items.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {items.map((it) => (
            <li key={it} className="inline-flex items-center gap-1 rounded-pill border bg-card py-1 pl-3 pr-1 text-sm">
              {it}
              <button type="button" aria-label={`Remove ${it}`} onClick={() => onChange(items.filter((x) => x !== it))} className="grid h-5 w-5 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground">
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Input id={id} value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} placeholder={placeholder} />
        <Button type="button" variant="outline" onClick={add} disabled={!v.trim()}>
          <Plus /> Add
        </Button>
      </div>
    </div>
  );
}

/** Taps the questions as a vet would, and shows what they write in the record. */
function TryIt({ draft }: { draft: Draft }) {
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const questions = draft.questions.filter((q) => q.ask.trim()).map((q) => ({ id: q.key, ask: q.ask, multi: q.multi, sortOrder: 0, answers: q.answers.filter((a) => a.label.trim()).map((a) => ({ id: a.key, label: a.label, text: a.text, sortOrder: 0 })) }));
  const written = answersToText({ questions }, answers);
  if (!questions.length) return <p className="text-sm text-muted-foreground">Add a question to try it.</p>;
  return (
    <div className="grid gap-3">
      {questions.map((q) => (
        <div key={q.id} className="grid gap-1.5">
          <span className="text-sm font-medium">{q.ask}</span>
          <div className="flex flex-wrap gap-1.5">
            {q.answers.map((a) => {
              const on = (answers[q.id] ?? []).includes(a.label);
              return (
                <button
                  key={a.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setAnswers((s) => {
                      const cur = s[q.id] ?? [];
                      return { ...s, [q.id]: q.multi ? (on ? cur.filter((x) => x !== a.label) : [...cur, a.label]) : on ? [] : [a.label] };
                    })
                  }
                  className={cn('h-9 rounded-lg border px-3 text-sm font-medium', on ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-muted')}
                >
                  {a.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div className="rounded-lg border-l-4 border-success bg-success/5 px-3 py-2 text-sm">
        <span className="block text-xs font-semibold uppercase tracking-wide text-success">Written in the record</span>
        {written || <span className="text-muted-foreground">Tap some answers above.</span>}
      </div>
    </div>
  );
}

/**
 * The template's own examination buttons: remove (×), move (‹ ›), add any name — standard systems are suggested.
 * An empty list means the standard set is used.
 */
function ExamListEditor({ items, onChange }: { items: string[]; onChange: (v: string[]) => void }) {
  const [v, setV] = useState('');
  const add = (name: string) => {
    const t = name.trim();
    if (!t) return;
    if (items.some((x) => x.toLowerCase() === t.toLowerCase())) {
      toast.message(`“${t}” is already a button`);
      return;
    }
    onChange([...items, t]);
    setV('');
  };
  const missing = STANDARD_EXAM_SYSTEMS.filter((s) => !items.includes(s));
  const suggestions = EXAM_SYSTEMS.filter((s) => !items.includes(s));
  return (
    <div className="grid gap-3">
      {items.length ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Examination buttons">
          {items.map((s, i) => (
            <li key={s} className="inline-flex h-9 items-center gap-0.5 rounded-pill border bg-card pl-1 pr-1 text-sm">
              <button type="button" aria-label={`Move ${s} left`} disabled={i === 0} onClick={() => onChange(move(items, i, -1))} className="grid h-6 w-5 place-items-center text-muted-foreground hover:text-foreground disabled:opacity-25">
                ‹
              </button>
              <span className="px-1 font-medium">{s}</span>
              <button type="button" aria-label={`Move ${s} right`} disabled={i === items.length - 1} onClick={() => onChange(move(items, i, 1))} className="grid h-6 w-5 place-items-center text-muted-foreground hover:text-foreground disabled:opacity-25">
                ›
              </button>
              <button type="button" aria-label={`Remove ${s}`} onClick={() => onChange(items.filter((x) => x !== s))} className="ml-0.5 grid h-6 w-6 place-items-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">No buttons of its own — the standard {STANDARD_EXAM_SYSTEMS.length} body systems are used.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Input list="t-exam-suggestions" className="max-w-xs" value={v} maxLength={60} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add(v))} placeholder="Add a button, e.g. Tail or Beak" aria-label="New examination button" />
        <datalist id="t-exam-suggestions">
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <Button type="button" variant="outline" onClick={() => add(v)} disabled={!v.trim()}>
          <Plus /> Add
        </Button>
        {missing.length > 0 && (
          <Button type="button" variant="ghost" onClick={() => onChange([...items, ...missing])}>
            Add the standard ones{items.length ? ` (${missing.length} missing)` : ''}
          </Button>
        )}
        {items.length > 0 && (
          <Button type="button" variant="ghost" className="text-muted-foreground" onClick={() => onChange([])}>
            Clear all
          </Button>
        )}
      </div>
    </div>
  );
}

const NOTE_TEXT = [
  ['presentingComplaint', 'Reason for visit', 'Written as the reason for the visit'],
  ['subjective', 'History', 'Added under what the owner tells you'],
  ['objective', 'Examination', 'Added under the examination findings'],
  ['assessment', 'Assessment', 'Added as clinical reasoning'],
  ['plan', 'Plan', 'Added to the plan'],
] as const;

function Editor({ initial, onSaved, onCancel }: { initial: Draft; onSaved: (id: string) => void; onCancel: () => void }) {
  const qc = useQueryClient();
  const [d, setD] = useState<Draft>(initial);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  useEffect(() => setD(initial), [initial]);
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const setQ = (i: number, p: Partial<DQuestion>) => set({ questions: d.questions.map((q, j) => (j === i ? { ...q, ...p } : q)) });
  const setA = (qi: number, ai: number, p: Partial<DAnswer>) => setQ(qi, { answers: d.questions[qi].answers.map((a, j) => (j === ai ? { ...a, ...p } : a)) });
  const hasNoteText = NOTE_TEXT.some(([k]) => d[k].trim());

  const save = useMutation({
    mutationFn: () => (d.id ? api.patch<ClinicalTemplateRow>(`/clinical-templates/${d.id}`, toBody(d)) : api.post<ClinicalTemplateRow>('/clinical-templates', toBody(d))),
    onSuccess: (t) => {
      toast.success(`“${t.name}” saved — used from the next consultation`);
      setError(null);
      qc.invalidateQueries({ queryKey: ['clinical-templates'] });
      onSaved(t.id);
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="grid gap-5 rounded-2xl surface-flat p-5 shadow-card">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold">{d.id ? initial.name : 'New questions'}</h3>
        <label className="ml-auto flex items-center gap-2 text-sm">
          <Switch checked={d.isActive} onCheckedChange={(v) => set({ isActive: v })} aria-label="Template in use" /> In use
        </label>
      </div>
      {error && <FormError message={error} />}

      <Section title="Name and animals">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" htmlFor="t-name" required>
            <Input id="t-name" value={d.name} maxLength={100} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Tick fever" />
          </Field>
          <Field label="For which animals" htmlFor="t-species">
            <NativeSelect id="t-species" value={d.speciesCategory} onChange={(e) => set({ speciesCategory: e.target.value })}>
              <option value="">All animals</option>
              {SPECIES_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {enumLabel(c)} only
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
        <div className="grid gap-1.5">
          <span className="text-sm font-medium">Icon on the consultation button</span>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Icon">
            {TEMPLATE_ICONS.map((ic) => {
              const Icon = reasonIcon(ic);
              return (
                <button key={ic} type="button" role="radio" aria-checked={d.icon === ic} aria-label={ic} onClick={() => set({ icon: ic })} className={cn('grid h-9 w-9 place-items-center rounded-lg border', d.icon === ic ? 'border-primary bg-primary text-primary-foreground' : 'bg-background text-primary hover:bg-primary/5')}>
                  <Icon className="h-4 w-4" />
                </button>
              );
            })}
          </div>
        </div>
      </Section>

      <Section
        title="Questions for the owner"
        icon={MessageSquareText}
        hint="Asked in this order. Each answer is a button; what it writes goes into the history."
        aside={
          <Button type="button" size="sm" variant={preview ? 'default' : 'outline'} onClick={() => setPreview((p) => !p)}>
            <Eye /> {preview ? 'Back to editing' : 'Try it'}
          </Button>
        }
      >
        {preview ? (
          <div className="rounded-xl border p-4">
            <TryIt draft={d} />
          </div>
        ) : (
          <>
            {d.questions.map((q, qi) => (
              <div key={q.key} className="grid gap-2.5 rounded-xl border p-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{qi + 1}</span>
                  <Input aria-label={`Question ${qi + 1}`} className="min-w-[14rem] flex-1 font-medium" value={q.ask} maxLength={120} onChange={(e) => setQ(qi, { ask: e.target.value })} placeholder="e.g. Since when?" />
                  <label className="flex items-center gap-1.5 text-xs">
                    <Checkbox checked={q.multi} onCheckedChange={(v) => setQ(qi, { multi: v === true })} /> Several answers allowed
                  </label>
                  <div className="flex">
                    <Button type="button" size="icon-sm" variant="ghost" aria-label="Move up" disabled={qi === 0} onClick={() => set({ questions: move(d.questions, qi, -1) })}>
                      <ArrowUp />
                    </Button>
                    <Button type="button" size="icon-sm" variant="ghost" aria-label="Move down" disabled={qi === d.questions.length - 1} onClick={() => set({ questions: move(d.questions, qi, 1) })}>
                      <ArrowDown />
                    </Button>
                    <Button type="button" size="icon-sm" variant="ghost" aria-label="Remove question" onClick={() => set({ questions: d.questions.filter((_, j) => j !== qi) })}>
                      <X />
                    </Button>
                  </div>
                </div>
                <div className="grid gap-1.5 sm:pl-8">
                  <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] gap-2 text-xs font-medium text-muted-foreground sm:grid">
                    <span>Button says</span>
                    <span>Writes in the record</span>
                    <span className="w-8" />
                  </div>
                  {q.answers.map((a, ai) => (
                    <div key={a.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] gap-2">
                      <Input aria-label="Button says" value={a.label} maxLength={60} onChange={(e) => setA(qi, ai, { label: e.target.value })} placeholder="e.g. 2–3 days" />
                      <Input aria-label="Writes in the record" value={a.text} maxLength={300} onChange={(e) => setA(qi, ai, { text: e.target.value })} placeholder="e.g. Started 2–3 days ago" />
                      <Button type="button" size="icon-sm" variant="ghost" aria-label="Remove answer" className="self-center" onClick={() => setQ(qi, { answers: q.answers.filter((_, j) => j !== ai) })}>
                        <X />
                      </Button>
                    </div>
                  ))}
                  <Button type="button" size="sm" variant="ghost" className="w-fit" onClick={() => setQ(qi, { answers: [...q.answers, blankAnswer()] })}>
                    <Plus /> Add an answer
                  </Button>
                </div>
              </div>
            ))}
            <Button type="button" variant="outline" className="w-fit" onClick={() => set({ questions: [...d.questions, blankQuestion()] })}>
              <Plus /> Add a question
            </Button>
          </>
        )}
      </Section>

      <Section title="Examination buttons" icon={Stethoscope} hint="The body systems the vet taps in this template’s examination, in this order.">
        <ExamListEditor items={d.examSystems} onChange={(examSystems) => set({ examSystems })} />
      </Section>

      <div className="grid gap-5 border-t pt-5 lg:grid-cols-2">
        <section className="grid content-start gap-2">
          <h4 className="text-sm font-semibold">Usual diagnoses to suggest</h4>
          <ListEditor id="t-dx" items={d.diagnoses} onChange={(diagnoses) => set({ diagnoses })} placeholder="e.g. Babesiosis (suspected)" />
        </section>
        <section className="grid content-start gap-2">
          <h4 className="text-sm font-semibold">Advice for the owner to suggest</h4>
          <ListEditor id="t-advice" items={d.advice} onChange={(advice) => set({ advice })} placeholder="e.g. Check the coat for ticks every day" />
        </section>
      </div>

      <details className="rounded-xl border px-4 py-3" open={hasNoteText || undefined}>
        <summary className="cursor-pointer text-sm font-semibold">
          <FileText className="mr-1.5 inline h-4 w-4 text-primary" />
          Note text filled in by this template <span className="font-normal text-muted-foreground">· optional</span>
        </summary>
        <div className="mt-3 grid gap-3">
          <p className="text-xs text-muted-foreground">Fills only boxes that are still empty. Never put doses here — clinicians write the treatment.</p>
          {NOTE_TEXT.map(([k, label, hint]) => (
            <Field key={k} label={label} htmlFor={`t-${k}`} hint={hint}>
              <Textarea id={`t-${k}`} rows={k === 'presentingComplaint' ? 1 : 2} value={d[k]} onChange={(e) => set({ [k]: e.target.value })} />
            </Field>
          ))}
        </div>
      </details>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" loading={save.isPending} disabled={!d.name.trim()} onClick={() => save.mutate()}>
          <Save /> Save questions
        </Button>
      </div>
    </div>
  );
}

function Page() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['clinical-templates', 'all'], queryFn: () => api.get<ClinicalTemplateRow[]>('/clinical-templates?all=true') });
  // Opened from an appointment type: its questions straight away.
  const [selected, setSelected] = useState<string | 'new' | null>(useSearchParams().get('id'));
  const types = useAppointmentTypes(true);
  const usedBy = (templateId: string) => (types.data ?? []).filter((t) => t.templateId === templateId).map((t) => t.name);
  const [copyOf, setCopyOf] = useState<ClinicalTemplateRow | null>(null);
  const rows = useMemo(() => q.data ?? [], [q.data]);
  useEffect(() => {
    if (selected === null && rows.length) setSelected(rows[0].id);
  }, [rows, selected]);

  const toggle = useMutation({
    // The whole template is sent: fields left out would be reset by the template rules (e.g. the exam checklist).
    mutationFn: (t: ClinicalTemplateRow) => api.patch(`/clinical-templates/${t.id}`, { ...toBody(toDraft(t)), isActive: !t.isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clinical-templates'] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const restore = useMutation({
    mutationFn: () => api.post<{ added: number }>('/clinical-templates/restore-starter'),
    onSuccess: (r) => {
      toast.success(r.added ? `Standard questions put back on ${r.added} template${r.added === 1 ? '' : 's'}` : 'Every standard template already has its questions');
      qc.invalidateQueries({ queryKey: ['clinical-templates'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const current = selected === 'new' ? null : (rows.find((r) => r.id === selected) ?? null);
  const initial = useMemo(() => (selected === 'new' ? (copyOf ? toDraft(copyOf, true) : blankDraft()) : current ? toDraft(current) : null), [selected, current, copyOf]);

  return (
    <div className="grid gap-4">
      <Link href="/settings/appointment-types" className="flex w-fit items-center gap-1.5 text-sm font-medium text-primary hover:underline">
        <ArrowLeft className="h-4 w-4" /> Appointment types
      </Link>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">Consultation questions</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            The questions for each appointment type. In a consultation the vet picks the category and the appointment type, then asks its questions — every answer is a button that writes a sentence in the history — and gets its examination buttons, usual diagnoses and advice. A new set of questions becomes an appointment type of the same name.
          </p>
        </div>
        <Button variant="outline" loading={restore.isPending} onClick={() => restore.mutate()}>
          <RotateCcw /> Restore standard questions
        </Button>
        <Button
          onClick={() => {
            setCopyOf(null);
            setSelected('new');
          }}
        >
          <Plus /> New questions
        </Button>
      </div>

      {q.isLoading ? (
        <LoadingRows />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <ul className="grid content-start gap-1.5" aria-label="Consultation templates">
            {rows.map((t) => {
              const Icon = reasonIcon(t.icon);
              const n = t.questions?.length ?? 0;
              return (
                <li key={t.id}>
                  <div className={cn('flex items-center gap-2 rounded-xl border px-2.5 py-2', selected === t.id ? 'border-primary bg-primary/5' : 'bg-card hover:bg-muted/50', !t.isActive && 'opacity-60')}>
                    <button type="button" onClick={() => setSelected(t.id)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{t.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {n ? `${n} question${n === 1 ? '' : 's'}` : 'No questions yet'}
                          {t.speciesCategory && ` · ${enumLabel(t.speciesCategory)}`}
                          {!t.isActive && ' · not in use'}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {(() => {
                            const names = usedBy(t.id).filter((x) => x !== t.name);
                            return types.isLoading ? '' : names.length ? `For: ${names.join(', ')}` : usedBy(t.id).length ? '' : 'Not used by an appointment type';
                          })()}
                        </span>
                      </span>
                    </button>
                    <Switch checked={t.isActive} onCheckedChange={() => toggle.mutate(t)} aria-label={`${t.name} in use`} />
                  </div>
                </li>
              );
            })}
            {!rows.length && <EmptyState icon={FileText} title="No questions yet" className="py-6" />}
          </ul>

          <div className="min-w-0">
            {initial ? (
              <>
                {current && (
                  <div className="mb-2 flex justify-end">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setCopyOf(current);
                        setSelected('new');
                      }}
                    >
                      <Copy /> Make a copy to change
                    </Button>
                  </div>
                )}
                <Editor
                  key={selected ?? 'none'}
                  initial={initial}
                  onSaved={(id) => {
                    setCopyOf(null);
                    setSelected(id);
                  }}
                  onCancel={() => {
                    setCopyOf(null);
                    setSelected(rows[0]?.id ?? null);
                  }}
                />
              </>
            ) : (
              <EmptyState icon={FileText} title="Choose a set of questions" description="Choose one on the left to see and change its questions." />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function TemplatesPage() {
  return (
    <RequirePermission anyOf={['settings.manage']}>
      <Suspense>
        <Page />
      </Suspense>
    </RequirePermission>
  );
}
