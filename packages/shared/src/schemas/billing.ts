import { z } from 'zod';
import { EXPENSE_CATEGORIES, PAYMENT_METHODS, SERVICE_CATEGORIES } from '../enums';
import { optDate, optText, optUuid, paginationQuery, reqText } from './common';

export const taxRateSchema = z.object({
  name: reqText(60),
  rateBasisPoints: z.coerce.number().int().min(0).max(10000),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export const serviceSchema = z.object({
  code: z.string().trim().toUpperCase().min(1).max(30),
  name: reqText(160),
  category: z.enum(SERVICE_CATEGORIES).default('OTHER'),
  priceMinor: z.coerce.number().int().min(0),
  taxRateId: optUuid(),
  isActive: z.boolean().default(true),
});

export const lineSchema = z
  .object({
    kind: z.enum(['SERVICE', 'PRODUCT', 'LAB', 'CUSTOM']),
    serviceId: optUuid(),
    productId: optUuid(),
    labTestId: optUuid(),
    description: optText(300),
    quantity: z.coerce.number().positive().max(1_000_000),
    unitPriceMinor: z.coerce.number().int().min(0).optional(),
    discountMinor: z.coerce.number().int().min(0).default(0),
    taxRateBasisPoints: z.coerce.number().int().min(0).max(10000).optional(),
    /** Who approved selling a prescription-only item without a prescription (needed only for those items). */
    withoutPrescriptionNote: optText(200),
  })
  .refine((l) => l.kind !== 'SERVICE' || !!l.serviceId, { path: ['serviceId'], message: 'Choose a service' })
  .refine((l) => l.kind !== 'PRODUCT' || !!l.productId, { path: ['productId'], message: 'Choose a product' })
  .refine((l) => l.kind !== 'CUSTOM' || (!!l.description && l.unitPriceMinor !== undefined), { path: ['description'], message: 'Describe the item and give a price' });
export type LineInputBody = z.infer<typeof lineSchema>;

export const createInvoiceSchema = z.object({
  clientId: optUuid(),
  patientId: optUuid(),
  encounterId: optUuid(),
  chargeIds: z.array(z.string().uuid()).max(500).default([]),
  lines: z.array(lineSchema).max(200).default([]),
  notes: optText(2000),
  isPos: z.boolean().default(false),
  issue: z.boolean().default(false),
});

export const updateInvoiceSchema = z.object({
  lines: z.array(lineSchema).max(200).optional(),
  addChargeIds: z.array(z.string().uuid()).max(500).optional(),
  removeLineIds: z.array(z.string().uuid()).max(500).optional(),
  notes: optText(2000),
  patientId: optUuid(),
});

export const invoiceListQuery = paginationQuery.extend({
  status: z.string().optional(),
  clientId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  overdue: z.coerce.boolean().optional(),
});

export const paymentSchema = z.object({
  clientId: optUuid(),
  amountMinor: z.coerce.number().int().positive(),
  method: z.enum(PAYMENT_METHODS),
  reference: optText(120),
  notes: optText(500),
  /** Allocation to invoices; any remainder becomes client credit. */
  allocations: z.array(z.object({ invoiceId: z.string().uuid(), amountMinor: z.coerce.number().int().positive() })).max(100).default([]),
  /** Client-generated key so a retried request cannot take payment twice. */
  idempotencyKey: z.string().min(8).max(100).optional(),
});

export const allocateSchema = z.object({ allocations: z.array(z.object({ invoiceId: z.string().uuid(), amountMinor: z.coerce.number().int().positive() })).min(1).max(100) });

export const refundSchema = z.object({
  amountMinor: z.coerce.number().int().positive(),
  method: z.enum(PAYMENT_METHODS),
  reason: reqText(500),
});

export const creditNoteSchema = z.object({ amountMinor: z.coerce.number().int().positive(), reason: reqText(500) });
export const voidSchema = z.object({ reason: reqText(500) });
export const waiveSchema = z.object({ reason: reqText(500) });

export const chargeListQuery = paginationQuery.extend({
  status: z.enum(['PENDING', 'INVOICED', 'WAIVED', 'ALL']).default('PENDING'),
  clientId: z.string().uuid().optional(),
  patientId: z.string().uuid().optional(),
  encounterId: z.string().uuid().optional(),
});

export const estimateSchema = z.object({
  clientId: z.string().uuid(),
  patientId: optUuid(),
  validUntil: optDate(),
  notes: optText(2000),
  lines: z.array(lineSchema).min(1).max(200),
});

export const openSessionSchema = z.object({ registerId: z.string().uuid(), openingFloatMinor: z.coerce.number().int().min(0) });
export const closeSessionSchema = z.object({ countedCashMinor: z.coerce.number().int().min(0), notes: optText(500) });
export const registerSchema = z.object({ branchId: z.string().uuid(), name: reqText(60) });

export const expenseSchema = z.object({
  date: z.coerce.date(),
  category: z.enum(EXPENSE_CATEGORIES),
  description: reqText(300),
  amountMinor: z.coerce.number().int().positive(),
  taxMinor: z.coerce.number().int().min(0).default(0),
  supplierId: optUuid(),
  method: z.enum(PAYMENT_METHODS),
  reference: optText(120),
});

export const reportQuery = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  branchId: z.string().uuid().optional(),
  format: z.enum(['json', 'csv']).default('json'),
});

/** Receipt layout and printing options (Settings → Receipts & printing). */
export const receiptSettingsSchema = z.object({
  paperWidthMm: z.union([z.literal(58), z.literal(80)]),
  sideMarginMm: z.coerce.number().int().min(0).max(8),
  fontSize: z.enum(['SMALL', 'NORMAL', 'LARGE']),
  showLogo: z.boolean(),
  logoSource: z.enum(['BRANDING', 'CUSTOM']),
  customLogoAttachmentId: z.string().uuid().nullable(),
  logoWidthPercent: z.coerce.number().int().min(15).max(100),
  logoAlign: z.enum(['LEFT', 'CENTER', 'RIGHT']),
  logoMonochrome: z.boolean(),
  title: z.string().trim().min(1).max(60),
  headerText: z.string().trim().max(300).nullable(),
  footerText: z.string().trim().max(300).nullable(),
  policyText: z.string().trim().max(600).nullable(),
  showLegalName: z.boolean(),
  showBranchAddress: z.boolean(),
  showPhone: z.boolean(),
  showEmail: z.boolean(),
  showTaxNumber: z.boolean(),
  showServedBy: z.boolean(),
  showCustomer: z.boolean(),
  showPatient: z.boolean(),
  showItemCodes: z.boolean(),
  showTaxLine: z.boolean(),
  autoPrint: z.boolean(),
  copies: z.coerce.number().int().min(1).max(3),
});
export type ReceiptSettingsInput = z.infer<typeof receiptSettingsSchema>;
