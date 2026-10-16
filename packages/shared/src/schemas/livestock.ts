import { z } from 'zod';
import {
  ANIMAL_GROUP_KINDS,
  BREEDING_EVENT_TYPES,
  FARM_STATUSES,
  GROUP_TREATMENT_KINDS,
  OUTBREAK_STATUSES,
  PATIENT_SEXES,
  PREGNANCY_RESULTS,
  PRODUCTION_KINDS,
  PRODUCTION_PURPOSES,
} from '../enums';
import { optDate, optInt, optText, optUuid, reqText } from './common';

const optDecimal = (min: number, max: number) =>
  z.preprocess((v) => (v === '' ? null : v), z.coerce.number().min(min).max(max).nullish()) as z.ZodType<number | null | undefined, z.ZodTypeDef, unknown>;
const reason = reqText(500);

// ── Farms & groups ──
export const farmSchema = z.object({
  clientId: z.string().uuid(),
  name: reqText(160),
  registrationNumber: optText(80),
  address: optText(300),
  district: optText(120),
  latitude: optDecimal(-90, 90),
  longitude: optDecimal(-180, 180),
  areaHectares: optDecimal(0, 1_000_000),
  notes: optText(2000),
  status: z.enum(FARM_STATUSES).default('ACTIVE'),
});
export const updateFarmSchema = farmSchema.partial().omit({ clientId: true });

export const animalGroupSchema = z
  .object({
    farmId: z.string().uuid(),
    name: reqText(80),
    kind: z.enum(ANIMAL_GROUP_KINDS),
    speciesId: z.string().uuid(),
    purpose: z.enum(PRODUCTION_PURPOSES).default('MIXED'),
    tracksIndividuals: z.boolean().default(true),
    /** Batch groups only: number of animals placed. */
    initialCount: optInt(1, 10_000_000),
    placedOn: optDate(),
    breedText: optText(120),
    location: optText(120),
    notes: optText(2000),
  })
  .refine((g) => g.tracksIndividuals || (g.initialCount ?? 0) > 0, { message: 'Enter how many animals were placed', path: ['initialCount'] });
export const updateGroupSchema = z.object({
  name: reqText(80).optional(),
  purpose: z.enum(PRODUCTION_PURPOSES).optional(),
  breedText: optText(120),
  location: optText(120),
  notes: optText(2000),
});
export const closeGroupSchema = z.object({ reason });

/** Registers several tagged animals into a group in one go (e.g. a newly purchased herd). */
export const bulkAnimalsSchema = z.object({
  groupId: z.string().uuid(),
  breedText: optText(120),
  source: z.enum(['PURCHASE', 'BIRTH', 'EXISTING']).default('EXISTING'),
  counterparty: optText(160),
  animals: z
    .array(
      z.object({
        tag: z.string().trim().min(1, 'Tag required').max(40),
        name: optText(80),
        sex: z.enum(PATIENT_SEXES).default('UNKNOWN'),
        dateOfBirth: optDate(),
      }),
    )
    .min(1)
    .max(500),
});

export const assignAnimalSchema = z.object({ patientId: z.string().uuid(), farmId: optUuid(), groupId: optUuid() });

export const movementSchema = z
  .object({
    type: z.enum(['MOVE', 'SALE', 'TRANSFER', 'DEATH', 'CULL']),
    /** Individual animal, or a head count from a batch group. */
    patientIds: z.array(z.string().uuid()).max(500).default([]),
    groupId: optUuid(),
    headCount: optInt(1, 10_000_000),
    toGroupId: optUuid(),
    occurredAt: z.coerce.date(),
    counterparty: optText(160),
    priceMinor: optInt(0, 2_000_000_000),
    reason: optText(500),
  })
  .refine((m) => m.patientIds.length > 0 || (m.groupId && m.headCount), { message: 'Choose the animals, or a batch and how many', path: ['patientIds'] })
  .refine((m) => m.type !== 'MOVE' || !!m.toGroupId, { message: 'Choose the group to move to', path: ['toGroupId'] })
  .refine((m) => !['DEATH', 'CULL'].includes(m.type) || !!m.reason, { message: 'Record the cause or reason', path: ['reason'] });

// ── Breeding ──
export const breedingEventSchema = z
  .object({
    patientId: z.string().uuid(),
    type: z.enum(BREEDING_EVENT_TYPES),
    occurredAt: z.coerce.date(),
    sireId: optUuid(),
    sireText: optText(120),
    semenBatch: optText(80),
    technician: optText(120),
    method: optText(120),
    result: z.enum(PREGNANCY_RESULTS).nullish(),
    expectedDueDate: optDate(),
    notes: optText(2000),
    /** Births: the offspring to register (tag numbers are recorded as ear tags). */
    offspring: z
      .array(z.object({ tag: optText(40), name: optText(80), sex: z.enum(PATIENT_SEXES).default('UNKNOWN'), alive: z.boolean().default(true) }))
      .max(20)
      .default([]),
  })
  .refine((e) => e.type !== 'PREGNANCY_CHECK' || !!e.result, { message: 'Record the result', path: ['result'] })
  .refine((e) => e.type !== 'BIRTH' || e.offspring.length > 0, { message: 'Add at least one calf/kid/lamb (alive or stillborn)', path: ['offspring'] });

