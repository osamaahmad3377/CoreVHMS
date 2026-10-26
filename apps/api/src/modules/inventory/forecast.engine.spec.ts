import { FcSeries, forecast, forecastRow, simulate, trendOf, weeklyRate } from './forecast.engine';

const opts = { horizonDays: 7, leadDays: 3, coverDays: 14, safetyDays: 3 };
const series = (p: Partial<FcSeries>): FcSeries => ({
  productId: 'p1',
  branchId: 'b1',
  weeks: [7, 7, 7, 7, 7, 7, 7, 7],
  historyWeeks: 8,
  lots: [],
  arrivals: [],
  scheduled: 0,
  reorderLevel: null,
  reorderQuantity: null,
  ...p,
});
const lot = (quantity: number, expiryDay: number | null = null, batchId = 'x') => ({ batchId, batchNumber: batchId.toUpperCase(), quantity, expiryDay });

describe('weekly use', () => {
  it('weights recent weeks more', () => {
    expect(weeklyRate([14, 0, 0, 0, 0, 0, 0, 0], 8)).toBeCloseTo((14 * 8) / 36);
    expect(weeklyRate([0, 0, 0, 0, 0, 0, 0, 14], 8)).toBeCloseTo(14 / 36);
  });
  it('only averages the weeks a new product has existed', () => {
    expect(weeklyRate([10, 10, 0, 0, 0, 0, 0, 0], 2)).toBeCloseTo(10);
  });
  it('spots a rising or falling trend', () => {
    expect(trendOf([20, 20, 20, 20, 10, 10, 10, 10], 8)).toBe('UP');
    expect(trendOf([5, 5, 5, 5, 10, 10, 10, 10], 8)).toBe('DOWN');
    expect(trendOf([10, 10, 10, 10, 10, 10, 10, 10], 8)).toBe('STEADY');
  });
});

describe('simulate', () => {
  it('uses the batch that expires first and counts what expires unused', () => {
    const r = simulate(() => 1, [lot(10, null, 'late'), lot(5, 2, 'soon')], [], 5);
    // Days 0-2 use the short-dated batch (3 of 5); 2 are wasted on day 2; days 3-4 use the other batch.
    expect(r.waste).toEqual([{ batchId: 'soon', batchNumber: 'SOON', quantity: 2, expiryDay: 2 }]);
    expect(r.end).toBe(8);
    expect(r.runOutDay).toBeNull();
  });
  it('finds the day stock runs out and counts deliveries', () => {
    expect(simulate(() => 2, [lot(5)], [], 10).runOutDay).toBe(2);
    expect(simulate(() => 2, [lot(5)], [{ quantity: 20, day: 2 }], 10).runOutDay).toBeNull();
  });
});

describe('forecast for one branch', () => {
  it('flags a product that runs out next week and orders enough for the cover period', () => {
    const r = forecastRow(series({ lots: [lot(3)] }), opts); // 1 a day, 3 left
    expect(r.status).toBe('RUNS_OUT');
    expect(r.daysLeft).toBe(3);
    // 17 days (3 lead + 14 cover) of use + 3 days safety − 3 in stock = 17
    expect(r.need).toBeCloseTo(17);
  });
  it('counts stock already on order', () => {
    const r = forecastRow(series({ lots: [lot(3)], arrivals: [{ quantity: 30, day: 2 }] }), opts);
    expect(r.status).toBe('OK');
    expect(r.need).toBe(0);
  });
  it('is OUT when nothing is left', () => {
    expect(forecastRow(series({ lots: [] }), opts).status).toBe('OUT');
  });
  it('plans for known use such as vaccinations due', () => {
    const r = forecastRow(series({ weeks: [0, 0, 0, 0, 0, 0, 0, 0], scheduled: 10, lots: [lot(4)] }), opts);
    expect(r.status).toBe('RUNS_OUT');
  });
  it('keeps the clinic’s reorder level for products not used lately', () => {
    const r = forecastRow(series({ weeks: [0, 0, 0, 0, 0, 0, 0, 0], lots: [lot(2)], reorderLevel: 5, reorderQuantity: 20 }), opts);
    expect(r.status).toBe('BELOW_LEVEL');
    expect(r.need).toBe(20);
  });
});

describe('forecast across branches', () => {
  it('moves spare stock to a branch that runs out, and orders only the rest', () => {
    const lahore = series({ branchId: 'lhr', lots: [lot(2)] }); // runs out
    const isb = series({ branchId: 'isb', weeks: [1, 1, 1, 1, 1, 1, 1, 1], lots: [lot(40)] }); // plenty
    const { rows, transfers } = forecast([lahore, isb], opts);
    const lhr = rows.find((r) => r.branchId === 'lhr')!;
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({ fromBranchId: 'isb', toBranchId: 'lhr', reason: 'SHORTAGE' });
    // Lahore needs 17 days of use + 3 days safety − 2 on the shelf = 18; Islamabad can spare that much.
    expect(transfers[0].quantity).toBe(18);
    expect(lhr.transferIn).toBe(18);
    expect(lhr.order).toBe(0);
    expect(rows.find((r) => r.branchId === 'isb')!.order).toBe(0);
  });
  it('moves only what the other branch can spare and orders the rest', () => {
    const lahore = series({ branchId: 'lhr', lots: [lot(2)] }); // needs 18
    const isb = series({ branchId: 'isb', weeks: [1, 1, 1, 1, 1, 1, 1, 1], lots: [lot(10)] }); // keeps ~3, spares 6
    const { rows, transfers } = forecast([lahore, isb], opts);
    const spare = Math.floor(10 - (17 / 7 + 3 / 7));
    expect(transfers[0].quantity).toBe(spare);
    expect(rows.find((r) => r.branchId === 'lhr')!.order).toBe(18 - spare);
  });
  it('sends stock that would expire unused to a busier branch', () => {
    const quiet = series({ branchId: 'q', weeks: [0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7], lots: [lot(10, 10, 'b1')] });
    const busy = series({ branchId: 'b', weeks: [14, 14, 14, 14, 14, 14, 14, 14], lots: [lot(4)] });
    const { transfers } = forecast([quiet, busy], opts);
    const t = transfers.find((x) => x.reason === 'EXPIRY')!;
    expect(t).toMatchObject({ fromBranchId: 'q', toBranchId: 'b', batchId: 'b1', expiryDay: 10 });
    expect(t.quantity).toBeGreaterThan(0);
  });
  it('rounds orders up to whole units and to the usual reorder quantity', () => {
    const { rows } = forecast([series({ lots: [lot(3)], reorderQuantity: 50 })], opts);
    expect(rows[0].order).toBe(50);
  });
});
