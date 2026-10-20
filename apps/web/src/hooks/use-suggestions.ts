'use client';
import { useQuery } from '@tanstack/react-query';
import { buildAttention, type AttentionItem } from '@/components/dashboard/attention';
import { dashboardRole } from '@/components/dashboard/quick-actions';
import { api, qs } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';

/**
 * What the system recommends doing next for the signed-in person, most urgent first: the same list the
 * dashboard shows, available on every screen. Shares the dashboard's request, so it costs nothing extra there.
 */
export function useSuggestions(): { items: AttentionItem[]; ready: boolean } {
  const { session, currency, can } = useSession();
  const enabled = can('dashboard.view');
  const today = new Date(new Date().setHours(0, 0, 0, 0));
  const from = new Date(today.getFullYear(), today.getMonth(), 1).toISOString();
  // Same key and request as the dashboard's default view ("This month", all branches).
  const q = useQuery({
    queryKey: ['dashboard', 'month', undefined],
    queryFn: () => api.get<{ widgets: unknown }>(`/dashboard${qs({ from, to: undefined, branchId: undefined })}`),
    enabled,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const role = dashboardRole((p) => can(p));
  const frontline = role !== 'owner' && can('appointments.checkin');
  const items = q.data?.widgets
    ? buildAttention(q.data.widgets, { money: (m) => fmtMoney(m, currency), portal: session.features?.clientPortal === true, can: (p) => can(p as never), hideStock: frontline })
    : [];
  return { items, ready: !!q.data };
}
