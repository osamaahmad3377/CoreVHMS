'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { TRIAGE_COLOURS, TRIAGE_PRIORITIES, enumLabel } from '@vcms/shared';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Field } from '../forms/field';
import { FormError } from '../forms/form-error';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input, NativeSelect, Textarea } from '../ui/input';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

const GUIDE: Record<string, string> = {
  RESUSCITATION: 'Immediate — e.g. not breathing, cardiac arrest',
  EMERGENT: 'Within minutes — e.g. severe bleeding, respiratory distress, collapse',
  URGENT: 'Within 30 min — e.g. significant pain, vomiting blood, dystocia',
  LESS_URGENT: 'Within 1–2 h — stable but unwell',
  NON_URGENT: 'Routine — stable, minor problem',
};

/** Records triage. Staff choose the level using clinical judgement; nothing is assigned automatically. */
export function TriageDialog({
  open,
  onOpenChange,
  patientId,
  appointmentId,
  patientName,
  defaultComplaint,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  patientId: string;
  appointmentId?: string | null;
  patientName: string;
  /** Prefills the presenting complaint, e.g. from the booking or walk-in reason. */
  defaultComplaint?: string | null;
}) {
  const qc = useQueryClient();
  const [priority, setPriority] = useState<string>('');
  const [complaint, setComplaint] = useState('');
  const [v, setV] = useState({ temperatureC: '', heartRate: '', respiratoryRate: '', capillaryRefillSec: '', painScore: '', mucousMembranes: '', mentation: '', notes: '' });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setPriority('');
      setComplaint(defaultComplaint ?? '');
      setV({ temperatureC: '', heartRate: '', respiratoryRate: '', capillaryRefillSec: '', painScore: '', mucousMembranes: '', mentation: '', notes: '' });
      setError(null);
    }
  }, [open, defaultComplaint]);
  const m = useMutation({
    mutationFn: () => api.post('/triage', { patientId, appointmentId, priority, presentingComplaint: complaint, ...v }),
    onSuccess: () => {
      toast.success(`Triage saved: ${patientName} — ${enumLabel(priority)}`);
      qc.invalidateQueries({ queryKey: ['queue'] });
      qc.invalidateQueries({ queryKey: ['appointments'] });
      onOpenChange(false);
    },
    onError: (e: Error) => setError(e.message),
  });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setV((s) => ({ ...s, [k]: e.target.value }));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Triage — {patientName}</DialogTitle>
          <DialogDescription>Choose the priority using clinical judgement. A veterinarian remains responsible for the final decision.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {error && <FormError message={error} />}
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Priority *</legend>
            <div className="grid gap-1.5" role="radiogroup">
              {TRIAGE_PRIORITIES.map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={priority === p}
                  onClick={() => setPriority(p)}
                  className={cn('flex items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-muted', priority === p && 'border-2 bg-muted')}
                  style={priority === p ? { borderColor: TRIAGE_COLOURS[p] } : undefined}
                >
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: TRIAGE_COLOURS[p] }} />
                  <span className="font-medium">{enumLabel(p)}</span>
                  <span className="text-xs text-muted-foreground">{GUIDE[p]}</span>
                </button>
              ))}
            </div>
          </fieldset>
          <Field label="Presenting complaint" htmlFor="tr-c" required>
            <Input id="tr-c" value={complaint} onChange={(e) => setComplaint(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Temp (°C)" htmlFor="tr-t"><Input id="tr-t" type="number" step="0.1" value={v.temperatureC} onChange={set('temperatureC')} /></Field>
            <Field label="HR (bpm)" htmlFor="tr-hr"><Input id="tr-hr" type="number" value={v.heartRate} onChange={set('heartRate')} /></Field>
            <Field label="RR (/min)" htmlFor="tr-rr"><Input id="tr-rr" type="number" value={v.respiratoryRate} onChange={set('respiratoryRate')} /></Field>
            <Field label="CRT (s)" htmlFor="tr-crt"><Input id="tr-crt" type="number" step="0.5" value={v.capillaryRefillSec} onChange={set('capillaryRefillSec')} /></Field>
            <Field label="Pain (0–10)" htmlFor="tr-p"><Input id="tr-p" type="number" min={0} max={10} value={v.painScore} onChange={set('painScore')} /></Field>
            <Field label="Mucous membranes" htmlFor="tr-mm">
              <NativeSelect id="tr-mm" value={v.mucousMembranes} onChange={set('mucousMembranes')}>
                <option value=""></option>
                {['Pink', 'Pale', 'White', 'Cyanotic', 'Injected', 'Icteric', 'Brick red'].map((x) => <option key={x}>{x}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Mentation" htmlFor="tr-m">
              <NativeSelect id="tr-m" value={v.mentation} onChange={set('mentation')}>
                <option value=""></option>
                {['Bright & alert', 'Quiet', 'Dull', 'Obtunded', 'Stuporous', 'Comatose'].map((x) => <option key={x}>{x}</option>)}
              </NativeSelect>
            </Field>
          </div>
          <Field label="Notes" htmlFor="tr-n"><Textarea id="tr-n" rows={2} value={v.notes} onChange={set('notes')} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!priority || !complaint.trim()} loading={m.isPending} onClick={() => m.mutate()}>Save triage</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
