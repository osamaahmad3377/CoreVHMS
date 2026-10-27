'use client';
import { useQuery } from '@tanstack/react-query';
import type { ClinicPlanView } from '@vcms/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

/**
 * How many staff accounts and branches the clinic uses against its plan, and whether adding one more is allowed.
 * Without plans (a single installation, or no plan assigned) nothing is limited.
 */
export function usePlanUsage() {
  const { session } = useSession();
  const planned = !!session.entitlements && (session.entitlements.maxStaff !== null || session.entitlements.maxBranches !== null || session.entitlements.maxAutomations !== null || session.entitlements.maxCustomAutomations !== null);
  const q = useQuery({ queryKey: ['clinic-plan'], queryFn: () => api.get<ClinicPlanView>('/organization/plan'), enabled: planned, staleTime: 0 });
  const e = q.data?.entitlements ?? session.entitlements;
  const usage = q.data?.usage;
  const room = (used: number | undefined, max: number | null | undefined) => max == null || used === undefined || used < max;
  return {
    plan: e?.planName ?? null,
    staff: { used: usage?.staff, max: e?.maxStaff ?? null, canAdd: room(usage?.staff, e?.maxStaff) },
    branches: { used: usage?.branches, max: e?.maxBranches ?? null, canAdd: room(usage?.branches, e?.maxBranches) },
    /** Ready-made automations switched on. */
    automations: { used: usage?.automations, max: e?.maxAutomations ?? null, canAdd: room(usage?.automations, e?.maxAutomations) },
    /** The clinic's own automations switched on. */
    customAutomations: { used: usage?.customAutomations, max: e?.maxCustomAutomations ?? null, canAdd: room(usage?.customAutomations, e?.maxCustomAutomations) },
  };
}

/** "3 of 5 staff accounts used" (empty when there is no limit). */
export function limitNote(u: { used: number | undefined; max: number | null }, noun: string) {
  return u.max === null || u.used === undefined ? '' : `${u.used} of ${u.max} ${noun} used`;
}
