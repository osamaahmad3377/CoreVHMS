import type { AppointmentCategory } from '@prisma/client';

/** The categories every clinic starts with — one per built-in kind. The clinic can rename, hide or add to them. */
export const DEFAULT_APPOINTMENT_CATEGORIES: { name: string; kind: AppointmentCategory; sortOrder: number }[] = [
  { name: 'Consultation', kind: 'CONSULTATION', sortOrder: 10 },
  { name: 'Vaccination', kind: 'VACCINATION', sortOrder: 20 },
  { name: 'Follow-up', kind: 'FOLLOW_UP', sortOrder: 30 },
  { name: 'Surgery', kind: 'SURGERY', sortOrder: 40 },
  { name: 'Dental', kind: 'DENTAL', sortOrder: 50 },
  { name: 'Diagnostics', kind: 'DIAGNOSTICS', sortOrder: 60 },
  { name: 'Grooming', kind: 'GROOMING', sortOrder: 70 },
  { name: 'Emergency', kind: 'EMERGENCY', sortOrder: 80 },
  { name: 'Field visit', kind: 'FIELD_VISIT', sortOrder: 90 },
  { name: 'Other', kind: 'OTHER', sortOrder: 100 },
];

/** A plain or tenant-scoped transaction (both have the same appointmentTypeCategory methods). */
type Tx = { appointmentTypeCategory: any };

/**
 * A category of this kind for an appointment type that only says its kind (older screens, starter setup):
 * the first active one of that kind, else any, else the starter category is created again.
 */
export async function categoryForKind(tx: Tx, organizationId: string, kind: AppointmentCategory) {
  const found = await tx.appointmentTypeCategory.findFirst({ where: { organizationId, kind }, orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }] });
  if (found) return found.id;
  const d = DEFAULT_APPOINTMENT_CATEGORIES.find((c) => c.kind === kind)!;
  const created = await tx.appointmentTypeCategory.upsert({
    where: { organizationId_name: { organizationId, name: d.name } },
    create: { organizationId, name: d.name, kind, sortOrder: d.sortOrder },
    update: {},
  });
  return created.id;
}
