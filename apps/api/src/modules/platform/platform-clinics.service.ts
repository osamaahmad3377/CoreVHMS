import { Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Plan, Tenant } from '@prisma/client';
import { STORAGE_PACK_GB, clinicBill, paymentState, type ClinicBillingInput, type ClinicOverview, type ClinicPlanInput, type ClinicUsage, type CreateClinicInput, type PlanFeature, type PlanRequestView, type PlatformClinic } from '@vcms/shared';
import { AuditService } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { randomToken, sha256 } from '../../common/crypto/crypto';
import { generateTemporaryPassword, hashPassword } from '../../common/crypto/password';
import { conflict, notFound, ruleViolation } from '../../common/http/errors';
import { escapeHtml, layout, MailService } from '../../common/mail/mail.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { addressFor, multiClinic, RESERVED_SLUGS } from '../../common/tenancy/hosts';
import { createDatabase, databaseExists, migrateDatabase, tenantDatabaseName } from '../../common/tenancy/tenant-databases';
import { TenancyService, entitlementsOf, tenantRef } from '../../common/tenancy/tenancy.service';
import { storageUsedBytes } from '../attachments/attachments.service';
import { OrgBootstrapService } from '../organizations/org-bootstrap.service';
import { TEMP_PASSWORD_DAYS } from '../users/users.service';
import { toPayment } from './platform-payments';

const INVITE_DAYS = 7;
/** How often ended free trials are looked for. */
const TRIAL_CHECK_MS = 60 * 60_000;


export type TenantWithPlan = Tenant & { plan?: Plan | null; payments?: { paidAt: Date }[] };

/** The latest payment that still counts, for "last paid". */
const LAST_PAYMENT = { where: { voidedAt: null }, orderBy: { paidAt: 'desc' as const }, take: 1, select: { paidAt: true } };

/** Staff accounts (active and invited) and branches a clinic really has — what its extras are billed on. */
export type Seats = { staff: number; branches: number };

/** "2 extra branch(es)", "100 GB more storage" — what a request for extras asks for. */
const requestText = (kind: string, n: number) =>
  kind === 'EXTRA_STORAGE' ? `${n * STORAGE_PACK_GB} GB more storage` : `${n} extra ${kind === 'EXTRA_BRANCH' ? 'branch(es)' : 'staff account(s)'}`;

export function toClinic(t: TenantWithPlan, seats?: Seats | null): PlatformClinic {
  const bill = t.plan ? clinicBill(t.plan, t, new Date(), seats) : null;
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    address: addressFor(t.slug),
    databaseName: t.databaseName,
    status: t.status,
    country: t.country,
    ownerName: t.ownerName,
    ownerEmail: t.ownerEmail,
    ownerAccess: t.ownerAccess as PlatformClinic['ownerAccess'],
    lastError: t.lastError,
    planId: t.planId,
    planName: t.plan?.name ?? null,
    staffLimitOverride: t.staffLimitOverride,
    branchLimitOverride: t.branchLimitOverride,
    storageLimitOverrideGb: t.storageLimitOverrideGb,
    extraFeatures: t.extraFeatures as PlanFeature[],
    removedFeatures: t.removedFeatures as PlanFeature[],
    entitlements: entitlementsOf(t),
    billingCycle: t.billingCycle,
    trialEndsAt: t.trialEndsAt?.toISOString() ?? null,
    trialThenPlanId: t.trialThenPlanId,
    pausedReason: t.pausedReason,
    bill,
    paidUntil: t.paidUntil?.toISOString() ?? null,
    lastPaymentAt: t.payments?.[0]?.paidAt.toISOString() ?? null,
    payment: paymentState({ bill, paidUntil: t.paidUntil, trialEndsAt: t.trialEndsAt }),
    provisionedAt: t.provisionedAt?.toISOString() ?? null,
    suspendedAt: t.suspendedAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
  };
}

/**
 * Super admin: hosted clinics. Adding a clinic records it in the platform database, then sets it up in the
 * background: creates its own PostgreSQL database, applies every migration, and creates the organization,
 * main branch, roles, owner account and starter lists inside it.
 */
@Injectable()
export class PlatformClinicsService implements OnModuleInit, OnModuleDestroy {
  private trialTimer: NodeJS.Timeout | null = null;

