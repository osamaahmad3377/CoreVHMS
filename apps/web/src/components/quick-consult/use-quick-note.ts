'use client';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { ClinicalNote, ExamFinding } from '@/lib/types';

/** The note fields Quick consult writes — the same draft note the classic screen edits, so both stay in step. */
export interface QuickNote {
  presentingComplaint: string;
  history: string;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  followUpInstructions: string;
  examFindings: ExamFinding[];
  templateId: string | null;
}
export type TextField = Exclude<keyof QuickNote, 'examFindings' | 'templateId'>;

function fromNote(n: ClinicalNote | null, chiefComplaint: string | null): QuickNote {
  return {
    presentingComplaint: n?.presentingComplaint || chiefComplaint || '',
    history: n?.history ?? '',
    subjective: n?.subjective ?? '',
    objective: n?.objective ?? '',
    assessment: n?.assessment ?? '',
    plan: n?.plan ?? '',
    followUpInstructions: n?.followUpInstructions ?? '',
    examFindings: n?.examFindings ?? [],
    templateId: n?.templateId ?? null,
  };
}

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

/**
 * The visit's draft note, saved by itself 1.5 s after the last change. Nothing is created until the vet writes
 * something, so opening a consultation never leaves an empty draft behind. Saves never overlap, and typing during a
 * save is kept (it is saved by the next round).
 */
export function useQuickNote(encounterId: string, draft: ClinicalNote | null, chiefComplaint: string | null) {
  const qc = useQueryClient();
  const [note, setNote] = useState<QuickNote>(() => fromNote(draft, chiefComplaint));
  const [state, setState] = useState<SaveState>(draft && !draft.presentingComplaint && chiefComplaint ? 'dirty' : 'idle');
  const [savedAt, setSavedAt] = useState<Date | null>(draft ? new Date(draft.updatedAt) : null);
  const [error, setError] = useState<string | null>(null);

  const noteRef = useRef(note);
  noteRef.current = note;
  const idRef = useRef<string | null>(draft?.id ?? null);
  const edits = useRef(0);
  const inFlight = useRef<Promise<string | null> | null>(null);

  const save = useCallback(async (): Promise<string | null> => {
    if (inFlight.current) await inFlight.current;
    const startedAt = edits.current;
    const run = (async () => {
      setState('saving');
      setError(null);
      const c = noteRef.current;
      const body = { ...c, examFindings: c.examFindings.length ? c.examFindings : null };
      try {
        const created = !idRef.current;
        const n = idRef.current ? await api.patch<ClinicalNote>(`/notes/${idRef.current}`, body) : await api.post<ClinicalNote>(`/encounters/${encounterId}/notes`, body);
        idRef.current = n.id;
        setSavedAt(new Date());
        setState(edits.current === startedAt ? 'saved' : 'dirty');
        // The encounter (and the finish checklist) needs to know a draft exists; later saves change nothing it shows.
        if (created) qc.invalidateQueries({ queryKey: ['encounter', encounterId] });
        return n.id;
      } catch (e) {
        setError((e as Error).message);
        setState('error');
        return null;
      }
    })();
    inFlight.current = run;
    try {
      return await run;
    } finally {
      inFlight.current = null;
    }
  }, [encounterId, qc]);

  // Autosave after a pause in typing.
  useEffect(() => {
    if (state !== 'dirty') return;
    const t = setTimeout(() => void save(), 1500);
    return () => clearTimeout(t);
  }, [state, note, save]);

  // Leaving with unsaved words: the browser asks first.
  useEffect(() => {
    if (state !== 'dirty' && state !== 'saving') return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [state]);

  const update = useCallback((patch: Partial<QuickNote> | ((n: QuickNote) => Partial<QuickNote>)) => {
    setNote((n) => ({ ...n, ...(typeof patch === 'function' ? patch(n) : patch) }));
    edits.current += 1;
    setState('dirty');
  }, []);

  const set = useCallback((field: TextField, value: string) => update({ [field]: value }), [update]);

  /** Adds lines under what is already written, skipping any line that is already there. */
  const append = useCallback(
    (field: TextField, text: string) =>
      update((n) => {
        const prev = n[field];
        const lines = text.split('\n').filter((l) => l.trim() && !prev.includes(l.trim()));
        if (!lines.length) return {};
        return { [field]: prev.trim() ? `${prev.trimEnd()}\n${lines.join('\n')}` : lines.join('\n') };
      }),
    [update],
  );

  /** Saves now if anything is unsaved; returns the draft's id (null when nothing has been written). */
  const flush = useCallback(async () => (state === 'dirty' || state === 'error' || inFlight.current ? save() : idRef.current), [state, save]);

  return { note, set, update, append, flush, state, savedAt, error, hasDraft: () => !!idRef.current };
}
