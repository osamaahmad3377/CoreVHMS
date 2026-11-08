'use client';
import { useQuery } from '@tanstack/react-query';
import type { Paginated } from '@vcms/shared';
import { api, qs } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { DiagnosticOrder } from '@/lib/types';

/**
 * Teeth with a test or X-ray ordered at this visit (orders made from the dental chart remember their teeth). Shares
 * its query with the visit's test list, so a new order shows on the chart straight away.
 */
export function useToothTests(patientId: string | undefined, encounterId: string | null | undefined): ReadonlySet<string> {
  const { can } = useSession();
  const q = useQuery({
    queryKey: ['lab-orders', { patientId, encounterId }],
    queryFn: () => api.get<Paginated<DiagnosticOrder>>(`/lab-orders${qs({ patientId, encounterId: encounterId ?? undefined, pageSize: 50 })}`),
    enabled: !!patientId && !!encounterId && can('lab.read'),
  });
  return new Set((q.data?.data ?? []).filter((o) => o.status !== 'CANCELLED').flatMap((o) => o.teeth ?? []));
}
