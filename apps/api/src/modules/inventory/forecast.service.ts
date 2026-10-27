import { Injectable, OnModuleInit } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { notFound, ruleViolation } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { FcOptions, FcRow, FcSeries, FcTransfer, forecast } from './forecast.engine';
import { InventoryService } from './inventory.service';
import { poNo, ProcurementService } from './procurement.service';
import { assertFeature, featureAllowed } from '../../common/tenancy/entitlements';
import { r4, StockEngine } from './stock.engine';

const DAY = 86_400_000;
const WEEK = 7 * DAY;
const HISTORY_WEEKS = 8;
/** Stock taken by patients and customers. Transfers, counts, write-offs and returns to suppliers are not demand. */
const DEMAND_TYPES = ['DISPENSE', 'ADMINISTER', 'SALE', 'RETURN_FROM_CLIENT'];
const OPEN_PO = ['DRAFT', 'SUBMITTED', 'APPROVED', 'PARTIALLY_RECEIVED'] as const;
const CACHE_MS = 5 * 60_000;

const utcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
const dayIso = (today: number, offset: number | null) => (offset === null ? null : new Date(today + offset * DAY).toISOString().slice(0, 10));

export type ForecastOptions = Omit<FcOptions, 'safetyDays'> & { safetyDays?: number; branchId?: string };

/**
 * Stock forecast: what will run out at each branch, a ready supplier order per supplier and branch, and transfers
 * between branches (spare stock, or stock that would expire unused). Uses the stock ledger of the last eight weeks,
 * the shelf stock by batch and expiry, orders already placed, and vaccinations due.
 */
