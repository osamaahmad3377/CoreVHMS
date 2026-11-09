import { Injectable } from '@nestjs/common';
import { Prisma, ProductType, ServiceCategory } from '@prisma/client';
import { PRODUCT_TYPES, PRODUCT_TYPE_LABELS, chargeSection } from '@vcms/shared';
import { RequestContext } from '../../common/context/request-context';
import { PrismaService } from '../../common/prisma/prisma.service';
import { formatNumber } from '../../common/counter/counter.service';
import { notFound } from '../../common/http/errors';
import { localDayBounds } from '../../common/time/tz';
import { InventoryService } from '../inventory/inventory.service';
import { ChargeCaptureService } from './charge-capture.service';
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
  /** Prescription-only medicines and vaccines: sold at the counter only against a prescription, or (if the clinic allows it) with a note saying who approved. */
  rxOnly: boolean;
  /** Controlled medicines always need a prescription. */
  controlled: boolean;
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
    private readonly charges: ChargeCaptureService,
  ) {}

  /**
   * Who is ready to pay at the counter today: clients with something waiting from today's visits (consultation fee,
   * medicines given in the clinic, other charges) or a prescription written today. Newest first.
   */
  async waiting() {
    const ctx = RequestContext.require();
    if (!ctx.branchId) return [];
    const db = this.prisma.db;
    const branch = await db.branch.findUniqueOrThrow({ where: { id: ctx.branchId } });
    const { start } = localDayBounds(new Date(), branch.timezone);
    const [charges, rxs] = await Promise.all([
      db.charge.findMany({ where: { branchId: branch.id, status: 'PENDING', createdAt: { gte: start } }, select: { clientId: true, patientId: true, quantity: true, unitPriceMinor: true, discountMinor: true, createdAt: true } }),
      // Today's prescriptions (typed or from stock), which the counter reads.
      db.prescription.findMany({ where: { branchId: branch.id, status: { in: ['AUTHORIZED', 'PARTIALLY_DISPENSED', 'DISPENSED'] }, authorizedAt: { gte: start } }, include: { _count: { select: { items: true } }, prescriber: { select: { user: { select: { name: true } } } } } }),
    ]);
    const byClient = new Map<string, { since: Date; charges: number; totalMinor: number; prescribed: number; patientIds: Set<string>; vet: string | null }>();
    const entry = (id: string) => byClient.get(id) ?? byClient.set(id, { since: new Date(0), charges: 0, totalMinor: 0, prescribed: 0, patientIds: new Set(), vet: null }).get(id)!;
    for (const c of charges) {
      const e = entry(c.clientId);
      e.charges++;
      e.totalMinor += Math.round(Number(c.quantity) * c.unitPriceMinor) - c.discountMinor;
      if (c.patientId) e.patientIds.add(c.patientId);
      if (c.createdAt > e.since) e.since = c.createdAt;
    }
    for (const rx of rxs) {
      const e = entry(rx.clientId);
      e.prescribed += rx._count.items;
      e.patientIds.add(rx.patientId);
      e.vet ??= rx.prescriber?.user.name ?? null;
      if ((rx.authorizedAt ?? rx.createdAt) > e.since) e.since = rx.authorizedAt ?? rx.createdAt;
    }
    if (!byClient.size) return [];
    const [clients, patients] = await Promise.all([
      db.client.findMany({ where: { id: { in: [...byClient.keys()] } }, select: { id: true, number: true, displayName: true, mobilePhone: true } }),
      db.patient.findMany({ where: { id: { in: [...byClient.values()].flatMap((e) => [...e.patientIds]) } }, select: { id: true, name: true } }),
    ]);
    return clients
      .map((c) => {
        const e = byClient.get(c.id)!;
        return { client: { ...c, clientNo: formatNumber('C', c.number) }, patients: patients.filter((p) => e.patientIds.has(p.id)).map((p) => p.name), vet: e.vet, since: e.since, charges: e.charges, totalMinor: e.totalMinor, prescribed: e.prescribed };
      })
      .sort((a, b) => b.since.getTime() - a.since.getTime());
  }

  /**
   * A client's bill at the counter: everything waiting to be paid (in sections: consultation & services, given in the
   * clinic, medicines handed out at the pharmacy), and the vet's recent prescriptions to read — the cashier adds the
   * medicines the client wants from the shop's stock.
   */
  async bill(clientId: string) {
    const db = this.prisma.db;
    const client = await db.client.findUnique({ where: { id: clientId }, select: { id: true, number: true, displayName: true, mobilePhone: true } });
    if (!client) throw notFound('Client');
    const since = new Date(Date.now() - 30 * 86400_000);
    const [charges, written] = await Promise.all([
      db.charge.findMany({ where: { clientId, status: 'PENDING' }, orderBy: { createdAt: 'asc' } }),
      // The vet's prescriptions of the last 30 days, as the counter reads them (newest first).
      db.prescription.findMany({
        where: { clientId, status: { in: ['AUTHORIZED', 'PARTIALLY_DISPENSED', 'DISPENSED'] }, authorizedAt: { gte: since } },
        include: { items: { include: { product: { select: { id: true, name: true, dispensingUnit: true } } }, orderBy: { createdAt: 'asc' } }, prescriber: { select: { user: { select: { name: true } } } } },
        orderBy: { authorizedAt: 'desc' },
        take: 6,
      }),
    ]);
    const patientIds = [...new Set([...charges.map((c) => c.patientId), ...written.map((r) => r.patientId)].filter((x): x is string => !!x))];
    const patients = await db.patient.findMany({ where: { id: { in: patientIds } }, select: { id: true, name: true } });
    const patientOf = (id: string | null) => patients.find((p) => p.id === id) ?? null;
    return {
      client: { ...client, clientNo: formatNumber('C', client.number) },
      charges: charges.map((c) => ({
        id: c.id,
        kind: c.kind,
        description: c.description,
        quantity: Number(c.quantity),
        unitPriceMinor: c.unitPriceMinor,
        taxRateBasisPoints: c.taxRateBasisPoints,
        discountMinor: c.discountMinor,
        discountNote: c.discountNote,
        sourceType: c.sourceType,
        sourceId: c.sourceId,
        section: chargeSection(c.sourceType),
        clientId: c.clientId,
        patient: patientOf(c.patientId),
        createdAt: c.createdAt,
      })),
      prescriptions: written.map((rx) => ({
        id: rx.id,
        prescriptionNo: formatNumber('RX', rx.number),
        status: rx.status,
        authorizedAt: rx.authorizedAt,
        validUntil: rx.validUntil,
        patient: patientOf(rx.patientId),
        prescriber: rx.prescriber?.user.name ?? null,
        notes: rx.notes ?? null,
        items: rx.items.map((i) => ({
          id: i.id,
          name: i.product?.name ?? i.outsideName ?? 'Medicine',
          productId: i.product?.id ?? null,
          instructions: i.instructions,
          quantity: Number(i.quantity),
          unit: i.product?.dispensingUnit ?? i.doseUnit,
          repeats: i.repeats,
          handedOut: Number(i.quantityDispensed),
        })),
      })),
    };
  }

  async catalog(q: { q?: string; category?: string; categoryId?: string; limit: number }): Promise<{
    items: PosItem[];
    exact: PosItem | null;
    allowNegativeStock: boolean;
    /** The clinic lets prescription-only items be sold without a prescription (with a note). */
    sellWithoutPrescription: boolean;
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
    const org = await this.prisma.raw.organization.findUniqueOrThrow({ where: { id: ctx.organizationId! }, select: { allowNegativeStock: true, sellWithoutPrescription: true } });
    const [products, services, rates, sellable] = await Promise.all([
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
      // Types with something sellable here: priced, active, and not a prescription-only medicine or vaccine.
      db.product.findMany({
        where: { isActive: true, sellPriceMinor: { not: null }, NOT: { requiresPrescription: true, type: { in: ['MEDICINE', 'VACCINE'] }, ...(org.sellWithoutPrescription ? { isControlled: true } : {}) } },
        distinct: ['type'],
        select: { type: true },
      }),
    ]);
    const defaultBp = rates.find((r) => r.isDefault)?.rateBasisPoints ?? 0;
    const bp = (id: string | null) => rates.find((r) => r.id === id)?.rateBasisPoints ?? defaultBp;

    // Usable stock (available status, not expired) at the branch's default location, once its stock is set up.
    const location = ctx.branchId ? await this.inventory.trackingLocation(db, ctx.branchId) : null;
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
        controlled: p.isControlled,
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
        controlled: false,
      })),
    ];
    // A scanned barcode or typed SKU/service code that identifies exactly one item.
    const exactMatches = term ? items.filter((i) => i.barcode === term || i.code?.toLowerCase() === term.toLowerCase()) : [];
    return {
      items,
      exact: exactMatches.length === 1 ? exactMatches[0] : null,
      allowNegativeStock: org.allowNegativeStock,
      sellWithoutPrescription: org.sellWithoutPrescription,
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
