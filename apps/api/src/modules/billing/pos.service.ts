import { Injectable } from '@nestjs/common';
import { Prisma, ProductType, ServiceCategory } from '@prisma/client';
import { PRODUCT_TYPES, PRODUCT_TYPE_LABELS } from '@vcms/shared';
import { RequestContext } from '../../common/context/request-context';
import { PrismaService } from '../../common/prisma/prisma.service';
import { localDayBounds } from '../../common/time/tz';
import { InventoryService } from '../inventory/inventory.service';
import { shapeInvoice } from './invoices.service';

export interface PosItem {
  type: 'PRODUCT' | 'SERVICE';
  id: string;
  name: string;
  code: string | null;
  barcode: string | null;
  category: string;
  /** Shop category (e.g. "Dry food"), brand and pack size for products; null for services. */
  categoryId: string | null;
  categoryName: string | null;
  brand: string | null;
  packSize: string | null;
  photoAttachmentId: string | null;
  unit: string;
  priceMinor: number | null;
  taxRateBasisPoints: number;
  trackStock: boolean;
  /** Usable stock at the branch's default location; null when the item is not stock-tracked. */
  available: number | null;
  /** Prescription-only medicines and vaccines are listed for information but cannot be sold at the counter. */
  rxOnly: boolean;
}

/** Search words, lower-cased, with a simple plural "s" removed ("dogs" → "dog", "foods" → "food"). */
export function searchWords(term: string) {
  return term
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean)
    .slice(0, 6)
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
}

const startsAWord = (label: string, w: string) => label.toLowerCase().split(/[^a-z]+/).some((x) => x && x.startsWith(w));
/** Product types whose name a search word refers to ("food" → FOOD, "treat" → FOOD, "medicine" → MEDICINE). */
const typesFor = (w: string) => (w.length < 3 ? [] : PRODUCT_TYPES.filter((t) => startsAWord(PRODUCT_TYPE_LABELS[t], w) || startsAWord(t, w)));
const serviceCategoriesFor = (w: string) => (w.length < 3 ? [] : (Object.values(ServiceCategory) as ServiceCategory[]).filter((c) => startsAWord(c.replace('_', ' '), w)));

