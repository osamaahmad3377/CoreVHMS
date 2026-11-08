'use client';
import type { ClinicHeader } from '../billing/invoice-document';
import { cn } from '@/lib/utils';

/** Everything the two documents need, already written out by the visit screen. */
export interface VisitDoc {
  patientName: string;
  species: string;
  ownerName: string | null;
  vetName: string | null;
  date: string;
  encounterNo: string;
  reason: string;
  history: string;
  ownerSays: string;
  measurements: string;
  exam: string;
  diagnoses: { term: string; sure: string }[];
  reasoning: string;
  plan: string;
  givenToday: string[];
  forHome: string[];
  tests: string[];
  advice: string;
  nextVisit: string | null;
  healthy: boolean;
}

function Part({ letter, title, children, empty }: { letter?: string; title: string; children: React.ReactNode; empty?: boolean }) {
  return (
    <section className="grid gap-1 border-b border-border/60 py-3 last:border-0">
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {letter && <span className="grid h-5 w-5 place-items-center rounded bg-primary/10 font-mono text-[11px] text-primary">{letter}</span>}
        {title}
      </h3>
      <div className={cn('whitespace-pre-line text-[15px] leading-relaxed', empty && 'text-muted-foreground')}>{children}</div>
    </section>
  );
}

/** The clinical record, laid out the way vets read one: history, examination, assessment, plan. */
export function ClinicalRecordView({ d }: { d: VisitDoc }) {
  const none = 'Not recorded';
  return (
    <article className="rounded-xl border bg-card px-5 py-2">
      <Part title="Reason for visit" empty={!d.reason}>{d.reason || none}</Part>
      <Part letter="S" title="History" empty={!d.ownerSays && !d.history}>
        {[d.ownerSays, d.history && `Past history: ${d.history.replace(/\n/g, ' ')}`].filter(Boolean).join('\n\n') || none}
      </Part>
      <Part letter="O" title="Examination" empty={!d.measurements && !d.exam}>
        {[d.measurements && `Measurements: ${d.measurements}.`, d.exam].filter(Boolean).join('\n') || none}
      </Part>
      <Part letter="A" title="Assessment" empty={!d.diagnoses.length && !d.reasoning}>
        {[d.diagnoses.map((x) => `${x.term} (${x.sure})`).join('; '), d.reasoning].filter(Boolean).join('\n') || none}
      </Part>
      <Part letter="P" title="Plan" empty={!d.plan}>{d.plan || none}</Part>
      <Part title="Instructions given to the owner" empty={!d.advice && !d.nextVisit}>
        {[d.advice, d.nextVisit && `Next visit: ${d.nextVisit}.`].filter(Boolean).join('\n') || none}
      </Part>
    </article>
  );
}

/**
 * A one-page summary for the owner, in plain words: what was found, what was done, what to do at home and when to
 * come back. Medicines are named only — how to give them is on the pharmacy label, never repeated here.
 */
export function OwnerSummary({ d, clinic, className }: { d: VisitDoc; clinic: ClinicHeader | null; className?: string }) {
  const contact = [clinic?.phone, clinic?.email].filter(Boolean).join(' · ');
  return (
    <article className={cn('mx-auto max-w-2xl rounded-xl border bg-white p-8 text-[15px] leading-relaxed text-neutral-900', className)}>
      <header className="mb-5 flex items-start justify-between gap-4 border-b border-neutral-200 pb-4">
        <div>
          <p className="text-lg font-semibold">{clinic?.name ?? 'Visit summary'}</p>
          {(clinic?.addressLine1 || clinic?.city) && <p className="text-sm text-neutral-600">{[clinic?.addressLine1, clinic?.city].filter(Boolean).join(', ')}</p>}
          {contact && <p className="text-sm text-neutral-600">{contact}</p>}
        </div>
        <div className="text-right text-sm text-neutral-600">
          <p className="font-medium text-neutral-900">Visit summary</p>
          <p>{d.date}</p>
          <p>{d.encounterNo}</p>
        </div>
      </header>
      <p className="mb-4">
        <b>{d.patientName}</b> ({d.species}){d.ownerName && <> — for {d.ownerName}</>}. Seen by {d.vetName ?? 'our vet'}.
      </p>
      <dl className="grid gap-4">
        {d.reason && (
          <div>
            <dt className="font-semibold">Why {d.patientName} came in</dt>
            <dd>{d.reason}</dd>
          </div>
        )}
        <div>
          <dt className="font-semibold">What we found</dt>
          <dd>{d.healthy ? `${d.patientName} is in good health.` : d.diagnoses.length ? d.diagnoses.map((x) => (x.sure === 'sure' ? x.term : `${x.term} (${x.sure === 'likely' ? 'most likely' : 'possible'})`)).join(', ') : 'We examined ' + d.patientName + ' today.'}</dd>
        </div>
        {d.givenToday.length > 0 && (
          <div>
            <dt className="font-semibold">Given today in the clinic</dt>
            <dd>{d.givenToday.join(', ')}</dd>
          </div>
        )}
        {d.forHome.length > 0 && (
          <div>
            <dt className="font-semibold">Medicines to give at home</dt>
            <dd>
              {d.forHome.join(', ')}
              <span className="block text-sm text-neutral-600">Follow the instructions on each medicine’s label, and finish the full course.</span>
            </dd>
          </div>
        )}
        {d.tests.length > 0 && (
          <div>
            <dt className="font-semibold">Tests</dt>
            <dd>{d.tests.join(', ')} — we will contact you with the results.</dd>
          </div>
        )}
        {d.advice && (
          <div>
            <dt className="font-semibold">At home</dt>
            <dd className="whitespace-pre-line">{d.advice}</dd>
          </div>
        )}
        <div>
          <dt className="font-semibold">Next visit</dt>
          <dd>{d.nextVisit ?? 'No follow-up visit is needed unless you are worried.'}</dd>
        </div>
      </dl>
      <p className="mt-6 rounded-lg bg-neutral-100 px-4 py-3 text-sm">If you are worried about {d.patientName} at any time, please call us{clinic?.phone ? ` on ${clinic.phone}` : ''}.</p>
    </article>
  );
}
