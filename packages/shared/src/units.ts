/**
 * Weight and temperature units. Everything is stored in kilograms and degrees Celsius (doses, normal ranges and
 * calculations rely on that); each clinic chooses how they are shown and typed in (Settings → Clinic details).
 */
export const WEIGHT_UNITS = ['kg', 'lb'] as const;
export type WeightUnit = (typeof WEIGHT_UNITS)[number];
export const TEMPERATURE_UNITS = ['C', 'F'] as const;
export type TemperatureUnit = (typeof TEMPERATURE_UNITS)[number];

export interface Units {
  weight: WeightUnit;
  temperature: TemperatureUnit;
}
export const DEFAULT_UNITS: Units = { weight: 'kg', temperature: 'C' };

/** The clinic's units from its stored settings (anything unknown falls back to kg / °C). */
export function unitsOf(org: { weightUnit?: string | null; temperatureUnit?: string | null } | null | undefined): Units {
  return {
    weight: org?.weightUnit === 'lb' ? 'lb' : 'kg',
    temperature: org?.temperatureUnit === 'F' ? 'F' : 'C',
  };
}

const LB_PER_KG = 2.20462262185;
const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;
const num = (v: number | string | null | undefined) => (v === null || v === undefined || v === '' ? null : Number(v));

export const weightSymbol = (u: WeightUnit) => u;
export const temperatureSymbol = (u: TemperatureUnit) => (u === 'F' ? '°F' : '°C');

/** A stored weight (kg) in the clinic's unit, rounded for showing or editing. */
export function weightIn(kg: number | string | null | undefined, unit: WeightUnit): number | null {
  const v = num(kg);
  if (v === null || !Number.isFinite(v)) return null;
  return unit === 'lb' ? round(v * LB_PER_KG, 2) : round(v, 3);
}

/** A weight typed in the clinic's unit, as kilograms to store. */
export function weightToKg(value: number | string | null | undefined, unit: WeightUnit): number | null {
  const v = num(value);
  if (v === null || !Number.isFinite(v)) return null;
  return round(unit === 'lb' ? v / LB_PER_KG : v, 3);
}

/** A stored temperature (°C) in the clinic's unit, to one decimal place. */
export function temperatureIn(c: number | string | null | undefined, unit: TemperatureUnit): number | null {
  const v = num(c);
  if (v === null || !Number.isFinite(v)) return null;
  return round(unit === 'F' ? (v * 9) / 5 + 32 : v, 1);
}

/** A temperature typed in the clinic's unit, as °C to store (two decimals, so °F readings come back exactly). */
export function temperatureToC(value: number | string | null | undefined, unit: TemperatureUnit): number | null {
  const v = num(value);
  if (v === null || !Number.isFinite(v)) return null;
  return round(unit === 'F' ? ((v - 32) * 5) / 9 : v, 2);
}

/** "18.5 kg", "40.8 lb", "0.45 kg" — fewer decimals for bigger animals. "—" when not recorded. */
export function formatWeight(kg: number | string | null | undefined, unit: WeightUnit): string {
  const v = weightIn(kg, unit);
  if (v === null) return '—';
  const text = v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2).replace(/0$/, '');
  return `${text} ${unit}`;
}

/** "38.6 °C", "101.5 °F". "—" when not recorded. */
export function formatTemperature(c: number | string | null | undefined, unit: TemperatureUnit): string {
  const v = temperatureIn(c, unit);
  return v === null ? '—' : `${v.toFixed(1)} ${temperatureSymbol(unit)}`;
}

/** A plain number in a unit with no symbol ("18.5", "101.5") — for table cells under a header with the unit. */
export const weightNumber = (kg: number | string | null | undefined, unit: WeightUnit) => {
  const v = weightIn(kg, unit);
  return v === null ? null : Number(v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2));
};
export const temperatureNumber = (c: number | string | null | undefined, unit: TemperatureUnit) => temperatureIn(c, unit);
