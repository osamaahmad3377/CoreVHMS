import { Injectable } from '@nestjs/common';
import { MovementType, Prisma } from '@prisma/client';
import { RequestContext } from '../../common/context/request-context';
import { ruleViolation } from '../../common/http/errors';
import type { ScopedTx } from '../../common/prisma/tenant-extension';

export const r4 = (n: number) => Math.round(n * 10000) / 10000;

export interface MoveInput {
  productId: string;
  batchId: string;
  locationId: string;
  branchId: string;
  delta: number;
  type: MovementType;
  unitCostMinor: number;
  reason?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  allowNegative?: boolean;
}

export interface Allocation {
  batchId: string;
  batchNumber: string;
  expiryDate: Date | null;
  quantity: number;
  unitCostMinor: number;
  movementId: string;
}

/**
 * The only code that changes stock. Every change locks the affected StockLevel rows (SELECT … FOR UPDATE)
 * and writes an append-only StockMovement with the resulting balance, in the caller's transaction.
 */
@Injectable()
export class StockEngine {
  async lockLevel(tx: ScopedTx, productId: string, batchId: string, locationId: string) {
    const orgId = RequestContext.orgId();
    await tx.$executeRaw`
      INSERT INTO "StockLevel" (id, "organizationId", "productId", "batchId", "locationId", quantity, "updatedAt")
      VALUES (gen_random_uuid(), ${orgId}::uuid, ${productId}::uuid, ${batchId}::uuid, ${locationId}::uuid, 0, now())
      ON CONFLICT ("batchId", "locationId") DO NOTHING`;
    const rows = (await tx.$queryRaw`
      SELECT id, quantity FROM "StockLevel"
      WHERE "batchId" = ${batchId}::uuid AND "locationId" = ${locationId}::uuid AND "organizationId" = ${orgId}::uuid
      FOR UPDATE`) as { id: string; quantity: Prisma.Decimal }[];
    return { id: rows[0].id, quantity: Number(rows[0].quantity) };
  }

  async move(tx: ScopedTx, m: MoveInput) {
    const ctx = RequestContext.require();
    const level = await this.lockLevel(tx, m.productId, m.batchId, m.locationId);
    const next = r4(level.quantity + m.delta);
    if (next < 0 && !m.allowNegative) {
      throw ruleViolation('INSUFFICIENT_STOCK', `Only ${level.quantity} available in this batch/location`, { available: level.quantity });
    }
    await tx.stockLevel.update({ where: { id: level.id }, data: { quantity: next } });
    return tx.stockMovement.create({
      data: {
        organizationId: ctx.organizationId!,
        branchId: m.branchId,
        productId: m.productId,
        batchId: m.batchId,
        locationId: m.locationId,
        type: m.type,
        quantity: r4(m.delta),
        balanceAfter: next,
        unitCostMinor: m.unitCostMinor,
        reason: m.reason,
        referenceType: m.referenceType,
        referenceId: m.referenceId,
        createdById: ctx.userId,
        createdByName: ctx.userName,
      },
    });
  }

  /**
   * Issues stock first-expiry-first-out from usable batches (available, not expired) at a location.
   * Expired, quarantined and recalled batches are never issued.
   */
  async issueFefo(
    tx: ScopedTx,
    e: { productId: string; locationId: string; branchId: string; quantity: number; type: MovementType; referenceType: string; referenceId: string; preferredBatchNumber?: string | null; allowNegative: boolean },
  ): Promise<Allocation[]> {
    const orgId = RequestContext.orgId();
    const rows = (await tx.$queryRaw`
      SELECT sl.id, sl."batchId", sl.quantity, b."batchNumber", b."expiryDate", b.status, b."receivedAt", b."unitCostMinor"
      FROM "StockLevel" sl JOIN "StockBatch" b ON b.id = sl."batchId"
      WHERE sl."productId" = ${e.productId}::uuid AND sl."locationId" = ${e.locationId}::uuid AND sl."organizationId" = ${orgId}::uuid
      FOR UPDATE OF sl`) as { id: string; batchId: string; quantity: Prisma.Decimal; batchNumber: string; expiryDate: Date | null; status: string; receivedAt: Date; unitCostMinor: number }[];
    const today = new Date(new Date().toISOString().slice(0, 10));
    if (e.preferredBatchNumber) {
      // A batch typed by the user must match stock on the shelf, or the dispensing record and ledger would disagree.
      const chosen = rows.find((r) => r.batchNumber === e.preferredBatchNumber);
      if (!chosen) throw ruleViolation('UNKNOWN_BATCH', `Batch ${e.preferredBatchNumber} is not in stock at this location. Leave the batch blank to issue first-expiry-first-out.`);
      if (chosen.status !== 'AVAILABLE' || (chosen.expiryDate && chosen.expiryDate < today)) throw ruleViolation('BATCH_UNUSABLE', `Batch ${e.preferredBatchNumber} is ${chosen.status !== 'AVAILABLE' ? chosen.status.toLowerCase() : 'expired'} and cannot be issued`);
    }
    const usable = rows
      .filter((r) => r.status === 'AVAILABLE' && (!r.expiryDate || r.expiryDate >= today) && Number(r.quantity) > 0)
      .sort((a, b) => {
        if (e.preferredBatchNumber) {
          if (a.batchNumber === e.preferredBatchNumber) return -1;
          if (b.batchNumber === e.preferredBatchNumber) return 1;
        }
        const ae = a.expiryDate?.getTime() ?? Infinity;
        const be = b.expiryDate?.getTime() ?? Infinity;
        return ae - be || a.receivedAt.getTime() - b.receivedAt.getTime();
      });
    let remaining = r4(e.quantity);
    const plan: { row: (typeof rows)[number]; qty: number }[] = [];
    for (const r of usable) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, Number(r.quantity));
      plan.push({ row: r, qty: r4(take) });
      remaining = r4(remaining - take);
    }
    if (remaining > 0) {
      const available = r4(e.quantity - remaining);
      if (!e.allowNegative || (!plan.length && !rows.length)) {
        throw ruleViolation('INSUFFICIENT_STOCK', `Insufficient usable stock: ${available} available, ${e.quantity} required`, { available, required: e.quantity });
      }
      // Negative stock permitted by the organization: book the shortfall against the newest batch.
      const fallback = plan[plan.length - 1]?.row ?? [...rows].sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())[0];
      const existing = plan.find((p) => p.row.id === fallback.id);
      if (existing) existing.qty = r4(existing.qty + remaining);
      else plan.push({ row: fallback, qty: remaining });
    }
    const out: Allocation[] = [];
    for (const p of plan) {
      const mv = await this.move(tx, {
        productId: e.productId,
        batchId: p.row.batchId,
        locationId: e.locationId,
        branchId: e.branchId,
        delta: -p.qty,
        type: e.type,
        unitCostMinor: p.row.unitCostMinor,
        referenceType: e.referenceType,
        referenceId: e.referenceId,
        allowNegative: e.allowNegative,
      });
      out.push({ batchId: p.row.batchId, batchNumber: p.row.batchNumber, expiryDate: p.row.expiryDate, quantity: p.qty, unitCostMinor: p.row.unitCostMinor, movementId: mv.id });
    }
    return out;
  }
}