export const gestationSchema = z.object({
  gestationDays: optInt(10, 500),
  gestationSource: optText(300),
}).refine((g) => g.gestationDays == null || !!g.gestationSource, { message: 'Record where this figure comes from', path: ['gestationSource'] });

// ── Production ──
export const productionSchema = z
  .object({
    farmId: z.string().uuid(),
    kind: z.enum(PRODUCTION_KINDS),
    patientId: optUuid(),
    groupId: optUuid(),
    recordedOn: z.coerce.date(),
    quantity: z.coerce.number().min(0).max(100_000_000),
    unit: optText(20),
    session: optText(20),
    notes: optText(500),
  })
  .refine((p) => !['BATCH_WEIGHT', 'MORTALITY'].includes(p.kind) || !!p.groupId, { message: 'Choose the batch', path: ['groupId'] })
  .refine((p) => p.kind !== 'MORTALITY' || Number.isInteger(p.quantity), { message: 'Mortality is a whole number of animals', path: ['quantity'] });
/** Milk recording for several animals at once (one row per animal). */
export const milkSheetSchema = z.object({
  farmId: z.string().uuid(),
  recordedOn: z.coerce.date(),
  session: optText(20),
  entries: z.array(z.object({ patientId: z.string().uuid(), quantity: z.coerce.number().min(0).max(200) })).min(1).max(1000),
});

// ── Group treatments & outbreaks ──
export const groupTreatmentSchema = z.object({
  farmId: z.string().uuid(),
  groupId: optUuid(),
  fieldVisitId: optUuid(),
  kind: z.enum(GROUP_TREATMENT_KINDS),
  productId: optUuid(),
  productName: optText(160),
  batchNumber: optText(60),
  route: optText(60),
  dosePerHead: optText(120),
  headCount: z.coerce.number().int().min(1).max(10_000_000),
  /** Stock to deduct (in the product's dispensing unit). Leave empty if supplied by the farmer. */
  quantityIssued: optDecimal(0.0001, 1_000_000),
  /** Bill the product to the farm owner at its sell price. */
  charge: z.boolean().default(true),
  administeredAt: z.coerce.date(),
  notes: optText(2000),
}).refine((t) => !!t.productId || !!t.productName, { message: 'Choose a product or enter what was given', path: ['productId'] });

export const outbreakSchema = z.object({
  farmId: z.string().uuid(),
  groupId: optUuid(),
  disease: reqText(160),
  notifiable: z.boolean().default(false),
  status: z.enum(OUTBREAK_STATUSES).default('SUSPECTED'),
  firstSeenOn: z.coerce.date(),
  confirmedOn: optDate(),
  diagnosisMethod: optText(300),
  populationAtRisk: optInt(0, 100_000_000),
  affectedCount: z.coerce.number().int().min(0).max(100_000_000).default(0),
  deathCount: z.coerce.number().int().min(0).max(100_000_000).default(0),
  controlMeasures: optText(4000),
  reportedToAuthorityOn: optDate(),
  authorityReference: optText(120),
  notes: optText(4000),
});
export const updateOutbreakSchema = outbreakSchema.partial().omit({ farmId: true }).extend({ closedOn: optDate() });

// ── Field visits ──
export const fieldVisitSchema = z.object({
  farmId: z.string().uuid(),
  appointmentId: optUuid(),
  branchId: optUuid(),
  clinicianId: optUuid(),
  scheduledAt: z.coerce.date(),
  purpose: reqText(300),
  calloutServiceId: optUuid(),
});
export const updateFieldVisitSchema = z.object({
  clinicianId: optUuid(),
  scheduledAt: z.coerce.date().optional(),
  purpose: reqText(300).optional(),
  calloutServiceId: optUuid(),
  distanceKm: optDecimal(0, 10_000),
  findings: optText(10_000),
  recommendations: optText(10_000),
});
export const fieldVisitItemSchema = z
  .object({
    serviceId: optUuid(),
    productId: optUuid(),
    patientId: optUuid(),
    quantity: z.coerce.number().positive().max(100_000),
    /** Price override (minor units). Defaults to the catalogue price. */
    unitPriceMinor: optInt(0, 2_000_000_000),
    description: optText(200),
  })
  .refine((i) => !!i.serviceId !== !!i.productId, { message: 'Choose a service or a product', path: ['serviceId'] });
export const completeFieldVisitSchema = z.object({ findings: reqText(10_000), recommendations: optText(10_000), distanceKm: optDecimal(0, 10_000) });
export const cancelSchema = z.object({ reason });
