/**
 * Stock forecast: from the last eight weeks of use, predicts when each product runs out at each branch, how much
 * to order so it lasts until the next delivery and beyond, and which branch can lend stock to another (instead of
 * buying, or before it expires unused). Pure functions — no database — so every rule is unit-tested.
 */

export interface FcLot {
  batchId: string;
  batchNumber: string;
  quantity: number;
  /** Last day the batch may be used, in days from today (0 = today); null = no expiry. */
  expiryDay: number | null;
}

export interface FcArrival {
  quantity: number;
  /** Day the delivery is expected, in days from today. */
  day: number;
}

export interface FcSeries {
  productId: string;
  branchId: string;
  /** Quantity used per week: [last 7 days, 8–14 days ago, …] — up to 8 weeks. */
  weeks: number[];
  /** Weeks with history (a product first used three weeks ago has 3), so new products are not under-estimated. */
  historyWeeks: number;
  lots: FcLot[];
  arrivals: FcArrival[];
  /** Use already known within the horizon (e.g. vaccinations due). */
  scheduled: number;
  reorderLevel: number | null;
  reorderQuantity: number | null;
}

export interface FcOptions {
  /** "Runs out within" window — next week by default. */
  horizonDays: number;
  /** Days until a supplier order normally arrives. */
  leadDays: number;
  /** Order enough to last this many days after it arrives. */
  coverDays: number;
  /** Extra days of stock kept for busy days. */
  safetyDays: number;
  /** Suggest moves between branches first (plan feature); off = supplier orders only. */
  transfers?: boolean;
}

export type FcStatus = 'OUT' | 'RUNS_OUT' | 'ORDER_SOON' | 'BELOW_LEVEL' | 'OK' | 'UNUSED';

export interface FcRow {
  productId: string;
  branchId: string;
  available: number;
  onOrder: number;
  /** Expected use per week. */
  weekly: number;
  /** Oldest → newest, for a small chart. */
  history: number[];
  trend: 'UP' | 'DOWN' | 'STEADY';
  /** Days until it runs out with the stock on the shelf (null = not used). */
  daysLeft: number | null;
  /** Day it runs out counting orders already placed (null = not within the window looked at). */
  runOutDay: number | null;
  status: FcStatus;
  scheduled: number;
  /** Stock that will expire before it is used here. */
  waste: { batchId: string; batchNumber: string; quantity: number; expiryDay: number }[];
  /** Needed to last until the next delivery plus the cover period (before transfers). */
  need: number;
  transferIn: number;
  /** To order from the supplier, after transfers; whole units. */
  order: number;
}

export interface FcTransfer {
  productId: string;
  fromBranchId: string;
  toBranchId: string;
  quantity: number;
  reason: 'SHORTAGE' | 'EXPIRY';
  /** For EXPIRY: the batch to move and its last day. */
  batchId: string | null;
  batchNumber: string | null;
  expiryDay: number | null;
  /** When the receiving branch would otherwise run out. */
  toRunOutDay: number | null;
}

const EPS = 1e-6;
const round2 = (n: number) => Math.round(n * 100) / 100;
/** Recent weeks count more: last week ×8, the week before ×7 … eight weeks ago ×1. */
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 1];

export function weeklyRate(weeks: number[], historyWeeks: number) {
  const n = Math.max(1, Math.min(8, historyWeeks, weeks.length || 1));
  let sum = 0;
  let w = 0;
  for (let i = 0; i < n; i++) {
    sum += (weeks[i] ?? 0) * WEIGHTS[i];
    w += WEIGHTS[i];
  }
  return Math.max(0, sum / w);
}

export function trendOf(weeks: number[], historyWeeks: number): FcRow['trend'] {
  if (historyWeeks < 4) return 'STEADY';
  const half = Math.min(4, Math.floor(historyWeeks / 2));
  const recent = weeks.slice(0, half).reduce((a, b) => a + b, 0) / half;
  const older = weeks.slice(half, half * 2).reduce((a, b) => a + b, 0) / half;
  if (older <= EPS) return recent > EPS ? 'UP' : 'STEADY';
  const change = (recent - older) / older;
  return change > 0.25 ? 'UP' : change < -0.25 ? 'DOWN' : 'STEADY';
}

export interface SimResult {
  /** First day some use cannot be met (null = never within the days simulated). */
  runOutDay: number | null;
  unmet: number;
  /** Usable stock left at the end. */
  end: number;
  waste: FcRow['waste'];
}

