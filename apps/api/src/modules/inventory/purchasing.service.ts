import { Injectable } from '@nestjs/common';
import type { PurchaseRequestStatus } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { CounterService, formatNumber } from '../../common/counter/counter.service';
import { notFound, ruleViolation } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { poNo } from './procurement.service';
import { StockEngine, r4 } from './stock.engine';

export const prNo = (n: number) => formatNumber('PR', n);
export const srnNo = (n: number) => formatNumber('SRN', n);

/** Purchase requests (staff ask for items) and supplier returns (stock sent back, reducing what is owed). */
@Injectable()
export class PurchasingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly counters: CounterService,
    private readonly stock: StockEngine,
  ) {}

  // ── Purchase requests ──

  async listRequests(status?: string) {
    const rows = await this.prisma.db.purchaseRequest.findMany({
      where: { status: status ? { in: status.split(',') as PurchaseRequestStatus[] } : undefined },
      include: { product: { select: { id: true, name: true, dispensingUnit: true } }, purchaseOrder: { select: { id: true, number: true, status: true } } },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 300,
    });
    return rows.map((r) => ({ ...r, requestNo: prNo(r.number), quantity: Number(r.quantity), purchaseOrder: r.purchaseOrder ? { ...r.purchaseOrder, poNo: poNo(r.purchaseOrder.number) } : null }));
  }

  async createRequest(input: { productId: string; quantity: number; reason?: string | null; neededBy?: Date | null }) {
    const ctx = RequestContext.require();
    const product = await this.prisma.db.product.findUnique({ where: { id: input.productId } });
    if (!product || !product.isActive) throw ruleViolation('INVALID_PRODUCT', 'Product not found');
    const branchId = ctx.branchId;
    if (!branchId) throw ruleViolation('NO_BRANCH', 'Select a branch first');
    return this.prisma.db.$transaction(async (tx) => {
      const number = await this.counters.next(tx, 'purchase_request');
      const r = await tx.purchaseRequest.create({
        data: {
          organizationId: ctx.organizationId!, branchId, number, productId: product.id, quantity: r4(input.quantity),
          reason: input.reason ?? null, neededBy: input.neededBy ?? null, requestedById: ctx.userId!, requestedByName: ctx.userName ?? 'Unknown',
        },
      });
      await this.audit.record({ action: 'purchase_request.created', entityType: 'PurchaseRequest', entityId: r.id, summary: `${prNo(number)}: ${Number(r.quantity)} × ${product.name}` }, tx);
      return { ...r, requestNo: prNo(number), quantity: Number(r.quantity) };
    });
  }

  /** Reject (procurement) or cancel (the person who asked, or procurement). Only open requests can be closed. */
  async closeRequest(id: string, status: 'REJECTED' | 'CANCELLED', note: string, canManage: boolean) {
    const ctx = RequestContext.require();
    const r = await this.prisma.db.purchaseRequest.findUnique({ where: { id } });
    if (!r) throw notFound('Purchase request');
    if (status === 'CANCELLED' && !canManage && r.requestedById !== ctx.userId) throw ruleViolation('NOT_YOUR_REQUEST', 'Only the person who asked, or procurement staff, can cancel this request');
    if (status === 'REJECTED' && !canManage) throw ruleViolation('NOT_ALLOWED', 'Only procurement staff can reject requests');
    return this.prisma.db.$transaction(async (tx) => {
      // Conditional update: a request already ordered or closed by someone else is not touched.
      const done = await tx.purchaseRequest.updateMany({
        where: { id, status: 'OPEN' },
        data: { status, decidedById: ctx.userId, decidedByName: ctx.userName, decidedAt: new Date(), decisionNote: note },
      });
      if (!done.count) throw ruleViolation('INVALID_TRANSITION', 'Only open requests can be rejected or cancelled');
      await this.audit.record({ action: `purchase_request.${status.toLowerCase()}`, entityType: 'PurchaseRequest', entityId: id, summary: `${prNo(r.number)}: ${note}` }, tx);
      return { id, status };
    });
  }

  /** Creates one draft purchase order from open requests; requests for the same product become one line. */
  async convertToOrder(input: { requestIds: string[]; supplierId: string; locationId: string; expectedAt?: Date | null; notes?: string | null; unitCosts?: { productId: string; unitCostMinor: number }[] }) {
    const ctx = RequestContext.require();
    const ids = [...new Set(input.requestIds)];
    const [supplier, loc, requests] = await Promise.all([
      this.prisma.db.supplier.findUnique({ where: { id: input.supplierId } }),
      this.prisma.db.stockLocation.findUnique({ where: { id: input.locationId } }),
      this.prisma.db.purchaseRequest.findMany({ where: { id: { in: ids } }, include: { product: { select: { name: true } } } }),
    ]);
    if (!supplier || !supplier.isActive) throw ruleViolation('INVALID_SUPPLIER', 'Supplier not found');
    if (!loc) throw ruleViolation('INVALID_LOCATION', 'Delivery location not found');
    if (requests.length !== ids.length) throw notFound('Purchase request');
    if (requests.some((r) => r.status !== 'OPEN')) throw ruleViolation('INVALID_TRANSITION', 'Only open requests can be ordered');

    const byProduct = new Map<string, number>();
    for (const r of requests) byProduct.set(r.productId, r4((byProduct.get(r.productId) ?? 0) + Number(r.quantity)));
    const given = new Map((input.unitCosts ?? []).map((c) => [c.productId, c.unitCostMinor]));
    const lines = await Promise.all(
      [...byProduct].map(async ([productId, quantity]) => {
        const last = given.has(productId) ? null : await this.prisma.db.goodsReceiptLine.findFirst({ where: { productId }, orderBy: { receipt: { receivedAt: 'desc' } }, select: { unitCostMinor: true } });
        return { productId, quantity, unitCostMinor: given.get(productId) ?? last?.unitCostMinor ?? 0 };
      }),
    );

    const poId = await this.prisma.db.$transaction(async (tx) => {
      const number = await this.counters.next(tx, 'purchase_order');
      const po = await tx.purchaseOrder.create({
        data: {
          organizationId: ctx.organizationId!, branchId: loc.branchId, number, supplierId: supplier.id, locationId: loc.id,
          expectedAt: input.expectedAt ?? null, notes: input.notes ?? `From requests ${requests.map((r) => prNo(r.number)).join(', ')}`,
          totalMinor: lines.reduce((n, l) => n + Math.round(l.quantity * l.unitCostMinor), 0),
          createdById: ctx.userId!, createdByName: ctx.userName ?? 'Unknown',
          lines: { create: lines.map((l) => ({ ...l, organizationId: ctx.organizationId! })) },
        },
      });
      // Claim the requests only if they are all still open (two people ordering the same requests at once).
      const claimed = await tx.purchaseRequest.updateMany({
        where: { id: { in: ids }, status: 'OPEN' },
        data: { status: 'ORDERED', purchaseOrderId: po.id, decidedById: ctx.userId, decidedByName: ctx.userName, decidedAt: new Date() },
      });
      if (claimed.count !== ids.length) throw ruleViolation('INVALID_TRANSITION', 'Some of these requests were just ordered or closed by someone else');
      await this.audit.record({ action: 'purchase_order.created', entityType: 'PurchaseOrder', entityId: po.id, summary: `${poNo(number)} from ${ids.length} request(s)` }, tx);
      return po.id;
    });
    return { purchaseOrderId: poId };
  }

  // ── Supplier returns ──

  async listReturns(supplierId?: string) {
    const rows = await this.prisma.db.supplierReturn.findMany({
      where: { supplierId },
      include: { supplier: { select: { id: true, name: true } }, lines: { include: { product: { select: { name: true } }, batch: { select: { batchNumber: true, expiryDate: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => ({ ...r, returnNo: srnNo(r.number), lines: r.lines.map((l) => ({ ...l, quantity: Number(l.quantity) })) }));
  }

  /** Batches received from this supplier that are still on hand at the location (any status, including recalled). */
  async returnable(supplierId: string, locationId: string) {
    const levels = await this.prisma.db.stockLevel.findMany({
      where: { locationId, quantity: { gt: 0 }, batch: { supplierId } },
      include: { batch: { include: { product: { select: { id: true, name: true, dispensingUnit: true } } } } },
      orderBy: [{ batch: { expiryDate: { sort: 'asc', nulls: 'last' } } }],
      take: 500,
    });
    return levels.map((l) => ({
      batchId: l.batchId, batchNumber: l.batch.batchNumber, expiryDate: l.batch.expiryDate, status: l.batch.status,
      product: l.batch.product, onHand: Number(l.quantity), unitCostMinor: l.batch.unitCostMinor,
    }));
  }

  /**
   * Sends stock back to the supplier it came from. Each line takes the batch out of the location at the batch's
   * cost (RETURN_TO_SUPPLIER movement; not cost of goods sold) and the total is credited against the supplier's account.
   * Recalled, quarantined and expired batches can be returned — that is the usual reason.
   */
  async createReturn(input: { supplierId: string; locationId: string; reason: string; reference?: string | null; lines: { batchId: string; quantity: number }[] }) {
    const ctx = RequestContext.require();
    const [supplier, loc] = await Promise.all([
      this.prisma.db.supplier.findUnique({ where: { id: input.supplierId } }),
      this.prisma.db.stockLocation.findUnique({ where: { id: input.locationId } }),
    ]);
    if (!supplier) throw ruleViolation('INVALID_SUPPLIER', 'Supplier not found');
    if (!loc) throw ruleViolation('INVALID_LOCATION', 'Stock location not found');
    const batchIds = [...new Set(input.lines.map((l) => l.batchId))];
    if (batchIds.length !== input.lines.length) throw ruleViolation('DUPLICATE_BATCH', 'List each batch once');
    const batches = await this.prisma.db.stockBatch.findMany({ where: { id: { in: batchIds } }, include: { product: { select: { name: true } } } });
    if (batches.length !== batchIds.length) throw ruleViolation('INVALID_BATCH', 'One or more batches were not found');
    const wrong = batches.find((b) => b.supplierId !== supplier.id);
    if (wrong) throw ruleViolation('SUPPLIER_MISMATCH', `Batch ${wrong.batchNumber} (${wrong.product.name}) was not received from ${supplier.name}`);
    const batchById = new Map(batches.map((b) => [b.id, b]));

    return this.prisma.db.$transaction(async (tx) => {
      const number = await this.counters.next(tx, 'supplier_return');
      const lines = input.lines.map((l) => {
        const b = batchById.get(l.batchId)!;
        const quantity = r4(l.quantity);
        return { batch: b, quantity, unitCostMinor: b.unitCostMinor, totalMinor: Math.round(quantity * b.unitCostMinor) };
      });
      const ret = await tx.supplierReturn.create({
        data: {
          organizationId: ctx.organizationId!, branchId: loc.branchId, number, supplierId: supplier.id, locationId: loc.id,
          reason: input.reason, reference: input.reference ?? null, totalMinor: lines.reduce((n, l) => n + l.totalMinor, 0),
          createdById: ctx.userId!, createdByName: ctx.userName ?? 'Unknown',
          lines: { create: lines.map((l) => ({ organizationId: ctx.organizationId!, productId: l.batch.productId, batchId: l.batch.id, quantity: l.quantity, unitCostMinor: l.unitCostMinor, totalMinor: l.totalMinor })) },
        },
      });
      for (const l of lines) {
        // Row-locked; refuses to take more than is on hand at this location.
        await this.stock.move(tx, {
          productId: l.batch.productId, batchId: l.batch.id, locationId: loc.id, branchId: loc.branchId, delta: -l.quantity,
          type: 'RETURN_TO_SUPPLIER', unitCostMinor: l.unitCostMinor, reason: input.reason, referenceType: 'SupplierReturn', referenceId: ret.id,
        });
      }
      await this.audit.record({ action: 'stock.returned_to_supplier', entityType: 'SupplierReturn', entityId: ret.id, summary: `${srnNo(number)} to ${supplier.name}: ${lines.length} line(s), ${input.reason}` }, tx);
      return ret.id;
    }).then(async (id) => (await this.listReturns(supplier.id)).find((r) => r.id === id)!);
  }
}
