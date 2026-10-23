import { z } from 'zod';
import { DOSAGE_FORMS, PRODUCT_TYPES, SPECIES_CATEGORIES } from '../enums';
import { optDate, optInt, optText, optUuid, paginationQuery, reqText } from './common';

const optDec = (min = 0) =>
  z.preprocess((v) => (v === '' ? null : v), z.coerce.number().min(min).nullish()) as z.ZodType<number | null | undefined, z.ZodTypeDef, unknown>;

export const productSchema = z.object({
  sku: optText(60),
  barcode: optText(60),
  name: reqText(160),
  genericName: optText(160),
  type: z.enum(PRODUCT_TYPES).default('MEDICINE'),
  categoryId: optUuid(),
  brand: optText(80),
  packSize: optText(40),
  form: z.enum(DOSAGE_FORMS).nullish(),
  strengthValue: optDec(0),
  strengthUnit: optText(20),
  dispensingUnit: reqText(20),
  minDispenseIncrement: z.coerce.number().positive().max(1000).default(1),
  activeIngredients: z.array(z.string().trim().min(1).max(80)).max(10).default([]),
  /** Drug class / family (e.g. "Penicillins", "NSAIDs"); used with the ingredients for allergy checks. */
  drugClass: optText(120),
  manufacturer: optText(120),
  requiresPrescription: z.boolean().default(true),
  isControlled: z.boolean().default(false),
  controlledSchedule: optText(40),
  targetSpecies: z.array(z.enum(SPECIES_CATEGORIES)).default([]),
  sellPriceMinor: optInt(0, 1_000_000_000),
  notes: optText(2000),
  isActive: z.boolean().default(true),
});
export type ProductInput = z.infer<typeof productSchema>;

/**
 * Clinic prescribing preferences. `confirmUnitsPerDoseAbove` is a data-entry safety prompt ("This is 9 tablets
 * per dose — is that correct?"), not a dose limit: the prescriber confirms and may continue.
 */
export const pharmacySettingsSchema = z.object({
  confirmUnitsPerDoseAbove: z.coerce.number().int().min(1).max(1000),
});

export const productListQuery = paginationQuery.extend({
  type: z.enum(PRODUCT_TYPES).optional(),
  /** clinical = medicines and vaccines; shop = everything else. */
  kind: z.enum(['clinical', 'shop']).optional(),
  categoryId: z.string().uuid().optional(),
  active: z.enum(['true', 'false', 'all']).default('true'),
  prescribable: z.coerce.boolean().optional(),
});

export const withdrawalSchema = z.object({
  speciesId: z.string().uuid(),
  meatDays: optInt(0, 3650),
  milkHours: optInt(0, 10000),
  eggDays: optInt(0, 3650),
  source: reqText(300),
});

export const doseReferenceSchema = z
  .object({
    productId: z.string().uuid(),
    speciesId: z.string().uuid(),
    indication: optText(200),
    route: reqText(30),
    doseMin: z.coerce.number().min(0),
    doseMax: z.coerce.number().min(0),
    doseUnit: reqText(30),
    frequency: optText(80),
    maxPerDose: optDec(0),
    notes: optText(1000),
    source: reqText(400),
  })
  .refine((v) => v.doseMax >= v.doseMin, { path: ['doseMax'], message: 'Maximum must be ≥ minimum' });

export const prescriptionItemSchema = z.object({
  productId: z.string().uuid(),
  route: reqText(30),
  doseValue: z.coerce.number().positive(),
  doseUnit: reqText(30),
  frequencyCode: reqText(20),
  durationDays: optInt(1, 365),
  /** Optional manual quantity (otherwise calculated from dose × frequency × duration). */
  quantity: optDec(0.0001),
  repeats: z.coerce.number().int().min(0).max(12).default(0),
  instructions: reqText(1000),
  doseReferenceId: optUuid(),
  rounding: z.enum(['nearest', 'down', 'up']).default('nearest'),
  /** Required when the system raises warnings (allergy, off-range dose, species). */
  overrideReason: optText(500),
});
export type PrescriptionItemInput = z.infer<typeof prescriptionItemSchema>;

export const createPrescriptionSchema = z.object({
  patientId: z.string().uuid(),
  encounterId: optUuid(),
  weightKg: optDec(0.001),
  notes: optText(2000),
  validUntil: optDate(),
  items: z.array(prescriptionItemSchema).min(1).max(20),
  authorize: z.boolean().default(false),
});
export type CreatePrescriptionInput = z.infer<typeof createPrescriptionSchema>;

export const prescriptionListQuery = paginationQuery.extend({
  status: z.string().optional(),
  clientId: z.string().uuid().optional(),
  patientId: z.string().uuid().optional(),
  encounterId: z.string().uuid().optional(),
});

export const dispenseSchema = z.object({
  lines: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        quantity: z.coerce.number().positive(),
        batchNumber: optText(60),
        expiryDate: optDate(),
      }),
    )
    .min(1)
    .max(20),
  notes: optText(1000),
});

export const administrationSchema = z.object({
  patientId: z.string().uuid(),
  encounterId: optUuid(),
  productId: z.string().uuid(),
  prescriptionItemId: optUuid(),
  status: z.enum(['GIVEN', 'NOT_GIVEN']).default('GIVEN'),
  dose: z.coerce.number().positive(),
  doseUnit: reqText(20),
  route: reqText(30),
  site: optText(80),
  batchNumber: optText(60),
  expiryDate: optDate(),
  reasonNotGiven: optText(300),
  notes: optText(1000),
  administeredAt: optDate(),
  overrideReason: optText(500),
  /**
   * How much to bill, in the product's selling unit (e.g. 1 dose, 2 tablets). Left out = worked out from the
   * dose (1 when it cannot be); 0 = given free of charge.
   */
  billQuantity: z.preprocess((v) => (v === '' ? undefined : v), z.coerce.number().min(0).max(100000).optional()),
});

export const productCategorySchema = z.object({
  name: reqText(60),
  productType: z.enum(PRODUCT_TYPES).nullish(),
  sortOrder: z.coerce.number().int().min(0).max(10000).default(0),
  isActive: z.boolean().default(true),
});

export const productPhotoSchema = z.object({ attachmentId: z.string().uuid().nullable() });
