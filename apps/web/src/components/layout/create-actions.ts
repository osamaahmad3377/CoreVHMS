import { Boxes, CalendarPlus, PackagePlus, PawPrint, Receipt, ShoppingCart, Stethoscope, UserPlus } from 'lucide-react';
import { useSession } from '@/lib/session';

export interface CreateAction {
  label: string;
  /** One line under the label in the New menu. */
  hint: string;
  /** Where it sits in the New menu. */
  group: 'Visits' | 'Clients & animals' | 'Money & stock';
  /** Extra words the search box matches, e.g. "new" or "schedule" for a booking. */
  keywords: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

/** Everyday "start something" actions for the signed-in user: the top bar's New menu and the ⌘K actions. */
export function useCreateActions(): CreateAction[] {
  const { can } = useSession();
  return [
    // Visits: the same three steps everywhere — owner, animal, then the next step.
    (can('appointments.checkin') || can('appointments.write')) && {
      label: 'New visit or booking',
      hint: 'Check in now, or book for later',
      group: 'Visits',
      keywords: 'walk-in arrival patient arrived check in queue emergency triage urgent book appointment booking schedule calendar front desk',
      href: '/front-desk?visit=1',
      icon: CalendarPlus,
    },
    can('clinical.write') && {
      label: 'New visit or consultation',
      hint: 'Start a consultation straight away',
      group: 'Visits',
      keywords: 'consult consultation start see patient exam notes soap vet',
      href: '/consultations?start=1',
      icon: Stethoscope,
    },
    can('clients.write') && {
      label: 'Add client',
      hint: 'A new owner — and their animal',
      group: 'Clients & animals',
      keywords: 'new owner customer register client mobile',
      href: '/clients/new',
      icon: UserPlus,
    },
    can('patients.write') && {
      label: 'Add an animal',
      hint: 'For an owner already registered',
      group: 'Clients & animals',
      keywords: 'new animal pet patient register add patient',
      href: '/patients/new',
      icon: PawPrint,
    },
    can('pos.use') && { label: 'Shop sale', hint: 'Sell at the counter, or bill a visit', group: 'Money & stock', keywords: 'pos shop sell till counter sale', href: '/pos', icon: ShoppingCart },
    can('billing.write') && { label: 'New invoice', hint: 'Bill a client', group: 'Money & stock', keywords: 'bill charge invoice', href: '/billing/invoices/new', icon: Receipt },
    can('inventory.write') && { label: 'Receive stock', hint: 'A delivery has arrived', group: 'Money & stock', keywords: 'delivery goods receipt stock', href: '/inventory?receive=1', icon: PackagePlus },
    can('procurement.request') && { label: 'Request an item', hint: 'Ask for something to be ordered', group: 'Money & stock', keywords: 'order request stock purchase', href: '/inventory/requests?new=1', icon: Boxes },
  ].filter(Boolean) as CreateAction[];
}
