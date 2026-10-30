'use client';
import { useQuery } from '@tanstack/react-query';
import { dentalProcedure, PERIODONTAL_STAGES, type Dentition } from '@vcms/shared';
import { ChevronRight, Plus, Smile } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardHeader, CardTitle } from '../ui/card';
import { api } from '@/lib/api';
import { useModuleOn, useSession } from '@/lib/session';
import type { DentalChart } from '@/lib/types';

export type VisitDental = { suggestedDentition: Dentition | null; charts: DentalChart[] };

/** "PD3 · 2 extractions · scale and polish, dental X-rays" — one line for a chart. */
export function dentalSummary(c: DentalChart) {
  const stage = c.periodontalStage ?? c.worstToothStage;
  const extractions = c.procedures.filter((p) => dentalProcedure(p.code)?.removesTooth).length;
  const others = [...new Set(c.procedures.filter((p) => !dentalProcedure(p.code)?.removesTooth).map((p) => p.label.toLowerCase()))];
  const findings = c.teeth.filter((t) => t.state === 'PRESENT' && (t.findings.length || (t.pdStage ?? 0) > 0 || (t.mobility ?? 0) > 0)).length;
  return [
    stage != null && `${PERIODONTAL_STAGES[stage].label} (${PERIODONTAL_STAGES[stage].hint.toLowerCase()})`,
    findings > 0 && `${findings} ${findings === 1 ? 'tooth' : 'teeth'} with findings`,
    extractions > 0 && `${extractions} ${extractions === 1 ? 'extraction' : 'extractions'}`,
    others.length > 0 && others.join(', '),
  ]
    .filter(Boolean)
    .join(' · ');
}

export function useVisitDental(encounterId: string, enabled = true) {
  const { can } = useSession();
  const moduleOn = useModuleOn();
  return useQuery({
    queryKey: ['encounter-dental', encounterId],
    queryFn: () => api.get<VisitDental>(`/encounters/${encounterId}/dental`),
    enabled: enabled && moduleOn('dental') && can('clinical.read'),
  });
}

/**
 * The dental chart of this consultation: start one (linked to the visit, so its procedures go on the same bill), or
 * open the one started, with a one-line summary.
 */
export function VisitDentalCard({ encounterId, editable, onStart }: { encounterId: string; editable: boolean; onStart: () => void }) {
  const moduleOn = useModuleOn();
  const q = useVisitDental(encounterId);
  if (!moduleOn('dental') || q.isLoading || !q.data) return null;
  const charts = q.data.charts;
  if (!charts.length && !editable) return null;
  const draft = charts.find((c) => c.status === 'DRAFT');
  return (
    <Card id="dental-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Smile className="h-4 w-4 text-muted-foreground" /> Dental chart
        </CardTitle>
        {editable && !draft && (
          <Button size="sm" variant="outline" onClick={onStart}>
            <Plus /> {charts.length ? 'Another chart' : 'Start dental chart'}
          </Button>
        )}
      </CardHeader>
      {charts.length ? (
        <ul className="divide-y border-t">
          {charts.map((c) => (
            <li key={c.id}>
              <Link href={`/dental/${c.id}`} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/50">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{c.chartNo}</span>
                  <span className="block truncate text-xs text-muted-foreground">{dentalSummary(c) || 'Nothing recorded yet'}</span>
                </span>
                <Badge variant={c.status === 'SIGNED' ? 'success' : 'warning'}>{c.status === 'SIGNED' ? 'Signed' : 'Draft'}</Badge>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="border-t px-4 py-3 text-sm text-muted-foreground">Doing a dental check or treatment at this visit? Chart it tooth by tooth; procedures go on this visit’s bill.</p>
      )}
    </Card>
  );
}
