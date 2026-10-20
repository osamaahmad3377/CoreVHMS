import type { OptionalModule, Permission } from '@vcms/shared';
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
  LayoutList,
  LifeBuoy,
  MessageSquare,
  Palette,
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
  ToggleRight,
  Tractor,
  type LucideIcon,
  UserCog,
  Users,
} from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Visible if the user holds ANY of these permissions (empty = everyone). */
  anyOf: Permission[];
  /** Hidden until the module is implemented end-to-end (no links to empty pages). */
  ready: boolean;
  /** Optional area (Settings → Services you offer); hidden while the clinic has it switched off. */
  module?: OptionalModule;
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
      { label: 'Pharmacy', href: '/pharmacy', icon: Pill, anyOf: ['prescriptions.read', 'pharmacy.dispense'], ready: true },
      { label: 'Lab & X-ray', href: '/lab', icon: FlaskConical, anyOf: ['lab.read'], ready: true, module: 'lab' },
      { label: 'Hospital', href: '/hospital', icon: Bed, anyOf: ['hospital.read'], ready: true, module: 'hospital' },
      { label: 'Surgery', href: '/surgery', icon: HeartPulse, anyOf: ['surgery.read'], ready: true, module: 'surgery' },
      { label: 'Vaccines & reminders', href: '/preventive', icon: Syringe, anyOf: ['preventive.read'], ready: true },
    ],
  },
  {
    label: 'Money & stock',
    items: [
      { label: 'Shop counter', href: '/pos', icon: ShoppingCart, anyOf: ['pos.use'], ready: true },
      { label: 'Billing', href: '/billing', icon: Receipt, anyOf: ['billing.read'], ready: true },
      { label: 'Stock', href: '/inventory', icon: Boxes, anyOf: ['inventory.read', 'procurement.read'], ready: true },
      { label: 'Reports', href: '/reports', icon: BarChart3, anyOf: ['reports.view'], ready: true },
    ],
  },
  {
    label: 'Extra services',
    items: [
      { label: 'Livestock & farms', href: '/livestock', icon: Tractor, anyOf: ['livestock.read'], ready: true, module: 'livestock' },
      { label: 'Boarding & grooming', href: '/boarding', icon: Scissors, anyOf: ['boarding.read'], ready: true, module: 'boarding' },
      { label: 'Insurance & referrals', href: '/insurance', icon: ShieldCheck, anyOf: ['insurance.read'], ready: true, module: 'insurance' },
    ],
  },
  {
    label: 'Team',
    items: [
      { label: 'Staff', href: '/staff', icon: UserCog, anyOf: ['staff.read', 'users.read'], ready: true },
      { label: 'Messages', href: '/communications', icon: MessageSquare, anyOf: ['communications.read'], ready: true },
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
      { label: 'Activity log', href: '/audit', icon: ScrollText, anyOf: ['audit.read'], ready: true },
    ],
  },
];

export type SettingsGroup = 'Your clinic' | 'Staff & access' | 'Prices & billing' | 'Rooms & spaces' | 'Clinical setup';
export const SETTINGS_GROUPS: SettingsGroup[] = ['Your clinic', 'Staff & access', 'Prices & billing', 'Rooms & spaces', 'Clinical setup'];

