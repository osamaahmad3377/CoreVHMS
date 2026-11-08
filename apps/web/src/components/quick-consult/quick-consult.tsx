'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Ban, CalendarCheck, CalendarPlus, Check, CheckCircle2, CloudOff, FileText, FlaskConical, Loader2, Pencil, Pill, Printer, Stethoscope, Syringe, Timer, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Companion } from './companion';
import { DictateButton } from './dictation';
import { ExamChips } from './exam-chips';
import { QuickDiagnoses } from './quick-diagnoses';
import { QuickVitals } from './quick-vitals';
import { useDoneLines } from './use-done-lines';
import { usePatientContext } from './use-patient-context';
import { useQuickNote } from './use-quick-note';
import { VisitMore } from './visit-more';
import { ClinicalRecordView, OwnerSummary, type VisitDoc } from './visit-documents';
import { answersToText, reasonIcon, useVisitReasons, type VisitReason } from './visit-reasons';
import type { ClinicHeader } from '../billing/invoice-document';
import { vitalsText } from '../clinical/note-editor';
import { HistoryFromRecords } from '../clinical/history-from-records';
import { AdministrationsPanel, LabOrdersPanel, PrescriptionsPanel, WithdrawalBanner } from '../clinical/orders-panels';
import { PatientHistoryDialog } from '../clinical/patient-history';
import { VisitOutcome, type OutcomeState } from '../clinical/visit-outcome';
import { ErrorState, LoadingRows } from '../page';
import { PatientBanner } from '../patients/patient-banner';
import { BookingDialog } from '../scheduling/booking-dialog';
import { Button } from '../ui/button';
import { Input, Textarea } from '../ui/input';
import { useAppointmentTypes } from '@/hooks/use-catalog';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { branchTime, shiftDate, todayIn } from '@/lib/time';
import type { Appointment, Encounter } from '@/lib/types';
import { cn } from '@/lib/utils';

/* ───────────────────────── The visit, in the order the vet runs it ───────────────────────── */

const STEPS = [
  { short: 'Reason', title: (n: string) => `Why is ${n} here today?`, hint: 'Choose the closest reason. It decides which questions follow.' },
  { short: 'History', title: (n: string) => `Ask the owner about ${n}`, hint: 'Ask each question and tap the answer. The history is written for you.' },
  { short: 'Measurements', title: (n: string) => `Measure ${n}`, hint: 'Enter what you measured and press Enter. Leave out what you didn’t.' },
  { short: 'Examination', title: (n: string) => `Examine ${n}`, hint: 'One tap if everything is normal. Then tap only what isn’t.' },
  { short: 'Diagnosis', title: () => 'What is your diagnosis?', hint: 'Tap a suggestion or type your own. Tap its label to say how sure you are.' },
  { short: 'Treatment', title: (n: string) => `Treatment for ${n}`, hint: 'Everything you give, prescribe or test is added to the plan automatically.' },
  { short: 'Owner advice', title: () => 'Advice for the owner', hint: 'Tap the advice you gave and decide on the next visit.' },
  { short: 'Review & sign', title: () => 'Review and sign', hint: 'The complete record and the owner’s summary. Change anything, then sign.' },
] as const;
const LAST = STEPS.length - 1;
const TARGET_MINUTES = 10;
const RECHECK = [
  { label: '3 days', days: 3 },
  { label: '1 week', days: 7 },
  { label: '2 weeks', days: 14 },
  { label: '1 month', days: 30 },
];
const SURE: Record<string, string> = { CONFIRMED: 'sure', PROVISIONAL: 'likely', DIFFERENTIAL: 'possible' };

/** What the vet has chosen so far. Kept on this computer per visit, so a refresh or an interruption loses nothing. */
interface Flow {
  step: number;
  reasonId: string | null;
  reasonText: string;
  answers: Record<string, string[]>;
  ownerExtra: string;
  examExtra: string;
  assessExtra: string;
  planExtra: string;
  nothingToday: boolean;
  advice: string[];
  adviceExtra: string;
  noRecheck: boolean;
}

const storeKey = (id: string) => `vcms.quick-consult.${id}`;
function loadFlow(id: string): Partial<Flow> | null {
  try {
    const raw = localStorage.getItem(storeKey(id));
    return raw ? (JSON.parse(raw) as Partial<Flow>) : null;
  } catch {
    return null;
  }
}
function saveFlow(id: string, f: Flow) {
  try {
    localStorage.setItem(storeKey(id), JSON.stringify(f));
  } catch {
    /* storage unavailable: the note itself is still saved on the server */
  }
}
function clearFlow(id: string) {
  try {
    localStorage.removeItem(storeKey(id));
  } catch {
    /* ignore */
  }
}

