'use client';
import { IssueCertificateDialog } from '@/components/certificates/issue-dialog';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { enumLabel, type Paginated } from '@vcms/shared';
import { FinishedVisitActions } from '@/components/clinical/finished-visit';
import { QuickConsult } from '@/components/quick-consult/quick-consult';
import { Award, Activity, AlertTriangle, MoreHorizontal, BedDouble, CalendarPlus, CheckCircle2, ChevronDown, ClipboardList, FilePlus, FlaskConical, History, Paperclip, Pill, Printer, Scissors, Smile, Syringe, Upload, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { ConsultationRecord } from '@/components/clinical/consultation-record';
import { NewDentalChartDialog } from '@/components/dental/new-chart-dialog';
import { useVisitDental, VisitDentalCard } from '@/components/dental/visit-dental';
import { LastVisitStrip, PatientHistoryDialog, useCanSeeHistory } from '@/components/clinical/patient-history';
import { ConsultationCharges } from '@/components/clinical/charges-card';
import { DiagnosesPanel } from '@/components/clinical/diagnoses-panel';
import { FinishConsultationDialog } from '@/components/clinical/finish-dialog';
import { NoteEditor, type WorkflowStep } from '@/components/clinical/note-editor';
import { PastRecordsProvider } from '@/components/clinical/past-records';
import { HistoryFromRecords } from '@/components/clinical/history-from-records';
import { PlanFromRecords } from '@/components/clinical/plan-from-records';
import { VisitOutcome, type OutcomeState } from '@/components/clinical/visit-outcome';
import { VisitReview } from '@/components/clinical/visit-review';
import { NoteView } from '@/components/clinical/note-view';
import { AdministrationsPanel, LabOrdersPanel, PrescriptionsPanel, WithdrawalBanner } from '@/components/clinical/orders-panels';
import { ProblemsPanel } from '@/components/clinical/problems-panel';
import { TasksPanel } from '@/components/clinical/tasks-panel';
import { VitalsPanel, type VitalsPanelHandle } from '@/components/clinical/vitals-panel';
import { useConfirm } from '@/components/confirm';
import { EmptyState, ErrorState, LoadingRows } from '@/components/page';
import { PatientBanner } from '@/components/patients/patient-banner';
import { RequirePermission } from '@/components/require';
import { BookingDialog } from '@/components/scheduling/booking-dialog';
import { AttachmentsPanel } from '@/components/shared/attachments-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useAppointmentTypes } from '@/hooks/use-catalog';
import { api, qs } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useModuleOn, useSession } from '@/lib/session';
import { branchTime, shiftDate, todayIn } from '@/lib/time';
import type { ClinicHeader } from '@/components/billing/invoice-document';
import type { Appointment, ClinicalNote, Encounter, Prescription } from '@/lib/types';

/** "Sat 24 Oct, 10:30" in the branch's time zone. */
const when = (iso: string, tz: string) => `${branchTime(iso, tz, 'EEE d MMM')}, ${branchTime(iso, tz)}`;

const scrollTo = (id: string, focusId?: string) => {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (focusId) setTimeout(() => document.getElementById(focusId)?.focus(), 300);
};

/** A right-aligned row of "Past …" buttons at the top of a step. */
function PastRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap justify-end gap-1.5">{children}</div>;
}