/** Read models for the point-of-sale screen. Sales themselves go through InvoicesService/PaymentsService. */
@Injectable()
export class PosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
  ) {}

  async catalog(q: { q?: string; category?: string; categoryId?: string; limit: number }): Promise<{
    items: PosItem[];
    exact: PosItem | null;
    allowNegativeStock: boolean;
    /** Product types with at least one item that can be sold at the counter, so empty sections can be hidden. */
    sellableTypes: string[];
    /** Tax applied to an "other item" typed in at the counter. */
    defaultTaxRateBasisPoints: number;
  }> {
    const db = this.prisma.db;
    const ctx = RequestContext.require();
    const term = q.q?.trim();
    const words = term ? searchWords(term) : [];
    const wantServices = (!q.category || q.category === 'SERVICE') && !q.categoryId;
    const wantProducts = q.category !== 'SERVICE';
    const productWhere: Prisma.ProductWhereInput = {
      isActive: true,
      type: q.category && q.category !== 'SERVICE' ? (q.category as ProductType) : undefined,
      categoryId: q.categoryId,
      ...(term
        ? {
            OR: [
              { sku: { equals: term, mode: 'insensitive' } },
              { barcode: term },
              // Every word must match something: name, brand, pack size, shop category ("Dry food") or section ("food").
              {
                AND: words.map((w) => ({
                  OR: [
                    { name: { contains: w, mode: 'insensitive' } },
                    { genericName: { contains: w, mode: 'insensitive' } },
                    { brand: { contains: w, mode: 'insensitive' } },
                    { packSize: { contains: w, mode: 'insensitive' } },
                    { productCategory: { name: { contains: w, mode: 'insensitive' } } },
                    ...(typesFor(w).length ? [{ type: { in: typesFor(w) as ProductType[] } }] : []),
                  ],
                })),
              },
            ],
          }
        : {}),
    };
    const serviceWhere: Prisma.ServiceWhereInput = {
      isActive: true,
      ...(term
        ? {
            OR: [
              { code: { equals: term.toUpperCase() } },
              { AND: words.map((w) => ({ OR: [{ name: { contains: w, mode: 'insensitive' } }, ...(serviceCategoriesFor(w).length ? [{ category: { in: serviceCategoriesFor(w) } }] : [])] })) },
            ],
          }
        : {}),
    };
    const [products, services, rates, org, sellable] = await Promise.all([
      wantProducts
        ? db.product.findMany({ where: productWhere, include: { productCategory: { select: { name: true } } }, orderBy: { name: 'asc' }, take: q.limit })
        : Promise.resolve([]),
      wantServices
        ? db.service.findMany({
            where: serviceWhere,
            orderBy: { name: 'asc' },
            take: q.limit,
          })
        : Promise.resolve([]),
      db.taxRate.findMany({ where: { isActive: true } }),
      this.prisma.raw.organization.findUniqueOrThrow({ where: { id: ctx.organizationId! }, select: { allowNegativeStock: true } }),
      // Types with something sellable here: priced, active, and not a prescription-only medicine or vaccine.
      db.product.findMany({
        where: { isActive: true, sellPriceMinor: { not: null }, NOT: { requiresPrescription: true, type: { in: ['MEDICINE', 'VACCINE'] } } },
        distinct: ['type'],
        select: { type: true },
      }),
    ]);
    const defaultBp = rates.find((r) => r.isDefault)?.rateBasisPoints ?? 0;
    const bp = (id: string | null) => rates.find((r) => r.id === id)?.rateBasisPoints ?? defaultBp;

    // Usable stock (available status, not expired) at the branch's default location.
    const location = ctx.branchId ? await this.inventory.defaultLocation(db, ctx.branchId) : null;
    const tracked = products.filter((p) => p.trackStock).map((p) => p.id);
    const today = new Date(new Date().toISOString().slice(0, 10));
    const levels =
      location && tracked.length
        ? await db.stockLevel.findMany({ where: { locationId: location.id, productId: { in: tracked }, quantity: { gt: 0 }, batch: { status: 'AVAILABLE', OR: [{ expiryDate: null }, { expiryDate: { gte: today } }] } } })
        : [];
    const available = (productId: string) => Math.round(levels.filter((l) => l.productId === productId).reduce((n, l) => n + Number(l.quantity), 0) * 10000) / 10000;

    const items: PosItem[] = [
      ...products.map((p) => ({
        type: 'PRODUCT' as const,
        id: p.id,
        name: p.name,
        code: p.sku,
        barcode: p.barcode,
        category: p.type,
        categoryId: p.categoryId,
        categoryName: p.productCategory?.name ?? null,
        brand: p.brand,
        packSize: p.packSize,
        photoAttachmentId: p.photoAttachmentId,
        unit: p.dispensingUnit,
        priceMinor: p.sellPriceMinor,
        taxRateBasisPoints: bp(p.taxRateId),
        trackStock: p.trackStock && !!location,
        available: p.trackStock && location ? available(p.id) : null,
        rxOnly: p.requiresPrescription && (p.type === 'MEDICINE' || p.type === 'VACCINE'),
      })),
      ...services.map((s) => ({
        type: 'SERVICE' as const,
        id: s.id,
        name: s.name,
        code: s.code,
        barcode: null,
        category: 'SERVICE',
        categoryId: null,
        categoryName: null,
        brand: null,
        packSize: null,
        photoAttachmentId: null,
        unit: 'service',
        priceMinor: s.priceMinor,
        taxRateBasisPoints: bp(s.taxRateId),
        trackStock: false,
        available: null,
        rxOnly: false,
      })),
    ];
    // A scanned barcode or typed SKU/service code that identifies exactly one item.
    const exactMatches = term ? items.filter((i) => i.barcode === term || i.code?.toLowerCase() === term.toLowerCase()) : [];
    return {
      items,
      exact: exactMatches.length === 1 ? exactMatches[0] : null,
      allowNegativeStock: org.allowNegativeStock,
      sellableTypes: sellable.map((p) => p.type),
      defaultTaxRateBasisPoints: defaultBp,
    };
  }

  /** Today's counter sales at the current branch (branch-local day), newest first. */
  async recent() {
    const ctx = RequestContext.require();
    if (!ctx.branchId) return [];
    const branch = await this.prisma.db.branch.findUniqueOrThrow({ where: { id: ctx.branchId } });
    const { start, end } = localDayBounds(new Date(), branch.timezone);
    const rows = await this.prisma.db.invoice.findMany({
      where: { branchId: ctx.branchId, isPos: true, issuedAt: { gte: start, lt: end } },
      include: {
        client: { select: { id: true, displayName: true, number: true, email: true, mobilePhone: true, addresses: { where: { isPrimary: true }, take: 1 } } },
        lines: { orderBy: { sortOrder: 'asc' }, include: { charge: { select: { id: true, sourceType: true, sourceId: true } } } },
        allocations: { include: { payment: { select: { id: true, number: true, method: true, reference: true, receivedAt: true, receivedByName: true } } }, orderBy: { createdAt: 'asc' } },
        creditNotes: { orderBy: { createdAt: 'asc' } },
        branch: { select: { id: true, name: true, addressLine1: true, addressLine2: true, city: true, postcode: true, phone: true, email: true } },
      },
      orderBy: { issuedAt: 'desc' },
      take: 50,
    });
    return rows.map(shapeInvoice);
  }
}
