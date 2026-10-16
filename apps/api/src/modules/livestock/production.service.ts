import { Injectable } from '@nestjs/common';
import { Prisma, ProductionKind } from '@prisma/client';
import { PRODUCTION_UNITS } from '@vcms/shared';
import type { z } from 'zod';
import type { milkSheetSchema, productionSchema } from '@vcms/shared';
import { AuditService } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { notFound, ruleViolation } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';

const dateOnly = (d: Date) => new Date(d.toISOString().slice(0, 10));

/** Milk, eggs, feed, batch weights and batch mortality records. */
@Injectable()
export class ProductionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async validate(farmId: string, patientId?: string | null, groupId?: string | null) {
    const farm = await this.prisma.db.farm.findUnique({ where: { id: farmId } });
    if (!farm) throw notFound('Farm');
    const group = groupId ? await this.prisma.db.animalGroup.findUnique({ where: { id: groupId } }) : null;
    if (groupId && (!group || group.farmId !== farmId)) throw ruleViolation('GROUP_FARM', 'That group is not on this farm');
    if (patientId) {
      const p = await this.prisma.db.patient.findUnique({ where: { id: patientId } });
      if (!p || p.farmId !== farmId) throw ruleViolation('PATIENT_FARM', 'That animal is not on this farm');
    }
    return { farm, group };
  }

  async record(input: z.infer<typeof productionSchema>) {
    const { group } = await this.validate(input.farmId, input.patientId, input.groupId);
    if (input.recordedOn.getTime() > Date.now() + 86400_000) throw ruleViolation('FUTURE_DATE', 'Production is recorded for today or earlier');
    if (['BATCH_WEIGHT', 'MORTALITY'].includes(input.kind) && group?.tracksIndividuals) throw ruleViolation('INDIVIDUAL_GROUP', 'For individually registered animals record deaths as movements and weights on the animal');
    const ctx = RequestContext.require();
    return this.prisma.db.$transaction(async (tx) => {
      if (input.kind === 'MORTALITY') {
        // Lock the batch so the head count stays consistent with recorded mortality.
        const rows = (await tx.$queryRaw`SELECT "headCount" FROM "AnimalGroup" WHERE id = ${group!.id}::uuid AND "organizationId" = ${ctx.organizationId}::uuid FOR UPDATE`) as { headCount: number }[];
        if (input.quantity > rows[0].headCount) throw ruleViolation('INSUFFICIENT_HEAD', `Only ${rows[0].headCount} head in ${group!.name}`);
        await tx.animalGroup.update({ where: { id: group!.id }, data: { headCount: { decrement: input.quantity } } });
      }
      const r = await tx.productionRecord.create({
        data: {
          organizationId: ctx.organizationId!,
          farmId: input.farmId,
          patientId: input.patientId ?? null,
          groupId: input.groupId ?? null,
          kind: input.kind,
          recordedOn: dateOnly(input.recordedOn),
          quantity: input.quantity,
          unit: input.unit || PRODUCTION_UNITS[input.kind],
          session: input.session,
          notes: input.notes,
          recordedById: ctx.userId,
          recordedByName: ctx.userName ?? 'Unknown',
        },
      });
      if (input.kind === 'MORTALITY') await this.audit.record({ action: 'livestock.mortality', entityType: 'Farm', entityId: input.farmId, summary: `${input.quantity} dead in ${group!.name}` }, tx);
      return shape(r);
    });
  }

  async milkSheet(input: z.infer<typeof milkSheetSchema>) {
    const farm = await this.prisma.db.farm.findUnique({ where: { id: input.farmId } });
    if (!farm) throw notFound('Farm');
    const ids = [...new Set(input.entries.map((e) => e.patientId))];
    if (ids.length !== input.entries.length) throw ruleViolation('DUPLICATE_ENTRY', 'Each animal can appear once per sheet');
    const animals = await this.prisma.db.patient.findMany({ where: { id: { in: ids } }, select: { id: true, farmId: true, sex: true } });
    if (animals.length !== ids.length || animals.some((a) => a.farmId !== input.farmId)) throw ruleViolation('PATIENT_FARM', 'Every animal must be on this farm');
    const ctx = RequestContext.require();
    const rows = input.entries.filter((e) => e.quantity > 0);
    await this.prisma.db.productionRecord.createMany({
      data: rows.map((e) => ({ organizationId: ctx.organizationId!, farmId: input.farmId, patientId: e.patientId, kind: 'MILK' as ProductionKind, recordedOn: dateOnly(input.recordedOn), quantity: e.quantity, unit: 'L', session: input.session, recordedById: ctx.userId, recordedByName: ctx.userName ?? 'Unknown' })),
    });
    return { recorded: rows.length, totalLitres: Math.round(rows.reduce((n, e) => n + e.quantity, 0) * 10) / 10 };
  }

  async void(id: string, reason: string) {
    const r = await this.prisma.db.productionRecord.findUnique({ where: { id } });
    if (!r) throw notFound('Production record');
    if (r.voidedAt) throw ruleViolation('ALREADY_VOIDED', 'This record was already voided');
    const ctx = RequestContext.require();
    return this.prisma.db.$transaction(async (tx) => {
      if (r.kind === 'MORTALITY' && r.groupId) await tx.animalGroup.update({ where: { id: r.groupId }, data: { headCount: { increment: Number(r.quantity) } } });
      const after = await tx.productionRecord.update({ where: { id }, data: { voidedAt: new Date(), voidReason: reason, voidedByName: ctx.userName } });
      await this.audit.record({ action: 'production.voided', entityType: 'Farm', entityId: r.farmId, summary: `${r.kind.toLowerCase()} ${Number(r.quantity)} ${r.unit} on ${r.recordedOn.toISOString().slice(0, 10)}: ${reason}` }, tx);
      return shape(after);
    });
  }

  async list(q: { farmId?: string; kind?: ProductionKind; groupId?: string; patientId?: string; from?: Date; to?: Date; includeVoided?: boolean }) {
    const where: Prisma.ProductionRecordWhereInput = {
      farmId: q.farmId,
      kind: q.kind,
      groupId: q.groupId,
      patientId: q.patientId,
      voidedAt: q.includeVoided ? undefined : null,
      recordedOn: q.from || q.to ? { gte: q.from ? dateOnly(q.from) : undefined, lte: q.to ? dateOnly(q.to) : undefined } : undefined,
    };
    const rows = await this.prisma.db.productionRecord.findMany({
      where,
      include: { patient: { select: { id: true, name: true } }, group: { select: { id: true, name: true } } },
      orderBy: [{ recordedOn: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });
    return rows.map(shape);
  }

  /** Daily totals per kind for charts. */
  async daily(farmId: string, from: Date, to: Date, groupId?: string) {
    const rows = await this.prisma.db.productionRecord.groupBy({
      by: ['recordedOn', 'kind'],
      where: { farmId, groupId, voidedAt: null, recordedOn: { gte: dateOnly(from), lte: dateOnly(to) } },
      _sum: { quantity: true },
      orderBy: { recordedOn: 'asc' },
    });
    const days = new Map<string, Record<string, number | string>>();
    for (const r of rows) {
      const d = r.recordedOn.toISOString().slice(0, 10);
      const e = days.get(d) ?? { date: d };
      e[r.kind] = Math.round(Number(r._sum.quantity ?? 0) * 100) / 100;
      days.set(d, e);
    }
    return [...days.values()];
  }
}

function shape<T extends { quantity: Prisma.Decimal }>(r: T) {
  return { ...r, quantity: Number(r.quantity) };
}
