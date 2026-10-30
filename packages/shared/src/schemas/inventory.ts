import { z } from 'zod';
import { ADJUSTMENT_REASONS, LOCATION_TYPES } from '../enums';
import { optDate, optText, optUuid, paginationQuery, reqText } from './common';

const qty = () => z.coerce.number().positive().max(10_000_000);

export const locationSchema = z.object({
  branchId: z.string().uuid(),
  name: reqText(80),
  type: z.enum(LOCATION_TYPES).default('STORE'),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export const stockListQuery = paginationQuery.extend({
  locationId: z.string().uuid().optional(),
  lowStock: z.coerce.boolean().optional(),
  expiringDays: z.coerce.number().int().min(0).max(3650).optional(),
});

/**
 * Goods receipt (delivery). Without a supplier the delivery is recorded against the clinic's "Local purchase"
 * supplier. Batch number and expiry are required for medicines and vaccines (checked by the API); other products
 * may leave them blank and are kept in an automatic no-batch batch.
 */
export const receiveStockSchema = z.object({
  supplierId: optUuid(),
  locationId: z.string().uuid(),
  purchaseOrderId: optUuid(),
  supplierInvoiceNo: optText(80),
  notes: optText(1000),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        purchaseOrderLineId: optUuid(),
        batchNumber: optText(60),
        expiryDate: optDate(),
        quantity: qty(),
        unitCostMinor: z.coerce.number().int().min(0),
      }),
    )
    .min(1)
    .max(200),
});

export const adjustmentSchema = z.object({
  batchId: z.string().uuid(),
  locationId: z.string().uuid(),
  /** Signed: negative removes stock. */
  quantity: z.coerce.number().refine((v) => v !== 0, 'Quantity cannot be zero'),
  reason: z.enum(ADJUSTMENT_REASONS),
  notes: optText(500),
});

export const transferSchema = z.object({
  batchId: z.string().uuid(),
  fromLocationId: z.string().uuid(),
  toLocationId: z.string().uuid(),
  quantity: qty(),
  notes: optText(500),
});

export const batchStatusSchema = z.object({
  status: z.enum(['AVAILABLE', 'QUARANTINED', 'RECALLED']),
  reason: optText(300),
});

export const supplierSchema = z.object({
  name: reqText(160),
  contactName: optText(120),
  email: optText(160),
  phone: optText(40),
  address: optText(300),
  taxNumber: optText(60),
  paymentTermsDays: z.coerce.number().int().min(0).max(365).default(30),
  notes: optText(1000),
  isActive: z.boolean().default(true),
});

export const purchaseOrderSchema = z.object({
  supplierId: z.string().uuid(),
  locationId: z.string().uuid(),
  expectedAt: optDate(),
  notes: optText(1000),
  lines: z.array(z.object({ productId: z.string().uuid(), quantity: qty(), unitCostMinor: z.coerce.number().int().min(0) })).min(1).max(200),
});

export const purchaseRequestSchema = z.object({
  productId: z.string().uuid(),
  quantity: qty(),
  reason: optText(500),
  neededBy: optDate(),
});

export const purchaseRequestDecisionSchema = z.object({ note: z.string().trim().min(3).max(500) });

/**
 * Turns open requests into one draft purchase order. Requests for the same product become one line. Unit costs
 * default to the last price paid for the product and can be given per product.
 */
export const purchaseRequestsToOrderSchema = z.object({
  requestIds: z.array(z.string().uuid()).min(1).max(200),
  supplierId: z.string().uuid(),
  locationId: z.string().uuid(),
  expectedAt: optDate(),
  notes: optText(1000),
  unitCosts: z.array(z.object({ productId: z.string().uuid(), unitCostMinor: z.coerce.number().int().min(0) })).max(200).optional(),
});

export const supplierReturnSchema = z.object({
  supplierId: z.string().uuid(),
  locationId: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
  reference: optText(100),
  lines: z.array(z.object({ batchId: z.string().uuid(), quantity: qty() })).min(1).max(100),
});

export const countLineSchema = z.object({ lines: z.array(z.object({ lineId: z.string().uuid(), countedQty: z.coerce.number().min(0) })).min(1).max(2000) });

// ── Stock forecast ──

