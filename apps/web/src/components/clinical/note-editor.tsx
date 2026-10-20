'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { EXAM_SYSTEMS, NOTE_PHRASE_FIELDS, type NotePhraseField } from '@vcms/shared';
import { Activity, ArrowLeft, ArrowRight, Check, CheckCircle2, FileSignature, History, Loader2, MousePointerClick, Save, Settings2, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useConfirm } from '../confirm';
import { FormError } from '../forms/form-error';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input, NativeSelect, Textarea } from '../ui/input';
import { Label } from '../ui/label';
import { NoteSection } from './note-section';
import { PastButton, usePastRecords } from './past-records';
import { QuickPicks } from './quick-picks';
import { useNotePhrases, useTemplates } from '@/hooks/use-catalog';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { ClinicalNote, ExamFinding, Vitals } from '@/lib/types';
import { cn } from '@/lib/utils';

type Content = Pick<ClinicalNote, 'presentingComplaint' | 'history' | 'subjective' | 'objective' | 'assessment' | 'plan' | 'followUpInstructions'> & {
  examFindings: ExamFinding[];
  templateId: string | null;
};

const DEFAULT_SYSTEMS = ['General appearance', 'Eyes', 'Ears', 'Oral cavity & teeth', 'Lymph nodes', 'Cardiovascular', 'Respiratory', 'Abdomen', 'Musculoskeletal', 'Neurological', 'Skin & coat'];

const empty = (presentingComplaint = ''): Content => ({
  presentingComplaint,
  history: '',
  subjective: '',
  objective: '',
  assessment: '',
  plan: '',
  followUpInstructions: '',
  examFindings: [],
  templateId: null,
});

function fromNote(n: ClinicalNote | null, chiefComplaint?: string | null): Content {
  // The reason given at booking or check-in starts the presenting complaint; the vet can change it.
  if (!n) return empty(chiefComplaint ?? '');
  return {
    presentingComplaint: n.presentingComplaint || (n.status === 'DRAFT' && !n.amendsId ? (chiefComplaint ?? '') : ''),
    history: n.history ?? '',
    subjective: n.subjective ?? '',
    objective: n.objective ?? '',
    assessment: n.assessment ?? '',
    plan: n.plan ?? '',
    followUpInstructions: n.followUpInstructions ?? '',
    examFindings: n.examFindings ?? [],
    templateId: n.templateId,
  };
}

/** S/O/A/P letters stay as small grey prefixes; the words say what to write. */
const FIELDS: { key: keyof Content; letter?: string; label: string; hint: string; rows: number }[] = [
  { key: 'presentingComplaint', label: 'Presenting complaint', hint: 'Why the animal is here today (filled in from the booking or check-in)', rows: 2 },
  { key: 'history', label: 'Past history', hint: 'Earlier illnesses, vaccinations, diet, home, medicines already given', rows: 3 },
  { key: 'subjective', letter: 'S', label: 'History — what the owner tells you', hint: 'What the owner noticed this time: since when, eating, drinking, vomiting, energy', rows: 3 },
  { key: 'objective', letter: 'O', label: 'Examination findings', hint: 'What you found when you examined: temperature, heart, lungs, abdomen. Record only what you examined.', rows: 3 },
  { key: 'assessment', letter: 'A', label: 'Assessment — likely problem', hint: 'What you think is wrong, and other possible causes', rows: 3 },
  { key: 'plan', letter: 'P', label: 'Plan — tests, treatment, advice', hint: 'Tests to do, medicines and treatment, what you told the owner', rows: 3 },
  { key: 'followUpInstructions', label: 'Instructions for the owner', hint: 'Plain words for home care, e.g. “Give the tablets with food. Come back if he stops eating.”', rows: 2 },
];

/** The note is written in five steps; each step covers one or two of the note's fields. */
const SECTIONS: { id: string; title: string; hint: string; fields: (keyof Content)[] }[] = [
  { id: 'complaint', title: 'Why they came', hint: 'The reason for today’s visit', fields: ['presentingComplaint'] },
  { id: 'history', title: 'History', hint: 'Past history, and what the client tells you', fields: ['history', 'subjective'] },
  { id: 'exam', title: 'Examination', hint: 'What you found when you examined the patient', fields: ['objective'] },
  { id: 'assessment', title: 'Assessment', hint: 'What you think is wrong', fields: ['assessment'] },
  { id: 'plan', title: 'Plan and advice', hint: 'What happens next, and what to tell the client', fields: ['plan', 'followUpInstructions'] },
];

