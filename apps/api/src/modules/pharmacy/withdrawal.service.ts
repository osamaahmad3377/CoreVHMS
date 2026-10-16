import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { ScopedTx } from '../../common/prisma/tenant-extension';

/**
 * Food-safety withdrawal tracking. When a food-producing animal is treated with a product that has a
 * configured, sourced withdrawal period for its species, the clear dates for meat/milk/eggs are recorded.
 */
@Injectable()
export class WithdrawalService {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    tx: ScopedTx,
    e: { patientId: string; speciesId: string; productId: string; sourceType: 'ADMINISTRATION' | 'DISPENSATION' | 'GROUP_TREATMENT' | 'FIELD_VISIT_ITEM'; sourceId: string; treatedAt: Date },
  ) {
    const w = await tx.productWithdrawal.findFirst({ where: { productId: e.productId, speciesId: e.speciesId } });
    if (!w) return null;
    const add = (ms: number) => new Date(e.treatedAt.getTime() + ms);
    return tx.patientWithdrawal.create({
      data: {
        organizationId: RequestContext.orgId(),
        patientId: e.patientId,
        productId: e.productId,
        sourceType: e.sourceType,
        sourceId: e.sourceId,
        treatedAt: e.treatedAt,
        meatClearAt: w.meatDays != null ? add(w.meatDays * 86400_000) : null,
        milkClearAt: w.milkHours != null ? add(w.milkHours * 3600_000) : null,
        eggClearAt: w.eggDays != null ? add(w.eggDays * 86400_000) : null,
        source: w.source,
      },
    });
  }

  /** Withdrawals that have not yet cleared for at least one product type. */
  async active(patientId: string) {
    const now = new Date();
    const rows = await this.prisma.db.patientWithdrawal.findMany({
      where: { patientId, OR: [{ meatClearAt: { gt: now } }, { milkClearAt: { gt: now } }, { eggClearAt: { gt: now } }] },
      include: { product: { select: { id: true, name: true } } },
      orderBy: { treatedAt: 'desc' },
    });
    return rows.map((r) => ({
      ...r,
      meatActive: !!r.meatClearAt && r.meatClearAt > now,
      milkActive: !!r.milkClearAt && r.milkClearAt > now,
      eggActive: !!r.eggClearAt && r.eggClearAt > now,
    }));
  }

  history(patientId: string) {
    return this.prisma.db.patientWithdrawal.findMany({ where: { patientId }, include: { product: { select: { id: true, name: true } } }, orderBy: { treatedAt: 'desc' }, take: 100 });
  }
}
