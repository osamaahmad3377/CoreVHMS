import { z } from 'zod';
import { BOARDING_LOG_KINDS, BOARDING_UNIT_TYPES, CLAIM_PAYEES, POLICY_STATUSES, REFERRAL_DIRECTIONS, REFERRAL_URGENCIES } from '../enums';
import { optDate, optEmail, optInt, optPhone, optText, optUuid, reqText } from './common';

const dateOnly = () => z.coerce.date();
const money = () => z.coerce.number().int().min(0).max(2_000_000_000);

// ── Boarding ──
export const boardingUnitSchema = z.object({
  branchId: z.string().uuid(),
  name: reqText(60),
  type: z.enum(BOARDING_UNIT_TYPES).default('KENNEL'),
  nightlyServiceId: optUuid(),
  notes: optText(300),
  sortOrder: z.coerce.number().int().min(0).max(1000).default(0),
  isActive: z.boolean().default(true),
});

export const boardingStaySchema = z
  .object({
    patientId: z.string().uuid(),
    branchId: optUuid(),
    unitId: optUuid(),
    startDate: dateOnly(),
    endDate: dateOnly(),
    feedingInstructions: optText(2000),
    medicationInstructions: optText(2000),
    belongings: optText(1000),
    behaviourNotes: optText(1000),
    emergencyContact: optText(200),
  })
  .refine((s) => s.endDate > s.startDate, { message: 'Departure must be after arrival (at least one night)', path: ['endDate'] });
export const updateStaySchema = z.object({
  unitId: optUuid(),
  startDate: dateOnly().optional(),
  endDate: dateOnly().optional(),
  feedingInstructions: optText(2000),
  medicationInstructions: optText(2000),
  belongings: optText(1000),
  behaviourNotes: optText(1000),
  emergencyContact: optText(200),
});
export const checkInStaySchema = z.object({
  unitId: optUuid(),
  /** Required when the animal has overdue vaccinations: who accepted the risk and why. */
  vaccinationOverride: optText(300),
});
export const boardingLogSchema = z.object({ kind: z.enum(BOARDING_LOG_KINDS), text: reqText(1000) });

// ── Grooming ──
export const groomingJobSchema = z.object({
  patientId: optUuid(),
  appointmentId: optUuid(),
  branchId: optUuid(),
  groomerId: optUuid(),
  instructions: optText(1000),
  serviceIds: z.array(z.string().uuid()).max(20).default([]),
}).refine((j) => !!j.patientId || !!j.appointmentId, { message: 'Choose the animal', path: ['patientId'] });
export const updateGroomingSchema = z.object({
  groomerId: optUuid(),
  instructions: optText(1000),
  coatCondition: optText(500),
  behaviour: optText(500),
  groomerNotes: optText(2000),
});
export const groomingServiceSchema = z.object({ serviceId: z.string().uuid(), priceMinor: optInt(0, 2_000_000_000) });
export const groomingTransitionSchema = z.object({ action: z.enum(['start', 'ready', 'collected', 'cancel', 'reopen']), reason: optText(500) });

// ── Insurance ──
export const insuranceProviderSchema = z.object({
  name: reqText(160),
  phone: optPhone(),
  email: optEmail(),
  claimsEmail: optEmail(),
  website: optText(200),
  notes: optText(1000),
  isActive: z.boolean().default(true),
});
export const policySchema = z
  .object({
    providerId: z.string().uuid(),
    patientId: z.string().uuid(),
    policyNumber: reqText(60),
    planName: optText(120),
    startDate: dateOnly(),
    endDate: optDate(),
    excessMinor: optInt(0, 2_000_000_000),
    coverLimitMinor: optInt(0, 2_000_000_000),
    coPayPercent: optInt(0, 100),
    exclusions: optText(2000),
    notes: optText(2000),
  })
  .refine((p) => !p.endDate || p.endDate >= p.startDate, { message: 'End date must be after the start date', path: ['endDate'] });
export const updatePolicySchema = z.object({
  planName: optText(120),
  endDate: optDate(),
  excessMinor: optInt(0, 2_000_000_000),
  coverLimitMinor: optInt(0, 2_000_000_000),
  coPayPercent: optInt(0, 100),
  exclusions: optText(2000),
  notes: optText(2000),
  status: z.enum(POLICY_STATUSES).optional(),
});
export const preAuthSchema = z.object({
  policyId: z.string().uuid(),
  procedure: reqText(300),
  estimateMinor: money(),
  estimateId: optUuid(),
  notes: optText(2000),
});
export const preAuthDecisionSchema = z
  .object({
    decision: z.enum(['APPROVED', 'PARTIALLY_APPROVED', 'DECLINED']),
    approvedMinor: optInt(0, 2_000_000_000),
    insurerReference: optText(80),
    decisionNotes: optText(2000),
  })
  .refine((d) => d.decision === 'DECLINED' || d.approvedMinor != null, { message: 'Enter the approved amount', path: ['approvedMinor'] })
  .refine((d) => d.decision !== 'DECLINED' || !!d.decisionNotes, { message: 'Record the insurer’s reason', path: ['decisionNotes'] });

