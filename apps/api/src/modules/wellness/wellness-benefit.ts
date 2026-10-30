/**
 * What a wellness plan takes off one charge. Included items are covered in full while any are left; whatever is
 * not covered gets the member discount. Amounts are minor units, before tax (tax is worked out on what is left).
 *
 * `remaining` is how many of the item the member still has included (null = the item is not in the plan).
 * Quantities can be fractional (e.g. 2.5 mL); each started unit uses up one included item.
 */
export function computeBenefit(o: { quantity: number; unitPriceMinor: number; remaining: number | null; discountBp: number }) {
  const extended = Math.round(o.quantity * o.unitPriceMinor);
  if (extended <= 0 || o.quantity <= 0) return { coveredQuantity: 0, usedUnits: 0, includedMinor: 0, memberMinor: 0, discountMinor: 0 };
  const left = Math.max(0, o.remaining ?? 0);
  const coveredQuantity = Math.min(left, o.quantity);
  const includedMinor = coveredQuantity >= o.quantity ? extended : Math.round(coveredQuantity * o.unitPriceMinor);
  const usedUnits = Math.max(0, Math.min(left, Math.ceil(coveredQuantity - 1e-9)));
  const bp = Math.min(Math.max(o.discountBp, 0), 10_000);
  const memberMinor = Math.round(((extended - includedMinor) * bp) / 10_000);
  return { coveredQuantity, usedUnits, includedMinor, memberMinor, discountMinor: Math.min(extended, includedMinor + memberMinor) };
}

/** "Included in Gold plan (2 of 3 used)", "Gold plan member discount 10%", or both. */
export function benefitNote(planName: string, b: ReturnType<typeof computeBenefit>, used: number, included: number, discountBp: number) {
  const pct = `${(discountBp / 100).toLocaleString('en', { maximumFractionDigits: 2 })}%`;
  if (b.includedMinor > 0 && b.memberMinor > 0) return `${planName}: ${b.usedUnits} included (${used} of ${included} used), ${pct} member discount on the rest`;
  if (b.includedMinor > 0) return `Included in ${planName} (${used} of ${included} used)`;
  return `${planName} member discount ${pct}`;
}
