import { z } from 'zod';
import { DIAGNOSIS_STATUSES, DIAGNOSIS_TYPES, ENCOUNTER_TYPES, PROBLEM_STATUSES, SPECIES_CATEGORIES, TASK_TYPES } from '../enums';
import { optDate, optText, optUuid, paginationQuery, reqText } from './common';

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

/**
 * Plausibility limits for typed-in vital signs. These guard against typing mistakes (398 instead of 39.8);
 * they are NOT normal ranges — those are clinic-configured, sourced references (VitalReference).
 */
export const VITAL_BOUNDS = {
  temperatureC: { label: 'Temperature', unit: '°C', min: 25, max: 46, int: false },
  heartRate: { label: 'Heart rate', unit: 'beats/min', min: 0, max: 400, int: true },
  respiratoryRate: { label: 'Breathing rate', unit: 'breaths/min', min: 0, max: 200, int: true },
  weightKg: { label: 'Weight', unit: 'kg', min: 0.001, max: 5000, int: false },
  capillaryRefillSec: { label: 'Gum refill time (CRT)', unit: 'seconds', min: 0, max: 10, int: false },
  painScore: { label: 'Pain score', unit: '', min: 0, max: 10, int: true },
  systolicBp: { label: 'Blood pressure — systolic', unit: 'mmHg', min: 0, max: 400, int: true },
  diastolicBp: { label: 'Blood pressure — diastolic', unit: 'mmHg', min: 0, max: 300, int: true },
  meanBp: { label: 'Blood pressure — mean', unit: 'mmHg', min: 0, max: 300, int: true },
  spo2: { label: 'Oxygen level (SpO₂)', unit: '%', min: 0, max: 100, int: true },
  hydrationPercent: { label: 'Dehydration', unit: '%', min: 0, max: 20, int: false },
} as const;
export type VitalKey = keyof typeof VITAL_BOUNDS;

/** "Temperature must be between 25 and 46 °C". */
export function vitalRangeMessage(key: VitalKey) {
  const b = VITAL_BOUNDS[key];
  return `${b.label} must be between ${b.min} and ${b.max}${b.unit ? ` ${b.unit}` : ''}`;
}

/**
 * Checks one typed value against the plausibility limits. Returns null when it is fine, otherwise a message
 * and, when the value looks like a missing decimal point (398 → 39.8), the value that was probably meant.
 */
export function checkVital(key: VitalKey, raw: string | number | null | undefined): { message: string; suggestion: number | null } | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const b = VITAL_BOUNDS[key];
  const v = Number(raw);
  if (!Number.isFinite(v)) return { message: `${b.label} must be a number`, suggestion: null };
  if (b.int && !Number.isInteger(v)) return { message: `${b.label} must be a whole number`, suggestion: null };
  if (v >= b.min && v <= b.max) return null;
  let suggestion: number | null = null;
  if (!b.int) {
    for (const d of [10, 100]) {
      const c = Math.round((v / d) * 1000) / 1000;
      if (c >= b.min && c <= b.max && c > 0) {
        suggestion = c;
        break;
      }
    }
  }
  return { message: vitalRangeMessage(key), suggestion };
}

const vital = (key: VitalKey) => {
  const b = VITAL_BOUNDS[key];
  let n = z.coerce.number({ invalid_type_error: `${b.label} must be a number` });
  if (b.int) n = n.int(`${b.label} must be a whole number`);
  return z.preprocess((v) => (v === '' ? null : v), n.min(b.min, vitalRangeMessage(key)).max(b.max, vitalRangeMessage(key)).nullish()) as z.ZodType<
    number | null | undefined,
    z.ZodTypeDef,
    unknown
  >;
};

export const vitalsSchema = z.object({
  recordedAt: optDate(),
  temperatureC: vital('temperatureC'),
  heartRate: vital('heartRate'),
  respiratoryRate: vital('respiratoryRate'),
  weightKg: vital('weightKg'),
  mucousMembranes: optText(40),
  capillaryRefillSec: vital('capillaryRefillSec'),
  painScore: vital('painScore'),
  systolicBp: vital('systolicBp'),
  diastolicBp: vital('diastolicBp'),
  meanBp: vital('meanBp'),
  spo2: vital('spo2'),
  hydrationPercent: vital('hydrationPercent'),
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
