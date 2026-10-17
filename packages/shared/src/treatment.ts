/**
 * Minutes after its scheduled time before a hospital treatment counts as overdue. Until then it is
 * "due now" — so a treatment whose first dose is due on creation is not flagged overdue straight away.
 * Used by the API (flowboard, dashboard) and the web treatment sheet, so both agree.
 */
export const TREATMENT_OVERDUE_GRACE_MINUTES = 30;

export type TreatmentTiming = 'UPCOMING' | 'DUE_NOW' | 'OVERDUE';

export function treatmentTiming(dueAt: Date | string, now: Date = new Date()): TreatmentTiming {
  const due = typeof dueAt === 'string' ? new Date(dueAt) : dueAt;
  if (due.getTime() > now.getTime()) return 'UPCOMING';
  return now.getTime() - due.getTime() > TREATMENT_OVERDUE_GRACE_MINUTES * 60_000 ? 'OVERDUE' : 'DUE_NOW';
}

/** Treatments due before this instant are overdue. */
export const overdueCutoff = (now: Date = new Date()) => new Date(now.getTime() - TREATMENT_OVERDUE_GRACE_MINUTES * 60_000);
