'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DENTITION_LABELS, DENTITIONS, PERIODONTAL_STAGES, teethFor, type Dentition } from '@vcms/shared';
import { ChevronRight, Plus, Smile } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Field } from '../forms/field';
import { FormError } from '../forms/form-error';
import { EmptyState, LoadingRows } from '../page';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardHeader, CardTitle } from '../ui/card';
import { Checkbox } from '../ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Odontogram, OdontogramLegend } from './odontogram';
import { api } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { DentalChart } from '@/lib/types';
import { cn } from '@/lib/utils';

export function NewDentalChartDialog({
  patientId,
  patientName,
  suggested,
  encounterId,
  open,
  onOpenChange,
}: {
  patientId: string;
  patientName: string;
  suggested: Dentition | null;
  encounterId?: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const [dentition, setDentition] = useState<Dentition | ''>(suggested ?? '');
  const [baby, setBaby] = useState(false);
  const [carry, setCarry] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setDentition(suggested ?? '');
      setBaby(false);
      setCarry(true);
      setError(null);
    }
  }, [open, suggested]);
  const create = useMutation({
    mutationFn: () => api.post<DentalChart>('/dental/charts', { patientId, dentition, showDeciduous: baby, carryForward: carry, encounterId: encounterId ?? null }),
    onSuccess: (c) => {
      if (encounterId) qc.invalidateQueries({ queryKey: ['encounter-dental', encounterId] });
      qc.invalidateQueries({ queryKey: ['patient-dental', patientId] });
      router.push(`/dental/${c.id}`);
    },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>New dental chart</DialogTitle>
          <DialogDescription>For {patientName}. You record findings tooth by tooth, then sign the chart.</DialogDescription>
        </DialogHeader>
        {error && <FormError message={error} />}
        <Field label="Chart" htmlFor="nd-dentition" hint={suggested ? undefined : 'There’s no standard tooth chart for this species — choose the closest one.'}>
          <div id="nd-dentition" role="radiogroup" className="grid grid-cols-3 gap-2">
            {DENTITIONS.map((d) => (
              <button key={d} type="button" role="radio" aria-checked={dentition === d} onClick={() => setDentition(d)} className={cn('rounded-lg surface-flat p-2 text-sm', dentition === d ? 'border-primary bg-primary/10 font-medium text-primary' : 'hover:bg-muted')}>
                {DENTITION_LABELS[d]}
                <span className="block text-2xs text-muted-foreground">{teethFor(d).length} adult teeth</span>
              </button>
            ))}
          </div>
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={baby} onCheckedChange={(v) => setBaby(v === true)} /> Show baby teeth too (young animal)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={carry} onCheckedChange={(v) => setCarry(v === true)} /> Start from the last signed chart (missing and extracted teeth)
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!dentition} loading={create.isPending} onClick={() => create.mutate()}>
            Start chart
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Patient tab: the latest dental chart at a glance, every chart, and starting a new one. */
export function PatientDental({ patientId, patientName, active }: { patientId: string; patientName: string; active: boolean }) {
  const { can } = useSession();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['patient-dental', patientId], queryFn: () => api.get<{ suggestedDentition: Dentition | null; charts: DentalChart[] }>(`/patients/${patientId}/dental`) });
  if (q.isLoading) return <LoadingRows rows={3} />;
  const charts = q.data?.charts ?? [];
  const latest = charts.find((c) => c.status === 'SIGNED') ?? charts[0];
  const canStart = active && can('clinical.write');
  const stage = latest ? (latest.periodontalStage ?? latest.worstToothStage) : null;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      {latest ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2">
                <Smile className="h-4 w-4 text-primary" /> {latest.status === 'SIGNED' ? 'Latest dental chart' : 'Dental chart in progress'}
              </CardTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {latest.chartNo} · {fmtDate(latest.examinedAt)} · {latest.signedByName ?? latest.clinicianName}
                {stage != null && ` · ${PERIODONTAL_STAGES[stage].label} (${PERIODONTAL_STAGES[stage].hint.toLowerCase()})`}
                {latest.recheckDate && ` · recheck ${fmtDate(latest.recheckDate)}`}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {canStart && (
                <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
                  <Plus /> New chart
                </Button>
              )}
              <Button size="sm" asChild>
                <Link href={`/dental/${latest.id}`}>Open <ChevronRight /></Link>
              </Button>
            </div>
          </CardHeader>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3 border-t p-4">
            <Link href={`/dental/${latest.id}`} aria-label={`Open ${latest.chartNo}`} className="block rounded-lg hover:bg-muted/40">
              <Odontogram teeth={teethFor(latest.dentition)} findings={latest.teeth} procedures={latest.procedures} readOnly />
            </Link>
            <OdontogramLegend />
          </div>
        </Card>
      ) : (
        <Card>
          <EmptyState
            icon={Smile}
            title="No dental charts yet"
            description={canStart ? 'Record a dental examination tooth by tooth: findings, gum disease stage and any extractions or cleaning.' : 'No dental examinations have been recorded for this patient.'}
            action={
              canStart ? (
                <Button onClick={() => setOpen(true)}>
                  <Plus /> New dental chart
                </Button>
              ) : undefined
            }
            className="py-10"
          />
        </Card>
      )}

      {charts.length > 1 && (
        <Card>
          <CardHeader><CardTitle>All dental charts</CardTitle></CardHeader>
          <ul className="divide-y border-t">
            {charts.map((c) => {
              const s = c.periodontalStage ?? c.worstToothStage;
              const extracted = c.extractedNow.length;
              return (
                <li key={c.id}>
                  <Link href={`/dental/${c.id}`} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/50">
                    <span className="w-24 text-xs text-muted-foreground">{fmtDate(c.examinedAt)}</span>
                    <span className="font-medium">{c.chartNo}</span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      {[s != null && `PD${s}`, c.procedures.length && `${c.procedures.length} procedure(s)`, extracted && `${extracted} extracted`].filter(Boolean).join(' · ') || 'No findings'}
                    </span>
                    <span className="text-xs text-muted-foreground">{c.signedByName ?? c.clinicianName}</span>
                    <Badge variant={c.status === 'SIGNED' ? 'success' : 'warning'}>{c.status === 'SIGNED' ? 'Signed' : 'Draft'}</Badge>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      <NewDentalChartDialog patientId={patientId} patientName={patientName} suggested={q.data?.suggestedDentition ?? null} open={open} onOpenChange={setOpen} />
    </div>
  );
}
