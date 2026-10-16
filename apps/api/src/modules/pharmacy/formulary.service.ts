import { Injectable } from '@nestjs/common';
import { Prisma, ProductType } from '@prisma/client';
import type { ProductInput } from '@vcms/shared';
import { AuditService, diff } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { notFound, ruleViolation } from '../../common/http/errors';
import { orderBy, pageArgs, paginated } from '../../common/http/pagination';
import { PrismaService } from '../../common/prisma/prisma.service';

export const PRESCRIBABLE_TYPES: ProductType[] = ['MEDICINE', 'VACCINE'];

export function decimalProduct<T extends { strengthValue: Prisma.Decimal | null; minDispenseIncrement: Prisma.Decimal }>(p: T) {
  return { ...p, strengthValue: p.strengthValue === null ? null : Number(p.strengthValue), minDispenseIncrement: Number(p.minDispenseIncrement) };
}

function decimalRef<T extends { doseMin: Prisma.Decimal; doseMax: Prisma.Decimal; maxPerDose: Prisma.Decimal | null }>(r: T) {
  return { ...r, doseMin: Number(r.doseMin), doseMax: Number(r.doseMax), maxPerDose: r.maxPerDose === null ? null : Number(r.maxPerDose) };
}

@Injectable()
export class FormularyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(q: { page: number; pageSize: number; q?: string; sort?: string; type?: ProductType; kind?: 'clinical' | 'shop'; categoryId?: string; active: string; prescribable?: boolean }) {
    const where: Prisma.ProductWhereInput = {
      type: q.type ?? (q.prescribable || q.kind === 'clinical' ? { in: PRESCRIBABLE_TYPES } : q.kind === 'shop' ? { notIn: PRESCRIBABLE_TYPES } : undefined),
      categoryId: q.categoryId,
      isActive: q.active === 'all' ? undefined : q.active === 'true',
      ...(q.q
        ? {
            OR: [
              { name: { contains: q.q, mode: 'insensitive' } },
              { genericName: { contains: q.q, mode: 'insensitive' } },
              { brand: { contains: q.q, mode: 'insensitive' } },
              { sku: { contains: q.q, mode: 'insensitive' } },
              { barcode: q.q },
              { activeIngredients: { has: q.q.toLowerCase() } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.product.findMany({
        where,
        ...pageArgs(q),
        orderBy: orderBy(q.sort, ['name', 'type', 'createdAt'], { name: 'asc' }),
        include: { productCategory: { select: { id: true, name: true } }, _count: { select: { doseReferences: { where: { status: 'APPROVED' } } } } },
      }),
      this.prisma.db.product.count({ where }),
    ]);
    return paginated(rows.map(decimalProduct), total, q);
  }

  async get(id: string) {
    const p = await this.prisma.db.product.findUnique({
      where: { id },
      include: {
        productCategory: { select: { id: true, name: true } },
        withdrawals: { include: { species: { select: { id: true, name: true } } } },
        doseReferences: { include: { species: { select: { id: true, name: true } } }, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }] },
      },
    });
    if (!p) throw notFound('Product');
    return { ...decimalProduct(p), doseReferences: p.doseReferences.map(decimalRef) };
  }

  private normalise(input: Partial<ProductInput>) {
    const data: any = { ...input };
    if (input.activeIngredients) data.activeIngredients = [...new Set(input.activeIngredients.map((a) => a.trim().toLowerCase()))];
    if ((input.strengthValue == null) !== (input.strengthUnit == null) && input.strengthValue !== undefined && input.strengthUnit !== undefined) {
      throw ruleViolation('INCOMPLETE_STRENGTH', 'Enter both a strength value and unit, or neither');
    }
    return data;
  }

  /**
   * Rules that depend on the product type: only medicines and vaccines can be prescription-only or controlled,
   * and a shop category must belong to the product's type.
   */
  private async applyTypeRules(data: any, before?: { type: ProductType; categoryId: string | null }) {
    const type: ProductType = data.type ?? before?.type ?? 'MEDICINE';
    if (!PRESCRIBABLE_TYPES.includes(type)) {
      data.requiresPrescription = false;
      data.isControlled = false;
      data.controlledSchedule = null;
    }
    const categoryId = data.categoryId !== undefined ? data.categoryId : before?.categoryId;
    if (categoryId) {
      const c = await this.prisma.db.productCategory.findUnique({ where: { id: categoryId } });
      if (!c || (!c.isActive && categoryId !== before?.categoryId)) throw ruleViolation('INVALID_CATEGORY', 'Category not found');
      if (c.productType && c.productType !== type) throw ruleViolation('CATEGORY_TYPE_MISMATCH', `“${c.name}” is a category for a different product type`);
    }
    return data;
  }

  async create(input: ProductInput) {
    const data = await this.applyTypeRules(this.normalise(input));
    return this.prisma.db.$transaction(async (tx) => {
      const p = await tx.product.create({ data: { ...data, organizationId: RequestContext.orgId() } });
      await this.audit.record({ action: 'product.created', entityType: 'Product', entityId: p.id, summary: p.name }, tx);
      return decimalProduct(p);
    });
  }

  async update(id: string, input: Partial<ProductInput>) {
    const existing = await this.prisma.db.product.findUnique({ where: { id }, select: { type: true, categoryId: true } });
    if (!existing) throw notFound('Product');
    const data = await this.applyTypeRules(this.normalise(input), existing);
    return this.prisma.db.$transaction(async (tx) => {
      const before = await tx.product.findUnique({ where: { id } });
      if (!before) throw notFound('Product');
      const after = await tx.product.update({ where: { id }, data });
      await this.audit.record({ action: 'product.updated', entityType: 'Product', entityId: id, summary: after.name, changes: diff(before, after, Object.keys(data)) }, tx);
      return decimalProduct(after);
    });
  }

