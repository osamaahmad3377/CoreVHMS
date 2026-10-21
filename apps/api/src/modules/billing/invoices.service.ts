import { localDayBounds } from '../../common/time/tz';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { calcLine, enumLabel, sumLines, type LineInputBody } from '@vcms/shared';
import { AuditService } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { CounterService, formatNumber } from '../../common/counter/counter.service';
import { notFound, ruleViolation } from '../../common/http/errors';
import { pageArgs, paginated } from '../../common/http/pagination';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { ScopedTx } from '../../common/prisma/tenant-extension';
import { InventoryService } from '../inventory/inventory.service';
import { ChargeCaptureService, recomputeClientBalance } from './charge-capture.service';

export const invoiceNo = (n: number | null) => (n ? formatNumber('INV', n) : 'Draft');

const include = {
  client: { select: { id: true, displayName: true, number: true, email: true, mobilePhone: true, addresses: { where: { isPrimary: true }, take: 1 } } },
  lines: { orderBy: { sortOrder: 'asc' }, include: { charge: { select: { id: true, sourceType: true, sourceId: true } } } },
  allocations: { include: { payment: { select: { id: true, number: true, method: true, reference: true, receivedAt: true, receivedByName: true } } }, orderBy: { createdAt: 'asc' } },
  creditNotes: { orderBy: { createdAt: 'asc' } },
  branch: { select: { id: true, name: true, addressLine1: true, addressLine2: true, city: true, postcode: true, phone: true, email: true } },
} satisfies Prisma.InvoiceInclude;

type Row = Prisma.InvoiceGetPayload<{ include: typeof include }>;

export function shapeInvoice(i: Row) {
  return {
    ...i,
    invoiceNo: invoiceNo(i.number),
    lines: i.lines.map((l) => ({ ...l, quantity: Number(l.quantity), returnedQuantity: Number(l.returnedQuantity ?? 0) })),
    allocations: i.allocations.map((a) => ({ ...a, payment: { ...a.payment, receiptNo: formatNumber('RCPT', a.payment.number) } })),
    creditNotes: i.creditNotes.map((c) => ({ ...c, creditNoteNo: formatNumber('CN', c.number) })),
    overdue: !!i.dueAt && i.dueAt < new Date() && i.balanceMinor > 0 && ['ISSUED', 'PARTIALLY_PAID'].includes(i.status),
  };
}

