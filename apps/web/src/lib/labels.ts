import { enumLabel, findFrequency } from '@vcms/shared';
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
  CareItem: 'Vaccine or preventive care',
  Referral: 'Referral',
  Manual: 'Added by staff',
};
export const chargeSource = (t: string) => CHARGE_SOURCE_LABEL[t] ?? t.replace(/([a-z])([A-Z])/g, '$1 $2');

/** Status words that read better than the generic code-to-words conversion. */
export const STATUS_LABEL: Record<string, string> = {
  // Invoices: Unpaid / Partly paid / Paid / Cancelled.
  ISSUED: 'Unpaid',
  VOID: 'Cancelled',
  PARTIALLY_PAID: 'Partly paid',
  PARTIALLY_RECEIVED: 'Partly received',
  PARTIALLY_DISPENSED: 'Partly dispensed',
  IN_CONSULTATION: 'In consultation',
  CHECKED_IN: 'Checked in',
  NO_SHOW: 'No-show',
};

/** Estimate statuses in plain words (the codes are shared with other records, so they are not in STATUS_LABEL). */
export const ESTIMATE_STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft',
  SENT: 'Given to client',
  ACCEPTED: 'Client agreed',
  DECLINED: 'Client said no',
  CONVERTED: 'Turned into invoice',
  EXPIRED: 'Expired',
};

/**
 * Splits an internal record number off the end of a description so it can be shown small and grey:
 * "Amoxicillin 250 mg (RX-000010)" → ["Amoxicillin 250 mg", "RX-000010"].
 */
export function splitRef(text: string): [string, string | null] {
  const m = /^(.*?)\s*\(([A-Z]{1,6}-\d{3,})\)\s*$/.exec(text);
  return m && m[1] ? [m[1], m[2]] : [text, null];
}

/** "1 bag", "3 bags"; units that are abbreviations (mL, kg, g) never take an s. */
export function qtyUnit(n: number, unit: string) {
  const abbreviation = /^(mL|L|g|kg|mg|mcg|IU|cm|mm)$/.test(unit);
  return `${n} ${abbreviation || n === 1 ? unit : unit.endsWith('s') ? unit : `${unit}s`}`;
}

/** Plain words first, the abbreviation in brackets. */
const ROUTE_LABEL: Record<string, string> = {
  PO: 'By mouth (PO)',
  SC: 'Under the skin (SC)',
  IM: 'Into muscle (IM)',
  IV: 'Into vein (IV)',
};

/** Administration route for display: "By mouth (PO)"; other routes read as words ("Intramammary"). */
export function routeLabel(route: string) {
  return ROUTE_LABEL[route] ?? (/^[A-Z]{2}$/.test(route) ? route : enumLabel(route));
}

/** Frequency for staff screens, from a code or stored text: "Twice daily (BID)" → "2 times a day (BID)". */
export function frequencyLabel(codeOrText: string | null | undefined) {
  if (!codeOrText) return '';
  return findFrequency(codeOrText)?.label ?? codeOrText;
}