/** Settings pages, grouped the way an owner thinks about them; `hint` is the one-line description on the Settings home page. */
export const SETTINGS_NAV: { label: string; href: string; icon: LucideIcon; anyOf: Permission[]; group: SettingsGroup; hint: string; module?: OptionalModule; /** Only where the installation has plans (multi-clinic hosting). */ plansOnly?: boolean }[] = [
  { label: 'Clinic details', href: '/settings/organization', icon: Building2, anyOf: ['org.manage'], group: 'Your clinic', hint: 'Name, address, phone and tax number' },
  { label: 'Branding', href: '/settings/branding', icon: Palette, anyOf: ['branding.manage'], group: 'Your clinic', hint: 'Logo, colours and the name staff see (owner only)' },
  { label: 'Your plan', href: '/settings/plan', icon: LayoutList, anyOf: ['org.manage'], group: 'Your clinic', hint: 'What your plan includes, and how many staff and branches you use', plansOnly: true },
  { label: 'Services you offer', href: '/settings/modules', icon: ToggleRight, anyOf: ['settings.manage', 'org.manage'], group: 'Your clinic', hint: 'Switch hospital, surgery, lab, farms, boarding or insurance on or off' },
  { label: 'Branches', href: '/settings/branches', icon: Building2, anyOf: ['branches.manage'], group: 'Your clinic', hint: 'Each location, its address and time zone' },
  { label: 'Receipts & printing', href: '/settings/receipts', icon: Printer, anyOf: ['settings.manage'], group: 'Your clinic', hint: 'Receipt size, logo and the text printed on it' },
  { label: 'Reminder messages', href: '/settings/communications', icon: MessageSquare, anyOf: ['settings.manage'], group: 'Your clinic', hint: 'When reminders are sent and what they say' },
  { label: 'Staff accounts', href: '/settings/staff', icon: Users, anyOf: ['users.read'], group: 'Staff & access', hint: 'Add staff, reset passwords, suspend access' },
  { label: 'Roles & permissions', href: '/settings/roles', icon: Shield, anyOf: ['roles.manage', 'users.read'], group: 'Staff & access', hint: 'What each job is allowed to see and do (advanced)' },
  { label: 'Services & prices', href: '/settings/services', icon: Receipt, anyOf: ['settings.manage'], group: 'Prices & billing', hint: 'Your price list: consultations, vaccinations, procedures' },
  { label: 'Appointment types', href: '/settings/appointment-types', icon: CalendarDays, anyOf: ['settings.manage'], group: 'Prices & billing', hint: 'What can be booked, how long it takes and what it charges' },
  { label: 'Tax & payments', href: '/settings/billing', icon: Receipt, anyOf: ['settings.manage'], group: 'Prices & billing', hint: 'Sales tax, days to pay, cash drawer rules' },
  { label: 'Rooms & equipment', href: '/settings/resources', icon: Bed, anyOf: ['settings.manage'], group: 'Rooms & spaces', hint: 'Consult rooms, theatre and equipment that can be booked' },
  { label: 'Hospital wards & cages', href: '/settings/wards', icon: Bed, anyOf: ['settings.manage'], group: 'Rooms & spaces', hint: 'Where admitted patients stay and the daily fee', module: 'hospital' },
  { label: 'Boarding kennels', href: '/settings/boarding-units', icon: Bed, anyOf: ['settings.manage'], group: 'Rooms & spaces', hint: 'Kennels and catteries for boarding, and the nightly price', module: 'boarding' },
  { label: 'Consultation templates', href: '/settings/templates', icon: FileText, anyOf: ['settings.manage'], group: 'Clinical setup', hint: 'Ready-made note layouts for common visits' },
  { label: 'Species & breeds', href: '/settings/species', icon: PawPrint, anyOf: ['settings.manage'], group: 'Clinical setup', hint: 'Already filled in; add a breed if one is missing' },
  { label: 'Normal vital-sign ranges', href: '/settings/vital-references', icon: Activity, anyOf: ['settings.manage'], group: 'Clinical setup', hint: 'Normal temperature, heart rate… per species, to flag readings' },
  { label: 'Surgical checklist', href: '/settings/surgery-checklist', icon: Scissors, anyOf: ['settings.manage'], group: 'Clinical setup', hint: 'Safety checks ticked before each operation', module: 'surgery' },
  { label: 'Livestock pregnancy lengths', href: '/settings/livestock', icon: Tractor, anyOf: ['settings.manage'], group: 'Clinical setup', hint: 'Used to work out calving and lambing dates', module: 'livestock' },
];

/** `modules` = the clinic's enabled optional modules (session.organization.enabledModules); omitted = all on. */
export function visibleNav(canAny: (...p: Permission[]) => boolean, modules?: readonly OptionalModule[]): NavSection[] {
  return NAV.map((s) => ({ ...s, items: s.items.filter((i) => i.ready && moduleOn(i.module, modules) && (!i.anyOf.length || canAny(...i.anyOf))) })).filter((s) => s.items.length);
}

/** Settings pages the user may open, without those of switched-off modules. */
export function visibleSettings(canAny: (...p: Permission[]) => boolean, modules?: readonly OptionalModule[], hasPlans = false) {
  return SETTINGS_NAV.filter((i) => (!i.plansOnly || hasPlans) && moduleOn(i.module, modules) && canAny(...i.anyOf));
}

export function moduleOn(module: OptionalModule | undefined, enabled?: readonly OptionalModule[]) {
  return !module || !enabled || enabled.includes(module);
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
