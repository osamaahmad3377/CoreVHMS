import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { LabTestInput } from '@vcms/shared';
import { AuditService } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { notFound, ruleViolation } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';

const dec = (d: Prisma.Decimal | null) => (d === null ? null : Number(d));

@Injectable()
export class LabCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(includeInactive = false, q?: string) {
    return this.prisma.db.labTest.findMany({
      where: {
        ...(includeInactive ? {} : { isActive: true }),
        ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { code: { contains: q, mode: 'insensitive' } }] } : {}),
      },
      include: { analytes: { orderBy: { sortOrder: 'asc' } } },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  }

  async get(id: string) {
    const t = await this.prisma.db.labTest.findUnique({
      where: { id },
      include: {
        analytes: {
          orderBy: { sortOrder: 'asc' },
          include: { intervals: { include: { species: { select: { id: true, name: true } } }, orderBy: [{ speciesId: 'asc' }, { sex: 'asc' }] } },
        },
      },
    });
    if (!t) throw notFound('Lab test');
    return {
      ...t,
      analytes: t.analytes.map((a) => ({
        ...a,
        intervals: a.intervals.map((i) => ({ ...i, low: dec(i.low), high: dec(i.high), criticalLow: dec(i.criticalLow), criticalHigh: dec(i.criticalHigh) })),
      })),
    };
  }

  private validate(input: Partial<LabTestInput>) {
    if (input.category === 'IMAGING' && input.analytes?.length) throw ruleViolation('IMAGING_ANALYTES', 'Imaging tests are reported as findings/conclusion, not analytes');
    if (input.category && input.category !== 'IMAGING' && input.analytes && input.analytes.length === 0) {
      throw ruleViolation('NO_ANALYTES', 'Add at least one result field (analyte)');
    }
    if (input.analytes) {
      const codes = input.analytes.map((a) => a.code.toUpperCase());
      if (new Set(codes).size !== codes.length) throw ruleViolation('DUPLICATE_ANALYTE', 'Analyte codes must be unique within a test');
      for (const a of input.analytes) if (a.resultType === 'OPTION' && !a.options.length) throw ruleViolation('NO_OPTIONS', `${a.name} needs at least one option`);
    }
    if (input.performedBy === 'EXTERNAL' && !input.externalLabName) throw ruleViolation('EXTERNAL_LAB', 'Name the external laboratory');
  }

  async create(input: LabTestInput) {
    this.validate(input);
    const orgId = RequestContext.orgId();
    const { analytes, ...data } = input;
    return this.prisma.db.$transaction(async (tx) => {
      const t = await tx.labTest.create({ data: { ...data, organizationId: orgId } });
      if (analytes.length) {
        await tx.labAnalyte.createMany({
          data: analytes.map((a, i) => ({ code: a.code.toUpperCase(), name: a.name, unit: a.unit, resultType: a.resultType, options: a.options, decimals: a.decimals, sortOrder: i, testId: t.id, organizationId: orgId })),
        });
      }
      await this.audit.record({ action: 'lab_test.created', entityType: 'LabTest', entityId: t.id, summary: `${t.code} ${t.name}` }, tx);
      return this.getTx(tx, t.id);
    });
  }

  private getTx(tx: any, id: string) {
    return tx.labTest.findUnique({ where: { id }, include: { analytes: { orderBy: { sortOrder: 'asc' } } } });
  }

  /** Updates a test. Analytes with results can be renamed but not removed (results must keep their meaning). */
  async update(id: string, input: Partial<LabTestInput>) {
    const existing = await this.prisma.db.labTest.findUnique({ where: { id }, include: { analytes: { include: { _count: { select: { results: true } } } } } });
    if (!existing) throw notFound('Lab test');
    this.validate({ ...input, category: input.category ?? existing.category });
    const { analytes, ...data } = input;
    const orgId = RequestContext.orgId();
    return this.prisma.db.$transaction(async (tx) => {
      await tx.labTest.update({ where: { id }, data });
      if (analytes) {
        const keep = new Set(analytes.filter((a) => a.id).map((a) => a.id!));
        for (const old of existing.analytes) {
          if (!keep.has(old.id)) {
            if (old._count.results > 0) throw ruleViolation('ANALYTE_IN_USE', `${old.name} has recorded results and cannot be removed`);
            await tx.labAnalyte.delete({ where: { id: old.id } });
          }
        }
        for (const [i, a] of analytes.entries()) {
          const data = { code: a.code.toUpperCase(), name: a.name, unit: a.unit, resultType: a.resultType, options: a.options, decimals: a.decimals, sortOrder: i };
          if (a.id) {
            if (!existing.analytes.some((x) => x.id === a.id)) throw ruleViolation('INVALID_ANALYTE', 'Analyte does not belong to this test');
            await tx.labAnalyte.update({ where: { id: a.id }, data });
          } else {
            await tx.labAnalyte.create({ data: { ...data, testId: id, organizationId: orgId } });
          }
        }
      }
      await this.audit.record({ action: 'lab_test.updated', entityType: 'LabTest', entityId: id, summary: existing.name }, tx);
      return this.getTx(tx, id);
    });
  }

  async addInterval(input: {
    analyteId: string;
    speciesId: string;
    sex?: any;
    ageMinMonths?: number | null;
    ageMaxMonths?: number | null;
    low?: number | null;
    high?: number | null;
    criticalLow?: number | null;
    criticalHigh?: number | null;
    source: string;
  }) {
    const ctx = RequestContext.require();
    const analyte = await this.prisma.db.labAnalyte.findUnique({ where: { id: input.analyteId }, include: { test: true } });
    if (!analyte) throw notFound('Analyte');
    if (analyte.resultType !== 'NUMERIC') throw ruleViolation('NOT_NUMERIC', 'Reference intervals apply to numeric results only');
    if (!(await this.prisma.db.species.findUnique({ where: { id: input.speciesId } }))) throw ruleViolation('INVALID_SPECIES', 'Species not found');
    return this.prisma.db.$transaction(async (tx) => {
      const i = await tx.referenceInterval.create({ data: { ...input, organizationId: ctx.organizationId!, reviewedByName: ctx.userName, reviewedAt: new Date() } });
      await this.audit.record(
        { action: 'reference_interval.added', entityType: 'LabTest', entityId: analyte.testId, summary: `${analyte.name}: ${input.low ?? '–'}–${input.high ?? '–'} ${analyte.unit ?? ''} (${input.source})` },
        tx,
      );
      return i;
    });
  }

  async removeInterval(id: string) {
    const i = await this.prisma.db.referenceInterval.findUnique({ where: { id }, include: { analyte: true } });
    if (!i) throw notFound('Reference interval');
    await this.prisma.db.$transaction(async (tx) => {
      await tx.referenceInterval.delete({ where: { id } });
      await this.audit.record({ action: 'reference_interval.removed', entityType: 'LabTest', entityId: i.analyte.testId, summary: i.analyte.name }, tx);
    });
  }
}
