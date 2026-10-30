/**
 * Permission catalogue. Keys are `<domain>.<action>`.
 * The API enforces these on every protected route; the web app only uses them
 * to decide what to show.
 */
export const PERMISSION_GROUPS = {
  administration: {
    label: 'Administration',
    permissions: {
      'org.manage': 'Manage organization profile and branding',
      'branches.manage': 'Create and edit branches',
      'users.read': 'View staff accounts',
      'users.manage': 'Invite, edit and deactivate staff accounts',
      'roles.manage': 'Create and edit roles and permissions',
      'settings.manage': 'Manage clinic configuration (catalogues, numbering, taxes)',
      'audit.read': 'View audit logs',
      'integrations.manage': 'Configure integrations and API keys',
      'privacy.manage': 'Export a client’s personal data and anonymise clients on request',
      'branding.manage': 'Change the logo, colours and name shown in the app (owner only)',
    },
  },
  dashboard: {
    label: 'Dashboard',
    permissions: {
      'dashboard.view': 'View operational dashboard',
    },
  },
  clients: {
    label: 'Clients & patients',
    permissions: {
      'clients.read': 'View clients',
      'clients.write': 'Create and edit clients',
      'clients.merge': 'Merge duplicate clients',
      'clients.archive': 'Archive and restore clients',
      'clients.export': 'Export client data',
      'patients.read': 'View animal patients',
      'patients.write': 'Register and edit patients',
      'patients.merge': 'Merge duplicate patients',
      'patients.archive': 'Archive patients and record deaths/transfers',
      'patients.export': 'Download a patient’s complete record (everything held about the patient)',
    },
  },
  scheduling: {
    label: 'Appointments',
    permissions: {
      'appointments.read': 'View calendar and appointments',
      'appointments.write': 'Book, reschedule and cancel appointments',
      'appointments.checkin': 'Check in patients and manage the queue',
      'triage.write': 'Record triage assessments',
    },
  },
  clinical: {
    label: 'Clinical records',
    permissions: {
      'clinical.read': 'View clinical records',
      'clinical.write': 'Create and edit draft clinical notes',
      'clinical.sign': 'Sign clinical records',
      'clinical.amend': 'Amend signed clinical records',
      'ai.use': 'Use AI documentation assistance',
    },
  },
  pharmacy: {
    label: 'Prescriptions & pharmacy',
    permissions: {
      'prescriptions.read': 'View prescriptions',
      'prescriptions.write': 'Draft prescriptions',
      'prescriptions.authorize': 'Authorize prescriptions',
      'pharmacy.dispense': 'Dispense medication',
      'formulary.manage': 'Manage medicine catalogue and dosage references',
    },
  },
  diagnostics: {
    label: 'Laboratory & diagnostics',
    permissions: {
      'lab.read': 'View diagnostic orders and results',
      'lab.order': 'Order diagnostic tests',
      'lab.result': 'Enter results',
      'lab.approve': 'Validate and release results',
    },
  },
  inpatient: {
    label: 'Hospital & surgery',
    permissions: {
      'hospital.read': 'View hospitalized patients',
      'hospital.write': 'Admit, treat and discharge patients',
      'surgery.read': 'View surgeries',
      'surgery.write': 'Schedule and record surgeries and anaesthesia',
    },
  },
  preventive: {
    label: 'Preventive care',
    permissions: {
      'preventive.read': 'View vaccinations and reminders',
      'preventive.write': 'Record vaccinations and manage care plans',
      'wellness.read': 'View wellness plans and members',
      'wellness.enrol': 'Enrol patients on wellness plans, renew and cancel them',
      'wellness.manage': 'Create wellness plans and change their prices and benefits',
    },
  },
  inventory: {
    label: 'Inventory & procurement',
    permissions: {
      'inventory.read': 'View products and stock',
      'inventory.write': 'Manage products and receive stock',
      'inventory.adjust': 'Adjust, transfer and write off stock',
      'procurement.read': 'View purchase orders and suppliers',
      'procurement.request': 'Ask for items to be ordered',
      'procurement.write': 'Create purchase orders and supplier returns; turn requests into orders',
      'procurement.approve': 'Approve purchase orders',
    },
  },
  finance: {
    label: 'Billing & finance',
    permissions: {
      'billing.read': 'View invoices, estimates and balances',
      'billing.write': 'Create and edit invoices and estimates',
      'billing.void': 'Void issued invoices',
      'billing.refund': 'Issue refunds and credit notes',
      'payments.take': 'Record payments',
      'pos.use': 'Use point of sale',
      'cash.manage': 'Open, close and reconcile cash registers',
      'expenses.write': 'Record expenses',
    },
  },
  farm: {
    label: 'Livestock & farm',
    permissions: {
      'livestock.read': 'View farms, herds and production records',
      'livestock.write': 'Manage farms, herds, breeding and production records',
    },
  },
  services: {
    label: 'Boarding, grooming, insurance & referrals',
    permissions: {
      'boarding.read': 'View boarding and grooming',
      'boarding.write': 'Manage boarding and grooming',
      'insurance.read': 'View insurance and referrals',
      'insurance.write': 'Manage insurance claims and referrals',
    },
  },
  staff: {
    label: 'Staff & scheduling',
    permissions: {
      'staff.read': 'View staff rosters',
      'staff.manage': 'Manage rosters, working hours and leave',
      'attendance.clock': 'Clock in and out, and see your own attendance',
      'attendance.manage': 'See everyone’s attendance and correct clock times',
    },
  },
  reporting: {
    label: 'Reports',
    permissions: {
      'reports.view': 'View operational reports',
      'reports.financial': 'View financial reports',
    },
  },
  communications: {
    label: 'Communications & documents',
    permissions: {
      'communications.read': 'View communication history',
      'communications.send': 'Send messages and manage reminders',
      'documents.read': 'View documents and templates',
      'documents.write': 'Manage documents and templates',
    },
  },
} as const;

