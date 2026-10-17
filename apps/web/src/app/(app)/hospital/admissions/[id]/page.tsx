'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CPR_STATUSES, PATIENT_CONDITIONS, enumLabel } from '@vcms/shared';
import { ArrowRight, ArrowRightLeft, BellRing, CalendarPlus, CheckCircle2, LogOut, Printer, Receipt, Scissors, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { ClinicHeader } from '@/components/billing/invoice-document';
import { useConfirm } from '@/components/confirm';
import { ConditionBadge, CprBadge, IsolationBadge } from '@/components/hospital/badges';
import { DischargeDialog, DischargeSummary } from '@/components/hospital/discharge';
import { Observations } from '@/components/hospital/observations';
import { TreatmentSheet } from '@/components/hospital/treatment-sheet';
import { DescriptionList, ErrorState, LoadingRows } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { BookingDialog } from '@/components/scheduling/booking-dialog';
import { AttachmentsPanel } from '@/components/shared/attachments-panel';
import { AlertChip } from '@/components/status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { NativeSelect, Textarea } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, qs } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtWeight } from '@/lib/format';
import { useSession } from '@/lib/session';
import { shiftDate, todayIn } from '@/lib/time';
import type { Admission, AlertSummary, WardRow } from '@/lib/types';
import { cn } from '@/lib/utils';

function MoveDialog({ a, open, onOpenChange }: { a: Admission; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { session } = useSession();
  const [wardId, setWardId] = useState('');
  const [cageId, setCageId] = useState('');
  const wards = useQuery({ queryKey: ['wards', session.branch?.id], queryFn: () => api.get<WardRow[]>(`/wards${qs({ branchId: session.branch?.id })}`), enabled: open });
  const ward = wards.data?.find((w) => w.id === wardId);
  const m = useMutation({
    mutationFn: () => api.post(`/admissions/${a.id}/move`, { wardId, cageId: cageId || null }),
    onSuccess: () => { toast.success('Patient moved'); qc.invalidateQueries({ queryKey: ['admission', a.id] }); qc.invalidateQueries({ queryKey: ['flowboard'] }); onOpenChange(false); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader><DialogTitle>Move {a.patient.name}</DialogTitle></DialogHeader>
        <NativeSelect aria-label="Ward" value={wardId} onChange={(e) => { setWardId(e.target.value); setCageId(''); }}>
          <option value="">Choose ward…</option>
          {(wards.data ?? []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </NativeSelect>
        <NativeSelect aria-label="Cage" value={cageId} disabled={!ward} onChange={(e) => setCageId(e.target.value)}>
          <option value="">No specific cage</option>
          {ward?.cages.filter((c) => !c.occupant || c.occupant.id === a.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </NativeSelect>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!wardId} loading={m.isPending} onClick={() => m.mutate()}>Move</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NotesPanel({ a, active }: { a: Admission; active: boolean }) {
  const qc = useQueryClient();
  const { can } = useSession();
  const [type, setType] = useState<'PROGRESS' | 'HANDOVER'>('PROGRESS');
  const [text, setText] = useState('');
  const m = useMutation({
    mutationFn: () => api.post(`/admissions/${a.id}/notes`, { type, text }),
    onSuccess: () => { setText(''); qc.invalidateQueries({ queryKey: ['admission', a.id] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Card>
      <CardHeader><CardTitle>Progress & handover notes</CardTitle></CardHeader>
      <CardContent className="grid gap-3">
        {active && can('hospital.write') && (
          <div className="grid gap-2">
            <div className="flex gap-1" role="radiogroup">
              {(['PROGRESS', 'HANDOVER'] as const).map((t) => (
                <button key={t} type="button" role="radio" aria-checked={type === t} onClick={() => setType(t)} className={cn('rounded-md px-3 py-1 text-sm', type === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}>
                  {t === 'PROGRESS' ? 'Progress note' : 'Shift handover'}
                </button>
              ))}
            </div>
            <Textarea aria-label="Note" rows={3} value={text} maxLength={5000} placeholder={type === 'HANDOVER' ? 'What the next shift needs to know: concerns, pending results, owner calls…' : 'Clinical progress…'} onChange={(e) => setText(e.target.value)} />
            <div><Button size="sm" disabled={!text.trim()} loading={m.isPending} onClick={() => m.mutate()}>Add note</Button></div>
          </div>
        )}
        <ul className="grid gap-2">
          {(a.notes ?? []).map((n) => (
            <li key={n.id} className={cn('rounded-md border p-3 text-sm', n.type === 'ALERT' && 'border-destructive/40 bg-destructive/5', n.type === 'HANDOVER' && 'border-info/40 bg-info/5')}>
              <p className="mb-1 flex items-center gap-2 text-xs text-muted-foreground"><Badge variant={n.type === 'ALERT' ? 'destructive' : n.type === 'HANDOVER' ? 'info' : 'secondary'}>{n.type === 'ALERT' ? 'Alert' : n.type === 'HANDOVER' ? 'Handover' : 'Progress'}</Badge>{fmtDateTime(n.createdAt)} · {n.authorName}</p>
              <p className="whitespace-pre-wrap">{n.text}</p>
            </li>
          ))}
          {!a.notes?.length && <li className="text-sm text-muted-foreground">No notes yet.</li>}
        </ul>
      </CardContent>
    </Card>
  );
}

function AdmissionView() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { can, session } = useSession();
  const tz = session.branch?.timezone ?? 'UTC';
  const [moving, setMoving] = useState(false);
  const [discharging, setDischarging] = useState(false);
  const [booking, setBooking] = useState(false);
  const q = useQuery({ queryKey: ['admission', id], queryFn: () => api.get<Admission>(`/admissions/${id}`), refetchInterval: 60_000 });
  const org = useQuery({ queryKey: ['organization'], queryFn: () => api.get<ClinicHeader>('/organization'), staleTime: 300_000 });
  const act = useMutation({
    mutationFn: ({ path, body, method }: { path: string; body: object; method?: 'patch' }) => (method === 'patch' ? api.patch(path, body) : api.post(path, body)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admission', id] }); qc.invalidateQueries({ queryKey: ['flowboard'] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  if (q.isLoading) return <LoadingRows />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const a = q.data;
  const active = a.status === 'ADMITTED';
  const writable = active && can('hospital.write');

  return (
    <>
      <div className="no-print">
        <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1 text-xs text-muted-foreground">
          <Link href="/hospital" className="hover:text-foreground hover:underline">Hospital</Link><span>/</span><span>{a.admissionNo}</span>
        </nav>
        <Card className={cn('mb-4', a.condition === 'CRITICAL' && 'border-destructive/50 ring-1 ring-destructive/30')}>
          <CardContent className="flex flex-col gap-4 pt-4 lg:flex-row lg:items-start">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/patients/${a.patient.id}`} className="text-xl font-semibold hover:underline">{a.patient.name}</Link>
                <ConditionBadge condition={a.condition} />
                <CprBadge status={a.cprStatus} />
                {a.isolation && <IsolationBadge />}
                {!active && <Badge variant="secondary">{a.status === 'DISCHARGED' ? (a.outcome ? enumLabel(a.outcome, 'outcome') : 'Discharged') : 'Cancelled'}</Badge>}
              </div>
              <p className="text-sm text-muted-foreground">
                {a.patient.species.name}{a.patient.breed ? ` · ${a.patient.breed.name}` : ''} · {fmtWeight(a.patient.latestWeightKg)} · Owner <Link className="hover:underline" href={`/clients/${a.client.id}`}>{a.client.displayName}</Link>{a.client.mobilePhone ? ` (${a.client.mobilePhone})` : ''}
              </p>
              {active ? (
                <p className="mt-1 text-sm">{a.ward ? <><b>{a.ward.name}</b>{a.cage ? ` · ${a.cage.name}` : ''}</> : 'No ward assigned'} · Day {a.daysInHospital} · admitted {fmtDateTime(a.admittedAt)} by {a.admittedByName}</p>
              ) : (
                <p className="mt-1 text-sm">
                  {a.status === 'DISCHARGED' ? <><b>Discharged {fmtDateTime(a.dischargedAt)}</b>{a.dischargedByName ? ` by ${a.dischargedByName}` : ''}</> : <b>Admission cancelled</b>} · admitted {fmtDateTime(a.admittedAt)}{a.ward ? ` · was in ${a.ward.name}${a.cage ? ` · ${a.cage.name}` : ''}` : ''}
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-1">{a.patient.alerts.length ? a.patient.alerts.map((al) => <AlertChip key={al.id} alert={al} />) : <span className="text-xs text-muted-foreground">No active alerts</span>}</div>
            </div>
            <div className="flex flex-wrap gap-2 lg:max-w-md lg:justify-end">
              {writable && (
                <>
                  <NativeSelect aria-label="Condition" className="h-8 w-32 text-sm" value={a.condition} onChange={(e) => act.mutate({ path: `/admissions/${a.id}`, method: 'patch', body: { condition: e.target.value } })}>
                    {PATIENT_CONDITIONS.map((c) => <option key={c} value={c}>{enumLabel(c)}</option>)}
                  </NativeSelect>
                  <NativeSelect aria-label="Resuscitation status" className="h-8 w-48 text-sm" value={a.cprStatus} onChange={(e) => act.mutate({ path: `/admissions/${a.id}`, method: 'patch', body: { cprStatus: e.target.value } })}>
                    {CPR_STATUSES.map((c) => <option key={c} value={c}>{enumLabel(c)}</option>)}
                  </NativeSelect>
                  <Button size="sm" variant="outline" onClick={() => setMoving(true)}><ArrowRightLeft /> Move</Button>
                  <Button size="sm" variant="outline" onClick={async () => { const r = await confirm({ title: 'Alert the responsible vet?', description: 'Creates an urgent task for the responsible vet and an alert note on this stay.', requireReason: true, reasonLabel: 'What is the concern?', confirmLabel: 'Send alert' }); if (r.confirmed) act.mutate({ path: `/admissions/${a.id}/escalate`, body: { reason: r.reason! } }); }}><BellRing /> Escalate</Button>
                  {can('surgery.write') && <Button size="sm" variant="outline" asChild><Link href={`/surgery?schedule=${a.patient.id}&admission=${a.id}`}><Scissors /> Schedule surgery</Link></Button>}
                  <Button size="sm" onClick={() => setDischarging(true)}><LogOut /> Discharge</Button>
                  <Button size="sm" variant="ghost" onClick={async () => { const r = await confirm({ title: 'Cancel this admission?', description: 'Use this only if the patient was admitted by mistake. Daily charges for this stay are waived.', requireReason: true, destructive: true, confirmLabel: 'Cancel admission' }); if (r.confirmed) act.mutate({ path: `/admissions/${a.id}/cancel`, body: { reason: r.reason! } }); }}><XCircle /> Cancel</Button>
                </>
              )}
              {a.status === 'DISCHARGED' && <Button size="sm" variant="outline" onClick={() => window.print()}><Printer /> Print discharge summary</Button>}
            </div>
          </CardContent>
        </Card>

        {a.status === 'DISCHARGED' && (can('billing.write') || can('appointments.write')) && (
          <section aria-label="Next steps" className="mb-4 rounded-lg border border-success/30 bg-success/5 p-3">
            <p className="mb-2 flex items-center gap-2 text-sm font-medium"><CheckCircle2 className="h-4 w-4 text-success" /> {a.patient.name} was discharged — next steps</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {can('billing.write') && (
                <Link href={`/billing/invoices/new?clientId=${a.client.id}`} className="flex items-center gap-3 rounded-md border bg-card px-3 py-2.5 shadow-sm transition-colors hover:border-primary/50 hover:bg-primary/5">
                  <span className="rounded-md bg-primary p-1.5 text-primary-foreground"><Receipt className="h-4 w-4" /></span>
                  <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">Bill this stay</span><span className="block text-xs text-muted-foreground">Hospital days, treatments and medicines are waiting to be invoiced for {a.client.displayName}</span></span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </Link>
              )}
              {can('appointments.write') && a.outcome !== 'DECEASED' && a.outcome !== 'EUTHANASED' && (
                <button type="button" onClick={() => setBooking(true)} className="flex items-center gap-3 rounded-md border bg-card px-3 py-2.5 text-left shadow-sm transition-colors hover:border-primary/50 hover:bg-primary/5">
                  <span className="rounded-md bg-primary/10 p-1.5 text-primary"><CalendarPlus className="h-4 w-4" /></span>
                  <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">Book a recheck</span><span className="block text-xs text-muted-foreground">{a.followUpAt ? `Follow-up planned for ${fmtDate(a.followUpAt)}` : 'Find a free slot for the post-discharge check'}</span></span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </button>
              )}
            </div>
          </section>
        )}

        <Tabs defaultValue="sheet">
          <TabsList>
            <TabsTrigger value="sheet">Treatment sheet</TabsTrigger>
            <TabsTrigger value="obs">Observations</TabsTrigger>
            <TabsTrigger value="notes">Notes ({a.notes?.length ?? 0})</TabsTrigger>
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="documents">Documents</TabsTrigger>
          </TabsList>
          <TabsContent value="sheet"><TreatmentSheet admissionId={a.id} active={active} /></TabsContent>
          <TabsContent value="obs"><Observations admissionId={a.id} active={active} /></TabsContent>
          <TabsContent value="notes"><NotesPanel a={a} active={active} /></TabsContent>
          <TabsContent value="details">
            <Card>
              <CardContent className="pt-4">
                <DescriptionList
                  items={[
                    { label: 'Reason for admission', value: a.reason },
                    { label: 'Working diagnosis', value: a.diagnosis },
                    { label: 'Responsible vet', value: a.responsibleClinician?.name },
                    { label: 'Expected discharge', value: fmtDateTime(a.expectedDischargeAt) },
                    { label: 'Feeding instructions', value: a.feedingInstructions && <span className="whitespace-pre-wrap">{a.feedingInstructions}</span> },
                    { label: 'Daily hospital fee', value: a.ward?.dailyService ? a.ward.dailyService.name : 'None for this ward' },
                    ...(a.surgeries?.length ? [{ label: 'Surgeries', value: <span className="grid">{a.surgeries.map((s) => <Link key={s.id} className="hover:underline" href={`/surgery/${s.id}`}>{s.surgeryNo} · {s.procedure} · {enumLabel(s.status)}</Link>)}</span> }] : []),
                    ...(a.status === 'DISCHARGED'
                      ? [
                          { label: 'Discharged', value: `${fmtDateTime(a.dischargedAt)} by ${a.dischargedByName} — ${enumLabel(a.outcome, 'outcome')}` },
                          { label: 'Discharge summary', value: <span className="whitespace-pre-wrap">{a.dischargeSummary}</span> },
                          { label: 'Home-care instructions', value: a.homeCareInstructions && <span className="whitespace-pre-wrap">{a.homeCareInstructions}</span> },
                          { label: 'Follow-up', value: fmtDate(a.followUpAt) },
                        ]
                      : []),
                    ...(a.status === 'CANCELLED' ? [{ label: 'Cancelled', value: a.cancelReason }] : []),
                  ]}
                />
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="documents"><Card><CardContent className="pt-4"><AttachmentsPanel entityType="Admission" entityId={a.id} canWrite={can('hospital.write')} /></CardContent></Card></TabsContent>
        </Tabs>
      </div>
      {a.status === 'DISCHARGED' && <div className="hidden print:block"><DischargeSummary admission={a} clinic={org.data ?? null} /></div>}
      <MoveDialog a={a} open={moving} onOpenChange={setMoving} />
      <DischargeDialog admission={a} open={discharging} onOpenChange={setDischarging} />
      {a.status === 'DISCHARGED' && <RecheckBooking a={a} tz={tz} open={booking} onOpenChange={setBooking} />}
    </>
  );
}

/** Post-discharge recheck booking. Defaults are memoised so the 60-second refresh does not reset the form. */
function RecheckBooking({ a, tz, open, onOpenChange }: { a: Admission; tz: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const defaults = useMemo(
    () => ({
      clinicianId: a.responsibleClinician?.id,
      // The follow-up date chosen at discharge, else a week from today.
      date: a.followUpAt ? a.followUpAt.slice(0, 10) : shiftDate(todayIn(tz), 7),
      reason: `Post-discharge recheck (${a.admissionNo})`,
      patient: {
        id: a.patient.id,
        name: a.patient.name,
        patientNo: `P-${String(a.patient.number).padStart(6, '0')}`,
        species: { id: '', ...a.patient.species },
        owner: { id: a.client.id, displayName: a.client.displayName, mobilePhone: a.client.mobilePhone },
        alerts: a.patient.alerts as AlertSummary[],
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [a.id, a.followUpAt, tz],
  );
  return <BookingDialog open={open} onOpenChange={onOpenChange} defaults={defaults} />;
}

export default function AdmissionPage() {
  return (
    <RequirePermission anyOf={['hospital.read']}>
      <AdmissionView />
    </RequirePermission>
  );
}
