import { Injectable } from '@nestjs/common';
import { ServiceCategory } from '@prisma/client';
import { AuditService, diff } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { notFound } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class BillingConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  taxRates() {
    return this.prisma.db.taxRate.findMany({ orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] });
  }

  async saveTaxRate(id: string | null, input: { name: string; rateBasisPoints: number; isDefault: boolean; isActive: boolean }) {
    return this.prisma.db.$transaction(async (tx) => {
      if (input.isDefault) await tx.taxRate.updateMany({ where: { id: id ? { not: id } : undefined }, data: { isDefault: false } });
      const before = id ? await tx.taxRate.findUnique({ where: { id } }) : null;
      if (id && !before) throw notFound('Tax rate');
      const t = id ? await tx.taxRate.update({ where: { id }, data: input }) : await tx.taxRate.create({ data: { ...input, organizationId: RequestContext.orgId() } });
      await this.audit.record({ action: id ? 'tax_rate.updated' : 'tax_rate.created', entityType: 'TaxRate', entityId: t.id, summary: `${t.name} ${t.rateBasisPoints / 100}%`, changes: before ? diff(before, t, Object.keys(input)) : undefined }, tx);
      return t;
    });
  }

  services(includeInactive = false, q?: string) {
    return this.prisma.db.service.findMany({
      where: { ...(includeInactive ? {} : { isActive: true }), ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { code: { contains: q, mode: 'insensitive' } }] } : {}) },
      include: { taxRate: { select: { id: true, name: true, rateBasisPoints: true } } },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  }

  async saveService(id: string | null, input: { code: string; name: string; category: ServiceCategory; priceMinor: number; taxRateId?: string | null; isActive: boolean }) {
    return this.prisma.db.$transaction(async (tx) => {
      if (input.taxRateId && !(await tx.taxRate.findUnique({ where: { id: input.taxRateId } }))) throw notFound('Tax rate');
      const before = id ? await tx.service.findUnique({ where: { id } }) : null;
      if (id && !before) throw notFound('Service');
      const s = id ? await tx.service.update({ where: { id }, data: input }) : await tx.service.create({ data: { ...input, organizationId: RequestContext.orgId() } });
      await this.audit.record({ action: id ? 'service.updated' : 'service.created', entityType: 'Service', entityId: s.id, summary: `${s.code} ${s.name}`, changes: before ? diff(before, s, Object.keys(input)) : undefined }, tx);
      return s;
    });
  }

  async settings() {
    const o = await this.prisma.raw.organization.findUniqueOrThrow({ where: { id: RequestContext.orgId() } });
    return { currency: o.currency, allowNegativeStock: o.allowNegativeStock, pricesIncludeTax: o.pricesIncludeTax, paymentTermsDays: o.paymentTermsDays, requireCashSession: o.requireCashSession };
  }

  async updateSettings(input: Partial<{ allowNegativeStock: boolean; pricesIncludeTax: boolean; paymentTermsDays: number; requireCashSession: boolean }>) {
    const id = RequestContext.orgId();
    return this.prisma.raw.$transaction(async (tx) => {
      const before = await tx.organization.findUniqueOrThrow({ where: { id } });
      const after = await tx.organization.update({ where: { id }, data: input });
      await this.audit.record({ action: 'billing_settings.updated', entityType: 'Organization', entityId: id, changes: diff(before, after, Object.keys(input)) }, tx);
      return this.settings();
    });
  }
}
