'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { NOTE_PHRASE_FIELDS, NOTE_PHRASE_FIELD_LABELS, enumLabel, type NotePhraseField } from '@vcms/shared';
import { Clock, FileText, FlaskConical, History, Pill, Plus, RotateCcw, Stethoscope, Syringe, X } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { LabOrderDetail } from '../lab/order-detail';
import { LabOrderDialog } from '../lab/order-dialog';
import { ErrorState, LoadingRows } from '../page';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog';
import { api } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtWeight } from '@/lib/format';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

type Row = Record<string, any>;

export type PastTab = 'notes' | 'vitals' | 'problems' | 'diagnoses' | 'medicines' | 'prescriptions' | 'tests' | 'documents';
type Applier = (field: NotePhraseField, text: string, mode: 'replace' | 'append') => string;

interface PastCtx {
  /** Opens the panel beside the consultation, on a tab (and, for notes, a field). */
  open: (tab: PastTab, field?: NotePhraseField) => void;
  /** The note editor says how to put text into a field. */
  registerApplier: (fn: Applier | null) => void;
  /** The text of a note field at the patient's most recent earlier visit that has it. */
  lastText: (field: NotePhraseField) => { text: string; at: string } | null;
  ready: boolean;
}
const Ctx = createContext<PastCtx | null>(null);
export const usePastRecords = () => useContext(Ctx);

const TABS: { id: PastTab; label: string; icon: React.ComponentType<{ className?: string }>; section: string }[] = [
  { id: 'notes', label: 'Notes', icon: FileText, section: 'consultations' },
  { id: 'vitals', label: 'Vitals', icon: Stethoscope, section: 'consultations' },
  { id: 'problems', label: 'Problems', icon: History, section: 'problems' },
  { id: 'diagnoses', label: 'Diagnoses', icon: Stethoscope, section: 'consultations' },
  { id: 'medicines', label: 'Medicines given', icon: Syringe, section: 'administrations' },
  { id: 'prescriptions', label: 'Prescriptions', icon: Pill, section: 'prescriptions' },
  { id: 'tests', label: 'Tests', icon: FlaskConical, section: 'diagnostics' },
  { id: 'documents', label: 'Documents & photos', icon: FileText, section: 'documents' },
];

const SHORT: Record<NotePhraseField, string> = {
  presentingComplaint: 'Complaint',
  history: 'Past history',
  subjective: 'Client’s story',
  objective: 'Examination',
  assessment: 'Assessment',
  plan: 'Plan',
  followUpInstructions: 'Instructions',
};

interface PastData {
  sections: { name: string; data: any }[];
}

function useRecord(patientId: string, enabled: boolean) {
  return useQuery({ queryKey: ['patient-record', patientId], queryFn: () => api.get<PastData>(`/patients/${patientId}/record`), enabled, staleTime: 30_000 });
}

const section = (d: PastData | undefined, name: string): any => d?.sections.find((s) => s.name === name)?.data;
const latestSigned = (c: Row) => (c.notes ?? []).filter((n: Row) => n.status === 'SIGNED').sort((a: Row, b: Row) => b.version - a.version)[0] as Row | undefined;

/**
 * Wraps a consultation so earlier records can be opened in a panel BESIDE the work: the vet reads what was
 * written before, copies what still applies, and writes the new entry next to it.
 */
export function PastRecordsProvider({ patientId, patientName, encounterId, children }: { patientId: string; patientName: string; encounterId: string; children: React.ReactNode }) {
  const { canAny } = useSession();
  const allowed = canAny('clinical.read', 'prescriptions.read', 'lab.read');
  const [view, setView] = useState<{ tab: PastTab; field: NotePhraseField } | null>(null);
  const applier = useRef<Applier | null>(null);
  const q = useRecord(patientId, allowed);

  const lastText = useCallback(
    (field: NotePhraseField) => {
      const visits = ((section(q.data, 'consultations') as Row[] | undefined) ?? []).filter((c) => c.id !== encounterId).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      for (const c of visits) {
        const n = latestSigned(c);
        const t = n?.[field];
        if (typeof t === 'string' && t.trim()) return { text: t.trim(), at: c.startedAt as string };
      }
      return null;
    },
    [q.data, encounterId],
  );
  const value = useMemo<PastCtx>(
    () => ({
      open: (tab, field) => setView((v) => ({ tab, field: field ?? v?.field ?? 'history' })),
      registerApplier: (fn) => {
        applier.current = fn;
      },
      lastText,
      ready: !!q.data,
    }),
    [lastText, q.data],
  );

  if (!allowed) return <>{children}</>;
  return (
    <Ctx.Provider value={value}>
      <div className={cn('grid min-w-0 gap-4', view && 'lg:grid-cols-[minmax(0,1fr)_28rem]')}>
        <div className="min-w-0">{children}</div>
        {view && (
          <PastPanel
            patientId={patientId}
            patientName={patientName}
            encounterId={encounterId}
            tab={view.tab}
            field={view.field}
            onTab={(tab) => setView((v) => (v ? { ...v, tab } : v))}
            onField={(field) => setView((v) => (v ? { ...v, field } : v))}
            onClose={() => setView(null)}
            apply={(f, text, mode) => applier.current?.(f, text, mode) ?? ''}
          />
        )}
      </div>
    </Ctx.Provider>
  );
}

