import type { Permission } from '@vcms/shared';
import {
  Activity,
  BarChart3,
  Bed,
  Boxes,
  Building2,
  CalendarDays,
  ClipboardList,
  FileText,
  FlaskConical,
  HeartPulse,
  LayoutDashboard,
  LifeBuoy,
  MessageSquare,
  PawPrint,
  Pill,
  Plug,
  Printer,
  Receipt,
  Scissors,
  ScrollText,
  Settings,
  Shield,
  ShieldCheck,
  ShoppingCart,
  Stethoscope,
  Syringe,
  Tractor,
  UserCog,
  Users,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Visible if the user holds ANY of these permissions (empty = everyone). */
  anyOf: Permission[];
  /** Hidden until the module is implemented end-to-end (no links to empty pages). */
  ready: boolean;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

export const NAV: NavSection[] = [
  {
    label: 'Overview',
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, anyOf: ['dashboard.view'], ready: true },
      { label: 'Help centre', href: '/help', icon: LifeBuoy, anyOf: [], ready: true },
    ],
  },
  {
    label: 'Front desk',
    items: [
      { label: 'Front desk', href: '/front-desk', icon: ClipboardList, anyOf: ['appointments.checkin'], ready: true },
      { label: 'Calendar', href: '/calendar', icon: CalendarDays, anyOf: ['appointments.read'], ready: true },
      { label: 'Clients', href: '/clients', icon: Users, anyOf: ['clients.read'], ready: true },
      { label: 'Patients', href: '/patients', icon: PawPrint, anyOf: ['patients.read'], ready: true },
    ],
  },
  {
    label: 'Clinical',
    items: [
      { label: 'Consultations', href: '/consultations', icon: Stethoscope, anyOf: ['clinical.read'], ready: true },
      { label: 'Prescriptions & pharmacy', href: '/pharmacy', icon: Pill, anyOf: ['prescriptions.read', 'pharmacy.dispense'], ready: true },
      { label: 'Laboratory & imaging', href: '/lab', icon: FlaskConical, anyOf: ['lab.read'], ready: true },
      { label: 'Hospitalisation', href: '/hospital', icon: Bed, anyOf: ['hospital.read'], ready: true },
      { label: 'Surgery & anaesthesia', href: '/surgery', icon: HeartPulse, anyOf: ['surgery.read'], ready: true },
      { label: 'Preventive care', href: '/preventive', icon: Syringe, anyOf: ['preventive.read'], ready: true },
    ],
  },
  {
    label: 'Commercial',
    items: [
      { label: 'Inventory & procurement', href: '/inventory', icon: Boxes, anyOf: ['inventory.read', 'procurement.read'], ready: true },
      { label: 'Billing & payments', href: '/billing', icon: Receipt, anyOf: ['billing.read'], ready: true },
      { label: 'Point of sale', href: '/pos', icon: ShoppingCart, anyOf: ['pos.use'], ready: true },
    ],
  },
  {
    label: 'Services',
    items: [
      { label: 'Livestock & farms', href: '/livestock', icon: Tractor, anyOf: ['livestock.read'], ready: true },
      { label: 'Boarding & grooming', href: '/boarding', icon: Scissors, anyOf: ['boarding.read'], ready: true },
      { label: 'Insurance & referrals', href: '/insurance', icon: ShieldCheck, anyOf: ['insurance.read'], ready: true },
    ],
  },
  {
    label: 'Management',
    items: [
      { label: 'Staff & rosters', href: '/staff', icon: UserCog, anyOf: ['staff.read', 'users.read'], ready: true },
      { label: 'Reports', href: '/reports', icon: BarChart3, anyOf: ['reports.view'], ready: true },
      { label: 'Communications', href: '/communications', icon: MessageSquare, anyOf: ['communications.read'], ready: true },
      { label: 'Documents & templates', href: '/documents', icon: FileText, anyOf: ['documents.read'], ready: false },
      { label: 'Integrations', href: '/integrations', icon: Plug, anyOf: ['integrations.manage'], ready: false },
    ],
  },
  {
    label: 'Administration',
    items: [
      {
        label: 'Settings',
        href: '/settings',
        icon: Settings,
        anyOf: ['org.manage', 'branches.manage', 'users.read', 'roles.manage', 'settings.manage'],
        ready: true,
      },
      { label: 'Audit log', href: '/audit', icon: ScrollText, anyOf: ['audit.read'], ready: true },
    ],
  },
];

export const SETTINGS_NAV: { label: string; href: string; icon: LucideIcon; anyOf: Permission[] }[] = [
  { label: 'Organization', href: '/settings/organization', icon: Building2, anyOf: ['org.manage'] },
  { label: 'Branches', href: '/settings/branches', icon: Building2, anyOf: ['branches.manage'] },
  { label: 'Staff accounts', href: '/settings/staff', icon: Users, anyOf: ['users.read'] },
  { label: 'Roles & permissions', href: '/settings/roles', icon: Shield, anyOf: ['roles.manage', 'users.read'] },
  { label: 'Species & breeds', href: '/settings/species', icon: PawPrint, anyOf: ['settings.manage'] },
  { label: 'Appointment types', href: '/settings/appointment-types', icon: CalendarDays, anyOf: ['settings.manage'] },
  { label: 'Services & fees', href: '/settings/services', icon: Receipt, anyOf: ['settings.manage'] },
  { label: 'Billing & tax', href: '/settings/billing', icon: Receipt, anyOf: ['settings.manage'] },
  { label: 'Receipts & printing', href: '/settings/receipts', icon: Printer, anyOf: ['settings.manage'] },
  { label: 'Messages & reminders', href: '/settings/communications', icon: MessageSquare, anyOf: ['settings.manage'] },
  { label: 'Rooms & equipment', href: '/settings/resources', icon: Bed, anyOf: ['settings.manage'] },
  { label: 'Wards & cages', href: '/settings/wards', icon: Bed, anyOf: ['settings.manage'] },
  { label: 'Surgical checklist', href: '/settings/surgery-checklist', icon: Scissors, anyOf: ['settings.manage'] },
  { label: 'Boarding units', href: '/settings/boarding-units', icon: Bed, anyOf: ['settings.manage'] },
  { label: 'Livestock', href: '/settings/livestock', icon: Tractor, anyOf: ['settings.manage'] },
  { label: 'Consultation templates', href: '/settings/templates', icon: FileText, anyOf: ['settings.manage'] },
  { label: 'Vital references', href: '/settings/vital-references', icon: Activity, anyOf: ['settings.manage'] },
];

export function visibleNav(canAny: (...p: Permission[]) => boolean): NavSection[] {
  return NAV.map((s) => ({ ...s, items: s.items.filter((i) => i.ready && (!i.anyOf.length || canAny(...i.anyOf))) })).filter((s) => s.items.length);
}

/**
 * Permissions needed to open an in-app link, taken from the most specific nav item whose href is a
 * prefix of it (e.g. /settings/boarding-units → settings.manage). Empty = anyone signed in.
 */
export function hrefPermissions(href: string): Permission[] {
  const path = href.split(/[?#]/)[0];
  let best: { href: string; anyOf: Permission[] } | undefined;
  for (const item of [...NAV.flatMap((s) => s.items), ...SETTINGS_NAV]) {
    if ((path === item.href || path.startsWith(`${item.href}/`)) && (!best || item.href.length > best.href.length)) best = item;
  }
  return best?.anyOf ?? [];
}
