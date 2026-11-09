'use client';
import { useQuery } from '@tanstack/react-query';
import type { Paginated } from '@vcms/shared';
import { api, qs } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { Administration, DiagnosticOrder, Prescription } from '@/lib/types';

/**
 * What the vet has already recorded in this visit — medicines given, prescriptions, tests ordered — as plan lines.
 * Same wording and the same requests (shared cache) as the classic "Add to the plan" helper.
 */
export function useDoneLines(patientId: string, encounterId: string) {
  const { can } = useSession();
  const given = useQuery({ queryKey: ['administrations', patientId, encounterId], queryFn: () => api.get<Administration[]>(`/patients/${patientId}/administrations${qs({ encounterId })}`) });
  const rx = useQuery({ queryKey: ['prescriptions', { patientId, encounterId }], queryFn: () => api.get<Paginated<Prescription>>(`/prescriptions${qs({ patientId, encounterId, pageSize: 50 })}`), enabled: can('prescriptions.read') });
  const labs = useQuery({ queryKey: ['lab-orders', { patientId, encounterId }], queryFn: () => api.get<Paginated<DiagnosticOrder>>(`/lab-orders${qs({ patientId, encounterId, pageSize: 50 })}`), enabled: can('lab.read') });

  const lines: string[] = [];
  for (const a of given.data ?? []) if (a.status !== 'NOT_GIVEN') lines.push(`Given in clinic: ${a.product.name} ${a.dose} ${a.doseUnit}, ${a.route.toLowerCase()}`);
  for (const p of rx.data?.data ?? []) if (p.status !== 'CANCELLED') for (const i of p.items) lines.push(`Prescribed: ${i.name} ${i.doseValue} ${i.doseUnit}${i.outside ? '' : ''}`);
  const tests = (labs.data?.data ?? []).filter((o) => o.status !== 'CANCELLED').flatMap((o) => o.items.map((i) => i.test.name));
  if (tests.length) lines.push(`Tests ordered: ${[...new Set(tests)].join(', ')}`);

  const givenNames = (given.data ?? []).filter((a) => a.status !== 'NOT_GIVEN').map((a) => a.product.name);
  const homeNames = (rx.data?.data ?? []).filter((p) => p.status !== 'CANCELLED').flatMap((p) => p.items.map((i) => i.name));
  return {
    lines,
    /** Names only, for the owner's summary (how to give a medicine is on its label). */
    names: { given: [...new Set(givenNames)], forHome: [...new Set(homeNames)], tests: [...new Set(tests)] },
    ready: !given.isLoading && !rx.isLoading && !labs.isLoading,
    counts: { given: (given.data ?? []).filter((a) => a.status !== 'NOT_GIVEN').length, prescriptions: (rx.data?.data ?? []).filter((p) => p.status !== 'CANCELLED').length, tests: tests.length },
  };
}
