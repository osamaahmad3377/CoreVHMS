import { Injectable, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import type { Plan } from '@prisma/client';
import { DEFAULT_PLANS, recommendedPlanMapping, type PlanFeature, type PlanInput, type PlatformPlan } from '@vcms/shared';
import { AuditService } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { conflict, notFound, ruleViolation } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { multiClinic } from '../../common/tenancy/hosts';
import { TenancyService, planOffer } from '../../common/tenancy/tenancy.service';

const toPlan = (p: Plan, clinicCount: number): PlatformPlan => ({
  ...planOffer(p),
  features: p.features as PlanFeature[],
  isActive: p.isActive,
  sortOrder: p.sortOrder,
  clinicCount,
});

/** The fields whose before/after the history keeps when a plan changes. */
const TRACKED = ['name', 'priceMonthlyMinor', 'priceYearlyMinor', 'maxStaff', 'maxBranches', 'maxAutomations', 'maxCustomAutomations', 'extraBranchMinor', 'extraStaffMinor', 'storageGb', 'extraStorageMinor', 'trialDays', 'supportResponse', 'whatsappSupport', 'phoneSupport', 'trainingSessions', 'features', 'isActive'] as const;
const changesOf = (before: Partial<Plan>, after: Partial<Plan>) =>
  Object.fromEntries(TRACKED.filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null)).map((k) => [k, { from: before[k] ?? null, to: after[k] ?? null }]));

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
          changes: changesOf(before, p),
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

  /**
   * Brings the plans in line with the recommended Starter, Professional and Premium (prices, limits and features).
   * A plan with the same name is updated; the others take over the remaining active plans in order, so clinics on
   * them move with their plan (Clinic → Professional, Hospital → Premium). Other plans are left as they are.
   */
  async applyRecommended() {
    this.assertPlatform();
    const existing = await this.prisma.control.plan.findMany();
    const rows = recommendedPlanMapping(existing);
    const touched = rows.flatMap((r) => (r.replaces ? [r.replaces.id] : []));
    const clinics = await this.prisma.control.tenant.findMany({ where: { planId: { in: touched } }, select: { slug: true } });
    await this.prisma.control.$transaction(async (tx) => {
      for (const { recommended, replaces } of rows) {
        const data = { ...recommended, currency: 'PKR', isActive: true };
        if (replaces) {
          await tx.plan.update({ where: { id: replaces.id }, data });
          await this.audit.record(
            {
              action: 'platform.plan_updated',
              entityType: 'Plan',
              entityId: replaces.id,
              summary: `${replaces.name === recommended.name ? recommended.name : `${replaces.name} → ${recommended.name}`} (recommended plans)`,
              changes: changesOf(replaces, { ...recommended, isActive: true } as Partial<Plan>),
              organizationId: null,
            },
            tx,
          );
        } else {
          const p = await tx.plan.create({ data });
          await this.audit.record({ action: 'platform.plan_created', entityType: 'Plan', entityId: p.id, summary: `${p.name} (recommended plans)`, organizationId: null }, tx);
        }
      }
    });
    clinics.forEach((c) => this.tenancy.forget(c.slug));
    this.tenancy.forgetOffers();
    return this.list();
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
