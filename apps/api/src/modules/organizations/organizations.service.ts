import { Injectable } from '@nestjs/common';
import type { Organization, Plan, Tenant } from '@prisma/client';
import { FULL_ACCESS, STORAGE_PACK_GB, clinicBill, formatMoney, paymentState, receiptNumber, type BranchInput, type Branding, type BrandingUpdateInput, type ClinicPlanView, type OrganizationUpdateInput, type PlanOffer, type UpgradeRequestInput } from '@vcms/shared';
import { AuditService, diff } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { notFound, ruleViolation } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MailService } from '../../common/mail/mail.service';
import { assertWithinLimit, currentEntitlements } from '../../common/tenancy/entitlements';
import { multiClinic } from '../../common/tenancy/hosts';
import { planOffer } from '../../common/tenancy/tenancy.service';
import { storageUsedBytes } from '../attachments/attachments.service';

/**
 * A clinic's branding as the web app uses it. `base` is where the images are served: the signed-in
 * `/api/v1/organization` or the public sign-in page's `/api/v1/tenant`.
 */
export function brandingOf(org: Organization, base = '/api/v1/organization'): Branding {
  const v = org.brandingUpdatedAt?.getTime() ?? 0;
  return {
    brandName: org.brandName ?? org.name,
    primaryColor: org.primaryColor,
    sidebarColor: org.sidebarColor,
    logoUrl: org.logoAttachmentId ? `${base}/logo?v=${v}` : null,
    iconUrl: org.iconAttachmentId || org.logoAttachmentId ? `${base}/icon?v=${v}` : null,
    hasOwnIcon: !!org.iconAttachmentId,
    logoDarkUrl: org.logoDarkAttachmentId ? `${base}/logo-dark?v=${v}` : null,
    loginHeadline: org.loginHeadline,
    loginMessage: org.loginMessage,
    brandFont: org.brandFont,
    cornerStyle: org.cornerStyle,
    menuLogoSize: org.menuLogoSize,
    defaultTheme: org.defaultTheme,
    loginLayout: org.loginLayout,
    loginBackground: org.loginBackground,
    loginBackgroundUrl: org.loginBackgroundAttachmentId ? `${base}/login-background?v=${v}` : null,
    loginFooter: org.loginFooter,
    printLogoPosition: org.printLogoPosition,
    printHeaderText: org.printHeaderText,
    printFooterText: org.printFooterText,
    printUseBrandColour: org.printUseBrandColour,
    printLogoSize: org.printLogoSize,
    printNameSize: org.printNameSize,
    printRule: org.printRule,
    printShowAddress: org.printShowAddress,
    printShowContact: org.printShowContact,
    printShowTaxNumber: org.printShowTaxNumber,
    printFooterAlign: org.printFooterAlign,
    printPreprinted: org.printPreprinted,
    printTopSpaceMm: org.printTopSpaceMm,
    emailSenderName: org.emailSenderName,
    emailSignature: org.emailSignature,
  };
}

const BRANDING_FIELDS = [
  'brandName', 'primaryColor', 'sidebarColor', 'loginHeadline', 'loginMessage', 'brandFont', 'cornerStyle', 'menuLogoSize', 'defaultTheme',
  'loginLayout', 'loginBackground', 'loginFooter', 'printLogoPosition', 'printHeaderText', 'printFooterText',
  'printUseBrandColour', 'printLogoSize', 'printNameSize', 'printRule', 'printShowAddress', 'printShowContact', 'printShowTaxNumber',
  'printFooterAlign', 'printPreprinted', 'printTopSpaceMm', 'emailSenderName', 'emailSignature',
] as const;

