import { Injectable } from '@nestjs/common';
import { PaymentMethod, Prisma } from '@prisma/client';
import { calcLine, sumLines, type LineInputBody } from '@vcms/shared';
import { AuditService } from '../../common/audit/audit.service';
import { ClientEvents } from '../../common/events/client-events';
import { RequestContext } from '../../common/context/request-context';
import { CounterService, formatNumber } from '../../common/counter/counter.service';
import { conflict, forbidden, notFound, ruleViolation } from '../../common/http/errors';
import { pageArgs, paginated } from '../../common/http/pagination';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { ScopedTx } from '../../common/prisma/tenant-extension';
import { ChargeCaptureService, recomputeClientBalance } from './charge-capture.service';
import { InvoicesService, refreshInvoice } from './invoices.service';

export const receiptNo = (n: number) => formatNumber('RCPT', n);

const paymentInclude = {
  client: { select: { id: true, displayName: true } },
  allocations: { include: { invoice: { select: { id: true, number: true, totalMinor: true, status: true } } } },
  refunds: { orderBy: { refundedAt: 'asc' } },
} satisfies Prisma.PaymentInclude;

function shapePayment(p: Prisma.PaymentGetPayload<{ include: typeof paymentInclude }>) {
  const allocated = p.allocations.reduce((n, a) => n + a.amountMinor, 0);
  return {
    ...p,
    receiptNo: receiptNo(p.number),
    allocatedMinor: allocated,
    unallocatedMinor: p.amountMinor - p.refundedMinor - allocated,
    allocations: p.allocations.map((a) => ({ ...a, invoice: { ...a.invoice, invoiceNo: a.invoice.number ? formatNumber('INV', a.invoice.number) : 'Draft' } })),
    refunds: p.refunds.map((r) => ({ ...r, refundNo: formatNumber('RF', r.number) })),
  };
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly counters: CounterService,
    private readonly events: ClientEvents,
  ) {}

  private async org() {
    return this.prisma.raw.organization.findUniqueOrThrow({ where: { id: RequestContext.orgId() } });
  }

  /** Cash must go through an open register session at the branch (if the organization requires it). */
  private async cashSession(tx: ScopedTx, method: PaymentMethod) {
    if (method !== 'CASH') return null;
    const ctx = RequestContext.require();
    const org = await this.org();
    const session = await tx.cashSession.findFirst({ where: { branchId: ctx.branchId!, status: 'OPEN' }, orderBy: { openedAt: 'desc' } });
    if (!session && org.requireCashSession) throw ruleViolation('NO_CASH_SESSION', 'The cash drawer is closed. Open it before taking or refunding cash');
    return session;
  }

  private async allocateTx(tx: ScopedTx, paymentId: string, clientId: string | null, allocations: { invoiceId: string; amountMinor: number }[], available: number) {
    const total = allocations.reduce((n, a) => n + a.amountMinor, 0);
    if (total > available) throw ruleViolation('OVER_ALLOCATION', `Only ${available} is available to allocate`);
    const ids = new Set<string>();
    for (const a of allocations) {
      if (ids.has(a.invoiceId)) throw ruleViolation('DUPLICATE_ALLOCATION', 'Each invoice may appear once');
      ids.add(a.invoiceId);
      // Lock the invoice row so concurrent payments cannot overpay it.
      const rows = (await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${a.invoiceId}::uuid AND "organizationId" = ${RequestContext.orgId()}::uuid FOR UPDATE`) as { id: string }[];
      if (!rows.length) throw ruleViolation('INVALID_INVOICE', 'Invoice not found');
      const inv = await tx.invoice.findUniqueOrThrow({ where: { id: a.invoiceId } });
      if (!['ISSUED', 'PARTIALLY_PAID'].includes(inv.status)) throw ruleViolation('INVOICE_NOT_PAYABLE', `Invoice is ${inv.status.toLowerCase().replace('_', ' ')}`);
      if (clientId ? inv.clientId !== clientId : inv.clientId !== null) throw ruleViolation('INVOICE_CLIENT', 'Invoice belongs to a different client');
      if (a.amountMinor > inv.balanceMinor) throw ruleViolation('OVERPAYMENT', `Invoice balance is only ${inv.balanceMinor}`);
      await tx.paymentAllocation.create({ data: { organizationId: RequestContext.orgId(), paymentId, invoiceId: a.invoiceId, amountMinor: a.amountMinor } });
      await refreshInvoice(tx, a.invoiceId);
    }
  }

  /** `within` runs in the payment's transaction (e.g. to update an insurance claim atomically with the payment). */
  async take(
    input: { clientId?: string | null; amountMinor: number; method: PaymentMethod; reference?: string | null; notes?: string | null; allocations: { invoiceId: string; amountMinor: number }[]; idempotencyKey?: string },
    within?: (tx: ScopedTx, paymentId: string) => Promise<void>,
  ) {
    const ctx = RequestContext.require();
    if (input.idempotencyKey) {
      const existing = await this.prisma.db.payment.findFirst({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) {
        if (existing.amountMinor !== input.amountMinor || existing.method !== input.method) throw conflict('This idempotency key was already used for a different payment');
        return this.get(existing.id);
      }
    }
    if (input.clientId) {
      const c = await this.prisma.db.client.findUnique({ where: { id: input.clientId } });
      if (!c || c.status === 'MERGED') throw ruleViolation('INVALID_CLIENT', 'Client not found');
    } else if (input.allocations.reduce((n, a) => n + a.amountMinor, 0) !== input.amountMinor) {
      throw ruleViolation('UNALLOCATED_COUNTER_PAYMENT', 'A payment without a client must be fully allocated to counter-sale invoices');
    }
    try {
      const id = await this.prisma.db.$transaction(async (tx) => {
        const session = await this.cashSession(tx, input.method);
        const number = await this.counters.next(tx, 'receipt');
        const p = await tx.payment.create({
          data: {
            organizationId: ctx.organizationId!,
            branchId: ctx.branchId!,
            number,
            clientId: input.clientId ?? null,
            amountMinor: input.amountMinor,
            method: input.method,
            reference: input.reference,
            notes: input.notes,
            idempotencyKey: input.idempotencyKey ?? null,
            cashSessionId: session?.id ?? null,
            receivedById: ctx.userId!,
            receivedByName: ctx.userName ?? 'Unknown',
          },
        });
        await this.allocateTx(tx, p.id, input.clientId ?? null, input.allocations, input.amountMinor);
        await recomputeClientBalance(tx, input.clientId);
        await this.audit.record({ action: 'payment.received', entityType: 'Payment', entityId: p.id, summary: `${receiptNo(number)} ${input.method} ${input.amountMinor}` }, tx);
        if (within) await within(tx, p.id);
        return p.id;
      });
      if (input.clientId) await this.events.emit({ type: 'PAYMENT_RECEIVED', paymentId: id });
      return this.get(id);
    } catch (e) {
      // A concurrent request with the same idempotency key won the race: return its payment.
      if (input.idempotencyKey && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const existing = await this.prisma.db.payment.findFirst({ where: { idempotencyKey: input.idempotencyKey } });
        if (existing) return this.get(existing.id);
      }
      throw e;
    }
  }

  /** Applies a payment's unallocated credit to invoices. */
  async allocate(paymentId: string, allocations: { invoiceId: string; amountMinor: number }[]) {
    const p = await this.prisma.db.payment.findUnique({ where: { id: paymentId }, include: { allocations: true } });
    if (!p) throw notFound('Payment');
    const available = p.amountMinor - p.refundedMinor - p.allocations.reduce((n, a) => n + a.amountMinor, 0);
    await this.prisma.db.$transaction(async (tx) => {
      await this.allocateTx(tx, p.id, p.clientId, allocations, available);
      await recomputeClientBalance(tx, p.clientId);
      await this.audit.record({ action: 'payment.allocated', entityType: 'Payment', entityId: p.id, summary: allocations.map((a) => a.amountMinor).join(', ') }, tx);
    });
    return this.get(paymentId);
  }

  /** Refunds from unallocated credit first, then releases allocations from the most recent invoices. */
  async refund(paymentId: string, input: { amountMinor: number; method: PaymentMethod; reason: string }) {
    const r = await this.prisma.db.$transaction((tx) => this.refundTx(tx, paymentId, input));
    return { refundId: r.id, payment: await this.get(paymentId) };
  }

  /** The refund itself, inside the caller's transaction (also used by counter returns). */
  async refundTx(tx: ScopedTx, paymentId: string, input: { amountMinor: number; method: PaymentMethod; reason: string }) {
    const ctx = RequestContext.require();
    const p = await tx.payment.findUnique({ where: { id: paymentId }, include: { allocations: { orderBy: { createdAt: 'desc' } } } });
    if (!p) throw notFound('Payment');
    const refundable = p.amountMinor - p.refundedMinor;
    if (input.amountMinor > refundable) throw ruleViolation('REFUND_TOO_LARGE', `At most ${refundable} can be refunded from this payment`);
    const session = await this.cashSession(tx, input.method);
    const allocated = p.allocations.reduce((n, a) => n + a.amountMinor, 0);
    let fromAllocations = input.amountMinor - (p.amountMinor - p.refundedMinor - allocated);
    const touched = new Set<string>();
    for (const a of p.allocations) {
      if (fromAllocations <= 0) break;
      const take = Math.min(fromAllocations, a.amountMinor);
      if (take === a.amountMinor) await tx.paymentAllocation.delete({ where: { id: a.id } });
      else await tx.paymentAllocation.update({ where: { id: a.id }, data: { amountMinor: a.amountMinor - take } });
      touched.add(a.invoiceId);
      fromAllocations -= take;
    }
    for (const invId of touched) await refreshInvoice(tx, invId);
    const number = await this.counters.next(tx, 'refund');
    const r = await tx.refund.create({
      data: { organizationId: ctx.organizationId!, number, paymentId, amountMinor: input.amountMinor, method: input.method, reason: input.reason, cashSessionId: session?.id ?? null, refundedById: ctx.userId!, refundedByName: ctx.userName ?? 'Unknown' },
    });
    await tx.payment.update({ where: { id: paymentId }, data: { refundedMinor: { increment: input.amountMinor } } });
    await recomputeClientBalance(tx, p.clientId);
    await this.audit.record({ action: 'payment.refunded', entityType: 'Payment', entityId: paymentId, summary: `${formatNumber('RF', number)} ${input.method} ${input.amountMinor}: ${input.reason}` }, tx);
    return r;
  }

  async get(id: string) {
    const p = await this.prisma.db.payment.findUnique({ where: { id }, include: paymentInclude });
    if (!p) throw notFound('Payment');
    return shapePayment(p);
  }

  async list(q: { page: number; pageSize: number; clientId?: string; from?: Date; to?: Date; method?: PaymentMethod }) {
    const where: Prisma.PaymentWhereInput = { clientId: q.clientId, method: q.method, receivedAt: q.from || q.to ? { gte: q.from, lt: q.to } : undefined };
    const [rows, total] = await Promise.all([
      this.prisma.db.payment.findMany({ where, include: paymentInclude, orderBy: { receivedAt: 'desc' }, ...pageArgs(q) }),
      this.prisma.db.payment.count({ where }),
    ]);
    return paginated(rows.map(shapePayment), total, q);
  }
}

@Injectable()
export class CashService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  listRegisters(branchId?: string) {
    return this.prisma.db.cashRegister.findMany({
      where: { branchId, isActive: true },
      include: { sessions: { where: { status: 'OPEN' }, take: 1 }, branch: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async createRegister(input: { branchId: string; name: string }) {
    if (!(await this.prisma.db.branch.findUnique({ where: { id: input.branchId } }))) throw ruleViolation('INVALID_BRANCH', 'Branch not found');
    return this.prisma.db.$transaction(async (tx) => {
      const r = await tx.cashRegister.create({ data: { ...input, organizationId: RequestContext.orgId() } });
      await this.audit.record({ action: 'cash_register.created', entityType: 'CashRegister', entityId: r.id, summary: r.name }, tx);
      return r;
    });
  }

  async open(registerId: string, openingFloatMinor: number) {
    const ctx = RequestContext.require();
    const reg = await this.prisma.db.cashRegister.findUnique({ where: { id: registerId } });
    if (!reg || !reg.isActive) throw notFound('Cash drawer');
    try {
      return await this.prisma.db.$transaction(async (tx) => {
        const s = await tx.cashSession.create({
          data: { organizationId: ctx.organizationId!, registerId, branchId: reg.branchId, openingFloatMinor, openedById: ctx.userId!, openedByName: ctx.userName ?? 'Unknown' },
        });
        await this.audit.record({ action: 'cash_session.opened', entityType: 'CashSession', entityId: s.id, summary: `${reg.name} float ${openingFloatMinor}` }, tx);
        return s;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw conflict('This cash drawer is already open');
      throw e;
    }
  }

  async expected(sessionId: string) {
    const s = await this.prisma.db.cashSession.findUnique({ where: { id: sessionId } });
    if (!s) throw notFound('Cash session');
    const [payments, refunds, expenses] = await Promise.all([
      this.prisma.db.payment.aggregate({ where: { cashSessionId: sessionId, method: 'CASH' }, _sum: { amountMinor: true } }),
      this.prisma.db.refund.aggregate({ where: { cashSessionId: sessionId, method: 'CASH' }, _sum: { amountMinor: true } }),
      this.prisma.db.expense.aggregate({ where: { cashSessionId: sessionId, method: 'CASH' }, _sum: { amountMinor: true } }),
    ]);
    const cashIn = payments._sum.amountMinor ?? 0;
    const cashOut = (refunds._sum.amountMinor ?? 0) + (expenses._sum.amountMinor ?? 0);
    return { session: s, cashInMinor: cashIn, refundsMinor: refunds._sum.amountMinor ?? 0, paidOutMinor: expenses._sum.amountMinor ?? 0, expectedCashMinor: s.openingFloatMinor + cashIn - cashOut };
  }

  async close(sessionId: string, countedCashMinor: number, notes?: string | null) {
    const ctx = RequestContext.require();
    const { session, expectedCashMinor } = await this.expected(sessionId);
    if (session.status !== 'OPEN') throw ruleViolation('SESSION_CLOSED', 'This cash drawer is already closed');
    if (!ctx.permissions.has('cash.manage') && session.openedById !== ctx.userId) throw forbidden('Only the person who opened this cash drawer, or a manager, can close it');
    const variance = countedCashMinor - expectedCashMinor;
    if (variance !== 0 && !notes) throw ruleViolation('VARIANCE_NOTE', 'Explain the difference before closing');
    return this.prisma.db.$transaction(async (tx) => {
      const s = await tx.cashSession.update({
        where: { id: sessionId },
        data: { status: 'CLOSED', closedAt: new Date(), closedById: ctx.userId, closedByName: ctx.userName, expectedCashMinor, countedCashMinor, varianceMinor: variance, notes },
      });
      await this.audit.record({ action: 'cash_session.closed', entityType: 'CashSession', entityId: sessionId, summary: `expected ${expectedCashMinor}, counted ${countedCashMinor}, variance ${variance}` }, tx);
      return s;
    });
  }

  sessions(registerId?: string) {
    return this.prisma.db.cashSession.findMany({ where: { registerId }, include: { register: { select: { name: true } } }, orderBy: { openedAt: 'desc' }, take: 60 });
  }
}

@Injectable()
export class EstimatesAndExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly counters: CounterService,
    private readonly charges: ChargeCaptureService,
    private readonly invoices: InvoicesService,
    private readonly events: ClientEvents,
  ) {}

  private async price(l: LineInputBody) {
    // Reuse invoice resolution rules via a lightweight copy (estimates allow prescription-only products).
    const db = this.prisma.db;
    if (l.kind === 'SERVICE') {
      const s = await db.service.findUnique({ where: { id: l.serviceId! } });
      if (!s) throw ruleViolation('INVALID_SERVICE', 'Service not found');
      return { ...l, description: l.description ?? s.name, unitPriceMinor: l.unitPriceMinor ?? s.priceMinor, taxRateBasisPoints: l.taxRateBasisPoints ?? (await this.charges.taxFor(db, s.taxRateId)) };
    }
    if (l.kind === 'PRODUCT') {
      const p = await db.product.findUnique({ where: { id: l.productId! } });
      if (!p) throw ruleViolation('INVALID_PRODUCT', 'Product not found');
      return { ...l, description: l.description ?? p.name, unitPriceMinor: l.unitPriceMinor ?? p.sellPriceMinor ?? 0, taxRateBasisPoints: l.taxRateBasisPoints ?? (await this.charges.taxFor(db, p.taxRateId)) };
    }
    if (l.kind === 'LAB') {
      const t = await db.labTest.findUnique({ where: { id: l.labTestId! } });
      if (!t) throw ruleViolation('INVALID_TEST', 'Test not found');
      return { ...l, description: l.description ?? t.name, unitPriceMinor: l.unitPriceMinor ?? t.priceMinor ?? 0, taxRateBasisPoints: l.taxRateBasisPoints ?? (await this.charges.defaultTaxBp(db)) };
    }
    return { ...l, description: l.description!, unitPriceMinor: l.unitPriceMinor!, taxRateBasisPoints: l.taxRateBasisPoints ?? (await this.charges.defaultTaxBp(db)) };
  }

  async createEstimate(input: { clientId: string; patientId?: string | null; validUntil?: Date | null; notes?: string | null; lines: LineInputBody[] }) {
    const ctx = RequestContext.require();
    const org = await this.prisma.raw.organization.findUniqueOrThrow({ where: { id: ctx.organizationId! } });
    if (!(await this.prisma.db.client.findUnique({ where: { id: input.clientId } }))) throw ruleViolation('INVALID_CLIENT', 'Client not found');
    const priced = [];
    for (const l of input.lines) priced.push(await this.price(l));
    const lines = priced.map((l, i) => ({ ...l, sortOrder: i, ...calcLine({ quantity: l.quantity, unitPriceMinor: l.unitPriceMinor, discountMinor: l.discountMinor, taxRateBasisPoints: l.taxRateBasisPoints }, org.pricesIncludeTax) }));
    const t = sumLines(lines);
    return this.prisma.db.$transaction(async (tx) => {
      const number = await this.counters.next(tx, 'estimate');
      const e = await tx.estimate.create({
        data: {
          organizationId: ctx.organizationId!,
          branchId: ctx.branchId!,
          number,
          clientId: input.clientId,
          patientId: input.patientId ?? null,
          validUntil: input.validUntil ?? null,
          notes: input.notes,
          subtotalMinor: t.subtotalMinor,
          taxMinor: t.taxMinor,
          totalMinor: t.totalMinor,
          createdById: ctx.userId!,
          createdByName: ctx.userName ?? 'Unknown',
          lines: { create: lines.map((l) => ({ ...l, organizationId: ctx.organizationId! })) },
        },
        include: { lines: true },
      });
      await this.audit.record({ action: 'estimate.created', entityType: 'Estimate', entityId: e.id, summary: `${formatNumber('EST', number)} ${t.totalMinor}` }, tx);
      return { ...e, estimateNo: formatNumber('EST', number) };
    });
  }

  async listEstimates(clientId?: string) {
    const rows = await this.prisma.db.estimate.findMany({ where: { clientId }, include: { client: { select: { id: true, displayName: true } }, lines: { orderBy: { sortOrder: 'asc' } } }, orderBy: { createdAt: 'desc' }, take: 100 });
    return rows.map((e) => ({ ...e, estimateNo: formatNumber('EST', e.number), lines: e.lines.map((l) => ({ ...l, quantity: Number(l.quantity) })) }));
  }

  async setEstimateStatus(id: string, status: 'SENT' | 'ACCEPTED' | 'DECLINED') {
    const e = await this.prisma.db.estimate.findUnique({ where: { id } });
    if (!e) throw notFound('Estimate');
    if (e.status === 'CONVERTED') throw ruleViolation('CONVERTED', 'This estimate has been converted to an invoice');
    return this.prisma.db.$transaction(async (tx) => {
      const after = await tx.estimate.update({ where: { id }, data: { status } });
      await this.audit.record({ action: `estimate.${status.toLowerCase()}`, entityType: 'Estimate', entityId: id }, tx);
      return after;
    }).then(async (after) => {
      if (status === 'SENT' && e.status !== 'SENT') await this.events.emit({ type: 'ESTIMATE_SENT', estimateId: id });
      return after;
    });
  }

  /** Converts an estimate into a draft invoice (prices are re-checked against the current catalogue). */
  async convert(id: string) {
    const e = await this.prisma.db.estimate.findUnique({ where: { id }, include: { lines: { orderBy: { sortOrder: 'asc' } } } });
    if (!e) throw notFound('Estimate');
    if (e.status === 'CONVERTED') throw ruleViolation('CONVERTED', 'Already converted');
    const invoice = await this.invoices.create({
      clientId: e.clientId,
      patientId: e.patientId,
      chargeIds: [],
      lines: e.lines.map((l) => ({ kind: l.kind, serviceId: l.serviceId, productId: l.productId, labTestId: l.labTestId, description: l.description, quantity: Number(l.quantity), unitPriceMinor: l.unitPriceMinor, discountMinor: l.discountMinor, taxRateBasisPoints: l.taxRateBasisPoints })),
      notes: `From estimate ${formatNumber('EST', e.number)}`,
      isPos: false,
      issue: false,
    });
    await this.prisma.db.$transaction(async (tx) => {
      await tx.estimate.update({ where: { id }, data: { status: 'CONVERTED', convertedInvoiceId: invoice.id } });
      await this.audit.record({ action: 'estimate.converted', entityType: 'Estimate', entityId: id, summary: invoice.id }, tx);
    });
    return invoice;
  }

  async createExpense(input: { date: Date; category: string; description: string; amountMinor: number; taxMinor: number; supplierId?: string | null; method: PaymentMethod; reference?: string | null }) {
    const ctx = RequestContext.require();
    if (input.supplierId && !(await this.prisma.db.supplier.findUnique({ where: { id: input.supplierId } }))) throw ruleViolation('INVALID_SUPPLIER', 'Supplier not found');
    if (input.category === 'SUPPLIER_PAYMENT' && !input.supplierId) throw ruleViolation('SUPPLIER_REQUIRED', 'Choose the supplier being paid');
    if (input.taxMinor > input.amountMinor) throw ruleViolation('TAX_TOO_LARGE', 'Tax cannot exceed the amount');
    return this.prisma.db.$transaction(async (tx) => {
      let cashSessionId: string | null = null;
      if (input.method === 'CASH') {
        const s = await tx.cashSession.findFirst({ where: { branchId: ctx.branchId!, status: 'OPEN' } });
        const org = await this.prisma.raw.organization.findUniqueOrThrow({ where: { id: ctx.organizationId! } });
        if (!s && org.requireCashSession) throw ruleViolation('NO_CASH_SESSION', 'The cash drawer is closed. Open it to pay out cash');
        cashSessionId = s?.id ?? null;
      }
      const e = await tx.expense.create({ data: { ...input, organizationId: ctx.organizationId!, branchId: ctx.branchId!, cashSessionId, createdById: ctx.userId!, createdByName: ctx.userName ?? 'Unknown' } });
      await this.audit.record({ action: 'expense.recorded', entityType: 'Expense', entityId: e.id, summary: `${input.category} ${input.amountMinor}: ${input.description}` }, tx);
      return e;
    });
  }

  listExpenses(from?: Date, to?: Date) {
    return this.prisma.db.expense.findMany({ where: { date: from || to ? { gte: from, lt: to } : undefined }, include: { supplier: { select: { name: true } } }, orderBy: { date: 'desc' }, take: 500 });
  }
}
