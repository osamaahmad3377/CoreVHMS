'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { tabListClass, tabTriggerClass } from '../ui/tabs';
import { useSession } from '@/lib/session';

/** Roster & leave | Attendance — the two halves of the Staff area. Hidden when the person can only see one. */
export function StaffTabs() {
  const { canAny } = useSession();
  const pathname = usePathname();
  const tabs = [
    { href: '/staff', label: 'Roster & leave', show: canAny('staff.read', 'users.read') },
    { href: '/staff/attendance', label: 'Attendance', show: canAny('attendance.clock', 'attendance.manage') },
  ].filter((t) => t.show);
  if (tabs.length < 2) return null;
  return (
    <nav className={`${tabListClass} mb-4`} aria-label="Staff">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} aria-current={pathname === t.href ? 'page' : undefined} className={tabTriggerClass()}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
