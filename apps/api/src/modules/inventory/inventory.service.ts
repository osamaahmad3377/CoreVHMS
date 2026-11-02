import { Injectable } from '@nestjs/common';
import { LocationType, MovementType, Prisma } from '@prisma/client';
import { PRESCRIBABLE_PRODUCT_TYPES } from '@vcms/shared';
import { AuditService } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { CounterService, formatNumber } from '../../common/counter/counter.service';
import { notFound, ruleViolation } from '../../common/http/errors';
import { pageArgs, paginated } from '../../common/http/pagination';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { ScopedTx } from '../../common/prisma/tenant-extension';
import { StockEngine, r4 } from './stock.engine';

const ADJ_TYPE: Record<string, MovementType> = {
  DAMAGED: 'WRITE_OFF',
  EXPIRED: 'WRITE_OFF',
  LOST: 'WRITE_OFF',
  RECALLED: 'WRITE_OFF',
  FOUND: 'ADJUSTMENT',
  DATA_CORRECTION: 'ADJUSTMENT',
  RETURN_TO_SUPPLIER: 'RETURN_TO_SUPPLIER',
  RETURN_FROM_CLIENT: 'RETURN_FROM_CLIENT',
  OTHER: 'ADJUSTMENT',
};

export const grnNo = (n: number) => formatNumber('GRN', n);
export const LOCAL_PURCHASE_SUPPLIER = 'Local purchase';
const dec = (d: Prisma.Decimal | null | undefined) => (d === null || d === undefined ? null : Number(d));

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly counters: CounterService,
    private readonly engine: StockEngine,
  ) {}

  private async org() {
    return this.prisma.raw.organization.findUniqueOrThrow({ where: { id: RequestContext.orgId() } });
  }

  // ── Locations ──
  listLocations(branchId?: string, includeInactive = false) {
    return this.prisma.db.stockLocation.findMany({
      where: { branchId, ...(includeInactive ? {} : { isActive: true }) },
      include: { branch: { select: { id: true, name: true } } },
      orderBy: [{ branchId: 'asc' }, { isDefault: 'desc' }, { name: 'asc' }],
    });
  }

  async saveLocation(id: string | null, input: { branchId: string; name: string; type: LocationType; isDefault: boolean; isActive: boolean }) {
    const branch = await this.prisma.db.branch.findUnique({ where: { id: input.branchId } });
    if (!branch) throw ruleViolation('INVALID_BRANCH', 'Branch not found');
    return this.prisma.db.$transaction(async (tx) => {
      if (input.isDefault) await tx.stockLocation.updateMany({ where: { branchId: input.branchId, id: id ? { not: id } : undefined }, data: { isDefault: false } });
      const loc = id
        ? await tx.stockLocation.update({ where: { id }, data: input })
        : await tx.stockLocation.create({ data: { ...input, organizationId: RequestContext.orgId() } });
      await this.audit.record({ action: id ? 'stock_location.updated' : 'stock_location.created', entityType: 'StockLocation', entityId: loc.id, summary: loc.name }, tx);
      return loc;
    });
  }

  /** Location used for automatic issues at a branch (default, else first active pharmacy/store). */
  async defaultLocation(tx: ScopedTx | PrismaService['db'], branchId: string) {
    return (
      (await tx.stockLocation.findFirst({ where: { branchId, isActive: true, isDefault: true } })) ??
      (await tx.stockLocation.findFirst({ where: { branchId, isActive: true }, orderBy: [{ type: 'asc' }, { createdAt: 'asc' }] }))
    );
  }

  /**
   * Automatic stock issue for clinical/sales events. Skipped when the product is not stock-tracked or the
   * branch has no stock locations (inventory not set up yet); otherwise insufficient stock blocks the event
   * unless the organization allows negative stock.
   */
  async issueForEvent(tx: ScopedTx, e: { productId: string; quantity: number; branchId: string; type: MovementType; referenceType: string; referenceId: string; preferredBatchNumber?: string | null }) {
    const product = await tx.product.findUnique({ where: { id: e.productId } });
    if (!product || !product.trackStock || e.quantity <= 0) return [];
    const location = await this.defaultLocation(tx, e.branchId);
    if (!location) return [];
    const org = await this.org();
    return this.engine.issueFefo(tx, { ...e, locationId: location.id, allowNegative: org.allowNegativeStock });
  }

  /** Returns stock to the location it was issued from (e.g. a voided sale), reversing the original movements. */
  async reverseEvent(tx: ScopedTx, referenceType: string, referenceId: string, type: MovementType, reason: string) {
    const original = await tx.stockMovement.findMany({ where: { referenceType, referenceId, quantity: { lt: 0 } } });
    for (const m of original) {
      await this.engine.move(tx, {
        productId: m.productId,
        batchId: m.batchId,
        locationId: m.locationId,
        branchId: m.branchId,
        delta: -Number(m.quantity),
        type,
        unitCostMinor: m.unitCostMinor,
        reason,
        referenceType,
        referenceId,
      });
    }
    return original.length;
  }

  /**
   * Puts part of what an event issued back on the shelf (a customer returns some of what was sold), into the same
   * batches it came from, never more than was issued minus what was already returned. Returns how much went back.
   */
  async returnFromEvent(tx: ScopedTx, referenceType: string, referenceId: string, quantity: number, reason: string) {
    const moves = await tx.stockMovement.findMany({ where: { referenceType, referenceId }, orderBy: { createdAt: 'asc' } });
    const room = new Map<string, { m: (typeof moves)[number]; left: number }>();
    for (const m of moves) {
      const key = `${m.batchId}|${m.locationId}`;
      const entry = room.get(key) ?? { m, left: 0 };
      entry.left += m.quantity.lt(0) ? Math.abs(Number(m.quantity)) : -Number(m.quantity);
      if (m.quantity.lt(0)) entry.m = m;
      room.set(key, entry);
    }
    let todo = Math.round(quantity * 10000) / 10000;
    for (const { m, left } of room.values()) {
      if (todo <= 0) break;
      const take = Math.min(Math.round(left * 10000) / 10000, todo);
      if (take <= 0 || !m.quantity.lt(0)) continue;
      await this.engine.move(tx, { productId: m.productId, batchId: m.batchId, locationId: m.locationId, branchId: m.branchId, delta: take, type: 'RETURN_FROM_CLIENT', unitCostMinor: m.unitCostMinor, reason, referenceType, referenceId });
      todo = Math.round((todo - take) * 10000) / 10000;
    }
    return Math.round((quantity - todo) * 10000) / 10000;
  }

  // ── Receiving ──
  /**
   * Records a delivery. Medicines and vaccines need a batch number (copied from the pack); other products may leave
   * it blank and go into an automatic batch per delivery day ("NOBATCH-yyyymmdd", plus the expiry when one is given).
   * Without a supplier (bought locally / not recorded) the delivery is booked to the clinic's "Local purchase"
   * supplier, created on first use, so supplier accounts and returns keep working.
   */
  async receive(input: {
    supplierId?: string | null;
    locationId: string;
    purchaseOrderId?: string | null;
    supplierInvoiceNo?: string | null;
    notes?: string | null;
    lines: { productId: string; purchaseOrderLineId?: string | null; batchNumber?: string | null; expiryDate?: Date | null; quantity: number; unitCostMinor: number }[];
  }) {
    const ctx = RequestContext.require();
    const location = await this.prisma.db.stockLocation.findUnique({ where: { id: input.locationId } });
    if (!location || !location.isActive) throw ruleViolation('INVALID_LOCATION', 'Store room not found');
    const po = input.purchaseOrderId ? await this.prisma.db.purchaseOrder.findUnique({ where: { id: input.purchaseOrderId }, include: { lines: true } }) : null;
    if (input.purchaseOrderId) {
      if (!po) throw ruleViolation('INVALID_PO', 'Purchase order not found');
      if (!['APPROVED', 'PARTIALLY_RECEIVED'].includes(po.status)) throw ruleViolation('PO_NOT_APPROVED', 'Only approved purchase orders can be received');
      if (input.supplierId && po.supplierId !== input.supplierId) throw ruleViolation('SUPPLIER_MISMATCH', 'Supplier does not match the purchase order');
    }
    const supplierId = input.supplierId ?? po?.supplierId ?? null;
    const given = supplierId ? await this.prisma.db.supplier.findUnique({ where: { id: supplierId } }) : null;
    if (supplierId && !given) throw ruleViolation('INVALID_SUPPLIER', 'Supplier not found');
    const productIds = [...new Set(input.lines.map((l) => l.productId))];
    const products = await this.prisma.db.product.findMany({ where: { id: { in: productIds } } });
    if (products.length !== productIds.length) throw ruleViolation('INVALID_PRODUCT', 'One or more products are invalid');
    const byId = new Map(products.map((p) => [p.id, p]));
    const today = new Date(new Date().toISOString().slice(0, 10));
    const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
    const lines = input.lines.map((l) => {
      const product = byId.get(l.productId)!;
      const batchNumber = l.batchNumber?.trim();
      if (batchNumber) return { ...l, batchNumber };
      if ((PRESCRIBABLE_PRODUCT_TYPES as readonly string[]).includes(product.type)) throw ruleViolation('BATCH_REQUIRED', `Enter a batch number for ${product.name}`);
      return { ...l, batchNumber: `NOBATCH-${ymd(today)}${l.expiryDate ? `-E${ymd(l.expiryDate)}` : ''}` };
    });

    return this.prisma.db.$transaction(async (tx) => {
      const supplier = given ?? (await this.localPurchaseSupplier(tx));
      const number = await this.counters.next(tx, 'goods_receipt');
      let total = 0;
      const receipt = await tx.goodsReceipt.create({
        data: {
          organizationId: ctx.organizationId!,
          branchId: location.branchId,
          number,
          supplierId: supplier.id,
          purchaseOrderId: po?.id ?? null,
          locationId: location.id,
          supplierInvoiceNo: input.supplierInvoiceNo,
          notes: input.notes,
          receivedById: ctx.userId!,
          receivedByName: ctx.userName ?? 'Unknown',
        },
      });
      for (const l of lines) {
        if (l.expiryDate && l.expiryDate < today) throw ruleViolation('EXPIRED_ON_RECEIPT', `Batch ${l.batchNumber} is already expired`);
        if (l.purchaseOrderLineId) {
          const pl = po?.lines.find((x) => x.id === l.purchaseOrderLineId);
          if (!pl || pl.productId !== l.productId) throw ruleViolation('INVALID_PO_LINE', 'Line does not match the purchase order');
          const outstanding = Number(pl.quantity) - Number(pl.quantityReceived);
          if (l.quantity > outstanding + 1e-9) throw ruleViolation('OVER_RECEIPT', `Only ${outstanding} outstanding on the order for this product`);
          await tx.purchaseOrderLine.update({ where: { id: pl.id }, data: { quantityReceived: { increment: l.quantity } } });
        }
        let batch = await tx.stockBatch.findFirst({ where: { productId: l.productId, batchNumber: l.batchNumber } });
        if (batch) {
          if (l.expiryDate && batch.expiryDate && batch.expiryDate.toISOString().slice(0, 10) !== l.expiryDate.toISOString().slice(0, 10)) {
            throw ruleViolation('BATCH_EXPIRY_MISMATCH', `Batch ${l.batchNumber} is already recorded with a different expiry date`);
          }
          // Weighted average cost across everything currently on hand for the batch.
          const onHand = await tx.stockLevel.aggregate({ where: { batchId: batch.id }, _sum: { quantity: true } });
          const qOld = Math.max(0, Number(onHand._sum.quantity ?? 0));
          const avg = qOld + l.quantity > 0 ? Math.round((qOld * batch.unitCostMinor + l.quantity * l.unitCostMinor) / (qOld + l.quantity)) : l.unitCostMinor;
          batch = await tx.stockBatch.update({ where: { id: batch.id }, data: { unitCostMinor: avg, expiryDate: batch.expiryDate ?? l.expiryDate ?? null } });
        } else {
          batch = await tx.stockBatch.create({
            data: { organizationId: ctx.organizationId!, productId: l.productId, batchNumber: l.batchNumber, expiryDate: l.expiryDate ?? null, unitCostMinor: l.unitCostMinor, supplierId: supplier.id },
          });
        }
        await tx.goodsReceiptLine.create({
          data: { organizationId: ctx.organizationId!, goodsReceiptId: receipt.id, productId: l.productId, purchaseOrderLineId: l.purchaseOrderLineId ?? null, batchId: batch.id, quantity: l.quantity, unitCostMinor: l.unitCostMinor },
        });
        await this.engine.move(tx, {
          productId: l.productId,
          batchId: batch.id,
          locationId: location.id,
          branchId: location.branchId,
          delta: l.quantity,
          type: 'RECEIPT',
          unitCostMinor: l.unitCostMinor,
          referenceType: 'GoodsReceipt',
          referenceId: receipt.id,
        });
        total += Math.round(l.quantity * l.unitCostMinor);
      }
      await tx.goodsReceipt.update({ where: { id: receipt.id }, data: { totalMinor: total } });
      if (po) {
        const lines = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: po.id } });
        const complete = lines.every((x) => Number(x.quantityReceived) + 1e-9 >= Number(x.quantity));
        await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: complete ? 'RECEIVED' : 'PARTIALLY_RECEIVED' } });
      }
      await this.audit.record({ action: 'stock.received', entityType: 'GoodsReceipt', entityId: receipt.id, summary: `${grnNo(number)} from ${supplier.name}: ${input.lines.length} line(s)` }, tx);
      return { ...receipt, receiptNo: grnNo(number), totalMinor: total, supplier: { id: supplier.id, name: supplier.name } };
    });
  }

  /** The clinic's catch-all supplier for goods bought locally or without a recorded supplier. */
  private async localPurchaseSupplier(tx: ScopedTx) {
    const existing = await tx.supplier.findFirst({ where: { name: LOCAL_PURCHASE_SUPPLIER } });
    if (existing) return existing;
    const s = await tx.supplier.create({ data: { organizationId: RequestContext.orgId(), name: LOCAL_PURCHASE_SUPPLIER, paymentTermsDays: 0, notes: 'Created automatically for stock bought locally or without a recorded supplier.' } });
    await this.audit.record({ action: 'supplier.created', entityType: 'Supplier', entityId: s.id, summary: `${s.name} (automatic)` }, tx);
    return s;
  }

  // ── Adjustments, transfers, batch status ──
  async adjust(input: { batchId: string; locationId: string; quantity: number; reason: string; notes?: string | null }) {
    const batch = await this.prisma.db.stockBatch.findUnique({ where: { id: input.batchId }, include: { product: true } });
    if (!batch) throw notFound('Batch');
    const location = await this.prisma.db.stockLocation.findUnique({ where: { id: input.locationId } });
    if (!location) throw ruleViolation('INVALID_LOCATION', 'Stock location not found');
    const type = ADJ_TYPE[input.reason] ?? 'ADJUSTMENT';
    if (['WRITE_OFF', 'RETURN_TO_SUPPLIER'].includes(type) && input.quantity > 0) throw ruleViolation('SIGN', 'Write-offs and supplier returns remove stock (use a negative quantity)');
    if (type === 'RETURN_FROM_CLIENT' && input.quantity < 0) throw ruleViolation('SIGN', 'Client returns add stock (use a positive quantity)');
    return this.prisma.db.$transaction(async (tx) => {
      const mv = await this.engine.move(tx, {
        productId: batch.productId,
        batchId: batch.id,
        locationId: location.id,
        branchId: location.branchId,
        delta: input.quantity,
        type,
        unitCostMinor: batch.unitCostMinor,
        reason: [input.reason, input.notes].filter(Boolean).join(': '),
      });
      await this.audit.record(
        { action: 'stock.adjusted', entityType: 'Product', entityId: batch.productId, summary: `${batch.product.name} batch ${batch.batchNumber}: ${input.quantity > 0 ? '+' : ''}${input.quantity} (${input.reason})` },
        tx,
      );
      return mv;
    });
  }

  async transfer(input: { batchId: string; fromLocationId: string; toLocationId: string; quantity: number; notes?: string | null }) {
    if (input.fromLocationId === input.toLocationId) throw ruleViolation('SAME_LOCATION', 'Choose two different locations');
    const batch = await this.prisma.db.stockBatch.findUnique({ where: { id: input.batchId }, include: { product: true } });
    if (!batch) throw notFound('Batch');
    const [from, to] = await Promise.all([
      this.prisma.db.stockLocation.findUnique({ where: { id: input.fromLocationId } }),
      this.prisma.db.stockLocation.findUnique({ where: { id: input.toLocationId } }),
    ]);
    if (!from || !to || !to.isActive) throw ruleViolation('INVALID_LOCATION', 'Stock location not found');
    if (batch.status !== 'AVAILABLE') throw ruleViolation('BATCH_UNAVAILABLE', `Batch is ${batch.status.toLowerCase()}`);
    return this.prisma.db.$transaction(async (tx) => {
      const out = await this.engine.move(tx, { productId: batch.productId, batchId: batch.id, locationId: from.id, branchId: from.branchId, delta: -input.quantity, type: 'TRANSFER_OUT', unitCostMinor: batch.unitCostMinor, reason: input.notes, referenceType: 'Transfer' });
      await this.engine.move(tx, { productId: batch.productId, batchId: batch.id, locationId: to.id, branchId: to.branchId, delta: input.quantity, type: 'TRANSFER_IN', unitCostMinor: batch.unitCostMinor, reason: input.notes, referenceType: 'Transfer', referenceId: out.id });
      await this.audit.record({ action: 'stock.transferred', entityType: 'Product', entityId: batch.productId, summary: `${batch.product.name} ${input.quantity}: ${from.name} → ${to.name}` }, tx);
      return { ok: true };
    });
  }

  async setBatchStatus(batchId: string, status: 'AVAILABLE' | 'QUARANTINED' | 'RECALLED', reason?: string | null) {
    const b = await this.prisma.db.stockBatch.findUnique({ where: { id: batchId }, include: { product: true } });
    if (!b) throw notFound('Batch');
    if (status !== 'AVAILABLE' && !reason) throw ruleViolation('REASON_REQUIRED', 'Give a reason for quarantining or recalling the batch');
    return this.prisma.db.$transaction(async (tx) => {
      const after = await tx.stockBatch.update({ where: { id: batchId }, data: { status, statusReason: reason ?? null } });
      await this.audit.record({ action: `batch.${status.toLowerCase()}`, entityType: 'Product', entityId: b.productId, summary: `${b.product.name} batch ${b.batchNumber}${reason ? `: ${reason}` : ''}` }, tx);
      return after;
    });
  }

  // ── Stock counts ──
  async startCount(locationId: string, notes?: string | null) {
    const ctx = RequestContext.require();
    const loc = await this.prisma.db.stockLocation.findUnique({ where: { id: locationId } });
    if (!loc) throw ruleViolation('INVALID_LOCATION', 'Stock location not found');
    const open = await this.prisma.db.stockCount.findFirst({ where: { locationId, status: 'OPEN' } });
    if (open) throw ruleViolation('COUNT_OPEN', 'A count is already in progress for this location');
    return this.prisma.db.$transaction(async (tx) => {
      const number = await this.counters.next(tx, 'stock_count');
      const levels = await tx.stockLevel.findMany({ where: { locationId, quantity: { not: 0 } } });
      const count = await tx.stockCount.create({
        data: { organizationId: ctx.organizationId!, locationId, number, notes, startedById: ctx.userId!, startedByName: ctx.userName ?? 'Unknown' },
      });
      if (levels.length) {
        await tx.stockCountLine.createMany({
          data: levels.map((l) => ({ organizationId: ctx.organizationId!, countId: count.id, productId: l.productId, batchId: l.batchId, expectedQty: l.quantity })),
        });
      }
      await this.audit.record({ action: 'stock_count.started', entityType: 'StockCount', entityId: count.id, summary: `${loc.name}: ${levels.length} batch line(s)` }, tx);
      return count;
    });
  }

  async getCount(id: string) {
    const c = await this.prisma.db.stockCount.findUnique({
      where: { id },
      include: {
        location: true,
        lines: { include: { product: { select: { id: true, name: true, dispensingUnit: true } }, batch: { select: { batchNumber: true, expiryDate: true, unitCostMinor: true } } }, orderBy: { product: { name: 'asc' } } },
      },
    });
    if (!c) throw notFound('Stock count');
    return { ...c, countNo: formatNumber('SC', c.number), lines: c.lines.map((l) => ({ ...l, expectedQty: Number(l.expectedQty), countedQty: dec(l.countedQty) })) };
  }

  listCounts() {
    return this.prisma.db.stockCount.findMany({ include: { location: { select: { name: true } }, _count: { select: { lines: true } } }, orderBy: { createdAt: 'desc' }, take: 100 });
  }

  async recordCount(id: string, lines: { lineId: string; countedQty: number }[]) {
    const c = await this.prisma.db.stockCount.findUnique({ where: { id }, include: { lines: true } });
    if (!c) throw notFound('Stock count');
    if (c.status !== 'OPEN') throw ruleViolation('COUNT_CLOSED', 'This count is closed');
    await this.prisma.db.$transaction(async (tx) => {
      for (const l of lines) {
        if (!c.lines.some((x) => x.id === l.lineId)) throw ruleViolation('INVALID_LINE', 'Line does not belong to this count');
        await tx.stockCountLine.update({ where: { id: l.lineId }, data: { countedQty: l.countedQty } });
      }
    });
    return this.getCount(id);
  }

  /** Posts COUNT movements for every variance. Variance is measured against the live balance at completion. */
  async completeCount(id: string) {
    const ctx = RequestContext.require();
    const c = await this.prisma.db.stockCount.findUnique({ where: { id }, include: { lines: { include: { batch: true } }, location: true } });
    if (!c) throw notFound('Stock count');
    if (c.status !== 'OPEN') throw ruleViolation('COUNT_CLOSED', 'This count is closed');
    const missing = c.lines.filter((l) => l.countedQty === null);
    if (missing.length) throw ruleViolation('COUNT_INCOMPLETE', `${missing.length} line(s) have not been counted`);
    let adjusted = 0;
    await this.prisma.db.$transaction(async (tx) => {
      for (const l of c.lines) {
        const level = await this.engine.lockLevel(tx, l.productId, l.batchId, c.locationId);
        const delta = r4(Number(l.countedQty) - level.quantity);
        if (delta !== 0) {
          await this.engine.move(tx, { productId: l.productId, batchId: l.batchId, locationId: c.locationId, branchId: c.location.branchId, delta, type: 'COUNT', unitCostMinor: l.batch.unitCostMinor, reason: `Stock count ${formatNumber('SC', c.number)}`, referenceType: 'StockCount', referenceId: c.id, allowNegative: true });
          adjusted++;
        }
      }
      await tx.stockCount.update({ where: { id }, data: { status: 'COMPLETED', completedAt: new Date(), completedById: ctx.userId, completedByName: ctx.userName } });
      await this.audit.record({ action: 'stock_count.completed', entityType: 'StockCount', entityId: id, summary: `${adjusted} variance(s) posted` }, tx);
    });
    return { ...(await this.getCount(id)), adjusted };
  }

  // ── Queries ──
  async overview(q: { page: number; pageSize: number; q?: string; locationId?: string; lowStock?: boolean; expiringDays?: number }) {
    const where: Prisma.ProductWhereInput = {
      trackStock: true,
      isActive: true,
      ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { sku: { contains: q.q, mode: 'insensitive' } }, { barcode: q.q }] } : {}),
    };
    const products = await this.prisma.db.product.findMany({
      where,
      include: {
        stockLevels: { where: q.locationId ? { locationId: q.locationId } : {}, include: { batch: true, location: { select: { id: true, name: true } } } },
        poLines: { where: { purchaseOrder: { status: { in: ['DRAFT', 'SUBMITTED', 'APPROVED', 'PARTIALLY_RECEIVED'] } } }, select: { purchaseOrder: { select: { id: true, number: true, status: true } } } },
      },
      orderBy: { name: 'asc' },
    });
    const today = new Date(new Date().toISOString().slice(0, 10));
    // Flag stock expiring within 60 days (or the requested window); filter only when a window is requested.
    const horizon = new Date(today.getTime() + (q.expiringDays ?? 60) * 86400_000);
    let rows = products.map((p) => {
      const levels = p.stockLevels.filter((l) => Number(l.quantity) !== 0);
      const usable = levels.filter((l) => l.batch.status === 'AVAILABLE' && (!l.batch.expiryDate || l.batch.expiryDate >= today));
      const onHand = r4(levels.reduce((n, l) => n + Number(l.quantity), 0));
      const available = r4(usable.reduce((n, l) => n + Number(l.quantity), 0));
      const value = Math.round(levels.reduce((n, l) => n + Math.max(0, Number(l.quantity)) * l.batch.unitCostMinor, 0));
      const expiries = usable.map((l) => l.batch.expiryDate).filter(Boolean) as Date[];
      const nextExpiry = expiries.sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
      return {
        id: p.id,
        name: p.name,
        sku: p.sku,
        type: p.type,
        dispensingUnit: p.dispensingUnit,
        isControlled: p.isControlled,
        reorderLevel: dec(p.reorderLevel),
        reorderQuantity: dec(p.reorderQuantity),
        onHand,
        available,
        unusable: r4(onHand - available),
        valueMinor: value,
        nextExpiry,
        low: p.reorderLevel !== null && available <= Number(p.reorderLevel),
        expiringSoon: !!(nextExpiry && nextExpiry <= horizon),
        /** Purchase orders not yet fully received that include this product ("Already on order"). */
        openOrders: [...new Map(p.poLines.map((l) => [l.purchaseOrder.id, { id: l.purchaseOrder.id, poNo: formatNumber('PO', l.purchaseOrder.number), status: l.purchaseOrder.status }])).values()],
        locations: Object.values(
          levels.reduce<Record<string, { id: string; name: string; quantity: number }>>((acc, l) => {
            acc[l.locationId] ??= { id: l.location.id, name: l.location.name, quantity: 0 };
            acc[l.locationId].quantity = r4(acc[l.locationId].quantity + Number(l.quantity));
            return acc;
          }, {}),
        ),
      };
    });
    if (q.lowStock) rows = rows.filter((r) => r.low);
    if (q.expiringDays !== undefined) rows = rows.filter((r) => r.expiringSoon);
    const total = rows.length;
    const { skip, take } = pageArgs(q);
    return { ...paginated(rows.slice(skip, skip + take), total, q), totals: { valueMinor: rows.reduce((n, r) => n + r.valueMinor, 0) } };
  }

  async productStock(productId: string) {
    const p = await this.prisma.db.product.findUnique({ where: { id: productId } });
    if (!p) throw notFound('Product');
    const batches = await this.prisma.db.stockBatch.findMany({
      where: { productId },
      include: { levels: { include: { location: { select: { id: true, name: true } } } }, supplier: { select: { name: true } } },
      orderBy: [{ expiryDate: { sort: 'asc', nulls: 'last' } }, { receivedAt: 'asc' }],
    });
    return {
      product: { id: p.id, name: p.name, sku: p.sku, type: p.type, dispensingUnit: p.dispensingUnit, trackStock: p.trackStock, isControlled: p.isControlled, sellPriceMinor: p.sellPriceMinor, taxRateId: p.taxRateId, reorderLevel: dec(p.reorderLevel), reorderQuantity: dec(p.reorderQuantity) },
      batches: batches.map((b) => ({ ...b, levels: b.levels.map((l) => ({ ...l, quantity: Number(l.quantity) })), onHand: r4(b.levels.reduce((n, l) => n + Number(l.quantity), 0)) })),
    };
  }

  async ledger(q: { page: number; pageSize: number; productId?: string; locationId?: string; type?: MovementType; from?: Date; to?: Date }) {
    const where: Prisma.StockMovementWhereInput = {
      productId: q.productId,
      locationId: q.locationId,
      type: q.type,
      createdAt: q.from || q.to ? { gte: q.from, lt: q.to } : undefined,
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.stockMovement.findMany({
        where,
        include: { product: { select: { name: true, dispensingUnit: true } }, batch: { select: { batchNumber: true } }, location: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        ...pageArgs(q),
      }),
      this.prisma.db.stockMovement.count({ where }),
    ]);
    const refs = await this.describeReferences(rows);
    return paginated(rows.map((m) => ({ ...m, quantity: Number(m.quantity), balanceAfter: Number(m.balanceAfter), reference: m.referenceId ? refs.get(m.referenceId) ?? null : null })), total, q);
  }

  /** "Counter sale INV-000012", "Delivery GRN-000003" … with a link, so a movement can be traced to what caused it. */
  private async describeReferences(rows: { referenceType: string | null; referenceId: string | null }[]) {
    const ids = (t: string) => [...new Set(rows.filter((r) => r.referenceType === t && r.referenceId).map((r) => r.referenceId!))];
    const db = this.prisma.db;
    const [lines, receipts, counts, returns, dispensed, disposals] = await Promise.all([
      ids('InvoiceLine').length ? db.invoiceLine.findMany({ where: { id: { in: ids('InvoiceLine') } }, select: { id: true, invoice: { select: { id: true, number: true, isPos: true, client: { select: { displayName: true } } } } } }) : [],
      ids('GoodsReceipt').length ? db.goodsReceipt.findMany({ where: { id: { in: ids('GoodsReceipt') } }, select: { id: true, number: true, purchaseOrderId: true } }) : [],
      ids('StockCount').length ? db.stockCount.findMany({ where: { id: { in: ids('StockCount') } }, select: { id: true, number: true } }) : [],
      ids('SupplierReturn').length ? db.supplierReturn.findMany({ where: { id: { in: ids('SupplierReturn') } }, select: { id: true, number: true } }) : [],
      ids('Dispensation').length ? db.dispensation.findMany({ where: { id: { in: ids('Dispensation') } }, select: { id: true, prescriptionItemId: true } }) : [],
      ids('StockDisposal').length ? db.stockDisposal.findMany({ where: { id: { in: ids('StockDisposal') } }, select: { id: true, number: true } }) : [],
    ]);
    const out = new Map<string, { label: string; href: string | null }>();
    for (const l of lines) {
      const no = l.invoice.number ? formatNumber('INV', l.invoice.number) : 'draft invoice';
      out.set(l.id, { label: l.invoice.isPos && !l.invoice.client ? `Counter sale ${no}` : `Sold on ${no}${l.invoice.client ? ` · ${l.invoice.client.displayName}` : ''}`, href: `/billing/invoices/${l.invoice.id}` });
    }
    for (const g of receipts) out.set(g.id, { label: `Delivery ${grnNo(g.number)}`, href: g.purchaseOrderId ? `/inventory/purchase-orders/${g.purchaseOrderId}` : null });
    for (const c of counts) out.set(c.id, { label: `Stock count ${formatNumber('SC', c.number)}`, href: `/inventory/counts/${c.id}` });
    for (const r of returns) out.set(r.id, { label: `Supplier return ${formatNumber('SRN', r.number)}`, href: '/inventory/returns' });
    for (const d of disposals) out.set(d.id, { label: `Disposal ${formatNumber('DSP', d.number)}`, href: `/inventory/disposals/${d.id}` });
    const items = dispensed.length ? await db.prescriptionItem.findMany({ where: { id: { in: dispensed.map((d) => d.prescriptionItemId) } }, select: { id: true, prescription: { select: { id: true, number: true } } } }) : [];
    const rxOf = new Map(items.map((i) => [i.id, i.prescription]));
    for (const d of dispensed) {
      const rx = rxOf.get(d.prescriptionItemId);
      if (rx) out.set(d.id, { label: `Dispensed on ${formatNumber('RX', rx.number)}`, href: `/pharmacy/prescriptions/${rx.id}` });
    }
    return out;
  }

  /** Controlled-medicine register: every movement of controlled products with running balance per batch/location. */
  async controlledRegister(from: Date, to: Date) {
    const rows = await this.prisma.db.stockMovement.findMany({
      where: { product: { isControlled: true }, createdAt: { gte: from, lt: to } },
      include: { product: { select: { name: true, dispensingUnit: true, controlledSchedule: true } }, batch: { select: { batchNumber: true } }, location: { select: { name: true } } },
      orderBy: [{ productId: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((m) => ({ ...m, quantity: Number(m.quantity), balanceAfter: Number(m.balanceAfter) }));
  }

  async updateStockSettings(productId: string, input: { trackStock?: boolean; reorderLevel?: number | null; reorderQuantity?: number | null; taxRateId?: string | null }) {
    const p = await this.prisma.db.product.findUnique({ where: { id: productId } });
    if (!p) throw notFound('Product');
    if (input.taxRateId && !(await this.prisma.db.taxRate.findUnique({ where: { id: input.taxRateId } }))) throw ruleViolation('INVALID_TAX_RATE', 'Tax rate not found');
    return this.prisma.db.$transaction(async (tx) => {
      const after = await tx.product.update({ where: { id: productId }, data: input });
      await this.audit.record({ action: 'product.stock_settings', entityType: 'Product', entityId: productId, summary: p.name }, tx);
      return after;
    });
  }
}
