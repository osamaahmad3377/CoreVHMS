import { RequestContext } from '../context/request-context';
import type { PrismaService } from '../prisma/prisma.service';
import { localDateOnly } from './tz';

/**
 * Timezone for "today" and other calendar dates: the given branch, else the request's current branch,
 * else the organisation's default, else UTC (background jobs without a tenant).
 */
export async function resolveTimezone(prisma: PrismaService, branchId?: string | null): Promise<string> {
  const ctx = RequestContext.get();
  const id = branchId ?? ctx?.branchId;
  if (id) {
    const b = await prisma.db.branch.findUnique({ where: { id }, select: { timezone: true } });
    if (b?.timezone) return b.timezone;
  }
  if (ctx?.organizationId) {
    const org = await prisma.raw.organization.findUnique({ where: { id: ctx.organizationId }, select: { defaultTimezone: true } });
    if (org?.defaultTimezone) return org.defaultTimezone;
  }
  return 'UTC';
}

/** Today's calendar date in the branch timezone, as a date-only value (UTC midnight). */
export async function branchToday(prisma: PrismaService, branchId?: string | null): Promise<Date> {
  return localDateOnly(new Date(), await resolveTimezone(prisma, branchId));
}
