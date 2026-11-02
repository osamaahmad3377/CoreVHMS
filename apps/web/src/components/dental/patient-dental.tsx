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
import { NewDentalChartDialog } from './new-chart-dialog';
import { Odontogram, OdontogramLegend } from './odontogram';

export { NewDentalChartDialog };
import { api } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { DentalChart } from '@/lib/types';
import { cn } from '@/lib/utils';

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
      <NewDentalChartDialog patient={{ id: patientId, name: patientName }} suggested={q.data?.suggestedDentition ?? null} open={open} onOpenChange={setOpen} />
    </div>
  );
}