@Injectable()
export class ForecastService implements OnModuleInit {
  private readonly cache = new Map<string, { at: number; value: Awaited<ReturnType<ForecastService['compute']>> }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly inventory: InventoryService,
    private readonly procurement: ProcurementService,
    private readonly engine: StockEngine,
    private readonly dashboard: DashboardService,
  ) {}

  onModuleInit() {
    // "N products run out this week" on the dashboard.
    this.dashboard.register({
      key: 'stockForecast',
      permission: 'inventory.read',
      load: async (r) => {
        const f = await this.forecast({ horizonDays: 7, leadDays: 3, coverDays: 14, safetyDays: 3 });
        const mine = f.rows.filter((x) => (!r.branchId || x.branch.id === r.branchId) && (x.status === 'OUT' || x.status === 'RUNS_OUT'));
        return {
          runsOutCount: mine.length,
          runsOut: mine.slice(0, 5).map((x) => ({ productId: x.product.id, name: x.product.name, branch: x.branch.name, runOutDate: x.runOutDate, status: x.status })),
          transferCount: f.transfers.filter((t) => !r.branchId || t.to.id === r.branchId || t.from.id === r.branchId).length,
        };
      },
    });
  }

  private invalidate() {
    const org = RequestContext.orgId();
    for (const k of this.cache.keys()) if (k.startsWith(`${org}:`)) this.cache.delete(k);
  }

  async forecast(o: ForecastOptions) {
    const opts: FcOptions = { horizonDays: o.horizonDays, leadDays: o.leadDays, coverDays: o.coverDays, safetyDays: o.safetyDays ?? 3, transfers: featureAllowed('transfers') };
    const key = `${RequestContext.orgId()}:${JSON.stringify(opts)}`;
    const hit = this.cache.get(key);
    const all = hit && Date.now() - hit.at < CACHE_MS ? hit.value : await this.compute(opts);
    if (!hit || hit.value !== all) this.cache.set(key, { at: Date.now(), value: all });
    if (!o.branchId) return all;
    // One branch: its own rows and orders, and transfers to or from it.
    return {
      ...all,
      rows: all.rows.filter((r) => r.branch.id === o.branchId),
      orders: all.orders.filter((x) => x.branch.id === o.branchId),
      transfers: all.transfers.filter((t) => t.to.id === o.branchId || t.from.id === o.branchId),
      summary: summarize(
        all.rows.filter((r) => r.branch.id === o.branchId),
        all.orders.filter((x) => x.branch.id === o.branchId),
        all.transfers.filter((t) => t.to.id === o.branchId || t.from.id === o.branchId),
      ),
    };
  }

  private async compute(opts: FcOptions) {
    const db = this.prisma.db;
    const orgId = RequestContext.orgId();
    const now = new Date();
    const today = utcDay(now);
    const since = new Date(now.getTime() - HISTORY_WEEKS * WEEK);
    const window = Math.max(opts.horizonDays, opts.leadDays + opts.coverDays);

    const [branches, products, usage, firstSeen, levels, poLines, careDue] = await Promise.all([
      db.branch.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      db.product.findMany({
        where: { isActive: true, trackStock: true },
        select: {
          id: true, name: true, sku: true, type: true, dispensingUnit: true, reorderLevel: true, reorderQuantity: true,
          batches: { where: { unitCostMinor: { gt: 0 } }, orderBy: { receivedAt: 'desc' }, take: 1, select: { unitCostMinor: true, supplier: { select: { id: true, name: true, isActive: true } } } },
        },
      }),
      this.prisma.raw.$queryRaw<{ productId: string; branchId: string; week: number; qty: number; uses: number; administered: number }[]>`
        SELECT "productId", "branchId",
               floor(extract(epoch from (${now}::timestamptz - "createdAt")) / 604800)::int AS week,
               coalesce(sum(-quantity), 0)::float8 AS qty,
               count(*) FILTER (WHERE type = 'ADMINISTER')::int AS uses,
               coalesce(sum(-quantity) FILTER (WHERE type = 'ADMINISTER'), 0)::float8 AS administered
        FROM "StockMovement"
        WHERE "organizationId" = ${orgId}::uuid AND "createdAt" >= ${since} AND type::text = ANY(${DEMAND_TYPES})
        GROUP BY 1, 2, 3`,
      this.prisma.raw.$queryRaw<{ productId: string; branchId: string; first: Date }[]>`
        SELECT "productId", "branchId", min("createdAt") AS first
        FROM "StockMovement" WHERE "organizationId" = ${orgId}::uuid
        GROUP BY 1, 2`,
      db.stockLevel.findMany({
        where: { quantity: { gt: 0 }, batch: { status: 'AVAILABLE', OR: [{ expiryDate: null }, { expiryDate: { gte: new Date(today) } }] }, location: { isActive: true } },
        select: { productId: true, quantity: true, location: { select: { branchId: true } }, batch: { select: { id: true, batchNumber: true, expiryDate: true, unitCostMinor: true } } },
      }),
      db.purchaseOrderLine.findMany({
        where: { purchaseOrder: { status: { in: [...OPEN_PO] } } },
        select: { productId: true, quantity: true, quantityReceived: true, purchaseOrder: { select: { branchId: true, expectedAt: true } } },
      }),
      db.careItem.findMany({
        where: {
          status: 'DUE',
          dueDate: { gte: new Date(today - 14 * DAY), lt: new Date(today + opts.horizonDays * DAY) },
          protocol: { productId: { not: null } },
          patient: { status: 'ACTIVE' },
        },
        select: { protocol: { select: { productId: true } }, patient: { select: { primaryBranchId: true } } },
      }),
    ]);

    const k = (p: string, b: string) => `${p}:${b}`;
    const series = new Map<string, FcSeries>();
    const productById = new Map(products.map((p) => [p.id, p]));
    const branchIds = new Set(branches.map((b) => b.id));
    const get = (productId: string, branchId: string) => {
      const p = productById.get(productId);
      if (!p || !branchIds.has(branchId)) return null;
      let s = series.get(k(productId, branchId));
      if (!s) {
        s = { productId, branchId, weeks: Array(HISTORY_WEEKS).fill(0), historyWeeks: 0, lots: [], arrivals: [], scheduled: 0, reorderLevel: p.reorderLevel === null ? null : Number(p.reorderLevel), reorderQuantity: p.reorderQuantity === null ? null : Number(p.reorderQuantity) };
        series.set(k(productId, branchId), s);
      }
      return s;
    };

    // Use per week; dose per administration (for vaccinations due).
    const perUse = new Map<string, { uses: number; qty: number }>();
    const branchUse = new Map<string, Map<string, number>>();
    for (const u of usage) {
      const s = get(u.productId, u.branchId);
      if (!s || u.week < 0 || u.week >= HISTORY_WEEKS) continue;
      s.weeks[u.week] += Math.max(0, Number(u.qty));
      const pu = perUse.get(u.productId) ?? { uses: 0, qty: 0 };
      perUse.set(u.productId, { uses: pu.uses + Number(u.uses), qty: pu.qty + Number(u.administered) });
      const bu = branchUse.get(u.productId) ?? new Map<string, number>();
      bu.set(u.branchId, (bu.get(u.branchId) ?? 0) + Math.max(0, Number(u.qty)));
      branchUse.set(u.productId, bu);
    }
    for (const f of firstSeen) {
      const s = get(f.productId, f.branchId);
      if (s) s.historyWeeks = Math.max(1, Math.min(HISTORY_WEEKS, Math.ceil((now.getTime() - new Date(f.first).getTime()) / WEEK)));
    }
    // Shelf stock by batch (a batch kept in two rooms of a branch is one lot).
    const lotKey = new Map<string, FcSeries['lots'][number]>();
    for (const l of levels) {
      const s = get(l.productId, l.location.branchId);
      if (!s) continue;
      const lk = `${s.productId}:${s.branchId}:${l.batch.id}`;
      const lot = lotKey.get(lk);
      if (lot) lot.quantity += Number(l.quantity);
      else {
        const nl = { batchId: l.batch.id, batchNumber: l.batch.batchNumber, quantity: Number(l.quantity), expiryDay: l.batch.expiryDate ? Math.round((utcDay(l.batch.expiryDate) - today) / DAY) : null };
        lotKey.set(lk, nl);
        s.lots.push(nl);
      }
      s.historyWeeks ||= 1;
    }
    for (const l of poLines) {
      const left = Number(l.quantity) - Number(l.quantityReceived);
      const s = left > 0 ? get(l.productId, l.purchaseOrder.branchId) : null;
      if (!s) continue;
      const at = l.purchaseOrder.expectedAt ? Math.max(0, Math.round((utcDay(l.purchaseOrder.expectedAt) - today) / DAY)) : opts.leadDays;
      s.arrivals.push({ quantity: left, day: at });
    }
    // Vaccinations due: at the animal's home branch, else where the product is used most.
    for (const c of careDue) {
      const productId = c.protocol!.productId!;
      const used = branchUse.get(productId);
      const busiest = used ? [...used.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] : undefined;
      const branchId = c.patient.primaryBranchId && branchIds.has(c.patient.primaryBranchId) ? c.patient.primaryBranchId : busiest ?? branches[0]?.id;
      const s = branchId ? get(productId, branchId) : null;
      if (!s) continue;
      const pu = perUse.get(productId);
      s.scheduled += pu && pu.uses > 0 ? pu.qty / pu.uses : 1;
    }

    const { rows, transfers } = forecast([...series.values()], opts);
    const branchName = new Map(branches.map((b) => [b.id, b.name]));
    const costOf = (p: (typeof products)[number]) => p.batches[0]?.unitCostMinor ?? null;
    const supplierOf = (p: (typeof products)[number]) => {
      const s = p.batches[0]?.supplier;
      return s && s.isActive ? { id: s.id, name: s.name } : null;
    };

    const shaped = rows
      .filter((r) => r.status !== 'UNUSED' || r.available > 0 || r.onOrder > 0)
      .map((r: FcRow) => {
        const p = productById.get(r.productId)!;
        return {
          ...r,
          product: { id: p.id, name: p.name, sku: p.sku, type: p.type, unit: p.dispensingUnit },
          branch: { id: r.branchId, name: branchName.get(r.branchId) ?? '' },
          runOutDate: dayIso(today, r.runOutDay),
          emptyDate: r.daysLeft !== null && r.daysLeft < 366 ? dayIso(today, r.daysLeft) : null,
          waste: r.waste.map((w) => ({ ...w, expiryDate: dayIso(today, w.expiryDay) })),
          lastCostMinor: costOf(p),
          supplier: supplierOf(p),
        };
      })
      .sort((a, b) => rank(a.status) - rank(b.status) || (a.runOutDay ?? 999) - (b.runOutDay ?? 999) || a.product.name.localeCompare(b.product.name));

    // A ready order per supplier and branch; products without a known supplier are grouped for choosing one.
    const orderMap = new Map<string, { supplier: { id: string; name: string } | null; branch: { id: string; name: string }; lines: OrderLine[] }>();
    for (const r of shaped) {
      if (r.order <= 0) continue;
      const okey = `${r.supplier?.id ?? 'none'}:${r.branch.id}`;
      const o = orderMap.get(okey) ?? { supplier: r.supplier, branch: r.branch, lines: [] };
      const expiring = r.waste.length ? { quantity: r.waste.reduce((n, w) => n + w.quantity, 0), date: r.waste[0].expiryDate } : null;
      o.lines.push({ productId: r.product.id, name: r.product.name, unit: r.product.unit, quantity: r.order, unitCostMinor: r.lastCostMinor ?? 0, status: r.status, runOutDate: r.runOutDate, available: r.available, weekly: r.weekly, onOrder: r.onOrder, transferIn: r.transferIn, expiring });
      orderMap.set(okey, o);
    }
    const orders = [...orderMap.values()]
      .map((o) => ({ ...o, totalMinor: o.lines.reduce((n, l) => n + Math.round(l.quantity * l.unitCostMinor), 0) }))
      .sort((a, b) => (a.supplier ? 0 : 1) - (b.supplier ? 0 : 1) || (a.supplier?.name ?? '').localeCompare(b.supplier?.name ?? '') || a.branch.name.localeCompare(b.branch.name));

    const rowAt = new Map(shaped.map((r) => [k(r.product.id, r.branch.id), r]));
    const shapedTransfers = transfers.map((t: FcTransfer) => {
      const p = productById.get(t.productId)!;
      const from = rowAt.get(k(t.productId, t.fromBranchId));
      return {
        ...t,
        product: { id: p.id, name: p.name, unit: p.dispensingUnit },
        from: { id: t.fromBranchId, name: branchName.get(t.fromBranchId) ?? '' },
        to: { id: t.toBranchId, name: branchName.get(t.toBranchId) ?? '' },
        expiryDate: dayIso(today, t.expiryDay),
        toRunOutDate: dayIso(today, t.toRunOutDay),
        fromAvailable: from?.available ?? 0,
        fromWeekly: from?.weekly ?? 0,
        savesMinor: Math.round(t.quantity * (costOf(p) ?? 0)),
      };
    });

    return {
      generatedAt: now.toISOString(),
      options: { ...opts, window },
      branches,
      rows: shaped,
      orders,
      transfers: shapedTransfers,
      summary: summarize(shaped, orders, shapedTransfers),
    };
  }

  /** Draft purchase orders from the forecast, one per supplier and branch, delivered to the branch's main store room. */
  async prepareOrders(input: { orders: { supplierId: string; branchId: string; lines: { productId: string; quantity: number; unitCostMinor: number }[] }[] }) {
    const created: { id: string; poNo: string; supplier: string; branch: string; totalMinor: number }[] = [];
    for (const o of input.orders) {
      const branch = await this.prisma.db.branch.findUnique({ where: { id: o.branchId }, select: { id: true, name: true } });
      if (!branch) throw notFound('Branch');
      const loc = await this.inventory.defaultLocation(this.prisma.db, branch.id);
      if (!loc) throw ruleViolation('NO_STORE_ROOM', `${branch.name} has no store room to deliver to — add one under Stock → Store rooms`);
      const po = await this.procurement.createOrder({
        supplierId: o.supplierId,
        locationId: loc.id,
        expectedAt: null,
        notes: `Prepared from the stock forecast on ${new Date().toISOString().slice(0, 10)}`,
        lines: o.lines,
      });
      created.push({ id: po.id, poNo: poNo(po.number), supplier: po.supplier?.name ?? '', branch: branch.name, totalMinor: po.totalMinor });
    }
    this.invalidate();
    return { created };
  }

  /**
   * Moves a product between branches in one step: from the sending branch's store rooms, first-expiring batch first
   * (or the named batch), into the receiving branch's main store room.
   */
  async transferBetweenBranches(input: { productId: string; fromBranchId: string; toBranchId: string; quantity: number; batchId?: string | null; notes?: string | null }) {
    assertFeature('transfers');
    if (input.fromBranchId === input.toBranchId) throw ruleViolation('SAME_BRANCH', 'Choose two different branches');
    const db = this.prisma.db;
    const [product, from, to] = await Promise.all([
      db.product.findUnique({ where: { id: input.productId }, select: { id: true, name: true, dispensingUnit: true } }),
      db.branch.findUnique({ where: { id: input.fromBranchId }, select: { id: true, name: true } }),
      db.branch.findUnique({ where: { id: input.toBranchId }, select: { id: true, name: true, isActive: true } }),
    ]);
    if (!product) throw notFound('Product');
    if (!from || !to || !to.isActive) throw notFound('Branch');
    const dest = await this.inventory.defaultLocation(db, to.id);
    if (!dest) throw ruleViolation('NO_STORE_ROOM', `${to.name} has no store room — add one under Stock → Store rooms`);
    const today = new Date(utcDay(new Date()));
    const reason = input.notes?.trim() || `Branch transfer: ${from.name} → ${to.name}`;

    const moved = await db.$transaction(async (tx) => {
      const levels = await tx.stockLevel.findMany({
        where: {
          productId: product.id,
          quantity: { gt: 0 },
          location: { branchId: from.id, isActive: true },
          batch: { status: 'AVAILABLE', ...(input.batchId ? { id: input.batchId } : {}), OR: [{ expiryDate: null }, { expiryDate: { gte: today } }] },
        },
        include: { batch: true, location: true },
      });
      levels.sort((a, b) => (a.batch.expiryDate?.getTime() ?? Infinity) - (b.batch.expiryDate?.getTime() ?? Infinity) || Number(b.location.isDefault) - Number(a.location.isDefault));
      const have = levels.reduce((n, l) => n + Number(l.quantity), 0);
      if (have + 1e-9 < input.quantity) throw ruleViolation('INSUFFICIENT_STOCK', `${from.name} has only ${r4(have)} ${product.dispensingUnit} of ${product.name} to send`, { available: r4(have) });
      let left = input.quantity;
      const lines: { batchNumber: string; expiryDate: Date | null; quantity: number }[] = [];
      for (const l of levels) {
        if (left <= 1e-9) break;
        const q = r4(Math.min(Number(l.quantity), left));
        const out = await this.engine.move(tx, { productId: product.id, batchId: l.batchId, locationId: l.locationId, branchId: from.id, delta: -q, type: 'TRANSFER_OUT', unitCostMinor: l.batch.unitCostMinor, reason, referenceType: 'Transfer' });
        await this.engine.move(tx, { productId: product.id, batchId: l.batchId, locationId: dest.id, branchId: to.id, delta: q, type: 'TRANSFER_IN', unitCostMinor: l.batch.unitCostMinor, reason, referenceType: 'Transfer', referenceId: out.id });
        lines.push({ batchNumber: l.batch.batchNumber, expiryDate: l.batch.expiryDate, quantity: q });
        left = r4(left - q);
      }
      await this.audit.record({ action: 'stock.transferred', entityType: 'Product', entityId: product.id, summary: `${product.name} ${input.quantity} ${product.dispensingUnit}: ${from.name} → ${to.name}` }, tx);
      return lines;
    });
    this.invalidate();
    return { product: product.name, from: from.name, to: to.name, quantity: input.quantity, unit: product.dispensingUnit, toLocation: dest.name, batches: moved };
  }
}

