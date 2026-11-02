import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DISPOSAL_METHOD_LABELS, DISPOSAL_REASON_LABELS, type StockDisposalInput } from '@vcms/shared';
import { AuditService } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { CounterService, formatNumber } from '../../common/counter/counter.service';
import { notFound, ruleViolation } from '../../common/http/errors';
import { pageArgs, paginated } from '../../common/http/pagination';
import { PrismaService } from '../../common/prisma/prisma.service';
import { resolveTimezone } from '../../common/time/branch-timezone';
import { localParts } from '../../common/time/tz';
import { StockEngine, r4 } from './stock.engine';

export const disposalNo = (n: number) => formatNumber('DSP', n);
const DAY = 86400_000;

const include = {
  location: { select: { id: true, name: true, branchId: true } },
  lines: {
    include: {
      product: { select: { id: true, name: true, sku: true, dispensingUnit: true, isControlled: true, controlledSchedule: true } },
      batch: { select: { id: true, batchNumber: true, expiryDate: true } },
    },
  },
} satisfies Prisma.StockDisposalInclude;
type Row = Prisma.StockDisposalGetPayload<{ include: typeof include }>;

const shape = (d: Row) => ({
  ...d,
  disposalNo: disposalNo(d.number),
  reasonLabel: DISPOSAL_REASON_LABELS[d.reason],
  methodLabel: DISPOSAL_METHOD_LABELS[d.method],
  lines: d.lines.map((l) => ({ ...l, quantity: Number(l.quantity) })),
});

/**
 * Disposal of expired, short-dated, damaged or recalled stock. Lists what is waiting to be disposed of, and records
 * a disposal: every line leaves the shelf as a WRITE_OFF movement (row-locked, never more than is there) and the
 * record is permanent. Controlled medicines need a witness who is another member of staff.
 */
