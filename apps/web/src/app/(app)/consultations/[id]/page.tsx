'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { enumLabel, type Paginated } from '@vcms/shared';
import { Activity, AlertTriangle, ArrowRight, BedDouble, CalendarPlus, CheckCircle2, ChevronDown, ClipboardList, FilePlus, FlaskConical, History, Paperclip, Pill, Printer, Receipt, Scissors, Stethoscope, Syringe, Upload, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { ConsultationRecord } from '@/components/clinical/consultation-record';
import { LastVisitStrip, PatientHistoryDialog, useCanSeeHistory } from '@/components/clinical/patient-history';
import { ConsultationCharges } from '@/components/clinical/charges-card';
import { DiagnosesPanel } from '@/components/clinical/diagnoses-panel';
import { FinishConsultationDialog } from '@/components/clinical/finish-dialog';
import { NoteEditor, type WorkflowStep } from '@/components/clinical/note-editor';
import { PastButton, PastRecordsProvider } from '@/components/clinical/past-records';
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useAppointmentTypes } from '@/hooks/use-catalog';
import { api, qs } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useModuleOn, useSession } from '@/lib/session';
import { branchTime, localDate, shiftDate, todayIn } from '@/lib/time';
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
  const [booked, setBooked] = useState<Appointment | null>(null);
  const vitalsRef = useRef<VitalsPanelHandle>(null);
  const org = useQuery({ queryKey: ['organization'], queryFn: () => api.get<ClinicHeader>('/organization'), staleTime: 300_000 });
  const types = useAppointmentTypes();
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
  // An open consultation is run as a guided visit; a finished one is shown as a read-only record.
  const workspace = enc.status === 'OPEN' && writable;
  const draft = drafts.find((d) => !d.amendsId) ?? null;
  const firstTodo = !enc.vitals.length ? 'arrival' : !(draft?.history || draft?.subjective) ? 'history' : !draft?.objective ? 'exam' : !enc.diagnoses.length ? 'diagnosis' : !draft?.plan ? 'treatment' : 'advice';
  const currentStep = step ?? firstTodo;
  /** Opens a step of the visit, then lets the screen draw it before doing something inside it. */
  const goStep = (id: string, then?: () => void) => {
    setStep(id);
    if (then) setTimeout(then, 80);
  };

  const actions = [
    canSeeHistory && { label: 'History', icon: History, onClick: () => { setHistoryVisit(null); setHistoryOpen(true); } },
    writable && { label: 'Vitals', icon: Activity, onClick: () => (workspace ? goStep('arrival', () => vitalsRef.current?.openForm()) : vitalsRef.current?.openForm()) },
    writable && { label: 'Diagnosis', icon: ClipboardList, onClick: () => (workspace ? goStep('diagnosis', () => document.getElementById('diagnosis-term')?.focus()) : scrollTo('diagnoses-card', 'diagnosis-term')) },
    active && can('prescriptions.write') && { label: 'Prescribe', icon: Pill, onClick: () => (workspace ? goStep('treatment', () => setRxOpen(true)) : setRxOpen(true)) },
    active && canAny('clinical.write', 'hospital.write', 'pharmacy.dispense') && { label: 'Give medicine now', icon: Syringe, onClick: () => (workspace ? goStep('treatment', () => setGiveOpen(true)) : setGiveOpen(true)) },
    active && can('lab.read') && can('lab.order') && { label: 'Order test', icon: FlaskConical, onClick: () => (workspace ? goStep('diagnosis', () => setLabOpen(true)) : setLabOpen(true)) },
    workspace && moduleOn('hospital') && can('hospital.write') && { label: 'Admit', icon: BedDouble, onClick: () => goStep('outcome', () => setAdmitOpen(true)) },
    workspace && moduleOn('surgery') && can('surgery.write') && { label: 'Surgery', icon: Scissors, onClick: () => goStep('outcome', () => setSurgeryOpen(true)) },
    active && can('appointments.write') && { label: 'Follow-up', icon: CalendarPlus, onClick: () => setFollowUp(true) },
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
            <details className="rounded-lg border bg-card p-4">
              <summary className="cursor-pointer text-sm font-medium">Previous versions ({superseded.length})</summary>
              <div className="mt-4 grid gap-6">
                {superseded.map((n) => (
                  <NoteView key={n.id} note={n} compact />
                ))}
              </div>
            </details>
          );

  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const workflow: WorkflowStep[] = [
    {
      id: 'arrival',
      title: 'Arrival & vitals',
      hint: 'Why they came, and the measurements taken',
      fields: ['presentingComplaint'],
      extra: (
        <>
          <PastRow><PastButton tab="vitals" label="Past vitals" /></PastRow>
          <VitalsPanel ref={vitalsRef} encounterId={enc.id} vitals={enc.vitals} editable={writable} onSaved={refresh} />
        </>
      ),
      badge: enc.vitals.length ? plural(enc.vitals.length, 'reading') : null,
      done: enc.vitals.length > 0,
      ignoreFieldsForDone: true,
    },
    {
      id: 'history',
      title: 'History',
      hint: 'Past history, and what the client tells you',
      fields: ['history', 'subjective'],
      extra: (
        <>
          <PastRow><PastButton tab="problems" label="Past problems" /></PastRow>
          <ProblemsPanel patientId={enc.patient.id} editable={writable} />
        </>
      ),
    },
    { id: 'exam', title: 'Examination', hint: 'What you find when you examine', fields: ['objective'], exam: true },
    {
      id: 'diagnosis',
      title: 'Diagnosis & tests',
      hint: 'What you think is wrong, and tests to confirm it',
      fields: ['assessment'],
      extra: (
        <>
          <PastRow>
            <PastButton tab="diagnoses" label="Past diagnoses" />
            <PastButton tab="tests" label="Past tests" />
          </PastRow>
          <DiagnosesPanel encounterId={enc.id} diagnoses={enc.diagnoses} editable={writable} onSaved={refresh} />
          <LabOrdersPanel patient={enc.patient} encounterId={enc.id} editable={active} dialogOpen={labOpen} onDialogOpenChange={setLabOpen} />
        </>
      ),
      badge: enc.diagnoses.length ? plural(enc.diagnoses.length, 'diagnosis', 'diagnoses') : null,
      done: enc.diagnoses.length > 0,
    },
    {
      id: 'treatment',
      title: 'Treatment',
      hint: 'Medicine given now, prescriptions, and the plan',
      fields: ['plan'],
      extra: (
        <>
          <PastRow>
            <PastButton tab="medicines" label="Past medicines given" />
            <PastButton tab="prescriptions" label="Past prescriptions" />
          </PastRow>
          <AdministrationsPanel patient={enc.patient} encounterId={enc.id} editable={active} dialogOpen={giveOpen} onDialogOpenChange={setGiveOpen} />
          <PrescriptionsPanel patient={enc.patient} encounterId={enc.id} editable={active} dialogOpen={rxOpen} onDialogOpenChange={setRxOpen} />
        </>
      ),
      badge: hasPrescriptions ? 'Prescribed' : null,
      done: hasPrescriptions,
    },
    {
      id: 'outcome',
      title: 'Next steps',
      hint: 'Admit, operate, refer, book a recheck — or send home',
      extra: (
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
      ),
      badge: outcome.admitted ? 'Admitted' : outcome.surgeries ? 'Surgery booked' : outcome.referred ? 'Referred' : null,
      done: outcome.admitted || outcome.surgeries > 0 || outcome.referred > 0,
    },
    {
      id: 'advice',
      title: 'Advice & follow-up',
      hint: 'What to tell the client, and the next visit',
      fields: ['followUpInstructions'],
      extra: (
        <>
          <PastRow><PastButton tab="documents" label="Past photos & documents" /></PastRow>
          <TasksPanel encounterId={enc.id} patientId={enc.patient.id} tasks={enc.tasks} editable={writable} onSaved={refresh} onBookFollowUp={can('appointments.write') ? () => setFollowUp(true) : undefined} />
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
        </>
      ),
      badge: enc.tasks.length ? plural(enc.tasks.length, 'follow-up') : null,
      done: enc.tasks.length > 0,
    },
    {
      id: 'review',
      title: 'Review & finish',
      hint: 'Check everything, then finish the visit',
      extra: (ctx) => <VisitReview encounter={enc} hasPrescriptions={hasPrescriptions} outcome={outcome} ctx={ctx} onFinish={() => setFinishing(true)} />,
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
      <LastVisitStrip patientId={enc.patient.id} currentId={enc.id} onOpenHistory={(visitId) => { setHistoryVisit(visitId ?? null); setHistoryOpen(true); }} />
      <WithdrawalBanner patientId={enc.patient.id} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold">
          {enumLabel(enc.type)}
          {enc.chiefComplaint && <span className="font-normal text-muted-foreground"> — {enc.chiefComplaint}</span>}
        </h1>
        <Badge variant={enc.status === 'OPEN' ? 'warning' : enc.status === 'COMPLETED' ? 'success' : 'outline'}>{enc.status === 'OPEN' ? 'In progress' : enc.status === 'COMPLETED' ? 'Finished' : enumLabel(enc.status)}</Badge>
        <span className="text-xs text-muted-foreground">
          {enc.encounterNo} · {enc.clinician?.name ?? 'No vet assigned'} · started {fmtDateTime(enc.startedAt)}
          {enc.appointment && ` · ${enc.appointment.appointmentType.name} appointment`}
        </span>
        <div className="ml-auto flex gap-2">
          {enc.status === 'COMPLETED' && (
            <Button size="sm" variant="outline" onClick={() => window.print()}>
              <Printer /> Print consultation
            </Button>
          )}
          {enc.status === 'OPEN' && can('clinical.write') && (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="ghost">
                    More <ChevronDown />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem className="text-destructive" onSelect={() => void cancel()}>
                    <XCircle /> Cancel consultation
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button size="sm" onClick={() => setFinishing(true)}>
                <CheckCircle2 /> Finish consultation
              </Button>
            </>
          )}
        </div>
      </div>

      {actions.length > 0 && (
        <div role="toolbar" aria-label="Consultation actions" className="mb-4 flex flex-wrap gap-1.5 rounded-lg border bg-card p-1.5">
          {actions.map((a) => (
            <Button key={a.label} size="sm" variant="ghost" onClick={a.onClick}>
              <a.icon /> {a.label}
            </Button>
          ))}
        </div>
      )}

      {enc.status === 'COMPLETED' && drafts.length > 0 && (
        <div role="alert" className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-warning/50 bg-warning/10 px-3 py-2 text-sm font-medium">
          <AlertTriangle className="h-4 w-4 text-warning" /> Notes not signed yet
          {can('clinical.sign') && (
            <button type="button" className="text-primary underline" onClick={() => scrollTo(`note-${drafts[0].id}`)}>
              — sign now
            </button>
          )}
        </div>
      )}

      {enc.status === 'COMPLETED' && (
        <NextSteps
          steps={[
            can('billing.write') && { icon: Receipt, title: 'Bill this visit', text: 'Charges from this consultation are ready to invoice', href: `/billing/invoices/new?clientId=${enc.client.id}`, primary: true },
            can('appointments.write') &&
              (recheck
                ? { icon: CheckCircle2, done: true, title: `✔ Recheck booked — ${when(recheck.startsAt, tz).replace(',', '')}`, text: recheck.clinician ? `with ${recheck.clinician.name}` : 'Any free vet', href: `/calendar?date=${localDate(recheck.startsAt, tz)}`, linkLabel: '(change)' }
                : { icon: CalendarPlus, title: 'Book a recheck', text: 'Find a free slot for the follow-up visit', onClick: () => setFollowUp(true) }),
            can('appointments.checkin') ? { icon: ClipboardList, title: 'Back to the waiting list', text: 'See who is next', href: '/front-desk' } : { icon: Stethoscope, title: 'Next consultation', text: 'Open consultations', href: '/consultations' },
          ]}
        />
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
      ) : (
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
          <DiagnosesPanel encounterId={enc.id} diagnoses={enc.diagnoses} editable={writable} onSaved={refresh} />
          <PrescriptionsPanel patient={enc.patient} encounterId={enc.id} editable={active} dialogOpen={rxOpen} onDialogOpenChange={setRxOpen} />
          <AdministrationsPanel patient={enc.patient} encounterId={enc.id} editable={active} dialogOpen={giveOpen} onDialogOpenChange={setGiveOpen} />
          <LabOrdersPanel patient={enc.patient} encounterId={enc.id} editable={active} dialogOpen={labOpen} onDialogOpenChange={setLabOpen} />
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
          date: shiftDate(todayIn(tz), 7),
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

interface Step {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  text: string;
  href?: string;
  onClick?: () => void;
  primary?: boolean;
  /** Already done: shown with a tick and an optional link to change it. */
  done?: boolean;
  linkLabel?: string;
}

/** What to do once a consultation is finished, so the visit flows on to billing and follow-up. */
function NextSteps({ steps }: { steps: (Step | false)[] }) {
  const list = steps.filter(Boolean) as Step[];
  if (!list.length) return null;
  return (
    <section aria-label="Next steps" className="mb-4 rounded-lg border border-success/30 bg-success/5 p-3">
      <p className="mb-2 flex items-center gap-2 text-sm font-medium"><CheckCircle2 className="h-4 w-4 text-success" /> Consultation finished — next steps</p>
      <div className="grid gap-2 sm:grid-cols-3">
        {list.map((st) => {
          if (st.done) {
            return (
              <div key={st.title} className="flex items-center gap-3 rounded-md border border-success/40 bg-card px-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-success">{st.title}</span>
                  <span className="block text-xs text-muted-foreground">
                    {st.text}
                    {st.href && (
                      <>
                        {' '}
                        <Link href={st.href} className="text-primary underline">
                          {st.linkLabel ?? 'change'}
                        </Link>
                      </>
                    )}
                  </span>
                </span>
              </div>
            );
          }
          const inner = (
            <>
              <span className={`rounded-md p-1.5 ${st.primary ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary'}`}><st.icon className="h-4 w-4" /></span>
              <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{st.title}</span><span className="block text-xs text-muted-foreground">{st.text}</span></span>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </>
          );
          const cls = 'flex items-center gap-3 rounded-md border bg-card px-3 py-2.5 text-left shadow-sm transition-colors hover:border-primary/50 hover:bg-primary/5';
          return st.href ? <Link key={st.title} href={st.href} className={cls}>{inner}</Link> : <button key={st.title} type="button" onClick={st.onClick} className={cls}>{inner}</button>;
        })}
      </div>
    </section>
  );
}
