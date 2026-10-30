import { z } from 'zod';
import { DENTAL_FINDING_CODES, DENTAL_PROCEDURE_CODES, DENTITIONS, OCCLUSIONS, TOOTH_STATES } from '../dental';
import { optDate, optInt, optText, optUuid, reqText } from './common';

const tooth = z.string().regex(/^[1-8](0[1-9]|1[01])$/, 'Not a tooth number');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a date');
const mm = z.preprocess((v) => (v === '' ? null : v), z.coerce.number().min(0).max(30).nullish()) as z.ZodType<number | null | undefined, z.ZodTypeDef, unknown>;

/** Start a dental chart for a patient. The last signed chart's missing and extracted teeth are carried forward. */
export const dentalChartCreateSchema = z.object({
  patientId: z.string().uuid(),
  encounterId: optUuid(),
  dentition: z.enum(DENTITIONS),
  showDeciduous: z.boolean().default(false),
  examinedAt: optDate(),
  carryForward: z.boolean().default(true),
});
export type DentalChartCreateInput = z.infer<typeof dentalChartCreateSchema>;

/** Whole-mouth findings on a draft chart. Omitted fields stay as they are. */
export const dentalChartUpdateSchema = z.object({
  dentition: z.enum(DENTITIONS).optional(),
  showDeciduous: z.boolean().optional(),
  examinedAt: optDate(),
  anaesthetised: z.boolean().optional(),
  occlusion: z.enum(OCCLUSIONS).nullish(),
  periodontalStage: optInt(0, 4),
  calculusIndex: optInt(0, 3),
  gingivalIndex: optInt(0, 3),
  oralFindings: optText(4000),
  homeCare: optText(2000),
  notes: optText(4000),
  recheckDate: z.preprocess((v) => (v === '' ? null : v), isoDate.nullish()) as z.ZodType<string | null | undefined, z.ZodTypeDef, unknown>,
});
export type DentalChartUpdateInput = z.infer<typeof dentalChartUpdateSchema>;

export const dentalToothSchema = z
  .object({
    tooth,
    state: z.enum(TOOTH_STATES).default('PRESENT'),
    findings: z.array(z.enum(DENTAL_FINDING_CODES)).max(20).default([]),
    trStage: optInt(1, 5),
    pdStage: optInt(0, 4),
    mobility: optInt(0, 3),
    furcation: optInt(0, 3),
    calculus: optInt(0, 3),
    gingivitis: optInt(0, 3),
    probingMm: mm,
    recessionMm: mm,
    notes: optText(1000),
  })
  .refine((t) => !t.trStage || t.findings.includes('TR'), { path: ['trStage'], message: 'A resorption stage needs the tooth resorption finding' });
export type DentalToothInput = z.infer<typeof dentalToothSchema>;

/** Save one or more teeth (several teeth selected together get the same values). */
export const dentalTeethSchema = z.object({ teeth: z.array(dentalToothSchema).min(1).max(100) });

/** Record a procedure on one or more teeth, or the whole mouth (no teeth). */
export const dentalProcedureSchema = z.object({
  code: z.enum(DENTAL_PROCEDURE_CODES),
  teeth: z.array(tooth).max(60).default([]),
  serviceId: optUuid(),
  notes: optText(500),
});
export type DentalProcedureInput = z.infer<typeof dentalProcedureSchema>;

export const dentalAddendumSchema = z.object({ text: reqText(4000) });

export const dentalChartListQuery = z.object({
  status: z.enum(['DRAFT', 'SIGNED', 'ALL']).default('ALL'),
  patientId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/** Which price-list service each dental procedure is charged with. */
export const dentalPricesSchema = z.object({
  items: z.array(z.object({ code: z.enum(DENTAL_PROCEDURE_CODES), serviceId: optUuid() })).max(DENTAL_PROCEDURE_CODES.length),
});
export type DentalPricesInput = z.infer<typeof dentalPricesSchema>;