/**
 * Day-by-day: deliveries arrive, the day's use is taken from the batch that expires first, and whatever is left
 * of a batch on its last day is wasted.
 */
export function simulate(demand: (day: number) => number, lots: FcLot[], arrivals: FcArrival[], days: number): SimResult {
  const stock = lots.filter((l) => l.quantity > EPS).map((l) => ({ ...l }));
  const pending = arrivals.filter((a) => a.quantity > EPS).map((a) => ({ ...a, day: Math.max(0, Math.round(a.day)) }));
  const waste: SimResult['waste'] = [];
  let runOutDay: number | null = null;
  let unmet = 0;
  for (let d = 0; d < days; d++) {
    for (const a of pending) if (a.day === d) stock.push({ batchId: '', batchNumber: '', quantity: a.quantity, expiryDay: null });
    stock.sort((a, b) => (a.expiryDay ?? Infinity) - (b.expiryDay ?? Infinity));
    let q = demand(d);
    for (const s of stock) {
      if (q <= EPS) break;
      if (s.quantity <= EPS || (s.expiryDay !== null && s.expiryDay < d)) continue;
      const take = Math.min(s.quantity, q);
      s.quantity -= take;
      q -= take;
    }
    if (q > EPS) {
      unmet += q;
      if (runOutDay === null) runOutDay = d;
    }
    for (const s of stock) {
      if (s.expiryDay === d && s.quantity > EPS) {
        if (s.batchId) waste.push({ batchId: s.batchId, batchNumber: s.batchNumber, quantity: round2(s.quantity), expiryDay: d });
        s.quantity = 0;
      }
    }
  }
  const end = stock.reduce((n, s) => n + (s.expiryDay === null || s.expiryDay >= days ? s.quantity : 0), 0);
  return { runOutDay, unmet, end, waste };
}

/** Use per day: the known (scheduled) use is spread over the horizon when it is more than the usual rate. */
function demandFn(daily: number, scheduled: number, horizonDays: number) {
  const early = Math.max(daily, scheduled / Math.max(1, horizonDays));
  return (d: number) => (d < horizonDays ? early : daily);
}

export function forecastRow(s: FcSeries, o: FcOptions): Omit<FcRow, 'transferIn' | 'order'> & { surplus: number } {
  const weekly = weeklyRate(s.weeks, s.historyWeeks);
  const daily = weekly / 7;
  const available = s.lots.reduce((n, l) => n + Math.max(0, l.quantity), 0);
  const onOrder = s.arrivals.reduce((n, a) => n + Math.max(0, a.quantity), 0);
  const demand = demandFn(daily, s.scheduled, o.horizonDays);
  const window = Math.max(o.horizonDays, o.leadDays + o.coverDays);
  const used = daily > EPS || s.scheduled > EPS;

  // How long the shelf stock lasts on its own (up to a year).
  const alone = used ? simulate(demand, s.lots, [], 366) : null;
  // What happens over the ordering window, counting orders already placed.
  const sim = simulate(demand, s.lots, s.arrivals, window);
  const safety = daily * o.safetyDays;
  let need = used ? sim.unmet + Math.max(0, safety - sim.end) : 0;

  let status: FcStatus;
  if (!used) status = 'UNUSED';
  else if (available <= EPS) status = 'OUT';
  else if (sim.runOutDay !== null && sim.runOutDay < o.horizonDays) status = 'RUNS_OUT';
  else if (need > EPS) status = 'ORDER_SOON';
  else status = 'OK';

  // The clinic's reorder level is used for products with no recent use; with use, the forecast decides.
  if (!used && s.reorderLevel !== null && available + onOrder <= s.reorderLevel + EPS) {
    need = Math.max(s.reorderQuantity ?? 0, s.reorderLevel - available - onOrder + 1);
    status = 'BELOW_LEVEL';
  }

  const history = s.weeks.slice(0, Math.max(1, Math.min(8, s.historyWeeks))).map(round2).reverse();
  return {
    productId: s.productId,
    branchId: s.branchId,
    available: round2(available),
    onOrder: round2(onOrder),
    weekly: round2(weekly),
    history,
    trend: trendOf(s.weeks, s.historyWeeks),
    daysLeft: alone ? (alone.runOutDay ?? 366) : null,
    runOutDay: used ? sim.runOutDay : null,
    status,
    scheduled: round2(s.scheduled),
    waste: sim.waste,
    need: round2(need),
    // Stock this branch can spare after its own use over the window and its safety stock.
    surplus: used ? Math.max(0, sim.end - safety) : Math.max(0, sim.end - (s.reorderLevel ?? 0)),
  };
}