interface OrderLine {
  productId: string;
  name: string;
  unit: string;
  quantity: number;
  unitCostMinor: number;
  status: FcRow['status'];
  runOutDate: string | null;
  available: number;
  weekly: number;
  onOrder: number;
  transferIn: number;
  /** Stock on the shelf that expires before it can be used. */
  expiring: { quantity: number; date: string | null } | null;
}

const rank = (s: FcRow['status']) => ({ OUT: 0, RUNS_OUT: 1, ORDER_SOON: 2, BELOW_LEVEL: 3, OK: 4, UNUSED: 5 })[s];

function summarize(rows: { status: FcRow['status']; waste: { quantity: number }[]; lastCostMinor: number | null }[], orders: { lines: unknown[]; totalMinor: number; supplier: unknown }[], transfers: { reason: string }[]) {
  return {
    out: rows.filter((r) => r.status === 'OUT').length,
    runsOut: rows.filter((r) => r.status === 'RUNS_OUT').length,
    orderSoon: rows.filter((r) => r.status === 'ORDER_SOON' || r.status === 'BELOW_LEVEL').length,
    orderLines: orders.reduce((n, o) => n + o.lines.length, 0),
    orderValueMinor: orders.reduce((n, o) => n + o.totalMinor, 0),
    noSupplier: orders.filter((o) => !o.supplier).reduce((n, o) => n + o.lines.length, 0),
    transfers: transfers.length,
    expiryTransfers: transfers.filter((t) => t.reason === 'EXPIRY').length,
    wasteValueMinor: rows.reduce((n, r) => n + r.waste.reduce((m, w) => m + w.quantity * (r.lastCostMinor ?? 0), 0), 0),
  };
}