@Injectable()
export class DisposalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly counters: CounterService,
    private readonly engine: StockEngine,
  ) {}

  private async today() {
    return localParts(new Date(), await resolveTimezone(this.prisma)).date;
  }

  /** Stock on the shelf that is expired, expiring within `days`, recalled or quarantined — soonest first. */
  async candidates(q: { locationId?: string; days: number }) {
    const today = await this.today();
    const t0 = new Date(`${today}T00:00:00.000Z`);
    const horizon = new Date(t0.getTime() + q.days * DAY);
    const levels = await this.prisma.db.stockLevel.findMany({
      where: {
        quantity: { gt: 0 },
        locationId: q.locationId,
        OR: [{ batch: { status: { in: ['RECALLED', 'QUARANTINED'] } } }, { batch: { expiryDate: { lte: horizon } } }],
      },
      include: {
        batch: { select: { id: true, batchNumber: true, expiryDate: true, status: true, statusReason: true, unitCostMinor: true } },
        product: { select: { id: true, name: true, sku: true, dispensingUnit: true, isControlled: true, type: true } },
        location: { select: { id: true, name: true, branchId: true } },
      },
    });
    const rows = levels
      .map((l) => {
        const daysLeft = l.batch.expiryDate ? Math.round((l.batch.expiryDate.getTime() - t0.getTime()) / DAY) : null;
        const state = daysLeft !== null && daysLeft < 0 ? 'EXPIRED' : l.batch.status === 'RECALLED' ? 'RECALLED' : l.batch.status === 'QUARANTINED' ? 'QUARANTINED' : 'EXPIRING';
        const quantity = Number(l.quantity);
        return {
          batchId: l.batch.id,
          batchNumber: l.batch.batchNumber,
          expiryDate: l.batch.expiryDate ? l.batch.expiryDate.toISOString().slice(0, 10) : null,
          daysLeft,
          state: state as 'EXPIRED' | 'EXPIRING' | 'RECALLED' | 'QUARANTINED',
          statusReason: l.batch.statusReason,
          product: l.product,
          location: l.location,
          quantity,
          unitCostMinor: l.batch.unitCostMinor,
          valueMinor: Math.round(quantity * l.batch.unitCostMinor),
        };
      })
      .sort((a, b) => (a.daysLeft ?? -Infinity) - (b.daysLeft ?? -Infinity) || a.product.name.localeCompare(b.product.name));
    const sum = (s: string) => rows.filter((r) => r.state === s).reduce((n, r) => ({ count: n.count + 1, valueMinor: n.valueMinor + r.valueMinor }), { count: 0, valueMinor: 0 });
    return { today, rows, summary: { expired: sum('EXPIRED'), expiring: sum('EXPIRING'), recalled: sum('RECALLED'), quarantined: sum('QUARANTINED') } };
  }

  /** Staff who can witness a disposal: active members other than the person disposing. */
  async witnesses() {
    const me = RequestContext.require().userId;
    const rows = await this.prisma.db.membership.findMany({ where: { status: 'ACTIVE', userId: { not: me } }, include: { user: { select: { name: true } } }, orderBy: { user: { name: 'asc' } } });
    return rows.map((m) => ({ id: m.id, name: m.user.name, jobTitle: m.jobTitle }));
  }

  async list(q: { page: number; pageSize: number }) {
    const [rows, total, month] = await Promise.all([
      this.prisma.db.stockDisposal.findMany({ include, orderBy: { disposedAt: 'desc' }, ...pageArgs(q) }),
      this.prisma.db.stockDisposal.count(),
      this.prisma.db.stockDisposal.aggregate({ where: { disposedAt: { gte: new Date(`${(await this.today()).slice(0, 7)}-01T00:00:00.000Z`) } }, _sum: { totalMinor: true } }),
    ]);
    return { ...paginated(rows.map(shape), total, q), thisMonthMinor: month._sum.totalMinor ?? 0 };
  }

  async get(id: string) {
    const d = await this.prisma.db.stockDisposal.findUnique({ where: { id }, include });
    if (!d) throw notFound('Disposal');
    return shape(d);
  }

  async create(input: StockDisposalInput) {
    const ctx = RequestContext.require();
    const db = this.prisma.db;
    const loc = await db.stockLocation.findUnique({ where: { id: input.locationId } });
    if (!loc) throw ruleViolation('INVALID_LOCATION', 'Stock location not found');
    const batchIds = [...new Set(input.lines.map((l) => l.batchId))];
    if (batchIds.length !== input.lines.length) throw ruleViolation('DUPLICATE_BATCH', 'List each batch once');
    const batches = await db.stockBatch.findMany({ where: { id: { in: batchIds } }, include: { product: { select: { name: true, isControlled: true } } } });
    if (batches.length !== batchIds.length) throw ruleViolation('INVALID_BATCH', 'One or more batches were not found');
    const byId = new Map(batches.map((b) => [b.id, b]));
    const controlled = batches.filter((b) => b.product.isControlled);

    // Controlled medicines: destruction must be witnessed by someone else.
    let witness: { id: string; name: string } | null = null;
    if (input.witnessMembershipId) {
      const m = await db.membership.findUnique({ where: { id: input.witnessMembershipId }, include: { user: { select: { name: true } } } });
      if (!m || m.status !== 'ACTIVE') throw ruleViolation('INVALID_WITNESS', 'The witness must be an active member of staff');
      if (m.userId === ctx.userId) throw ruleViolation('INVALID_WITNESS', 'The witness must be someone other than you');
      witness = { id: m.id, name: m.user.name };
    }
    if (controlled.length && !witness) {
      throw ruleViolation('WITNESS_REQUIRED', `${controlled.map((b) => b.product.name).join(', ')} ${controlled.length === 1 ? 'is a controlled medicine' : 'are controlled medicines'}: choose the member of staff who witnessed the disposal`);
    }
    const now = new Date();
    const disposedAt = input.disposedAt ?? now;
    if (disposedAt.getTime() > now.getTime() + 5 * 60_000) throw ruleViolation('FUTURE_DATE', 'The disposal can’t be in the future');
    if (disposedAt.getTime() < now.getTime() - 31 * DAY) throw ruleViolation('TOO_OLD', 'Record disposals within a month of doing them');
    const today = new Date(`${await this.today()}T00:00:00.000Z`);

    const id = await db.$transaction(async (tx) => {
      const number = await this.counters.next(tx, 'stock_disposal');
      const lines = input.lines.map((l) => {
        const b = byId.get(l.batchId)!;
        const quantity = r4(l.quantity);
        return { b, quantity, totalMinor: Math.round(quantity * b.unitCostMinor), wasExpired: !!b.expiryDate && b.expiryDate < today };
      });
      const d = await tx.stockDisposal.create({
        data: {
          organizationId: ctx.organizationId!,
          branchId: loc.branchId,
          number,
          locationId: loc.id,
          reason: input.reason,
          method: input.method,
          contractor: input.contractor ?? null,
          reference: input.reference ?? null,
          notes: input.notes ?? null,
          witnessId: witness?.id ?? null,
          witnessName: witness?.name ?? null,
          hasControlled: controlled.length > 0,
          totalMinor: lines.reduce((n, l) => n + l.totalMinor, 0),
          disposedAt,
          createdById: ctx.userId!,
          createdByName: ctx.userName ?? 'Unknown',
          lines: { create: lines.map((l) => ({ organizationId: ctx.organizationId!, productId: l.b.productId, batchId: l.b.id, quantity: l.quantity, unitCostMinor: l.b.unitCostMinor, totalMinor: l.totalMinor, wasExpired: l.wasExpired })) },
        },
      });
      const why = `${DISPOSAL_REASON_LABELS[input.reason]} — ${DISPOSAL_METHOD_LABELS[input.method].toLowerCase()}${witness ? `, witnessed by ${witness.name}` : ''}`;
      for (const l of lines) {
        // Row-locked; refuses to take more than is on the shelf at this location.
        await this.engine.move(tx, { productId: l.b.productId, batchId: l.b.id, locationId: loc.id, branchId: loc.branchId, delta: -l.quantity, type: 'WRITE_OFF', unitCostMinor: l.b.unitCostMinor, reason: why, referenceType: 'StockDisposal', referenceId: d.id });
      }
      await this.audit.record(
        { action: 'stock.disposed', entityType: 'StockDisposal', entityId: d.id, summary: `${disposalNo(number)} at ${loc.name}: ${lines.map((l) => `${l.quantity} × ${l.b.product.name} (${l.b.batchNumber})`).join(', ')}; ${why}`.slice(0, 1000) },
        tx,
      );
      return d.id;
    });
    return this.get(id);
  }
}
