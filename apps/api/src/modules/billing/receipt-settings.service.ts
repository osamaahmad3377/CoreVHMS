import { Injectable } from '@nestjs/common';
import type { ReceiptSettingsInput } from '@vcms/shared';
import { AuditService, diff } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { notFound, ruleViolation } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';

/** Used until the clinic saves its own settings (same values as the database defaults). */
export const DEFAULT_RECEIPT_SETTINGS: ReceiptSettingsInput = {
  paperWidthMm: 80,
  sideMarginMm: 3,
  fontSize: 'NORMAL',
  showLogo: true,
  logoSource: 'BRANDING',
  customLogoAttachmentId: null,
  logoWidthPercent: 55,
  logoAlign: 'CENTER',
  logoMonochrome: true,
  title: 'TAX INVOICE / RECEIPT',
  headerText: null,
  footerText: 'Thank you for caring for your pet with us',
  policyText: null,
  showLegalName: true,
  showBranchAddress: true,
  showPhone: true,
  showEmail: false,
  showTaxNumber: true,
  showServedBy: true,
  showCustomer: true,
  showPatient: true,
  showItemCodes: false,
  showTaxLine: true,
  autoPrint: false,
  copies: 1,
};

const FIELDS = Object.keys(DEFAULT_RECEIPT_SETTINGS) as (keyof ReceiptSettingsInput)[];

@Injectable()
export class ReceiptSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async current(): Promise<ReceiptSettingsInput & { updatedAt: Date | null; updatedByName: string | null }> {
    const row = await this.prisma.db.receiptSettings.findFirst();
    if (!row) return { ...DEFAULT_RECEIPT_SETTINGS, updatedAt: null, updatedByName: null };
    const picked = Object.fromEntries(FIELDS.map((k) => [k, row[k]])) as ReceiptSettingsInput;
    return { ...picked, updatedAt: row.updatedAt, updatedByName: row.updatedByName };
  }

  /** Everything a receipt needs: the settings, the clinic and branch details, and whether a logo will print. */
  async get() {
    const settings = await this.current();
    const org = await this.prisma.raw.organization.findUniqueOrThrow({
      where: { id: RequestContext.orgId() },
      select: { name: true, legalName: true, taxNumber: true, phone: true, email: true, addressLine1: true, addressLine2: true, city: true, postcode: true, logoAttachmentId: true },
    });
    const branches = await this.prisma.db.branch.findMany({
      where: { isActive: true },
      select: { id: true, name: true, phone: true, email: true, addressLine1: true, addressLine2: true, city: true, postcode: true },
      orderBy: { name: 'asc' },
    });
    const logoId = this.logoId(settings, org.logoAttachmentId);
    const { logoAttachmentId, ...clinic } = org;
    return {
      settings,
      clinic,
      branches,
      brandingLogo: !!logoAttachmentId,
      // Changes whenever the printed logo changes, so receipts never show a cached old logo.
      logoVersion: logoId,
    };
  }

  private logoId(s: Pick<ReceiptSettingsInput, 'logoSource' | 'customLogoAttachmentId'>, brandingId: string | null) {
    return s.logoSource === 'CUSTOM' ? s.customLogoAttachmentId : brandingId;
  }

  /** The attachment id of the logo printed on receipts (custom receipt logo or the branding logo), or null. */
  async logoAttachmentId() {
    const s = await this.current();
    const org = await this.prisma.raw.organization.findUniqueOrThrow({ where: { id: RequestContext.orgId() }, select: { logoAttachmentId: true } });
    const id = this.logoId(s, org.logoAttachmentId);
    if (!id) throw notFound('Logo');
    return id;
  }

  async save(input: ReceiptSettingsInput) {
    const ctx = RequestContext.require();
    if (input.customLogoAttachmentId) {
      const a = await this.prisma.db.attachment.findUnique({ where: { id: input.customLogoAttachmentId } });
      if (!a || a.deletedAt || a.entityType !== 'ReceiptLogo' || a.entityId !== ctx.organizationId || !a.mimeType.startsWith('image/')) {
        throw ruleViolation('INVALID_LOGO', 'Upload an image for the receipt logo first');
      }
    }
    if (input.showLogo && input.logoSource === 'CUSTOM' && !input.customLogoAttachmentId) {
      throw ruleViolation('LOGO_REQUIRED', 'Upload a receipt logo, or use the branding logo');
    }
    await this.prisma.db.$transaction(async (tx) => {
      const before = await tx.receiptSettings.findFirst();
      const data = { ...input, updatedByName: ctx.userName ?? null };
      const after = before
        ? await tx.receiptSettings.update({ where: { id: before.id }, data })
        : await tx.receiptSettings.create({ data: { ...data, organizationId: ctx.organizationId! } });
      await this.audit.record(
        {
          action: 'receipt_settings.updated',
          entityType: 'Organization',
          entityId: ctx.organizationId!,
          changes: diff(before ?? (DEFAULT_RECEIPT_SETTINGS as any), after, FIELDS),
        },
        tx,
      );
    });
    return this.get();
  }
}
