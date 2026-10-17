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
const r2 = (n: number) => Math.round(n * 100) / 100;

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
  steps.push(mode === 'nearest' ? `Rounded to the nearest ${increment} ${dispensingUnit}: ${amount} ${dispensingUnit}` : `Rounded ${mode} to a multiple of ${increment} ${dispensingUnit}: ${amount} ${dispensingUnit}`);
  if (amount <= 0) return { ok: false, error: `The calculated amount (${r4(rawAmount)} ${dispensingUnit}) is below the smallest dispensable amount (${increment} ${dispensingUnit})` };

  const deliveredDose = deliveredUnit && input.strengthValue ? r4(amount * input.strengthValue) : base.toLowerCase() === dispensingUnit.toLowerCase() ? amount : null;
  const deliveredPerKg = perKg && deliveredDose !== null && input.weightKg ? r4(deliveredDose / input.weightKg) : null;
  const roundingPercent = r4(((amount - rawAmount) / rawAmount) * 100);
  // The explanation shows the per-kg figure to 2 decimals; the returned value keeps full precision for range checks.
  if (deliveredDose !== null) steps.push(`Delivers ${deliveredDose} ${deliveredUnit ?? dispensingUnit}${deliveredPerKg !== null ? ` (${r2(deliveredPerKg)} ${deliveredUnit ?? base}/kg)` : ''}`);

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

/**
 * Dosing frequencies. `label` is for staff (plain words first, the abbreviation in brackets); `ownerText`
 * is for owner labels, which never carry Latin abbreviations.
 */
export const FREQUENCIES: { code: string; label: string; ownerText: string; perDay: number | null }[] = [
  { code: 'SID', label: 'Once a day (SID)', ownerText: 'once a day', perDay: 1 },
  { code: 'BID', label: '2 times a day (BID)', ownerText: '2 times a day', perDay: 2 },
  { code: 'TID', label: '3 times a day (TID)', ownerText: '3 times a day', perDay: 3 },
  { code: 'QID', label: '4 times a day (QID)', ownerText: '4 times a day', perDay: 4 },
  { code: 'EOD', label: 'Every other day (EOD)', ownerText: 'every other day', perDay: 0.5 },
  { code: 'WEEKLY', label: 'Once a week', ownerText: 'once a week', perDay: 1 / 7 },
  { code: 'ONCE', label: 'Single dose', ownerText: 'once only', perDay: null },
  { code: 'PRN', label: 'Only when needed (PRN)', ownerText: 'only when needed', perDay: null },
];

/** Earlier wording of the frequency labels, so stored prescriptions still resolve to a frequency. */
const OLD_FREQUENCY_LABELS: Record<string, string> = {
  'once daily': 'SID',
  'twice daily': 'BID',
  'three times daily': 'TID',
  'four times daily': 'QID',
  'once weekly': 'WEEKLY',
  'as needed': 'PRN',
};

/** Finds the frequency from a code ("BID") or from stored label text ("Twice daily (BID)", "2 times a day (BID)"). */
export function findFrequency(codeOrText: string | null | undefined) {
  if (!codeOrText) return undefined;
  const t = codeOrText.trim();
  const code = /\(([A-Z]+)\)\s*$/.exec(t)?.[1] ?? t.toUpperCase();
  return (
    FREQUENCIES.find((f) => f.code === code) ??
    FREQUENCIES.find((f) => f.label.toLowerCase() === t.toLowerCase()) ??
    FREQUENCIES.find((f) => f.code === OLD_FREQUENCY_LABELS[t.toLowerCase().replace(/\s*\(.*\)$/, '')])
  );
}

/** How an owner reads the route on a label: "by mouth", "under the skin". Routes without an entry are left out. */
export const ROUTE_OWNER_TEXT: Record<string, string> = {
  PO: 'by mouth',
  SC: 'under the skin',
  IM: 'into the muscle',
  IV: 'into the vein',
  TOPICAL: 'on the skin',
  TRANSDERMAL: 'on the skin',
  OPHTHALMIC: 'in the eye',
  OTIC: 'in the ear',
  INTRANASAL: 'in the nose',
  INTRAMAMMARY: 'into the teat',
  RECTAL: 'into the back passage',
  INHALED: 'by inhaler',
};

const ABBREVIATED_UNIT = /^(mL|L|g|kg|mg|mcg|µg|IU|cm|mm)$/;
const FRACTIONS: Record<string, string> = { '0.25': '¼', '0.5': '½', '0.75': '¾' };

/** "1 tablet", "½ tablet", "1½ tablets", "2.5 mL" — written for an owner. */
export function ownerAmount(amount: number, unit: string) {
  if (ABBREVIATED_UNIT.test(unit)) return `${amount} ${unit}`;
  const whole = Math.floor(amount + 1e-9);
  const frac = FRACTIONS[String(r2(amount - whole))];
  const n = frac ? `${whole || ''}${frac}` : String(amount);
  const plural = amount > 1 && !unit.endsWith('s') ? `${unit}s` : unit;
  return `${n} ${plural}`;
}

/**
 * Owner label sentence: "Give 1 tablet by mouth 2 times a day for 7 days." Built only from what the vet
 * prescribed (amount, route, frequency, duration); it adds no clinical content.
 */
export function ownerInstructions(i: { amount?: number | null; unit?: string | null; route: string; frequencyCode: string; durationDays?: number | null }) {
  const f = findFrequency(i.frequencyCode);
  const parts = ['Give'];
  if (i.amount && i.unit) parts.push(ownerAmount(i.amount, i.unit));
  if (ROUTE_OWNER_TEXT[i.route]) parts.push(ROUTE_OWNER_TEXT[i.route]);
  if (f) parts.push(f.ownerText);
  if (i.durationDays && f?.code !== 'ONCE') parts.push(`for ${i.durationDays} day${i.durationDays === 1 ? '' : 's'}`);
  return `${parts.join(' ')}.`;
}

const ROUTE_ABBREVIATIONS: Record<string, string> = { PO: 'by mouth', SC: 'under the skin', SQ: 'under the skin', IM: 'into the muscle', IV: 'into the vein' };
const OLD_FREQUENCY_WORDS: [RegExp, string][] = [
  [/\bonce daily\b/gi, 'once a day'],
  [/\btwice daily\b/gi, '2 times a day'],
  [/\bthree times daily\b/gi, '3 times a day'],
  [/\bfour times daily\b/gi, '4 times a day'],
  [/\bas needed\b/gi, 'only when needed'],
];

/**
 * Label text as printed for the owner: Latin abbreviations are removed or written out
 * ("Give SC twice daily (BID) for 7 days." → "Give under the skin 2 times a day for 7 days.").
 */
export function ownerLabelText(text: string) {
  let s = text.replace(/\s*\((SID|BID|TID|QID|EOD|PRN|q\d+h)\)/gi, '');
  for (const [re, plain] of OLD_FREQUENCY_WORDS) s = s.replace(re, plain);
  s = s.replace(/\b(SID|BID|TID|QID|EOD|PRN)\b/gi, (m) => findFrequency(m.toUpperCase())?.ownerText ?? m);
  s = s.replace(/\b(PO|SC|SQ|IM|IV)\b/g, (m) => ROUTE_ABBREVIATIONS[m]);
  return s.replace(/\s{2,}/g, ' ').trim();
}
