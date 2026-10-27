import { Injectable, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import type { Plan } from '@prisma/client';
import { DEFAULT_PLANS, type PlanFeature, type PlanInput, type PlatformPlan } from '@vcms/shared';
import { AuditService } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { conflict, notFound, ruleViolation } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { multiClinic } from '../../common/tenancy/hosts';
import { TenancyService } from '../../common/tenancy/tenancy.service';

const toPlan = (p: Plan, clinicCount: number): PlatformPlan => ({
  id: p.id,
  name: p.name,
  description: p.description,
  priceMonthlyMinor: p.priceMonthlyMinor,
  currency: p.currency,
  maxStaff: p.maxStaff,
  maxBranches: p.maxBranches,
  maxAutomations: p.maxAutomations,
  features: p.features as PlanFeature[],
  isActive: p.isActive,
  sortOrder: p.sortOrder,
  clinicCount,
});

/** Super admin: the plans clinics can be put on. They live in the platform database. */
@Injectable()
export class PlatformPlansService implements OnApplicationBootstrap {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tenancy: TenancyService,
  ) {}

  private assertPlatform() {
    if (!multiClinic() || !RequestContext.get()?.platform) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Multi-clinic hosting is not switched on' });
    }
  }

  async onApplicationBootstrap() {
    if (multiClinic() && process.env.NODE_ENV !== 'test') await this.ensureDefaults().catch(() => undefined);
  }

  /** The first time (an empty table) the starter plans are created so the super admin has something to start from. */
  async ensureDefaults() {
    if (await this.prisma.control.plan.count()) return;
    await this.prisma.control.plan.createMany({ data: DEFAULT_PLANS.map((p) => ({ ...p, currency: 'PKR', isActive: true })), skipDuplicates: true });
    this.tenancy.forgetOffers();
  }

  async list() {
    this.assertPlatform();
    await this.ensureDefaults();
    const [plans, counts] = await Promise.all([
      this.prisma.control.plan.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      this.prisma.control.tenant.groupBy({ by: ['planId'], _count: { _all: true } }),
    ]);
    const byPlan = new Map(counts.map((c) => [c.planId, c._count._all]));
    return plans.map((p) => toPlan(p, byPlan.get(p.id) ?? 0));
  }

  private async find(id: string) {
    this.assertPlatform();
    const p = await this.prisma.control.plan.findUnique({ where: { id } });
    if (!p) throw notFound('Plan');
    return p;
  }

  async create(input: PlanInput) {
    this.assertPlatform();
    if (await this.prisma.control.plan.findUnique({ where: { name: input.name } })) throw conflict('A plan with this name already exists');
    const plan = await this.prisma.control.$transaction(async (tx) => {
      const p = await tx.plan.create({ data: input });
      await this.audit.record({ action: 'platform.plan_created', entityType: 'Plan', entityId: p.id, summary: p.name, organizationId: null }, tx);
      return p;
    });
    this.tenancy.forgetOffers();
    return toPlan(plan, 0);
  }

  /**
   * Changes a plan for every clinic on it. Existing staff and branches are never removed: a clinic above a lowered
   * limit keeps what it has but cannot add more.
   */
  async update(id: string, input: PlanInput) {
    const before = await this.find(id);
    const clash = await this.prisma.control.plan.findFirst({ where: { name: input.name, id: { not: id } } });
    if (clash) throw conflict('A plan with this name already exists');
    const clinics = await this.prisma.control.tenant.findMany({ where: { planId: id }, select: { slug: true } });
    const after = await this.prisma.control.$transaction(async (tx) => {
      const p = await tx.plan.update({ where: { id }, data: input });
      await this.audit.record(
        {
          action: 'platform.plan_updated',
          entityType: 'Plan',
          entityId: id,
          summary: `${p.name} (${clinics.length} clinic${clinics.length === 1 ? '' : 's'})`,
          changes: {
            maxStaff: { from: before.maxStaff, to: p.maxStaff },
            maxBranches: { from: before.maxBranches, to: p.maxBranches },
            maxAutomations: { from: before.maxAutomations, to: p.maxAutomations },
            features: { from: before.features, to: p.features },
            isActive: { from: before.isActive, to: p.isActive },
            priceMonthlyMinor: { from: before.priceMonthlyMinor, to: p.priceMonthlyMinor },
          },
          organizationId: null,
        },
        tx,
      );
      return p;
    });
    clinics.forEach((c) => this.tenancy.forget(c.slug));
    this.tenancy.forgetOffers();
    return toPlan(after, clinics.length);
  }

  /** Only a plan no clinic is on can be deleted; otherwise switch it off so no new clinic picks it. */
  async remove(id: string) {
    const p = await this.find(id);
    const used = await this.prisma.control.tenant.count({ where: { planId: id } });
    if (used) throw ruleViolation('PLAN_IN_USE', `${used} clinic${used === 1 ? ' is' : 's are'} on this plan. Move them to another plan first, or switch the plan off instead.`);
    await this.prisma.control.$transaction(async (tx) => {
      await tx.plan.delete({ where: { id } });
      await this.audit.record({ action: 'platform.plan_deleted', entityType: 'Plan', entityId: id, summary: p.name, organizationId: null }, tx);
    });
    this.tenancy.forgetOffers();
  }
}