/** Branding images and the organization field that holds each. */
export const BRAND_IMAGES = {
  logo: 'logoAttachmentId',
  icon: 'iconAttachmentId',
  'logo-dark': 'logoDarkAttachmentId',
  'login-background': 'loginBackgroundAttachmentId',
} as const;
export type BrandImage = keyof typeof BRAND_IMAGES;

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  async current() {
    return this.prisma.raw.organization.findUniqueOrThrow({ where: { id: RequestContext.orgId() } });
  }

  async update(input: OrganizationUpdateInput) {
    const id = RequestContext.orgId();
    return this.prisma.raw.$transaction(async (tx) => {
      const before = await tx.organization.findUniqueOrThrow({ where: { id } });
      const after = await tx.organization.update({ where: { id }, data: input });
      await this.audit.record(
        { action: 'organization.updated', entityType: 'Organization', entityId: id, changes: diff(before, after, Object.keys(input)) },
        tx,
      );
      return after;
    });
  }

  /** The clinic's plan and how much of it is used (Settings → Your plan). */
  async plan(): Promise<ClinicPlanView> {
    const [staff, branches, automations, customAutomations, storageBytes] = await Promise.all([
      this.prisma.raw.membership.count({ where: { status: { in: ['ACTIVE', 'INVITED'] } } }),
      this.prisma.raw.branch.count({ where: { isActive: true } }),
      this.prisma.db.automation.count({ where: { isActive: true, recipeKey: { not: null } } }),
      this.prisma.db.automation.count({ where: { isActive: true, recipeKey: null } }),
      storageUsedBytes(this.prisma.raw, RequestContext.orgId()),
    ]);
    const tenant = await this.hostedClinic();
    return {
      entitlements: currentEntitlements() ?? FULL_ACCESS,
      usage: { staff, branches, automations, customAutomations, storageBytes },
      plans: await this.offers(),
      pendingRequest: await this.pendingRequest(),
      billing: tenant?.plan ? await this.billing(tenant as typeof tenant & { plan: NonNullable<typeof tenant.plan> }, { staff, branches }) : null,
      currentPlan: tenant?.plan ? planOffer(tenant.plan) : null,
    };
  }

  /** How the clinic pays NextCore: its bill, what it has paid up to, and its receipts. */
  private async billing(tenant: Tenant & { plan: Plan }, seats: { staff: number; branches: number }): Promise<NonNullable<ClinicPlanView['billing']>> {
    const bill = clinicBill(tenant.plan, tenant, new Date(), seats);
    const payments = await this.prisma.control.clinicPayment.findMany({ where: { tenantId: tenant.id, voidedAt: null }, orderBy: { paidAt: 'desc' }, take: 24 });
    return {
      cycle: tenant.billingCycle,
      bill,
      paidUntil: tenant.paidUntil?.toISOString() ?? null,
      payment: paymentState({ bill, paidUntil: tenant.paidUntil, trialEndsAt: tenant.trialEndsAt }),
      payments: payments.map((p) => ({
        id: p.id,
        receipt: receiptNumber(p.number),
        paidAt: p.paidAt.toISOString(),
        amountMinor: p.amountMinor,
        currency: p.currency,
        billingCycle: p.billingCycle,
        paidMonths: p.paidMonths,
        freeMonths: p.freeMonths,
        periodStart: p.periodStart.toISOString(),
        periodEnd: p.periodEnd.toISOString(),
        method: p.method,
      })),
    };
  }

  /** This clinic's record in the platform database (hosted clinics only). */
  private async hostedClinic() {
    const ref = RequestContext.get()?.tenant;
    if (!multiClinic() || !ref) return null;
    return this.prisma.control.tenant.findUnique({ where: { id: ref.id }, include: { plan: true } });
  }

  /** The plan change (or extras) this clinic asked for and NextCore has not handled yet (hosted clinics only). */
  private async pendingRequest(): Promise<ClinicPlanView['pendingRequest']> {
    const tenant = RequestContext.get()?.tenant;
    if (!multiClinic() || !tenant) return null;
    const r = await this.prisma.control.planRequest.findFirst({ where: { tenantId: tenant.id, status: 'PENDING' }, include: { toPlan: true }, orderBy: { createdAt: 'desc' } });
    return r ? { kind: r.kind, planId: r.toPlanId, planName: r.toPlan?.name ?? null, quantity: r.quantity, createdAt: r.createdAt.toISOString() } : null;
  }

  /** Plans a hosted clinic can move to (none without multi-clinic hosting). */
  private async offers(): Promise<PlanOffer[]> {
    if (!multiClinic()) return [];
    const plans = await this.prisma.control.plan.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
    return plans.map(planOffer);
  }

  /**
   * The owner asks NextCore for another plan, or for more branches / staff accounts on the current one: recorded
   * for the super admin to approve (one open request per clinic; a newer one replaces it) and emailed to them.
   */
  async requestUpgrade(input: UpgradeRequestInput) {
    const ctx = RequestContext.require();
    const current = currentEntitlements()?.planName ?? 'no plan';
    let what: string;
    let plan: PlanOffer | undefined;
    if (input.kind === 'PLAN') {
      plan = (await this.offers()).find((p) => p.id === input.planId);
      if (!plan) throw notFound('Plan');
      if (plan.name === current) throw ruleViolation('SAME_PLAN', `You are already on the ${plan.name} plan.`);
      what = `the ${plan.name} plan`;
    } else if (input.kind === 'EXTRA_STORAGE') {
      const own = (await this.hostedClinic())?.plan;
      if (!own || own.storageGb == null || own.extraStorageMinor == null) throw ruleViolation('EXTRA_NOT_OFFERED', 'Your plan does not offer extra storage. Upgrade your plan instead.');
      const n = input.quantity;
      what = `${n * STORAGE_PACK_GB} GB more file storage (${formatMoney(n * own.extraStorageMinor, own.currency).replace(/\.00$/, '')} a month)`;
    } else {
      const own = (await this.hostedClinic())?.plan;
      const branch = input.kind === 'EXTRA_BRANCH';
      const price = branch ? own?.extraBranchMinor : own?.extraStaffMinor;
      const limited = branch ? own?.maxBranches != null : own?.maxStaff != null;
      if (!own || !limited || price == null) throw ruleViolation('EXTRA_NOT_OFFERED', `Your plan does not offer extra ${branch ? 'branches' : 'staff accounts'}. Upgrade your plan instead.`);
      const n = input.quantity;
      what = `${n} extra ${branch ? (n === 1 ? 'branch' : 'branches') : n === 1 ? 'staff account' : 'staff accounts'} (${formatMoney(n * price, own.currency).replace(/\.00$/, '')} a month)`;
    }
    const org = await this.prisma.raw.organization.findUniqueOrThrow({ where: { id: ctx.organizationId! } });
    await this.prisma.db.$transaction((tx) => this.audit.record({ action: 'organization.plan_upgrade_requested', entityType: 'Organization', entityId: org.id, summary: `${current}: ${what}${input.note ? ` · ${input.note}` : ''}` }, tx));
    const tenant = RequestContext.get()?.tenant;
    if (tenant) {
      const data = { kind: input.kind, quantity: input.kind === 'PLAN' ? 1 : input.quantity, toPlanId: plan?.id ?? null, fromPlanName: currentEntitlements()?.planName ?? null, note: input.note ?? null, requestedByName: ctx.userName ?? null };
      const open = await this.prisma.control.planRequest.findFirst({ where: { tenantId: tenant.id, status: 'PENDING' } });
      if (open) await this.prisma.control.planRequest.update({ where: { id: open.id }, data: { ...data, createdAt: new Date() } });
      else await this.prisma.control.planRequest.create({ data: { ...data, tenantId: tenant.id } });
    }
    const admins = await this.prisma.control.user.findMany({ where: { isPlatformAdmin: true, status: 'ACTIVE' }, select: { email: true } });
    for (const a of admins) {
      await this.mail.send({
        to: a.email,
        subject: `Plan request from ${org.name}: ${what}`,
        text: [`${ctx.userName ?? 'The clinic owner'} at ${org.name}${tenant ? ` (${tenant.slug})` : ''} (now on ${current}) asked for ${what}.`, input.note ? `Note: ${input.note}` : '', org.phone ? `Clinic phone: ${org.phone}` : '', '', 'Approve it in the super admin: Clinics → Plan requests.'].join('\n'),
      });
    }
    return { ok: true, plan: plan?.name ?? null, what };
  }

  async branding() {
    return brandingOf(await this.current());
  }

  /** Owner only (branding.manage): name, colours and sign-in page text. */
  async updateBranding(input: BrandingUpdateInput) {
    const id = RequestContext.orgId();
    return this.prisma.raw.$transaction(async (tx) => {
      const before = await tx.organization.findUniqueOrThrow({ where: { id } });
      const after = await tx.organization.update({ where: { id }, data: { ...input, brandingUpdatedAt: new Date() } });
      await this.audit.record(
        { action: 'organization.branding_updated', entityType: 'Organization', entityId: id, changes: diff(before, after, [...BRANDING_FIELDS]) },
        tx,
      );
      return brandingOf(after);
    });
  }

  /** Owner only (branding.manage): logo, browser-tab icon, dark-background logo or sign-in background; null removes it. */
  async setBrandImage(kind: BrandImage, attachmentId: string | null) {
    const id = RequestContext.orgId();
    if (attachmentId) {
      const a = await this.prisma.db.attachment.findUnique({ where: { id: attachmentId } });
      if (!a || a.deletedAt || a.entityType !== 'Branding' || a.entityId !== id || !a.mimeType.startsWith('image/')) {
        throw ruleViolation('INVALID_LOGO', 'Upload an image file first');
      }
    }
    const field = BRAND_IMAGES[kind];
    const event = kind.replace('-', '_');
    return this.prisma.raw.$transaction(async (tx) => {
      const after = await tx.organization.update({ where: { id }, data: { [field]: attachmentId, brandingUpdatedAt: new Date() } });
      await this.audit.record({ action: attachmentId ? `organization.${event}_updated` : `organization.${event}_removed`, entityType: 'Organization', entityId: id }, tx);
      return brandingOf(after);
    });
  }

  /** The attachment to show for a branding image (the icon falls back to the logo). */
  brandImageId(org: Organization, kind: BrandImage) {
    return kind === 'icon' ? (org.iconAttachmentId ?? org.logoAttachmentId) : org[BRAND_IMAGES[kind]];
  }

  listBranches(includeInactive = true) {
    return this.prisma.db.branch.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { members: true } } },
    });
  }

  async createBranch(input: BranchInput) {
    return this.prisma.db.$transaction(async (tx) => {
      assertWithinLimit('branches', await tx.branch.count({ where: { isActive: true } }));
      const branch = await tx.branch.create({ data: { ...input, organizationId: RequestContext.orgId() } });
      // Owners automatically get access to new branches.
      const owners = await tx.membership.findMany({ where: { roles: { some: { role: { key: 'owner' } } } }, select: { id: true } });
      if (owners.length) {
        await tx.membershipBranch.createMany({ data: owners.map((o) => ({ membershipId: o.id, branchId: branch.id })), skipDuplicates: true });
      }
      await this.audit.record({ action: 'branch.created', entityType: 'Branch', entityId: branch.id, summary: branch.name }, tx);
      return branch;
    });
  }

  async updateBranch(id: string, input: Partial<BranchInput>) {
    return this.prisma.db.$transaction(async (tx) => {
      const before = await tx.branch.findUnique({ where: { id } });
      if (!before) throw notFound('Branch');
      // Reopening a paused branch adds to the branch count.
      if (input.isActive === true && !before.isActive) assertWithinLimit('branches', await tx.branch.count({ where: { isActive: true } }));
      if (input.isActive === false && before.isActive) {
        const active = await tx.branch.count({ where: { isActive: true } });
        if (active <= 1) throw ruleViolation('LAST_BRANCH', 'An organization needs at least one active branch');
      }
      const after = await tx.branch.update({ where: { id }, data: input });
      await this.audit.record(
        { action: 'branch.updated', entityType: 'Branch', entityId: id, changes: diff(before, after, Object.keys(input)) },
        tx,
      );
      return after;
    });
  }
}
