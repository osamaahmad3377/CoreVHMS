import { Injectable } from '@nestjs/common';
import { Organization, ServiceCategory } from '@prisma/client';
import { AuditService, diff } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { assertDeletable, deleteOrExplain, deletionCheck, usage } from '../../common/deletion/deletion';
import { notFound } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';

const SERVICE_INSTEAD = 'Switch it off instead (untick “Active”) — it disappears from price lists and its history is kept.';

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
      include: { taxRate: { select: { id: true, name: true, rateBasisPoints: true } }, appointmentTypes: { where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } } },
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

  /** Charges, invoices, set-up and records that use the service — any of it means it is switched off, not deleted. */
  private async serviceHistory(id: string) {
    const db = this.prisma.db;
    const org = await this.prisma.raw.organization.findUniqueOrThrow({ where: { id: RequestContext.orgId() }, select: { homeVisitCalloutServiceId: true, homeVisitPerKmServiceId: true } });
    const where = { serviceId: id };
    const used = await usage([
      ['charge', 'charges', db.charge.count({ where })],
      ['invoice line', 'invoice lines', db.invoiceLine.count({ where })],
      ['estimate line', 'estimate lines', db.estimateLine.count({ where })],
      ['appointment type', 'appointment types', db.appointmentType.count({ where })],
      ['hospital ward', 'hospital wards', db.ward.count({ where: { dailyServiceId: id } })],
      ['boarding kennel', 'boarding kennels', db.boardingUnit.count({ where: { nightlyServiceId: id } })],
      ['boarding stay', 'boarding stays', db.boardingStay.count({ where: { nightlyServiceId: id } })],
      ['grooming job', 'grooming jobs', db.groomingJobService.count({ where })],
      ['surgery', 'surgeries', db.surgery.count({ where })],
      ['farm visit', 'farm visits', db.fieldVisit.count({ where: { calloutServiceId: id } })],
      ['farm visit item', 'farm visit items', db.fieldVisitItem.count({ where })],
      ['wellness plan item', 'wellness plan items', db.wellnessPlanItem.count({ where })],
      ['wellness allowance', 'wellness allowances', db.wellnessEntitlement.count({ where })],
      ['dental procedure', 'dental procedures', db.dentalProcedure.count({ where })],
      ['dental price', 'dental prices', db.dentalProcedurePrice.count({ where })],
    ]);
    if (org.homeVisitCalloutServiceId === id || org.homeVisitPerKmServiceId === id) used.push('the home-visit fees (Settings → Home visits)');
    return used;
  }

  async serviceDeletionCheck(id: string) {
    if (!(await this.prisma.db.service.findUnique({ where: { id }, select: { id: true } }))) throw notFound('Service');
    return deletionCheck(await this.serviceHistory(id), SERVICE_INSTEAD);
  }

  /** Deletes a service added by mistake: never charged, and not set up anywhere. */
  async removeService(id: string) {
    const s = await this.prisma.db.service.findUnique({ where: { id } });
    if (!s) throw notFound('Service');
    assertDeletable(s.name, deletionCheck(await this.serviceHistory(id), SERVICE_INSTEAD));
    await this.prisma.db.$transaction(async (tx) => {
      await deleteOrExplain(s.name, SERVICE_INSTEAD, () => tx.service.delete({ where: { id } }));
      await this.audit.record({ action: 'service.deleted', entityType: 'Service', entityId: id, summary: `${s.code} ${s.name} deleted — never used` }, tx);
    });
    return { ok: true };
  }

  async settings() {
    return this.view(await this.prisma.raw.organization.findUniqueOrThrow({ where: { id: RequestContext.orgId() } }));
  }

  private view(o: Organization) {
    return { currency: o.currency, allowNegativeStock: o.allowNegativeStock, pricesIncludeTax: o.pricesIncludeTax, paymentTermsDays: o.paymentTermsDays, requireCashSession: o.requireCashSession, poRequiresSecondApprover: o.poRequiresSecondApprover, sellWithoutPrescription: o.sellWithoutPrescription };
  }

  async updateSettings(input: Partial<{ allowNegativeStock: boolean; pricesIncludeTax: boolean; paymentTermsDays: number; requireCashSession: boolean; poRequiresSecondApprover: boolean; sellWithoutPrescription: boolean }>) {
    const id = RequestContext.orgId();
    return this.prisma.raw.$transaction(async (tx) => {
      const before = await tx.organization.findUniqueOrThrow({ where: { id } });
      const after = await tx.organization.update({ where: { id }, data: input });
      await this.audit.record({ action: 'billing_settings.updated', entityType: 'Organization', entityId: id, changes: diff(before, after, Object.keys(input)) }, tx);
      // Built from the updated row: a read outside this transaction would still see the old values.
      return this.view(after);
    });
  }
}
