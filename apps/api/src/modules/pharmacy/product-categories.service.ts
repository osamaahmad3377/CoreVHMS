import { Injectable } from '@nestjs/common';
import type { ProductType } from '@prisma/client';
import { AuditService, diff } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { conflict, notFound, ruleViolation } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';

interface CategoryInput {
  name: string;
  productType?: ProductType | null;
  sortOrder: number;
  isActive: boolean;
}

/** Shop shelf categories (food, grooming, accessories…). Categories in use are hidden, never deleted. */
@Injectable()
export class ProductCategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(includeInactive = false) {
    const rows = await this.prisma.db.productCategory.findMany({
      where: includeInactive ? {} : { isActive: true },
      include: { _count: { select: { products: { where: { isActive: true } } } } },
      orderBy: [{ productType: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map(({ _count, ...c }) => ({ ...c, productCount: _count.products }));
  }

  async save(id: string | null, input: Partial<CategoryInput>) {
    return this.prisma.db.$transaction(async (tx) => {
      if (input.name) {
        const clash = await tx.productCategory.findFirst({ where: { name: { equals: input.name.trim(), mode: 'insensitive' }, ...(id ? { id: { not: id } } : {}) } });
        if (clash) throw conflict(`A category called “${clash.name}” already exists`);
      }
      if (id) {
        const before = await tx.productCategory.findUnique({ where: { id } });
        if (!before) throw notFound('Category');
        if (input.productType !== undefined && input.productType !== before.productType && input.productType) {
          const others = await tx.product.count({ where: { categoryId: id, type: { not: input.productType } } });
          if (others) throw ruleViolation('CATEGORY_IN_USE', `${others} product(s) of another type are in this category; move them first`);
        }
        const after = await tx.productCategory.update({ where: { id }, data: { ...input, name: input.name?.trim() } });
        await this.audit.record({ action: 'product_category.updated', entityType: 'ProductCategory', entityId: id, summary: after.name, changes: diff(before, after, Object.keys(input)) }, tx);
        return after;
      }
      const c = await tx.productCategory.create({
        data: { organizationId: RequestContext.orgId(), name: input.name!.trim(), productType: input.productType ?? null, sortOrder: input.sortOrder ?? 0, isActive: input.isActive ?? true },
      });
      await this.audit.record({ action: 'product_category.created', entityType: 'ProductCategory', entityId: c.id, summary: c.name }, tx);
      return c;
    });
  }
}
