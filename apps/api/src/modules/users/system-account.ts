import type { Prisma } from '@prisma/client';
import { SYSTEM_ACCOUNT_EMAIL, SYSTEM_ACCOUNT_NAME } from '@vcms/shared';
import { ruleViolation } from '../../common/http/errors';

/**
 * NextCore's built-in System account: one per clinic database, an owner of every organization in it, with no
 * password. NextCore opens it from the super admin console (one-time link); the clinic sees it, locked, in its staff
 * list. It is left out of staff counts, rosters and pickers — it is not a member of staff.
 */
export const REAL_STAFF = { user: { isSystemAccount: false } } satisfies Prisma.MembershipWhereInput;

export const systemAccountLocked = () => ruleViolation('SYSTEM_ACCOUNT', 'The System account is managed by NextCore and can’t be changed');

/** Makes sure the organization has the System account as an owner with every active branch. Safe to repeat. */
export async function ensureSystemAccount(tx: Prisma.TransactionClient, organizationId: string) {
  const user = await tx.user.upsert({
    where: { email: SYSTEM_ACCOUNT_EMAIL },
    create: { email: SYSTEM_ACCOUNT_EMAIL, name: SYSTEM_ACCOUNT_NAME, isSystemAccount: true },
    update: {},
  });
  if (!user.isSystemAccount) throw new Error(`${SYSTEM_ACCOUNT_EMAIL} belongs to an ordinary account`);
  const existing = await tx.membership.findUnique({ where: { organizationId_userId: { organizationId, userId: user.id } } });
  const membership = existing
    ? existing.status === 'ACTIVE'
      ? existing
      : await tx.membership.update({ where: { id: existing.id }, data: { status: 'ACTIVE' } })
    : await tx.membership.create({ data: { organizationId, userId: user.id, status: 'ACTIVE', jobTitle: 'NextCore support', joinedAt: new Date() } });
  const owner = await tx.role.findFirst({ where: { organizationId, key: 'owner' }, select: { id: true } });
  if (owner) await tx.membershipRole.createMany({ data: [{ membershipId: membership.id, roleId: owner.id }], skipDuplicates: true });
  const branches = await tx.branch.findMany({ where: { organizationId, isActive: true }, select: { id: true } });
  if (branches.length) await tx.membershipBranch.createMany({ data: branches.map((b) => ({ membershipId: membership.id, branchId: b.id })), skipDuplicates: true });
  return { user, membership };
}