function Workspace() {
  const { id } = useParams<{ id: string }>();
  const { can, canAny, session } = useSession();
  const tz = session.branch?.timezone ?? 'UTC';
  const router = useRouter();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const key = ['encounter', id];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<Encounter>(`/encounters/${id}`) });
  const [amending, setAmending] = useState<ClinicalNote | null>(null);
  const [newNote, setNewNote] = useState(false);
  const [followUp, setFollowUp] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyVisit, setHistoryVisit] = useState<string | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [admitOpen, setAdmitOpen] = useState(false);
  const [surgeryOpen, setSurgeryOpen] = useState(false);
  const [referOpen, setReferOpen] = useState(false);
  const [outcome, setOutcome] = useState<OutcomeState>({ admitted: false, surgeries: 0, referred: 0 });
  const moduleOn = useModuleOn();
  const canSeeHistory = useCanSeeHistory();
  const [rxOpen, setRxOpen] = useState(false);
  const [giveOpen, setGiveOpen] = useState(false);
  const [labOpen, setLabOpen] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const [dentalOpen, setDentalOpen] = useState(false);
  const [certificateOpen, setCertificateOpen] = useState(false);
  const [booked, setBooked] = useState<Appointment | null>(null);
  // A finished visit shows three next steps; the full record opens on request.
  const [details, setDetails] = useState(false);
  const [nextInDays, setNextInDays] = useState<number | null>(null);
  const vitalsRef = useRef<VitalsPanelHandle>(null);
  const org = useQuery({ queryKey: ['organization'], queryFn: () => api.get<ClinicHeader>('/organization'), staleTime: 300_000 });
  const types = useAppointmentTypes();
  const visitDental = useVisitDental(id);
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const e = q.data;
  const patientId = e?.patient.id;
  const rx = useQuery({
    queryKey: ['prescriptions', { patientId, encounterId: id }],
    queryFn: () => api.get<Paginated<Prescription>>(`/prescriptions${qs({ patientId, encounterId: id, pageSize: 50 })}`),
    enabled: !!patientId && can('prescriptions.read'),
  });
  // A recheck booked from this consultation (linked to its appointment), so the next step shows it as done.
  const upcoming = useQuery({
    queryKey: ['appointments', 'recheck', patientId, e?.appointmentId],
    queryFn: () => api.get<(Appointment & { followUpOfId?: string | null })[]>(`/appointments${qs({ patientId, from: new Date().toISOString(), to: new Date(Date.now() + 60 * 86400_000).toISOString(), status: 'BOOKED,CONFIRMED' })}`),
    enabled: !!patientId && !!e?.appointmentId && e?.status === 'COMPLETED' && can('appointments.read'),
  });
  const recheck = booked ?? upcoming.data?.find((a) => a.followUpOfId === e?.appointmentId) ?? null;

  const cancel = async () => {
    const r = await confirm({ title: 'Cancel this consultation?', description: 'Only possible while nothing has been signed.', requireReason: true, destructive: true, confirmLabel: 'Cancel consultation', cancelLabel: 'Keep consultation' });
    if (!r.confirmed) return;
    try {
      await api.post(`/encounters/${id}/cancel`, { reason: r.reason });
      toast.success('Consultation cancelled');
      refresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  if (q.isLoading) return <LoadingRows />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const enc = e!;
  // Every open consultation is run in Quick consult; finished, cancelled and read-only ones are shown here.
  if (enc.status === 'OPEN' && can('clinical.write')) return <QuickConsult />;
  const writable = can('clinical.write') && enc.status !== 'CANCELLED';
  const current = enc.notes.filter((n) => n.status !== 'SUPERSEDED');
  const superseded = enc.notes.filter((n) => n.status === 'SUPERSEDED');
  const drafts = current.filter((n) => n.status === 'DRAFT' || n.status === 'REVIEWED');
  const signed = current.filter((n) => n.status === 'SIGNED');
  const amendmentDraftFor = (noteId: string) => drafts.find((d) => d.amendsId === noteId);
  const latestVitals = enc.vitals[0] ?? null;
  const followUpType = types.data?.find((t) => t.category === 'FOLLOW_UP' && t.isActive !== false);
  const hasPrescriptions = (rx.data?.data ?? []).some((p) => p.status !== 'CANCELLED');
  const active = enc.status !== 'CANCELLED';
  const finished = enc.status === 'COMPLETED';
  /** On a finished visit, opens the full details first so the panel the action uses is on screen. */
  const withDetails = (fn: () => void) => () => {
    if (!finished || details) return fn();
    setDetails(true);
    setTimeout(fn, 120);
  };
  // An open consultation is run as a guided visit; a finished one is shown as a read-only record.
  const workspace = enc.status === 'OPEN' && writable;
  const draft = drafts.find((d) => !d.amendsId) ?? null;
  const firstTodo = !enc.vitals.length || !(draft?.history || draft?.subjective) ? 'arrival' : !draft?.objective ? 'exam' : !enc.diagnoses.length ? 'diagnosis' : !draft?.plan ? 'treatment' : 'advice';
  const currentStep = step ?? firstTodo;
  /** Opens a step of the visit, then lets the screen draw it before doing something inside it. */
  const goStep = (id: string, then?: () => void) => {
    setStep(id);
    if (then) setTimeout(then, 80);
  };

  // Dental chart for this visit: open the one in progress (or the only one), otherwise start one linked to the visit.
  const dentalCharts = visitDental.data?.charts ?? [];
  const openDental = () => {
    const target = dentalCharts.find((c) => c.status === 'DRAFT') ?? (!writable ? dentalCharts.at(-1) : undefined);
    if (target) router.push(`/dental/${target.id}`);
    else setDentalOpen(true);
  };

  /** Shown as buttons; everything else goes under More. */
  const PRIMARY_ACTIONS = ['Prescribe', 'Order test', 'Give medicine now', 'Book recheck'];
  const actions = [
    canSeeHistory && { label: 'History', icon: History, onClick: () => { setHistoryVisit(null); setHistoryOpen(true); } },
    writable && { label: 'Vitals', icon: Activity, onClick: () => (workspace ? goStep('arrival', () => vitalsRef.current?.openForm()) : vitalsRef.current?.openForm()) },
    writable && { label: 'Diagnosis', icon: ClipboardList, onClick: () => (workspace ? goStep('diagnosis', () => document.getElementById('diagnosis-term')?.focus()) : scrollTo('diagnoses-card', 'diagnosis-term')) },
    active && can('prescriptions.write') && { label: 'Prescribe', icon: Pill, onClick: () => (workspace ? goStep('treatment', () => setRxOpen(true)) : setRxOpen(true)) },
    active && canAny('clinical.write', 'hospital.write', 'pharmacy.dispense') && { label: 'Give medicine now', icon: Syringe, onClick: () => (workspace ? goStep('treatment', () => setGiveOpen(true)) : setGiveOpen(true)) },
    active && can('lab.read') && can('lab.order') && { label: 'Order test', icon: FlaskConical, onClick: () => (workspace ? goStep('diagnosis', () => setLabOpen(true)) : setLabOpen(true)) },
    workspace && moduleOn('hospital') && can('hospital.write') && { label: 'Admit', icon: BedDouble, onClick: () => goStep('treatment', () => setAdmitOpen(true)) },
    workspace && moduleOn('surgery') && can('surgery.write') && { label: 'Surgery', icon: Scissors, onClick: () => goStep('treatment', () => setSurgeryOpen(true)) },
    active && can('appointments.write') && { label: 'Book recheck', icon: CalendarPlus, onClick: () => setFollowUp(true) },
    moduleOn('dental') && can('clinical.read') && (writable || !!dentalCharts.length) && { label: 'Dental chart', icon: Smile, onClick: openDental },
    can('certificates.issue') && { label: 'Certificate', icon: Award, onClick: () => setCertificateOpen(true) },
    writable && { label: 'Upload', icon: Upload, onClick: () => (workspace ? goStep('advice', () => scrollTo('attachments-card')) : scrollTo('attachments-card')) },
  ].filter(Boolean) as { label: string; icon: React.ComponentType<{ className?: string }>; onClick: () => void }[];

  const signedCards = signed.map((n) => {
            const pendingAmendment = amendmentDraftFor(n.id);
            return (
              <Card key={n.id} id={pendingAmendment ? `note-${pendingAmendment.id}` : undefined}>
                <CardContent className="grid gap-4">
                  <NoteView note={n} onAmend={can('clinical.amend') && !pendingAmendment && amending?.id !== n.id ? () => setAmending(n) : undefined} />
                  {(amending?.id === n.id || pendingAmendment) && (
                    <div className="rounded-md border-2 border-dashed border-warning/50 p-3">
                      <NoteEditor encounterId={enc.id} speciesCategory={enc.patient.species.category} note={pendingAmendment ?? n} amending={!pendingAmendment} onDone={() => setAmending(null)} latestVitals={latestVitals} />
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          });

  const supersededBlock = superseded.length > 0 && (
            <details className="rounded-xl surface-flat p-4">
              <summary className="cursor-pointer text-sm font-medium">Previous versions ({superseded.length})</summary>
              <div className="mt-4 grid gap-6">
                {superseded.map((n) => (
                  <NoteView key={n.id} note={n} compact />
                ))}
              </div>
            </details>
          );

  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  // Five steps, in the order a vet works. Each thing is recorded once, in the step where it happens.
  const workflow: WorkflowStep[] = [
    {
      id: 'arrival',
      title: 'Arrival & history',
      hint: 'Why they came, the measurements, and what the owner tells you',
      past: 'vitals',
      // The measurements come first (the nurse or vet takes them at the door); the story is written below them.
      lead: <VitalsPanel ref={vitalsRef} encounterId={enc.id} vitals={enc.vitals} editable={writable} onSaved={refresh} />,
      // Beside "Past history": fills it from the animal's own records.
      fieldActions: {
        history: (ctx) => writable && <HistoryFromRecords patientId={enc.patient.id} encounterId={enc.id} history={ctx.content.history ?? ''} onAdd={(text) => ctx.append('history', text)} />,
      },
      fields: ['presentingComplaint', 'history', 'subjective'],
      extra: <ProblemsPanel patientId={enc.patient.id} editable={writable} />,
      badge: enc.vitals.length ? plural(enc.vitals.length, 'reading') : null,
      done: enc.vitals.length > 0,
      ignoreFieldsForDone: true,
    },
    { id: 'exam', title: 'Examination', hint: 'What you find when you examine', fields: ['objective'], exam: true },
    {
      id: 'diagnosis',
      title: 'Tests & diagnosis',
      hint: 'Order tests first, then record what you think is wrong',
      past: 'diagnoses',
      // Tests come first: the vet orders them, then writes the assessment and diagnoses with the results in view.
      lead: (
        <>
          <LabOrdersPanel patient={enc.patient} encounterId={enc.id} editable={active} dialogOpen={labOpen} onDialogOpenChange={setLabOpen} />
          <VisitDentalCard encounterId={enc.id} editable={writable} onStart={() => setDentalOpen(true)} />
        </>
      ),
      fields: ['assessment'],
      extra: <DiagnosesPanel encounterId={enc.id} diagnoses={enc.diagnoses} editable={writable} onSaved={refresh} />,
      badge: enc.diagnoses.length ? plural(enc.diagnoses.length, 'diagnosis', 'diagnoses') : null,
      done: enc.diagnoses.length > 0,
    },
    {
      id: 'treatment',
      title: 'Treatment & next steps',
      hint: 'Medicine, prescriptions, the plan — and whether they go home, are admitted, operated or referred',
      past: 'medicines',
      fields: ['plan'],
      extra: (ctx) => (
        <>
          <PlanFromRecords patientId={enc.patient.id} encounterId={enc.id} plan={ctx.content.plan ?? ''} onAdd={(text) => ctx.append('plan', text)} />
          <AdministrationsPanel patient={enc.patient} encounterId={enc.id} editable={active} dialogOpen={giveOpen} onDialogOpenChange={setGiveOpen} />
          <PrescriptionsPanel patient={enc.patient} encounterId={enc.id} editable={active} dialogOpen={rxOpen} onDialogOpenChange={setRxOpen} />
          <VisitOutcome
            encounter={enc}
            admitOpen={admitOpen}
            onAdmitOpen={setAdmitOpen}
            surgeryOpen={surgeryOpen}
            onSurgeryOpen={setSurgeryOpen}
            referOpen={referOpen}
            onReferOpen={setReferOpen}
            onBookFollowUp={can('appointments.write') ? () => setFollowUp(true) : undefined}
            onState={setOutcome}
          />
        </>
      ),
      badge: outcome.admitted ? 'Admitted' : outcome.surgeries ? 'Surgery booked' : outcome.referred ? 'Referred' : hasPrescriptions ? 'Prescribed' : null,
      done: hasPrescriptions || outcome.admitted || outcome.surgeries > 0 || outcome.referred > 0,
    },
    {
      id: 'advice',
      title: 'Advice & finish',
      hint: 'What to tell the owner, then check everything and finish',
      past: 'documents',
      fields: ['followUpInstructions'],
      extra: (ctx) => (
        <>
          {/* The recheck is booked in the previous step; here are only the reminders and files. */}
          <TasksPanel encounterId={enc.id} patientId={enc.patient.id} tasks={enc.tasks} editable={writable} onSaved={refresh} />
          <Card id="attachments-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Paperclip className="h-4 w-4 text-muted-foreground" /> Photos & documents
              </CardTitle>
            </CardHeader>
            <CardContent>
              <AttachmentsPanel entityType="Encounter" entityId={enc.id} canWrite={writable} />
            </CardContent>
          </Card>
          <VisitReview encounter={enc} hasPrescriptions={hasPrescriptions} outcome={outcome} ctx={ctx} onFinish={() => setFinishing(true)} />
        </>
      ),
      badge: enc.tasks.length ? plural(enc.tasks.length, 'follow-up') : null,
      done: enc.tasks.length > 0,
    },
  ];

  return (
    <>
      <div className="no-print">
      <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1 text-xs text-muted-foreground">
        <Link href="/consultations" className="hover:text-foreground hover:underline">
          Consultations
        </Link>
        <span>/</span>
        <span>{enc.encounterNo}</span>
      </nav>
      <PatientBanner patient={enc.patient} className="mb-3" />
      {/* Once finished, the page is only about this visit: the previous visit is in Full details → History. */}
      {!finished && <LastVisitStrip patientId={enc.patient.id} currentId={enc.id} onOpenHistory={(visitId) => { setHistoryVisit(visitId ?? null); setHistoryOpen(true); }} />}
      <WithdrawalBanner patientId={enc.patient.id} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold">
          {enumLabel(enc.type)}
          {enc.chiefComplaint && <span className="font-normal text-muted-foreground"> — {enc.chiefComplaint}</span>}
        </h1>
        <Badge variant={enc.status === 'OPEN' ? 'warning' : enc.status === 'COMPLETED' ? 'success' : 'outline'}>{enc.status === 'OPEN' ? 'In progress' : enc.status === 'COMPLETED' ? 'Finished' : enumLabel(enc.status)}</Badge>
        <span className="text-xs text-muted-foreground">
          {enc.encounterNo} · {enc.clinician?.name ?? 'No vet assigned'} · {finished ? fmtDateTime(enc.completedAt ?? enc.startedAt) : `started ${fmtDateTime(enc.startedAt)}`}
          {!finished && enc.appointment && ` · ${enc.appointment.appointmentType.name} appointment`}
          {enc.appointment?.location === 'HOME' && ` · home visit${finished ? '' : `: ${enc.appointment.visitAddress ?? ''}`}`}
        </span>
        <div className="ml-auto flex gap-2">
          {finished && actions.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" aria-label="More actions">
                  <MoreHorizontal /> More
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {actions
                  .filter((a) => a.label !== 'Book recheck')
                  .map((a) => (
                    <DropdownMenuItem key={a.label} onSelect={withDetails(a.onClick)}>
                      <a.icon /> {a.label}
                    </DropdownMenuItem>
                  ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {enc.status === 'OPEN' && can('clinical.write') && (
            <>
              {/* Prescribe, order tests and the rest are in the steps below; only the rarely used ones live here. */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" aria-label="More actions">
                    <MoreHorizontal /> More
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  {actions.filter((a) => ['History', 'Dental chart', 'Certificate'].includes(a.label)).map((a) => (
                    <DropdownMenuItem key={a.label} onSelect={a.onClick}>
                      <a.icon /> {a.label}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => void cancel()}>
                    <XCircle /> Cancel consultation
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button onClick={() => setFinishing(true)}>
                <CheckCircle2 /> Finish consultation
              </Button>
            </>
          )}
        </div>
      </div>

      {!workspace && !finished && actions.length > 0 && (
        <div role="toolbar" aria-label="Consultation actions" className="surface mb-6 flex flex-wrap items-center gap-1 rounded-2xl p-1.5">
          {/* The four things vets do most stay in view; the rest are one tap away under More. */}
          {actions.filter((a) => PRIMARY_ACTIONS.includes(a.label)).map((a) => (
            <Button key={a.label} variant="ghost" onClick={a.onClick}>
              <a.icon /> {a.label}
            </Button>
          ))}
          {(actions.some((a) => !PRIMARY_ACTIONS.includes(a.label)) || (enc.status === 'OPEN' && can('clinical.write'))) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost">
                  <MoreHorizontal /> More
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                {actions
                  .filter((a) => !PRIMARY_ACTIONS.includes(a.label))
                  .map((a) => (
                    <DropdownMenuItem key={a.label} onSelect={a.onClick}>
                      <a.icon /> {a.label}
                    </DropdownMenuItem>
                  ))}
                {enc.status === 'OPEN' && can('clinical.write') && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => void cancel()}>
                      <XCircle /> Cancel consultation
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}

      {enc.status === 'COMPLETED' && drafts.length > 0 && (
        <div role="alert" className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-warning/50 bg-warning/10 px-3 py-2 text-sm font-medium">
          <AlertTriangle className="h-4 w-4 text-warning" /> Notes not signed yet
          {can('clinical.sign') && (
            <button type="button" className="text-primary underline" onClick={withDetails(() => scrollTo(`note-${drafts[0].id}`))}>
              — sign now
            </button>
          )}
        </div>
      )}

      {finished && (
        <>
          <FinishedVisitActions
            encounter={enc}
            recheck={recheck}
            recheckWhen={recheck ? when(recheck.startsAt, tz).replace(',', '') : null}
            onViewRecord={() => setRecordOpen(true)}
            onBookNext={
              can('appointments.write')
                ? (days) => {
                    setNextInDays(days);
                    setFollowUp(true);
                  }
                : undefined
            }
          />
          <div className="mb-4 flex justify-center">
            <button type="button" aria-expanded={details} onClick={() => setDetails((d) => !d)} className="flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
              {details ? 'Hide full details' : 'Show full details'}
              <ChevronDown className={`h-4 w-4 transition-transform ${details ? 'rotate-180' : ''}`} />
            </button>
          </div>
        </>
      )}

      {workspace ? (
        <div className="grid min-w-0 grid-cols-1 gap-4 [&>*]:min-w-0">
          {signedCards}
          <PastRecordsProvider patientId={enc.patient.id} patientName={enc.patient.name} encounterId={enc.id}>
          <Card>
            <CardContent className="p-4 sm:p-5">
              <NoteEditor
                key="visit"
                encounterId={enc.id}
                speciesCategory={enc.patient.species.category}
                note={draft}
                chiefComplaint={enc.chiefComplaint}
                latestVitals={latestVitals}
                workflow={workflow}
                stepId={currentStep}
                onStepChange={(id) => setStep(id)}
              />
            </CardContent>
          </Card>
          </PastRecordsProvider>
          {supersededBlock}
        </div>
      ) : (!finished || details) && (
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="grid min-w-0 grid-cols-1 content-start gap-4 [&>*]:min-w-0">
          {drafts
            .filter((d) => !d.amendsId)
            .map((d) => (
              <Card key={d.id} id={`note-${d.id}`}>
                <CardHeader>
                  <CardTitle>Clinical note</CardTitle>
                  <span className="text-xs text-muted-foreground">Written by {d.authorName}</span>
                </CardHeader>
                <CardContent>
                  {writable ? (
                    <NoteEditor encounterId={enc.id} speciesCategory={enc.patient.species.category} note={d} chiefComplaint={enc.chiefComplaint} latestVitals={latestVitals} />
                  ) : (
                    <p className="text-sm text-muted-foreground">Draft in progress.</p>
                  )}
                </CardContent>
              </Card>
            ))}

          {signedCards}

          {(newNote || current.length === 0) && writable && !drafts.some((d) => !d.amendsId) && (
            <Card>
              <CardHeader>
                <CardTitle>New clinical note</CardTitle>
              </CardHeader>
              <CardContent>
                <NoteEditor encounterId={enc.id} speciesCategory={enc.patient.species.category} note={null} onDone={() => setNewNote(false)} chiefComplaint={enc.chiefComplaint} latestVitals={latestVitals} />
              </CardContent>
            </Card>
          )}
          {current.length > 0 && !newNote && writable && !drafts.some((d) => !d.amendsId) && (
            <Button variant="outline" className="w-fit" onClick={() => setNewNote(true)}>
              <FilePlus /> Add another note
            </Button>
          )}
          {!writable && current.length === 0 && <EmptyState title="No clinical notes" />}

          {supersededBlock}
        </div>

        <div className="grid min-w-0 grid-cols-1 content-start gap-4 [&>*]:min-w-0">
          <VitalsPanel ref={vitalsRef} encounterId={enc.id} vitals={enc.vitals} editable={writable} onSaved={refresh} />
          <LabOrdersPanel patient={enc.patient} encounterId={enc.id} editable={active} dialogOpen={labOpen} onDialogOpenChange={setLabOpen} />
          <VisitDentalCard encounterId={enc.id} editable={writable} onStart={() => setDentalOpen(true)} />
          <DiagnosesPanel encounterId={enc.id} diagnoses={enc.diagnoses} editable={writable} onSaved={refresh} />
          <PrescriptionsPanel patient={enc.patient} encounterId={enc.id} editable={active} dialogOpen={rxOpen} onDialogOpenChange={setRxOpen} />
          <AdministrationsPanel patient={enc.patient} encounterId={enc.id} editable={active} dialogOpen={giveOpen} onDialogOpenChange={setGiveOpen} />
          <ConsultationCharges encounterId={enc.id} hasPrescriptions={hasPrescriptions} />
          <ProblemsPanel patientId={enc.patient.id} editable={writable} />
          <TasksPanel
            encounterId={enc.id}
            patientId={enc.patient.id}
            tasks={enc.tasks}
            editable={writable}
            onSaved={refresh}
            onBookFollowUp={can('appointments.write') ? () => setFollowUp(true) : undefined}
          />
          <Card id="attachments-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Paperclip className="h-4 w-4 text-muted-foreground" /> Photos & documents
              </CardTitle>
            </CardHeader>
            <CardContent>
              <AttachmentsPanel entityType="Encounter" entityId={enc.id} canWrite={writable} />
            </CardContent>
          </Card>
        </div>
      </div>
      )}
      {enc.status === 'COMPLETED' && (
        <Dialog open={recordOpen} onOpenChange={setRecordOpen}>
          <DialogContent size="xl" className="bg-muted/60">
            <DialogHeader>
              <DialogTitle>Consultation record — {enc.encounterNo}</DialogTitle>
              <DialogDescription>The clinical record of this visit, ready to print or save as PDF. Charges are on the invoice, not here.</DialogDescription>
            </DialogHeader>
            <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
              <ConsultationRecord encounter={enc} clinic={org.data ?? null} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRecordOpen(false)}>Close</Button>
              <Button
                onClick={() => {
                  // Close the window first so only the record itself goes to the printer.
                  setRecordOpen(false);
                  setTimeout(() => window.print(), 350);
                }}
              >
                <Printer /> Print
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      <NewDentalChartDialog
        patient={{ id: enc.patient.id, name: enc.patient.name, patientNo: enc.patient.patientNo, species: enc.patient.species, ownerName: enc.patient.owner?.displayName ?? null }}
        suggested={visitDental.data?.suggestedDentition ?? null}
        encounterId={enc.id}
        open={dentalOpen}
        onOpenChange={setDentalOpen}
      />
      {certificateOpen && <IssueCertificateDialog open onOpenChange={setCertificateOpen} subject="PATIENT" patient={{ id: enc.patient.id, name: enc.patient.name }} encounterId={enc.id} />}
      <PatientHistoryDialog patientId={enc.patient.id} patientName={enc.patient.name} currentId={enc.id} open={historyOpen} onOpenChange={setHistoryOpen} initialVisitId={historyVisit} />
      <FinishConsultationDialog
        encounter={enc}
        open={finishing}
        onOpenChange={setFinishing}
        onFinished={(r) => {
          toast.success(r.unsignedNotes ? `Consultation finished — ${r.unsignedNotes === 1 ? '1 note still needs' : `${r.unsignedNotes} notes still need`} signing` : 'Consultation finished', {
            action: can('billing.write') ? { label: 'Bill this visit', onClick: () => router.push(`/billing/invoices/new?clientId=${enc.client.id}`) } : undefined,
          });
          refresh();
          qc.invalidateQueries({ queryKey: ['queue'] });
          qc.invalidateQueries({ queryKey: ['charges'] });
        }}
      />
      <BookingDialog
        open={followUp}
        onOpenChange={setFollowUp}
        onBooked={(a) => {
          setBooked(a);
          // Replace the generic booking toast with one that says what was booked.
          toast.dismiss();
          toast.success(`Recheck booked: ${when(a.startsAt, tz)}${a.clinician ? ` with ${a.clinician.name}` : ''}`);
          qc.invalidateQueries({ queryKey: ['appointments', 'recheck'] });
        }}
        defaults={{
          clinicianId: enc.clinician?.id,
          // No recheck interval is configured on templates, so suggest a week from today (branch time).
          date: shiftDate(todayIn(tz), nextInDays ?? 7),
          followUpOfId: enc.appointmentId ?? undefined,
          appointmentTypeId: followUpType?.id,
          reason: `Recheck${enc.chiefComplaint ? `: ${enc.chiefComplaint}` : ''}`,
          patient: {
            id: enc.patient.id,
            name: enc.patient.name,
            patientNo: enc.patient.patientNo,
            species: enc.patient.species,
            owner: enc.patient.owner ? { id: enc.patient.owner.id, displayName: enc.patient.owner.displayName, mobilePhone: enc.patient.owner.mobilePhone ?? null } : null,
            alerts: enc.patient.alerts,
          },
        }}
      />
      </div>
      {enc.status === 'COMPLETED' && (
        <div className="hidden print:block">
          <ConsultationRecord encounter={enc} clinic={org.data ?? null} />
        </div>
      )}
    </>
  );
}

export default function ConsultationPage() {
  return (
    <RequirePermission anyOf={['clinical.read']}>
      <Workspace />
    </RequirePermission>
  );
}