const joinText = (...parts: string[]) => parts.map((p) => p.trim()).filter(Boolean).join('\n');
const sentence = (s: string) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);
const words = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

function useElapsed(startedAt: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(t);
  }, []);
  return Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 60_000));
}

/* ───────────────────────── Building blocks ───────────────────────── */

/** A large answer button: easy to hit on a tablet, clearly on or off. */
function Choice({ on, onClick, children, className }: { on: boolean; onClick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border px-4 py-2 text-[15px] font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98]',
        on ? 'border-primary bg-primary text-primary-foreground shadow-sm' : 'border-border bg-background text-foreground hover:border-primary/50 hover:bg-primary/5',
        className,
      )}
    >
      {on && <Check className="h-4 w-4" />}
      {children}
    </button>
  );
}

/** Optional words, typed or spoken. */
function Extra({ id, label, value, onChange, placeholder, rows = 2 }: { id: string; label: string; value: string; onChange: (v: string) => void; placeholder: string; rows?: number }) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="text-sm font-medium">
          {label} <span className="font-normal text-muted-foreground">· optional</span>
        </label>
        <div className="ml-auto">
          <DictateButton label={label} onText={(t) => onChange(value.trim() ? `${value.trimEnd()} ${t}` : t)} />
        </div>
      </div>
      <Textarea id={id} rows={rows} className="text-[15px]" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/** The sentences the taps produce, shown as they will appear in the record. */
function WillWrite({ text, label = 'In the record' }: { text: string; label?: string }) {
  if (!text.trim()) return null;
  return (
    <div className="rounded-lg border-l-4 border-success bg-success/5 px-4 py-3">
      <span className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-success">
        <FileText className="h-3.5 w-3.5" /> {label}
      </span>
      <p className="whitespace-pre-line text-[15px] leading-relaxed">{text}</p>
    </div>
  );
}

/* ───────────────────────── The screen ───────────────────────── */

