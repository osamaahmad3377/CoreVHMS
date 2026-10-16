import { csvRow } from '../../common/util/csv';
import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { formatNumber } from '../../common/counter/counter.service';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Financial and operational reporting. Definitions (documented in the UI):
 *  - Gross billed   = Σ invoice totals (incl. tax) issued in the period, excluding void invoices.
 *  - Net revenue    = Σ invoice net (ex-tax) − credit notes issued in the period (ex-tax portion pro-rated by each invoice's tax ratio).
 *  - Cost of goods  = Σ stock issued for sale/dispensing/administration in the period × batch unit cost,
 *                     less stock returned by clients (including restocks from voided invoices).
 *  - Gross profit   = Net revenue − Cost of goods.
 *  - Operating profit = Gross profit − expenses (ex-tax) in the period. Revenue is NOT profit.
 *  - Cash received  = payments received − refunds paid in the period (cash basis, all methods).
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private branch(branchId?: string) {
    return branchId ? { branchId } : {};
  }

  async financialSummary(from: Date, to: Date, branchId?: string) {
    const db = this.prisma.db;
    const b = this.branch(branchId);
    const [invoices, creditNotes, payments, refunds, expenses, cogsRows] = await Promise.all([
      db.invoice.findMany({ where: { ...b, status: { not: 'DRAFT' }, issuedAt: { gte: from, lt: to }, NOT: { status: 'VOID' } }, select: { subtotalMinor: true, taxMinor: true, totalMinor: true } }),
      db.creditNote.findMany({ where: { createdAt: { gte: from, lt: to }, invoice: b }, include: { invoice: { select: { totalMinor: true, taxMinor: true } } } }),
      db.payment.groupBy({ by: ['method'], where: { ...b, receivedAt: { gte: from, lt: to } }, _sum: { amountMinor: true }, _count: true }),
      db.refund.findMany({ where: { refundedAt: { gte: from, lt: to }, payment: b }, select: { amountMinor: true, method: true } }),
      db.expense.findMany({ where: { ...b, date: { gte: from, lt: to } }, select: { amountMinor: true, taxMinor: true, category: true } }),
      db.stockMovement.findMany({ where: { ...b, createdAt: { gte: from, lt: to }, type: { in: ['SALE', 'DISPENSE', 'ADMINISTER', 'RETURN_FROM_CLIENT'] } }, select: { quantity: true, unitCostMinor: true, type: true } }),
    ]);
    const grossBilled = invoices.reduce((n, i) => n + i.totalMinor, 0);
    const invoicedNet = invoices.reduce((n, i) => n + i.subtotalMinor, 0);
    const taxBilled = invoices.reduce((n, i) => n + i.taxMinor, 0);
    const creditGross = creditNotes.reduce((n, c) => n + c.amountMinor, 0);
    const creditTax = creditNotes.reduce((n, c) => n + (c.invoice.totalMinor ? Math.round((c.amountMinor * c.invoice.taxMinor) / c.invoice.totalMinor) : 0), 0);
    const netRevenue = invoicedNet - (creditGross - creditTax);
    const cogs = Math.round(cogsRows.reduce((n, m) => n + -Number(m.quantity) * m.unitCostMinor, 0));
    const expensesNet = expenses.reduce((n, e) => n + e.amountMinor - e.taxMinor, 0);
    const received = payments.reduce((n, p) => n + (p._sum.amountMinor ?? 0), 0);
    const refunded = refunds.reduce((n, r) => n + r.amountMinor, 0);
    const outstanding = await db.invoice.aggregate({ where: { ...b, status: { in: ['ISSUED', 'PARTIALLY_PAID'] } }, _sum: { balanceMinor: true } });
    return {
      period: { from, to },
      grossBilledMinor: grossBilled,
      taxBilledMinor: taxBilled - creditTax,
      creditNotesMinor: creditGross,
      netRevenueMinor: netRevenue,
      costOfGoodsMinor: cogs,
      grossProfitMinor: netRevenue - cogs,
      expensesMinor: expensesNet,
      operatingProfitMinor: netRevenue - cogs - expensesNet,
      cashReceivedMinor: received - refunded,
      refundsMinor: refunded,
      outstandingMinor: outstanding._sum.balanceMinor ?? 0,
      invoiceCount: invoices.length,
      paymentsByMethod: payments.map((p) => ({ method: p.method, count: p._count, amountMinor: p._sum.amountMinor ?? 0 })),
      expensesByCategory: Object.entries(expenses.reduce<Record<string, number>>((acc, e) => ((acc[e.category] = (acc[e.category] ?? 0) + e.amountMinor - e.taxMinor), acc), {})).map(([category, amountMinor]) => ({ category, amountMinor })),
    };
  }

  /** Net sales by line (service/product/lab), excluding void invoices. */
  async salesByItem(from: Date, to: Date, branchId?: string) {
    const lines = await this.prisma.db.invoiceLine.findMany({
      where: { invoice: { ...this.branch(branchId), issuedAt: { gte: from, lt: to }, status: { notIn: ['DRAFT', 'VOID'] } } },
      select: { kind: true, description: true, serviceId: true, productId: true, labTestId: true, quantity: true, netMinor: true, taxMinor: true, grossMinor: true },
    });
    const map = new Map<string, { kind: string; item: string; quantity: number; netMinor: number; taxMinor: number; grossMinor: number }>();
    for (const l of lines) {
      const key = `${l.kind}:${l.serviceId ?? l.productId ?? l.labTestId ?? l.description}`;
      const r = map.get(key) ?? { kind: l.kind, item: l.description, quantity: 0, netMinor: 0, taxMinor: 0, grossMinor: 0 };
      r.quantity += Number(l.quantity);
      r.netMinor += l.netMinor;
      r.taxMinor += l.taxMinor;
      r.grossMinor += l.grossMinor;
      map.set(key, r);
    }
    return [...map.values()].sort((a, b) => b.netMinor - a.netMinor);
  }

  /** Aged receivables by days past due date. */
  async agedReceivables(branchId?: string) {
    const rows = await this.prisma.db.invoice.findMany({
      where: { ...this.branch(branchId), status: { in: ['ISSUED', 'PARTIALLY_PAID'] }, balanceMinor: { gt: 0 } },
      include: { client: { select: { id: true, displayName: true } } },
      orderBy: { dueAt: 'asc' },
    });
    const now = Date.now();
    const buckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 };
    const invoices = rows.map((i) => {
      const days = i.dueAt ? Math.floor((now - i.dueAt.getTime()) / 86400_000) : 0;
      const bucket = days <= 0 ? 'current' : days <= 30 ? 'd1_30' : days <= 60 ? 'd31_60' : days <= 90 ? 'd61_90' : 'd90plus';
      (buckets as any)[bucket] += i.balanceMinor;
      return { id: i.id, invoiceNo: formatNumber('INV', i.number!), client: i.client, issuedAt: i.issuedAt, dueAt: i.dueAt, balanceMinor: i.balanceMinor, daysOverdue: Math.max(0, days), bucket };
    });
    return { buckets, totalMinor: Object.values(buckets).reduce((a, b) => a + b, 0), invoices };
  }

  async stockValuation() {
    const levels = await this.prisma.db.stockLevel.findMany({
      where: { quantity: { gt: 0 } },
      include: { product: { select: { id: true, name: true, dispensingUnit: true } }, batch: { select: { unitCostMinor: true, expiryDate: true, status: true } }, location: { select: { name: true } } },
    });
    const byProduct = new Map<string, { productId: string; name: string; unit: string; quantity: number; valueMinor: number }>();
    for (const l of levels) {
      const r = byProduct.get(l.productId) ?? { productId: l.productId, name: l.product.name, unit: l.product.dispensingUnit, quantity: 0, valueMinor: 0 };
      r.quantity += Number(l.quantity);
      r.valueMinor += Math.round(Number(l.quantity) * l.batch.unitCostMinor);
      byProduct.set(l.productId, r);
    }
    const rows = [...byProduct.values()].sort((a, b) => b.valueMinor - a.valueMinor);
    return { totalMinor: rows.reduce((n, r) => n + r.valueMinor, 0), rows };
  }

  /** Stock written off (expired, damaged, lost, recalled) at cost. */
  async writeOffs(from: Date, to: Date) {
    const rows = await this.prisma.db.stockMovement.findMany({
      where: { type: 'WRITE_OFF', createdAt: { gte: from, lt: to } },
      include: { product: { select: { name: true, dispensingUnit: true } }, batch: { select: { batchNumber: true, expiryDate: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const data = rows.map((m) => ({ ...m, quantity: Number(m.quantity), balanceAfter: Number(m.balanceAfter), costMinor: Math.round(-Number(m.quantity) * m.unitCostMinor) }));
    return { totalMinor: data.reduce((n, r) => n + r.costMinor, 0), rows: data };
  }

  async appointmentStats(from: Date, to: Date, branchId?: string) {
    const rows = await this.prisma.db.appointment.groupBy({ by: ['status'], where: { ...this.branch(branchId), startsAt: { gte: from, lt: to } }, _count: true });
    const total = rows.reduce((n, r) => n + r._count, 0);
    const by = Object.fromEntries(rows.map((r) => [r.status, r._count]));
    return { total, byStatus: by, noShowRate: total ? (by.NO_SHOW ?? 0) / total : 0, cancellationRate: total ? (by.CANCELLED ?? 0) / total : 0 };
  }

  /**
   * Clinical activity for a period: counts only, no patient-identifiable details. Consultations are counted by
   * start time, diagnoses by when they were recorded, hospital stays by admission (outcomes and length of stay by
   * discharge), surgeries by completion. New patients are counted for the whole organisation (patients are not tied
   * to one branch).
   */
  async clinicalActivity(from: Date, to: Date, branchId?: string) {
    const db = this.prisma.db;
    const branch = this.branch(branchId);
    const range = { gte: from, lt: to };
    const [encounters, diagnoses, admitted, discharged, surgeries, patients] = await Promise.all([
      db.encounter.findMany({
        where: { ...branch, startedAt: range, status: { not: 'CANCELLED' } },
        select: { status: true, clinician: { select: { user: { select: { name: true } } } }, patient: { select: { species: { select: { name: true } } } } },
      }),
      db.diagnosis.findMany({ where: { createdAt: range, encounter: branch }, select: { term: true, type: true } }),
      db.admission.count({ where: { ...branch, admittedAt: range, status: { not: 'CANCELLED' } } }),
      db.admission.findMany({ where: { ...branch, dischargedAt: range }, select: { admittedAt: true, dischargedAt: true, outcome: true } }),
      db.surgery.findMany({ where: { ...branch, status: 'COMPLETED', completedAt: range }, select: { procedure: true, complications: true } }),
      db.patient.findMany({ where: { createdAt: range, status: { not: 'MERGED' } }, select: { species: { select: { name: true } } } }),
    ]);
    const tally = <T>(items: T[], key: (t: T) => string) => {
      const m = new Map<string, { label: string; count: number }>();
      for (const it of items) {
        const label = key(it).trim() || '—';
        const k = label.toLowerCase();
        const e = m.get(k) ?? { label, count: 0 };
        e.count += 1;
        m.set(k, e);
      }
      return [...m.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    };
    const confirmed = new Map<string, number>();
    for (const d of diagnoses) if (d.type === 'CONFIRMED') confirmed.set(d.term.trim().toLowerCase(), (confirmed.get(d.term.trim().toLowerCase()) ?? 0) + 1);
    const stayDays = discharged.map((a) => (a.dischargedAt!.getTime() - a.admittedAt.getTime()) / 86_400_000);
    return {
      period: { from, to },
      consultations: {
        total: encounters.length,
        completed: encounters.filter((e) => e.status === 'COMPLETED').length,
        byClinician: tally(encounters, (e) => e.clinician?.user.name ?? 'Unassigned').map(({ label, count }) => ({ clinician: label, count })),
        bySpecies: tally(encounters, (e) => e.patient.species.name).map(({ label, count }) => ({ species: label, count })),
      },
      diagnoses: tally(diagnoses, (d) => d.term).slice(0, 15).map(({ label, count }) => ({ diagnosis: label, count, confirmed: confirmed.get(label.toLowerCase()) ?? 0 })),
      hospital: {
        admitted,
        discharged: discharged.length,
        averageStayDays: stayDays.length ? Math.round((stayDays.reduce((n, d) => n + d, 0) / stayDays.length) * 10) / 10 : null,
        outcomes: tally(discharged, (a) => a.outcome ?? 'UNKNOWN').map(({ label, count }) => ({ outcome: label, count })),
      },
      surgery: {
        completed: surgeries.length,
        withComplications: surgeries.filter((s) => (s.complications ?? '').trim().length > 0).length,
        byProcedure: tally(surgeries, (s) => s.procedure).slice(0, 10).map(({ label, count }) => ({ procedure: label, count })),
      },
      newPatients: { total: patients.length, bySpecies: tally(patients, (p) => p.species.name).map(({ label, count }) => ({ species: label, count })) },
    };
  }

  toCsv(rows: Record<string, unknown>[]) {
    if (!rows.length) return '';
    const cols = Object.keys(rows[0]);
    return [cols.join(','), ...rows.map((r) => csvRow(cols.map((c) => r[c])))].join('\n');
  }

  currency() {
    return this.prisma.raw.organization.findUniqueOrThrow({ where: { id: RequestContext.orgId() }, select: { currency: true } });
  }

}
