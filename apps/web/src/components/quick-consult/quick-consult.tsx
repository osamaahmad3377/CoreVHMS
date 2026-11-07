'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Ban, CalendarCheck, CalendarPlus, Check, CheckCircle2, CloudOff, FileText, FlaskConical, Loader2, Pencil, Pill, Printer, Stethoscope, Syringe, Timer, UserRound, X } from 'lucide-react';
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
import { KINDS, PreventivePanel, fetchGrooming, groomingKey, type PreventiveKind } from './preventive-reasons';
import { ReasonPicker } from './reason-picker';
import { answersToText, combineReasons, useVisitReasons, type CareKind, type VisitReason } from './visit-reasons';
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
import type { Appointment, CareItem, Encounter } from '@/lib/types';
import { cn } from '@/lib/utils';

/* ───────────────────────── The visit, in the order the vet runs it ───────────────────────── */

const STEPS = [
  { short: 'Reason', title: (n: string) => `Why is ${n} here today?`, hint: '' },
  { short: 'History', title: (n: string) => `Ask the owner about ${n}`, hint: 'Ask each question and tap the answer. The history is written for you.' },
  { short: 'Measurements', title: (n: string) => `Measure ${n}`, hint: 'Enter what you measured and press Enter. Leave out what you didn’t.' },
  { short: 'Examination', title: (n: string) => `Examine ${n}`, hint: 'One tap if everything is normal. Then tap only what isn’t.' },
  { short: 'Tests & X-rays', title: (n: string) => `Tests and X-rays for ${n}`, hint: 'Order any tests or X-rays before you decide on the diagnosis. Skip if none are needed.' },
  { short: 'Diagnosis', title: () => 'What is your diagnosis?', hint: 'Tap a suggestion or type your own. Tap its label to say how sure you are.' },
  { short: 'Treatment', title: (n: string) => `Treatment for ${n}`, hint: 'Everything you give or prescribe is added to the plan automatically.' },
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
  /** 2 = with the Tests & X-rays step (step numbers after Examination moved up by one). */
  v?: number;
  /** The chosen appointment types, in the order they were tapped (several reasons in one visit). */
  reasonIds: string[];
  /** The category whose appointment types are shown in step 1. */
  category?: string;
  /** Vaccination, deworming and/or grooming chosen as reasons. */
  care: PreventiveKind[];
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
    const f = raw ? (JSON.parse(raw) as Partial<Flow>) : null;
    // Saved before Tests & X-rays was added: the steps after Examination are one further on now.
    if (f && f.v !== 2 && typeof f.step === 'number' && f.step >= 4) f.step += 1;
    return f ? { ...f, v: 2 } : null;
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
/** “a”, “a and b”, “a, b and c”. */
const listOf = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
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
  const [flow, setFlow] = useState<Flow>(() => {
    const saved = loadFlow(enc.id) as (Partial<Flow> & { reasonId?: string | null }) | null;
    const f: Flow = {
    step: 0,
    reasonIds: [],
    care: [],
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
    v: 2,
    ...saved,
    };
    // A visit started before several reasons were possible kept a single one.
    if (!saved?.reasonIds && saved?.reasonId) f.reasonIds = [saved.reasonId];
    return f;
  });
  const patch = (p: Partial<Flow>) => setFlow((f) => ({ ...f, ...p }));
  useEffect(() => saveFlow(enc.id, flow), [enc.id, flow]);
  const visitReasons = useVisitReasons(enc.patient.species.category);
  // (A visit begun before types and templates were one kept template ids.)
  const chosen = flow.reasonIds.map((id) => visitReasons.reasons.find((r) => r.id === id) ?? visitReasons.reasons.find((r) => r.template?.id === id)).filter((r): r is VisitReason => !!r);
  // All chosen templates as one: their questions, exam buttons, diagnoses and advice together.
  const reason = useMemo(() => combineReasons(chosen), [chosen.map((r) => r.id).join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const careNames = flow.care.map((k) => KINDS[k].label);
  const step = flow.step;
  const go = (s: number) => {
    patch({ step: Math.max(0, Math.min(LAST, s)) });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  /* The note is written from the taps: each part = what the taps say + the vet's own words. */
  const ownerText = reason ? answersToText(reason, flow.answers) : '';
  // Grooming done in this visit goes into the plan, like medicines given.
  const grooming = useQuery({ queryKey: groomingKey(enc.id), queryFn: () => fetchGrooming(enc.id), enabled: flow.care.includes('GROOMING') });
  const groomed = flow.care.includes('GROOMING') ? (grooming.data?.added ?? []).map((a) => a.description) : [];
  const doneLines = useMemo(() => [...(groomed.length ? [`Grooming done: ${groomed.join(', ')}`] : []), ...done.lines], [groomed.join(), done.lines]); // eslint-disable-line react-hooks/exhaustive-deps
  const planLines = useMemo(() => {
    const own = flow.planExtra.split('\n').filter((l) => l.trim() && !doneLines.includes(l.trim()) && !l.trim().startsWith('Grooming done:') && l.trim() !== 'No treatment needed today.');
    return [...doneLines, ...(flow.nothingToday ? ['No treatment needed today.'] : []), ...own];
  }, [doneLines, flow.planExtra, flow.nothingToday]);
  const adviceText = flow.advice.map(sentence).join(' ');
  const composed = {
    presentingComplaint: (() => {
      const names = [...careNames, ...chosen.map((r) => r.complaint || r.name)];
      const own = flow.reasonText.trim();
      const extra = own && !names.some((n) => n.toLowerCase() === own.toLowerCase()) && own !== reason?.complaint ? own : '';
      return [names.join(', '), extra].filter(Boolean).join(': ');
    })(),
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

  // Vaccination / deworming / grooming: always on step 1. Vaccination or deworming shows what is due to record (or
  // asks to add it first); grooming shows the clinic's grooming services to tick off.
  const [careAdding, setCareAdding] = useState<PreventiveKind | null>(null);
  const toggleCare = async (k: PreventiveKind) => {
    if (flow.care.includes(k)) return patch({ care: flow.care.filter((x) => x !== k) });
    patch({ care: [...flow.care, k] });
    if (k === 'GROOMING') return;
    const plan = await qc.fetchQuery({ queryKey: ['care-plan', enc.patient.id], queryFn: () => api.get<{ items: CareItem[] }>(`/patients/${enc.patient.id}/care-plan`) });
    if (!plan.items.some((i) => i.kind === k && (i.status === 'DUE' || i.status === 'DEFERRED'))) setCareAdding(k);
  };
  // Vaccination / deworming / grooming on their own: no consultation fee (what is given or done is still charged).
  const preventiveOnly = flow.care.length > 0 && chosen.length === 0;
  useEffect(() => {
    if (visitReasons.isLoading || enc.status !== 'OPEN') return;
    const want = !preventiveOnly;
    if ((enc.chargeConsultation ?? true) === want) return;
    api.patch(`/encounters/${enc.id}`, { chargeConsultation: want }).then(onRefresh, (e: Error) => toast.error(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preventiveOnly, enc.chargeConsultation, visitReasons.isLoading]);

  const pickReason = (r: VisitReason) => {
    // Tap again to take a reason off; what was already written stays.
    if (flow.reasonIds.includes(r.id)) {
      const rest = flow.reasonIds.filter((x) => x !== r.id);
      patch({ reasonIds: rest });
      const next = chosen.find((c) => c.id !== r.id && c.template);
      qn.update({ templateId: next?.template?.id ?? null });
      return;
    }
    // The template's own note text fills only boxes that are still empty; the owner's words are kept.
    const t = r.template;
    setFlow((f) => ({
      ...f,
      reasonIds: [...f.reasonIds, r.id],
      ownerExtra: f.ownerExtra || t?.subjective || '',
      examExtra: f.examExtra || t?.objective || '',
      assessExtra: f.assessExtra || t?.assessment || '',
      planExtra: f.planExtra || t?.plan || '',
    }));
    if (t?.assessment) setShowReasoning(true);
    if (t && !chosen.some((c) => c.template)) qn.update({ templateId: t.id });
  };

  // Step 1: the category, then its appointment types. Nothing is open until a category is tapped
  // (or a booked/chosen type's category); '' means the vet closed it.
  const bookedType = enc.appointment?.appointmentType;
  const openCategory =
    flow.category === ''
      ? undefined
      : visitReasons.categories.find((c) => c.id === flow.category && !c.care) ??
        visitReasons.categories.find((c) => !c.care && chosen.some((r) => r.categoryId === c.id)) ??
        visitReasons.categories.find((c) => !c.care && c.id === bookedType?.categoryId);
  // Tapping the open category again deselects it: it closes and its appointment types come off.
  const tapCategory = (id: string) => {
    if (openCategory?.id !== id) return patch({ category: id });
    const rest = chosen.filter((r) => r.categoryId !== id);
    patch({ category: '', reasonIds: rest.map((r) => r.id) });
    if (rest.length !== chosen.length) qn.update({ templateId: rest.find((r) => r.template)?.template?.id ?? null });
  };
  // A visit from a booking starts with the booked appointment type chosen (once, before anything else is chosen).
  const preselected = useRef(false);
  useEffect(() => {
    if (preselected.current || visitReasons.isLoading || enc.status !== 'OPEN') return;
    preselected.current = true;
    if (flow.reasonIds.length || flow.care.length || !bookedType?.id) return;
    const r = visitReasons.reasons.find((x) => x.id === bookedType.id);
    const care = visitReasons.categories.find((c) => c.id === (r?.categoryId ?? bookedType.categoryId))?.care;
    if (care) patch({ care: [care] });
    else if (r) pickReason(r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitReasons.isLoading]);
  // On a narrow screen the steps scroll sideways: keep the current one in view.
  const stepsRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const ol = stepsRef.current;
    const li = ol?.children[step] as HTMLElement | undefined;
    if (ol && li && ol.scrollWidth > ol.clientWidth) ol.scrollTo({ left: li.offsetLeft - (ol.clientWidth - li.clientWidth) / 2, behavior: 'smooth' });
  }, [step]);
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
  const stepDone = [chosen.length > 0 || flow.care.length > 0, !!composed.subjective, enc.vitals.length > 0, findings.length > 0 || !!flow.examExtra.trim(), done.counts.tests > 0, shownDx.length > 0, planLines.length > 0, !!composed.followUpInstructions && (!!booked || flow.noRecheck), false];
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

        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[minmax(0,1fr)_19rem]">
          {/* Steps, across the top: where we are, what is done; any step can be reopened. */}
          <nav aria-label="Consultation steps" className="min-w-0 rounded-xl border border-border/70 bg-background/80 p-1.5 shadow-sm xl:col-span-2">
            <ol ref={stepsRef} className="relative flex items-start gap-1 overflow-x-auto [scrollbar-width:none] lg:justify-between 2xl:justify-start">
              {STEPS.map((s, i) => (
                <li key={s.short} className="flex items-start gap-1 2xl:flex-1 2xl:last:flex-none">
                  <button
                    type="button"
                    onClick={() => go(i)}
                    aria-current={i === step ? 'step' : undefined}
                    className={cn('flex shrink-0 flex-col items-center gap-1 rounded-lg px-2 py-1.5 text-xs transition-colors', i === step ? 'bg-primary/10 font-semibold text-primary' : 'text-foreground/80 hover:bg-muted')}
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
                  {i < STEPS.length - 1 && <span aria-hidden className={cn('mt-[18px] hidden h-px min-w-3 flex-1 2xl:block', stepDone[i] ? 'bg-success/50' : 'bg-border')} />}
                </li>
              ))}
            </ol>
          </nav>

          <main className="min-w-0">
            <div className="rounded-2xl surface-flat p-5 shadow-card sm:p-6">
              <header className="mb-5">
                <h1 className="text-xl font-semibold tracking-tight">{STEPS[step].title(name)}</h1>
                {STEPS[step].hint && <p className="mt-1 text-sm text-muted-foreground">{STEPS[step].hint}</p>}
              </header>

              <div className={cn('grid', step === 0 ? 'gap-5' : 'gap-6')}>
                {/* 1 — Reason */}
                {step === 0 && (
                  <>
                    {visitReasons.isLoading && <LoadingRows rows={3} />}
                    <ReasonPicker
                      categories={visitReasons.categories}
                      reasons={visitReasons.reasons}
                      chosenIds={flow.reasonIds}
                      care={flow.care.filter((k): k is CareKind => k === 'VACCINATION' || k === 'DEWORMING' || k === 'GROOMING')}
                      openCategoryId={openCategory?.id}
                      onTapCategory={tapCategory}
                      onToggleCare={(k) => void toggleCare(k)}
                      onPickReason={pickReason}
                      editHref={can('settings.manage') ? '/settings/appointment-types' : undefined}
                    />
                    {(flow.care.length > 0 || chosen.length > 0) && (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg bg-muted/40 px-3 py-2" aria-live="polite">
                        <h2 className="text-sm font-medium text-muted-foreground">Selected</h2>
                        <ul className="flex flex-1 flex-wrap gap-1.5" aria-label="Selected reasons">
                          {[
                            ...flow.care.map((k, i) => ({ key: k, name: careNames[i], remove: () => void toggleCare(k) })),
                            ...chosen.map((r) => ({ key: r.id, name: r.name, remove: () => pickReason(r) })),
                          ].map((x) => (
                            <li key={x.key} className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background pl-2.5 pr-1 text-sm font-medium">
                              {x.name}
                              <button type="button" aria-label={`Remove ${x.name}`} onClick={x.remove} className="grid h-5 w-5 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground">
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </li>
                          ))}
                        </ul>
                        <span className={cn('text-xs', preventiveOnly ? 'font-medium text-success' : 'text-muted-foreground')}>
                          {preventiveOnly ? `No consultation fee — only the ${listOf(careNames.map((n) => n.toLowerCase()))} is charged.` : 'The consultation fee applies.'}
                        </span>
                      </div>
                    )}
                    {flow.care.map((k) => (
                      <PreventivePanel key={k} kind={k} enc={enc} adding={careAdding === k} onAddingChange={(o) => setCareAdding(o ? k : null)} />
                    ))}
                    <div className="grid gap-1.5">
                      <label htmlFor="qc-reason" className="text-sm font-medium text-muted-foreground">
                        In the owner’s words <span className="font-normal">· optional</span>
                      </label>
                      <div className="flex gap-2">
                        <Input id="qc-reason" className="h-10 text-sm" placeholder="e.g. Vomiting since last night" value={flow.reasonText} onChange={(e) => patch({ reasonText: e.target.value })} />
                        <DictateButton label="reason for visit" onText={(t) => patch({ reasonText: t })} />
                      </div>
                    </div>
                  </>
                )}

                {/* 2 — History */}
                {step === 1 && (
                  <>
                    {!reason && flow.care.length > 0 ? (
                      <p className="rounded-lg border border-dashed p-4 text-[15px] text-muted-foreground">
                        {listOf(careNames)} — no questions to ask. Write anything the owner tells you below.
                      </p>
                    ) : !reason ? (
                      <p className="rounded-lg border border-dashed p-4">
                        Choose the reason for the visit first.{' '}
                        <button type="button" className="font-medium text-primary underline" onClick={() => go(0)}>
                          Go back
                        </button>
                      </p>
                    ) : !reason.questions.length ? (
                      <p className="rounded-lg border border-dashed p-4 text-[15px] text-muted-foreground">
                        “{reason.name}” has no questions yet — write what the owner tells you below.
                        {can('settings.manage') && (
                          <>
                            {' '}
                            <Link href={reason.template ? `/settings/templates?id=${reason.template.id}` : '/settings/appointment-types'} className="font-medium text-primary underline">
                              Add questions to this appointment type
                            </Link>
                          </>
                        )}
                      </p>
                    ) : (
                      <div className="grid gap-4">
                      {(chosen.length > 1 ? chosen : [reason]).map((group) => {
                        // A question two templates both ask is shown once, under the first.
                        const qs = group.questions.filter((q) => reason.questions.some((x) => x.id === q.id));
                        if (!qs.length) return null;
                        return (
                      <section key={group.id} aria-label={group.name} className="grid gap-2">
                        {chosen.length > 1 && <h3 className="text-sm font-semibold text-muted-foreground">{group.name}</h3>}
                      <div className="grid divide-y divide-border/60 rounded-xl border">
                        {qs.map((question) => (
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
                      </section>
                        );
                      })}
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

                {/* 5 — Tests & X-rays: ordered before the diagnosis; results come back to this visit. */}
                {step === 4 &&
                  (can('lab.read') ? (
                    <LabOrdersPanel patient={enc.patient} encounterId={enc.id} editable={can('lab.order')} dialogOpen={labOpen} onDialogOpenChange={setLabOpen} />
                  ) : (
                    <p className="rounded-lg bg-muted/40 px-4 py-3 text-sm text-muted-foreground">You can’t see or order tests. Skip this step.</p>
                  ))}

                {/* 6 — Diagnosis */}
                {step === 5 && (
                  <>
                    <QuickDiagnoses encounterId={enc.id} patientId={enc.patient.id} diagnoses={enc.diagnoses} editable onSaved={onRefresh} suggestions={reason?.diagnoses} />
                    {!showReasoning && (
                      <Button type="button" variant="ghost" className="w-fit" onClick={() => setShowReasoning(true)}>
                        <Pencil /> Add clinical reasoning
                      </Button>
                    )}
                    {showReasoning && <Extra id="qc-assess" label="Clinical reasoning" value={flow.assessExtra} onChange={(v) => patch({ assessExtra: v })} placeholder="Why you think so, other possible causes" />}
                  </>
                )}

                {/* 7 — Treatment */}
                {step === 6 && (
                  <>
                    <div className="grid grid-cols-3 gap-2.5">
                      {[
                        canAny('clinical.write', 'hospital.write', 'pharmacy.dispense') && { icon: Syringe, label: 'Give now', sub: 'Injection or tablet in the clinic', count: done.counts.given, onClick: () => setGiveOpen(true) },
                        can('prescriptions.write') && { icon: Pill, label: 'Prescribe', sub: 'Medicine to take home', count: done.counts.prescriptions, onClick: () => setRxOpen(true) },
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
                    <div className="grid gap-3 2xl:grid-cols-2">
                      <AdministrationsPanel patient={enc.patient} encounterId={enc.id} editable dialogOpen={giveOpen} onDialogOpenChange={setGiveOpen} />
                      <PrescriptionsPanel patient={enc.patient} encounterId={enc.id} editable dialogOpen={rxOpen} onDialogOpenChange={setRxOpen} />
                    </div>
                    <section className="grid gap-2" aria-labelledby="qc-next-h">
                      <h2 id="qc-next-h" className="text-sm font-medium text-muted-foreground">
                        Admit, surgery, referral or follow-up
                      </h2>
                      <div>
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
                    </section>
                    <Extra id="qc-plan" label="Anything else in the plan" value={flow.planExtra} onChange={(v) => patch({ planExtra: v })} placeholder="e.g. Dental scale under anaesthetic next month" />
                    <WillWrite text={composed.plan} label="Plan in the record" />
                  </>
                )}

                {/* 8 — Owner advice & next visit */}
                {step === 7 && (
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

                {/* 9 — Review & sign */}
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

          <aside className="xl:sticky xl:top-20 xl:col-span-1 xl:max-h-[calc(100vh-6rem)] xl:self-start xl:overflow-y-auto">
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