type Groups = typeof PERMISSION_GROUPS;
export type PermissionGroupKey = keyof Groups;
export type Permission = {
  [G in PermissionGroupKey]: keyof Groups[G]['permissions'];
}[PermissionGroupKey] &
  string;

export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSION_GROUPS).flatMap(
  (g) => Object.keys(g.permissions) as Permission[],
);

const PERMISSION_SET = new Set<string>(ALL_PERMISSIONS);

export function isPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value);
}

/**
 * Permissions only the clinic owner role holds: they cannot be put into any other role, so only owners have them.
 */
export const OWNER_ONLY_PERMISSIONS: readonly Permission[] = ['branding.manage'];

/**
 * Super admin permissions (multi-clinic hosting). Never part of a clinic role: the API grants them only to
 * platform administrators signed in at the super admin address.
 */
export const PLATFORM_PERMISSIONS = {
  'platform.clinics.manage': 'Add clinics, pause and reactivate them',
  'platform.plans.manage': 'Create plans and choose each clinic’s plan and limits',
  'platform.billing.manage': 'Record clinic payments, cancel them and send payment reminders',
} as const;
export type PlatformPermission = keyof typeof PLATFORM_PERMISSIONS;
export const ALL_PLATFORM_PERMISSIONS = Object.keys(PLATFORM_PERMISSIONS) as PlatformPermission[];

export function hasPermission(
  granted: readonly string[] | ReadonlySet<string>,
  required: Permission | readonly Permission[],
): boolean {
  const set = granted instanceof Set ? granted : new Set(granted as readonly string[]);
  const req = (Array.isArray(required) ? required : [required]) as readonly Permission[];
  return req.every((p) => set.has(p));
}

function pick(prefixes: string[], extra: Permission[] = [], exclude: Permission[] = []): Permission[] {
  const set = new Set<Permission>(
    ALL_PERMISSIONS.filter((p) => prefixes.some((pre) => p === pre || p.startsWith(pre + '.'))),
  );
  extra.forEach((p) => set.add(p));
  exclude.forEach((p) => set.delete(p));
  return [...set];
}

export interface RoleTemplate {
  key: string;
  name: string;
  description: string;
  permissions: Permission[];
}

/**
 * System role templates. Each organization gets a copy of these on creation.
 * System roles cannot be deleted, but organizations may create custom roles.
 */