/** Recomputes paid/balance/status from allocations and credit notes. */
export async function refreshInvoice(tx: ScopedTx, invoiceId: string) {
  const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { allocations: true, creditNotes: true } });
  if (inv.status === 'DRAFT' || inv.status === 'VOID') return inv;
  const paid = inv.allocations.reduce((n, a) => n + a.amountMinor, 0);
  const credited = inv.creditNotes.reduce((n, c) => n + c.amountMinor, 0);
  const balance = inv.totalMinor - credited - paid;
  if (balance < 0) throw ruleViolation('OVERPAID', 'Allocation exceeds the invoice balance');
  const status = balance === 0 ? 'PAID' : paid > 0 || credited > 0 ? 'PARTIALLY_PAID' : 'ISSUED';
  return tx.invoice.update({ where: { id: invoiceId }, data: { paidMinor: paid, creditedMinor: credited, balanceMinor: balance, status } });
}

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly counters: CounterService,
    private readonly charges: ChargeCaptureService,
    private readonly inventory: InventoryService,
  ) {}

  private async org() {
    return this.prisma.raw.organization.findUniqueOrThrow({ where: { id: RequestContext.orgId() } });
  }

  async list(q: { page: number; pageSize: number; q?: string; status?: string; clientId?: string; from?: Date; to?: Date; overdue?: boolean }) {
    const statuses = q.status?.split(',').filter(Boolean) as any[] | undefined;
    const where: Prisma.InvoiceWhereInput = {
      status: statuses?.length ? { in: statuses } : undefined,
      clientId: q.clientId,
      OR: q.from || q.to ? [{ issuedAt: { gte: q.from, lt: q.to } }, { issuedAt: null, createdAt: { gte: q.from, lt: q.to } }] : undefined,
      ...(q.overdue ? { status: { in: ['ISSUED', 'PARTIALLY_PAID'] }, dueAt: { lt: new Date() }, balanceMinor: { gt: 0 } } : {}),
      ...(q.q
        ? {
            AND: [
              {
                OR: [
                  { client: { displayName: { contains: q.q, mode: 'insensitive' } } },
                  ...(/^(inv-?)?\d+$/i.test(q.q) ? [{ number: Number(q.q.replace(/\D/g, '')) }] : []),
                ],
              },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.invoice.findMany({ where, include, orderBy: [{ issuedAt: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }], ...pageArgs(q) }),
      this.prisma.db.invoice.count({ where }),
    ]);
    return paginated(rows.map(shapeInvoice), total, q);
  }

  async get(id: string) {
    const i = await this.prisma.db.invoice.findUnique({ where: { id }, include });
    if (!i) throw notFound('Invoice');
    const patient = i.patientId ? await this.prisma.db.patient.findUnique({ where: { id: i.patientId }, select: { id: true, name: true, number: true } }) : null;
    // Item codes for printed receipts: product SKU or service code.
    const productIds = i.lines.map((l) => l.productId).filter((x): x is string => !!x);
    const serviceIds = i.lines.map((l) => l.serviceId).filter((x): x is string => !!x);
    const [products, services] = await Promise.all([
      productIds.length ? this.prisma.db.product.findMany({ where: { id: { in: productIds } }, select: { id: true, sku: true } }) : [],
      serviceIds.length ? this.prisma.db.service.findMany({ where: { id: { in: serviceIds } }, select: { id: true, code: true } }) : [],
    ]);
    const code = new Map<string, string | null>([...products.map((p) => [p.id, p.sku] as const), ...services.map((x) => [x.id, x.code] as const)]);
    const shaped = shapeInvoice(i);
    return { ...shaped, patient, lines: shaped.lines.map((l) => ({ ...l, code: (l.productId && code.get(l.productId)) || (l.serviceId && code.get(l.serviceId)) || null })) };
  }

  /** Resolves a manual line against the catalogue (price, description and tax), allowing explicit overrides. */
  private async resolveLine(l: LineInputBody, isPos = false, rx?: { allowed: boolean; notes: string[] }) {
    const db = this.prisma.db;
    if (l.kind === 'SERVICE') {
      const s = await db.service.findUnique({ where: { id: l.serviceId! } });
      if (!s || !s.isActive) throw ruleViolation('INVALID_SERVICE', 'Service not found');
      return { kind: l.kind, serviceId: s.id, description: l.description ?? s.name, quantity: l.quantity, unitPriceMinor: l.unitPriceMinor ?? s.priceMinor, discountMinor: l.discountMinor, taxRateBasisPoints: l.taxRateBasisPoints ?? (await this.charges.taxFor(db, s.taxRateId)) };
    }
    if (l.kind === 'PRODUCT') {
      const p = await db.product.findUnique({ where: { id: l.productId! } });
      if (!p || !p.isActive) throw ruleViolation('INVALID_PRODUCT', 'Product not found');
      // Prescription-only medicines (and, at the counter, vaccines) need a prescription, unless the clinic allows
      // selling without one (the sale is then marked on the invoice and in the log). Controlled medicines always need a prescription.
      const rxOnly = p.requiresPrescription && (p.type === 'MEDICINE' || (isPos && p.type === 'VACCINE'));
      if (rxOnly) {
        if (p.isControlled) throw ruleViolation('PRESCRIPTION_REQUIRED', `${p.name} is a controlled medicine and always needs a prescription.`);
        if (!rx?.allowed) {
          throw ruleViolation('PRESCRIPTION_REQUIRED', p.type === 'VACCINE' ? `${p.name} must be administered by the clinic, not sold at the counter.` : `${p.name} is prescription-only. Dispense it from an authorised prescription.`);
        }
        // Who approved it is optional; the sale is recorded as made without a prescription either way.
        const note = l.withoutPrescriptionNote?.trim();
        rx.notes.push(note ? `${p.name} — ${note}` : p.name);
      }
      if (l.unitPriceMinor === undefined && p.sellPriceMinor === null) throw ruleViolation('NO_PRICE', `${p.name} has no selling price`);
      return { kind: l.kind, productId: p.id, description: l.description ?? p.name, quantity: l.quantity, unitPriceMinor: l.unitPriceMinor ?? p.sellPriceMinor!, discountMinor: l.discountMinor, taxRateBasisPoints: l.taxRateBasisPoints ?? (await this.charges.taxFor(db, p.taxRateId)) };
    }
    if (l.kind === 'LAB') {
      const t = await db.labTest.findUnique({ where: { id: l.labTestId! } });
      if (!t) throw ruleViolation('INVALID_TEST', 'Test not found');
      return { kind: l.kind, labTestId: t.id, description: l.description ?? t.name, quantity: l.quantity, unitPriceMinor: l.unitPriceMinor ?? t.priceMinor ?? 0, discountMinor: l.discountMinor, taxRateBasisPoints: l.taxRateBasisPoints ?? (await this.charges.defaultTaxBp(db)) };
    }
    return { kind: l.kind, description: l.description!, quantity: l.quantity, unitPriceMinor: l.unitPriceMinor!, discountMinor: l.discountMinor, taxRateBasisPoints: l.taxRateBasisPoints ?? (await this.charges.defaultTaxBp(db)) };
  }

  private async addLines(tx: ScopedTx, invoiceId: string, inclusive: boolean, startOrder: number, lines: Awaited<ReturnType<InvoicesService['resolveLine']>>[], chargeIds: string[], clientId: string | null) {
    const orgId = RequestContext.orgId();
    let order = startOrder;
    if (chargeIds.length) {
      const charges = await tx.charge.findMany({ where: { id: { in: chargeIds } } });
      if (charges.length !== new Set(chargeIds).size) throw ruleViolation('INVALID_CHARGE', 'One or more charges were not found');
      for (const c of charges) {
        if (c.status !== 'PENDING') throw ruleViolation('CHARGE_NOT_PENDING', `“${c.description}” is already ${c.status.toLowerCase()}`);
        if (clientId && c.clientId !== clientId) throw ruleViolation('CHARGE_CLIENT', `“${c.description}” belongs to a different client`);
        const amounts = calcLine({ quantity: Number(c.quantity), unitPriceMinor: c.unitPriceMinor, taxRateBasisPoints: c.taxRateBasisPoints }, inclusive);
        const line = await tx.invoiceLine.create({
          data: {
            organizationId: orgId,
            invoiceId,
            kind: c.kind,
            description: c.description,
            serviceId: c.serviceId,
            productId: c.productId,
            labTestId: c.labTestId,
            quantity: c.quantity,
            unitPriceMinor: c.unitPriceMinor,
            taxRateBasisPoints: c.taxRateBasisPoints,
            sortOrder: order++,
            ...amounts,
          },
        });
        // Conditional update guards against two invoices claiming the same charge concurrently.
        const claimed = await tx.charge.updateMany({ where: { id: c.id, status: 'PENDING' }, data: { status: 'INVOICED', invoiceLineId: line.id } });
        if (claimed.count !== 1) throw ruleViolation('CHARGE_NOT_PENDING', `“${c.description}” was invoiced by someone else`);
      }
    }
    for (const l of lines) {
      let amounts;
      try {
        amounts = calcLine(l, inclusive);
      } catch (e) {
        throw ruleViolation('INVALID_LINE', `${l.description}: ${(e as Error).message}`);
      }
      await tx.invoiceLine.create({ data: { ...l, organizationId: orgId, invoiceId, sortOrder: order++, ...amounts } });
    }
  }

  private async retotal(tx: ScopedTx, invoiceId: string) {
    const lines = await tx.invoiceLine.findMany({ where: { invoiceId } });
    const t = sumLines(lines);
    return tx.invoice.update({ where: { id: invoiceId }, data: { ...t, balanceMinor: t.totalMinor } });
  }

  async create(input: { clientId?: string | null; patientId?: string | null; encounterId?: string | null; chargeIds: string[]; lines: LineInputBody[]; notes?: string | null; isPos: boolean; issue: boolean }) {
    const ctx = RequestContext.require();
    const org = await this.org();
    if (!input.clientId && !input.isPos) throw ruleViolation('CLIENT_REQUIRED', 'Select the client to invoice');
    if (input.clientId) {
      const c = await this.prisma.db.client.findUnique({ where: { id: input.clientId } });
      if (!c || c.status === 'MERGED') throw ruleViolation('INVALID_CLIENT', 'Client not found');
    }
    if (input.chargeIds.length && !input.clientId) throw ruleViolation('CLIENT_REQUIRED', 'Charges can only be invoiced to their client');
    if (input.patientId) {
      const own = await this.prisma.db.patientOwnership.findFirst({ where: { patientId: input.patientId, clientId: input.clientId ?? undefined } });
      if (!own) throw ruleViolation('INVALID_PATIENT', 'Patient does not belong to this client');
    }
    if (!input.chargeIds.length && !input.lines.length) throw ruleViolation('EMPTY_INVOICE', 'Add at least one item');
    // Charges for a single animal (or a single visit) make it that animal's invoice, so it shows on its record.
    let patientId = input.patientId ?? null;
    let encounterId = input.encounterId ?? null;
    if (input.chargeIds.length && (!patientId || !encounterId)) {
      const from = await this.prisma.db.charge.findMany({ where: { id: { in: input.chargeIds } }, select: { patientId: true, encounterId: true } });
      const patients = [...new Set(from.map((c) => c.patientId))];
      const encounters = [...new Set(from.map((c) => c.encounterId))];
      if (!patientId && patients.length === 1) patientId = patients[0];
      if (!encounterId && encounters.length === 1 && patients.length === 1) encounterId = encounters[0];
    }
    const resolved: Awaited<ReturnType<InvoicesService['resolveLine']>>[] = [];
    const rx = { allowed: org.sellWithoutPrescription, notes: [] as string[] };
    for (const l of input.lines) resolved.push(await this.resolveLine(l, input.isPos, rx));
    const withoutRx = rx.notes.length ? `Sold without a prescription: ${rx.notes.join('; ')}` : null;
    const id = await this.prisma.db.$transaction(async (tx) => {
      const inv = await tx.invoice.create({
        data: {
          organizationId: ctx.organizationId!,
          branchId: ctx.branchId!,
          clientId: input.clientId ?? null,
          patientId,
          encounterId,
          currency: org.currency,
          pricesIncludeTax: org.pricesIncludeTax,
          isPos: input.isPos,
          notes: [input.notes, withoutRx].filter(Boolean).join('\n') || null,
          createdById: ctx.userId!,
          createdByName: ctx.userName ?? 'Unknown',
        },
      });
      await this.addLines(tx, inv.id, org.pricesIncludeTax, 0, resolved, input.chargeIds, input.clientId ?? null);
      if (withoutRx) await this.audit.record({ action: 'invoice.sold_without_prescription', entityType: 'Invoice', entityId: inv.id, summary: withoutRx.slice(0, 500) }, tx);
      await this.retotal(tx, inv.id);
      await this.audit.record({ action: 'invoice.drafted', entityType: 'Invoice', entityId: inv.id, summary: `${input.chargeIds.length} charge(s), ${input.lines.length} line(s)` }, tx);
      if (input.issue) await this.issueTx(tx, inv.id);
      return inv.id;
    });
    return this.get(id);
  }

  async updateDraft(id: string, input: { lines?: LineInputBody[]; addChargeIds?: string[]; removeLineIds?: string[]; notes?: string | null; patientId?: string | null }) {
    const inv = await this.prisma.db.invoice.findUnique({ where: { id }, include: { lines: true } });
    if (!inv) throw notFound('Invoice');
    if (inv.status !== 'DRAFT') throw ruleViolation('NOT_DRAFT', 'Only draft invoices can be edited. Use a credit note or void instead.');
    const resolved: Awaited<ReturnType<InvoicesService['resolveLine']>>[] = [];
    for (const l of input.lines ?? []) resolved.push(await this.resolveLine(l, inv.isPos));
    await this.prisma.db.$transaction(async (tx) => {
      for (const lineId of input.removeLineIds ?? []) {
        if (!inv.lines.some((l) => l.id === lineId)) throw ruleViolation('INVALID_LINE', 'Line does not belong to this invoice');
        await tx.charge.updateMany({ where: { invoiceLineId: lineId }, data: { status: 'PENDING', invoiceLineId: null } });
        await tx.invoiceLine.delete({ where: { id: lineId } });
      }
      await this.addLines(tx, id, inv.pricesIncludeTax, inv.lines.length + 1, resolved, input.addChargeIds ?? [], inv.clientId);
      await tx.invoice.update({ where: { id }, data: { notes: input.notes, patientId: input.patientId } });
      await this.retotal(tx, id);
      await this.audit.record({ action: 'invoice.draft_updated', entityType: 'Invoice', entityId: id }, tx);
    });
    return this.get(id);
  }

  /** Deletes a draft and releases its charges back to unbilled. */
  async discardDraft(id: string) {
    const inv = await this.prisma.db.invoice.findUnique({ where: { id }, include: { lines: true } });
    if (!inv) throw notFound('Invoice');
    if (inv.status !== 'DRAFT') throw ruleViolation('NOT_DRAFT', 'Only drafts can be discarded');
    await this.prisma.db.$transaction(async (tx) => {
      await tx.charge.updateMany({ where: { invoiceLineId: { in: inv.lines.map((l) => l.id) } }, data: { status: 'PENDING', invoiceLineId: null } });
      await tx.invoice.delete({ where: { id } });
      await this.audit.record({ action: 'invoice.draft_discarded', entityType: 'Invoice', entityId: id }, tx);
    });
  }

  private async issueTx(tx: ScopedTx, id: string) {
    const ctx = RequestContext.require();
    const org = await this.org();
    const inv = await tx.invoice.findUniqueOrThrow({ where: { id }, include: { lines: { include: { charge: true } } } });
    if (inv.status !== 'DRAFT') throw ruleViolation('NOT_DRAFT', 'This invoice has already been issued');
    if (!inv.lines.length) throw ruleViolation('EMPTY_INVOICE', 'Add at least one item before issuing');
    // Direct product sales (not from a dispensing/administration charge) take stock now.
    for (const l of inv.lines) {
      if (l.kind === 'PRODUCT' && l.productId && !l.charge) {
        await this.inventory.issueForEvent(tx, { productId: l.productId, quantity: Number(l.quantity), branchId: inv.branchId, type: 'SALE', referenceType: 'InvoiceLine', referenceId: l.id });
        await tx.invoiceLine.update({ where: { id: l.id }, data: { stockIssued: true } });
      }
    }
    const number = await this.counters.next(tx, 'invoice');
    const issuedAt = new Date();
    // Due at the end of the due day in the branch's timezone, so "due on issue" is not overdue the same day.
    const branch = await tx.branch.findUniqueOrThrow({ where: { id: inv.branchId } });
    const dueAt = new Date(localDayBounds(new Date(issuedAt.getTime() + org.paymentTermsDays * 86400_000), branch.timezone).end.getTime() - 1);
    await tx.invoice.update({
      where: { id },
      data: {
        number,
        status: 'ISSUED',
        issuedAt,
        issuedByName: ctx.userName,
        dueAt,
        balanceMinor: inv.totalMinor,
      },
    });
    await recomputeClientBalance(tx, inv.clientId);
    await this.audit.record({ action: 'invoice.issued', entityType: 'Invoice', entityId: id, summary: `${invoiceNo(number)} total ${inv.totalMinor}` }, tx);
  }

  async issue(id: string) {
    await this.prisma.db.$transaction((tx) => this.issueTx(tx, id));
    return this.get(id);
  }

  /**
   * Voids an issued invoice. Its charges return to unbilled, stock from direct sales is returned,
   * and any payments allocated to it become client credit.
   */
  async void(id: string, reason: string) {
    const inv = await this.prisma.db.invoice.findUnique({ where: { id }, include: { lines: true, allocations: true, creditNotes: true } });
    if (!inv) throw notFound('Invoice');
    if (inv.status === 'DRAFT') throw ruleViolation('IS_DRAFT', 'Discard the draft instead');
    if (inv.status === 'VOID') throw ruleViolation('ALREADY_VOID', 'This invoice is already void');
    if (inv.creditNotes.length) throw ruleViolation('HAS_CREDIT_NOTES', 'An invoice with credit notes cannot be voided; issue a further credit note instead');
    const ctx = RequestContext.require();
    await this.prisma.db.$transaction(async (tx) => {
      await tx.paymentAllocation.deleteMany({ where: { invoiceId: id } });
      await tx.charge.updateMany({ where: { invoiceLineId: { in: inv.lines.map((l) => l.id) } }, data: { status: 'PENDING', invoiceLineId: null } });
      for (const l of inv.lines.filter((x) => x.stockIssued)) {
        await this.inventory.reverseEvent(tx, 'InvoiceLine', l.id, 'RETURN_FROM_CLIENT', `Invoice ${invoiceNo(inv.number)} voided`);
      }
      await tx.invoice.update({ where: { id }, data: { status: 'VOID', voidedAt: new Date(), voidedByName: ctx.userName, voidReason: reason, balanceMinor: 0, paidMinor: 0 } });
      await recomputeClientBalance(tx, inv.clientId);
      await this.audit.record(
        { action: 'invoice.voided', entityType: 'Invoice', entityId: id, summary: `${invoiceNo(inv.number)}: ${reason}${inv.allocations.length ? ` — ${inv.paidMinor} moved to client credit` : ''}` },
        tx,
      );
    });
    return this.get(id);
  }

  /** Credit note against an issued invoice. If the invoice is already paid, the excess becomes client credit. */
  async creditNote(id: string, amountMinor: number, reason: string) {
    const cn = await this.prisma.db.$transaction((tx) => this.creditTx(tx, id, amountMinor, reason));
    return { creditNote: { ...cn, creditNoteNo: formatNumber('CN', cn.number) }, invoice: await this.get(id) };
  }

  /** The credit note itself, inside the caller's transaction (also used by counter returns). */
  async creditTx(tx: ScopedTx, id: string, amountMinor: number, reason: string) {
    const ctx = RequestContext.require();
    const inv = await tx.invoice.findUnique({ where: { id }, include: { allocations: { orderBy: { createdAt: 'desc' } } } });
    if (!inv) throw notFound('Invoice');
    if (!['ISSUED', 'PARTIALLY_PAID', 'PAID'].includes(inv.status)) throw ruleViolation('NOT_ISSUED', 'Credit notes apply to issued invoices');
    if (amountMinor > inv.totalMinor - inv.creditedMinor) throw ruleViolation('CREDIT_TOO_LARGE', `At most ${inv.totalMinor - inv.creditedMinor} can still be credited`);
    const number = await this.counters.next(tx, 'credit_note');
    const note = await tx.creditNote.create({ data: { organizationId: ctx.organizationId!, number, invoiceId: id, amountMinor, reason, createdById: ctx.userId!, createdByName: ctx.userName ?? 'Unknown' } });
    // Release allocations if the credit would push the balance below zero.
    let excess = amountMinor - inv.balanceMinor;
    for (const a of inv.allocations) {
      if (excess <= 0) break;
      const take = Math.min(excess, a.amountMinor);
      if (take === a.amountMinor) await tx.paymentAllocation.delete({ where: { id: a.id } });
      else await tx.paymentAllocation.update({ where: { id: a.id }, data: { amountMinor: a.amountMinor - take } });
      excess -= take;
    }
    await refreshInvoice(tx, id);
    await recomputeClientBalance(tx, inv.clientId);
    await this.audit.record({ action: 'invoice.credited', entityType: 'Invoice', entityId: id, summary: `${formatNumber('CN', number)} ${amountMinor}: ${reason}` }, tx);
    return note;
  }

  /** Client statement: invoices, credit notes, payments and refunds in date order with running balance. */
  async statement(clientId: string) {
    const client = await this.prisma.db.client.findUnique({ where: { id: clientId } });
    if (!client) throw notFound('Client');
    const [invoices, payments] = await Promise.all([
      this.prisma.db.invoice.findMany({ where: { clientId, status: { not: 'DRAFT' } }, include: { creditNotes: true }, orderBy: { issuedAt: 'asc' } }),
      this.prisma.db.payment.findMany({ where: { clientId }, include: { refunds: true, allocations: true }, orderBy: { receivedAt: 'asc' } }),
    ]);
    const entries: { date: Date; type: string; reference: string; description: string; debitMinor: number; creditMinor: number }[] = [];
    for (const i of invoices) {
      entries.push({ date: i.issuedAt!, type: 'INVOICE', reference: invoiceNo(i.number), description: i.status === 'VOID' ? `Void: ${i.voidReason}` : 'Invoice', debitMinor: i.totalMinor, creditMinor: 0 });
      if (i.status === 'VOID') entries.push({ date: i.voidedAt!, type: 'VOID', reference: invoiceNo(i.number), description: 'Invoice voided', debitMinor: 0, creditMinor: i.totalMinor });
      for (const c of i.creditNotes) entries.push({ date: c.createdAt, type: 'CREDIT_NOTE', reference: formatNumber('CN', c.number), description: c.reason, debitMinor: 0, creditMinor: c.amountMinor });
    }
    const numberOf = new Map(invoices.map((i) => [i.id, invoiceNo(i.number)]));
    for (const p of payments) {
      const paid = [...new Set(p.allocations.map((a) => numberOf.get(a.invoiceId)).filter(Boolean))];
      const unallocated = p.amountMinor - p.allocations.reduce((n, a) => n + a.amountMinor, 0);
      const description = `${enumLabel(p.method)} payment${paid.length ? ` for ${paid.join(', ')}` : ''}${unallocated > 0 && paid.length ? ' (part on account)' : !paid.length ? ' on account' : ''}`;
      entries.push({ date: p.receivedAt, type: 'PAYMENT', reference: formatNumber('RCPT', p.number), description, debitMinor: 0, creditMinor: p.amountMinor });
      for (const r of p.refunds) entries.push({ date: r.refundedAt, type: 'REFUND', reference: formatNumber('RF', r.number), description: r.reason, debitMinor: r.amountMinor, creditMinor: 0 });
    }
    entries.sort((a, b) => a.date.getTime() - b.date.getTime());
    let running = 0;
    const lines = entries.map((e) => ({ ...e, balanceMinor: (running += e.debitMinor - e.creditMinor) }));
    return { client: { id: client.id, displayName: client.displayName, balanceMinor: client.balanceMinor }, lines, closingBalanceMinor: running };
  }
}