  /** Product photo shown on the shop counter: an image already attached to this product, or null to remove it. */
  async setPhoto(productId: string, attachmentId: string | null) {
    const p = await this.prisma.db.product.findUnique({ where: { id: productId } });
    if (!p) throw notFound('Product');
    if (attachmentId) {
      const a = await this.prisma.db.attachment.findUnique({ where: { id: attachmentId } });
      if (!a || a.deletedAt || a.entityType !== 'Product' || a.entityId !== productId || !a.mimeType.startsWith('image/')) {
        throw ruleViolation('INVALID_PHOTO', 'Upload an image for this product first');
      }
    }
    await this.prisma.db.$transaction(async (tx) => {
      await tx.product.update({ where: { id: productId }, data: { photoAttachmentId: attachmentId } });
      await this.audit.record({ action: 'product.photo_updated', entityType: 'Product', entityId: productId, summary: p.name }, tx);
    });
    return { photoAttachmentId: attachmentId };
  }

  // ── Withdrawal periods ──
  async saveWithdrawal(productId: string, input: { speciesId: string; meatDays?: number | null; milkHours?: number | null; eggDays?: number | null; source: string }) {
    const product = await this.prisma.db.product.findUnique({ where: { id: productId } });
    if (!product) throw notFound('Product');
    const species = await this.prisma.db.species.findUnique({ where: { id: input.speciesId } });
    if (!species) throw ruleViolation('INVALID_SPECIES', 'Species not found');
    if (input.meatDays == null && input.milkHours == null && input.eggDays == null) throw ruleViolation('EMPTY_WITHDRAWAL', 'Enter at least one withdrawal period');
    return this.prisma.db.$transaction(async (tx) => {
      const existing = await tx.productWithdrawal.findFirst({ where: { productId, speciesId: input.speciesId } });
      const w = existing
        ? await tx.productWithdrawal.update({ where: { id: existing.id }, data: input })
        : await tx.productWithdrawal.create({ data: { ...input, productId, organizationId: RequestContext.orgId() } });
      await this.audit.record(
        { action: 'product.withdrawal_saved', entityType: 'Product', entityId: productId, summary: `${species.name}: meat ${input.meatDays ?? '–'} d, milk ${input.milkHours ?? '–'} h (${input.source})` },
        tx,
      );
      return w;
    });
  }

  async removeWithdrawal(productId: string, id: string) {
    const w = await this.prisma.db.productWithdrawal.findFirst({ where: { id, productId } });
    if (!w) throw notFound('Withdrawal');
    await this.prisma.db.$transaction(async (tx) => {
      await tx.productWithdrawal.delete({ where: { id } });
      await this.audit.record({ action: 'product.withdrawal_removed', entityType: 'Product', entityId: productId }, tx);
    });
  }

  // ── Dose references ──
  async listReferences(productId: string, speciesId?: string) {
    const rows = await this.prisma.db.doseReference.findMany({
      where: { productId, speciesId, status: speciesId ? 'APPROVED' : undefined },
      include: { species: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(decimalRef);
  }

  async createReference(input: {
    productId: string;
    speciesId: string;
    indication?: string | null;
    route: string;
    doseMin: number;
    doseMax: number;
    doseUnit: string;
    frequency?: string | null;
    maxPerDose?: number | null;
    notes?: string | null;
    source: string;
  }) {
    const ctx = RequestContext.require();
    if (!(await this.prisma.db.product.findUnique({ where: { id: input.productId } }))) throw notFound('Product');
    if (!(await this.prisma.db.species.findUnique({ where: { id: input.speciesId } }))) throw ruleViolation('INVALID_SPECIES', 'Species not found');
    return this.prisma.db.$transaction(async (tx) => {
      const r = await tx.doseReference.create({ data: { ...input, organizationId: ctx.organizationId!, createdByName: ctx.userName } });
      await this.audit.record(
        { action: 'dose_reference.created', entityType: 'Product', entityId: input.productId, summary: `${input.doseMin}–${input.doseMax} ${input.doseUnit} ${input.route} (draft; ${input.source})` },
        tx,
      );
      return decimalRef(r);
    });
  }

  /** A veterinarian approves a draft reference before the calculator may use it. */
  async setReferenceStatus(id: string, status: 'APPROVED' | 'RETIRED') {
    const ctx = RequestContext.require();
    const r = await this.prisma.db.doseReference.findUnique({ where: { id } });
    if (!r) throw notFound('Dose reference');
    if (status === 'APPROVED' && r.status !== 'DRAFT') throw ruleViolation('INVALID_TRANSITION', 'Only draft references can be approved');
    return this.prisma.db.$transaction(async (tx) => {
      const after = await tx.doseReference.update({
        where: { id },
        data: status === 'APPROVED' ? { status, approvedById: ctx.userId, approvedByName: ctx.userName, approvedAt: new Date() } : { status },
      });
      await this.audit.record({ action: `dose_reference.${status.toLowerCase()}`, entityType: 'Product', entityId: r.productId, summary: `${Number(r.doseMin)}–${Number(r.doseMax)} ${r.doseUnit}` }, tx);
      return decimalRef(after);
    });
  }
}
