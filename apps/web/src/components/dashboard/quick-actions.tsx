'use client';
import type { Permission } from '@vcms/shared';
import { BarChart3, BedDouble, Boxes, Scissors, CalendarPlus, ClipboardList, FlaskConical, Pill, Receipt, ShoppingCart, Stethoscope, UserPlus, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useSession } from '@/lib/session';

const ACTIONS: { label: string; hint: string; href: string; icon: LucideIcon; anyOf: Permission[] }[] = [
  { label: 'Front desk', hint: 'Check in & waiting room', href: '/front-desk', icon: ClipboardList, anyOf: ['appointments.checkin'] },
  { label: 'Book visit', hint: 'Book an appointment in a free slot', href: '/calendar', icon: CalendarPlus, anyOf: ['appointments.write'] },
  { label: 'New client', hint: 'Owner and animals', href: '/clients/new', icon: UserPlus, anyOf: ['clients.write'] },
  { label: 'Consultations', hint: 'Notes, prescribing, tests', href: '/consultations', icon: Stethoscope, anyOf: ['clinical.write'] },
  { label: 'Hospital', hint: 'Inpatients & treatments', href: '/hospital', icon: BedDouble, anyOf: ['hospital.write'] },
  { label: 'Surgery', hint: 'Theatre list', href: '/surgery', icon: Scissors, anyOf: ['surgery.write'] },
  { label: 'Dispense', hint: 'Prescriptions to hand over', href: '/pharmacy', icon: Pill, anyOf: ['pharmacy.dispense'] },
  { label: 'Laboratory', hint: 'Samples and results', href: '/lab', icon: FlaskConical, anyOf: ['lab.result'] },
  { label: 'Counter sale', hint: 'Point of sale', href: '/pos', icon: ShoppingCart, anyOf: ['pos.use'] },
  { label: 'Invoice a client', hint: 'Bill unbilled work', href: '/billing/charges', icon: Receipt, anyOf: ['billing.write'] },
  { label: 'Receive stock', hint: 'Record a delivery', href: '/inventory?receive=1', icon: Boxes, anyOf: ['inventory.write'] },
  { label: 'Request an item', hint: 'Ask for stock to be ordered', href: '/inventory/requests?new=1', icon: Boxes, anyOf: ['procurement.request'] },
  { label: 'Reports', hint: 'Revenue, debts, stock', href: '/reports', icon: BarChart3, anyOf: ['reports.view', 'reports.financial'] },
];

/** The most common tasks for the signed-in user's role, one click away. */
export function QuickActions() {
  const { canAny } = useSession();
  const actions = ACTIONS.filter((a) => canAny(...a.anyOf)).slice(0, 6);
  if (!actions.length) return null;
  return (
    <nav aria-label="Quick actions" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {actions.map((a) => (
        <Link key={a.href} href={a.href} title={a.hint} className="group flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2.5 shadow-sm transition-colors hover:border-primary/50 hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring">
          <span className="rounded-md bg-primary/10 p-1.5 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground"><a.icon className="h-4 w-4" /></span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold leading-tight">{a.label}</span>
          </span>
        </Link>
      ))}
    </nav>
  );
}
