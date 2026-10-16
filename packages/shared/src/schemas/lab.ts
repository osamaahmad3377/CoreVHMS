import { z } from 'zod';
import { IMAGING_MODALITIES, LAB_CATEGORIES, ORDER_PRIORITIES, PATIENT_SEXES, SAMPLE_TYPES } from '../enums';
import { optInt, optText, optUuid, paginationQuery, reqText } from './common';

const optNum = () => z.preprocess((v) => (v === '' ? null : v), z.coerce.number().nullish()) as z.ZodType<number | null | undefined, z.ZodTypeDef, unknown>;

export const analyteSchema = z.object({
  id: z.string().uuid().optional(),
  code: z.string().trim().min(1).max(30),
  name: reqText(120),
  unit: optText(30),
  resultType: z.enum(['NUMERIC', 'TEXT', 'OPTION']).default('NUMERIC'),
  options: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  decimals: z.coerce.number().int().min(0).max(4).default(1),
});

export const labTestSchema = z.object({
  code: z.string().trim().toUpperCase().min(1).max(30),
  name: reqText(160),
  category: z.enum(LAB_CATEGORIES),
  sampleType: z.enum(SAMPLE_TYPES).default('NONE'),
  performedBy: z.enum(['IN_HOUSE', 'EXTERNAL']).default('IN_HOUSE'),
  externalLabName: optText(120),
  modality: z.enum(IMAGING_MODALITIES).nullish(),
  priceMinor: optInt(0, 1_000_000_000),
  turnaroundHours: optInt(0, 2000),
  instructions: optText(1000),
  isActive: z.boolean().default(true),
  analytes: z.array(analyteSchema).max(60).default([]),
});
export type LabTestInput = z.infer<typeof labTestSchema>;

export const referenceIntervalSchema = z
  .object({
    analyteId: z.string().uuid(),
    speciesId: z.string().uuid(),
    sex: z.enum(PATIENT_SEXES).nullish(),
    ageMinMonths: optInt(0, 1200),
    ageMaxMonths: optInt(0, 1200),
    low: optNum(),
    high: optNum(),
    criticalLow: optNum(),
    criticalHigh: optNum(),
    source: reqText(300),
  })
  .refine((v) => v.low == null || v.high == null || v.high >= v.low, { path: ['high'], message: 'High must be ≥ low' })
  .refine((v) => v.low != null || v.high != null || v.criticalLow != null || v.criticalHigh != null, { path: ['low'], message: 'Enter at least one limit' });

export const createOrderSchema = z.object({
  patientId: z.string().uuid(),
  encounterId: optUuid(),
  testIds: z.array(z.string().uuid()).min(1).max(30),
  priority: z.enum(ORDER_PRIORITIES).default('ROUTINE'),
  clinicalNotes: optText(2000),
});

export const orderListQuery = paginationQuery.extend({
  status: z.string().optional(),
  patientId: z.string().uuid().optional(),
  encounterId: z.string().uuid().optional(),
  critical: z.coerce.boolean().optional(),
});

export const collectSampleSchema = z.object({
  sampleType: z.enum(SAMPLE_TYPES),
  notes: optText(500),
});

export const sampleActionSchema = z.object({
  action: z.enum(['RECEIVED', 'IN_ANALYSIS', 'REJECTED', 'DISPOSED']),
  notes: optText(500),
});

export const enterResultsSchema = z.object({
  results: z
    .array(
      z.object({
        orderItemId: z.string().uuid(),
        analyteId: z.string().uuid(),
        valueNumeric: optNum(),
        valueText: optText(2000),
        comment: optText(500),
      }),
    )
    .min(1)
    .max(200),
  externalReference: optText(80),
});

export const amendResultSchema = z.object({
  valueNumeric: optNum(),
  valueText: optText(2000),
  comment: optText(500),
  amendmentReason: reqText(500),
});

export const imagingReportSchema = z.object({
  modality: z.enum(IMAGING_MODALITIES),
  bodyRegion: optText(120),
  views: optText(200),
  findings: reqText(8000),
  conclusion: reqText(4000),
  recommendations: optText(2000),
  studyInstanceUid: optText(128),
});
