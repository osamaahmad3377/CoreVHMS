import { Injectable, Logger } from '@nestjs/common';
import type { Plan, Tenant } from '@prisma/client';
import { resolveEntitlements, type PlanBrief, type PlanFeature, type PlanOffer } from '@vcms/shared';
import { RequestContext, TenantRef } from '../context/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { multiClinic } from './hosts';

const CACHE_MS = 15_000;

export type TenantWithPlan = Tenant & { plan?: Plan | null };

/** The clinic's entitlements from its plan and the super admin's exceptions for it. */
export const entitlementsOf = (t: TenantWithPlan) => resolveEntitlements(t.plan, t);

/**
 * `tenant` must be loaded with its plan for entitlements to be included. `offers` (the plans on offer) let messages
 * and the upgrade page say which plan unlocks a feature; only a clinic on a plan gets them.
 */
export const tenantRef = (t: TenantWithPlan, offers?: PlanBrief[]): TenantRef => ({
  id: t.id,
  slug: t.slug,
  name: t.name,
  databaseName: t.databaseName,
  ...(t.plan !== undefined ? { entitlements: t.plan && offers ? { ...entitlementsOf(t), offers } : entitlementsOf(t) } : {}),
});

export const planBrief = (p: Plan): PlanBrief => ({
  name: p.name,
  priceMonthlyMinor: p.priceMonthlyMinor,
  currency: p.currency,
  maxStaff: p.maxStaff,
  maxBranches: p.maxBranches,
  maxAutomations: p.maxAutomations,
  maxCustomAutomations: p.maxCustomAutomations,
  storageGb: p.storageGb,
  features: p.features as PlanFeature[],
});

/** A plan as clinics see it (Settings → Your plan): price, limits, extras, trial, support and features. */
export const planOffer = (p: Plan): PlanOffer => ({
  ...planBrief(p),
  id: p.id,
  description: p.description,
  priceYearlyMinor: p.priceYearlyMinor,
  extraBranchMinor: p.extraBranchMinor,
  extraStaffMinor: p.extraStaffMinor,
  extraStorageMinor: p.extraStorageMinor,
  trialDays: p.trialDays,
  supportResponse: p.supportResponse,
  whatsappSupport: p.whatsappSupport,
  phoneSupport: p.phoneSupport,
  trainingSessions: p.trainingSessions,
});

/** Looks up hosted clinics in the platform database and runs work against each clinic's database. */
@Injectable()
export class TenancyService {
  private readonly log = new Logger(TenancyService.name);
  private readonly cache = new Map<string, { tenant: TenantWithPlan | null; at: number }>();
  private offerCache: { plans: PlanBrief[]; at: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** Clinic by subdomain (briefly cached; status changes take effect within seconds). */
  async bySlug(slug: string): Promise<TenantWithPlan | null> {
    const hit = this.cache.get(slug);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.tenant;
    const tenant = await this.prisma.control.tenant.findUnique({ where: { slug }, include: { plan: true } });
    this.cache.set(slug, { tenant, at: Date.now() });
    return tenant;
  }

  /** The active plans on offer, cheapest first (briefly cached). */
  async offers(): Promise<PlanBrief[]> {
    if (this.offerCache && Date.now() - this.offerCache.at < CACHE_MS) return this.offerCache.plans;
    const rows = await this.prisma.control.plan.findMany({ where: { isActive: true }, orderBy: [{ priceMonthlyMinor: 'asc' }, { sortOrder: 'asc' }] });
    const plans = rows.map(planBrief);
    this.offerCache = { plans, at: Date.now() };
    return plans;
  }

  forgetOffers() {
    this.offerCache = null;
  }

  forget(slug: string) {
    this.cache.delete(slug);
  }

  /**
   * Runs a background job once per active clinic database (multi-clinic mode), or once against DATABASE_URL.
   * A failure in one clinic is logged and does not stop the others.
   */
  async forEachDatabase(job: string, fn: () => Promise<unknown>) {
    if (!multiClinic()) {
      await fn();
      return;
    }
    const tenants = await this.prisma.control.tenant.findMany({ where: { status: 'ACTIVE' }, include: { plan: true }, orderBy: { slug: 'asc' } });
    for (const t of tenants) {
      try {
        await RequestContext.runInTenant(tenantRef(t, await this.offers()), fn);
      } catch (e) {
        this.log.error(`${job} failed for clinic ${t.slug}: ${(e as Error).message}`);
      }
    }
  }
}
