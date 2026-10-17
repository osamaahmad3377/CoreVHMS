import { Boxes, CalendarPlus, ClipboardList, PawPrint, Receipt, ShoppingCart, Stethoscope, UserPlus } from 'lucide-react';
import { useSession } from '@/lib/session';

export interface CreateAction {
  label: string;
  /** Extra words the search box matches, e.g. "new" or "schedule" for Book appointment. */
  keywords: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

/** Everyday "start something" actions for the signed-in user: the top bar's New menu and the ⌘K actions. */
export function useCreateActions(): CreateAction[] {
  const { can } = useSession();
  return [
    can('clients.write') && { label: 'Add client', keywords: 'new owner customer register client', href: '/clients/new', icon: UserPlus },
    can('patients.write') && { label: 'Add patient', keywords: 'new animal pet register patient', href: '/patients/new', icon: PawPrint },
    can('appointments.write') && { label: 'Book appointment', keywords: 'new appointment booking schedule calendar', href: '/calendar?book=1', icon: CalendarPlus },
    can('appointments.checkin') && { label: 'Walk-in / emergency', keywords: 'check in arrive triage urgent', href: '/front-desk', icon: ClipboardList },
    can('clinical.write') && { label: 'Consultations', keywords: 'consult notes soap exam', href: '/consultations', icon: Stethoscope },
    can('pos.use') && { label: 'Counter sale', keywords: 'pos shop sell till', href: '/pos', icon: ShoppingCart },
    can('billing.write') && { label: 'New invoice', keywords: 'bill charge invoice', href: '/billing/invoices/new', icon: Receipt },
    can('inventory.write') && { label: 'Receive stock', keywords: 'delivery goods receipt stock', href: '/inventory?receive=1', icon: Boxes },
    can('procurement.request') && { label: 'Request an item', keywords: 'order request stock purchase', href: '/inventory/requests?new=1', icon: Boxes },
  ].filter(Boolean) as CreateAction[];
}
