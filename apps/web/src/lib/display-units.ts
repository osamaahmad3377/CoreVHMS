import { DEFAULT_UNITS, type Units } from '@vcms/shared';

/**
 * The signed-in clinic's weight and temperature units, set by the session on every load, so plain formatting
 * functions (fmtWeight, fmtTemp) follow Settings → Clinic details without a hook. kg / °C until a session sets them.
 */
let current: Units = DEFAULT_UNITS;
export function setDisplayUnits(u: Units | null | undefined) {
  current = u ?? DEFAULT_UNITS;
}
export const displayUnits = () => current;
