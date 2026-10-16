import { z } from 'zod';
import { ADMISSION_OUTCOMES, ASA_GRADES, CHECKLIST_PHASES, CPR_STATUSES, PATIENT_CONDITIONS, SURGERY_PRIORITIES, SURGERY_ROLES, TREATMENT_KINDS, TREATMENT_SCHEDULES, WARD_TYPES } from '../enums';
import { optDate, optInt, optText, optUuid, reqText } from './common';

const optNum = (min: number, max: number) =>
  z.preprocess((v) => (v === '' ? null : v), z.coerce.number().min(min).max(max).nullish()) as z.ZodType<number | null | undefined, z.ZodTypeDef, unknown>;

// ── Wards ──
export const wardSchema = z.object({
  branchId: z.string().uuid(),
  name: reqText(80),
  type: z.enum(WARD_TYPES).default('GENERAL'),
  dailyServiceId: optUuid(),
  sortOrder: z.coerce.number().int().min(0).max(1000).default(0),
  isActive: z.boolean().default(true),
});
export const cageSchema = z.object({ wardId: z.string().uuid(), name: reqText(40), notes: optText(300), isActive: z.boolean().default(true) });

// ── Admissions ──
export const admitSchema = z.object({
  patientId: z.string().uuid(),
  encounterId: optUuid(),
  wardId: optUuid(),
  cageId: optUuid(),
  reason: reqText(500),
  diagnosis: optText(500),
  condition: z.enum(PATIENT_CONDITIONS).default('STABLE'),
  cprStatus: z.enum(CPR_STATUSES).default('UNDECIDED'),
  isolation: z.boolean().default(false),
  feedingInstructions: optText(1000),
  responsibleClinicianId: optUuid(),
  expectedDischargeAt: optDate(),
});
export const updateAdmissionSchema = z.object({
  condition: z.enum(PATIENT_CONDITIONS).optional(),
  cprStatus: z.enum(CPR_STATUSES).optional(),
  diagnosis: optText(500),
  isolation: z.boolean().optional(),
  feedingInstructions: optText(1000),
  responsibleClinicianId: optUuid(),
  expectedDischargeAt: optDate(),
});
export const moveAdmissionSchema = z.object({ wardId: z.string().uuid(), cageId: optUuid() });
export const dischargeSchema = z.object({
  outcome: z.enum(ADMISSION_OUTCOMES),
  dischargeSummary: reqText(5000),
  homeCareInstructions: optText(5000),
  followUpAt: optDate(),
});
export const hospitalNoteSchema = z.object({ type: z.enum(['PROGRESS', 'HANDOVER']).default('PROGRESS'), text: reqText(5000) });
export const escalateSchema = z.object({ reason: reqText(500) });

// ── Treatment sheet ──
export const treatmentOrderSchema = z
  .object({
    kind: z.enum(TREATMENT_KINDS),
    schedule: z.enum(TREATMENT_SCHEDULES).default('INTERVAL'),
    description: reqText(200),
    productId: optUuid(),
    dose: optNum(0.0001, 1_000_000),
    doseUnit: optText(20),
    route: optText(40),
    fluidRateMlPerHour: optNum(0.1, 10_000),
    intervalHours: optInt(1, 168),
    instructions: optText(1000),
    startAt: optDate(),
    endAt: optDate(),
  })
  .refine((o) => o.schedule !== 'INTERVAL' || !!o.intervalHours, { path: ['intervalHours'], message: 'How often, in hours' })
  .refine((o) => o.kind !== 'MEDICATION' || (!!o.productId && !!o.dose && !!o.doseUnit && !!o.route), { path: ['productId'], message: 'Choose the medicine and enter dose, unit and route' })
  .refine((o) => o.kind !== 'FLUID' || !!o.fluidRateMlPerHour || o.schedule !== 'CONTINUOUS', { path: ['fluidRateMlPerHour'], message: 'Enter the fluid rate' })
  .refine((o) => !o.endAt || !o.startAt || o.endAt > o.startAt, { path: ['endAt'], message: 'End must be after start' });
export type TreatmentOrderInput = z.infer<typeof treatmentOrderSchema>;

export const stopOrderSchema = z.object({ reason: reqText(500) });
export const completeTaskSchema = z
  .object({
    status: z.enum(['DONE', 'SKIPPED']),
    value: optText(200),
    notes: optText(1000),
    skipReason: optText(500),
    batchNumber: optText(60),
    overrideReason: optText(500),
    at: optDate(),
  })
  .refine((t) => t.status !== 'SKIPPED' || !!t.skipReason, { path: ['skipReason'], message: 'Say why it was not done' });

// ── Surgery ──
export const scheduleSurgerySchema = z.object({
  patientId: z.string().uuid(),
  appointmentTypeId: z.string().uuid(),
  surgeonId: z.string().uuid(),
  theatreId: optUuid(),
  startsAt: z.coerce.date(),
  durationMinutes: z.coerce.number().int().min(10).max(720),
  procedure: reqText(200),
  serviceId: optUuid(),
  priority: z.enum(SURGERY_PRIORITIES).default('ELECTIVE'),
  admissionId: optUuid(),
  estimateMinor: optInt(0, 1_000_000_000),
  allowOutsideHours: z.boolean().default(false),
});
export const updateSurgerySchema = z.object({
  procedure: z.string().trim().min(1).max(200).optional(),
  serviceId: optUuid(),
  asaGrade: z.enum(ASA_GRADES).nullish(),
  asaEmergency: z.boolean().optional(),
  preOpAssessment: optText(5000),
  fastingConfirmed: z.boolean().optional(),
  anaesthesiaPlan: optText(5000),
  airway: optText(200),
  surgicalNotes: optText(10000),
  findings: optText(5000),
  complications: optText(5000),
  postOpInstructions: optText(5000),
  followUpAt: optDate(),
});
export const consentSchema = z.object({ givenBy: reqText(120), notes: optText(500) });
export const checklistTickSchema = z.object({ key: z.string().min(1).max(60), checked: z.boolean() });
export const surgeryTeamSchema = z.object({ members: z.array(z.object({ membershipId: z.string().uuid(), role: z.enum(SURGERY_ROLES) })).max(12) });
export const surgeryTransitionSchema = z.object({ action: z.enum(['pre-op', 'start', 'recovery', 'complete', 'cancel']), reason: optText(500) });
export const anaesthesiaReadingSchema = z.object({
  phase: z.enum(['INTRA_OP', 'RECOVERY']).default('INTRA_OP'),
  recordedAt: optDate(),
  heartRate: optInt(0, 400),
  respiratoryRate: optInt(0, 200),
  spo2: optInt(0, 100),
  etco2: optInt(0, 150),
  systolicBp: optInt(0, 400),
  diastolicBp: optInt(0, 300),
  meanBp: optInt(0, 300),
  temperatureC: optNum(25, 46),
  agentPercent: optNum(0, 10),
  oxygenLpm: optNum(0, 20),
  painScore: optInt(0, 10),
  notes: optText(500),
});
export const surgeryItemSchema = z.object({ productId: z.string().uuid(), quantity: z.coerce.number().positive().max(100_000), notes: optText(300) });
export const addendumSchema = z.object({ text: reqText(5000) });
export const checklistItemSchema = z.object({ phase: z.enum(CHECKLIST_PHASES), label: reqText(200), sortOrder: z.coerce.number().int().min(0).max(1000).default(0), isActive: z.boolean().default(true) });