  private readonly log = new Logger(PlatformClinicsService.name);
  private readonly running = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly bootstrap: OrgBootstrapService,
    private readonly tenancy: TenancyService,
  ) {}

  onModuleInit() {
    if (!multiClinic() || process.env.NODE_ENV === 'test') return;
    const run = () => this.endTrials().catch((e) => this.log.error(`Ending free trials failed: ${(e as Error).message}`));
    setTimeout(run, 30_000).unref();
    this.trialTimer = setInterval(run, TRIAL_CHECK_MS);
    this.trialTimer.unref();
  }

  onModuleDestroy() {
    if (this.trialTimer) clearInterval(this.trialTimer);
  }

  private assertPlatform() {
    if (!multiClinic() || !RequestContext.get()?.platform) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Multi-clinic hosting is not switched on' });
    }
  }

  /** Throws unless this is the super admin area of a multi-clinic installation. */
  assertPlatformArea() {
    this.assertPlatform();
  }

  private async find(id: string) {
    this.assertPlatform();
    const t = await this.prisma.control.tenant.findUnique({ where: { id }, include: { plan: true, payments: LAST_PAYMENT } });
    if (!t) throw notFound('Clinic');
    return t;
  }

  /** The clinic's platform record with its plan (for billing). */
  findWithPlan(id: string) {
    return this.find(id);
  }

  async list() {
    this.assertPlatform();
    const rows = await this.prisma.control.tenant.findMany({ orderBy: { createdAt: 'desc' }, include: { plan: true, payments: LAST_PAYMENT } });
    const seats = await Promise.all(rows.map((t) => this.seats(t)));
    return rows.map((t, i) => toClinic(t, seats[i]));
  }

  /**
   * How many staff accounts and branches a clinic on a plan with limits has (counted in its own database), so its
   * bill includes every one above the plan. Null when there is nothing to count or the database cannot be reached.
   */
  private async seats(t: TenantWithPlan): Promise<Seats | null> {
    if (!t.plan || (t.plan.maxStaff == null && t.plan.maxBranches == null)) return null;
    if (t.status !== 'ACTIVE' && t.status !== 'SUSPENDED') return null;
    try {
      return await RequestContext.runInTenant(tenantRef(t), async () => {
        const [staff, branches] = await Promise.all([
          this.prisma.raw.membership.count({ where: { status: { in: ['ACTIVE', 'INVITED'] } } }),
          this.prisma.raw.branch.count({ where: { isActive: true } }),
        ]);
        return { staff, branches };
      });
    } catch (e) {
      this.log.warn(`Staff and branch count for ${t.slug} unavailable: ${(e as Error).message}`);
      return null;
    }
  }

  async get(id: string) {
    const t = await this.find(id);
    return toClinic(t, await this.seats(t));
  }

  /**
   * One clinic at a glance for the super admin: details, how much it is used (counted in the clinic's own
   * database; nothing clinical is read) and the history of what the platform did to it.
   */
  async overview(id: string): Promise<ClinicOverview> {
    const t = await this.find(id);
    let usage: ClinicUsage | null = null;
    if (t.status === 'ACTIVE' || t.status === 'SUSPENDED') {
      try {
        usage = await RequestContext.runInTenant(tenantRef(t), async () => {
          const raw = this.prisma.raw;
          const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
          const [staff, activeStaff, staffCounted, branches, clients, patients, appointmentsThisMonth, lastSignIn, storageBytes] = await Promise.all([
            raw.membership.count(),
            raw.membership.count({ where: { status: 'ACTIVE' } }),
            raw.membership.count({ where: { status: { in: ['ACTIVE', 'INVITED'] } } }),
            raw.branch.count({ where: { isActive: true } }),
            raw.client.count({ where: { status: { not: 'MERGED' } } }),
            raw.patient.count({ where: { status: { not: 'MERGED' } } }),
            raw.appointment.count({ where: { startsAt: { gte: monthStart } } }),
            raw.user.findFirst({ where: { lastLoginAt: { not: null } }, orderBy: { lastLoginAt: 'desc' }, select: { lastLoginAt: true } }),
            storageUsedBytes(raw),
          ]);
          return { staff, activeStaff, staffCounted, branches, storageBytes, clients, patients, appointmentsThisMonth, lastSignInAt: lastSignIn?.lastLoginAt?.toISOString() ?? null };
        });
      } catch (e) {
        this.log.warn(`Usage for ${t.slug} unavailable: ${(e as Error).message}`);
      }
    }
    const events = await this.prisma.control.auditEvent.findMany({
      where: { entityType: 'Tenant', entityId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, action: true, summary: true, actorName: true, createdAt: true },
    });
    const payments = await this.prisma.control.clinicPayment.findMany({ where: { tenantId: id }, include: { tenant: { select: { name: true } } }, orderBy: [{ paidAt: 'desc' }, { number: 'desc' }] });
    return {
      clinic: toClinic(t, usage && { staff: usage.staffCounted, branches: usage.branches }),
      usage,
      events: events.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })),
      payments: payments.map(toPayment),
    };
  }

  async create(input: CreateClinicInput) {
    this.assertPlatform();
    if (RESERVED_SLUGS.has(input.slug)) throw ruleViolation('ADDRESS_RESERVED', 'This address is reserved. Choose another one.');
    if (await this.prisma.control.tenant.findUnique({ where: { slug: input.slug } })) {
      throw conflict('Another clinic already uses this address');
    }
    const databaseName = tenantDatabaseName(input.slug);
    if (await databaseExists(this.prisma.control, databaseName)) {
      throw conflict(`A database named ${databaseName} already exists on the server. Choose another address, or remove that database first.`);
    }
    const plan = input.planId ? await this.prisma.control.plan.findUnique({ where: { id: input.planId } }) : null;
    if (input.planId && (!plan || !plan.isActive)) throw ruleViolation('PLAN_UNAVAILABLE', 'Choose a plan that is switched on');
    const temporaryPassword = input.ownerAccess === 'TEMPORARY_PASSWORD' ? generateTemporaryPassword() : null;
    const tenant = await this.prisma.control.$transaction(async (tx) => {
      const t = await tx.tenant.create({
        data: {
          slug: input.slug,
          name: input.name,
          databaseName,
          country: input.country,
          branchName: input.branchName,
          ownerName: input.ownerName,
          ownerEmail: input.ownerEmail,
          ownerAccess: input.ownerAccess,
          ownerPasswordHash: temporaryPassword ? await hashPassword(temporaryPassword) : null,
          createdById: RequestContext.get()?.userId ?? null,
          planId: plan?.id ?? null,
          planChangedAt: plan ? new Date() : null,
          billingCycle: input.billingCycle,
          // The plan's free trial: when it ends the clinic is paused until NextCore marks it as paid.
          trialEndsAt: plan && input.startTrial && plan.trialDays > 0 ? new Date(Date.now() + plan.trialDays * 86400_000) : null,
        },
        include: { plan: true },
      });
      const trial = t.trialEndsAt ? ` · ${plan!.trialDays}-day free trial` : '';
      await this.audit.record({ action: 'platform.clinic_created', entityType: 'Tenant', entityId: t.id, summary: `${t.name} (${t.slug})${plan ? ` · ${plan.name} plan` : ''}${trial}`, organizationId: null }, tx);
      return t;
    });
    this.start(tenant.id);
    return {
      clinic: toClinic(tenant),
      temporaryPassword,
      expiresAt: temporaryPassword ? new Date(Date.now() + TEMP_PASSWORD_DAYS * 86400_000).toISOString() : null,
    };
  }

  /**
   * Chooses a clinic's plan and any exceptions for this clinic (its own staff or branch limit, features added or
   * taken away). Applies within seconds, on every request. Existing staff and branches are never removed: a clinic
   * above a lowered limit keeps what it has but cannot add more.
   */
  async assignPlan(id: string, input: ClinicPlanInput) {
    await this.setPlan(await this.find(id), input);
    return this.get(id);
  }

  /** Applies a plan and exceptions (from the super admin, an approved request or an ended free period). */
  private async setPlan(t: TenantWithPlan, input: ClinicPlanInput, extra: { trialEndsAt?: null; trialThenPlanId?: null } = {}) {
    const id = t.id;
    const plan = input.planId ? await this.prisma.control.plan.findUnique({ where: { id: input.planId } }) : null;
    if (input.planId && !plan) throw notFound('Plan');
    if (plan && !plan.isActive && plan.id !== t.planId) throw ruleViolation('PLAN_UNAVAILABLE', 'That plan is switched off. Switch it on first, or choose another plan.');
    // Exceptions only make sense on a plan; "no plan" means no limits at all.
    const o = plan
      ? { staffLimitOverride: input.staffLimitOverride, branchLimitOverride: input.branchLimitOverride, storageLimitOverrideGb: input.storageLimitOverrideGb ?? null, extraFeatures: input.extraFeatures, removedFeatures: input.removedFeatures }
      : { staffLimitOverride: null, branchLimitOverride: null, storageLimitOverrideGb: null, extraFeatures: [], removedFeatures: [] };
    const overlap = o.extraFeatures.filter((f) => o.removedFeatures.includes(f));
    if (overlap.length) throw ruleViolation('FEATURE_CONFLICT', `${overlap.join(', ')} cannot be both added and taken away`);
    const before = entitlementsOf(t);
    await this.prisma.control.$transaction(async (tx) => {
      const after = await tx.tenant.update({ where: { id }, data: { planId: plan?.id ?? null, ...o, ...extra, planChangedAt: new Date() }, include: { plan: true } });
      const now = entitlementsOf(after);
      const gained = now.features.filter((f) => !before.features.includes(f));
      const lost = before.features.filter((f) => !now.features.includes(f));
      await this.audit.record(
        {
          action: 'platform.clinic_plan_changed',
          entityType: 'Tenant',
          entityId: id,
          summary: [
            `${before.planName ?? 'No plan'} → ${now.planName ?? 'No plan'}`,
            `staff ${before.maxStaff ?? 'no limit'} → ${now.maxStaff ?? 'no limit'}`,
            `branches ${before.maxBranches ?? 'no limit'} → ${now.maxBranches ?? 'no limit'}`,
            before.maxStorageGb !== now.maxStorageGb && `storage ${before.maxStorageGb == null ? 'no limit' : `${before.maxStorageGb} GB`} → ${now.maxStorageGb == null ? 'no limit' : `${now.maxStorageGb} GB`}`,
            gained.length && `added: ${gained.join(', ')}`,
            lost.length && `removed: ${lost.join(', ')}`,
          ].filter(Boolean).join(' · '),
          changes: { entitlements: { from: before, to: now } },
          organizationId: null,
        },
        tx,
      );
    });
    this.tenancy.forget(t.slug);
  }

  /**
   * How the clinic pays and its free trial or free period (e.g. a month of Professional, then back to Starter).
   * Clearing the end date marks the clinic as paying.
   */
  async setBilling(id: string, input: ClinicBillingInput) {
    const t = await this.find(id);
    const ends = input.trialEndsAt ? new Date(input.trialEndsAt) : null;
    if (ends && ends <= new Date()) throw ruleViolation('DATE_PASSED', 'Choose an end date in the future');
    const then = ends && input.trialThenPlanId ? await this.prisma.control.plan.findUnique({ where: { id: input.trialThenPlanId } }) : null;
    if (ends && input.trialThenPlanId && (!then || !then.isActive)) throw ruleViolation('PLAN_UNAVAILABLE', 'Choose a plan that is switched on for after the free period');
    await this.prisma.control.$transaction(async (tx) => {
      await tx.tenant.update({ where: { id }, data: { billingCycle: input.billingCycle, trialEndsAt: ends, trialThenPlanId: ends ? (then?.id ?? null) : null } });
      const summary = [
        `${input.billingCycle === 'YEARLY' ? 'Yearly' : 'Monthly'} billing`,
        ends ? `free until ${ends.toISOString().slice(0, 10)}, then ${then ? then.name : 'paused'}` : t.trialEndsAt ? 'marked as paying' : null,
      ].filter(Boolean).join(' · ');
      await this.audit.record({ action: 'platform.clinic_billing_changed', entityType: 'Tenant', entityId: id, summary, organizationId: null }, tx);
    });
    this.tenancy.forget(t.slug);
    return this.get(id);
  }

  /**
   * Free trials and free periods that have ended: the clinic moves to the plan chosen for afterwards, or is paused
   * (data kept) until NextCore marks it as paid. The owner is emailed either way.
   */
  async endTrials(now = new Date()) {
    const ended = await this.prisma.control.tenant.findMany({ where: { status: 'ACTIVE', trialEndsAt: { lte: now } }, include: { plan: true } });
    for (const t of ended) {
      try {
        await this.endTrial(t, now);
      } catch (e) {
        this.log.error(`Ending the free trial of ${t.slug} failed: ${(e as Error).message}`);
      }
    }
    return ended.length;
  }

  private async endTrial(t: TenantWithPlan, now: Date) {
    const then = t.trialThenPlanId ? await this.prisma.control.plan.findUnique({ where: { id: t.trialThenPlanId } }) : null;
    if (then) {
      await this.setPlan(t, { planId: then.id, staffLimitOverride: t.staffLimitOverride, branchLimitOverride: t.branchLimitOverride, storageLimitOverrideGb: t.storageLimitOverrideGb, extraFeatures: t.extraFeatures as PlanFeature[], removedFeatures: t.removedFeatures as PlanFeature[] }, { trialEndsAt: null, trialThenPlanId: null });
      await this.notifyOwner(t, `${t.name} is now on the ${then.name} plan`, `Your free period on ${t.plan?.name ?? 'your plan'} has ended and ${t.name} is now on the ${then.name} plan. Everything you entered is kept.`);
    } else {
      await this.prisma.control.$transaction(async (tx) => {
        await tx.tenant.update({ where: { id: t.id }, data: { status: 'SUSPENDED', suspendedAt: now, pausedReason: 'TRIAL_ENDED' } });
        await this.audit.record({ action: 'platform.clinic_suspended', entityType: 'Tenant', entityId: t.id, summary: `${t.slug}: free trial ended`, organizationId: null, actorUserId: null, actorName: 'NextCore (automatic)' }, tx);
      });
      this.tenancy.forget(t.slug);
      await this.prisma.release(t.databaseName);
      await this.notifyOwner(t, `Your free trial of NextCore VCMS has ended`, `The free trial for ${t.name} has ended, so the clinic is paused. All your records are kept safely. Contact NextCore to choose a plan and carry on where you left off.`);
    }
  }

  private async notifyOwner(t: TenantWithPlan, subject: string, text: string) {
    try {
      await this.mail.send({ to: t.ownerEmail, subject, text: `Hello ${t.ownerName},\n\n${text}\n\nNextCore VCMS`, html: layout(escapeHtml(subject), `<p>Hello ${escapeHtml(t.ownerName)},</p><p>${escapeHtml(text)}</p>`) });
    } catch (e) {
      this.log.error(`Email to ${t.ownerEmail} failed: ${(e as Error).message}`);
    }
  }

  /** Plan changes clinic owners asked for (Settings → Your plan) and nobody has handled yet, oldest first. */
  async planRequests(): Promise<PlanRequestView[]> {
    this.assertPlatform();
    const rows = await this.prisma.control.planRequest.findMany({ where: { status: 'PENDING' }, include: { tenant: { include: { plan: true } }, toPlan: true }, orderBy: { createdAt: 'asc' } });
    return rows.map((r) => ({
      id: r.id,
      clinicId: r.tenantId,
      clinicName: r.tenant.name,
      clinicSlug: r.tenant.slug,
      kind: r.kind,
      quantity: r.quantity,
      fromPlanName: r.fromPlanName,
      toPlanId: r.toPlanId,
      toPlanName: r.toPlan?.name ?? null,
      priceMonthlyMinor: r.toPlan
        ? r.toPlan.priceMonthlyMinor
        : r.quantity * ((r.kind === 'EXTRA_BRANCH' ? r.tenant.plan?.extraBranchMinor : r.kind === 'EXTRA_STORAGE' ? r.tenant.plan?.extraStorageMinor : r.tenant.plan?.extraStaffMinor) ?? 0),
      currency: (r.toPlan ?? r.tenant.plan)?.currency ?? 'PKR',
      note: r.note,
      requestedByName: r.requestedByName,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  private async openRequest(id: string) {
    this.assertPlatform();
    const r = await this.prisma.control.planRequest.findUnique({ where: { id }, include: { tenant: { include: { plan: true } }, toPlan: true } });
    if (!r) throw notFound('Plan request');
    if (r.status !== 'PENDING') throw ruleViolation('REQUEST_HANDLED', 'This request has already been handled.');
    return r;
  }

  /**
   * Moves the clinic to the plan it asked for (keeping its own exceptions), closes the request and tells the owner.
   * Billing happens outside the app: approve once the clinic has paid or agreed the new price.
   */
  async approvePlanRequest(id: string) {
    const r = await this.openRequest(id);
    const t = r.tenant;
    const keep = { staffLimitOverride: t.staffLimitOverride, branchLimitOverride: t.branchLimitOverride, storageLimitOverrideGb: t.storageLimitOverrideGb, extraFeatures: t.extraFeatures as PlanFeature[], removedFeatures: t.removedFeatures as PlanFeature[] };
    let what: string;
    if (r.kind === 'PLAN') {
      if (!r.toPlan) throw ruleViolation('PLAN_UNAVAILABLE', 'That plan no longer exists');
      await this.setPlan(t, { planId: r.toPlan.id, ...keep });
      what = `${t.name} has moved to the ${r.toPlan.name} plan. Everything it includes is ready to use now.`;
    } else if (r.kind === 'EXTRA_STORAGE') {
      // More file storage: the clinic's own storage limit goes up by the packs asked for.
      if (!t.plan) throw ruleViolation('NO_PLAN', 'The clinic has no plan, so it has no limit to raise');
      const base = t.storageLimitOverrideGb ?? t.plan.storageGb;
      if (base == null) throw ruleViolation('NO_LIMIT', `The ${t.plan.name} plan has no storage limit to raise`);
      const gb = base + r.quantity * STORAGE_PACK_GB;
      await this.setPlan(t, { planId: t.plan.id, ...keep, storageLimitOverrideGb: gb });
      what = `${t.name} now has ${gb} GB of file storage.`;
    } else {
      // More branches or staff accounts on the current plan: the clinic's own limit goes up by the number asked for.
      if (!t.plan) throw ruleViolation('NO_PLAN', 'The clinic has no plan, so it has no limit to raise');
      const branch = r.kind === 'EXTRA_BRANCH';
      const base = branch ? (t.branchLimitOverride ?? t.plan.maxBranches) : (t.staffLimitOverride ?? t.plan.maxStaff);
      if (base == null) throw ruleViolation('NO_LIMIT', `The ${t.plan.name} plan has no ${branch ? 'branch' : 'staff'} limit to raise`);
      await this.setPlan(t, { planId: t.plan.id, ...keep, ...(branch ? { branchLimitOverride: base + r.quantity } : { staffLimitOverride: base + r.quantity }) });
      what = `${t.name} can now have ${base + r.quantity} ${branch ? 'branches' : 'staff accounts'}.`;
    }
    await this.prisma.control.$transaction(async (tx) => {
      await tx.planRequest.update({ where: { id }, data: { status: 'APPROVED', resolvedAt: new Date(), resolvedById: RequestContext.get()?.userId ?? null } });
      await this.audit.record({ action: 'platform.plan_request_approved', entityType: 'Tenant', entityId: t.id, summary: `${t.name}: ${r.kind === 'PLAN' ? `${r.fromPlanName ?? 'No plan'} → ${r.toPlan?.name}` : requestText(r.kind, r.quantity)}`, organizationId: null }, tx);
    });
    await this.notifyOwner(t, r.kind === 'PLAN' ? `${t.name} is now on the ${r.toPlan!.name} plan` : `Your request for ${t.name} is done`, `${what} Thank you for choosing NextCore VCMS.`);
    return this.get(t.id);
  }

  /** Closes a request without changing the clinic's plan (e.g. sorted out by phone, or not going ahead). */
  async dismissPlanRequest(id: string) {
    const r = await this.openRequest(id);
    await this.prisma.control.$transaction(async (tx) => {
      await tx.planRequest.update({ where: { id }, data: { status: 'DISMISSED', resolvedAt: new Date(), resolvedById: RequestContext.get()?.userId ?? null } });
      await this.audit.record({ action: 'platform.plan_request_dismissed', entityType: 'Tenant', entityId: r.tenantId, summary: `${r.tenant.name}: ${r.kind === 'PLAN' ? `${r.fromPlanName ?? 'No plan'} → ${r.toPlan?.name}` : requestText(r.kind, r.quantity)}`, organizationId: null }, tx);
    });
  }

  /** Sets up a clinic that failed part-way (each step is safe to repeat). */
  async retry(id: string) {
    const t = await this.find(id);
    const r = await this.prisma.control.tenant.updateMany({ where: { id, status: 'FAILED' }, data: { status: 'PROVISIONING', lastError: null } });
    if (!r.count) throw ruleViolation('NOT_FAILED', 'Only a clinic whose set-up failed can be retried');
    await this.audit.record({ action: 'platform.clinic_setup_retried', entityType: 'Tenant', entityId: t.id, summary: t.slug, organizationId: null });
    this.start(id);
    return this.get(id);
  }

  /** Pauses a clinic; `UNPAID` tells its staff the subscription payment is overdue (lifted when it pays). */
  async suspend(id: string, reason: 'UNPAID' | null = null) {
    const t = await this.find(id);
    if (t.status !== 'ACTIVE') throw ruleViolation('NOT_ACTIVE', 'Only an active clinic can be paused');
    await this.prisma.control.$transaction(async (tx) => {
      await tx.tenant.update({ where: { id }, data: { status: 'SUSPENDED', suspendedAt: new Date(), pausedReason: reason } });
      await this.audit.record({ action: 'platform.clinic_suspended', entityType: 'Tenant', entityId: id, summary: reason === 'UNPAID' ? `${t.slug}: payment overdue` : t.slug, organizationId: null }, tx);
    });
    this.tenancy.forget(t.slug);
    await this.prisma.release(t.databaseName);
    return this.get(id);
  }

  async reactivate(id: string) {
    const t = await this.find(id);
    if (t.status !== 'SUSPENDED') throw ruleViolation('NOT_SUSPENDED', 'Only a paused clinic can be reactivated');
    await this.prisma.control.$transaction(async (tx) => {
      // Reactivating a clinic paused at the end of its free trial means it is paying now.
      await tx.tenant.update({ where: { id }, data: { status: 'ACTIVE', suspendedAt: null, pausedReason: null, ...(t.pausedReason === 'TRIAL_ENDED' ? { trialEndsAt: null, trialThenPlanId: null } : {}) } });
      await this.audit.record({ action: 'platform.clinic_reactivated', entityType: 'Tenant', entityId: id, summary: t.slug, organizationId: null }, tx);
    });
    this.tenancy.forget(t.slug);
    return this.get(id);
  }

  /** New temporary password for the clinic's first owner (lost password, or the invitation never arrived). */
  async resetOwnerPassword(id: string) {
    const t = await this.find(id);
    if (t.status !== 'ACTIVE') throw ruleViolation('NOT_ACTIVE', 'The clinic must be active');
    const password = generateTemporaryPassword();
    const passwordHash = await hashPassword(password);
    const expiresAt = new Date(Date.now() + TEMP_PASSWORD_DAYS * 86400_000);
    await RequestContext.runInTenant(tenantRef(t), async () => {
      const raw = this.prisma.raw;
      const user = await raw.user.findUnique({ where: { email: t.ownerEmail } });
      if (!user) throw notFound('Owner account');
      await raw.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: user.id },
          data: { passwordHash, passwordChangedAt: new Date(), mustChangePassword: true, temporaryPasswordExpiresAt: expiresAt, failedLoginCount: 0, lockedUntil: null, status: 'ACTIVE' },
        });
        await tx.membership.updateMany({ where: { userId: user.id, status: 'INVITED' }, data: { status: 'ACTIVE', joinedAt: new Date() } });
        await tx.authToken.updateMany({ where: { userId: user.id, consumedAt: null }, data: { consumedAt: new Date() } });
        await tx.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
        await this.audit.record({ action: 'membership.temporary_password_issued', entityType: 'User', entityId: user.id, summary: `${user.email} (by NextCore super admin)`, organizationId: t.organizationId, actorUserId: null, actorName: 'NextCore super admin' }, tx);
      });
    });
    await this.audit.record({ action: 'platform.clinic_owner_password_reset', entityType: 'Tenant', entityId: id, summary: t.ownerEmail, organizationId: null });
    return { clinic: toClinic(t), temporaryPassword: password, expiresAt: expiresAt.toISOString() };
  }

  // ── Set-up ──

  private start(id: string) {
    if (this.running.has(id)) return;
    const job = this.provision(id).finally(() => this.running.delete(id));
    this.running.set(id, job);
  }

  /** Resolves when any set-up in progress for this clinic has finished (tests and the command line). */
  async settled(id: string) {
    await this.running.get(id);
  }

  async provision(id: string) {
    const t = await this.prisma.control.tenant.findUniqueOrThrow({ where: { id } });
    if (t.status !== 'PROVISIONING') return;
    try {
      await createDatabase(this.prisma.control, t.databaseName);
      await migrateDatabase(t.databaseName);
      const organizationId = await RequestContext.runInTenant(tenantRef(t), () => this.setUpClinic(t));
      await this.prisma.control.$transaction(async (tx) => {
        await tx.tenant.update({
          where: { id },
          data: { status: 'ACTIVE', organizationId, ownerPasswordHash: null, lastError: null, provisionedAt: new Date() },
        });
        await this.audit.record({ action: 'platform.clinic_ready', entityType: 'Tenant', entityId: id, summary: t.slug, organizationId: null, actorUserId: null, actorName: 'System' }, tx);
      });
      this.log.log(`Clinic ${t.slug} is ready (database ${t.databaseName})`);
    } catch (e) {
      const message = (e as Error).message.slice(0, 2000);
      this.log.error(`Setting up clinic ${t.slug} failed: ${message}`);
      await this.prisma.control.tenant.update({ where: { id }, data: { status: 'FAILED', lastError: message } });
    } finally {
      this.tenancy.forget(t.slug);
    }
  }

  /** Runs inside the clinic's database. Repeating it after a partial failure reuses what already exists. */
  private async setUpClinic(t: Tenant): Promise<string> {
    const raw = this.prisma.raw;
    const existing = await raw.organization.findFirst({ orderBy: { createdAt: 'asc' } });
    if (existing) return existing.id;

    const invite = t.ownerAccess === 'INVITATION';
    const token = invite ? randomToken(32) : null;
    const orgId = await raw.$transaction(
      async (tx) => {
        const user = await tx.user.create({
          data: invite
            ? { email: t.ownerEmail, name: t.ownerName }
            : {
                email: t.ownerEmail,
                name: t.ownerName,
                passwordHash: t.ownerPasswordHash,
                passwordChangedAt: new Date(),
                mustChangePassword: true,
                temporaryPasswordExpiresAt: new Date(t.createdAt.getTime() + TEMP_PASSWORD_DAYS * 86400_000),
              },
        });
        const { org, membership } = await this.bootstrap.create(tx, { name: t.name, country: t.country as 'PK' | 'AU', branchName: t.branchName, ownerUserId: user.id });
        await this.bootstrap.starterSetup(tx, org.id);
        if (token) {
          await tx.membership.update({ where: { id: membership.id }, data: { status: 'INVITED', joinedAt: null } });
          await tx.authToken.create({
            data: { type: 'INVITATION', tokenHash: sha256(token), userId: user.id, organizationId: org.id, membershipId: membership.id, expiresAt: new Date(Date.now() + INVITE_DAYS * 86400_000) },
          });
        }
        await this.audit.record({ action: 'organization.created', entityType: 'Organization', entityId: org.id, organizationId: org.id, summary: 'Set up by NextCore super admin', actorUserId: null, actorName: 'NextCore super admin' }, tx);
        return org.id;
      },
      { timeout: 60_000 },
    );

    if (token) {
      const link = `${addressFor(t.slug)}/accept-invite?token=${encodeURIComponent(token)}`;
      try {
        await this.mail.send({
          to: t.ownerEmail,
          subject: `${t.name} is ready on NextCore VCMS`,
          text: `Hello ${t.ownerName},\n\nYour clinic ${t.name} has been set up on NextCore VCMS at ${addressFor(t.slug)}.\nChoose your password within ${INVITE_DAYS} days: ${link}`,
          html: layout(
            `${escapeHtml(t.name)} is ready`,
            `<p>Hello ${escapeHtml(t.ownerName)},</p><p>Your clinic <b>${escapeHtml(t.name)}</b> has been set up on NextCore VCMS.</p>
<p>Your clinic’s address: <a href="${addressFor(t.slug)}">${addressFor(t.slug)}</a></p>
<p><a href="${link}" style="background:#0f766e;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Choose your password</a></p>
<p style="color:#6b7b80">This link expires in ${INVITE_DAYS} days.</p>`,
          ),
        });
      } catch (e) {
        // The clinic is set up; the super admin can give the owner a temporary password instead.
        this.log.error(`Invitation email to ${t.ownerEmail} failed: ${(e as Error).message}`);
      }
    }
    return orgId;
  }
}
