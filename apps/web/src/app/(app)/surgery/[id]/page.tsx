'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ASA_GRADES, SURGERY_ROLES, enumLabel } from '@vcms/shared';
import { BedDouble, Check, CheckCircle2, Circle, Lock, Pill, Printer, Syringe, Trash2, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import type { ClinicHeader } from '@/components/billing/invoice-document';
import { useConfirm } from '@/components/confirm';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { AdmitDialog } from '@/components/hospital/admit-dialog';
import { SurgeryStatusBadge } from '@/components/hospital/badges';
import { ErrorState, LoadingRows } from '@/components/page';
import { AdministerDialog } from '@/components/pharmacy/administer-dialog';
import { ProductPicker } from '@/components/pharmacy/product-picker';
import { RequirePermission } from '@/components/require';
import { AttachmentsPanel } from '@/components/shared/attachments-panel';
import { AlertChip } from '@/components/status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useClinicians } from '@/hooks/use-catalog';
import { api } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtMoney, fmtWeight } from '@/lib/format';
import { useSession } from '@/lib/session';
import { branchTime } from '@/lib/time';
import type { AnaesthesiaReading, Product, Surgery } from '@/lib/types';
import { cn } from '@/lib/utils';

const STEPS = ['SCHEDULED', 'PRE_OP', 'IN_PROGRESS', 'RECOVERY', 'COMPLETED'] as const;
const PHASES = [
  { key: 'SIGN_IN', title: 'Before induction (sign in)' },
  { key: 'TIME_OUT', title: 'Before incision (time out)' },
  { key: 'SIGN_OUT', title: 'Before leaving theatre (sign out)' },
] as const;
const READING_FIELDS: { key: keyof AnaesthesiaReading; label: string; phases: ('INTRA_OP' | 'RECOVERY')[] }[] = [
  { key: 'heartRate', label: 'HR', phases: ['INTRA_OP', 'RECOVERY'] },
  { key: 'respiratoryRate', label: 'RR', phases: ['INTRA_OP', 'RECOVERY'] },
  { key: 'spo2', label: 'SpO₂ %', phases: ['INTRA_OP', 'RECOVERY'] },
  { key: 'etco2', label: 'EtCO₂', phases: ['INTRA_OP'] },
  { key: 'systolicBp', label: 'Sys', phases: ['INTRA_OP', 'RECOVERY'] },
  { key: 'diastolicBp', label: 'Dia', phases: ['INTRA_OP'] },
  { key: 'meanBp', label: 'MAP', phases: ['INTRA_OP', 'RECOVERY'] },
  { key: 'temperatureC', label: 'Temp °C', phases: ['INTRA_OP', 'RECOVERY'] },
  { key: 'agentPercent', label: 'Agent %', phases: ['INTRA_OP'] },
  { key: 'oxygenLpm', label: 'O₂ L/min', phases: ['INTRA_OP'] },
  { key: 'painScore', label: 'Pain', phases: ['RECOVERY'] },
];

function useSurgeryMutation(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, body, method }: { path: string; body: object; method?: 'patch' | 'put' }) => (method === 'patch' ? api.patch(`/surgeries/${id}${path}`, body) : method === 'put' ? api.put(`/surgeries/${id}${path}`, body) : api.post(`/surgeries/${id}${path}`, body)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['surgery', id] }); qc.invalidateQueries({ queryKey: ['surgeries'] }); },
    onError: (e: Error) => toast.error(e.message),
  });
}

/** A group of text fields saved together; read-only once the record is locked. */
function TextFields({ s, locked, fields }: { s: Surgery; locked: boolean; fields: { key: keyof Surgery; label: string; rows?: number; hint?: string }[] }) {
  const m = useSurgeryMutation(s.id);
  const server = (k: keyof Surgery) => (s[k] as string | null) ?? '';
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, server(f.key)])));
  const last = useRef<Record<string, string>>(Object.fromEntries(fields.map((f) => [f.key, server(f.key)])));
  // Background refreshes only update fields the user has not edited, so typing is never lost.
  useEffect(() => {
    setValues((cur) => Object.fromEntries(fields.map((f) => {
      const k = f.key as string;
      return [k, cur[k] === last.current[k] ? server(f.key) : cur[k]];
    })));
    last.current = Object.fromEntries(fields.map((f) => [f.key, server(f.key)]));
  }, [s]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = fields.some((f) => (values[f.key as string] ?? '') !== ((s[f.key] as string | null) ?? ''));
  return (
    <div className="grid gap-3">
      {fields.map((f) => (
        <Field key={f.key as string} label={f.label} htmlFor={`sf-${f.key as string}`} hint={f.hint}>
          {locked ? <p id={`sf-${f.key as string}`} className="whitespace-pre-wrap text-sm">{(s[f.key] as string) || <span className="text-muted-foreground">—</span>}</p> : (
            <Textarea id={`sf-${f.key as string}`} rows={f.rows ?? 3} value={values[f.key as string] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [f.key as string]: e.target.value }))} />
          )}
        </Field>
      ))}
      {!locked && <div><Button size="sm" disabled={!dirty} loading={m.isPending} onClick={() => m.mutate({ path: '', method: 'patch', body: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v || null])) })}>Save</Button></div>}
    </div>
  );
}

