import { z } from 'zod';

/** Optional text: '' and null clear the value, undefined leaves it untouched (PATCH semantics). */
export const optText = (max = 255) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v === '' ? null : v));

export const reqText = (max = 255) => z.string().trim().min(1, 'Required').max(max);

export const optEmail = () =>
  z
    .union([z.literal(''), z.string().trim().toLowerCase().email('Invalid email').max(254)])
    .nullish()
    .transform((v) => (v === '' ? null : v));

export const optPhone = () =>
  z
    .union([
      z.literal(''),
      z
        .string()
        .trim()
        .max(32)
        .regex(/^\+?[0-9 ()\-]{6,32}$/, 'Invalid phone number'),
    ])
    .nullish()
    .transform((v) => (v === '' ? null : v));

/** Optional date (accepts ISO strings or Date). '' clears. */
export const optDate = () =>
  z.preprocess(
    (v) => (v === '' ? null : v),
    z.coerce.date().nullish(),
  ) as z.ZodType<Date | null | undefined, z.ZodTypeDef, unknown>;

export const uuid = () => z.string().uuid();

/** Optional UUID reference: '' (empty select) becomes null. */
export const optUuid = () =>
  z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullish()) as z.ZodType<string | null | undefined, z.ZodTypeDef, unknown>;

/** Optional positive number from a form input: '' becomes null. */
export const optPositive = (max: number) =>
  z.preprocess(
    (v) => (v === '' || v === undefined ? (v === '' ? null : undefined) : v),
    z.coerce.number().positive().max(max).nullish(),
  ) as z.ZodType<number | null | undefined, z.ZodTypeDef, unknown>;

/** Optional integer from a form input: '' becomes null. */
export const optInt = (min: number, max: number) =>
  z.preprocess((v) => (v === '' ? null : v), z.coerce.number().int().min(min).max(max).nullish()) as z.ZodType<
    number | null | undefined,
    z.ZodTypeDef,
    unknown
  >;

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().trim().max(200).optional(),
  sort: z
    .string()
    .regex(/^-?[a-zA-Z0-9_.]+$/)
    .optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuery>;

export interface Paginated<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number };
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown; requestId?: string };
}

export const idParam = z.object({ id: z.string().uuid() });
