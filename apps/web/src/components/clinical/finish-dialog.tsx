'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Paginated } from '@vcms/shared';
import { CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { FormError } from '../forms/form-error';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { flushNoteDrafts } from './note-editor';
import { api, qs } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { ClinicalNote, DiagnosticOrder, Encounter, Prescription } from '@/lib/types';

const unsigned = (n: ClinicalNote) => n.status === 'DRAFT' || n.status === 'REVIEWED';
const hasText = (n: ClinicalNote) => [n.presentingComplaint, n.subjective, n.objective, n.assessment, n.plan].some((x) => x && x.trim());
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

type Check = { state: 'ok' | 'bad' | 'none'; text: string };

/**
 * "Before you finish" checklist. The default action signs the unsigned notes this user wrote, then completes
 * the consultation; "Finish, sign later" completes it and leaves the notes as drafts (a banner then reminds).
 */
export function FinishConsultationDialog({ encounter, open, onOpenChange, onFinished }: { encounter: Encounter; open: boolean; onOpenChange: (o: boolean) => void; onFinished: (r: { unsignedNotes: number }) => void }) {
  const { can, session } = useSession();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  // Notes typed in the last moments (before autosave) are saved first, so the checklist shows what was written.
  const [savingNotes, setSavingNotes] = useState(false);
  const patientId = encounter.patient.id;
  const encounterId = encounter.id;
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSavingNotes(true);
    void flushNoteDrafts()
      .then(() => qc.refetchQueries({ queryKey: ['encounter', encounterId] }))
      .finally(() => {
        if (!cancelled) setSavingNotes(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, encounterId, qc]);
  // Same query keys as the panels on the page, so the lists are usually already loaded.
  const rx = useQuery({ queryKey: ['prescriptions', { patientId, encounterId }], queryFn: () => api.get<Paginated<Prescription>>(`/prescriptions${qs({ patientId, encounterId, pageSize: 50 })}`), enabled: open && can('prescriptions.read') });
  const lab = useQuery({ queryKey: ['lab-orders', { patientId, encounterId }], queryFn: () => api.get<Paginated<DiagnosticOrder>>(`/lab-orders${qs({ patientId, encounterId, pageSize: 50 })}`), enabled: open && can('lab.read') });

  const current = encounter.notes.filter((n) => n.status !== 'SUPERSEDED');
  const drafts = current.filter(unsigned);
  const mine = drafts.filter((n) => n.authorId === session.user.id);
  const canSignMine = mine.length > 0 && can('clinical.sign');
  const prescriptions = (rx.data?.data ?? []).filter((p) => p.status !== 'CANCELLED');
  const sent = prescriptions.filter((p) => p.status !== 'DRAFT').length;
  const draftRx = prescriptions.length - sent;
  const tests = (lab.data?.data ?? []).filter((o) => o.status !== 'CANCELLED').reduce((n, o) => n + o.items.length, 0);

  const checks: Check[] = [
    current.some(hasText) ? { state: 'ok', text: 'Notes written' } : { state: 'bad', text: 'No notes written yet' },
    drafts.length ? { state: 'bad', text: drafts.length === 1 ? 'Notes not signed' : `${plural(drafts.length, 'note')} not signed` } : current.length ? { state: 'ok', text: 'Notes signed' } : { state: 'none', text: 'No notes to sign' },
    ...(can('prescriptions.read')
      ? [
          sent ? ({ state: 'ok', text: `${plural(sent, 'prescription')} sent to pharmacy` } as Check) : null,
          draftRx ? ({ state: 'bad', text: `${plural(draftRx, 'prescription')} still a draft — not sent to the pharmacy` } as Check) : null,
          !prescriptions.length ? ({ state: 'none', text: 'No prescriptions' } as Check) : null,
        ]
      : []),
    ...(can('lab.read') ? [tests ? ({ state: 'ok', text: `${plural(tests, 'test')} ordered` } as Check) : ({ state: 'none', text: 'No tests ordered' } as Check)] : []),
  ].filter((c): c is Check => !!c);

  const finish = useMutation({
    mutationFn: async (sign: boolean) => {
      await flushNoteDrafts();
      if (sign) {
        // Sign what is saved now (after the flush), only notes this user wrote.
        const fresh = await api.get<Encounter>(`/encounters/${encounterId}`);
        for (const n of fresh.notes.filter((x) => unsigned(x) && x.authorId === session.user.id)) await api.post(`/notes/${n.id}/sign`);
      }
      return api.post<{ unsignedNotes: number }>(`/encounters/${encounterId}/complete`);
    },
    onSuccess: (r) => {
      onOpenChange(false);
      onFinished(r);
    },
    onError: (e: Error) => {
      setError(e.message);
      qc.invalidateQueries({ queryKey: ['encounter', encounterId] });
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) setError(null);
        onOpenChange(o);
      }}
    >
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Before you finish</DialogTitle>
          <DialogDescription>Check that nothing is missing for {encounter.patient.name}.</DialogDescription>
        </DialogHeader>
        {error && <FormError message={error} />}
        {savingNotes ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Saving your notes…</p>
        ) : (
        <ul className="grid gap-1.5 text-sm" aria-label="Checklist">
          {checks.map((c) => (
            <li key={c.text} className="flex items-center gap-2">
              {c.state === 'ok' ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-label="Done" /> : c.state === 'bad' ? <XCircle className="h-4 w-4 shrink-0 text-destructive" aria-label="Not done" /> : <Circle className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
              <span className={c.state === 'none' ? 'text-muted-foreground' : undefined}>{c.text}</span>
            </li>
          ))}
        </ul>
        )}
        {canSignMine && <p className="text-xs text-muted-foreground">“Sign notes & finish” signs and locks your {mine.length === 1 ? 'note' : `${mine.length} notes`}. Changes after that need a correction (amendment).</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Go back</Button>
          {canSignMine ? (
            <>
              <Button variant="outline" loading={finish.isPending && finish.variables === false} disabled={finish.isPending || savingNotes} onClick={() => { setError(null); finish.mutate(false); }}>
                Finish, sign later
              </Button>
              <Button loading={finish.isPending && finish.variables === true} disabled={finish.isPending || savingNotes} onClick={() => { setError(null); finish.mutate(true); }}>
                Sign notes & finish
              </Button>
            </>
          ) : (
            <Button loading={finish.isPending} disabled={savingNotes} onClick={() => { setError(null); finish.mutate(false); }}>
              Finish consultation
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
