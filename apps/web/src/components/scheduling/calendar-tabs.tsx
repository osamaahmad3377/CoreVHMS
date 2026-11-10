'use client';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, House, ListChecks } from 'lucide-react';
import Link from 'next/link';
import { tabListClass, tabTriggerClass } from '@/components/ui/tabs';
import { api, qs } from '@/lib/api';
import { useModuleOn, useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

export type CalendarTab = 'calendar' | 'appointments' | 'homeVisits';

/**
 * Tabs of Calendar & appointments: the calendar grid, every booking as a list, and the day's home-visit round
 * (only where the clinic offers home visits). Pass `onSelect` to switch tabs in place (keeps the page's date and filters).
 */
export function CalendarTabs({ active, onSelect }: { active: CalendarTab; onSelect?: (tab: 'calendar' | 'appointments') => void }) {
  const { session } = useSession();
  const moduleOn = useModuleOn();
  const toConfirm = useQuery({
    queryKey: ['appointment-bookings', 'to-confirm', session.branch?.id],
    queryFn: () => api.get<{ meta: { total: number } }>(`/appointments/bookings${qs({ branchId: session.branch?.id, status: 'toConfirm', when: 'upcoming', pageSize: 1 })}`),
    refetchInterval: 60_000,
  });
  const total = toConfirm.data?.meta.total ?? 0;
  const tabs: { key: CalendarTab; label: string; href: string; icon: typeof House; badge?: React.ReactNode }[] = [
    { key: 'calendar', label: 'Calendar', href: '/calendar', icon: CalendarDays },
    {
      key: 'appointments',
      label: 'Appointments',
      href: '/calendar?tab=appointments',
      icon: ListChecks,
      badge: total > 0 && (
        <span className="ml-1 rounded-full bg-warning/15 px-1.5 text-xs font-semibold tabular text-warning" title="Booked, still to confirm">
          {total} to confirm
        </span>
      ),
    },
    ...(moduleOn('homeVisits') ? [{ key: 'homeVisits' as const, label: 'Home visits', href: '/home-visits', icon: House }] : []),
  ];
  return (
    <div className={cn(tabListClass, 'mb-4 w-fit max-w-full overflow-x-auto')} role="tablist" aria-label="Calendar, appointments or home visits">
      {tabs.map((t) => {
        const body = (
          <>
            <t.icon className="h-4 w-4" /> {t.label}
            {t.badge}
          </>
        );
        const selected = active === t.key;
        return onSelect && t.key !== 'homeVisits' ? (
          <button key={t.key} type="button" role="tab" aria-selected={selected} className={tabTriggerClass(selected)} onClick={() => onSelect(t.key as 'calendar' | 'appointments')}>
            {body}
          </button>
        ) : (
          <Link key={t.key} href={t.href} role="tab" aria-selected={selected} className={tabTriggerClass(selected)}>
            {body}
          </Link>
        );
      })}
    </div>
  );
}
