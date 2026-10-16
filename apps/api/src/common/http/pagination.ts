import type { Paginated } from '@vcms/shared';

export function pageArgs(q: { page: number; pageSize: number }) {
  return { skip: (q.page - 1) * q.pageSize, take: q.pageSize };
}

export function paginated<T>(data: T[], total: number, q: { page: number; pageSize: number }): Paginated<T> {
  return { data, meta: { page: q.page, pageSize: q.pageSize, total } };
}

/**
 * Converts `?sort=-createdAt` into a Prisma orderBy, allowing only whitelisted fields.
 */
export function orderBy(sort: string | undefined, allowed: string[], fallback: Record<string, 'asc' | 'desc'>) {
  if (!sort) return fallback;
  const desc = sort.startsWith('-');
  const field = desc ? sort.slice(1) : sort;
  if (!allowed.includes(field)) return fallback;
  return { [field]: desc ? 'desc' : 'asc' } as Record<string, 'asc' | 'desc'>;
}
