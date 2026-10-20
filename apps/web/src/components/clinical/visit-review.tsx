'use client';
import { AlertCircle, CheckCircle2, ChevronRight, Flag } from 'lucide-react';
import { Button } from '../ui/button';
import { ConsultationCharges } from './charges-card';
import type { StepContext } from './note-editor';
import type { Encounter } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * The last step of a consultation: what has been done, what is still open, the charges that will be billed,
 * and the Finish button. Missing items are suggestions, not blocks: not every visit needs a prescription.
 */
export function VisitReview({ encounter: e, hasPrescriptions, ctx, onFinish }: { encounter: Encounter; hasPrescriptions: boolean; ctx: StepContext; onFinish: () => void }) {
  const items: { step: string; label: string; ok: boolean; okText: string; todoText: string }[] = [
    { step: 'arrival', label: 'Vital signs', ok: e.vitals.length > 0, okText: `${e.vitals.length} reading${e.vitals.length === 1 ? '' : 's'} recorded`, todoText: 'None recorded yet' },
    { step: 'history', label: 'History', ok: !!(ctx.content.history?.trim() || ctx.content.subjective?.trim()), okText: 'Written', todoText: 'Not written yet' },
    { step: 'exam', label: 'Examination', ok: !!ctx.content.objective?.trim() || ctx.done.exam, okText: 'Written', todoText: 'Not written yet' },
    { step: 'diagnosis', label: 'Diagnosis', ok: e.diagnoses.length > 0, okText: e.diagnoses.map((d) => d.term).join(', '), todoText: 'No diagnosis recorded' },
    { step: 'treatment', label: 'Treatment and plan', ok: !!ctx.content.plan?.trim() || hasPrescriptions, okText: hasPrescriptions ? 'Plan written, medicines prescribed' : 'Plan written', todoText: 'No plan written yet' },
    { step: 'advice', label: 'Advice and follow-up', ok: !!ctx.content.followUpInstructions?.trim() || e.tasks.length > 0, okText: 'Advice or follow-up added', todoText: 'No advice or follow-up added' },
  ];
  const open = items.filter((i) => !i.ok);
  return (
    <div className="grid gap-4">
      <div className={cn('flex items-start gap-3 rounded-xl border p-4', open.length ? 'border-warning/40 bg-warning/10' : 'border-success/40 bg-success/10')}>
        {open.length ? <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-warning" /> : <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />}
        <div>
          <p className="text-sm font-semibold">{open.length ? `${open.length} thing${open.length === 1 ? '' : 's'} not done yet` : 'Everything is filled in'}</p>
          <p className="text-xs text-muted-foreground">{open.length ? 'Fine if they do not apply to this visit. Tap one to go back to it.' : 'You can finish the consultation now.'}</p>
        </div>
      </div>
      <ul className="divide-y overflow-hidden rounded-xl border bg-card">
        {items.map((i) => (
          <li key={i.step}>
            <button type="button" onClick={() => ctx.goStep(i.step)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none">
              {i.ok ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" /> : <AlertCircle className="h-4 w-4 shrink-0 text-warning" />}
              <span className="w-44 shrink-0 text-sm font-medium">{i.label}</span>
              <span className={cn('min-w-0 flex-1 truncate text-sm', i.ok ? 'text-foreground/80' : 'text-muted-foreground')}>{i.ok ? i.okText : i.todoText}</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          </li>
        ))}
      </ul>
      <ConsultationCharges encounterId={e.id} hasPrescriptions={hasPrescriptions} />
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-primary/5 p-4">
        <p className="max-w-md text-sm text-muted-foreground">Finishing closes the visit and sends the charges to billing. You can sign the note now or later.</p>
        <Button size="lg" onClick={onFinish}>
          <Flag /> Finish consultation
        </Button>
      </div>
    </div>
  );
}
