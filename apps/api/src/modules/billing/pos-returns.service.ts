import { Injectable } from '@nestjs/common';
import { formatNumber } from '../../common/counter/counter.service';
import { AuditService } from '../../common/audit/audit.service';
import { notFound, ruleViolation } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { InvoicesService, invoiceNo } from './invoices.service';
import { PaymentsService } from './payments.service';

export interface PosReturnInput {
  invoiceId: string;
  lines: { lineId: string; quantity: number }[];
  reason: string;
  refundTo: 'ORIGINAL' | 'CASH' | 'CREDIT';
}

/**
 * Items brought back to the counter. In one step: a credit note for what they cost (tax included), the items go back
 * on the shelf (into the batches they came from), and the money is handed back, or kept as credit on the client's
 * account. If anything fails, such as a closed cash drawer, nothing at all is recorded.
 */
@Injectable()
export class PosReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly invoices: InvoicesService,
    private readonly payments: PaymentsService,
    private readonly inventory: InventoryService,
  ) {}

  /** Recent counter sales that can still have items returned, newest first; `q` matches the invoice number or client. */
  async findSales(q?: string) {
    const term = q?.trim();
    const digits = term?.replace(/\D/g, '');
    const since = new Date(Date.now() - 60 * 86400_000);
    const rows = await this.prisma.db.invoice.findMany({
      where: {
        isPos: true,
        status: { in: ['ISSUED', 'PARTIALLY_PAID', 'PAID'] },
        issuedAt: { gte: since },
        ...(term
          ? { OR: [...(digits ? [{ number: Number(digits) }] : []), { client: { displayName: { contains: term, mode: 'insensitive' as const } } }] }
          : {}),
      },
      include: { lines: { orderBy: { sortOrder: 'asc' }, include: { charge: { select: { sourceType: true } } } }, client: { select: { id: true, displayName: true } } },
      orderBy: { issuedAt: 'desc' },
      take: 20,
    });
    return rows.map((i) => ({
      id: i.id,
      invoiceNo: invoiceNo(i.number),
      issuedAt: i.issuedAt,
      totalMinor: i.totalMinor,
      paidMinor: i.paidMinor,
      client: i.client,
      lines: i.lines.map((l) => ({
        id: l.id,
        description: l.description,
        quantity: Number(l.quantity),
        returnedQuantity: Number(l.returnedQuantity),
        grossMinor: l.grossMinor,
        returnedMinor: l.returnedMinor,
        // Medicines handed out against a prescription go back through the pharmacy, not the counter.
        returnable: l.charge?.sourceType !== 'Dispensation' && Number(l.quantity) - Number(l.returnedQuantity) > 1e-9,
      })),
    }));
  }

  async returnItems(input: PosReturnInput) {
    const inv = await this.prisma.db.invoice.findUnique({
      where: { id: input.invoiceId },
      include: { lines: { include: { charge: { select: { sourceType: true } } } }, allocations: { include: { payment: true }, orderBy: { createdAt: 'desc' } } },
    });
    if (!inv) throw notFound('Invoice');
    if (!['ISSUED', 'PARTIALLY_PAID', 'PAID'].includes(inv.status)) throw ruleViolation('NOT_ISSUED', 'Only an issued sale can have items returned');

    // What is being returned, line by line, and what each part is worth (tax included). The last part of a line
    // takes exactly what is left of its price, so rounding never leaves a cent behind.
    const asked = new Map<string, number>();
    for (const l of input.lines) asked.set(l.lineId, (asked.get(l.lineId) ?? 0) + l.quantity);
    const plan = [...asked].map(([lineId, quantity]) => {
      const line = inv.lines.find((l) => l.id === lineId);
      if (!line) throw ruleViolation('INVALID_LINE', 'That item is not on this sale');
      if (line.charge?.sourceType === 'Dispensation') throw ruleViolation('NOT_RETURNABLE', `${line.description} was handed out on a prescription. Medicines go back through the pharmacy.`);
      const left = Number(line.quantity) - Number(line.returnedQuantity);
      if (quantity > left + 1e-9) throw ruleViolation('RETURN_TOO_MANY', `Only ${left} of ${line.description} can still be returned`);
      const rest = line.grossMinor - line.returnedMinor;
      const amount = Math.abs(left - quantity) < 1e-9 ? rest : Math.min(rest, Math.round((line.grossMinor * quantity) / Number(line.quantity)));
      return { line, quantity, amount };
    });
    const amount = plan.reduce((n, p) => n + p.amount, 0);
    if (amount <= 0) throw ruleViolation('NOTHING_TO_RETURN', 'Nothing to return');

    // The part of the credit that is simply less to pay comes off the balance; the rest is money to hand back.
    const moneyBack = Math.max(0, Math.min(amount - inv.balanceMinor, inv.paidMinor));
    if (input.refundTo === 'CREDIT' && moneyBack > 0 && !inv.clientId) {
      throw ruleViolation('CLIENT_REQUIRED', 'A customer without an account cannot keep credit. Refund in cash or the original way.');
    }

    return this.prisma.db.$transaction(async (tx) => {
      const note = await this.invoices.creditTx(tx, inv.id, amount, `Return: ${input.reason}`);
      const restocked: { description: string; quantity: number }[] = [];
      for (const p of plan) {
        if (p.line.productId && p.line.stockIssued) {
          const back = await this.inventory.returnFromEvent(tx, 'InvoiceLine', p.line.id, p.quantity, `Return on ${invoiceNo(inv.number)}: ${input.reason}`);
          if (back > 0) restocked.push({ description: p.line.description, quantity: back });
        }
        await tx.invoiceLine.update({ where: { id: p.line.id }, data: { returnedQuantity: { increment: p.quantity }, returnedMinor: { increment: p.amount } } });
      }
      let refunded = 0;
      if (input.refundTo !== 'CREDIT' && moneyBack > 0) {
        let left = moneyBack;
        for (const a of inv.allocations) {
          if (left <= 0) break;
          const take = Math.min(left, a.amountMinor, a.payment.amountMinor - a.payment.refundedMinor);
          if (take <= 0) continue;
          await this.payments.refundTx(tx, a.paymentId, { amountMinor: take, method: input.refundTo === 'CASH' ? 'CASH' : a.payment.method, reason: `Return on ${invoiceNo(inv.number)}: ${input.reason}` });
          refunded += take;
          left -= take;
        }
        if (left > 0) throw ruleViolation('REFUND_SHORT', 'The money to hand back could not be matched to the payments on this sale');
      }
      await this.audit.record({ action: 'pos.return', entityType: 'Invoice', entityId: inv.id, summary: `${formatNumber('CN', note.number)}: ${plan.map((p) => `${p.quantity} × ${p.line.description}`).join(', ')} — ${input.reason}${refunded ? `; refunded ${refunded}` : ''}` }, tx);
      return { creditNoteNo: formatNumber('CN', note.number), creditedMinor: amount, refundedMinor: refunded, keptAsCreditMinor: moneyBack - refunded, restocked, invoiceNo: invoiceNo(inv.number) };
    });
  }
}
