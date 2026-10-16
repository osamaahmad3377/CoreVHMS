import { z } from 'zod';
import { DIAGNOSIS_STATUSES, DIAGNOSIS_TYPES, ENCOUNTER_TYPES, PROBLEM_STATUSES, SPECIES_CATEGORIES, TASK_TYPES } from '../enums';
import { optDate, optInt, optText, optUuid, paginationQuery, reqText } from './common';

const optDecimal = (min: number, max: number) =>
  z.preprocess((v) => (v === '' ? null : v), z.coerce.number().min(min).max(max).nullish()) as z.ZodType<number | null | undefined, z.ZodTypeDef, unknown>;

export const startEncounterSchema = z.object({
  patientId: z.string().uuid(),
  appointmentId: optUuid(),
  type: z.enum(ENCOUNTER_TYPES).default('CONSULTATION'),
  chiefComplaint: optText(500),
  clinicianId: optUuid(),
});

export const encounterListQuery = paginationQuery.extend({
  status: z.enum(['OPEN', 'COMPLETED', 'CANCELLED', 'ALL']).default('ALL'),
  patientId: z.string().uuid().optional(),
  clinicianId: z.string().uuid().optional(),
  mine: z.coerce.boolean().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const examFindingSchema = z.object({
  system: z.string().max(60),
  status: z.enum(['NORMAL', 'ABNORMAL', 'NOT_EXAMINED']),
  notes: optText(1000),
});

export const noteContentSchema = z.object({
  presentingComplaint: optText(2000),
  history: optText(8000),
  subjective: optText(8000),
  objective: optText(8000),
  assessment: optText(8000),
  plan: optText(8000),
  followUpInstructions: optText(4000),
  examFindings: z.array(examFindingSchema).max(40).nullish(),
  templateId: optUuid(),
});
export type NoteContentInput = z.infer<typeof noteContentSchema>;

export const amendNoteSchema = noteContentSchema.extend({ amendmentReason: reqText(500) });

export const vitalsSchema = z.object({
  recordedAt: optDate(),
  temperatureC: optDecimal(25, 46),
  heartRate: optInt(0, 400),
  respiratoryRate: optInt(0, 200),
  weightKg: optDecimal(0.001, 5000),
  mucousMembranes: optText(40),
  capillaryRefillSec: optDecimal(0, 10),
  painScore: optInt(0, 10),
  systolicBp: optInt(0, 400),
  diastolicBp: optInt(0, 300),
  meanBp: optInt(0, 300),
  spo2: optInt(0, 100),
  hydrationPercent: optDecimal(0, 20),
  notes: optText(1000),
});
export type VitalsInput = z.infer<typeof vitalsSchema>;

export const diagnosisSchema = z.object({
  term: reqText(200),
  codeSystem: optText(40),
  code: optText(40),
  type: z.enum(DIAGNOSIS_TYPES).default('PROVISIONAL'),
  status: z.enum(DIAGNOSIS_STATUSES).default('ACTIVE'),
  notes: optText(1000),
  addToProblemList: z.boolean().default(false),
});

export const problemSchema = z.object({
  term: reqText(200),
  status: z.enum(PROBLEM_STATUSES).default('ACTIVE'),
  onsetDate: optDate(),
  resolvedDate: optDate(),
  isChronic: z.boolean().default(false),
  notes: optText(1000),
});

export const clinicalTemplateSchema = z.object({
  name: reqText(100),
  speciesCategory: z.enum(SPECIES_CATEGORIES).nullish(),
  presentingComplaint: optText(2000),
  subjective: optText(8000),
  objective: optText(8000),
  assessment: optText(8000),
  plan: optText(8000),
  examSystems: z.array(z.string().max(60)).max(40).default([]),
  isActive: z.boolean().default(true),
});

export const vitalReferenceSchema = z
  .object({
    speciesId: z.string().uuid(),
    parameter: z.string().max(40),
    low: z.coerce.number(),
    high: z.coerce.number(),
    unit: reqText(20),
    source: reqText(300),
  })
  .refine((v) => v.high > v.low, { path: ['high'], message: 'High must be greater than low' });

export const taskSchema = z.object({
  type: z.enum(TASK_TYPES).default('FOLLOW_UP_CALL'),
  title: reqText(200),
  details: optText(2000),
  dueAt: z.coerce.date(),
  patientId: optUuid(),
  clientId: optUuid(),
  encounterId: optUuid(),
  assigneeId: optUuid(),
});

export const taskListQuery = paginationQuery.extend({
  status: z.enum(['OPEN', 'DONE', 'CANCELLED', 'ALL']).default('OPEN'),
  mine: z.coerce.boolean().optional(),
  patientId: z.string().uuid().optional(),
  overdue: z.coerce.boolean().optional(),
});
