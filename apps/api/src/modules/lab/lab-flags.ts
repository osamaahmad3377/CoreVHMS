export interface IntervalLike {
  sex: string | null;
  ageMinMonths: number | null;
  ageMaxMonths: number | null;
  low: number | null;
  high: number | null;
  criticalLow: number | null;
  criticalHigh: number | null;
  source: string;
}

/** Neutering does not change the biological sex used for interval selection. */
const baseSex = (s?: string | null) => (s ? s.replace('_NEUTERED', '').replace('_SPAYED', '') : null);

/**
 * Picks the most specific interval for the patient: sex-specific beats generic, and a narrower
 * matching age band beats a wider one. Returns null when no configured interval applies.
 */
export function selectInterval<T extends IntervalLike>(intervals: T[], patient: { sex?: string | null; ageMonths?: number | null }): T | null {
  const sex = baseSex(patient.sex);
  const candidates = intervals.filter((i) => {
    if (i.sex && baseSex(i.sex) !== sex) return false;
    if (patient.ageMonths == null) return i.ageMinMonths == null && i.ageMaxMonths == null;
    if (i.ageMinMonths != null && patient.ageMonths < i.ageMinMonths) return false;
    if (i.ageMaxMonths != null && patient.ageMonths > i.ageMaxMonths) return false;
    return true;
  });
  return rank(candidates)[0] ?? null;
}

function rank<T extends IntervalLike>(candidates: T[]): T[] {
  const score = (i: IntervalLike) => (i.sex ? 1000 : 0) + (i.ageMinMonths != null || i.ageMaxMonths != null ? 1000 - Math.min(999, (i.ageMaxMonths ?? 1200) - (i.ageMinMonths ?? 0)) : 0);
  return [...candidates].sort((a, b) => score(b) - score(a));
}

/**
 * The most specific interval supplies low/high and source; critical limits fall back to the next
 * applicable interval when the specific one does not define them, so critical alerting is never lost.
 */
export function effectiveInterval<T extends IntervalLike>(intervals: T[], patient: { sex?: string | null; ageMonths?: number | null }): IntervalLike | null {
  const best = selectInterval(intervals, patient);
  if (!best) return null;
  const sex = baseSex(patient.sex);
  const applicable = rank(
    intervals.filter((i) => {
      if (i.sex && baseSex(i.sex) !== sex) return false;
      if (patient.ageMonths == null) return i.ageMinMonths == null && i.ageMaxMonths == null;
      return (i.ageMinMonths == null || patient.ageMonths >= i.ageMinMonths) && (i.ageMaxMonths == null || patient.ageMonths <= i.ageMaxMonths);
    }),
  );
  return {
    ...best,
    criticalLow: best.criticalLow ?? applicable.find((i) => i.criticalLow != null)?.criticalLow ?? null,
    criticalHigh: best.criticalHigh ?? applicable.find((i) => i.criticalHigh != null)?.criticalHigh ?? null,
  };
}

export type Flag = 'NORMAL' | 'LOW' | 'HIGH' | 'CRITICAL_LOW' | 'CRITICAL_HIGH';

export function flagValue(value: number, i: Pick<IntervalLike, 'low' | 'high' | 'criticalLow' | 'criticalHigh'> | null): Flag | null {
  if (!i) return null;
  if (i.criticalLow != null && value <= i.criticalLow) return 'CRITICAL_LOW';
  if (i.criticalHigh != null && value >= i.criticalHigh) return 'CRITICAL_HIGH';
  if (i.low != null && value < i.low) return 'LOW';
  if (i.high != null && value > i.high) return 'HIGH';
  if (i.low == null && i.high == null) return null;
  return 'NORMAL';
}

export function ageInMonths(dob: Date | null, at = new Date()) {
  if (!dob) return null;
  return (at.getFullYear() - dob.getFullYear()) * 12 + (at.getMonth() - dob.getMonth()) - (at.getDate() < dob.getDate() ? 1 : 0);
}
