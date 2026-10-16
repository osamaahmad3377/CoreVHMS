/**
 * Weight-based dose calculation with explicit unit handling and rounding.
 * This performs arithmetic only — it contains NO clinical dose values. Dose ranges come from
 * clinic-maintained, sourced references reviewed by a veterinarian.
 */
export interface DoseInput {
  weightKg?: number | null;
  doseValue: number;
  /** e.g. "mg/kg", "mcg/kg", "IU/kg", "mL/kg", "mg", "mL", "tablet", "mg/animal" */
  doseUnit: string;
  /** Strength per ONE dispensing unit (e.g. 50 for "50 mg per tablet"). */
  strengthValue?: number | null;
  strengthUnit?: string | null;
  dispensingUnit: string;
  /** Smallest amount that can be dispensed/administered, in dispensing units (e.g. 0.25 tablet, 0.1 mL). */
  increment: number;
  rounding?: 'nearest' | 'down' | 'up';
}

export interface DoseResult {
  ok: true;
  /** Exact amount per dose in dispensing units before rounding. */
  rawAmount: number;
  /** Amount per dose rounded to the increment. */
  amount: number;
  dispensingUnit: string;
  /** Active substance actually delivered after rounding, in the strength unit (null when not applicable). */
  deliveredDose: number | null;
  deliveredUnit: string | null;
  /** Delivered dose per kg (null when not weight based). */
  deliveredPerKg: number | null;
  /** Rounding difference as a percentage of the exact dose. */
  roundingPercent: number;
  steps: string[];
}

export interface DoseError {
  ok: false;
  error: string;
}

const MASS: Record<string, number> = { mcg: 0.001, µg: 0.001, mg: 1, g: 1000 };
const r4 = (n: number) => Math.round(n * 10000) / 10000;

function convert(value: number, from: string, to: string): number | null {
  if (from === to) return value;
  if (from in MASS && to in MASS) return (value * MASS[from]) / MASS[to];
  return null;
}

export function calculateDose(input: DoseInput): DoseResult | DoseError {
  const steps: string[] = [];
  const { doseValue, dispensingUnit, increment } = input;
  if (!(doseValue > 0)) return { ok: false, error: 'Dose must be greater than zero' };
  if (!(increment > 0)) return { ok: false, error: 'Product has no valid dispensing increment' };
  const unit = input.doseUnit.trim();
  const perKg = /\/kg$/i.test(unit);
  const base = unit.replace(/\/(kg|animal)$/i, '');

  let total: number; // in `base` units
  if (perKg) {
    if (!input.weightKg || input.weightKg <= 0) return { ok: false, error: 'A current body weight is required for a per-kg dose' };
    total = doseValue * input.weightKg;
    steps.push(`${doseValue} ${unit} × ${input.weightKg} kg = ${r4(total)} ${base}`);
  } else {
    total = doseValue;
    steps.push(`Fixed dose: ${doseValue} ${base}`);
  }

  let rawAmount: number;
  let deliveredUnit: string | null = null;
  if (base.toLowerCase() === dispensingUnit.toLowerCase()) {
    rawAmount = total;
  } else {
    if (!input.strengthValue || !input.strengthUnit) {
      return { ok: false, error: `Product strength is not configured, so ${base} cannot be converted to ${dispensingUnit}` };
    }
    const inStrengthUnit = convert(total, base, input.strengthUnit);
    if (inStrengthUnit === null) {
      return { ok: false, error: `Cannot convert ${base} to the product strength unit (${input.strengthUnit})` };
    }
    if (base !== input.strengthUnit) steps.push(`${r4(total)} ${base} = ${r4(inStrengthUnit)} ${input.strengthUnit}`);
    rawAmount = inStrengthUnit / input.strengthValue;
    deliveredUnit = input.strengthUnit;
    steps.push(`${r4(inStrengthUnit)} ${input.strengthUnit} ÷ ${input.strengthValue} ${input.strengthUnit}/${dispensingUnit} = ${r4(rawAmount)} ${dispensingUnit}`);
  }

  const mode = input.rounding ?? 'nearest';
  const units = rawAmount / increment;
  const roundedUnits = mode === 'down' ? Math.floor(units + 1e-9) : mode === 'up' ? Math.ceil(units - 1e-9) : Math.round(units);
  const amount = r4(roundedUnits * increment);
  steps.push(`Rounded ${mode} to the nearest ${increment} ${dispensingUnit}: ${amount} ${dispensingUnit}`);
  if (amount <= 0) return { ok: false, error: `The calculated amount (${r4(rawAmount)} ${dispensingUnit}) is below the smallest dispensable amount (${increment} ${dispensingUnit})` };

  const deliveredDose = deliveredUnit && input.strengthValue ? r4(amount * input.strengthValue) : base.toLowerCase() === dispensingUnit.toLowerCase() ? amount : null;
  const deliveredPerKg = perKg && deliveredDose !== null && input.weightKg ? r4(deliveredDose / input.weightKg) : null;
  const roundingPercent = r4(((amount - rawAmount) / rawAmount) * 100);
  if (deliveredDose !== null) steps.push(`Delivers ${deliveredDose} ${deliveredUnit ?? dispensingUnit}${deliveredPerKg !== null ? ` (${deliveredPerKg} ${deliveredUnit ?? base}/kg)` : ''}`);

  return {
    ok: true,
    rawAmount: r4(rawAmount),
    amount,
    dispensingUnit,
    deliveredDose,
    deliveredUnit: deliveredUnit ?? (deliveredDose !== null ? dispensingUnit : null),
    deliveredPerKg,
    roundingPercent,
    steps,
  };
}

/** Converts a delivered per-kg dose into the reference's unit for range checking. */
export function compareToRange(perKgValue: number, perKgUnit: string, refMin: number, refMax: number, refUnit: string): 'BELOW' | 'WITHIN' | 'ABOVE' | 'INCOMPATIBLE' {
  const a = perKgUnit.replace(/\/kg$/i, '');
  const b = refUnit.replace(/\/kg$/i, '');
  const v = convert(perKgValue, a, b);
  if (v === null) return 'INCOMPATIBLE';
  const eps = 1e-9;
  if (v < refMin - eps) return 'BELOW';
  if (v > refMax + eps) return 'ABOVE';
  return 'WITHIN';
}

/** Total quantity to supply for a course, rounded up to whole increments. */
export function courseQuantity(amountPerDose: number, perDay: number, days: number, increment: number) {
  const raw = amountPerDose * perDay * days;
  return r4(Math.ceil(raw / increment - 1e-9) * increment);
}

export const FREQUENCIES: { code: string; label: string; perDay: number | null }[] = [
  { code: 'SID', label: 'Once daily (SID)', perDay: 1 },
  { code: 'BID', label: 'Twice daily (BID)', perDay: 2 },
  { code: 'TID', label: 'Three times daily (TID)', perDay: 3 },
  { code: 'QID', label: 'Four times daily (QID)', perDay: 4 },
  { code: 'EOD', label: 'Every other day (EOD)', perDay: 0.5 },
  { code: 'WEEKLY', label: 'Once weekly', perDay: 1 / 7 },
  { code: 'ONCE', label: 'Single dose', perDay: null },
  { code: 'PRN', label: 'As needed (PRN)', perDay: null },
];