function Visit({ enc, onRefresh }: { enc: Encounter; onRefresh: () => void }) {
  const { can, canAny, session } = useSession();
  const tz = session.branch?.timezone ?? 'UTC';
  const router = useRouter();
  const qc = useQueryClient();
  const types = useAppointmentTypes();
  const org = useQuery({ queryKey: ['organization'], queryFn: () => api.get<ClinicHeader>('/organization'), staleTime: 300_000 });
  const draft = enc.notes.find((n) => (n.status === 'DRAFT' || n.status === 'REVIEWED') && !n.amendsId) ?? null;
  const qn = useQuickNote(enc.id, draft, enc.chiefComplaint);
  const done = useDoneLines(enc.patient.id, enc.id);
  const ctx = usePatientContext(enc.patient.id, enc.id);
  const elapsed = useElapsed(enc.startedAt);
  const name = enc.patient.name;

  // Start where the vet left off; a visit begun in the detailed view keeps everything already written.
  const [flow, setFlow] = useState<Flow>(() => ({
    step: 0,
    reasonId: null,
    reasonText: draft?.presentingComplaint || enc.chiefComplaint || '',
    answers: {},
    ownerExtra: draft?.subjective ?? '',
    examExtra: draft?.objective ?? '',
    assessExtra: draft?.assessment ?? '',
    planExtra: draft?.plan ?? '',
    nothingToday: false,
    advice: [],
    adviceExtra: draft?.followUpInstructions ?? '',
    noRecheck: false,
    ...loadFlow(enc.id),
  }));
  const patch = (p: Partial<Flow>) => setFlow((f) => ({ ...f, ...p }));
  useEffect(() => saveFlow(enc.id, flow), [enc.id, flow]);
  const visitReasons = useVisitReasons(enc.patient.species.category);
  const reason = visitReasons.reasons.find((r) => r.id === flow.reasonId) ?? null;
  const step = flow.step;
  const go = (s: number) => {
    patch({ step: Math.max(0, Math.min(LAST, s)) });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  /* The note is written from the taps: each part = what the taps say + the vet's own words. */
  const ownerText = reason ? answersToText(reason, flow.answers) : '';
  const planLines = useMemo(() => {
    const own = flow.planExtra.split('\n').filter((l) => l.trim() && !done.lines.includes(l.trim()) && l.trim() !== 'No treatment needed today.');
    return [...done.lines, ...(flow.nothingToday ? ['No treatment needed today.'] : []), ...own];
  }, [done.lines, flow.planExtra, flow.nothingToday]);
  const adviceText = flow.advice.map(sentence).join(' ');
  const composed = {
    presentingComplaint: [reason?.complaint, reason && flow.reasonText.trim() === reason.complaint ? '' : flow.reasonText].map((s) => (s ?? '').trim()).filter(Boolean).join(': '),
    subjective: joinText(ownerText, flow.ownerExtra),
    objective: flow.examExtra.trim(),
    assessment: flow.assessExtra.trim(),
    plan: planLines.join('\n'),
    followUpInstructions: joinText(adviceText, flow.adviceExtra),
  };
  const composedKey = JSON.stringify(composed);
  useEffect(() => {
    const n = qn.note;
    const changed = (Object.keys(composed) as (keyof typeof composed)[]).some((k) => (n[k] ?? '') !== composed[k]);
    if (changed) qn.update(composed);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- written whenever what the taps produce changes
  }, [composedKey]);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [rxOpen, setRxOpen] = useState(false);
  const [giveOpen, setGiveOpen] = useState(false);
  const [labOpen, setLabOpen] = useState(false);
  const [admitOpen, setAdmitOpen] = useState(false);
  const [surgeryOpen, setSurgeryOpen] = useState(false);
  const [referOpen, setReferOpen] = useState(false);
  const [outcome, setOutcome] = useState<OutcomeState>({ admitted: false, surgeries: 0, referred: 0 });
  const [bookOpen, setBookOpen] = useState(false);
  const [bookDays, setBookDays] = useState(7);
  const [booked, setBooked] = useState<Appointment | null>(null);
  const [showReasoning, setShowReasoning] = useState(!!flow.assessExtra);
  const [doc, setDoc] = useState<'record' | 'owner'>('record');

  const pickReason = (r: VisitReason) => {
    // The template's own note text fills only boxes that are still empty; the owner's words are kept.
    const t = r.template;
    setFlow((f) => ({
      ...f,
      reasonId: r.id,
      step: 1,
      ownerExtra: f.ownerExtra || t.subjective || '',
      examExtra: f.examExtra || t.objective || '',
      assessExtra: f.assessExtra || t.assessment || '',
      planExtra: f.planExtra || t.plan || '',
    }));
    if (t.assessment) setShowReasoning(true);
    qn.update({ templateId: t.id });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const answer = (qid: string, label: string, multi?: boolean) =>
    setFlow((f) => {
      const cur = f.answers[qid] ?? [];
      const next = multi ? (cur.includes(label) ? cur.filter((x) => x !== label) : [...cur, label]) : cur[0] === label ? [] : [label];
      return { ...f, answers: { ...f.answers, [qid]: next } };
    });

  const finish = useMutation({
    mutationFn: async (sign: boolean) => {
      await qn.flush();
      if (sign && can('clinical.sign')) {
        const fresh = await api.get<Encounter>(`/encounters/${enc.id}`);
        for (const n of fresh.notes.filter((x) => (x.status === 'DRAFT' || x.status === 'REVIEWED') && x.authorId === session.user.id)) await api.post(`/notes/${n.id}/sign`);
      }
      return api.post<{ unsignedNotes: number }>(`/encounters/${enc.id}/complete`);
    },
    onSuccess: (r) => {
      clearFlow(enc.id);
      const mins = Math.max(1, Math.round((Date.now() - new Date(enc.startedAt).getTime()) / 60_000));
      toast.success(`${name}’s consultation is complete — ${mins} min${r.unsignedNotes ? ` (${r.unsignedNotes} note${r.unsignedNotes === 1 ? '' : 's'} still to sign)` : ''}`);
      qc.invalidateQueries({ queryKey: ['queue'] });
      qc.invalidateQueries({ queryKey: ['charges'] });
      qc.invalidateQueries({ queryKey: ['encounter', enc.id] });
      router.push(`/consultations/${enc.id}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ⌘/Ctrl+Enter: next step (on the last step: sign).
  const keyRef = useRef(() => {});
  keyRef.current = () => (step === LAST ? (can('clinical.sign') ? finish.mutate(true) : undefined) : go(step + 1));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        keyRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* Derived views of the visit. */
  const shownDx = enc.diagnoses.filter((d) => d.status !== 'RULED_OUT');
  const findings = qn.note.examFindings;
  const abnormal = findings.filter((f) => f.status === 'ABNORMAL');
  const normal = findings.filter((f) => f.status === 'NORMAL');
  const examSummary = findings.length
    ? [
        abnormal.length ? `Abnormal: ${abnormal.map((f) => `${f.system}${f.notes ? ` — ${f.notes}` : ''}`).join('; ')}.` : 'All examined body systems within normal limits.',
        abnormal.length && normal.length ? `Normal: ${normal.map((f) => f.system).join(', ')}.` : '',
      ]
        .filter(Boolean)
        .join('\n')
    : '';
  const measurements = enc.vitals[0] ? vitalsText(enc.vitals[0]) : '';
  const nextVisit = booked ? `${branchTime(booked.startsAt, tz, 'EEEE d MMMM')} at ${branchTime(booked.startsAt, tz)}${booked.clinician ? ` with ${booked.clinician.name}` : ''}` : null;
  const stepDone = [!!reason, !!composed.subjective, enc.vitals.length > 0, findings.length > 0 || !!flow.examExtra.trim(), shownDx.length > 0, planLines.length > 0, !!composed.followUpInstructions && (!!booked || flow.noRecheck), false];
  const followUpType = types.data?.find((t) => t.category === 'FOLLOW_UP' && t.isActive !== false);
  const late = elapsed >= TARGET_MINUTES;
  const wordsWritten = words(ownerText) + words(examSummary) + words(done.lines.join(' ')) + words(adviceText) + words(qn.note.history);

  const visitDoc: VisitDoc = {
    patientName: name,
    species: enc.patient.species.name,
    ownerName: enc.patient.owner?.displayName ?? enc.client.displayName,
    vetName: enc.clinician?.name ?? null,
    date: branchTime(enc.startedAt, tz, 'd MMMM yyyy'),
    encounterNo: enc.encounterNo,
    reason: composed.presentingComplaint,
    history: qn.note.history,
    ownerSays: composed.subjective,
    measurements,
    exam: joinText(examSummary, flow.examExtra),
    diagnoses: shownDx.map((d) => ({ term: d.term, sure: SURE[d.type] ?? d.type.toLowerCase() })),
    reasoning: flow.assessExtra,
    plan: composed.plan,
    givenToday: done.names.given,
    forHome: done.names.forHome,
    tests: done.names.tests,
    advice: composed.followUpInstructions,
    nextVisit,
    healthy: false,
  };
  const checklist = [
    { label: 'Weight recorded', done: enc.vitals.some((v) => v.weightKg != null) },
    { label: 'Examination recorded', done: stepDone[3] },
    { label: 'Diagnosis recorded', done: shownDx.length > 0 },
    { label: 'Advice for the owner', done: !!composed.followUpInstructions },
    { label: 'Next visit decided', done: !!booked || flow.noRecheck },
  ];

  return (
    <>
      <div className="no-print pb-4">
        {/* Visit bar: who, which visit, how long, saved or not. */}
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <Link href="/quick-consult" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Patients
          </Link>
          <span className="text-muted-foreground">
            {enc.encounterNo} · {enc.clinician?.name ?? 'No vet assigned'}
          </span>
          <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
            {qn.state === 'saving' ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving
              </>
            ) : qn.state === 'error' ? (
              <span className="inline-flex items-center gap-1 text-destructive">
                <CloudOff className="h-3.5 w-3.5" /> Not saved — check the connection
              </span>
            ) : qn.savedAt ? (
              <>
                <Check className="h-3.5 w-3.5 text-success" /> Saved
              </>
            ) : null}
          </span>
          <span className={cn('inline-flex items-center gap-1.5 rounded-pill px-3 py-1 text-xs font-medium', late ? 'bg-warning/15 text-warning' : 'bg-muted text-foreground')} title={`Time since the consultation started (aim for under ${TARGET_MINUTES} minutes)`}>
            <Timer className="h-3.5 w-3.5" /> {elapsed} min
          </span>
          <VisitMore enc={enc} onOpenHistory={() => setHistoryOpen(true)} />
        </div>
        <PatientBanner patient={enc.patient} className="mb-3" />
        <WithdrawalBanner patientId={enc.patient.id} />

        <div className="grid gap-5 lg:grid-cols-[13rem_minmax(0,1fr)] xl:grid-cols-[13rem_minmax(0,1fr)_19rem]">
          {/* Steps: where we are, what is done; any step can be reopened. */}
          <nav aria-label="Consultation steps" className="lg:sticky lg:top-20 lg:self-start">
            <ol className="flex gap-1 overflow-x-auto pb-1 lg:grid lg:overflow-visible lg:pb-0">
              {STEPS.map((s, i) => (
                <li key={s.short} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => go(i)}
                    aria-current={i === step ? 'step' : undefined}
                    className={cn('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors', i === step ? 'bg-primary/10 font-semibold text-primary' : 'text-foreground/80 hover:bg-muted')}
                  >
                    <span
                      className={cn(
                        'grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold',
                        i === step ? 'bg-primary text-primary-foreground' : stepDone[i] ? 'bg-success text-white' : 'border border-border bg-background text-muted-foreground',
                      )}
                    >
                      {stepDone[i] && i !== step ? <Check className="h-3.5 w-3.5" /> : i + 1}
                    </span>
                    <span className="whitespace-nowrap">{s.short}</span>
                  </button>
                </li>
              ))}
            </ol>
          </nav>

          <main className="min-w-0">
            <div className="rounded-2xl surface-flat p-5 shadow-card sm:p-6">
              <header className="mb-5 border-b border-border/60 pb-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                  Step {step + 1} of {STEPS.length}
                </p>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight">{STEPS[step].title(name)}</h1>
                <p className="mt-1 text-[15px] text-muted-foreground">{STEPS[step].hint}</p>
              </header>

              <div className="grid gap-6">
                {/* 1 — Reason */}
                {step === 0 && (
                  <>
                    {visitReasons.isLoading && <LoadingRows rows={3} />}
                    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 2xl:grid-cols-4">
                      {visitReasons.reasons.map((r) => {
                        const Icon = reasonIcon(r.icon);
                        return (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => pickReason(r)}
                          aria-pressed={flow.reasonId === r.id}
                          className={cn(
                            'flex items-center gap-3 rounded-xl border p-3.5 text-left transition-all active:scale-[0.98]',
                            flow.reasonId === r.id ? 'border-primary bg-primary/10 ring-1 ring-primary' : 'border-border bg-background hover:border-primary/50 hover:bg-primary/5',
                          )}
                        >
                          <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-lg', flow.reasonId === r.id ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary')}>
                            <Icon className="h-5 w-5" />
                          </span>
                          <span className="text-[15px] font-medium leading-tight">{r.name}</span>
                        </button>
                        );
                      })}
                    </div>
                    {can('settings.manage') && (
                      <Link href="/settings/templates" className="-mt-3 w-fit text-xs font-medium text-primary hover:underline">
                        Edit these templates and their questions
                      </Link>
                    )}
                    <div className="grid gap-1.5">
                      <label htmlFor="qc-reason" className="text-sm font-medium">
                        In the owner’s words <span className="font-normal text-muted-foreground">· optional</span>
                      </label>
                      <div className="flex gap-2">
                        <Input id="qc-reason" className="h-11 text-[15px]" placeholder="e.g. Vomiting since last night" value={flow.reasonText} onChange={(e) => patch({ reasonText: e.target.value })} />
                        <DictateButton label="reason for visit" onText={(t) => patch({ reasonText: t })} />
                      </div>
                    </div>
                  </>
                )}

                {/* 2 — History */}
                {step === 1 && (
                  <>
                    {!reason ? (
                      <p className="rounded-lg border border-dashed p-4">
                        Choose the reason for the visit first.{' '}
                        <button type="button" className="font-medium text-primary underline" onClick={() => go(0)}>
                          Go back
                        </button>
                      </p>
                    ) : !reason.questions.length ? (
                      <p className="rounded-lg border border-dashed p-4 text-[15px] text-muted-foreground">
                        The “{reason.name}” template has no questions yet — write what the owner tells you below.
                        {can('settings.manage') && (
                          <>
                            {' '}
                            <Link href="/settings/templates" className="font-medium text-primary underline">
                              Add questions to this template
                            </Link>
                          </>
                        )}
                      </p>
                    ) : (
                      <div className="grid divide-y divide-border/60 rounded-xl border">
                        {reason.questions.map((question) => (
                          <div key={question.id} className="grid gap-2.5 p-4 sm:grid-cols-[11rem_minmax(0,1fr)] sm:items-center">
                            <span className="text-[15px] font-medium">
                              {question.ask}
                              {question.multi && <span className="block text-xs font-normal text-muted-foreground">Tap all that apply</span>}
                            </span>
                            <div className="flex flex-wrap gap-2">
                              {question.answers.map((a) => (
                                <Choice key={a.label} on={(flow.answers[question.id] ?? []).includes(a.label)} onClick={() => answer(question.id, a.label, question.multi)}>
                                  {a.label}
                                </Choice>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <Extra id="qc-owner" label="Anything else the owner said" value={flow.ownerExtra} onChange={(v) => patch({ ownerExtra: v })} placeholder="Tap Speak and say it, or type" />
                    <WillWrite text={composed.subjective} />
                  </>
                )}

                {/* 3 — Measurements */}
                {step === 2 && <QuickVitals encounterId={enc.id} vitals={enc.vitals} lastWeightKg={enc.patient.latestWeightKg} editable onSaved={onRefresh} />}

                {/* 4 — Examination */}
                {step === 3 && (
                  <>
                    <ExamChips findings={findings} onChange={(examFindings) => qn.update({ examFindings })} systems={reason?.examSystems} />
                    <Extra id="qc-exam" label="Other findings" value={flow.examExtra} onChange={(v) => patch({ examExtra: v })} placeholder="e.g. Mild tartar on the upper molars" />
                    <WillWrite text={joinText(examSummary, flow.examExtra)} />
                  </>
                )}

                {/* 5 — Diagnosis */}
                {step === 4 && (
                  <>
                    <QuickDiagnoses encounterId={enc.id} patientId={enc.patient.id} diagnoses={enc.diagnoses} editable onSaved={onRefresh} suggestions={reason?.diagnoses} />
                    <div className="flex flex-wrap gap-2">
                      {can('lab.read') && can('lab.order') && (
                        <Button type="button" variant="outline" onClick={() => setLabOpen(true)}>
                          <FlaskConical /> Order a test to confirm
                        </Button>
                      )}
                      {!showReasoning && (
                        <Button type="button" variant="ghost" onClick={() => setShowReasoning(true)}>
                          <Pencil /> Add clinical reasoning
                        </Button>
                      )}
                    </div>
                    {showReasoning && <Extra id="qc-assess" label="Clinical reasoning" value={flow.assessExtra} onChange={(v) => patch({ assessExtra: v })} placeholder="Why you think so, other possible causes" />}
                  </>
                )}

                {/* 6 — Treatment */}
                {step === 5 && (
                  <>
                    <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4">
                      {[
                        canAny('clinical.write', 'hospital.write', 'pharmacy.dispense') && { icon: Syringe, label: 'Give now', sub: 'Injection or tablet in the clinic', count: done.counts.given, onClick: () => setGiveOpen(true) },
                        can('prescriptions.write') && { icon: Pill, label: 'Prescribe', sub: 'Medicine to take home', count: done.counts.prescriptions, onClick: () => setRxOpen(true) },
                        can('lab.read') && can('lab.order') && { icon: FlaskConical, label: 'Order a test', sub: 'Blood, urine, imaging', count: done.counts.tests, onClick: () => setLabOpen(true) },
                        { icon: Ban, label: 'No treatment', sub: 'Advice only today', count: flow.nothingToday ? 1 : 0, onClick: () => patch({ nothingToday: !flow.nothingToday }) },
                      ]
                        .filter((t): t is { icon: typeof Pill; label: string; sub: string; count: number; onClick: () => void } => !!t)
                        .map((t) => (
                          <button
                            key={t.label}
                            type="button"
                            onClick={t.onClick}
                            className={cn('relative flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition-all active:scale-[0.98]', t.count ? 'border-success bg-success/5' : 'border-border bg-background hover:border-primary/50 hover:bg-primary/5')}
                          >
                            <span className={cn('grid h-10 w-10 place-items-center rounded-lg', t.count ? 'bg-success text-white' : 'bg-primary/10 text-primary')}>
                              <t.icon className="h-5 w-5" />
                            </span>
                            <span className="text-[15px] font-semibold leading-tight">{t.label}</span>
                            <span className="text-xs text-muted-foreground">{t.sub}</span>
                            {t.count > 0 && <span className="absolute right-3 top-3 grid h-6 min-w-6 place-items-center rounded-full bg-success px-1.5 text-xs font-bold text-white">{t.label === 'No treatment' ? <Check className="h-3.5 w-3.5" /> : t.count}</span>}
                          </button>
                        ))}
                    </div>
                    <div className="grid gap-3 2xl:grid-cols-3">
                      <AdministrationsPanel patient={enc.patient} encounterId={enc.id} editable dialogOpen={giveOpen} onDialogOpenChange={setGiveOpen} />
                      <PrescriptionsPanel patient={enc.patient} encounterId={enc.id} editable dialogOpen={rxOpen} onDialogOpenChange={setRxOpen} />
                      <LabOrdersPanel patient={enc.patient} encounterId={enc.id} editable dialogOpen={labOpen} onDialogOpenChange={setLabOpen} />
                    </div>
                    <details className="rounded-xl border px-4 py-3" open={outcome.admitted || outcome.surgeries > 0 || outcome.referred > 0 || undefined}>
                      <summary className="cursor-pointer text-[15px] font-medium">Admit, book surgery or refer</summary>
                      <div className="mt-3">
                        <VisitOutcome
                          encounter={enc}
                          admitOpen={admitOpen}
                          onAdmitOpen={setAdmitOpen}
                          surgeryOpen={surgeryOpen}
                          onSurgeryOpen={setSurgeryOpen}
                          referOpen={referOpen}
                          onReferOpen={setReferOpen}
                          onBookFollowUp={can('appointments.write') ? () => setBookOpen(true) : undefined}
                          onState={setOutcome}
                        />
                      </div>
                    </details>
                    <Extra id="qc-plan" label="Anything else in the plan" value={flow.planExtra} onChange={(v) => patch({ planExtra: v })} placeholder="e.g. Dental scale under anaesthetic next month" />
                    <WillWrite text={composed.plan} label="Plan in the record" />
                  </>
                )}

                {/* 7 — Owner advice & next visit */}
                {step === 6 && (
                  <>
                    {reason && reason.advice.length > 0 && (
                      <div className="grid gap-2">
                        <span className="text-[15px] font-medium">What did you advise?</span>
                        <div className="grid gap-2">
                          {reason.advice.map((a) => (
                            <Choice key={a} on={flow.advice.includes(a)} onClick={() => patch({ advice: flow.advice.includes(a) ? flow.advice.filter((x) => x !== a) : [...flow.advice, a] })} className="justify-start text-left">
                              {a}
                            </Choice>
                          ))}
                        </div>
                      </div>
                    )}
                    <Extra id="qc-advice" label="Other advice" value={flow.adviceExtra} onChange={(v) => patch({ adviceExtra: v })} placeholder="In plain words the owner will understand" />
                    {can('appointments.write') && (
                      <div className="grid gap-2">
                        <span className="text-[15px] font-medium">Next visit</span>
                        {booked ? (
                          <p className="flex items-center gap-2 rounded-lg bg-success/10 px-4 py-3 font-medium text-success">
                            <CalendarCheck className="h-5 w-5" /> Booked: {nextVisit}
                          </p>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            <Choice on={flow.noRecheck} onClick={() => patch({ noRecheck: !flow.noRecheck })}>
                              Not needed
                            </Choice>
                            {RECHECK.map((r) => (
                              <Choice
                                key={r.days}
                                on={false}
                                onClick={() => {
                                  patch({ noRecheck: false });
                                  setBookDays(r.days);
                                  setBookOpen(true);
                                }}
                              >
                                In {r.label}
                              </Choice>
                            ))}
                            <Choice on={false} onClick={() => setBookOpen(true)}>
                              <CalendarPlus className="h-4 w-4" /> Choose a date
                            </Choice>
                          </div>
                        )}
                      </div>
                    )}
                    <WillWrite text={composed.followUpInstructions} label="Owner instructions in the record" />
                  </>
                )}

                {/* 8 — Review & sign */}
                {step === LAST && (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <div role="tablist" className="inline-flex rounded-lg border bg-muted/40 p-1">
                        {(
                          [
                            ['record', 'Clinical record', FileText],
                            ['owner', 'Owner’s summary', UserRound],
                          ] as const
                        ).map(([id, label, Icon]) => (
                          <button key={id} type="button" role="tab" aria-selected={doc === id} onClick={() => setDoc(id)} className={cn('inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium', doc === id ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
                            <Icon className="h-4 w-4" /> {label}
                          </button>
                        ))}
                      </div>
                      {doc === 'owner' && (
                        <Button type="button" variant="outline" className="ml-auto" onClick={() => window.print()}>
                          <Printer /> Print for the owner
                        </Button>
                      )}
                    </div>
                    {doc === 'record' ? (
                      <>
                        <ClinicalRecordView d={visitDoc} />
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                          <span className="text-muted-foreground">Change:</span>
                          {STEPS.slice(0, LAST).map((s, i) => (
                            <button key={s.short} type="button" onClick={() => go(i)} className="font-medium text-primary hover:underline">
                              {s.short}
                            </button>
                          ))}
                        </div>
                      </>
                    ) : (
                      <OwnerSummary d={visitDoc} clinic={org.data ?? null} />
                    )}
                    {!shownDx.length && <p className="rounded-lg bg-warning/10 px-4 py-3 text-warning">No diagnosis recorded. You can still sign, but most records have one.</p>}
                    <div className="flex flex-wrap items-center gap-3 border-t border-border/60 pt-5">
                      {can('clinical.sign') && (
                        <Button size="lg" className="h-12 px-8 text-base" loading={finish.isPending && finish.variables === true} onClick={() => finish.mutate(true)}>
                          <CheckCircle2 /> Sign and complete
                        </Button>
                      )}
                      <Button size="lg" variant={can('clinical.sign') ? 'ghost' : 'default'} className="h-12" loading={finish.isPending && finish.variables === false} onClick={() => finish.mutate(false)}>
                        Complete, sign later
                      </Button>
                      <span className="text-xs text-muted-foreground">Signing locks the record. Later changes are added as a dated correction.</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          </main>

          <aside className="lg:col-span-2 xl:sticky xl:top-20 xl:col-span-1 xl:max-h-[calc(100vh-6rem)] xl:self-start xl:overflow-y-auto">
            <Companion step={step} enc={enc} ctx={ctx} reason={reason} wordsWritten={wordsWritten} onOpenHistory={() => setHistoryOpen(true)} checklist={checklist} />
            {/* Fills the past history from the animal's own records (shown in the record). */}
            <div className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-border/70 px-3.5 py-2.5 text-xs text-muted-foreground">
              Past history from the record
              <HistoryFromRecords patientId={enc.patient.id} encounterId={enc.id} history={qn.note.history} onAdd={(t) => qn.append('history', t)} />
            </div>
          </aside>
        </div>

        {/* Back / Next: always in the same place, with the next step named. */}
        <div className="sticky bottom-3 z-30 mt-5 rounded-2xl border bg-background/95 shadow-card backdrop-blur supports-[backdrop-filter]:bg-background/85">
          <div className="flex items-center gap-3 px-4 py-3">
            <Button size="lg" variant="outline" disabled={step === 0} onClick={() => go(step - 1)}>
              <ArrowLeft /> Back
            </Button>
            <div className="hidden flex-1 items-center gap-1 sm:flex" aria-hidden>
              {STEPS.map((s, i) => (
                <span key={s.short} className={cn('h-1.5 flex-1 rounded-full', i === step ? 'bg-primary' : stepDone[i] ? 'bg-success' : 'bg-muted')} />
              ))}
            </div>
            {step < LAST ? (
              <div className="ml-auto flex items-center gap-3">
                <button type="button" onClick={() => go(step + 1)} className="text-sm text-muted-foreground hover:text-foreground hover:underline">
                  Skip
                </button>
                <Button size="lg" className="px-6" onClick={() => go(step + 1)}>
                  {STEPS[step + 1].short} <ArrowRight />
                </Button>
              </div>
            ) : (
              <span className="ml-auto text-xs text-muted-foreground">⌘/Ctrl + Enter to sign</span>
            )}
          </div>
        </div>

        <PatientHistoryDialog patientId={enc.patient.id} patientName={name} currentId={enc.id} open={historyOpen} onOpenChange={setHistoryOpen} />
        <BookingDialog
          open={bookOpen}
          onOpenChange={setBookOpen}
          onBooked={(a) => {
            setBooked(a);
            patch({ noRecheck: false });
            toast.dismiss();
            toast.success(`Next visit booked: ${branchTime(a.startsAt, tz, 'EEE d MMM')}, ${branchTime(a.startsAt, tz)}`);
            qc.invalidateQueries({ queryKey: ['appointments', 'recheck'] });
          }}
          defaults={{
            clinicianId: enc.clinician?.id,
            date: shiftDate(todayIn(tz), bookDays),
            followUpOfId: enc.appointmentId ?? undefined,
            appointmentTypeId: followUpType?.id,
            reason: `Recheck${composed.presentingComplaint ? `: ${composed.presentingComplaint}` : ''}`,
            patient: {
              id: enc.patient.id,
              name,
              patientNo: enc.patient.patientNo,
              species: enc.patient.species,
              owner: enc.patient.owner ? { id: enc.patient.owner.id, displayName: enc.patient.owner.displayName, mobilePhone: enc.patient.owner.mobilePhone ?? null } : null,
              alerts: enc.patient.alerts,
            },
          }}
        />
      </div>

      {/* Printed: only the owner's summary. */}
      <div className="hidden print:block">
        <OwnerSummary d={visitDoc} clinic={org.data ?? null} className="border-0 p-0" />
      </div>
    </>
  );
}

/** Quick consult: the visit as a guided conversation. Finished, cancelled or read-only visits open in the detailed view. */
export function QuickConsult() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['encounter', id], queryFn: () => api.get<Encounter>(`/encounters/${id}`) });

  if (q.isLoading) return <LoadingRows />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const enc = q.data!;
  if (enc.status !== 'OPEN' || !can('clinical.write')) {
    return (
      <div className="mx-auto mt-10 grid max-w-lg gap-4 rounded-2xl surface-flat p-8 text-center shadow-card">
        <Stethoscope className="mx-auto h-10 w-10 text-muted-foreground" />
        <p className="text-lg font-medium">
          {enc.status === 'COMPLETED' ? `${enc.patient.name}’s consultation is complete.` : enc.status === 'CANCELLED' ? 'This consultation was cancelled.' : 'You can view this consultation but not write in it.'}
        </p>
        <div className="flex justify-center gap-2">
          <Button asChild size="lg">
            <Link href={`/consultations/${enc.id}`}>Open it</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/quick-consult">Next patient</Link>
          </Button>
        </div>
      </div>
    );
  }
  return <Visit key={enc.id} enc={enc} onRefresh={() => qc.invalidateQueries({ queryKey: ['encounter', id] })} />;
}