export const SYSTEM_ROLE_TEMPLATES: RoleTemplate[] = [
  {
    key: 'owner',
    name: 'Organization owner',
    description: 'Full access to every module and setting.',
    permissions: [...ALL_PERMISSIONS],
  },
  {
    key: 'practice_manager',
    name: 'Practice manager',
    description: 'Runs day-to-day operations, staff, inventory and finance.',
    permissions: pick(
      ['dashboard', 'clients', 'patients', 'appointments', 'triage', 'billing', 'payments', 'pos', 'cash', 'expenses',
        'inventory', 'procurement', 'reports', 'communications', 'documents', 'staff', 'users', 'boarding', 'insurance',
        'preventive', 'branches', 'settings', 'audit', 'livestock', 'privacy', 'attendance', 'wellness'],
      ['clinical.read', 'prescriptions.read', 'lab.read', 'hospital.read', 'surgery.read'],
      ['roles.manage' as Permission],
    ),
  },
  {
    key: 'veterinarian',
    name: 'Veterinarian',
    description: 'Clinical care, prescribing, diagnostics and records.',
    permissions: pick(
      ['dashboard', 'clinical', 'ai', 'prescriptions', 'pharmacy', 'lab', 'hospital', 'surgery', 'preventive', 'triage',
        'appointments', 'livestock', 'documents'],
      ['clients.read', 'clients.write', 'patients.read', 'patients.write', 'patients.archive', 'patients.export', 'billing.read',
        'billing.write', 'inventory.read', 'reports.view', 'communications.read', 'communications.send',
        'boarding.read', 'insurance.read', 'insurance.write', 'staff.read', 'procurement.request', 'attendance.clock',
        'wellness.read', 'wellness.enrol'],
      ['formulary.manage' as Permission],
    ),
  },
  {
    key: 'nurse',
    name: 'Veterinary nurse / technician',
    description: 'Nursing care, triage, observations and treatment administration.',
    permissions: pick(
      ['dashboard', 'appointments', 'triage', 'hospital', 'preventive'],
      ['clients.read', 'clients.write', 'patients.read', 'patients.write', 'clinical.read', 'clinical.write',
        'prescriptions.read', 'prescriptions.write', 'pharmacy.dispense', 'lab.read', 'lab.order', 'lab.result', 'surgery.read',
        'surgery.write', 'inventory.read', 'billing.read', 'documents.read', 'boarding.read', 'boarding.write',
        'staff.read', 'procurement.request', 'attendance.clock', 'wellness.read'],
    ),
  },
  {
    key: 'receptionist',
    name: 'Receptionist',
    description: 'Front desk, bookings, check-in, client records and payments.',
    permissions: pick(
      ['dashboard', 'appointments'],
      ['clients.read', 'clients.write', 'patients.read', 'patients.write', 'billing.read', 'billing.write',
        'payments.take', 'pos.use', 'preventive.read', 'communications.read', 'communications.send',
        'documents.read', 'boarding.read', 'boarding.write', 'insurance.read', 'staff.read', 'inventory.read', 'attendance.clock',
        'wellness.read', 'wellness.enrol'],
    ),
  },
  {
    key: 'lab_technician',
    name: 'Laboratory technician',
    description: 'Sample handling and result entry.',
    permissions: pick(['lab'], ['dashboard.view', 'patients.read', 'clients.read', 'clinical.read', 'inventory.read', 'attendance.clock'], [
      'lab.approve' as Permission,
    ]),
  },
  {
    key: 'pharmacy',
    name: 'Pharmacy / dispensary',
    description: 'Dispensing, stock and retail sales.',
    permissions: pick(['pharmacy', 'inventory', 'formulary'], ['dashboard.view', 'patients.read', 'clients.read',
      'prescriptions.read', 'pos.use', 'payments.take', 'billing.read', 'procurement.read', 'procurement.write', 'procurement.request', 'attendance.clock']),
  },
  {
    key: 'surgeon',
    name: 'Surgeon / anaesthetist',
    description: 'Surgery, anaesthesia and peri-operative care.',
    permissions: pick(['surgery', 'hospital', 'clinical'], ['dashboard.view', 'patients.read', 'clients.read',
      'prescriptions.read', 'prescriptions.write', 'prescriptions.authorize', 'lab.read', 'lab.order',
      'appointments.read', 'inventory.read', 'procurement.request', 'attendance.clock']),
  },
  {
    key: 'ward_staff',
    name: 'Ward / inpatient staff',
    description: 'Inpatient observations, feeding and treatment administration.',
    permissions: pick(['hospital'], ['dashboard.view', 'patients.read', 'clients.read', 'clinical.read',
      'prescriptions.read', 'pharmacy.dispense', 'boarding.read', 'boarding.write', 'procurement.request', 'attendance.clock']),
  },
  {
    key: 'inventory_officer',
    name: 'Inventory & procurement officer',
    description: 'Stock control, suppliers and purchasing.',
    permissions: pick(['inventory', 'procurement'], ['dashboard.view', 'reports.view', 'attendance.clock'], [
      'procurement.approve' as Permission,
    ]),
  },
  {
    key: 'accountant',
    name: 'Accountant / cashier',
    description: 'Invoicing, payments, cash registers and financial reports.',
    permissions: pick(['billing', 'payments', 'pos', 'cash', 'expenses', 'reports'], ['dashboard.view',
      'clients.read', 'patients.read', 'procurement.read', 'inventory.read', 'insurance.read', 'attendance.clock', 'wellness.read']),
  },
  {
    key: 'field_vet',
    name: 'Farm / field veterinarian',
    description: 'Livestock, herd health and field visits.',
    permissions: pick(['livestock', 'clinical', 'prescriptions', 'preventive', 'lab'], ['dashboard.view',
      'clients.read', 'clients.write', 'patients.read', 'patients.write', 'appointments.read',
      'appointments.write', 'billing.read', 'billing.write', 'payments.take', 'inventory.read', 'procurement.request', 'attendance.clock'], [
      'clinical.amend' as Permission,
    ]),
  },
  {
    key: 'referral_partner',
    name: 'External laboratory / referral partner',
    description: 'Limited read access to referred patients and diagnostic orders.',
    permissions: ['patients.read', 'clinical.read', 'lab.read', 'lab.result'],
  },
];
