/**
 * Money is always stored as integer minor units (cents / paisa).
 * Never use floating-point amounts for persistence or arithmetic.
 */
export const CURRENCY_DECIMALS: Record<string, number> = { PKR: 2, AUD: 2, USD: 2, GBP: 2, EUR: 2, NZD: 2 };

export function decimalsFor(currency: string): number {
  return CURRENCY_DECIMALS[currency] ?? 2;
}

/** Parse a user-entered decimal string (e.g. "12.50") into minor units without float error. */
export function toMinor(value: string | number, currency = 'PKR'): number {
  const decimals = decimalsFor(currency);
  const str = typeof value === 'number' ? value.toFixed(decimals) : value.trim().replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(str)) throw new Error(`Invalid amount: ${value}`);
  const negative = str.startsWith('-');
  const [whole, frac = ''] = str.replace('-', '').split('.');
  if (frac.length > decimals) {
    // round half up on the extra digits
    const kept = frac.slice(0, decimals);
    const next = Number(frac[decimals]);
    let minor = Number(whole) * 10 ** decimals + Number(kept.padEnd(decimals, '0'));
    if (next >= 5) minor += 1;
    return negative ? -minor : minor;
  }
  const minor = Number(whole) * 10 ** decimals + Number(frac.padEnd(decimals, '0') || '0');
  return negative ? -minor : minor;
}

export function fromMinor(minor: number, currency = 'PKR'): string {
  const decimals = decimalsFor(currency);
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 10 ** decimals);
  const frac = String(abs % 10 ** decimals).padStart(decimals, '0');
  return `${negative ? '-' : ''}${whole}${decimals ? '.' + frac : ''}`;
}

export function formatMoney(minor: number, currency = 'PKR', locale?: string): string {
  const decimals = decimalsFor(currency);
  const loc = locale ?? (currency === 'AUD' ? 'en-AU' : currency === 'PKR' ? 'en-PK' : 'en');
  return new Intl.NumberFormat(loc, {
    style: 'currency',
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(minor / 10 ** decimals);
}

/**
 * Tax on an amount in minor units. `rateBasisPoints` is the rate × 100 (e.g. 10% = 1000, 17% = 1700).
 * Rounds half away from zero to the nearest minor unit.
 */
export function taxOn(amountMinor: number, rateBasisPoints: number): number {
  const raw = (amountMinor * rateBasisPoints) / 10000;
  return Math.sign(raw) * Math.round(Math.abs(raw));
}

/** Extract the tax component from a tax-inclusive amount. */
export function taxIncluded(grossMinor: number, rateBasisPoints: number): number {
  const raw = (grossMinor * rateBasisPoints) / (10000 + rateBasisPoints);
  return Math.sign(raw) * Math.round(Math.abs(raw));
}

export interface LineInput {
  quantity: number;
  unitPriceMinor: number;
  discountMinor?: number;
  taxRateBasisPoints: number;
}

export interface LineAmounts {
  netMinor: number;
  taxMinor: number;
  grossMinor: number;
}

/**
 * Line amounts in integer minor units, rounded per line (half away from zero).
 * With tax-inclusive pricing the unit price already contains tax and tax is extracted;
 * otherwise tax is added on top of the discounted net amount.
 */
export function calcLine(line: LineInput, pricesIncludeTax: boolean): LineAmounts {
  if (line.quantity <= 0) throw new Error('Quantity must be positive');
  if (line.unitPriceMinor < 0) throw new Error('Price cannot be negative');
  const extended = Math.round(line.quantity * line.unitPriceMinor);
  const discount = line.discountMinor ?? 0;
  if (discount < 0 || discount > extended) throw new Error('Discount must be between zero and the line amount');
  const base = extended - discount;
  if (pricesIncludeTax) {
    const tax = taxIncluded(base, line.taxRateBasisPoints);
    return { netMinor: base - tax, taxMinor: tax, grossMinor: base };
  }
  const tax = taxOn(base, line.taxRateBasisPoints);
  return { netMinor: base, taxMinor: tax, grossMinor: base + tax };
}

export function sumLines(lines: (LineAmounts & { discountMinor?: number })[]) {
  return lines.reduce(
    (t, l) => ({
      subtotalMinor: t.subtotalMinor + l.netMinor,
      taxMinor: t.taxMinor + l.taxMinor,
      totalMinor: t.totalMinor + l.grossMinor,
      discountMinor: t.discountMinor + (l.discountMinor ?? 0),
    }),
    { subtotalMinor: 0, taxMinor: 0, totalMinor: 0, discountMinor: 0 },
  );
}
