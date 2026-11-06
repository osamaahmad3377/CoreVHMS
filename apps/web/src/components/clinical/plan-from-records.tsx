'use client';
import { useQuery } from '@tanstack/react-query';
import type { Paginated } from '@vcms/shared';
import { ListPlus } from 'lucide-react';
import { Button } from '../ui/button';
import { api, qs } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { Administration, DiagnosticOrder, Prescription } from '@/lib/types';

/**
 * "Add what I did to the plan": the medicines given, the prescriptions and the tests ordered during this visit are
 * already recorded, so the plan is written from them in one tap instead of typed again. Nothing is added twice.
 */
export function PlanFromRecords({ patientId, encounterId, plan, onAdd }: { patientId: string; encounterId: string; plan: string; onAdd: (text: string) => void }) {
  const { can, canAny } = useSession();
  const given = useQuery({ queryKey: ['administrations', patientId, encounterId], queryFn: () => api.get<Administration[]>(`/patients/${patientId}/administrations${qs({ encounterId })}`) });
  const rx = useQuery({ queryKey: ['prescriptions', { patientId, encounterId }], queryFn: () => api.get<Paginated<Prescription>>(`/prescriptions${qs({ patientId, encounterId, pageSize: 50 })}`), enabled: can('prescriptions.read') });
  const labs = useQuery({ queryKey: ['lab-orders', { patientId, encounterId }], queryFn: () => api.get<Paginated<DiagnosticOrder>>(`/lab-orders${qs({ patientId, encounterId, pageSize: 50 })}`), enabled: can('lab.read') });
  if (!canAny('clinical.write')) return null;

  const lines: string[] = [];
  for (const a of given.data ?? []) if (a.status !== 'NOT_GIVEN') lines.push(`Given in clinic: ${a.product.name} ${a.dose} ${a.doseUnit}, ${a.route.toLowerCase()}`);
  for (const p of rx.data?.data ?? []) if (p.status !== 'CANCELLED') for (const i of p.items) lines.push(`Prescribed: ${i.name} ${i.doseValue} ${i.doseUnit}${i.outside ? ' (buy outside)' : ''}`);
  const tests = (labs.data?.data ?? []).filter((o) => o.status !== 'CANCELLED').flatMap((o) => o.items.map((i) => i.test.name));
  if (tests.length) lines.push(`Tests ordered: ${[...new Set(tests)].join(', ')}`);
  const fresh = lines.filter((l) => !plan.includes(l));
  if (!fresh.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-primary/40 bg-primary/5 px-3 py-2 text-sm">
      <span className="min-w-0 flex-1 text-muted-foreground">{fresh.length} thing{fresh.length === 1 ? '' : 's'} you did this visit {fresh.length === 1 ? 'is' : 'are'} not in the plan yet.</span>
      <Button type="button" size="sm" variant="outline" onClick={() => onAdd(fresh.join('\n'))}><ListPlus /> Add to the plan</Button>
    </div>
  );
}
