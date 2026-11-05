'use client';
import {
  formatTemperature,
  formatWeight,
  temperatureIn,
  temperatureSymbol,
  temperatureToC,
  weightIn,
  weightToKg,
  type Units,
} from '@vcms/shared';
import { displayUnits } from './display-units';
import { useOptionalSession } from './session';

/**
 * The clinic's weight and temperature units (Settings → Clinic details). Values are stored as kg and °C; these
 * helpers show them, and turn what is typed in, in the clinic's units.
 */

export interface UnitHelpers {
  units: Units;
  /** "kg" / "lb". */
  w: string;
  /** "°C" / "°F". */
  t: string;
  /** A stored kg value as the number to show or put in an input (null when empty). */
  fromKg: (kg: number | string | null | undefined) => number | null;
  /** What was typed (clinic unit) as kg to send. */
  toKg: (v: number | string | null | undefined) => number | null;
  fromC: (c: number | string | null | undefined) => number | null;
  toC: (v: number | string | null | undefined) => number | null;
  weight: (kg: number | string | null | undefined) => string;
  temp: (c: number | string | null | undefined) => string;
}

export function unitHelpers(units: Units): UnitHelpers {
  return {
    units,
    w: units.weight,
    t: temperatureSymbol(units.temperature),
    fromKg: (kg) => weightIn(kg, units.weight),
    toKg: (v) => weightToKg(v, units.weight),
    fromC: (c) => temperatureIn(c, units.temperature),
    toC: (v) => temperatureToC(v, units.temperature),
    weight: (kg) => formatWeight(kg, units.weight),
    temp: (c) => formatTemperature(c, units.temperature),
  };
}

/** The clinic's units in a component (kg / °C outside the staff app, e.g. the client portal without a session). */
export function useUnits(): UnitHelpers {
  const s = useOptionalSession();
  return unitHelpers(s?.session.organization?.units ?? displayUnits());
}

/** Farm records weighed in kg (feed given, average batch weight): shown and typed in the clinic's weight unit. */
export const WEIGHED_PRODUCTION = new Set(['FEED', 'BATCH_WEIGHT']);

/** A farm record's quantity and unit as the clinic shows it: kg records follow the clinic's weight unit. */
export function productionIn(kind: string, quantity: number, unit: string | null | undefined): { quantity: number; unit: string } {
  const u = displayUnits();
  if (WEIGHED_PRODUCTION.has(kind) && (unit ?? 'kg') === 'kg' && u.weight === 'lb') return { quantity: weightIn(quantity, 'lb') ?? quantity, unit: 'lb' };
  return { quantity, unit: unit ?? '' };
}