function Readings({ s, phase, locked }: { s: Surgery; phase: 'INTRA_OP' | 'RECOVERY'; locked: boolean }) {
  const m = useSurgeryMutation(s.id);
  const { session } = useSession();
  const tz = session.branch?.timezone ?? 'UTC';
  const [v, setV] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const fields = READING_FIELDS.filter((f) => f.phases.includes(phase));
  const rows = (s.readings ?? []).filter((r) => r.phase === phase);
  const canRecord = !locked && ['PRE_OP', 'IN_PROGRESS', 'RECOVERY'].includes(s.status);
  const chart = rows.map((r) => ({ time: branchTime(r.recordedAt, tz), HR: r.heartRate, 'SpO₂': r.spo2, EtCO2: r.etco2, MAP: r.meanBp, Temp: r.temperatureC }));
  return (
    <div className="grid gap-3">
      {canRecord && (
        <div className="grid gap-2 rounded-md border bg-muted/30 p-3">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 xl:grid-cols-11">
            {fields.map((f) => (
              <label key={f.key} className="grid gap-1 text-2xs text-muted-foreground">{f.label}<Input inputMode="decimal" className="h-8" value={v[f.key] ?? ''} onChange={(e) => setV((s2) => ({ ...s2, [f.key]: e.target.value }))} /></label>
            ))}
          </div>
          <div className="flex gap-2">
            <Input aria-label="Reading notes" className="h-8" placeholder="Notes (events, drugs, depth…)" value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />
            <Button size="sm" loading={m.isPending} disabled={!Object.values(v).some((x) => x !== '')} onClick={() => m.mutate({ path: '/readings', body: { phase, ...Object.fromEntries(Object.entries(v).filter(([, x]) => x !== '')), notes: notes || null } }, { onSuccess: () => { setV({}); setNotes(''); } })}>Record</Button>
          </div>
        </div>
      )}
      {rows.length > 1 && (
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chart} margin={{ left: -15, right: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="time" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="HR" stroke="hsl(var(--primary))" connectNulls />
              <Line type="monotone" dataKey="SpO₂" stroke="hsl(var(--info))" connectNulls />
              {phase === 'INTRA_OP' && <Line type="monotone" dataKey="EtCO2" stroke="hsl(var(--warning))" connectNulls />}
              <Line type="monotone" dataKey="MAP" stroke="hsl(var(--destructive))" connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      {rows.length ? (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <THead><TR><TH>Time</TH>{fields.map((f) => <TH key={f.key} className="text-right">{f.label}</TH>)}<TH>Notes</TH></TR></THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD className="whitespace-nowrap text-xs tabular">{branchTime(r.recordedAt, tz)}<span className="block text-muted-foreground">{r.recordedByName}</span></TD>
                  {fields.map((f) => <TD key={f.key} className="text-right tabular">{(r[f.key] as number | null) ?? '—'}</TD>)}
                  <TD className="text-xs">{r.notes}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      ) : <p className="text-sm text-muted-foreground">No readings yet.</p>}
    </div>
  );
}

function ConsentDialog({ s, open, onOpenChange }: { s: Surgery; open: boolean; onOpenChange: (o: boolean) => void }) {
  const m = useSurgeryMutation(s.id);
  const [givenBy, setGivenBy] = useState('');
  const [notes, setNotes] = useState('');
  useEffect(() => { if (open) { setGivenBy(s.client.displayName); setNotes(''); } }, [open, s.client.displayName]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Record owner consent</DialogTitle>
          <DialogDescription>Confirm the owner has agreed to the procedure, anaesthesia risks{s.estimateMinor ? ' and the estimate' : ''}. Upload the signed form under Documents.</DialogDescription>
        </DialogHeader>
        <Field label="Consent given by" htmlFor="cs-by" required><Input id="cs-by" value={givenBy} onChange={(e) => setGivenBy(e.target.value)} /></Field>
        <Field label="Notes" htmlFor="cs-notes"><Textarea id="cs-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Signed form, phone consent witnessed by…" /></Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!givenBy.trim()} loading={m.isPending} onClick={() => m.mutate({ path: '/consent', body: { givenBy, notes: notes || null } }, { onSuccess: () => onOpenChange(false) })}>Record consent</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TeamEditor({ s, locked }: { s: Surgery; locked: boolean }) {
  const m = useSurgeryMutation(s.id);
  const { session } = useSession();
  const clinicians = useClinicians(session.branch?.id);
  const [memberId, setMemberId] = useState('');
  const [role, setRole] = useState('ASSISTANT');
  const save = (members: { membershipId: string; role: string }[]) => m.mutate({ path: '/team', method: 'put', body: { members } });
  const current = s.team.map((t) => ({ membershipId: t.membershipId, role: t.role }));
  return (
    <div className="grid gap-3">
      <ul className="divide-y rounded-md border">
        {s.team.map((t) => (
          <li key={t.id} className="flex items-center justify-between px-3 py-2 text-sm">
            <span><b>{t.name}</b> <span className="text-muted-foreground">· {enumLabel(t.role)}</span></span>
            {!locked && <Button size="icon-sm" variant="ghost" aria-label={`Remove ${t.name}`} onClick={() => save(current.filter((c) => !(c.membershipId === t.membershipId && c.role === t.role)))}><Trash2 /></Button>}
          </li>
        ))}
      </ul>
      {!locked && (
        <div className="flex flex-wrap gap-2">
          <NativeSelect aria-label="Staff member" className="w-56" value={memberId} onChange={(e) => setMemberId(e.target.value)}>
            <option value="">Add team member…</option>
            {(clinicians.data ?? []).map((c) => <option key={c.membershipId} value={c.membershipId}>{c.name}</option>)}
          </NativeSelect>
          <NativeSelect aria-label="Role" className="w-40" value={role} onChange={(e) => setRole(e.target.value)}>{SURGERY_ROLES.map((r) => <option key={r} value={r}>{enumLabel(r)}</option>)}</NativeSelect>
          <Button size="sm" variant="outline" disabled={!memberId} onClick={() => { save([...current, { membershipId: memberId, role }]); setMemberId(''); }}>Add</Button>
        </div>
      )}
      <p className="text-xs text-muted-foreground">The list shows staff marked as clinicians at this branch.</p>
    </div>
  );
}

function SurgeryView() {
  const { id } = useParams<{ id: string }>();
  const confirm = useConfirm();
  const { can, currency, session } = useSession();
  const tz = session.branch?.timezone ?? 'UTC';
  const [consenting, setConsenting] = useState(false);
  const [giving, setGiving] = useState(false);
  const [admitting, setAdmitting] = useState(false);
  const [product, setProduct] = useState<Product | null>(null);
  const [qty, setQty] = useState('1');
  const [addendum, setAddendum] = useState('');
  const q = useQuery({ queryKey: ['surgery', id], queryFn: () => api.get<Surgery>(`/surgeries/${id}`), refetchInterval: 30_000 });
  const org = useQuery({ queryKey: ['organization'], queryFn: () => api.get<ClinicHeader>('/organization'), staleTime: 300_000 });
  const m = useSurgeryMutation(id);
  if (q.isLoading) return <LoadingRows />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data;
  const writable = can('surgery.write');
  const locked = !writable || s.status === 'COMPLETED' || s.status === 'CANCELLED';
  const stepIdx = STEPS.indexOf(s.status as (typeof STEPS)[number]);
  const unchecked = (phases: string[]) => s.checklist.filter((c) => phases.includes(c.phase) && !c.checked);
  const startBlockers = [!s.consentObtained && 'owner consent', !s.asaGrade && 'ASA grade', unchecked(['SIGN_IN', 'TIME_OUT']).length && `${unchecked(['SIGN_IN', 'TIME_OUT']).length} checklist items`].filter(Boolean) as string[];
  const go = (action: string, reason?: string) => m.mutate({ path: '/status', body: { action, reason } });

  return (
    <>
      <div className="no-print">
        <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1 text-xs text-muted-foreground"><Link href="/surgery" className="hover:text-foreground hover:underline">Surgery</Link><span>/</span><span>{s.surgeryNo}</span></nav>
        <Card className="mb-4">
          <CardContent className="grid gap-4 pt-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl font-semibold">{s.procedure}</h1>
                  <SurgeryStatusBadge status={s.status} />
                  {s.priority !== 'ELECTIVE' && <Badge variant={s.priority === 'EMERGENCY' ? 'destructive' : 'warning'}>{enumLabel(s.priority)}</Badge>}
                  {locked && s.status === 'COMPLETED' && <Badge variant="secondary" className="gap-1"><Lock className="h-3 w-3" /> Signed</Badge>}
                </div>
                <p className="text-sm">
                  <Link href={`/patients/${s.patient.id}`} className="font-medium hover:underline">{s.patient.name}</Link>
                  <span className="text-muted-foreground"> · {s.patient.species.name}{s.patient.breed ? ` · ${s.patient.breed.name}` : ''} · {fmtWeight(s.patient.latestWeightKg)} · {s.client.displayName}</span>
                </p>
                <p className="text-sm text-muted-foreground">{fmtDate(s.scheduledAt)} {branchTime(s.scheduledAt, tz)} · {s.durationMinutes} min · {s.theatre?.name ?? 'No theatre'} · {s.surgeryNo}{s.admission ? <> · <Link className="hover:underline" href={`/hospital/admissions/${s.admission.id}`}>{s.admission.admissionNo}</Link></> : ''}</p>
                <div className="mt-2 flex flex-wrap gap-1">{s.patient.alerts.map((a) => <AlertChip key={a.id} alert={a} />)}</div>
              </div>
              <div className="flex flex-wrap gap-2 lg:justify-end">
                {writable && s.status === 'SCHEDULED' && <Button size="sm" variant="outline" onClick={() => go('pre-op')}>Patient arrived (pre-op)</Button>}
                {writable && ['SCHEDULED', 'PRE_OP'].includes(s.status) && (
                  <Button size="sm" disabled={startBlockers.length > 0} title={startBlockers.length ? `Still needed: ${startBlockers.join(', ')}` : undefined} onClick={() => go('start')}>Start surgery</Button>
                )}
                {writable && s.status === 'IN_PROGRESS' && <Button size="sm" onClick={() => go('recovery')}>Move to recovery</Button>}
                {writable && s.status === 'RECOVERY' && (
                  <Button size="sm" onClick={async () => (await confirm({ title: 'Complete and sign this surgical record?', description: 'The report, checklist and anaesthesia record are locked. Later corrections are added as addenda. The procedure fee is added to the client’s unbilled charges.', confirmLabel: 'Complete & sign' })).confirmed && go('complete')}>Complete & sign</Button>
                )}
                {writable && ['SCHEDULED', 'PRE_OP'].includes(s.status) && (
                  <Button size="sm" variant="ghost" onClick={async () => { const r = await confirm({ title: 'Cancel this surgery?', description: 'The theatre booking is released.', requireReason: true, destructive: true, confirmLabel: 'Cancel surgery', cancelLabel: 'Keep surgery' }); if (r.confirmed) go('cancel', r.reason); }}><XCircle /> Cancel surgery</Button>
                )}
                {can('hospital.write') && !s.admission && ['RECOVERY', 'COMPLETED', 'IN_PROGRESS'].includes(s.status) && <Button size="sm" variant="outline" onClick={() => setAdmitting(true)}><BedDouble /> Admit to hospital</Button>}
                {s.status === 'COMPLETED' && <Button size="sm" variant="outline" onClick={() => window.print()}><Printer /> Print report</Button>}
              </div>
            </div>
            {s.status !== 'CANCELLED' ? (
              <ol className="grid grid-cols-5 gap-1" aria-label="Progress">
                {STEPS.map((st, i) => (
                  <li key={st} className={cn('flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs', i < stepIdx ? 'bg-success/10 text-success' : i === stepIdx ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
                    {i < stepIdx ? <Check className="h-3.5 w-3.5" /> : <Circle className="h-3 w-3" />} {enumLabel(st, 'surgery')}
                  </li>
                ))}
              </ol>
            ) : <p className="rounded-md bg-muted px-3 py-2 text-sm">Cancelled: {s.cancelReason}</p>}
            {startBlockers.length > 0 && ['SCHEDULED', 'PRE_OP'].includes(s.status) && <p className="text-xs text-warning">Before starting: {startBlockers.join(', ')}.</p>}
          </CardContent>
        </Card>

        <Tabs defaultValue={['IN_PROGRESS'].includes(s.status) ? 'anaesthesia' : s.status === 'RECOVERY' ? 'recovery' : 'preop'}>
          <TabsList>
            <TabsTrigger value="preop">Pre-op & consent</TabsTrigger>
            <TabsTrigger value="checklist">Safety checklist ({s.checklist.filter((c) => c.checked).length}/{s.checklist.length})</TabsTrigger>
            <TabsTrigger value="anaesthesia">Anaesthesia</TabsTrigger>
            <TabsTrigger value="procedure">Procedure</TabsTrigger>
            <TabsTrigger value="recovery">Recovery & post-op</TabsTrigger>
            <TabsTrigger value="team">Team</TabsTrigger>
            <TabsTrigger value="documents">Documents</TabsTrigger>
          </TabsList>

          <TabsContent value="preop" className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Pre-operative assessment</CardTitle></CardHeader>
              <CardContent className="grid gap-3">
                <div className="flex flex-wrap items-end gap-3">
                  <Field label="ASA grade" htmlFor="sx-asa" hint="ASA physical status classification">
                    <NativeSelect id="sx-asa" className="w-28" disabled={locked} value={s.asaGrade ?? ''} onChange={(e) => m.mutate({ path: '', method: 'patch', body: { asaGrade: e.target.value || null } })}>
                      <option value="">—</option>{ASA_GRADES.map((g) => <option key={g} value={g}>ASA {g}</option>)}
                    </NativeSelect>
                  </Field>
                  <label className="flex items-center gap-2 pb-2 text-sm"><Checkbox disabled={locked} checked={s.asaEmergency} onCheckedChange={(v) => m.mutate({ path: '', method: 'patch', body: { asaEmergency: !!v } })} /> Emergency (E)</label>
                  <label className="flex items-center gap-2 pb-2 text-sm"><Checkbox disabled={locked} checked={s.fastingConfirmed} onCheckedChange={(v) => m.mutate({ path: '', method: 'patch', body: { fastingConfirmed: !!v } })} /> Fasting confirmed</label>
                </div>
                <TextFields s={s} locked={locked} fields={[{ key: 'preOpAssessment', label: 'Examination & risk assessment', rows: 5, hint: 'Clinical exam, relevant history, bloodwork reviewed, risks discussed.' }]} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Owner consent</CardTitle></CardHeader>
              <CardContent className="grid gap-3 text-sm">
                {s.consentObtained ? (
                  <p className="flex items-start gap-2 text-success"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /><span>Consent given by <b>{s.consentGivenBy}</b> · recorded {fmtDateTime(s.consentAt)} by {s.consentRecordedBy}</span></p>
                ) : <p className="text-warning">Consent has not been recorded. Surgery cannot start without it.</p>}
                {s.estimateMinor != null && <p>Estimate given: <b>{fmtMoney(s.estimateMinor, currency)}</b></p>}
                {s.service && <p>Procedure fee: {s.service.name} ({fmtMoney(s.service.priceMinor, currency)}) — charged on completion.</p>}
                {!locked && <div><Button size="sm" variant={s.consentObtained ? 'outline' : 'default'} onClick={() => setConsenting(true)}>{s.consentObtained ? 'Re-record consent' : 'Record consent'}</Button></div>}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="checklist" className="grid gap-4 lg:grid-cols-3">
            {PHASES.map((ph) => (
              <Card key={ph.key}>
                <CardHeader><CardTitle>{ph.title}</CardTitle></CardHeader>
                <CardContent>
                  <ul className="grid gap-2">
                    {s.checklist.filter((c) => c.phase === ph.key).map((c) => (
                      <li key={c.key}>
                        <label className="flex items-start gap-2 text-sm">
                          <Checkbox className="mt-0.5" disabled={locked} checked={c.checked} onCheckedChange={(v) => m.mutate({ path: '/checklist', body: { key: c.key, checked: !!v } })} />
                          <span>{c.label}{c.checked && c.by && <span className="block text-2xs text-muted-foreground">{c.by} · {c.at ? branchTime(c.at, tz) : ''}</span>}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
            <p className="text-xs text-muted-foreground lg:col-span-3">Adapted from the WHO Surgical Safety Checklist. Your clinic can edit the items in Settings → Surgical checklist.</p>
          </TabsContent>

          <TabsContent value="anaesthesia" className="grid gap-4">
            <Card>
              <CardHeader><CardTitle>Anaesthetic plan</CardTitle></CardHeader>
              <CardContent><TextFields s={s} locked={locked} fields={[{ key: 'anaesthesiaPlan', label: 'Premedication, induction, maintenance, analgesia and fluids', rows: 4, hint: 'Drugs and doses are your clinical decision; the system does not suggest them.' }, { key: 'airway', label: 'Airway (e.g. tube size, mask)', rows: 1 }]} /></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Monitoring</CardTitle></CardHeader>
              <CardContent><Readings s={s} phase="INTRA_OP" locked={locked} /></CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Syringe className="h-4 w-4" /> Drugs given</CardTitle>
                {!locked && s.encounterId && can('clinical.write') && <Button size="sm" variant="outline" onClick={() => setGiving(true)}><Pill /> Record drug</Button>}
              </CardHeader>
              <CardContent>
                {!s.encounterId && <p className="text-sm text-muted-foreground">{s.status === 'COMPLETED' || s.status === 'CANCELLED' ? 'No drugs were recorded for this surgery.' : 'Drugs can be recorded once the surgery has started.'}</p>}
                {!!s.administrations?.length && (
                  <ul className="divide-y rounded-md border text-sm">
                    {s.administrations.map((a) => <li key={a.id} className="flex justify-between px-3 py-2"><span><b>{a.product}</b> {a.dose} {a.doseUnit} {a.route}{a.status !== 'GIVEN' && ' (not given)'}</span><span className="text-xs text-muted-foreground">{branchTime(a.administeredAt, tz)} · {a.administeredByName}</span></li>)}
                  </ul>
                )}
                {s.encounterId && !s.administrations?.length && (
                  <p className="text-sm text-muted-foreground">{s.status === 'COMPLETED' || s.status === 'CANCELLED' ? 'No drugs were recorded for this surgery.' : 'No drugs recorded yet.'}</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="procedure" className="grid gap-4 lg:grid-cols-[1fr_380px]">
            <Card>
              <CardHeader><CardTitle>Surgical report</CardTitle></CardHeader>
              <CardContent><TextFields s={s} locked={locked} fields={[{ key: 'surgicalNotes', label: 'Procedure and technique', rows: 8 }, { key: 'findings', label: 'Findings', rows: 3 }, { key: 'complications', label: 'Complications', rows: 2, hint: 'Write “None” if there were none.' }]} /></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Consumables & implants</CardTitle></CardHeader>
              <CardContent className="grid gap-3">
                {!locked && ['PRE_OP', 'IN_PROGRESS', 'RECOVERY'].includes(s.status) && (
                  <div className="grid gap-2">
                    <ProductPicker value={product} onChange={setProduct} placeholder="Search consumable…" />
                    <div className="flex gap-2">
                      <Input aria-label="Quantity" inputMode="decimal" className="w-24" value={qty} onChange={(e) => setQty(e.target.value)} />
                      <Button size="sm" disabled={!product || !(Number(qty) > 0)} loading={m.isPending} onClick={() => m.mutate({ path: '/items', body: { productId: product!.id, quantity: Number(qty) } }, { onSuccess: () => { setProduct(null); setQty('1'); } })}>Add</Button>
                    </div>
                    <p className="text-2xs text-muted-foreground">Deducted from stock and added to the client’s charges.</p>
                  </div>
                )}
                <ul className="divide-y rounded-md border text-sm">
                  {(s.items ?? []).map((i) => <li key={i.id} className="flex justify-between px-3 py-2"><span>{i.product.name}</span><span className="tabular">{i.quantity} {i.product.dispensingUnit}</span></li>)}
                  {!s.items?.length && <li className="px-3 py-2 text-muted-foreground">None recorded.</li>}
                </ul>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="recovery" className="grid gap-4">
            <Card>
              <CardHeader><CardTitle>Recovery observations</CardTitle></CardHeader>
              <CardContent><Readings s={s} phase="RECOVERY" locked={locked} /></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Post-operative care</CardTitle></CardHeader>
              <CardContent className="grid gap-3">
                <TextFields s={s} locked={locked} fields={[{ key: 'postOpInstructions', label: 'Post-operative medication and discharge instructions', rows: 6, hint: 'Printed on the surgical report for the owner.' }]} />
                <Field label="Post-op check" htmlFor="sx-fu" hint="Creates a recheck task for the surgeon when the record is completed.">
                  <Input id="sx-fu" type="date" className="w-48" disabled={locked} value={s.followUpAt?.slice(0, 10) ?? ''} onChange={(e) => m.mutate({ path: '', method: 'patch', body: { followUpAt: e.target.value ? new Date(e.target.value).toISOString() : null } })} />
                </Field>
              </CardContent>
            </Card>
            {s.status === 'COMPLETED' && (
              <Card>
                <CardHeader><CardTitle>Addenda</CardTitle></CardHeader>
                <CardContent className="grid gap-3">
                  {(s.addenda ?? []).map((a) => <p key={a.id} className="rounded-md border p-3 text-sm"><span className="block text-xs text-muted-foreground">{fmtDateTime(a.createdAt)} · {a.authorName}</span>{a.text}</p>)}
                  {writable && (
                    <div className="grid gap-2">
                      <Textarea aria-label="Addendum" value={addendum} onChange={(e) => setAddendum(e.target.value)} placeholder="Add a correction or later information. The signed report is not changed." />
                      <div><Button size="sm" disabled={!addendum.trim()} onClick={() => m.mutate({ path: '/addenda', body: { text: addendum } }, { onSuccess: () => setAddendum('') })}>Add addendum</Button></div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="team"><Card><CardContent className="pt-4"><TeamEditor s={s} locked={locked} /></CardContent></Card></TabsContent>
          <TabsContent value="documents"><Card><CardContent className="pt-4"><AttachmentsPanel entityType="Surgery" entityId={s.id} canWrite={can('surgery.write')} /></CardContent></Card></TabsContent>
        </Tabs>
      </div>

      {s.status === 'COMPLETED' && (
        <article className="hidden bg-white p-8 text-[10.5pt] text-black print:block">
          <header className="mb-3 border-b border-black pb-2">
            <p className="text-lg font-bold">{org.data?.legalName || org.data?.name}</p>
            <p className="font-bold">Surgical report — {s.surgeryNo}</p>
          </header>
          <p><b>Patient:</b> {s.patient.name} ({s.patient.species.name}) · <b>Owner:</b> {s.client.displayName} · <b>Weight:</b> {fmtWeight(s.patient.latestWeightKg)}</p>
          <p><b>Procedure:</b> {s.procedure} · <b>Date:</b> {fmtDateTime(s.startedAt ?? s.scheduledAt)} · <b>ASA:</b> {s.asaGrade}{s.asaEmergency ? 'E' : ''}</p>
          <p><b>Team:</b> {s.team.map((t) => `${t.name} (${enumLabel(t.role)})`).join(', ')}</p>
          <h2 className="mt-3 font-bold">Procedure</h2><p className="whitespace-pre-wrap">{s.surgicalNotes}</p>
          {s.findings && <><h2 className="mt-2 font-bold">Findings</h2><p className="whitespace-pre-wrap">{s.findings}</p></>}
          <h2 className="mt-2 font-bold">Complications</h2><p className="whitespace-pre-wrap">{s.complications || 'None recorded'}</p>
          {s.postOpInstructions && <><h2 className="mt-2 font-bold">Aftercare</h2><p className="whitespace-pre-wrap">{s.postOpInstructions}</p></>}
          {s.followUpAt && <p className="mt-2 font-semibold">Post-operative check: {fmtDate(s.followUpAt)}</p>}
          <p className="mt-4 text-xs">Signed by {s.completedByName} on {fmtDateTime(s.completedAt)}{s.addenda?.length ? ` · ${s.addenda.length} addendum(s) on file` : ''}</p>
        </article>
      )}
      <ConsentDialog s={s} open={consenting} onOpenChange={setConsenting} />
      {s.encounterId && <AdministerDialog open={giving} onOpenChange={setGiving} patientId={s.patient.id} encounterId={s.encounterId} />}
      <AdmitDialog open={admitting} onOpenChange={setAdmitting} patient={{ id: s.patient.id, name: s.patient.name, species: s.patient.species } as never} />
    </>
  );
}

export default function SurgeryDetailPage() {
  return (
    <RequirePermission anyOf={['surgery.read']}>
      <SurgeryView />
    </RequirePermission>
  );
}