/** A small "Past" button that opens the panel on the right tab. Hidden when the user cannot see past records. */
export function PastButton({ tab, field, label, className }: { tab: PastTab; field?: NotePhraseField; label?: string; className?: string }) {
  const past = usePastRecords();
  if (!past) return null;
  return (
    <button
      type="button"
      onClick={() => past.open(tab, field)}
      title="Show earlier records beside this visit"
      className={cn('inline-flex h-7 items-center gap-1 rounded-lg surface-flat px-2 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}
    >
      <Clock className="h-3 w-3" /> {label ?? 'Past'}
    </button>
  );
}

function PastPanel({
  patientId,
  patientName,
  encounterId,
  tab,
  field,
  onTab,
  onField,
  onClose,
  apply,
}: {
  patientId: string;
  patientName: string;
  encounterId: string;
  tab: PastTab;
  field: NotePhraseField;
  onTab: (t: PastTab) => void;
  onField: (f: NotePhraseField) => void;
  onClose: () => void;
  apply: Applier;
}) {
  const q = useRecord(patientId, true);
  const names = new Set((q.data?.sections ?? []).map((s) => s.name));
  const tabs = TABS.filter((t) => names.has(t.section));
  const active = tabs.some((t) => t.id === tab) ? tab : tabs[0]?.id;
  return (
    <aside aria-label="Past records" className="fixed inset-x-0 bottom-0 top-16 z-40 flex flex-col overflow-hidden border-t bg-card shadow-pop lg:sticky lg:inset-auto lg:top-20 lg:z-0 lg:h-[calc(100vh-6rem)] lg:rounded-xl lg:border">
      <header className="flex items-start gap-2 border-b bg-muted/30 px-4 py-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Clock className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Past records</h2>
          <p className="truncate text-xs text-muted-foreground">{patientName} · read the earlier entry, copy what still applies, write the new one beside it</p>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close past records"><X /></Button>
      </header>
      <nav aria-label="Kinds of past record" className="flex gap-1 overflow-x-auto border-b px-2 py-1.5">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-current={t.id === active ? 'page' : undefined}
            onClick={() => onTab(t.id)}
            className={cn('shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors', t.id === active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {q.isLoading ? <LoadingRows rows={5} /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !active ? <p className="text-sm text-muted-foreground">Nothing earlier to show.</p> : (
          <>
            {active === 'notes' && <NotesTab data={q.data!} encounterId={encounterId} field={field} onField={onField} apply={apply} />}
            {active === 'vitals' && <VitalsTab data={q.data!} encounterId={encounterId} />}
            {active === 'problems' && <ProblemsTab data={q.data!} patientId={patientId} />}
            {active === 'diagnoses' && <DiagnosesTab data={q.data!} encounterId={encounterId} />}
            {active === 'medicines' && <MedicinesTab data={q.data!} encounterId={encounterId} />}
            {active === 'prescriptions' && <PrescriptionsTab data={q.data!} encounterId={encounterId} />}
            {active === 'tests' && <TestsTab data={q.data!} patientId={patientId} encounterId={encounterId} />}
            {active === 'documents' && <DocumentsTab data={q.data!} />}
          </>
        )}
      </div>
    </aside>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">{children}</p>;

function Visit({ at, children, meta }: { at: string; meta?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl surface-flat">
      <header className="flex flex-wrap items-baseline gap-x-2 border-b px-3 py-2">
        <h3 className="text-sm font-semibold">{fmtDate(at)}</h3>
        {meta && <span className="text-xs text-muted-foreground">{meta}</span>}
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}

/* ── Notes ─────────────────────────────────────────────────────────────────────────────────────── */

function NotesTab({ data, encounterId, field, onField, apply }: { data: PastData; encounterId: string; field: NotePhraseField; onField: (f: NotePhraseField) => void; apply: Applier }) {
  const visits = ((section(data, 'consultations') as Row[]) ?? []).filter((c) => c.id !== encounterId).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const rows = visits.map((c) => ({ c, text: String(latestSigned(c)?.[field] ?? '').trim() })).filter((r) => r.text);
  const use = (text: string, mode: 'replace' | 'append') => {
    const before = apply(field, text, mode);
    toast.success(mode === 'replace' ? `${NOTE_PHRASE_FIELD_LABELS[field]} filled from the past` : 'Added below what you wrote', {
      action: { label: 'Undo', onClick: () => apply(field, before, 'replace') },
    });
  };
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Note field">
        {NOTE_PHRASE_FIELDS.map((f) => (
          <button key={f} type="button" role="tab" aria-selected={f === field} onClick={() => onField(f)} className={cn('rounded-full border px-2.5 py-1 text-xs font-medium transition-colors', f === field ? 'border-primary bg-primary text-primary-foreground' : 'hover:border-primary/50 hover:bg-primary/5')}>
            {SHORT[f]}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Earlier {NOTE_PHRASE_FIELD_LABELS[field].toLowerCase()}, newest first. Only signed notes are shown.</p>
      {rows.length === 0 && <Empty>Nothing written here at earlier visits.</Empty>}
      {rows.map(({ c, text }) => (
        <Visit key={c.id} at={c.startedAt} meta={`${c.encounterNo} · ${c.clinician ?? 'No vet recorded'}${c.chiefComplaint ? ` · ${c.chiefComplaint}` : ''}`}>
          <p className="whitespace-pre-wrap text-sm">{text}</p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => use(text, 'replace')}>Use this</Button>
            <Button size="sm" variant="outline" onClick={() => use(text, 'append')}><Plus /> Add to mine</Button>
          </div>
        </Visit>
      ))}
    </div>
  );
}

/* ── Vitals ────────────────────────────────────────────────────────────────────────────────────── */

function VitalsTab({ data, encounterId }: { data: PastData; encounterId: string }) {
  const rows = ((section(data, 'consultations') as Row[]) ?? []).filter((c) => c.id !== encounterId).flatMap((c) => (c.vitals ?? []).map((v: Row) => ({ ...v, no: c.encounterNo }))).sort((a: Row, b: Row) => b.recordedAt.localeCompare(a.recordedAt)).slice(0, 25);
  if (!rows.length) return <Empty>No vital signs at earlier visits.</Empty>;
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full text-xs">
        <thead className="bg-muted/40 text-left text-muted-foreground">
          <tr>{['Date', 'Temp °C', 'Heart', 'Breathing', 'Weight', 'Pain'].map((h) => <th key={h} className="px-2.5 py-2 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((v: Row) => (
            <tr key={v.id} className="border-t">
              <td className="px-2.5 py-1.5 font-medium">{fmtDate(v.recordedAt)}</td>
              <td className="px-2.5 py-1.5 tabular">{v.temperatureC ?? '—'}</td>
              <td className="px-2.5 py-1.5 tabular">{v.heartRate ?? '—'}</td>
              <td className="px-2.5 py-1.5 tabular">{v.respiratoryRate ?? '—'}</td>
              <td className="px-2.5 py-1.5 tabular">{v.weightKg != null ? fmtWeight(Number(v.weightKg)) : '—'}</td>
              <td className="px-2.5 py-1.5 tabular">{v.painScore ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Problems ──────────────────────────────────────────────────────────────────────────────────── */

function ProblemsTab({ data, patientId }: { data: PastData; patientId: string }) {
  const qc = useQueryClient();
  const { can } = useSession();
  const rows = ((section(data, 'problems') as Row[]) ?? []).slice().sort((a, b) => (a.status === 'RESOLVED' ? 1 : 0) - (b.status === 'RESOLVED' ? 1 : 0) || b.createdAt.localeCompare(a.createdAt));
  const add = useMutation({
    mutationFn: (p: Row) => api.post(`/patients/${patientId}/problems`, { term: p.term, isChronic: !!p.isChronic, onsetDate: new Date().toISOString().slice(0, 10) }),
    onSuccess: () => {
      toast.success('Added to the current problem list');
      qc.invalidateQueries({ queryKey: ['problems', patientId] });
      qc.invalidateQueries({ queryKey: ['patient-record', patientId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!rows.length) return <Empty>No problems on this patient’s list.</Empty>;
  return (
    <ul className="grid gap-2">
      {rows.map((p) => (
        <li key={p.id} className="flex items-start gap-3 rounded-xl surface-flat p-3">
          <div className="min-w-0 flex-1">
            <p className={cn('text-sm font-medium', p.status === 'RESOLVED' && 'text-muted-foreground')}>{p.term}{p.isChronic && <Badge variant="outline" className="ml-2">Long-term</Badge>}</p>
            <p className="text-xs text-muted-foreground">{p.onsetDate ? `Since ${fmtDate(p.onsetDate)}` : `Added ${fmtDate(p.createdAt)}`}{p.resolvedDate ? ` · resolved ${fmtDate(p.resolvedDate)}` : ''}</p>
            {p.notes && <p className="mt-1 text-xs">{p.notes}</p>}
          </div>
          {p.status === 'RESOLVED' ? (
            can('clinical.write') && <Button size="sm" variant="outline" loading={add.isPending} onClick={() => add.mutate(p)}><RotateCcw /> Add again</Button>
          ) : <Badge variant="warning">Current</Badge>}
        </li>
      ))}
    </ul>
  );
}

/* ── Diagnoses ─────────────────────────────────────────────────────────────────────────────────── */

function DiagnosesTab({ data, encounterId }: { data: PastData; encounterId: string }) {
  const qc = useQueryClient();
  const { can } = useSession();
  const visits = ((section(data, 'consultations') as Row[]) ?? []).filter((c) => c.id !== encounterId && c.diagnoses?.length).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const add = useMutation({
    mutationFn: (d: Row) => api.post(`/encounters/${encounterId}/diagnoses`, { term: d.term, type: 'PROVISIONAL', code: d.code ?? null, codeSystem: d.code ? (d.codeSystem ?? 'Local') : null, addToProblemList: false }),
    onSuccess: () => {
      toast.success('Added to this visit’s diagnoses');
      qc.invalidateQueries({ queryKey: ['encounter', encounterId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!visits.length) return <Empty>No diagnoses at earlier visits.</Empty>;
  return (
    <div className="grid gap-3">
      {visits.map((c) => (
        <Visit key={c.id} at={c.startedAt} meta={`${c.encounterNo} · ${c.clinician ?? ''}`}>
          <ul className="grid gap-2">
            {c.diagnoses.map((d: Row) => (
              <li key={d.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 text-sm"><span className="font-medium">{d.term}</span> <span className="text-xs text-muted-foreground">{enumLabel(d.type)}</span></span>
                {can('clinical.write') && <Button size="sm" variant="outline" loading={add.isPending && add.variables?.id === d.id} onClick={() => add.mutate(d)}><Plus /> Add</Button>}
              </li>
            ))}
          </ul>
        </Visit>
      ))}
    </div>
  );
}

/* ── Medicines given in the clinic ─────────────────────────────────────────────────────────────── */

function MedicinesTab({ data, encounterId }: { data: PastData; encounterId: string }) {
  const rows = ((section(data, 'administrations') as Row[]) ?? []).filter((a) => a.encounterId !== encounterId && a.status === 'GIVEN').sort((a, b) => b.administeredAt.localeCompare(a.administeredAt));
  if (!rows.length) return <Empty>No medicines were given in the clinic at earlier visits.</Empty>;
  return (
    <ul className="grid gap-2">
      {rows.map((a) => (
        <li key={a.id} className="rounded-xl surface-flat p-3">
          <p className="text-sm font-medium">{a.product?.name}</p>
          <p className="text-xs text-muted-foreground">{a.dose} {a.doseUnit} · {enumLabel(a.route)}{a.site ? ` (${a.site})` : ''} · {fmtDateTime(a.administeredAt)} · {a.administeredByName}</p>
          {a.notes && <p className="mt-1 text-xs">{a.notes}</p>}
        </li>
      ))}
    </ul>
  );
}

/* ── Prescriptions ─────────────────────────────────────────────────────────────────────────────── */

function PrescriptionsTab({ data, encounterId }: { data: PastData; encounterId: string }) {
  const qc = useQueryClient();
  const { can } = useSession();
  const rows = ((section(data, 'prescriptions') as Row[]) ?? []).filter((p) => p.encounterId !== encounterId && p.status !== 'CANCELLED').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const again = useMutation({
    mutationFn: (id: string) => api.post(`/prescriptions/${id}/repeat`, { encounterId }),
    onSuccess: () => {
      toast.success('Added to this visit as a draft. Check the doses and weight, then authorise it.');
      qc.invalidateQueries({ queryKey: ['prescriptions'] });
      qc.invalidateQueries({ queryKey: ['patient-record'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!rows.length) return <Empty>No earlier prescriptions.</Empty>;
  return (
    <div className="grid gap-3">
      {rows.map((p) => (
        <Visit key={p.id} at={p.createdAt} meta={`${p.prescriptionNo} · ${enumLabel(p.status)}${p.authorizedByName ? ` · ${p.authorizedByName}` : ''}`}>
          <ul className="grid gap-1.5">
            {(p.items ?? []).map((i: Row) => (
              <li key={i.id} className="text-sm">
                <span className="font-medium">{i.product?.name}</span>
                <span className="text-xs text-muted-foreground"> — {i.doseValue} {i.doseUnit} {enumLabel(i.route).toLowerCase()}, {i.frequencyText}{i.durationDays ? `, ${i.durationDays} days` : ''}</span>
              </li>
            ))}
          </ul>
          {p.notes && <p className="mt-1.5 text-xs">{p.notes}</p>}
          {can('prescriptions.write') && (
            <div className="mt-2.5">
              <Button size="sm" loading={again.isPending && again.variables === p.id} onClick={() => again.mutate(p.id)}><RotateCcw /> Prescribe again</Button>
              <p className="mt-1 text-2xs text-muted-foreground">Copies the medicines into this visit as a draft. Doses are copied as written, so check them against today’s weight.</p>
            </div>
          )}
        </Visit>
      ))}
    </div>
  );
}

/* ── Tests ─────────────────────────────────────────────────────────────────────────────────────── */

function TestsTab({ data, patientId, encounterId }: { data: PastData; patientId: string; encounterId: string }) {
  const { can } = useSession();
  const [view, setView] = useState<string | null>(null);
  const [again, setAgain] = useState<string[] | null>(null);
  const rows = ((section(data, 'diagnostics') as Row[]) ?? []).filter((o) => o.encounterId !== encounterId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (!rows.length) return <Empty>No tests at earlier visits.</Empty>;
  return (
    <div className="grid gap-3">
      {rows.map((o) => (
        <Visit key={o.id} at={o.createdAt} meta={`${o.orderNo} · ${enumLabel(o.status)}`}>
          <p className="text-sm font-medium">{(o.items ?? []).map((i: Row) => i.test?.name).join(', ')}</p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setView(o.id)}>View results</Button>
            {can('lab.order') && <Button size="sm" variant="outline" onClick={() => setAgain((o.items ?? []).map((i: Row) => i.testId).filter(Boolean))}><RotateCcw /> Order again</Button>}
          </div>
        </Visit>
      ))}
      <Dialog open={!!view} onOpenChange={(o) => !o && setView(null)}>
        <DialogContent size="xl" className="max-h-[90vh] overflow-y-auto">
          <DialogTitle className="sr-only">Lab or X-ray order</DialogTitle>
          <DialogDescription className="sr-only">Tests and results of an earlier visit.</DialogDescription>
          {view && <LabOrderDetail id={view} embedded />}
        </DialogContent>
      </Dialog>
      <LabOrderDialog open={!!again} onOpenChange={(o) => !o && setAgain(null)} patient={{ id: patientId, name: '' }} encounterId={encounterId} initialTestIds={again ?? []} />
    </div>
  );
}

/* ── Documents & photos ────────────────────────────────────────────────────────────────────────── */

function DocumentsTab({ data }: { data: PastData }) {
  const rows = ((section(data, 'documents') as Row[]) ?? []).slice().sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  if (!rows.length) return <Empty>No photos or documents for this patient.</Empty>;
  return (
    <ul className="grid grid-cols-2 gap-3">
      {rows.map((d) => {
        const image = String(d.mimeType).startsWith('image/');
        return (
          <li key={d.id}>
            <a href={`${d.downloadPath}?inline=1`} target="_blank" rel="noopener noreferrer" className="group block overflow-hidden rounded-xl surface-flat transition-shadow hover:shadow-card-hover" title={d.fileName}>
              <span className="grid aspect-[4/3] place-items-center overflow-hidden bg-muted">
                {image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`${d.downloadPath}?inline=1`} alt={d.description || d.fileName} loading="lazy" className="h-full w-full object-cover transition-transform group-hover:scale-105" />
                ) : (
                  <FileText className="h-8 w-8 text-muted-foreground" />
                )}
              </span>
              <span className="block px-2.5 py-2">
                <span className="block truncate text-xs font-medium">{d.description || d.fileName}</span>
                <span className="block text-2xs text-muted-foreground">{fmtDate(d.uploadedAt)}{d.category ? ` · ${enumLabel(d.category)}` : ''}</span>
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