/** One step of a guided consultation: note fields and/or other things to do (vitals, diagnoses, medicines, tests…). */
/** What a step's content can see of the note and the other steps. */
export interface StepContext {
  content: Content;
  done: Record<string, boolean>;
  goStep: (id: string) => void;
}

export interface WorkflowStep {
  id: string;
  title: string;
  hint: string;
  fields?: (keyof Content)[];
  /** Show the physical-examination checklist in this step. */
  exam?: boolean;
  /** The step's other content, e.g. the vital-signs form or the prescriptions list. A function gets the note as written so far. */
  extra?: React.ReactNode | ((ctx: StepContext) => React.ReactNode);
  /** A short count shown beside the step, e.g. "2 diagnoses". */
  badge?: string | null;
  /** The step counts as done even if none of its note fields has text (e.g. vitals recorded). */
  done?: boolean;
  /** Text in the step's note fields does not make it done; only `done` does (e.g. vitals must be recorded). */
  ignoreFieldsForDone?: boolean;
}

/** "Temp 39.8 °C, Weight 18 kg, Heart rate 120/min, …" from a vitals row. */
export function vitalsText(v: Vitals) {
  const parts: string[] = [];
  if (v.temperatureC != null) parts.push(`Temp ${v.temperatureC} °C`);
  if (v.weightKg != null) parts.push(`Weight ${v.weightKg} kg`);
  if (v.heartRate != null) parts.push(`Heart rate ${v.heartRate}/min`);
  if (v.respiratoryRate != null) parts.push(`Breathing ${v.respiratoryRate}/min`);
  if (v.capillaryRefillSec != null) parts.push(`CRT ${v.capillaryRefillSec} s`);
  if (v.mucousMembranes) parts.push(`Gums ${v.mucousMembranes.toLowerCase()}`);
  if (v.painScore != null) parts.push(`Pain ${v.painScore}/10`);
  if (v.systolicBp != null) parts.push(`BP ${v.systolicBp}${v.diastolicBp != null ? `/${v.diastolicBp}` : ''} mmHg`);
  if (v.spo2 != null) parts.push(`SpO₂ ${v.spo2}%`);
  return parts.join(', ');
}

/** "Fill from last visit" (only while the field is empty) and "Past": the earlier entries beside the note. */
function PastTools({ field, value, onFill }: { field: NotePhraseField; value: string; onFill: (text: string) => void }) {
  const past = usePastRecords();
  const last = past?.lastText(field);
  return (
    <>
      {last && !value.trim() && (
        <button
          type="button"
          onClick={() => onFill(last.text)}
          title={`Copies what was written on ${fmtDateTime(last.at)}`}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-2 text-xs font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <History className="h-3 w-3" /> Fill from last visit
        </button>
      )}
      <PastButton tab="notes" field={field} />
    </>
  );
}

/** Save functions of open editors with unsaved changes, so "Finish consultation" can save them before signing. */
const pendingSaves = new Set<() => Promise<unknown>>();
export async function flushNoteDrafts() {
  await Promise.all([...pendingSaves].map((save) => save()));
}

/**
 * Editor for a draft note or a new amendment. Drafts autosave; signing is explicit and irreversible.
 */
