'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { EXAM_SYSTEMS } from '@vcms/shared';
import { CheckCircle2, FileSignature, Loader2, Save, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useConfirm } from '../confirm';
import { FormError } from '../forms/form-error';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input, NativeSelect, Textarea } from '../ui/input';
import { Label } from '../ui/label';
import { useTemplates } from '@/hooks/use-catalog';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { ClinicalNote, ExamFinding } from '@/lib/types';
import { cn } from '@/lib/utils';

type Content = Pick<ClinicalNote, 'presentingComplaint' | 'history' | 'subjective' | 'objective' | 'assessment' | 'plan' | 'followUpInstructions'> & {
  examFindings: ExamFinding[];
  templateId: string | null;
};

const DEFAULT_SYSTEMS = ['General appearance', 'Eyes', 'Ears', 'Oral cavity & teeth', 'Lymph nodes', 'Cardiovascular', 'Respiratory', 'Abdomen', 'Musculoskeletal', 'Neurological', 'Skin & coat'];

const empty = (): Content => ({
  presentingComplaint: '',
  history: '',
  subjective: '',
  objective: '',
  assessment: '',
  plan: '',
  followUpInstructions: '',
  examFindings: [],
  templateId: null,
});

function fromNote(n: ClinicalNote | null): Content {
  if (!n) return empty();
  return {
    presentingComplaint: n.presentingComplaint ?? '',
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

const FIELDS: { key: keyof Content; label: string; hint: string; rows: number }[] = [
  { key: 'presentingComplaint', label: 'Presenting complaint', hint: 'Why the animal is here today', rows: 2 },
  { key: 'history', label: 'History', hint: 'Relevant history, diet, environment, previous treatment', rows: 3 },
  { key: 'subjective', label: 'S — Subjective', hint: "Owner's observations, demeanour, appetite, duration", rows: 3 },
  { key: 'objective', label: 'O — Objective', hint: 'Measured findings. Record only what was examined.', rows: 3 },
  { key: 'assessment', label: 'A — Assessment', hint: 'Problem list, differentials, working diagnosis', rows: 3 },
  { key: 'plan', label: 'P — Plan', hint: 'Diagnostics, treatment, client communication', rows: 3 },
  { key: 'followUpInstructions', label: 'Follow-up instructions for the client', hint: 'Plain-language discharge / home-care instructions', rows: 2 },
];

/**
 * Editor for a draft note or a new amendment. Drafts autosave; signing is explicit and irreversible.
 */
export function NoteEditor({
  encounterId,
  note,
  amending,
  onDone,
}: {
  encounterId: string;
  /** Draft being edited, or the signed note being amended. */
  note: ClinicalNote | null;
  amending?: boolean;
  onDone?: () => void;
}) {
  const { can } = useSession();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const templates = useTemplates();
  const [content, setContent] = useState<Content>(() => fromNote(note));
  const [noteId, setNoteId] = useState<string | null>(amending ? null : (note?.id ?? null));
  const [status, setStatus] = useState(amending ? 'DRAFT' : (note?.status ?? 'DRAFT'));
  const [reason, setReason] = useState('');
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(note && !amending ? new Date(note.updatedAt) : null);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);

  useEffect(() => {
    setContent(fromNote(note));
    setNoteId(amending ? null : (note?.id ?? null));
    setStatus(amending ? 'DRAFT' : (note?.status ?? 'DRAFT'));
    setDirty(false);
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
      toast.success(n.status === 'SIGNED' ? 'Note signed and locked' : 'Marked as reviewed');
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

  const findings = content.examFindings;
  const setFinding = (i: number, patch: Partial<ExamFinding>) => set('examFindings', findings.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={status === 'REVIEWED' ? 'info' : 'warning'}>{amending ? 'Amendment draft' : status === 'REVIEWED' ? 'Reviewed' : 'Draft'}</Badge>
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
            {templates.data?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </NativeSelect>
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
      {FIELDS.slice(0, 4).map((f) => (
        <div key={f.key} className="grid gap-1.5">
          <Label htmlFor={`n-${f.key}`}>{f.label}</Label>
          <Textarea id={`n-${f.key}`} rows={f.rows} placeholder={f.hint} value={String(content[f.key] ?? '')} onChange={(e) => set(f.key, e.target.value)} />
        </div>
      ))}

      <fieldset className="rounded-md border p-3">
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

      {FIELDS.slice(4).map((f) => (
        <div key={f.key} className="grid gap-1.5">
          <Label htmlFor={`n-${f.key}`}>{f.label}</Label>
          <Textarea id={`n-${f.key}`} rows={f.rows} placeholder={f.hint} value={String(content[f.key] ?? '')} onChange={(e) => set(f.key, e.target.value)} />
        </div>
      ))}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
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
        {can('clinical.sign') && status === 'DRAFT' && noteId && !amending && (
          <Button variant="outline" size="sm" loading={transition.isPending && transition.variables === 'review'} onClick={() => transition.mutate('review')}>
            <CheckCircle2 /> Mark reviewed
          </Button>
        )}
        {can('clinical.sign') && (
          <Button
            size="sm"
            loading={transition.isPending && transition.variables === 'sign'}
            onClick={async () => {
              const r = await confirm({
                title: amending ? 'Sign this amendment?' : 'Sign this clinical note?',
                description: 'Signed notes are locked and cannot be edited or deleted. Corrections require an amendment, which is recorded with your name and reason.',
                confirmLabel: 'Sign note',
              });
              if (r.confirmed) transition.mutate('sign');
            }}
          >
            <FileSignature /> Sign
          </Button>
        )}
      </div>
    </div>
  );
}
