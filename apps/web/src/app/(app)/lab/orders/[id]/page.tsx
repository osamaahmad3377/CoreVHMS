'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IMAGING_MODALITIES, SAMPLE_TYPES, enumLabel } from '@vcms/shared';
import { AlertOctagon, Barcode, CheckCircle2, FilePen, Printer, Save, TestTube, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useConfirm } from '@/components/confirm';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { LabStatusBadge } from '@/components/lab/lab-status';
import { ResultFlag, previewFlag } from '@/components/lab/result-flag';
import { EmptyState, ErrorState, LoadingRows } from '@/components/page';
import { PatientBanner } from '@/components/patients/patient-banner';
import { RequirePermission } from '@/components/require';
import { AttachmentsPanel } from '@/components/shared/attachments-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { api } from '@/lib/api';
import { fmtAge, fmtDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { DiagnosticOrder, LabResult } from '@/lib/types';
import { cn } from '@/lib/utils';

type Entry = Record<string, { value: string; comment: string }>; // key = itemId:analyteId

function current(results: LabResult[], analyteId: string) {
  return results.find((r) => r.analyteId === analyteId && r.status !== 'SUPERSEDED');
}

function fmtValue(r: LabResult | undefined, decimals: number) {
  if (!r) return '';
  if (r.valueNumeric !== null) return r.valueNumeric.toFixed(decimals);
  return r.valueText ?? '';
}

function OrderView() {
  const { id } = useParams<{ id: string }>();
  const { can, session } = useSession();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const key = ['lab-order', id];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<DiagnosticOrder>(`/lab-orders/${id}`) });
  const [entry, setEntry] = useState<Entry>({});
  const [dirty, setDirty] = useState(false);
  const [sampleType, setSampleType] = useState('');
  const [amend, setAmend] = useState<{ result: LabResult; name: string; unit: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [printing, setPrinting] = useState<'report' | string | null>(null);
  const o = q.data;

  useEffect(() => {
    if (!o) return;
    const e: Entry = {};
    for (const it of o.items) for (const a of it.test.analytes) {
      const r = current(it.results, a.id);
      e[`${it.id}:${a.id}`] = { value: fmtValue(r, a.decimals), comment: r?.comment ?? '' };
    }
    setEntry(e);
    setDirty(false);
    const types = o.items.map((i) => i.test.sampleType).filter((t) => t !== 'NONE');
    setSampleType(types[0] ?? 'WHOLE_BLOOD_EDTA');
  }, [o]);

  useEffect(() => {
    if (!printing) return;
    const t = setTimeout(() => {
      window.print();
      setPrinting(null);
    }, 50);
    return () => clearTimeout(t);
  }, [printing]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ['lab-orders'] });
  };
  const act = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => refresh(),
    onError: (e: Error) => setError(e.message),
  });

  const saveResults = useMutation({
    mutationFn: () => {
      const results = o!.items.flatMap((it) =>
        it.test.analytes
          .map((a) => {
            const v = entry[`${it.id}:${a.id}`];
            if (!v || v.value === '') return null;
            return a.resultType === 'NUMERIC'
              ? { orderItemId: it.id, analyteId: a.id, valueNumeric: Number(v.value), comment: v.comment || null }
              : { orderItemId: it.id, analyteId: a.id, valueText: v.value, comment: v.comment || null };
          })
          .filter(Boolean),
      );
      return api.put<DiagnosticOrder>(`/lab-orders/${id}/results`, { results });
    },
    onSuccess: (r) => {
      toast[r.hasCritical ? 'warning' : 'success'](r.hasCritical ? 'Saved — CRITICAL value present. The ordering clinician has been tasked.' : 'Results saved (preliminary)');
      refresh();
    },
    onError: (e: Error) => setError(e.message),
  });

  const sampleNeeded = useMemo(() => !!o?.items.some((i) => i.test.sampleType !== 'NONE'), [o]);

  if (q.isLoading) return <LoadingRows />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const order = o!;
  const editable = !['RELEASED', 'CANCELLED'].includes(order.status) && can('lab.result');
  const intervals = order.referenceIntervals ?? {};
  const banner = { ...order.patient, breed: order.patient.breed?.name ?? null, owner: { id: order.client.id, displayName: order.client.displayName, mobilePhone: order.client.mobilePhone } };

  return (
    <>
      <div className={cn(printing && 'print:hidden')}>
        <nav aria-label="Breadcrumb" className="no-print mb-2 flex items-center gap-1 text-xs text-muted-foreground">
          <Link href="/lab" className="hover:text-foreground hover:underline">Laboratory</Link>
          <span>/</span>
          <span>{order.orderNo}</span>
        </nav>
        <PatientBanner patient={banner} className="mb-3" />
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold">{order.orderNo}</h1>
          <LabStatusBadge status={order.status} />
          {order.priority !== 'ROUTINE' && <Badge variant="destructive">{enumLabel(order.priority)}</Badge>}
          {order.hasCritical && <Badge variant="destructive"><AlertOctagon className="h-3 w-3" /> Critical value</Badge>}
          <span className="text-xs text-muted-foreground">Ordered by {order.orderedByName} · {fmtDateTime(order.createdAt)}{order.encounterId && <> · <Link className="text-primary hover:underline" href={`/consultations/${order.encounterId}`}>consultation</Link></>}</span>
          <div className="ml-auto flex flex-wrap gap-2">
            {order.status === 'AWAITING_VALIDATION' && can('lab.approve') && (
              <Button size="sm" onClick={async () => { const r = await confirm({ title: `Validate and release ${order.orderNo}?`, description: 'Released results become final and visible in the clinical record. Corrections afterwards require an amendment with a reason.', confirmLabel: 'Release results' }); if (r.confirmed) act.mutate(() => api.post(`/lab-orders/${id}/release`)); }}>
                <CheckCircle2 /> Validate & release
              </Button>
            )}
            {order.items.some((i) => i.results.length || i.imagingReport) && <Button size="sm" variant="outline" onClick={() => setPrinting('report')}><Printer /> Print report</Button>}
            {!['RELEASED', 'CANCELLED'].includes(order.status) && (can('lab.order') || can('lab.approve')) && (
              <Button size="sm" variant="ghost" className="text-destructive" onClick={async () => { const r = await confirm({ title: `Cancel ${order.orderNo}?`, requireReason: true, destructive: true, confirmLabel: 'Cancel order' }); if (r.confirmed) act.mutate(() => api.post(`/lab-orders/${id}/cancel`, { reason: r.reason })); }}>
                <XCircle /> Cancel
              </Button>
            )}
          </div>
        </div>
        {error && <FormError message={error} />}
        {order.cancelReason && <p className="mb-3 rounded-md bg-muted px-3 py-2 text-sm">Cancelled: {order.cancelReason}</p>}
        {order.clinicalNotes && <p className="mb-3 rounded-md border bg-card px-3 py-2 text-sm"><span className="font-medium">Clinical notes:</span> {order.clinicalNotes}</p>}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid content-start gap-4">
            {order.items.map((it) => (
              <Card key={it.id}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    {it.test.name} <span className="text-xs font-normal text-muted-foreground">{it.test.code} · {enumLabel(it.test.category)}{it.test.performedBy === 'EXTERNAL' && ` · ${it.test.externalLabName}`}</span>
                  </CardTitle>
                  <Badge variant={it.status === 'RESULTED' ? 'success' : it.status === 'CANCELLED' ? 'outline' : 'secondary'}>{enumLabel(it.status)}</Badge>
                </CardHeader>
                {it.test.category === 'IMAGING' ? (
                  <ImagingReportForm orderId={order.id} item={it} editable={editable} onSaved={refresh} />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/60 text-xs text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold">Analyte</th>
                          <th className="px-3 py-2 text-left font-semibold">Result</th>
                          <th className="px-3 py-2 text-left font-semibold">Unit</th>
                          <th className="px-3 py-2 text-left font-semibold">Reference</th>
                          <th className="px-3 py-2 text-left font-semibold">Comment</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {it.test.analytes.map((a) => {
                          const k = `${it.id}:${a.id}`;
                          const r = current(it.results, a.id);
                          const ref = intervals[a.id];
                          const v = entry[k]?.value ?? '';
                          const flag = editable && a.resultType === 'NUMERIC' && v !== '' && !Number.isNaN(Number(v)) ? previewFlag(Number(v), ref) : r?.flag ?? null;
                          const history = it.results.filter((x) => x.analyteId === a.id && x.status === 'SUPERSEDED');
                          return (
                            <tr key={a.id} className={cn('border-t', flag?.startsWith('CRITICAL') && 'bg-destructive/5')}>
                              <td className="px-3 py-2 font-medium">{a.name} <span className="text-2xs text-muted-foreground">{a.code}</span></td>
                              <td className="px-3 py-2">
                                {editable ? (
                                  a.resultType === 'OPTION' ? (
                                    <NativeSelect aria-label={a.name} className="h-8 w-40 text-xs" value={v} onChange={(e) => { setEntry({ ...entry, [k]: { ...entry[k], value: e.target.value } }); setDirty(true); }}>
                                      <option value=""></option>
                                      {a.options.map((op) => <option key={op}>{op}</option>)}
                                    </NativeSelect>
                                  ) : (
                                    <div className="flex items-center gap-1.5">
                                      <Input aria-label={a.name} className="h-8 w-28 tabular" inputMode={a.resultType === 'NUMERIC' ? 'decimal' : 'text'} value={v} onChange={(e) => { setEntry({ ...entry, [k]: { ...entry[k], value: e.target.value } }); setDirty(true); }} />
                                      <ResultFlag flag={flag} />
                                    </div>
                                  )
                                ) : (
                                  <span className="flex items-center gap-1.5 tabular font-medium">{fmtValue(r, a.decimals) || '—'} <ResultFlag flag={r?.flag ?? null} />{r?.supersedesId && <Badge variant="warning">Amended</Badge>}</span>
                                )}
                                {history.map((h) => <p key={h.id} className="text-2xs text-muted-foreground line-through">{fmtValue(h, a.decimals)} ({h.enteredByName})</p>)}
                                {r?.amendmentReason && <p className="text-2xs text-warning">Amended: {r.amendmentReason}</p>}
                              </td>
                              <td className="px-3 py-2 text-xs text-muted-foreground">{a.unit}</td>
                              <td className="px-3 py-2 text-xs text-muted-foreground" title={r?.refSource ?? ref?.source}>
                                {r && r.status === 'FINAL' ? (r.refLow != null || r.refHigh != null ? `${r.refLow ?? '–'} – ${r.refHigh ?? '–'}` : '—') : ref ? `${ref.low ?? '–'} – ${ref.high ?? '–'}` : a.resultType === 'NUMERIC' ? 'Not configured' : ''}
                              </td>
                              <td className="px-3 py-2">
                                {editable ? <Input aria-label={`${a.name} comment`} className="h-8 text-xs" value={entry[k]?.comment ?? ''} onChange={(e) => { setEntry({ ...entry, [k]: { ...entry[k], comment: e.target.value } }); setDirty(true); }} /> : <span className="text-xs">{r?.comment}</span>}
                              </td>
                              <td className="px-2 py-2 text-right">
                                {r?.status === 'FINAL' && can('lab.approve') && (
                                  <Button size="icon-sm" variant="ghost" aria-label={`Amend ${a.name}`} onClick={() => setAmend({ result: r, name: a.name, unit: a.unit })}><FilePen /></Button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            ))}
            {editable && order.items.some((i) => i.test.category !== 'IMAGING') && (
              <div className="flex items-center justify-end gap-2">
                <span className="text-xs text-muted-foreground">{dirty ? 'Unsaved changes' : 'Flags shown are a preview; the server records the authoritative flag.'}</span>
                <Button loading={saveResults.isPending} disabled={!dirty} onClick={() => { setError(null); saveResults.mutate(); }}><Save /> Save results</Button>
              </div>
            )}
          </div>

          <div className="grid content-start gap-4">
            {sampleNeeded && (
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><TestTube className="h-4 w-4 text-muted-foreground" /> Samples</CardTitle></CardHeader>
                {editable && (
                  <div className="flex gap-2 border-b p-3">
                    <NativeSelect aria-label="Sample type" className="h-8 text-xs" value={sampleType} onChange={(e) => setSampleType(e.target.value)}>
                      {SAMPLE_TYPES.filter((s) => s !== 'NONE').map((s) => <option key={s} value={s}>{enumLabel(s)}</option>)}
                    </NativeSelect>
                    <Button size="sm" onClick={() => act.mutate(() => api.post(`/lab-orders/${id}/samples`, { sampleType }))}><Barcode /> Collect</Button>
                  </div>
                )}
                {order.samples.length ? (
                  <ul className="divide-y">
                    {order.samples.map((s) => (
                      <li key={s.id} className="grid gap-1.5 px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-semibold">{s.barcode}</span>
                          <span className="text-xs text-muted-foreground">{enumLabel(s.sampleType)}</span>
                          <Badge variant={s.status === 'REJECTED' ? 'destructive' : 'secondary'} className="ml-auto">{enumLabel(s.status)}</Badge>
                        </div>
                        <ol className="text-2xs text-muted-foreground">
                          {s.events.map((e) => <li key={e.id}>{fmtDateTime(e.at)} · {enumLabel(e.action)} · {e.byName}{e.notes && ` — ${e.notes}`}</li>)}
                        </ol>
                        <div className="flex flex-wrap gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setPrinting(s.id)}><Printer /> Label</Button>
                          {editable && !['REJECTED', 'DISPOSED'].includes(s.status) && (
                            <>
                              {s.status === 'COLLECTED' && <Button size="sm" variant="ghost" onClick={() => act.mutate(() => api.post(`/lab-samples/${s.id}/events`, { action: 'RECEIVED' }))}>Received</Button>}
                              {s.status !== 'IN_ANALYSIS' && <Button size="sm" variant="ghost" onClick={() => act.mutate(() => api.post(`/lab-samples/${s.id}/events`, { action: 'IN_ANALYSIS' }))}>Start analysis</Button>}
                              <Button size="sm" variant="ghost" className="text-destructive" onClick={async () => { const r = await confirm({ title: `Reject sample ${s.barcode}?`, requireReason: true, reasonLabel: 'Rejection reason (e.g. haemolysed, clotted, mislabelled)', destructive: true, confirmLabel: 'Reject' }); if (r.confirmed) act.mutate(() => api.post(`/lab-samples/${s.id}/events`, { action: 'REJECTED', notes: r.reason })); }}>Reject</Button>
                            </>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : <EmptyState title="No sample collected yet" className="py-6" />}
              </Card>
            )}
            <Card>
              <CardHeader><CardTitle>External reports & images</CardTitle></CardHeader>
              <CardContent><AttachmentsPanel entityType="DiagnosticOrder" entityId={order.id} canWrite={can('lab.result')} /></CardContent>
            </Card>
            {order.releasedAt && <p className="text-xs text-muted-foreground">Released by {order.releasedByName} · {fmtDateTime(order.releasedAt)}</p>}
          </div>
        </div>
      </div>

      {/* Print layouts */}
      {printing && printing !== 'report' && (() => {
        const s = order.samples.find((x) => x.id === printing);
        return s ? (
          <div className="hidden print:block">
            <div className="border border-black p-2 font-mono text-[10pt]" style={{ width: '6cm' }}>
              <p className="text-center text-[16pt] font-bold tracking-widest">*{s.barcode}*</p>
              <p>{order.patient.name} · {order.patient.patientNo}</p>
              <p>{enumLabel(s.sampleType)} · {fmtDateTime(s.collectedAt)}</p>
              <p>{order.orderNo} · {order.items.map((i) => i.test.code).join(' ')}</p>
            </div>
          </div>
        ) : null;
      })()}
      {printing === 'report' && (
        <div className="hidden text-[10pt] print:block">
          <h1 className="text-[14pt] font-bold">{session.organization?.name} — Laboratory report</h1>
          <p>
            {order.orderNo} · Patient: <b>{order.patient.name}</b> ({order.patient.species.name}, {enumLabel(order.patient.sex)}, {fmtAge(order.patient.dateOfBirth, order.patient.dobEstimated)}) · Owner: {order.client.displayName}
          </p>
          <p>Ordered by {order.orderedByName} on {fmtDateTime(order.createdAt)}{order.releasedAt ? ` · Released by ${order.releasedByName} on ${fmtDateTime(order.releasedAt)}` : ' · PRELIMINARY — not yet validated'}</p>
          {order.items.map((it) => (
            <section key={it.id} className="mt-3">
              <h2 className="font-bold">{it.test.name}</h2>
              {it.imagingReport ? (
                <div><p><b>Findings:</b> {it.imagingReport.findings}</p><p><b>Conclusion:</b> {it.imagingReport.conclusion}</p></div>
              ) : (
                <table className="w-full border-collapse">
                  <thead><tr className="border-b border-black text-left"><th>Analyte</th><th>Result</th><th>Unit</th><th>Reference</th><th>Flag</th></tr></thead>
                  <tbody>
                    {it.test.analytes.map((a) => {
                      const r = current(it.results, a.id);
                      return (
                        <tr key={a.id} className="border-b">
                          <td>{a.name}</td>
                          <td>{fmtValue(r, a.decimals)}</td>
                          <td>{a.unit}</td>
                          <td>{r && (r.refLow != null || r.refHigh != null) ? `${r.refLow ?? ''}–${r.refHigh ?? ''}` : ''}</td>
                          <td>{r?.flag && r.flag !== 'NORMAL' ? enumLabel(r.flag) : ''}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </section>
          ))}
        </div>
      )}
      {amend && <AmendDialog orderId={order.id} amend={amend} onClose={() => setAmend(null)} onSaved={refresh} />}
    </>
  );
}

function ImagingReportForm({ orderId, item, editable, onSaved }: { orderId: string; item: DiagnosticOrder['items'][number]; editable: boolean; onSaved: () => void }) {
  const r = item.imagingReport;
  const [f, setF] = useState({ modality: r?.modality ?? item.test.modality ?? 'XRAY', bodyRegion: r?.bodyRegion ?? '', views: r?.views ?? '', findings: r?.findings ?? '', conclusion: r?.conclusion ?? '', recommendations: r?.recommendations ?? '', studyInstanceUid: r?.studyInstanceUid ?? '' });
  const save = useMutation({
    mutationFn: () => api.put(`/lab-orders/${orderId}/items/${item.id}/imaging-report`, f),
    onSuccess: () => { toast.success('Imaging report saved'); onSaved(); },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!editable) {
    return r ? (
      <CardContent className="grid gap-2 text-sm">
        <p className="text-xs text-muted-foreground">{enumLabel(r.modality)}{r.bodyRegion && ` · ${r.bodyRegion}`}{r.views && ` · ${r.views}`} · reported by {r.reportedByName} {fmtDateTime(r.reportedAt)}</p>
        <p><span className="font-medium">Findings:</span> <span className="whitespace-pre-wrap">{r.findings}</span></p>
        <p><span className="font-medium">Conclusion:</span> {r.conclusion}</p>
        {r.recommendations && <p><span className="font-medium">Recommendations:</span> {r.recommendations}</p>}
      </CardContent>
    ) : <EmptyState title="No report yet" className="py-6" />;
  }
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  return (
    <CardContent className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Modality" htmlFor={`im-m-${item.id}`}><NativeSelect id={`im-m-${item.id}`} value={f.modality} onChange={set('modality')}>{IMAGING_MODALITIES.map((m) => <option key={m} value={m}>{enumLabel(m)}</option>)}</NativeSelect></Field>
        <Field label="Region" htmlFor={`im-r-${item.id}`}><Input id={`im-r-${item.id}`} value={f.bodyRegion} onChange={set('bodyRegion')} /></Field>
        <Field label="Views / planes" htmlFor={`im-v-${item.id}`}><Input id={`im-v-${item.id}`} value={f.views} onChange={set('views')} /></Field>
      </div>
      <Field label="Findings" htmlFor={`im-f-${item.id}`} required><Textarea id={`im-f-${item.id}`} rows={4} value={f.findings} onChange={set('findings')} /></Field>
      <Field label="Conclusion" htmlFor={`im-c-${item.id}`} required><Textarea id={`im-c-${item.id}`} rows={2} value={f.conclusion} onChange={set('conclusion')} /></Field>
      <Field label="Recommendations" htmlFor={`im-rec-${item.id}`}><Input id={`im-rec-${item.id}`} value={f.recommendations} onChange={set('recommendations')} /></Field>
      <Field label="DICOM Study Instance UID (optional)" htmlFor={`im-uid-${item.id}`} hint="For linking to a PACS. Upload images or DICOM files under External reports & images."><Input id={`im-uid-${item.id}`} value={f.studyInstanceUid} onChange={set('studyInstanceUid')} /></Field>
      <div className="flex justify-end"><Button size="sm" disabled={!f.findings.trim() || !f.conclusion.trim()} loading={save.isPending} onClick={() => save.mutate()}><Save /> Save report</Button></div>
    </CardContent>
  );
}

function AmendDialog({ orderId, amend, onClose, onSaved }: { orderId: string; amend: { result: LabResult; name: string; unit: string | null }; onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState(amend.result.valueNumeric !== null ? String(amend.result.valueNumeric) : amend.result.valueText ?? '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const numeric = amend.result.valueNumeric !== null;
  const m = useMutation({
    mutationFn: () => api.post(`/lab-results/${amend.result.id}/amend`, { valueNumeric: numeric ? Number(value) : null, valueText: numeric ? null : value, amendmentReason: reason }),
    onSuccess: () => { toast.success('Result amended — original retained'); onSaved(); onClose(); },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <DialogHeader><DialogTitle>Amend {amend.name}</DialogTitle></DialogHeader>
        {error && <FormError message={error} />}
        <p className="text-sm text-muted-foreground">Released value: {amend.result.valueNumeric ?? amend.result.valueText} {amend.unit} ({amend.result.enteredByName}). The original stays in the record.</p>
        <Field label={`Corrected value${amend.unit ? ` (${amend.unit})` : ''}`} htmlFor="am-v" required><Input id="am-v" value={value} onChange={(e) => setValue(e.target.value)} inputMode={numeric ? 'decimal' : 'text'} /></Field>
        <Field label="Reason for amendment" htmlFor="am-r" required><Input id="am-r" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!reason.trim() || value === ''} loading={m.isPending} onClick={() => m.mutate()}>Save amendment</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function LabOrderPage() {
  return (
    <RequirePermission anyOf={['lab.read']}>
      <OrderView />
    </RequirePermission>
  );
}
