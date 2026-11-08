'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DENTITION_LABELS, dentalProcedure, PERIODONTAL_STAGES, teethFor, toothInfo, worstStage } from '@vcms/shared';
import { ArrowLeft, BadgeCheck, FileSignature, History, Lock, MousePointerClick, Printer, ShieldAlert, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useConfirm } from '@/components/confirm';
import { MouthCard, ProceduresCard } from '@/components/dental/chart-sections';
import { Odontogram, OdontogramLegend, toothCodes, toothTone, toothWords } from '@/components/dental/odontogram';
import { ToothActions } from '@/components/dental/tooth-actions';
import { useToothTests } from '@/components/dental/tooth-tests';
import { ToothEditor, type ToothPayload } from '@/components/dental/tooth-editor';
import { ErrorState, LoadingRows, PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/input';
import { api } from '@/lib/api';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { DentalChart, DentalTooth } from '@/lib/types';

/** Quick selections: each quadrant, plus every adult or baby tooth. */
function quadrantButtons(chart: DentalChart) {
  const sets: { label: string; teeth: string[] }[] = [];
  const adult = teethFor(chart.dentition);
  const names = ['Upper right', 'Upper left', 'Lower left', 'Lower right'];
  [1, 2, 3, 4].forEach((q, i) => sets.push({ label: names[i], teeth: adult.filter((t) => t.quadrant === q).map((t) => t.id) }));
  sets.push({ label: 'All incisors', teeth: adult.filter((t) => t.type === 'incisor').map((t) => t.id) });
  sets.push({ label: 'All adult teeth', teeth: adult.map((t) => t.id) });
  return sets;
}

function ToothHistory({ patientId, tooth, chartId, dentition }: { patientId: string; tooth: string; chartId: string; dentition: DentalChart['dentition'] }) {
  const q = useQuery({ queryKey: ['patient-dental', patientId], queryFn: () => api.get<{ charts: DentalChart[] }>(`/patients/${patientId}/dental`) });
  const past = (q.data?.charts ?? []).filter((c) => c.id !== chartId && c.status === 'SIGNED' && c.dentition === dentition);
  if (!past.length) return null;
  return (
    <div className="mt-4 border-t pt-3">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><History className="h-3.5 w-3.5" /> {tooth} at earlier visits</p>
      <ul className="grid gap-1.5 text-xs">
        {past.slice(0, 6).map((c) => {
          const t = c.teeth.find((x) => x.tooth === tooth);
          const procs = c.procedures.filter((p) => p.tooth === tooth).map((p) => p.label);
          const codes = toothCodes(t);
          return (
            <li key={c.id} className="flex gap-2">
              <Link href={`/dental/${c.id}`} className="w-20 shrink-0 text-primary hover:underline">{fmtDate(c.examinedAt)}</Link>
              <span className="min-w-0">{[codes.join(' '), procs.join(', ')].filter(Boolean).join(' · ') || <span className="text-muted-foreground">Nothing recorded</span>}{t?.notes && <span className="text-muted-foreground"> — {t.notes}</span>}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function FindingsList({ chart, onPick }: { chart: DentalChart; onPick: (tooth: string) => void }) {
  const rows = chart.teeth.filter((t) => toothWords(t).length || t.notes).sort((a, b) => a.tooth.localeCompare(b.tooth));
  if (!rows.length) return <p className="text-sm text-muted-foreground">No tooth findings recorded yet.</p>;
  return (
    <ul className="grid gap-1">
      {rows.map((t) => {
        const tone = toothTone(t);
        return (
          <li key={t.tooth}>
            <button type="button" className="flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-muted" onClick={() => onPick(t.tooth)}>
              <span className={`mt-0.5 grid h-6 min-w-9 place-items-center rounded-md px-1 text-xs font-bold tabular ${tone === 'severe' ? 'bg-destructive/15 text-destructive' : tone === 'absent' ? 'bg-muted text-muted-foreground' : 'bg-warning/20 text-foreground'}`}>{t.tooth}</span>
              <span className="min-w-0">
                <span className="block text-xs text-muted-foreground">{toothInfo(chart.dentition, t.tooth)?.name ?? ''}</span>
                <span className="block text-sm">{[...toothWords(t), t.notes].filter(Boolean).join(' · ')}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** One line under the header: how the mouth is, at a glance. */
function ChartSummary({ chart }: { chart: DentalChart }) {
  const stage = chart.periodontalStage ?? worstStage(chart.teeth);
  const findings = chart.teeth.filter((t) => t.state === 'PRESENT' && toothWords(t).length).length;
  const missing = chart.teeth.filter((t) => t.state === 'MISSING' || t.state === 'EXTRACTED').length;
  const extractions = chart.procedures.filter((p) => dentalProcedure(p.code)?.removesTooth).length;
  const item = (label: string, value: React.ReactNode, tone?: 'warn' | 'bad') => (
    <div className="min-w-0 rounded-xl border bg-card px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-sm font-semibold leading-snug ${tone === 'bad' ? 'text-destructive' : tone === 'warn' ? 'text-warning' : ''}`}>{value}</p>
    </div>
  );
  return (
    <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Chart summary">
      {item('Periodontal stage', stage != null ? `${PERIODONTAL_STAGES[stage].label} — ${PERIODONTAL_STAGES[stage].hint.toLowerCase()}` : 'Not scored', stage != null && stage >= 3 ? 'bad' : stage ? 'warn' : undefined)}
      {item('Teeth with findings', findings, findings ? 'warn' : undefined)}
      {item('Missing / extracted', missing + extractions)}
      {item('Procedures', chart.procedures.length ? `${chart.procedures.length}${extractions ? ` · ${extractions} extraction${extractions === 1 ? '' : 's'}` : ''}` : 'None yet')}
    </div>
  );
}

function ChartPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { can } = useSession();
  const key = ['dental-chart', id];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<DentalChart>(`/dental/charts/${id}`) });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [addendum, setAddendum] = useState('');
  const setChart = (c: DentalChart) => {
    qc.setQueryData(key, c);
    qc.invalidateQueries({ queryKey: ['patient-dental', c.patientId] });
    if (c.encounterId) qc.invalidateQueries({ queryKey: ['encounter-dental', c.encounterId] });
  };

  // Saved as the vet goes (the tooth editor saves a moment after each change).
  const saveTeeth = useMutation({
    mutationFn: (teeth: ToothPayload[]) => api.put<DentalChart>(`/dental/charts/${id}/teeth`, { teeth }),
    onSuccess: setChart,
    onError: (e: Error) => toast.error(e.message),
  });
  const deciduousToggle = useMutation({
    mutationFn: (show: boolean) => api.patch<DentalChart>(`/dental/charts/${id}`, { showDeciduous: show }),
    onSuccess: setChart,
    onError: (e: Error) => toast.error(e.message),
  });
  const sign = useMutation({
    mutationFn: () => api.post<DentalChart>(`/dental/charts/${id}/sign`),
    onSuccess: (c) => {
      setChart(c);
      setSelected(new Set());
      toast.success('Dental chart signed and locked');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const discard = useMutation({
    mutationFn: () => api.del(`/dental/charts/${id}`),
    onSuccess: () => {
      if (q.data!.encounterId) qc.invalidateQueries({ queryKey: ['encounter-dental', q.data!.encounterId] });
      toast.success('Draft discarded');
      router.push(`/patients/${q.data!.patientId}?tab=dental`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const addAddendum = useMutation({
    mutationFn: () => api.post<DentalChart>(`/dental/charts/${id}/addenda`, { text: addendum }),
    onSuccess: (c) => {
      setChart(c);
      setAddendum('');
      toast.success('Addendum added');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const chart = q.data;
  const adult = useMemo(() => (chart ? teethFor(chart.dentition) : []), [chart]);
  const baby = useMemo(() => (chart ? teethFor(chart.dentition, true) : []), [chart]);
  const tested = useToothTests(chart?.patientId, chart?.encounterId);
  if (q.isLoading) return <LoadingRows />;
  if (q.error || !chart) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;

  const editable = chart.status === 'DRAFT' && can('clinical.write');
  const toggle = (t: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(t)) n.delete(t);
      else n.add(t);
      return n;
    });
  const sel = [...selected].sort();
  const findings: DentalTooth[] = chart.teeth;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Patients', href: '/patients' }, { label: chart.patient.name, href: `/patients/${chart.patient.id}?tab=dental` }, { label: chart.chartNo }]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            Dental chart
            <Badge variant={chart.status === 'SIGNED' ? 'success' : 'warning'}>{chart.status === 'SIGNED' ? 'Signed' : 'Draft'}</Badge>
          </span>
        }
        description={
          <>
            {chart.chartNo} · {chart.patient.name} ({chart.patient.species.name}{chart.patient.breed?.name || chart.patient.breedText ? `, ${chart.patient.breed?.name ?? chart.patient.breedText}` : ''}) · {chart.client.displayName} · {fmtDateTime(chart.examinedAt)} · {chart.clinicianName}
          </>
        }
        help="dental"
        actions={
          <>
            {chart.encounterId && (
              <Button size="sm" variant="ghost" asChild>
                <Link href={`/consultations/${chart.encounterId}`}><ArrowLeft /> Back to consultation</Link>
              </Button>
            )}
            <Button size="sm" variant="outline" asChild>
              <Link href={`/dental/${chart.id}/print`}><Printer /> Print report</Link>
            </Button>
            {chart.status === 'DRAFT' && can('clinical.write') && (
              <Button
                size="sm"
                variant="outline"
                loading={discard.isPending}
                onClick={async () => {
                  const r = await confirm({ title: 'Discard this draft chart?', description: 'Its findings are deleted and its unbilled procedure charges are waived.', confirmLabel: 'Discard', destructive: true });
                  if (r.confirmed) discard.mutate();
                }}
              >
                <Trash2 /> Discard
              </Button>
            )}
            {chart.status === 'DRAFT' && can('clinical.sign') && (
              <Button
                size="sm"
                loading={sign.isPending}
                onClick={async () => {
                  const r = await confirm({ title: 'Sign this dental chart?', description: 'Signing locks the chart. Later notes can only be added as addenda.', confirmLabel: 'Sign and lock' });
                  if (r.confirmed) sign.mutate();
                }}
              >
                <FileSignature /> Sign
              </Button>
            )}
          </>
        }
      />

      {chart.status === 'SIGNED' && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-success/30 bg-success/5 px-4 py-2.5 text-sm">
          <Lock className="h-4 w-4 text-success" />
          <span>Signed by <b>{chart.signedByName}</b> on {fmtDateTime(chart.signedAt)}. The chart is locked; add an addendum for later notes.</span>
          {chart.integrity === 'VERIFIED' && <span className="ml-auto flex items-center gap-1 text-xs text-success"><BadgeCheck className="h-4 w-4" /> Unchanged since signing</span>}
          {chart.integrity === 'MISMATCH' && <span className="ml-auto flex items-center gap-1 text-xs font-semibold text-destructive"><ShieldAlert className="h-4 w-4" /> Content differs from what was signed</span>}
        </div>
      )}
      {chart.previous && chart.status === 'DRAFT' && (
        <p className="mb-4 text-xs text-muted-foreground">
          Started from <Link className="text-primary hover:underline" href={`/dental/${chart.previous.id}`}>{chart.previous.chartNo}</Link> ({fmtDate(chart.previous.examinedAt)}): teeth missing or extracted then are marked here already.
        </p>
      )}

      <ChartSummary chart={chart} />

      <div className="mb-4">
        <Card>
          <CardHeader>
            <CardTitle>{DENTITION_LABELS[chart.dentition]} teeth</CardTitle>
            <div className="flex flex-wrap items-center gap-1">
              {editable &&
                quadrantButtons(chart).map((b) => (
                  <Button key={b.label} size="sm" variant="ghost" className="h-8 px-2.5 text-xs" onClick={() => setSelected(new Set(b.teeth))}>
                    {b.label}
                  </Button>
                ))}
              {editable && selected.size > 0 && (
                <Button size="sm" variant="ghost" className="h-8 px-2.5 text-xs text-muted-foreground" onClick={() => setSelected(new Set())}>
                  Clear
                </Button>
              )}
            </div>
          </CardHeader>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 border-t p-4">
            <Odontogram teeth={adult} findings={findings} procedures={chart.procedures} tested={tested} selected={selected} onToggle={toggle} title="Adult teeth" />
            {chart.showDeciduous && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Baby teeth</p>
                <Odontogram teeth={baby} findings={findings} procedures={chart.procedures} tested={tested} selected={selected} onToggle={toggle} title="Baby teeth" />
              </div>
            )}
            {editable && sel.length > 0 && (
              <ToothActions
                chart={chart}
                selected={sel}
                saving={saveTeeth.isPending}
                onSaveTeeth={(teeth, done) => saveTeeth.mutate(teeth, { onSuccess: done })}
                onChanged={setChart}
                onClear={() => setSelected(new Set())}
                onMoreProcedures={() => document.getElementById('procedures')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              />
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <OdontogramLegend />
              {editable && (
                <Button size="sm" variant="ghost" className="h-8 text-xs" loading={deciduousToggle.isPending} onClick={() => deciduousToggle.mutate(!chart.showDeciduous)}>
                  {chart.showDeciduous ? 'Hide baby teeth' : 'Show baby teeth'}
                </Button>
              )}
            </div>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
          <div id="procedures" className="scroll-mt-24">
            <ProceduresCard chart={chart} selected={sel} editable={editable} onChanged={setChart} />
          </div>
          <MouthCard chart={chart} editable={editable} onChanged={setChart} />
        </div>

        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-4 xl:sticky xl:top-4 xl:self-start">
          <Card className="p-4">
            {sel.length && editable ? (
              <ToothEditor dentition={chart.dentition} selected={sel} teeth={findings} saving={saveTeeth.isPending} onSave={(t) => saveTeeth.mutate(t)} onClear={() => setSelected(new Set())} />
            ) : sel.length ? (
              <div className="grid gap-2">
                {sel.map((t) => {
                  const info = toothInfo(chart.dentition, t);
                  const f = findings.find((x) => x.tooth === t);
                  return (
                    <div key={t} className="text-sm">
                      <p className="font-semibold">{info?.name ?? t}</p>
                      <p className="text-muted-foreground">{[toothCodes(f).join(' '), f?.calculus ? `CI${f.calculus}` : '', f?.gingivitis ? `GI${f.gingivitis}` : '', f?.probingMm != null ? `pocket ${f.probingMm} mm` : '', f?.notes].filter(Boolean).join(' · ') || 'Nothing recorded'}</p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="grid gap-3">
                {editable && (
                  <p className="flex items-start gap-2 rounded-lg bg-primary/5 p-3 text-sm text-muted-foreground">
                    <MousePointerClick className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    Click teeth on the chart to record findings — one at a time, or several at once (or pick a quadrant above).
                  </p>
                )}
                <p className="text-sm font-semibold">Tooth findings</p>
                <FindingsList chart={chart} onPick={(t) => setSelected(new Set([t]))} />
              </div>
            )}
            {sel.length === 1 && <ToothHistory patientId={chart.patientId} tooth={sel[0]} chartId={chart.id} dentition={chart.dentition} />}
          </Card>

          {chart.status === 'SIGNED' && (
            <Card>
              <CardHeader><CardTitle>Addenda</CardTitle></CardHeader>
              <div className="grid gap-3 border-t p-4">
                {chart.addenda.length ? (
                  <ul className="grid gap-3">
                    {chart.addenda.map((a) => (
                      <li key={a.id} className="text-sm">
                        <p className="whitespace-pre-wrap">{a.text}</p>
                        <p className="text-xs text-muted-foreground">{a.authorName} · {fmtDateTime(a.createdAt)}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">No addenda.</p>
                )}
                {(can('clinical.amend') || can('clinical.sign')) && (
                  <>
                    <Textarea aria-label="New addendum" value={addendum} maxLength={4000} onChange={(e) => setAddendum(e.target.value)} placeholder="e.g. Recheck 14 days: extraction sites healed well." />
                    <div className="flex justify-end">
                      <Button size="sm" disabled={!addendum.trim()} loading={addAddendum.isPending} onClick={() => addAddendum.mutate()}>
                        Add addendum
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

export default function DentalChartPage() {
  return (
    <RequirePermission anyOf={['clinical.read']}>
      <ChartPage />
    </RequirePermission>
  );
}
