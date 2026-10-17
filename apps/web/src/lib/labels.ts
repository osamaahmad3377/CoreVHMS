import { enumLabel } from '@vcms/shared';
/** Plain-language names for record types and statuses that would otherwise appear as codes. */

/** Where a charge came from (Charge.sourceType). */
export const CHARGE_SOURCE_LABEL: Record<string, string> = {
  Dispensation: 'Dispensed',
  DISPENSATION: 'Dispensed',
  Administration: 'Given in clinic',
  ADMINISTRATION: 'Given in clinic',
  DiagnosticOrderItem: 'Lab test',
  Encounter: 'Consultation',
  Appointment: 'Appointment',
  BoardingStay: 'Boarding',
  GroomingJobService: 'Grooming',
  HospitalDay: 'Hospital stay',
  Surgery: 'Surgery',
  SurgeryItem: 'Used in surgery',
  FieldVisit: 'Farm visit call-out',
  FieldVisitItem: 'Farm visit',
  GroupTreatment: 'Herd treatment',
  CareItem: 'Preventive care',
  Referral: 'Referral',
  Manual: 'Added by staff',
};
export const chargeSource = (t: string) => CHARGE_SOURCE_LABEL[t] ?? t.replace(/([a-z])([A-Z])/g, '$1 $2');

/** Status words that read better than the generic code-to-words conversion. */
export const STATUS_LABEL: Record<string, string> = {
  PARTIALLY_PAID: 'Partly paid',
  PARTIALLY_RECEIVED: 'Partly received',
  PARTIALLY_DISPENSED: 'Partly dispensed',
  IN_CONSULTATION: 'In consultation',
  CHECKED_IN: 'Checked in',
  NO_SHOW: 'No-show',
};

/** "1 bag", "3 bags"; units that are abbreviations (mL, kg, g) never take an s. */
export function qtyUnit(n: number, unit: string) {
  const abbreviation = /^(mL|L|g|kg|mg|mcg|IU|cm|mm)$/.test(unit);
  return `${n} ${abbreviation || n === 1 ? unit : unit.endsWith('s') ? unit : `${unit}s`}`;
}

/** Administration route for display: abbreviations stay as written (PO, SC, IM, IV); words read as words ("Intramammary"). */
export function routeLabel(route: string) {
  return /^[A-Z]{2}$/.test(route) ? route : enumLabel(route);
}