export const stockForecastQuery = z.object({
  /** "Runs out within" — next week by default. */
  horizonDays: z.coerce.number().int().min(1).max(60).default(7),
  /** Days until a supplier delivery normally arrives. */
  leadDays: z.coerce.number().int().min(0).max(60).default(3),
  /** Order enough to last this long after it arrives. */
  coverDays: z.coerce.number().int().min(1).max(120).default(14),
  branchId: z.string().uuid().optional(),
});

/** Turns the forecast into draft purchase orders: one per supplier and branch. */
export const prepareOrdersSchema = z.object({
  orders: z
    .array(
      z.object({
        supplierId: z.string().uuid(),
        branchId: z.string().uuid(),
        lines: z.array(z.object({ productId: z.string().uuid(), quantity: qty(), unitCostMinor: z.coerce.number().int().min(0) })).min(1).max(200),
      }),
    )
    .min(1)
    .max(30),
});

/** Moves a product from one branch to another (first-expiring batches first, or one named batch). */
export const branchTransferSchema = z.object({
  productId: z.string().uuid(),
  fromBranchId: z.string().uuid(),
  toBranchId: z.string().uuid(),
  quantity: qty(),
  batchId: z.string().uuid().nullish(),
  notes: optText(300),
});

// ── Disposal of expired, damaged or recalled stock ──

export const DISPOSAL_REASONS = ['EXPIRED', 'SHORT_DATED', 'DAMAGED', 'RECALLED', 'CONTAMINATED', 'OPENED', 'OTHER'] as const;
export type DisposalReason = (typeof DISPOSAL_REASONS)[number];
export const DISPOSAL_REASON_LABELS: Record<DisposalReason, string> = {
  EXPIRED: 'Expired',
  SHORT_DATED: 'Expiring — won’t be used in time',
  DAMAGED: 'Damaged or broken',
  RECALLED: 'Recalled by the manufacturer',
  CONTAMINATED: 'Contaminated or stored wrongly',
  OPENED: 'Opened — past its use-by after opening',
  OTHER: 'Other',
};

export const DISPOSAL_METHODS = ['WASTE_CONTRACTOR', 'INCINERATION', 'DENATURED', 'CLINICAL_WASTE', 'RETURNED_FOR_DESTRUCTION', 'OTHER'] as const;
export type DisposalMethod = (typeof DISPOSAL_METHODS)[number];
export const DISPOSAL_METHOD_LABELS: Record<DisposalMethod, string> = {
  WASTE_CONTRACTOR: 'Collected by a licensed pharmaceutical waste contractor',
  INCINERATION: 'Incinerated',
  DENATURED: 'Denatured on site (controlled-drug denaturing kit)',
  CLINICAL_WASTE: 'Clinical waste / sharps bin',
  RETURNED_FOR_DESTRUCTION: 'Sent to the manufacturer or wholesaler for destruction',
  OTHER: 'Other',
};

/**
 * Disposing of stock: takes the batches off the shelf (a permanent write-off in the stock history) and keeps a
 * disposal record. Controlled medicines need a witness — another member of staff.
 */
export const stockDisposalSchema = z.object({
  locationId: z.string().uuid(),
  reason: z.enum(DISPOSAL_REASONS),
  method: z.enum(DISPOSAL_METHODS),
  contractor: optText(160),
  /** Waste consignment note or collection reference. */
  reference: optText(120),
  witnessMembershipId: z.string().uuid().nullish(),
  notes: optText(1000),
  disposedAt: z.coerce.date().optional(),
  lines: z
    .array(z.object({ batchId: z.string().uuid(), quantity: z.coerce.number().positive('More than 0').max(1_000_000) }))
    .min(1, 'Choose at least one batch')
    .max(200),
}).refine((d) => d.method !== 'WASTE_CONTRACTOR' || !!d.contractor, { path: ['contractor'], message: 'Name the waste contractor' });
export type StockDisposalInput = z.infer<typeof stockDisposalSchema>;

export const disposalCandidatesQuery = z.object({
  locationId: z.string().uuid().optional(),
  /** Stock expiring within this many days is listed too (expired, recalled and quarantined stock always is). */
  days: z.coerce.number().int().min(0).max(365).default(60),
});