/**
 * Forecast for every product at every branch, with transfers between branches first (expiring stock, then
 * spare stock) and supplier orders for the rest. Order quantities are whole units and at least the product's
 * usual reorder quantity.
 */
export function forecast(series: FcSeries[], o: FcOptions): { rows: FcRow[]; transfers: FcTransfer[] } {
  const base = series.map((s) => ({ s, r: forecastRow(s, o) }));
  const transfers: FcTransfer[] = [];
  const byProduct = new Map<string, typeof base>();
  for (const b of base) byProduct.set(b.s.productId, [...(byProduct.get(b.s.productId) ?? []), b]);

  const remaining = new Map<(typeof base)[number], number>(base.map((b) => [b, b.r.need]));
  const transferIn = new Map<(typeof base)[number], number>();
  for (const group of byProduct.values()) {
    if (group.length < 2 || o.transfers === false) continue;
    const takers = group.filter((g) => g.r.need > EPS && g.r.weekly > EPS).sort((a, b) => (a.r.runOutDay ?? 999) - (b.r.runOutDay ?? 999));
    // Expiring stock first: a batch one branch will not finish can be used up by a busier branch.
    const expiring = group.flatMap((g) => g.r.waste.map((w) => ({ g, w: { ...w } })));
    const spare = new Map(group.map((g) => [g, g.r.surplus]));
    for (const t of takers) {
      const daily = t.r.weekly / 7;
      for (const e of expiring.sort((a, b) => a.w.expiryDay - b.w.expiryDay)) {
        if (e.g === t || remaining.get(t)! < 1 - EPS) continue;
        // One day to move it; the receiving branch must use it before it expires.
        const usable = Math.floor(Math.min(e.w.quantity, daily * Math.max(0, e.w.expiryDay - 1), remaining.get(t)! + EPS));
        if (usable < 1) continue;
        e.w.quantity -= usable;
        remaining.set(t, Math.max(0, remaining.get(t)! - usable));
        transferIn.set(t, (transferIn.get(t) ?? 0) + usable);
        transfers.push({ productId: t.s.productId, fromBranchId: e.g.s.branchId, toBranchId: t.s.branchId, quantity: usable, reason: 'EXPIRY', batchId: e.w.batchId, batchNumber: e.w.batchNumber, expiryDay: e.w.expiryDay, toRunOutDay: t.r.runOutDay });
      }
      const donors = group.filter((g) => g !== t && (spare.get(g) ?? 0) >= 1).sort((a, b) => spare.get(b)! - spare.get(a)!);
      for (const d of donors) {
        const qty = Math.floor(Math.min(spare.get(d)!, remaining.get(t)! + EPS));
        if (qty < 1) continue;
        spare.set(d, spare.get(d)! - qty);
        remaining.set(t, Math.max(0, remaining.get(t)! - qty));
        transferIn.set(t, (transferIn.get(t) ?? 0) + qty);
        transfers.push({ productId: t.s.productId, fromBranchId: d.s.branchId, toBranchId: t.s.branchId, quantity: qty, reason: 'SHORTAGE', batchId: null, batchNumber: null, expiryDay: null, toRunOutDay: t.r.runOutDay });
      }
    }
  }

  const rows: FcRow[] = base.map((b) => {
    const left = remaining.get(b)!;
    const order = left > EPS ? Math.max(Math.ceil(left - EPS), Math.ceil(b.s.reorderQuantity ?? 0)) : 0;
    const { surplus: _surplus, ...r } = b.r;
    return { ...r, transferIn: transferIn.get(b) ?? 0, order };
  });
  // Several moves of the same product between the same branches for the same reason become one.
  const merged = new Map<string, FcTransfer>();
  for (const t of transfers) {
    const k = `${t.productId}:${t.fromBranchId}:${t.toBranchId}:${t.reason}:${t.batchId ?? ''}`;
    const m = merged.get(k);
    if (m) m.quantity += t.quantity;
    else merged.set(k, { ...t });
  }
  return { rows, transfers: [...merged.values()] };
}
