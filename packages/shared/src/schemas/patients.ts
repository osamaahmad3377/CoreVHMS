import { z } from 'zod';
import { ALERT_SEVERITIES, ALERT_TYPES, IDENTIFIER_TYPES, PATIENT_SEXES, SPECIES_CATEGORIES } from '../enums';
import { optDate, optInt, optPositive, optText, optUuid, paginationQuery, reqText } from './common';

export const identifierSchema = z.object({
  type: z.enum(IDENTIFIER_TYPES),
  value: z.string().trim().min(1).max(64),
  issuedAt: optDate(),
  notes: optText(200),
});
export type IdentifierInput = z.infer<typeof identifierSchema>;

const patientBase = z.object({
  name: reqText(80),
  speciesId: z.string().uuid(),
  breedId: optUuid(),
  breedText: optText(120),
  sex: z.enum(PATIENT_SEXES).default('UNKNOWN'),
  colour: optText(80),
  markings: optText(300),
  dateOfBirth: optDate(),
  dobEstimated: z.boolean().default(false),
  bloodType: optText(20),
  insuranceProvider: optText(120),
  insurancePolicyNumber: optText(80),
  notes: optText(4000),
  primaryBranchId: optUuid(),
  herdId: optUuid(),
});

export const createPatientSchema = patientBase.extend({
  ownerId: z.string({ required_error: 'Select the owner' }).uuid('Select the owner'),
  identifiers: z.array(identifierSchema).max(10).default([]),
  initialWeightKg: optPositive(5000),
});
export type CreatePatientInput = z.infer<typeof createPatientSchema>;

export const updatePatientSchema = patientBase.partial();
export type UpdatePatientInput = z.infer<typeof updatePatientSchema>;

export const patientListQuery = paginationQuery.extend({
  status: z.enum(['ACTIVE', 'DECEASED', 'TRANSFERRED', 'ARCHIVED', 'ALL']).default('ACTIVE'),
  speciesId: z.string().uuid().optional(),
  ownerId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
});
export type PatientListQuery = z.infer<typeof patientListQuery>;

export const weightSchema = z.object({
  weightKg: z.coerce.number().positive().max(5000),
  bodyConditionScore: optInt(1, 9),
  bcsScale: z.enum(['5', '9']).default('9'),
  measuredAt: optDate(),
  notes: optText(300),
});
export type WeightInput = z.infer<typeof weightSchema>;

export const alertSchema = z.object({
  type: z.enum(ALERT_TYPES),
  severity: z.enum(ALERT_SEVERITIES).default('WARNING'),
  title: reqText(120),
  details: optText(1000),
  substance: optText(120),
  reaction: optText(300),
  isActive: z.boolean().default(true),
});
export type AlertInput = z.infer<typeof alertSchema>;

export const deceasedSchema = z.object({
  deceasedAt: z.coerce.date(),
  causeOfDeath: optText(500),
  euthanasia: z.boolean().default(false),
  aftercare: optText(300),
});

export const transferOwnershipSchema = z.object({
  newOwnerId: z.string().uuid(),
  reason: reqText(500),
  effectiveAt: optDate(),
});

export const mergePatientsSchema = z.object({
  survivorId: z.string().uuid(),
  mergedId: z.string().uuid(),
  reason: reqText(500),
});

export const speciesSchema = z.object({
  name: reqText(80),
  category: z.enum(SPECIES_CATEGORIES),
  isActive: z.boolean().default(true),
});

export const breedSchema = z.object({
  speciesId: z.string().uuid(),
  name: reqText(120),
});
