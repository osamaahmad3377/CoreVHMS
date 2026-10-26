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
