import { Injectable } from '@nestjs/common';
import type { z } from 'zod';
import type { groupTreatmentSchema, outbreakSchema, updateOutbreakSchema } from '@vcms/shared';
import { AuditService, diff } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { CounterService, formatNumber } from '../../common/counter/counter.service';
import { notFound, ruleViolation } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ChargeCaptureService } from '../billing/charge-capture.service';
import { InventoryService } from '../inventory/inventory.service';
import { WithdrawalService } from '../pharmacy/withdrawal.service';
import { FarmsService } from './farms.service';

export const outbreakNo = (n: number) => formatNumber('OB', n, 5);
const DAY = 86400_000;

/** Group treatments/campaigns (with stock, billing and food-safety withdrawal) and disease outbreaks. */
@Injectable()
export class HerdHealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly counters: CounterService,
    private readonly charges: ChargeCaptureService,
    private readonly inventory: InventoryService,
    private readonly withdrawals: WithdrawalService,
    private readonly farms: FarmsService,
  ) {}

  // ── Group treatments ──

  async treat(input: z.infer<typeof groupTreatmentSchema>) {
    const ctx = RequestContext.require();
    const farm = await this.farms.farmOrThrow(input.farmId);
    const group = input.groupId ? await this.prisma.db.animalGroup.findUnique({ where: { id: input.groupId } }) : null;
    if (input.groupId && (!group || group.farmId !== farm.id || group.status !== 'ACTIVE')) throw ruleViolation('GROUP_FARM', 'That group is not active on this farm');
    if (group) {
      const pop = await this.farms.population(this.prisma.db, group);
      if (input.headCount > pop) throw ruleViolation('HEAD_COUNT', `${group.name} has only ${pop} head`);
    }
    const product = input.productId ? await this.prisma.db.product.findUnique({ where: { id: input.productId } }) : null;
    if (input.productId && (!product || !product.isActive)) throw ruleViolation('INVALID_PRODUCT', 'Product not found or inactive');
    if (input.administeredAt.getTime() > Date.now() + 3600_000) throw ruleViolation('FUTURE_DATE', 'Treatments are recorded after they are given');
    const visit = input.fieldVisitId ? await this.prisma.db.fieldVisit.findUnique({ where: { id: input.fieldVisitId } }) : null;
    if (input.fieldVisitId && (!visit || visit.farmId !== farm.id)) throw ruleViolation('INVALID_VISIT', 'That field visit is not for this farm');
    if (visit && ['COMPLETED', 'CANCELLED'].includes(visit.status)) throw ruleViolation('VISIT_CLOSED', 'That field visit is already closed');
    if (!ctx.branchId && !visit) throw ruleViolation('NO_BRANCH', 'Select a branch first');
    const branchId = visit?.branchId ?? ctx.branchId!;

    // Withdrawal for the group's species from the product's configured, sourced periods.
    const w = product && group ? await this.prisma.db.productWithdrawal.findFirst({ where: { productId: product.id, speciesId: group.speciesId } }) : null;
    const at = input.administeredAt;
    const clear = {
      meatClearAt: w?.meatDays != null ? new Date(at.getTime() + w.meatDays * DAY) : null,
      milkClearAt: w?.milkHours != null ? new Date(at.getTime() + w.milkHours * 3600_000) : null,
      eggClearAt: w?.eggDays != null ? new Date(at.getTime() + w.eggDays * DAY) : null,
    };

    return this.prisma.db.$transaction(
      async (tx) => {
        const t = await tx.groupTreatment.create({
          data: {
            organizationId: ctx.organizationId!,
            farmId: farm.id,
            groupId: group?.id ?? null,
            fieldVisitId: visit?.id ?? null,
            kind: input.kind,
            productId: product?.id ?? null,
            productName: product?.name ?? input.productName!,
            batchNumber: input.batchNumber,
            route: input.route,
            dosePerHead: input.dosePerHead,
            headCount: input.headCount,
            quantityIssued: input.quantityIssued ?? null,
            administeredAt: at,
            ...clear,
            withdrawalSource: w?.source ?? null,
            notes: input.notes,
            administeredById: ctx.userId,
            administeredByName: ctx.userName ?? 'Unknown',
          },
        });
        // Individually registered animals each get their own withdrawal record, visible on their record.
        let animalsRecorded = 0;
        if (product && group?.tracksIndividuals) {
          const members = await tx.patient.findMany({ where: { groupId: group.id, status: 'ACTIVE' }, select: { id: true, speciesId: true }, take: input.headCount });
          for (const m of members) {
            const r = await this.withdrawals.record(tx, { patientId: m.id, speciesId: m.speciesId, productId: product.id, sourceType: 'GROUP_TREATMENT', sourceId: t.id, treatedAt: at });
            if (r) animalsRecorded++;
          }
        }
        if (product && input.quantityIssued) {
          await this.inventory.issueForEvent(tx, { productId: product.id, quantity: input.quantityIssued, branchId, type: 'ADMINISTER', referenceType: 'GroupTreatment', referenceId: t.id, preferredBatchNumber: input.batchNumber });
          if (input.charge) {
            await this.charges.capture(tx, {
              sourceType: 'GroupTreatment',
              sourceId: t.id,
              clientId: farm.clientId,
              branchId,
              kind: 'PRODUCT',
              productId: product.id,
              description: `${product.name} — ${input.kind.toLowerCase().replace('_', ' ')} of ${input.headCount} head${group ? ` (${group.name})` : ''}`,
              quantity: input.quantityIssued,
              unitPriceMinor: product.sellPriceMinor ?? 0,
              taxRateBasisPoints: await this.charges.taxFor(tx, product.taxRateId),
            });
          }
        }
        await this.audit.record({ action: 'livestock.group_treatment', entityType: 'Farm', entityId: farm.id, summary: `${t.productName} × ${t.headCount} head${group ? ` (${group.name})` : ''}` }, tx);
        return { ...t, quantityIssued: t.quantityIssued === null ? null : Number(t.quantityIssued), animalsWithWithdrawal: animalsRecorded, withdrawalConfigured: !!w };
      },
      { timeout: 60_000 },
    );
  }

  async treatments(q: { farmId?: string; groupId?: string; fieldVisitId?: string }) {
    const rows = await this.prisma.db.groupTreatment.findMany({
      where: { farmId: q.farmId, groupId: q.groupId, fieldVisitId: q.fieldVisitId },
      include: { group: { select: { id: true, name: true } } },
      orderBy: { administeredAt: 'desc' },
      take: 300,
    });
    return rows.map((r) => ({ ...r, quantityIssued: r.quantityIssued === null ? null : Number(r.quantityIssued) }));
  }

  // ── Disease outbreaks ──

  async outbreaks(q: { farmId?: string; status?: string }) {
    const rows = await this.prisma.db.diseaseOutbreak.findMany({
      where: { farmId: q.farmId, status: q.status === 'OPEN' ? { in: ['SUSPECTED', 'CONFIRMED', 'CONTROLLED'] } : (q.status as any) || undefined },
      include: { farm: { select: { id: true, name: true, district: true } }, group: { select: { id: true, name: true } } },
      orderBy: [{ firstSeenOn: 'desc' }],
      take: 300,
    });
    return rows.map((o) => ({ ...o, outbreakNo: outbreakNo(o.number) }));
  }

  async createOutbreak(input: z.infer<typeof outbreakSchema>) {
    await this.farms.farmOrThrow(input.farmId);
    if (input.groupId) {
      const g = await this.prisma.db.animalGroup.findUnique({ where: { id: input.groupId } });
      if (!g || g.farmId !== input.farmId) throw ruleViolation('GROUP_FARM', 'That group is not on this farm');
    }
    this.checkCounts(input.affectedCount, input.deathCount);
    const ctx = RequestContext.require();
    return this.prisma.db.$transaction(async (tx) => {
      const number = await this.counters.next(tx, 'outbreak');
      const o = await tx.diseaseOutbreak.create({
        data: { ...input, organizationId: ctx.organizationId!, number, confirmedOn: input.confirmedOn ?? (input.status === 'CONFIRMED' ? input.firstSeenOn : null), closedOn: input.status === 'CLOSED' ? new Date() : null, createdByName: ctx.userName },
      });
      await this.audit.record({ action: 'outbreak.reported', entityType: 'Farm', entityId: input.farmId, summary: `${outbreakNo(number)} ${o.disease}${o.notifiable ? ' (notifiable)' : ''}` }, tx);
      return { ...o, outbreakNo: outbreakNo(number) };
    });
  }

  private checkCounts(affected?: number, deaths?: number) {
    if (affected != null && deaths != null && deaths > affected) throw ruleViolation('DEATHS_EXCEED_AFFECTED', 'Deaths cannot exceed the number of affected animals');
  }

  async updateOutbreak(id: string, input: z.infer<typeof updateOutbreakSchema>) {
    const before = await this.prisma.db.diseaseOutbreak.findUnique({ where: { id } });
    if (!before) throw notFound('Outbreak');
    this.checkCounts(input.affectedCount ?? before.affectedCount, input.deathCount ?? before.deathCount);
    if (input.affectedCount != null && input.affectedCount < before.affectedCount) throw ruleViolation('COUNT_DECREASE', 'Affected count can only go up; note corrections in the notes');
    if (input.deathCount != null && input.deathCount < before.deathCount) throw ruleViolation('COUNT_DECREASE', 'Death count can only go up; note corrections in the notes');
    const status = input.status ?? before.status;
    const data = {
      ...input,
      confirmedOn: input.confirmedOn ?? (status === 'CONFIRMED' && !before.confirmedOn ? new Date() : undefined),
      closedOn: status === 'CLOSED' ? input.closedOn ?? before.closedOn ?? new Date() : status !== before.status ? null : undefined,
    };
    return this.prisma.db.$transaction(async (tx) => {
      const after = await tx.diseaseOutbreak.update({ where: { id }, data });
      await this.audit.record({ action: status !== before.status ? `outbreak.${status.toLowerCase()}` : 'outbreak.updated', entityType: 'Farm', entityId: before.farmId, summary: `${outbreakNo(before.number)} ${before.disease}`, changes: diff(before, after, Object.keys(input)) }, tx);
      return { ...after, outbreakNo: outbreakNo(after.number) };
    });
  }
}