export function NoteEditor({
  encounterId,
  note,
  amending,
  onDone,
  speciesCategory,
  chiefComplaint,
  latestVitals,
  workflow,
  stepId,
  onStepChange,
}: {
  /** A guided visit: the steps to show, in order (otherwise the note is shown as five collapsible steps). */
  workflow?: WorkflowStep[];
  stepId?: string;
  onStepChange?: (id: string) => void;
  encounterId: string;
  /** Reason from the booking or check-in, used to start an empty presenting complaint. */
  chiefComplaint?: string | null;
  /** Newest vitals of the consultation, for "Insert vitals". */
  latestVitals?: Vitals | null;
  /** Patient's species category; templates restricted to another category are hidden. */
  speciesCategory?: string | null;
  /** Draft being edited, or the signed note being amended. */
  note: ClinicalNote | null;
  amending?: boolean;
  onDone?: () => void;
}) {
  const { can, session } = useSession();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const templates = useTemplates();
  const phrases = useNotePhrases();
  const past = usePastRecords();
  // Tap-to-add buttons can be switched off by people who prefer typing; remembered on this computer.
  const [picksOn, setPicksOn] = useState(true);
  useEffect(() => {
    try {
      setPicksOn(localStorage.getItem('vcms.quickpicks') !== 'off');
    } catch {
      /* storage unavailable: keep them on */
    }
  }, []);
  const [openId, setOpenId] = useState('complaint');
  const [showAll, setShowAll] = useState(false);
  const started = useRef(false);
  const togglePicks = () =>
    setPicksOn((on) => {
      try {
        localStorage.setItem('vcms.quickpicks', on ? 'off' : 'on');
      } catch {
        /* ignore */
      }
      return !on;
    });
  const [content, setContent] = useState<Content>(() => fromNote(note, amending ? null : chiefComplaint));
  // An existing draft without a presenting complaint gets the check-in reason; save it like any other change.
  const prefilled = !amending && !!note && note.status === 'DRAFT' && !note.amendsId && !note.presentingComplaint && !!chiefComplaint;
  const [noteId, setNoteId] = useState<string | null>(amending ? null : (note?.id ?? null));
  const [status, setStatus] = useState(amending ? 'DRAFT' : (note?.status ?? 'DRAFT'));
  const [reason, setReason] = useState('');
  const [dirty, setDirty] = useState(prefilled);
  const [savedAt, setSavedAt] = useState<Date | null>(note && !amending ? new Date(note.updatedAt) : null);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);

  useEffect(() => {
    // The draft this editor just created comes back with an id: keep what is on screen.
    if (!amending && note?.id && note.id === noteId) return;
    setContent(fromNote(note, amending ? null : chiefComplaint));
    setNoteId(amending ? null : (note?.id ?? null));
    setStatus(amending ? 'DRAFT' : (note?.status ?? 'DRAFT'));
    setDirty(prefilled);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.id, amending]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['encounter', encounterId] });

  const save = useCallback(async () => {
    if (saving.current) return noteId;
    saving.current = true;
    setError(null);
    try {
      const body = { ...content, examFindings: content.examFindings.length ? content.examFindings : null };
      let n: ClinicalNote;
      if (noteId) n = await api.patch<ClinicalNote>(`/notes/${noteId}`, body);
      else if (amending && note) {
        if (!reason.trim()) throw new Error('Enter the reason for the amendment');
        n = await api.post<ClinicalNote>(`/notes/${note.id}/amend`, { ...body, amendmentReason: reason });
      } else n = await api.post<ClinicalNote>(`/encounters/${encounterId}/notes`, body);
      setNoteId(n.id);
      setStatus(n.status);
      setDirty(false);
      setSavedAt(new Date());
      invalidate();
      return n.id;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      saving.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, noteId, amending, note, reason, encounterId]);

  // While there are unsaved changes, "Finish consultation" can save them first.
  useEffect(() => {
    if (!dirty || (amending && !noteId && !reason.trim())) return;
    pendingSaves.add(save);
    return () => {
      pendingSaves.delete(save);
    };
  }, [dirty, save, amending, noteId, reason]);

  // Autosave drafts 2 s after the last change (amendments need a reason first).
  useEffect(() => {
    if (!dirty || (amending && !noteId && !reason.trim())) return;
    const t = setTimeout(() => void save(), 2000);
    return () => clearTimeout(t);
  }, [dirty, content, save, amending, noteId, reason]);

  const set = (k: keyof Content, v: any) => {
    setContent((c) => ({ ...c, [k]: v }));
    setDirty(true);
  };

  // The Past records panel (beside the note) copies earlier text into a field through this.
  const contentRef = useRef(content);
  contentRef.current = content;
  useEffect(() => {
    if (!past) return;
    past.registerApplier((field, text, mode) => {
      const prev = String(contentRef.current[field] ?? '');
      set(field, mode === 'replace' || !prev.trim() ? text : `${prev.trimEnd()}\n${text}`);
      return prev;
    });
    return () => past.registerApplier(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [past]);

  const applyTemplate = async (id: string) => {
    const t = templates.data?.find((x) => x.id === id);
    if (!t) return;
    const hasText = FIELDS.some((f) => String(content[f.key] ?? '').trim());
    if (hasText) {
      const r = await confirm({ title: `Apply “${t.name}”?`, description: 'Template text is added below what you have already written.' });
      if (!r.confirmed) return;
    }
    const join = (a: string | null, b: string | null) => [a, b].filter((x) => x && x.trim()).join('\n');
    setContent((c) => ({
      ...c,
      templateId: t.id,
      presentingComplaint: join(c.presentingComplaint, t.presentingComplaint),
      subjective: join(c.subjective, t.subjective),
      objective: join(c.objective, t.objective),
      assessment: join(c.assessment, t.assessment),
      plan: join(c.plan, t.plan),
      examFindings: c.examFindings.length ? c.examFindings : (t.examSystems.length ? t.examSystems : DEFAULT_SYSTEMS).map((system) => ({ system, status: 'NOT_EXAMINED' as const, notes: '' })),
    }));
    setDirty(true);
  };

  const transition = useMutation({
    mutationFn: async (action: 'review' | 'sign') => {
      const id = dirty || !noteId ? await save() : noteId;
      if (!id) throw new Error('Save the note first');
      return api.post<ClinicalNote>(`/notes/${id}/${action}`);
    },
    onSuccess: (n) => {
      setStatus(n.status);
      toast.success(n.status === 'SIGNED' ? 'Note signed and locked' : 'Note approved');
      invalidate();
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      if (n.status === 'SIGNED') onDone?.();
    },
    onError: (e: Error) => setError(e.message),
  });

  const discard = useMutation({
    mutationFn: () => api.del(`/notes/${noteId}`),
    onSuccess: () => {
      toast.success('Draft discarded');
      invalidate();
      onDone?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const insertVitals = () => {
    if (!latestVitals) return;
    const text = vitalsText(latestVitals);
    const current = content.objective ?? '';
    set('objective', current.trim() ? `${current.trimEnd()}\n${text}` : text);
  };

  const renderField = (f: (typeof FIELDS)[number]) => (
    <div key={f.key} className="grid gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor={`n-${f.key}`}>
          {f.letter && <span className="mr-1.5 font-mono text-xs font-normal text-muted-foreground" aria-hidden>{f.letter}</span>}
          {f.label}
        </Label>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {f.key === 'objective' && latestVitals && vitalsText(latestVitals) && (
            <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={insertVitals}>
              <Activity /> Insert vitals
            </Button>
          )}
          {past && (NOTE_PHRASE_FIELDS as readonly string[]).includes(f.key) && <PastTools field={f.key as NotePhraseField} value={String(content[f.key] ?? '')} onFill={(t) => set(f.key, t)} />}
        </div>
      </div>
      {picksOn && (NOTE_PHRASE_FIELDS as readonly string[]).includes(f.key) && (
        <QuickPicks field={f.key as NotePhraseField} value={String(content[f.key] ?? '')} onChange={(v) => set(f.key, v)} phrases={phrases.data ?? []} />
      )}
      <Textarea id={`n-${f.key}`} rows={f.rows} placeholder={f.hint} value={String(content[f.key] ?? '')} onChange={(e) => set(f.key, e.target.value)} />
    </div>
  );

  const findings = content.examFindings;
  const setFinding = (i: number, patch: Partial<ExamFinding>) => set('examFindings', findings.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  const filledOf = (sec: (typeof SECTIONS)[number]) => sec.fields.some((k) => String(content[k] ?? '').trim()) || (sec.id === 'exam' && content.examFindings.some((f) => f.status !== 'NOT_EXAMINED'));
  const summaryOf = (sec: (typeof SECTIONS)[number]) => {
    const t = sec.fields.map((k) => String(content[k] ?? '').trim()).find(Boolean);
    return t ? (t.length > 90 ? `${t.slice(0, 90)}…` : t) : null;
  };
  const doneCount = SECTIONS.filter(filledOf).length;
  const toggleShowAll = () =>
    setShowAll((v) => {
      try {
        localStorage.setItem('vcms.note.showall', v ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !v;
    });
  // On opening: start at the first step not written yet; people who prefer to see everything keep that choice.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    try {
      if (localStorage.getItem('vcms.note.showall') === '1') setShowAll(true);
    } catch {
      /* ignore */
    }
    const first = SECTIONS.find((sec) => !filledOf(sec));
    setOpenId(first?.id ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const steps = workflow ?? [];
  const stepDone = (st: WorkflowStep) => !!st.done || (!st.ignoreFieldsForDone && !!st.fields?.some((k) => String(content[k] ?? '').trim())) || (!!st.exam && content.examFindings.some((f) => f.status !== 'NOT_EXAMINED'));
  const activeStep = steps.length ? (stepId && steps.some((st) => st.id === stepId) ? stepId : steps[0].id) : '';
  const goStep = (id: string) => {
    onStepChange?.(id);
    if (typeof window !== 'undefined') document.getElementById('consult-steps')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const examBlock = (
      <fieldset className="rounded-lg border p-3">
        <legend className="px-1 text-sm font-medium">Physical examination</legend>
        {findings.length === 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs text-muted-foreground">Structured findings by body system (optional).</p>
            <Button type="button" size="sm" variant="outline" onClick={() => set('examFindings', DEFAULT_SYSTEMS.map((system) => ({ system, status: 'NOT_EXAMINED', notes: '' })))}>
              Add examination checklist
            </Button>
          </div>
        ) : (
          <div className="grid gap-1.5">
            <div className="flex flex-wrap gap-2 pb-1">
              <Button type="button" size="sm" variant="ghost" onClick={() => set('examFindings', findings.map((f) => (f.status === 'NOT_EXAMINED' ? { ...f, status: 'NORMAL' as const } : f)))}>
                Mark unexamined as normal
              </Button>
              <NativeSelect
                aria-label="Add body system"
                className="h-8 w-48 text-xs"
                value=""
                onChange={(e) => e.target.value && set('examFindings', [...findings, { system: e.target.value, status: 'NOT_EXAMINED', notes: '' }])}
              >
                <option value="">Add system…</option>
                {EXAM_SYSTEMS.filter((s) => !findings.some((f) => f.system === s)).map((s) => <option key={s}>{s}</option>)}
              </NativeSelect>
            </div>
            {findings.map((f, i) => (
              <div key={f.system} className="grid grid-cols-[160px_150px_1fr] items-center gap-2 max-sm:grid-cols-2">
                <span className="text-sm">{f.system}</span>
                <NativeSelect
                  aria-label={`${f.system} finding`}
                  className={cn('h-8 text-xs', f.status === 'ABNORMAL' && 'border-warning text-warning', f.status === 'NORMAL' && 'text-success')}
                  value={f.status}
                  onChange={(e) => setFinding(i, { status: e.target.value as ExamFinding['status'] })}
                >
                  <option value="NOT_EXAMINED">Not examined</option>
                  <option value="NORMAL">Normal</option>
                  <option value="ABNORMAL">Abnormal</option>
                </NativeSelect>
                <Input aria-label={`${f.system} notes`} className="h-8 text-xs max-sm:col-span-2" placeholder={f.status === 'ABNORMAL' ? 'Describe the abnormality' : 'Notes'} value={f.notes ?? ''} onChange={(e) => setFinding(i, { notes: e.target.value })} />
              </div>
            ))}
          </div>
        )}
      </fieldset>
  );

  const stepBody = (st: WorkflowStep, n: number) => (
    <div className="grid gap-5">
      {(showAll || steps.length > 0) && (
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h2 className="text-base font-semibold">{st.title}</h2>
          <span className="text-xs text-muted-foreground">Step {n + 1} of {steps.length} · {st.hint}</span>
        </div>
      )}
      {st.fields?.map((k) => renderField(FIELDS.find((f) => f.key === k)!))}
      {st.exam && examBlock}
      {typeof st.extra === 'function' ? st.extra({ content, done: Object.fromEntries(steps.map((x) => [x.id, stepDone(x)])), goStep }) : st.extra}
      {!showAll && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
          {n > 0 ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => goStep(steps[n - 1].id)}><ArrowLeft /> Back: {steps[n - 1].title}</Button>
          ) : <span />}
          {n < steps.length - 1 && (
            <Button type="button" size="sm" onClick={() => goStep(steps[n + 1].id)}>Next: {steps[n + 1].title} <ArrowRight /></Button>
          )}
        </div>
      )}
    </div>
  );

  const wizard = (
    <div id="consult-steps" className="grid scroll-mt-20 gap-4 lg:grid-cols-[14.5rem_minmax(0,1fr)]">
      <nav aria-label="Consultation steps" className="min-w-0 lg:sticky lg:top-20 lg:self-start">
        <ol className="flex gap-1.5 overflow-x-auto pb-1 lg:grid lg:gap-1 lg:overflow-visible lg:pb-0">
          {steps.map((st, n) => {
            const done = stepDone(st);
            const current = !showAll && st.id === activeStep;
            return (
              <li key={st.id} className="shrink-0 lg:shrink">
                <button
                  type="button"
                  aria-current={current ? 'step' : undefined}
                  onClick={() => (showAll ? document.getElementById(`step-${st.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) : goStep(st.id))}
                  className={cn('flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', current ? 'border-primary/50 bg-primary/10 font-semibold' : 'border-transparent hover:bg-muted')}
                >
                  <span className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold', done ? 'bg-success text-white' : current ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
                    {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : n + 1}
                  </span>
                  <span className="min-w-0 flex-1 whitespace-nowrap lg:whitespace-normal">
                    <span className="block leading-tight">{st.title}</span>
                    {st.badge && <span className="block text-2xs font-normal text-muted-foreground">{st.badge}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <button type="button" onClick={toggleShowAll} className="mt-2 hidden text-xs font-medium text-primary hover:underline lg:block">{showAll ? 'Show one step at a time' : 'Show all steps'}</button>
      </nav>
      <div className="min-w-0">
        <div className="mb-3 flex items-center justify-between text-xs lg:hidden">
          <span className="font-medium">{steps.filter(stepDone).length} of {steps.length} steps done</span>
          <button type="button" onClick={toggleShowAll} className="font-medium text-primary hover:underline">{showAll ? 'Show one step at a time' : 'Show all steps'}</button>
        </div>
        {steps.map((st, n) => (
          <div key={st.id} id={`step-${st.id}`} hidden={!showAll && st.id !== activeStep} className={cn(showAll && 'mb-6 rounded-xl border bg-card p-4')}>
            {stepBody(st, n)}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={status === 'REVIEWED' ? 'info' : 'warning'}>{amending ? 'Correction draft' : status === 'REVIEWED' ? `Approved${note?.reviewedByName ? ` by ${note.reviewedByName}` : ''} — not signed` : 'Draft — not signed'}</Badge>
        <span className="flex items-center gap-1 text-xs text-muted-foreground" aria-live="polite">
          {saving.current ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" /> Saving…
            </>
          ) : dirty ? (
            'Unsaved changes'
          ) : savedAt ? (
            `Saved ${fmtDateTime(savedAt)}`
          ) : (
            'Not saved yet'
          )}
        </span>
        {!amending && (
          <NativeSelect aria-label="Apply template" className="ml-auto h-8 w-56 text-xs" value="" onChange={(e) => e.target.value && applyTemplate(e.target.value)}>
            <option value="">Apply a template…</option>
            {templates.data?.filter((t) => !t.speciesCategory || !speciesCategory || t.speciesCategory === speciesCategory).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </NativeSelect>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5 font-medium text-foreground"><MousePointerClick className="h-3.5 w-3.5 text-primary" /> Quick picks {picksOn ? 'on' : 'off'}</span>
        {picksOn && <span className="hidden sm:inline">Tap a button to add it; tap again to remove it.</span>}
        <button type="button" onClick={togglePicks} className="font-medium text-primary hover:underline">{picksOn ? 'Hide buttons' : 'Show buttons'}</button>
        {can('settings.manage') && (
          <Link href="/settings/note-phrases" className="ml-auto flex items-center gap-1 font-medium text-primary hover:underline"><Settings2 className="h-3.5 w-3.5" /> Edit the buttons</Link>
        )}
      </div>
      {error && <FormError message={error} />}
      {amending && (
        <div className="grid gap-1.5 rounded-md border border-warning/40 bg-warning/10 p-3">
          <Label htmlFor="amend-reason">Reason for amendment *</Label>
          <Input id="amend-reason" value={reason} onChange={(e) => { setReason(e.target.value); setDirty(true); }} placeholder="e.g. Laboratory result received; correction of recorded weight" />
          <p className="text-xs text-muted-foreground">The signed original stays in the record unchanged. This amendment replaces it as the current version once signed.</p>
        </div>
      )}
      {workflow ? wizard : (
        <>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[10rem] flex-1">
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="font-medium">{doneCount} of {SECTIONS.length} steps written</span>
            <button type="button" onClick={toggleShowAll} className="font-medium text-primary hover:underline">{showAll ? 'Show one step at a time' : 'Show all steps'}</button>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={SECTIONS.length} aria-valuenow={doneCount} aria-label="Note progress">
            <div className="h-full rounded-full bg-success transition-all duration-300" style={{ width: `${(doneCount / SECTIONS.length) * 100}%` }} />
          </div>
        </div>
      </div>
      <div className="grid gap-2.5">
        {SECTIONS.map((sec, n) => (
          <NoteSection
            key={sec.id}
            index={n + 1}
            title={sec.title}
            hint={sec.hint}
            summary={summaryOf(sec)}
            filled={filledOf(sec)}
            open={showAll || openId === sec.id}
            onToggle={() => setOpenId(openId === sec.id && !showAll ? '' : sec.id)}
            onNext={n < SECTIONS.length - 1 ? () => setOpenId(SECTIONS[n + 1].id) : undefined}
            nextLabel={SECTIONS[n + 1]?.title}
          >
            {sec.fields.map((k) => renderField(FIELDS.find((f) => f.key === k)!))}
            {sec.id === 'exam' && examBlock}
          </NoteSection>
        ))}
      </div>
        </>
      )}

      <div className="sticky bottom-0 z-10 -mb-2 flex flex-wrap items-center justify-end gap-2 border-t bg-card/95 pb-3 pt-3 backdrop-blur">
        {noteId && !amending && (
          <Button
            variant="ghost"
            size="sm"
            className="mr-auto text-destructive"
            onClick={async () => {
              const r = await confirm({ title: 'Discard this draft?', description: 'Unsigned draft content will be removed. This is recorded in the audit log.', destructive: true, confirmLabel: 'Discard' });
              if (r.confirmed) discard.mutate();
            }}
          >
            <Trash2 /> Discard draft
          </Button>
        )}
        {amending && onDone && (
          <Button variant="ghost" size="sm" className="mr-auto" onClick={onDone}>
            Cancel amendment
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={() => void save()} disabled={!dirty && !!noteId}>
          <Save /> Save draft
        </Button>
        {/* Approving is for a note someone else (e.g. a nurse) wrote; your own note is simply signed. */}
        {can('clinical.sign') && status === 'DRAFT' && noteId && !amending && note && note.authorId !== session.user.id && (
          <Button variant="outline" size="sm" loading={transition.isPending && transition.variables === 'review'} onClick={() => transition.mutate('review')}>
            <CheckCircle2 /> Approve nurse's note
          </Button>
        )}
        {can('clinical.sign') && (
          <Button
            size="sm"
            loading={transition.isPending && transition.variables === 'sign'}
            onClick={async () => {
              // Check what the server would reject before asking for confirmation.
              if (amending && !noteId && !reason.trim()) {
                setError('Enter the reason for the amendment before signing');
                document.getElementById('amend-reason')?.focus();
                return;
              }
              setError(null);
              const r = await confirm({
                title: amending ? 'Sign this amendment?' : 'Sign this clinical note?',
                description: 'Signed notes are locked and cannot be edited or deleted. Corrections require an amendment, which is recorded with your name and reason.',
                confirmLabel: 'Sign note',
              });
              if (r.confirmed) transition.mutate('sign');
            }}
          >
            <FileSignature /> Sign & lock note
          </Button>
        )}
      </div>
    </div>
  );
}
