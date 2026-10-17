import { Injectable } from '@nestjs/common';
import { LineKind, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { notFound, ruleViolation } from '../../common/http/errors';
import { pageArgs, paginated } from '../../common/http/pagination';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { ScopedTx } from '../../common/prisma/tenant-extension';

export interface CaptureInput {
  sourceType: string;
  sourceId: string;
  clientId: string;
  patientId?: string | null;
  encounterId?: string | null;
  branchId: string;
  kind: LineKind;
  serviceId?: string | null;
  productId?: string | null;
  labTestId?: string | null;
  description: string;
  quantity: number;
  unitPriceMinor: number;
  taxRateBasisPoints: number;
}

/**
 * Charge capture. Every billable clinical event creates exactly one Charge (unique per source), so
 * work is never billed twice and anything not yet invoiced is visible as an unbilled charge.
 */
@Injectable()
export class ChargeCaptureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async defaultTaxBp(tx: ScopedTx | PrismaService['db']) {
    const t = await tx.taxRate.findFirst({ where: { isDefault: true, isActive: true } });
    return t?.rateBasisPoints ?? 0;
  }

  async taxFor(tx: ScopedTx | PrismaService['db'], taxRateId?: string | null) {
    if (taxRateId) {
      const t = await tx.taxRate.findUnique({ where: { id: taxRateId } });
      if (t && t.isActive) return t.rateBasisPoints;
    }
    return this.defaultTaxBp(tx);
  }

  /** Idempotent: a second capture for the same source is ignored. Zero-priced items are not captured. */
  async capture(tx: ScopedTx, c: CaptureInput) {
    if (c.unitPriceMinor <= 0 || c.quantity <= 0) return null;
    const existing = await tx.charge.findFirst({ where: { sourceType: c.sourceType, sourceId: c.sourceId } });
    if (existing) return existing;
    return tx.charge.create({ data: { ...c, organizationId: RequestContext.orgId(), createdByName: RequestContext.get()?.userName ?? null } });
  }

  /** Waives pending charges for a source (e.g. a cancelled lab test). Invoiced charges are left alone. */
  async waiveForSource(tx: ScopedTx, sourceType: string, sourceIds: string[], reason: string) {
    if (!sourceIds.length) return 0;
    const r = await tx.charge.updateMany({ where: { sourceType, sourceId: { in: sourceIds }, status: 'PENDING' }, data: { status: 'WAIVED', waivedReason: reason } });
    return r.count;
  }

  async list(q: { page: number; pageSize: number; status: string; clientId?: string; patientId?: string; encounterId?: string }) {
    const where: Prisma.ChargeWhereInput = {
      status: q.status === 'ALL' ? undefined : (q.status as any),
      clientId: q.clientId,
      patientId: q.patientId,
      encounterId: q.encounterId,
    };
    const [rows, total, sum] = await Promise.all([
      this.prisma.db.charge.findMany({ where, include: { client: { select: { id: true, displayName: true } } }, orderBy: { createdAt: 'desc' }, ...pageArgs(q) }),
      this.prisma.db.charge.count({ where }),
      this.prisma.db.charge.findMany({ where, select: { quantity: true, unitPriceMinor: true } }),
    ]);
    const patientIds = [...new Set(rows.map((r) => r.patientId).filter(Boolean))] as string[];
    const patients = await this.prisma.db.patient.findMany({ where: { id: { in: patientIds } }, select: { id: true, name: true } });
    return {
      ...paginated(rows.map((r) => ({ ...r, quantity: Number(r.quantity), patient: patients.find((p) => p.id === r.patientId) ?? null })), total, q),
      totalMinor: sum.reduce((n, c) => n + Math.round(Number(c.quantity) * c.unitPriceMinor), 0),
    };
  }

  /**
   * Work not yet invoiced, one row per client: how many items, their total before tax and when the latest was
   * added. Newest activity first, so the client who has just finished at the clinic is at the top.
   */
  async byClient(q: { page: number; pageSize: number; q?: string }) {
    const db = this.prisma.db;
    const where: Prisma.ChargeWhereInput = { status: 'PENDING', ...(q.q ? { client: { displayName: { contains: q.q, mode: 'insensitive' } } } : {}) };
    const rows = await db.charge.findMany({ where, select: { clientId: true, patientId: true, quantity: true, unitPriceMinor: true, createdAt: true } });
    const groups = new Map<string, { clientId: string; itemCount: number; totalMinor: number; latestAt: Date; patientIds: Set<string> }>();
    for (const r of rows) {
      const g = groups.get(r.clientId) ?? { clientId: r.clientId, itemCount: 0, totalMinor: 0, latestAt: r.createdAt, patientIds: new Set<string>() };
      g.itemCount += 1;
      g.totalMinor += Math.round(Number(r.quantity) * r.unitPriceMinor);
      if (r.createdAt > g.latestAt) g.latestAt = r.createdAt;
      if (r.patientId) g.patientIds.add(r.patientId);
      groups.set(r.clientId, g);
    }
    const sorted = [...groups.values()].sort((a, b) => b.latestAt.getTime() - a.latestAt.getTime());
    const { skip, take } = pageArgs(q);
    const page = sorted.slice(skip, skip + take);
    const [clients, patients] = await Promise.all([
      db.client.findMany({ where: { id: { in: page.map((g) => g.clientId) } }, select: { id: true, displayName: true } }),
      db.patient.findMany({ where: { id: { in: page.flatMap((g) => [...g.patientIds]) } }, select: { id: true, name: true } }),
    ]);
    const data = page.map((g) => ({
      client: clients.find((c) => c.id === g.clientId) ?? { id: g.clientId, displayName: 'Unknown client' },
      itemCount: g.itemCount,
      totalMinor: g.totalMinor,
      latestAt: g.latestAt,
      patients: patients.filter((p) => g.patientIds.has(p.id)).map((p) => p.name),
    }));
    return { ...paginated(data, sorted.length, q), totalMinor: sorted.reduce((n, g) => n + g.totalMinor, 0) };
  }

  async waive(id: string, reason: string) {
    const c = await this.prisma.db.charge.findUnique({ where: { id } });
    if (!c) throw notFound('Charge');
    if (c.status !== 'PENDING') throw ruleViolation('NOT_PENDING', 'Only unbilled charges can be waived');
    return this.prisma.db.$transaction(async (tx) => {
      const after = await tx.charge.update({ where: { id }, data: { status: 'WAIVED', waivedReason: reason } });
      await this.audit.record({ action: 'charge.waived', entityType: 'Client', entityId: c.clientId, summary: `${c.description}: ${reason}` }, tx);
      return after;
    });
  }

  async restore(id: string) {
    const c = await this.prisma.db.charge.findUnique({ where: { id } });
    if (!c) throw notFound('Charge');
    if (c.status !== 'WAIVED') throw ruleViolation('NOT_WAIVED', 'Only waived charges can be restored');
    return this.prisma.db.$transaction(async (tx) => {
      const after = await tx.charge.update({ where: { id }, data: { status: 'PENDING', waivedReason: null } });
      await this.audit.record({ action: 'charge.restored', entityType: 'Client', entityId: c.clientId, summary: c.description }, tx);
      return after;
    });
  }
}

/**
 * Client balance = outstanding on issued invoices − unallocated payment credit.
 * Positive means the client owes the practice; negative means the client is in credit.
 */
export async function recomputeClientBalance(tx: ScopedTx, clientId: string | null | undefined) {
  if (!clientId) return;
  const [owed, payments] = await Promise.all([
    tx.invoice.aggregate({ where: { clientId, status: { in: ['ISSUED', 'PARTIALLY_PAID'] } }, _sum: { balanceMinor: true } }),
    tx.payment.findMany({ where: { clientId }, include: { allocations: true } }),
  ]);
  const credit = payments.reduce((n, p) => n + p.amountMinor - p.refundedMinor - p.allocations.reduce((a, x) => a + x.amountMinor, 0), 0);
  await tx.client.update({ where: { id: clientId }, data: { balanceMinor: (owed._sum.balanceMinor ?? 0) - credit } });
}
