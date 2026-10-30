import { z } from 'zod';
import { optText, optUuid, reqText } from './common';

export const WELLNESS_ITEM_KINDS = ['SERVICE', 'PRODUCT', 'LAB'] as const;
export type WellnessItemKind = (typeof WELLNESS_ITEM_KINDS)[number];
export const WELLNESS_BILLING = ['UPFRONT', 'MONTHLY'] as const;
export type WellnessBilling = (typeof WELLNESS_BILLING)[number];

/** Longest plan term, in months. */
export const WELLNESS_MAX_MONTHS = 36;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a date');
const money = z.coerce.number().int('Whole amounts only').min(0).max(1_000_000_000);
const bp = z.coerce.number().int().min(0).max(10_000);

export const wellnessPlanItemSchema = z
  .object({
    kind: z.enum(WELLNESS_ITEM_KINDS),
    serviceId: optUuid(),
    productId: optUuid(),
    labTestId: optUuid(),
    quantity: z.coerce.number().int().min(1, 'At least 1').max(999),
  })
  .refine((i) => (i.kind === 'SERVICE' ? !!i.serviceId : i.kind === 'PRODUCT' ? !!i.productId : !!i.labTestId), { message: 'Choose what is included', path: ['serviceId'] });
export type WellnessPlanItemInput = z.infer<typeof wellnessPlanItemSchema>;

/**
 * A wellness plan the clinic sells: what it costs for the term, what is included (e.g. 2 check-ups, yearly
 * vaccines) and the member discount on everything else. Changes apply to new members; existing members keep
 * what they signed up for.
 */
export const wellnessPlanSchema = z
  .object({
    name: reqText(120),
    description: optText(1000),
    speciesId: optUuid(),
    durationMonths: z.coerce.number().int().min(1).max(WELLNESS_MAX_MONTHS).default(12),
    /** Price for the whole term when paid in one go. */
    priceMinor: money,
    /** Price per month when paid monthly; null = monthly payments not offered. */
    monthlyPriceMinor: money.nullish(),
    joiningFeeMinor: money.default(0),
    taxRateId: optUuid(),
    serviceDiscountBp: bp.default(0),
    productDiscountBp: bp.default(0),
    terms: optText(4000),
    items: z.array(wellnessPlanItemSchema).max(40).default([]),
  })
  .refine((p) => p.items.length > 0 || p.serviceDiscountBp > 0 || p.productDiscountBp > 0, { path: ['items'], message: 'Include at least one item or a member discount' })
  .refine((p) => new Set(p.items.map((i) => `${i.kind}:${i.serviceId ?? i.productId ?? i.labTestId}`)).size === p.items.length, { path: ['items'], message: 'Each item can be listed once — raise its quantity instead' });
export type WellnessPlanInput = z.infer<typeof wellnessPlanSchema>;

export const wellnessPlanStatusSchema = z.object({ status: z.enum(['ACTIVE', 'RETIRED']) });

export const wellnessEnrolSchema = z.object({
  planId: z.string().uuid(),
  patientId: z.string().uuid(),
  startDate: isoDate.optional(),
  billing: z.enum(WELLNESS_BILLING).default('UPFRONT'),
  autoRenew: z.boolean().default(false),
  notes: optText(1000),
});
export type WellnessEnrolInput = z.infer<typeof wellnessEnrolSchema>;

export const wellnessCancelSchema = z.object({
  reason: reqText(500),
  /** Charge the difference when the benefits used are worth more than what has been paid. */
  chargeShortfall: z.boolean().default(false),
});
export type WellnessCancelInput = z.infer<typeof wellnessCancelSchema>;

export const wellnessRenewSchema = z.object({
  /** Renew onto a different plan (e.g. the senior plan); default the same plan. */
  planId: z.string().uuid().optional(),
  billing: z.enum(WELLNESS_BILLING).optional(),
  autoRenew: z.boolean().optional(),
});
export type WellnessRenewInput = z.infer<typeof wellnessRenewSchema>;

export const wellnessAutoRenewSchema = z.object({ autoRenew: z.boolean() });

/** Record an included item used outside billing (e.g. a nail clip done at the counter). */
export const wellnessUsageSchema = z.object({
  entitlementId: z.string().uuid(),
  quantity: z.coerce.number().int().min(1).max(99).default(1),
  note: reqText(300),
});
export type WellnessUsageInput = z.infer<typeof wellnessUsageSchema>;

export const wellnessReverseSchema = z.object({ reason: reqText(300) });

export const wellnessMembersQuery = z.object({
  status: z.enum(['ACTIVE', 'ENDING', 'UPCOMING', 'EXPIRED', 'CANCELLED', 'ALL']).default('ACTIVE'),
  planId: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type WellnessMembersQuery = z.infer<typeof wellnessMembersQuery>;

/** Add whole months to a calendar date (YYYY-MM-DD), clamping to the month's last day (31 Jan + 1 month = 28/29 Feb). */
export function addMonthsIso(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = total % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/** The day before a calendar date (YYYY-MM-DD). */
export function dayBeforeIso(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - 86400_000).toISOString().slice(0, 10);
}

/**
 * Payment schedule for a term: one payment up front, or one per month on the same day of the month.
 * Monthly amounts are the plan's monthly price; the joining fee is added to the first payment.
 */
export function wellnessSchedule(o: { startDate: string; months: number; billing: WellnessBilling; priceMinor: number; monthlyPriceMinor: number | null; joiningFeeMinor: number }) {
  if (o.billing === 'UPFRONT' || o.monthlyPriceMinor == null) return [{ seq: 1, dueDate: o.startDate, amountMinor: o.priceMinor + o.joiningFeeMinor }];
  return Array.from({ length: o.months }, (_, i) => ({ seq: i + 1, dueDate: addMonthsIso(o.startDate, i), amountMinor: o.monthlyPriceMinor! + (i === 0 ? o.joiningFeeMinor : 0) }));
}
