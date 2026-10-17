import { Injectable } from '@nestjs/common';
import { AuditService, diff } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { CounterService, formatNumber } from '../../common/counter/counter.service';
import { forbidden, notFound, ruleViolation } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';

export const poNo = (n: number) => formatNumber('PO', n);

@Injectable()
export class ProcurementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly counters: CounterService,
  ) {}

  listSuppliers(includeInactive = false) {
    return this.prisma.db.supplier.findMany({ where: includeInactive ? {} : { isActive: true }, orderBy: { name: 'asc' } });
  }

  async saveSupplier(id: string | null, input: Record<string, any>) {
    return this.prisma.db.$transaction(async (tx) => {
      if (id) {
        const before = await tx.supplier.findUnique({ where: { id } });
        if (!before) throw notFound('Supplier');
        const after = await tx.supplier.update({ where: { id }, data: input });
        await this.audit.record({ action: 'supplier.updated', entityType: 'Supplier', entityId: id, changes: diff(before, after, Object.keys(input)) }, tx);
        return after;
      }
      const s = await tx.supplier.create({ data: { ...(input as any), organizationId: RequestContext.orgId() } });
      await this.audit.record({ action: 'supplier.created', entityType: 'Supplier', entityId: s.id, summary: s.name }, tx);
      return s;
    });
  }

  /** Supplier account: received goods, less payments recorded as SUPPLIER_PAYMENT expenses and goods returned. */
  async supplierBalance(id: string) {
    const s = await this.prisma.db.supplier.findUnique({ where: { id } });
    if (!s) throw notFound('Supplier');
    const [received, paid, returned, receipts, returns] = await Promise.all([
      this.prisma.db.goodsReceipt.aggregate({ where: { supplierId: id }, _sum: { totalMinor: true } }),
      this.prisma.db.expense.aggregate({ where: { supplierId: id, category: 'SUPPLIER_PAYMENT' }, _sum: { amountMinor: true } }),
      this.prisma.db.supplierReturn.aggregate({ where: { supplierId: id }, _sum: { totalMinor: true } }),
      this.prisma.db.goodsReceipt.findMany({ where: { supplierId: id }, orderBy: { receivedAt: 'desc' }, take: 50 }),
      this.prisma.db.supplierReturn.findMany({ where: { supplierId: id }, orderBy: { createdAt: 'desc' }, take: 50 }),
    ]);
    const receivedMinor = received._sum.totalMinor ?? 0;
    const paidMinor = paid._sum.amountMinor ?? 0;
    const returnedMinor = returned._sum.totalMinor ?? 0;
    return {
      supplier: s, receivedMinor, paidMinor, returnedMinor, balanceMinor: receivedMinor - paidMinor - returnedMinor,
      receipts: receipts.map((r) => ({ ...r, receiptNo: formatNumber('GRN', r.number) })),
      returns: returns.map((r) => ({ ...r, returnNo: formatNumber('SRN', r.number) })),
    };
  }

  async listOrders(status?: string) {
    const rows = await this.prisma.db.purchaseOrder.findMany({
      where: { status: status ? { in: status.split(',') as any } : undefined },
      include: { supplier: { select: { id: true, name: true } }, lines: { include: { product: { select: { name: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((p) => ({ ...p, poNo: poNo(p.number), lines: p.lines.map((l) => ({ ...l, quantity: Number(l.quantity), quantityReceived: Number(l.quantityReceived) })) }));
  }

  async getOrder(id: string) {
    const p = await this.prisma.db.purchaseOrder.findUnique({
      where: { id },
      include: {
        supplier: true,
        lines: { include: { product: { select: { id: true, name: true, dispensingUnit: true, sku: true } } } },
        receipts: { include: { lines: { include: { batch: { select: { batchNumber: true, expiryDate: true } }, product: { select: { name: true } } } } }, orderBy: { receivedAt: 'asc' } },
      },
    });
    if (!p) throw notFound('Purchase order');
    const location = await this.prisma.db.stockLocation.findUnique({
      where: { id: p.locationId },
      select: { id: true, name: true, branch: { select: { name: true, addressLine1: true, addressLine2: true, city: true, phone: true } } },
    });
    return {
      ...p,
      location,
      poNo: poNo(p.number),
      lines: p.lines.map((l) => ({ ...l, quantity: Number(l.quantity), quantityReceived: Number(l.quantityReceived), outstanding: Number(l.quantity) - Number(l.quantityReceived) })),
      receipts: p.receipts.map((r) => ({ ...r, receiptNo: formatNumber('GRN', r.number), lines: r.lines.map((l) => ({ ...l, quantity: Number(l.quantity) })) })),
    };
  }

  private async validate(input: { supplierId: string; locationId: string; lines: { productId: string }[] }) {
    if (!(await this.prisma.db.supplier.findUnique({ where: { id: input.supplierId } }))) throw ruleViolation('INVALID_SUPPLIER', 'Supplier not found');
    const loc = await this.prisma.db.stockLocation.findUnique({ where: { id: input.locationId } });
    if (!loc) throw ruleViolation('INVALID_LOCATION', 'Delivery location not found');
    const ids = [...new Set(input.lines.map((l) => l.productId))];
    if ((await this.prisma.db.product.count({ where: { id: { in: ids } } })) !== ids.length) throw ruleViolation('INVALID_PRODUCT', 'One or more products are invalid');
    return loc;
  }

  async createOrder(input: { supplierId: string; locationId: string; expectedAt?: Date | null; notes?: string | null; lines: { productId: string; quantity: number; unitCostMinor: number }[] }) {
    const ctx = RequestContext.require();
    const loc = await this.validate(input);
    return this.prisma.db.$transaction(async (tx) => {
      const number = await this.counters.next(tx, 'purchase_order');
      const total = input.lines.reduce((n, l) => n + Math.round(l.quantity * l.unitCostMinor), 0);
      const po = await tx.purchaseOrder.create({
        data: {
          organizationId: ctx.organizationId!,
          branchId: loc.branchId,
          number,
          supplierId: input.supplierId,
          locationId: input.locationId,
          expectedAt: input.expectedAt ?? null,
          notes: input.notes,
          totalMinor: total,
          createdById: ctx.userId!,
          createdByName: ctx.userName ?? 'Unknown',
          lines: { create: input.lines.map((l) => ({ ...l, organizationId: ctx.organizationId! })) },
        },
      });
      await this.audit.record({ action: 'purchase_order.created', entityType: 'PurchaseOrder', entityId: po.id, summary: poNo(number) }, tx);
      return po.id;
    }).then((poId) => this.getOrder(poId));
  }

  async submit(id: string) {
    const po = await this.prisma.db.purchaseOrder.findUnique({ where: { id } });
    if (!po) throw notFound('Purchase order');
    if (po.status !== 'DRAFT') throw ruleViolation('INVALID_TRANSITION', 'Only drafts can be submitted for approval');
    await this.prisma.db.$transaction(async (tx) => {
      await tx.purchaseOrder.update({ where: { id }, data: { status: 'SUBMITTED', submittedAt: new Date() } });
      await this.audit.record({ action: 'purchase_order.submitted', entityType: 'PurchaseOrder', entityId: id, summary: poNo(po.number) }, tx);
    });
    return this.getOrder(id);
  }

  /** Segregation of duties: the person who raised an order cannot approve it. */
  async approve(id: string) {
    const ctx = RequestContext.require();
    const po = await this.prisma.db.purchaseOrder.findUnique({ where: { id } });
    if (!po) throw notFound('Purchase order');
    if (po.status !== 'SUBMITTED') throw ruleViolation('INVALID_TRANSITION', 'Only submitted orders can be approved');
    if (po.createdById === ctx.userId) throw forbidden('You cannot approve a purchase order you created');
    await this.prisma.db.$transaction(async (tx) => {
      await tx.purchaseOrder.update({ where: { id }, data: { status: 'APPROVED', approvedById: ctx.userId, approvedByName: ctx.userName, approvedAt: new Date() } });
      await this.audit.record({ action: 'purchase_order.approved', entityType: 'PurchaseOrder', entityId: id, summary: poNo(po.number) }, tx);
    });
    return this.getOrder(id);
  }

  async cancel(id: string, reason: string) {
    const po = await this.prisma.db.purchaseOrder.findUnique({ where: { id } });
    if (!po) throw notFound('Purchase order');
    if (['RECEIVED', 'CANCELLED', 'PARTIALLY_RECEIVED'].includes(po.status)) throw ruleViolation('INVALID_TRANSITION', `A ${po.status.toLowerCase().replace('_', ' ')} order cannot be cancelled`);
    await this.prisma.db.$transaction(async (tx) => {
      await tx.purchaseOrder.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason } });
      await this.audit.record({ action: 'purchase_order.cancelled', entityType: 'PurchaseOrder', entityId: id, summary: `${poNo(po.number)}: ${reason}` }, tx);
    });
    return this.getOrder(id);
  }

  /**
   * Suggested reorder list: products at or below their reorder level counting stock already on order, with the
   * last cost paid and who supplied it so an order can be drafted without looking them up.
   */
  async reorderSuggestions() {
    const products = await this.prisma.db.product.findMany({
      where: { isActive: true, trackStock: true, reorderLevel: { not: null } },
      include: {
        stockLevels: { include: { batch: true } },
        poLines: { where: { purchaseOrder: { status: { in: ['DRAFT', 'SUBMITTED', 'APPROVED', 'PARTIALLY_RECEIVED'] } } } },
        batches: { where: { unitCostMinor: { gt: 0 } }, orderBy: { receivedAt: 'desc' }, take: 1, select: { unitCostMinor: true, supplier: { select: { id: true, name: true } } } },
      },
    });
    const today = new Date(new Date().toISOString().slice(0, 10));
    return products
      .map((p) => {
        const available = p.stockLevels.filter((l) => l.batch.status === 'AVAILABLE' && (!l.batch.expiryDate || l.batch.expiryDate >= today)).reduce((n, l) => n + Number(l.quantity), 0);
        const onOrder = p.poLines.reduce((n, l) => n + Number(l.quantity) - Number(l.quantityReceived), 0);
        const last = p.batches[0];
        return {
          productId: p.id, name: p.name, dispensingUnit: p.dispensingUnit, available, onOrder, reorderLevel: Number(p.reorderLevel), suggested: Number(p.reorderQuantity ?? p.reorderLevel),
          lastCostMinor: last?.unitCostMinor ?? null, lastSupplier: last?.supplier ?? null,
        };
      })
      .filter((p) => p.available + p.onOrder <= p.reorderLevel);
  }
}
