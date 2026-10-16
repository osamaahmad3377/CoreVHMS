import { formatMoney, fromMinor, taxIncluded, taxOn, toMinor } from './money';

describe('money', () => {
  it('parses decimal strings to minor units without float error', () => {
    expect(toMinor('0.1')).toBe(10);
    expect(toMinor('0.29')).toBe(29);
    expect(toMinor('1,234.56')).toBe(123456);
    expect(toMinor('-12.5')).toBe(-1250);
    expect(toMinor(19.99)).toBe(1999);
  });

  it('rounds half up when extra decimals are supplied', () => {
    expect(toMinor('1.005')).toBe(101);
    expect(toMinor('1.004')).toBe(100);
  });

  it('rejects malformed amounts', () => {
    expect(() => toMinor('abc')).toThrow();
    expect(() => toMinor('1.2.3')).toThrow();
  });

  it('formats minor units back to strings', () => {
    expect(fromMinor(123456)).toBe('1234.56');
    expect(fromMinor(-5)).toBe('-0.05');
    expect(formatMoney(150000, 'AUD')).toContain('1,500.00');
  });

  it('computes exclusive and inclusive tax', () => {
    expect(taxOn(10000, 1000)).toBe(1000); // 10% GST on 100.00
    expect(taxOn(999, 1700)).toBe(170); // 17% on 9.99 = 1.6983 -> 1.70
    expect(taxIncluded(11000, 1000)).toBe(1000); // GST-inclusive 110.00 contains 10.00
  });
});

import { calcLine, sumLines } from './money';

describe('invoice line maths', () => {
  it('adds tax on top for tax-exclusive pricing', () => {
    expect(calcLine({ quantity: 3, unitPriceMinor: 1999, taxRateBasisPoints: 1700 }, false)).toEqual({ netMinor: 5997, taxMinor: 1019, grossMinor: 7016 });
  });

  it('extracts tax from tax-inclusive prices (Australian GST style)', () => {
    expect(calcLine({ quantity: 1, unitPriceMinor: 11000, taxRateBasisPoints: 1000 }, true)).toEqual({ netMinor: 10000, taxMinor: 1000, grossMinor: 11000 });
  });

  it('applies discounts before tax and validates them', () => {
    expect(calcLine({ quantity: 2, unitPriceMinor: 5000, discountMinor: 1000, taxRateBasisPoints: 1000 }, false)).toEqual({ netMinor: 9000, taxMinor: 900, grossMinor: 9900 });
    expect(() => calcLine({ quantity: 1, unitPriceMinor: 100, discountMinor: 200, taxRateBasisPoints: 0 }, false)).toThrow();
    expect(() => calcLine({ quantity: 0, unitPriceMinor: 100, taxRateBasisPoints: 0 }, false)).toThrow();
  });

  it('handles fractional quantities and zero-rated lines', () => {
    expect(calcLine({ quantity: 2.5, unitPriceMinor: 333, taxRateBasisPoints: 0 }, false)).toEqual({ netMinor: 833, taxMinor: 0, grossMinor: 833 });
  });

  it('totals lines without float drift', () => {
    const lines = Array.from({ length: 10 }, () => calcLine({ quantity: 1, unitPriceMinor: 10, taxRateBasisPoints: 1000 }, false));
    expect(sumLines(lines)).toEqual({ subtotalMinor: 100, taxMinor: 10, totalMinor: 110, discountMinor: 0 });
  });
});