export const claimSchema = z
  .object({
    policyId: z.string().uuid(),
    condition: reqText(300),
    treatmentFrom: dateOnly(),
    treatmentTo: dateOnly(),
    payee: z.enum(CLAIM_PAYEES).default('CLINIC'),
    clinicalSummary: optText(10_000),
    notes: optText(2000),
    invoices: z.array(z.object({ invoiceId: z.string().uuid(), amountMinor: optInt(1, 2_000_000_000) })).max(50).default([]),
  })
  .refine((c) => c.treatmentTo >= c.treatmentFrom, { message: 'End of treatment must be after the start', path: ['treatmentTo'] });
export const updateClaimSchema = z.object({
  condition: reqText(300).optional(),
  treatmentFrom: dateOnly().optional(),
  treatmentTo: dateOnly().optional(),
  payee: z.enum(CLAIM_PAYEES).optional(),
  clinicalSummary: optText(10_000),
  notes: optText(2000),
  invoices: z.array(z.object({ invoiceId: z.string().uuid(), amountMinor: optInt(1, 2_000_000_000) })).max(50).optional(),
});
export const claimDecisionSchema = z
  .object({
    decision: z.enum(['QUERIED', 'APPROVED', 'PARTIALLY_APPROVED', 'REJECTED']),
    approvedMinor: optInt(0, 2_000_000_000),
    insurerReference: optText(80),
    decisionNotes: optText(2000),
  })
  .refine((d) => !['APPROVED', 'PARTIALLY_APPROVED'].includes(d.decision) || d.approvedMinor != null, { message: 'Enter the approved amount', path: ['approvedMinor'] })
  .refine((d) => !['REJECTED', 'QUERIED'].includes(d.decision) || !!d.decisionNotes, { message: 'Record what the insurer said', path: ['decisionNotes'] });
export const claimPaymentSchema = z.object({
  amountMinor: z.coerce.number().int().positive().max(2_000_000_000),
  reference: optText(120),
  paidAt: optDate(),
  idempotencyKey: z.string().min(8).max(100).optional(),
});

// ── Referrals ──
export const referralContactSchema = z.object({
  name: reqText(160),
  practice: optText(160),
  specialty: optText(120),
  email: optEmail(),
  phone: optPhone(),
  address: optText(300),
  notes: optText(1000),
  isActive: z.boolean().default(true),
});
export const referralSchema = z
  .object({
    direction: z.enum(REFERRAL_DIRECTIONS).default('OUTGOING'),
    patientId: z.string().uuid(),
    contactId: optUuid(),
    externalVet: optText(160),
    urgency: z.enum(REFERRAL_URGENCIES).default('ROUTINE'),
    reason: reqText(500),
    clinicalSummary: optText(10_000),
    questions: optText(2000),
  })
  .refine((r) => r.direction === 'INCOMING' || !!r.contactId, { message: 'Choose who you are referring to', path: ['contactId'] })
  .refine((r) => r.direction === 'OUTGOING' || !!r.contactId || !!r.externalVet, { message: 'Enter the referring vet or practice', path: ['externalVet'] });
export const updateReferralSchema = z.object({
  contactId: optUuid(),
  externalVet: optText(160),
  urgency: z.enum(REFERRAL_URGENCIES).optional(),
  reason: reqText(500).optional(),
  clinicalSummary: optText(10_000),
  questions: optText(2000),
  appointmentAt: optDate(),
});
export const referralTransitionSchema = z
  .object({
    action: z.enum(['send', 'accept', 'complete', 'decline', 'cancel']),
    /** Send: also email the letter to the specialist. */
    email: z.boolean().default(false),
    outcome: optText(10_000),
    reason: optText(500),
    appointmentAt: optDate(),
  })
  .refine((t) => t.action !== 'complete' || !!t.outcome, { message: 'Summarise the outcome or report received', path: ['outcome'] })
  .refine((t) => !['decline', 'cancel'].includes(t.action) || !!t.reason, { message: 'Give a reason', path: ['reason'] });
