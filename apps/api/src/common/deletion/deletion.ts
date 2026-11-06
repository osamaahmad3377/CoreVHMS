import { Prisma } from '@prisma/client';
import { ruleViolation } from '../http/errors';

/**
 * Permanent deletion of records added by mistake.
 *
 * A record may only be deleted while nothing else refers to it — no visits, invoices, stock, bookings or other
 * history. Anything with history is archived or switched off instead, so reports, invoices and clinical records
 * never lose what they point at. Each module lists what counts as history for its record; this helper turns
 * those counts into the same answer and wording everywhere.
 */

/** One kind of history: the singular and plural noun and how many there are, e.g. ['visit', 'visits', 4]. */
export type UsageCount = readonly [singular: string, plural: string, count: number | Promise<number>];

/** What the screen shows before asking to delete. */
export interface DeletionCheck {
  canDelete: boolean;
  /** e.g. ['4 visits', '2 invoices'] — empty when the record can be deleted. */
  usedBy: string[];
  /** What to do instead when it can't be deleted, e.g. “Archive the client instead …”. */
  instead: string;
}

/** Resolves the counts and keeps only the kinds that have something, as readable phrases. */
export async function usage(counts: UsageCount[]): Promise<string[]> {
  const resolved = await Promise.all(counts.map(async ([one, many, n]) => ({ one, many, n: await n })));
  return resolved.filter((x) => x.n > 0).map((x) => `${x.n} ${x.n === 1 ? x.one : x.many}`);
}

export function deletionCheck(usedBy: string[], instead: string): DeletionCheck {
  return { canDelete: usedBy.length === 0, usedBy, instead };
}

/** “4 visits, 1 invoice and 2 payments”. */
export function joinPhrases(items: string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Refuses the delete when the record has any history, naming it. */
export function assertDeletable(name: string, check: DeletionCheck) {
  if (!check.canDelete) {
    throw ruleViolation('IN_USE', `${name} can’t be deleted: it is linked to ${joinPhrases(check.usedBy)}. ${check.instead}`, {
      usedBy: check.usedBy,
    });
  }
}

/**
 * Runs the delete; if the database still finds a link the checks did not list (a safety net, not the normal path),
 * answers with the same plain message instead of a database error. The transaction is rolled back either way.
 */
export async function deleteOrExplain<T>(name: string, instead: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
      throw ruleViolation('IN_USE', `${name} can’t be deleted: other records are linked to it. ${instead}`);
    }
    throw e;
  }
}
