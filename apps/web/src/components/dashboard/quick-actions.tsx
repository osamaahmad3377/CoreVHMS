'use client';
import type { OptionalModule, Permission } from '@vcms/shared';
import { BarChart3, BedDouble, Boxes, CalendarPlus, ClipboardList, FlaskConical, LifeBuoy, Pill, Receipt, ShoppingCart, Stethoscope, UserCog, UserPlus, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useModuleOn, useSession } from '@/lib/session';

type ActionKey = 'front-desk' | 'book' | 'new-client' | 'consultations' | 'pharmacy' | 'lab' | 'hospital' | 'shop' | 'take-payment' | 'receive-stock' | 'add-staff' | 'reports' | 'help';

const ACTIONS: Record<ActionKey, { label: string; hint: string; href: string; icon: LucideIcon; anyOf: Permission[]; module?: OptionalModule }> = {
  'front-desk': { label: 'Front desk', hint: 'Check in and the waiting room', href: '/front-desk', icon: ClipboardList, anyOf: ['appointments.checkin'] },
  book: { label: 'Book appointment', hint: 'Book an appointment in a free slot', href: '/calendar', icon: CalendarPlus, anyOf: ['appointments.write'] },
  'new-client': { label: 'New client', hint: 'Add a pet owner and their animals', href: '/clients/new', icon: UserPlus, anyOf: ['clients.write'] },
  consultations: { label: 'Consultations', hint: 'Notes, prescribing, tests', href: '/consultations', icon: Stethoscope, anyOf: ['clinical.read'] },
  pharmacy: { label: 'Pharmacy', hint: 'Prescriptions to authorise and hand over', href: '/pharmacy', icon: Pill, anyOf: ['prescriptions.read', 'pharmacy.dispense'] },
  lab: { label: 'Lab', hint: 'Samples and results', href: '/lab', icon: FlaskConical, anyOf: ['lab.read'], module: 'lab' },
  hospital: { label: 'Hospital', hint: 'Admitted patients and treatments', href: '/hospital', icon: BedDouble, anyOf: ['hospital.read'], module: 'hospital' },
  shop: { label: 'Shop sale', hint: 'Sell at the shop counter', href: '/pos', icon: ShoppingCart, anyOf: ['pos.use'] },
  'take-payment': { label: 'Take payment', hint: 'Work not yet invoiced: make the invoice and take the money', href: '/billing/charges', icon: Receipt, anyOf: ['billing.write'] },
  'receive-stock': { label: 'Receive stock', hint: 'Record a delivery', href: '/inventory?receive=1', icon: Boxes, anyOf: ['inventory.write'] },
  'add-staff': { label: 'Add staff', hint: 'Give a new person their own login', href: '/settings/staff', icon: UserCog, anyOf: ['users.manage', 'users.read'] },
  reports: { label: 'Reports', hint: 'Money, debts, stock', href: '/reports', icon: BarChart3, anyOf: ['reports.view', 'reports.financial'] },
  help: { label: 'Help', hint: 'Step-by-step guides', href: '/help', icon: LifeBuoy, anyOf: [] },
};

const BY_ROLE: Record<'owner' | 'vet' | 'reception' | 'other', ActionKey[]> = {
  owner: ['reports', 'shop', 'receive-stock', 'add-staff', 'book', 'new-client'],
  reception: ['front-desk', 'book', 'new-client', 'shop', 'take-payment', 'help'],
  vet: ['consultations', 'front-desk', 'pharmacy', 'lab', 'hospital', 'book'],
  other: ['front-desk', 'book', 'new-client', 'consultations', 'pharmacy', 'lab', 'shop', 'receive-stock', 'reports', 'help'],
};

/** Which everyday layout a user gets: owners/managers see money first, front-desk staff see arrivals first. */
export function dashboardRole(can: (p: Permission) => boolean): 'owner' | 'vet' | 'reception' | 'other' {
  if (can('reports.financial')) return 'owner';
  if (can('clinical.write')) return 'vet';
  if (can('appointments.checkin')) return 'reception';
  return 'other';
}

/** The six most common tasks for the signed-in user's role, one click away. Two columns on phones; nothing is hidden. */
export function QuickActions() {
  const { can, canAny } = useSession();
  const moduleOn = useModuleOn();
  const role = dashboardRole((p) => can(p));
  const allowed = (k: ActionKey) => (!ACTIONS[k].anyOf.length || canAny(...ACTIONS[k].anyOf)) && moduleOn(ACTIONS[k].module);
  // The role's own list first, topped up from the general list when a shortcut is not available here.
  const keys = [...new Set([...BY_ROLE[role], ...BY_ROLE.other])].filter(allowed).slice(0, 6);
  if (!keys.length) return null;
  return (
    <nav aria-label="Quick actions" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {keys.map((k) => {
        const a = ACTIONS[k];
        return (
          <Link key={k} href={a.href} title={a.hint} className="group flex min-h-11 items-center gap-2.5 rounded-lg border bg-card px-3 py-2.5 shadow-sm transition-colors hover:border-primary/50 hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring">
            <span className="shrink-0 rounded-md bg-primary/10 p-1.5 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground"><a.icon className="h-4 w-4" /></span>
            <span className="min-w-0 text-sm font-semibold leading-tight">{a.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
