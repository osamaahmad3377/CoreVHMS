import { Injectable } from '@nestjs/common';
import type { Organization } from '@prisma/client';
import { FULL_ACCESS, type BranchInput, type Branding, type BrandingUpdateInput, type ClinicPlanView, type OrganizationUpdateInput } from '@vcms/shared';
import { AuditService, diff } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { notFound, ruleViolation } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { assertWithinLimit, currentEntitlements } from '../../common/tenancy/entitlements';

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
    const [staff, branches] = await Promise.all([
      this.prisma.raw.membership.count({ where: { status: { in: ['ACTIVE', 'INVITED'] } } }),
      this.prisma.raw.branch.count({ where: { isActive: true } }),
    ]);
    return { entitlements: currentEntitlements() ?? FULL_ACCESS, usage: { staff, branches } };
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
