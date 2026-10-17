'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { enumLabel } from '@vcms/shared';
import { ArrowRight, CalendarPlus, CheckCircle2, ClipboardList, FilePlus, Paperclip, Receipt, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { DiagnosesPanel } from '@/components/clinical/diagnoses-panel';
import { NoteEditor } from '@/components/clinical/note-editor';
import { NoteView } from '@/components/clinical/note-view';
import { AdministrationsPanel, LabOrdersPanel, PrescriptionsPanel, WithdrawalBanner } from '@/components/clinical/orders-panels';
import { ProblemsPanel } from '@/components/clinical/problems-panel';
import { TasksPanel } from '@/components/clinical/tasks-panel';
import { VitalsPanel } from '@/components/clinical/vitals-panel';
import { useConfirm } from '@/components/confirm';
import { EmptyState, ErrorState, LoadingRows } from '@/components/page';
import { PatientBanner } from '@/components/patients/patient-banner';
import { RequirePermission } from '@/components/require';
import { BookingDialog } from '@/components/scheduling/booking-dialog';
import { AttachmentsPanel } from '@/components/shared/attachments-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import { shiftDate, todayIn } from '@/lib/time';
import type { ClinicalNote, Encounter } from '@/lib/types';

function Workspace() {
  const { id } = useParams<{ id: string }>();
  const { can, session } = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const key = ['encounter', id];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<Encounter>(`/encounters/${id}`) });
  const [amending, setAmending] = useState<ClinicalNote | null>(null);
  const [newNote, setNewNote] = useState(false);
  const [followUp, setFollowUp] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: key });

  const close = useMutation({
    mutationFn: () => api.post<{ unsignedNotes: number }>(`/encounters/${id}/complete`),
    onSuccess: (r) => {
      const clientId = q.data?.client.id;
      toast.success(r.unsignedNotes ? `Consultation completed — ${r.unsignedNotes} note(s) still need signing` : 'Consultation completed', {
        action: clientId && can('billing.write') ? { label: 'Bill this visit', onClick: () => router.push(`/billing/invoices/new?clientId=${clientId}`) } : undefined,
      });
      refresh();
      qc.invalidateQueries({ queryKey: ['queue'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const cancel = useMutation({
    mutationFn: (reason: string) => api.post(`/encounters/${id}/cancel`, { reason }),
    onSuccess: () => {
      toast.success('Consultation cancelled');
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isLoading) return <LoadingRows />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const e = q.data!;
  const writable = can('clinical.write') && e.status !== 'CANCELLED';
  const current = e.notes.filter((n) => n.status !== 'SUPERSEDED');
  const superseded = e.notes.filter((n) => n.status === 'SUPERSEDED');
  const drafts = current.filter((n) => n.status === 'DRAFT' || n.status === 'REVIEWED');
  const signed = current.filter((n) => n.status === 'SIGNED');
  const amendmentDraftFor = (noteId: string) => drafts.find((d) => d.amendsId === noteId);

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1 text-xs text-muted-foreground">
        <Link href="/consultations" className="hover:text-foreground hover:underline">
          Consultations
        </Link>
        <span>/</span>
        <span>{e.encounterNo}</span>
      </nav>
      <PatientBanner patient={e.patient} className="mb-3" />
      <WithdrawalBanner patientId={e.patient.id} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold">
          {enumLabel(e.type)}
          {e.chiefComplaint && <span className="font-normal text-muted-foreground"> — {e.chiefComplaint}</span>}
        </h1>
        <Badge variant={e.status === 'OPEN' ? 'warning' : e.status === 'COMPLETED' ? 'success' : 'outline'}>{enumLabel(e.status)}</Badge>
        <span className="text-xs text-muted-foreground">
          {e.encounterNo} · {e.clinician?.name ?? 'No clinician'} · started {fmtDateTime(e.startedAt)}
          {e.appointment && ` · ${e.appointment.appointmentType.name} appointment`}
        </span>
        <div className="ml-auto flex gap-2">
          {e.status === 'OPEN' && can('clinical.write') && (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  const r = await confirm({ title: 'Cancel this consultation?', description: 'Only possible while nothing has been signed.', requireReason: true, destructive: true, confirmLabel: 'Cancel consultation', cancelLabel: 'Keep consultation' });
                  if (r.confirmed) cancel.mutate(r.reason!);
                }}
              >
                <XCircle /> Cancel consultation
              </Button>
              <Button size="sm" loading={close.isPending} onClick={() => close.mutate()}>
                <CheckCircle2 /> Complete consultation
              </Button>
            </>
          )}
        </div>
      </div>

      {e.status === 'COMPLETED' && (
        <NextSteps
          steps={[
            can('billing.write') && { icon: Receipt, title: 'Bill this visit', text: 'Charges from this consultation are ready to invoice', href: `/billing/invoices/new?clientId=${e.client.id}`, primary: true },
            can('appointments.write') && { icon: CalendarPlus, title: 'Book a recheck', text: 'Find a free slot for the follow-up visit', onClick: () => setFollowUp(true) },
            can('appointments.checkin') ? { icon: ClipboardList, title: 'Back to the waiting list', text: 'See who is next', href: '/front-desk' } : { icon: ClipboardList, title: 'Next consultation', text: 'Open consultations', href: '/consultations' },
          ]}
        />
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="grid min-w-0 grid-cols-1 content-start gap-4 [&>*]:min-w-0">
          {drafts
            .filter((d) => !d.amendsId)
            .map((d) => (
              <Card key={d.id}>
                <CardHeader>
                  <CardTitle>Clinical note</CardTitle>
                  <span className="text-xs text-muted-foreground">Drafted by {d.authorName}</span>
                </CardHeader>
                <CardContent>{writable ? <NoteEditor encounterId={e.id} speciesCategory={e.patient.species.category} note={d} /> : <p className="text-sm text-muted-foreground">Draft in progress.</p>}</CardContent>
              </Card>
            ))}

          {signed.map((n) => {
            const pendingAmendment = amendmentDraftFor(n.id);
            return (
              <Card key={n.id}>
                <CardContent className="grid gap-4">
                  <NoteView note={n} onAmend={can('clinical.amend') && !pendingAmendment && amending?.id !== n.id ? () => setAmending(n) : undefined} />
                  {(amending?.id === n.id || pendingAmendment) && (
                    <div className="rounded-md border-2 border-dashed border-warning/50 p-3">
                      <NoteEditor encounterId={e.id} speciesCategory={e.patient.species.category} note={pendingAmendment ?? n} amending={!pendingAmendment} onDone={() => setAmending(null)} />
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}

          {(newNote || current.length === 0) && writable && !drafts.some((d) => !d.amendsId) && (
            <Card>
              <CardHeader>
                <CardTitle>New clinical note</CardTitle>
              </CardHeader>
              <CardContent>
                <NoteEditor encounterId={e.id} speciesCategory={e.patient.species.category} note={null} onDone={() => setNewNote(false)} />
              </CardContent>
            </Card>
          )}
          {current.length > 0 && !newNote && writable && !drafts.some((d) => !d.amendsId) && (
            <Button variant="outline" className="w-fit" onClick={() => setNewNote(true)}>
              <FilePlus /> Add another note
            </Button>
          )}
          {!writable && current.length === 0 && <EmptyState title="No clinical notes" />}

          {superseded.length > 0 && (
            <details className="rounded-lg border bg-card p-4">
              <summary className="cursor-pointer text-sm font-medium">Previous versions ({superseded.length})</summary>
              <div className="mt-4 grid gap-6">
                {superseded.map((n) => (
                  <NoteView key={n.id} note={n} compact />
                ))}
              </div>
            </details>
          )}
        </div>

        <div className="grid min-w-0 grid-cols-1 content-start gap-4 [&>*]:min-w-0">
          <VitalsPanel encounterId={e.id} vitals={e.vitals} editable={writable} onSaved={refresh} />
          <DiagnosesPanel encounterId={e.id} diagnoses={e.diagnoses} editable={writable} onSaved={refresh} />
          <PrescriptionsPanel patient={e.patient} encounterId={e.id} editable={e.status !== 'CANCELLED'} />
          <AdministrationsPanel patient={e.patient} encounterId={e.id} editable={e.status !== 'CANCELLED'} />
          <LabOrdersPanel patient={e.patient} encounterId={e.id} editable={e.status !== 'CANCELLED'} />
          <ProblemsPanel patientId={e.patient.id} editable={writable} />
          <TasksPanel
            encounterId={e.id}
            patientId={e.patient.id}
            tasks={e.tasks}
            editable={writable}
            onSaved={refresh}
            onBookFollowUp={can('appointments.write') ? () => setFollowUp(true) : undefined}
          />
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Paperclip className="h-4 w-4 text-muted-foreground" /> Photos & documents
              </CardTitle>
            </CardHeader>
            <CardContent>
              <AttachmentsPanel entityType="Encounter" entityId={e.id} canWrite={writable} />
            </CardContent>
          </Card>
        </div>
      </div>
      <BookingDialog
        open={followUp}
        onOpenChange={setFollowUp}
        defaults={{
          clinicianId: e.clinician?.id,
          // No recheck interval is configured on templates, so suggest a week from today (branch time).
          date: shiftDate(todayIn(session.branch?.timezone ?? 'UTC'), 7),
          followUpOfId: e.appointmentId ?? undefined,
          reason: `Recheck${e.chiefComplaint ? `: ${e.chiefComplaint}` : ''}`,
          patient: {
            id: e.patient.id,
            name: e.patient.name,
            patientNo: e.patient.patientNo,
            species: e.patient.species,
            owner: e.patient.owner ? { id: e.patient.owner.id, displayName: e.patient.owner.displayName, mobilePhone: e.patient.owner.mobilePhone ?? null } : null,
            alerts: e.patient.alerts,
          },
        }}
      />
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

interface Step { icon: React.ComponentType<{ className?: string }>; title: string; text: string; href?: string; onClick?: () => void; primary?: boolean }

/** What to do once a consultation is finished, so the visit flows on to billing and follow-up. */
function NextSteps({ steps }: { steps: (Step | false)[] }) {
  const list = steps.filter(Boolean) as Step[];
  if (!list.length) return null;
  return (
    <section aria-label="Next steps" className="mb-4 rounded-lg border border-success/30 bg-success/5 p-3">
      <p className="mb-2 flex items-center gap-2 text-sm font-medium"><CheckCircle2 className="h-4 w-4 text-success" /> Consultation completed — next steps</p>
      <div className="grid gap-2 sm:grid-cols-3">
        {list.map((st) => {
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
