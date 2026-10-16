import { Injectable } from '@nestjs/common';
import type { InviteUserInput, UpdateMembershipInput } from '@vcms/shared';
import { env } from '../../config/env';
import { AuditService } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { randomToken, sha256 } from '../../common/crypto/crypto';
import { generateTemporaryPassword, hashPassword } from '../../common/crypto/password';
import { conflict, forbidden, notFound, ruleViolation } from '../../common/http/errors';
import { escapeHtml, layout, MailService } from '../../common/mail/mail.service';
import { PrismaService } from '../../common/prisma/prisma.service';

const INVITE_DAYS = 7;
/** An unused temporary password stops working after this many days. */
export const TEMP_PASSWORD_DAYS = 7;

const memberInclude = {
  user: { select: { id: true, email: true, name: true, mfaEnabled: true, lastLoginAt: true, status: true, mustChangePassword: true, temporaryPasswordExpiresAt: true } },
  roles: { include: { role: { select: { id: true, name: true, key: true } } } },
  branches: { include: { branch: { select: { id: true, name: true } } } },
} as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  async list(q?: string) {
    const rows = await this.prisma.db.membership.findMany({
      where: q
        ? { user: { OR: [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }] } }
        : {},
      include: memberInclude,
      orderBy: { user: { name: 'asc' } },
    });
    return rows.map(shape);
  }

  async get(id: string) {
    const m = await this.prisma.db.membership.findUnique({ where: { id }, include: memberInclude });
    if (!m) throw notFound('Staff member');
    return shape(m);
  }

  /** Clinicians available for scheduling and attribution. */
  async clinicians(branchId?: string) {
    const rows = await this.prisma.db.membership.findMany({
      where: { status: 'ACTIVE', isClinician: true, ...(branchId ? { branches: { some: { branchId } } } : {}) },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { user: { name: 'asc' } },
    });
    return rows.map((r) => ({ membershipId: r.id, userId: r.userId, name: r.user.name, jobTitle: r.jobTitle }));
  }

  /** Prevents privilege escalation: you can only grant roles whose permissions you already hold. */
  private async assertAssignableRoles(roleIds: string[]) {
    const ctx = RequestContext.require();
    const roles = await this.prisma.db.role.findMany({ where: { id: { in: roleIds } }, include: { permissions: true } });
    if (roles.length !== new Set(roleIds).size) throw ruleViolation('INVALID_ROLE', 'One or more roles do not exist');
    for (const r of roles) {
      const missing = r.permissions.filter((p) => !ctx.permissions.has(p.permission));
      if (missing.length) throw forbidden(`You cannot assign the role "${r.name}" because it grants permissions you do not have`);
    }
    return roles;
  }

  private async assertBranches(branchIds: string[]) {
    const count = await this.prisma.db.branch.count({ where: { id: { in: branchIds } } });
    if (count !== new Set(branchIds).size) throw ruleViolation('INVALID_BRANCH', 'One or more branches do not exist');
  }

  async invite(input: InviteUserInput) {
    const orgId = RequestContext.orgId();
    await this.assertAssignableRoles(input.roleIds);
    await this.assertBranches(input.branchIds);

    const token = randomToken(32);
    const result = await this.prisma.raw.$transaction(async (tx) => {
      let user = await tx.user.findUnique({ where: { email: input.email } });
      if (user) {
        const existing = await tx.membership.findUnique({ where: { organizationId_userId: { organizationId: orgId, userId: user.id } } });
        if (existing) throw conflict('This person is already a member of your organization');
      } else {
        user = await tx.user.create({ data: { email: input.email, name: input.name } });
      }
      const membership = await tx.membership.create({
        data: {
          organizationId: orgId,
          userId: user.id,
          status: 'INVITED',
          jobTitle: input.jobTitle,
          isClinician: input.isClinician,
          invitedById: RequestContext.require().userId,
          roles: { create: input.roleIds.map((roleId) => ({ roleId })) },
          branches: { create: input.branchIds.map((branchId) => ({ branchId })) },
        },
      });
      await tx.authToken.create({
        data: {
          type: 'INVITATION',
          tokenHash: sha256(token),
          userId: user.id,
          organizationId: orgId,
          membershipId: membership.id,
          expiresAt: new Date(Date.now() + INVITE_DAYS * 86400_000),
        },
      });
      await this.audit.record(
        { action: 'membership.invited', entityType: 'Membership', entityId: membership.id, summary: input.email },
        tx,
      );
      return { membership, user };
    });

    await this.sendInvite(result.user.email, input.name, token);
    return this.get(result.membership.id);
  }

  /**
   * Adds a staff member without email: the system generates a temporary password that the administrator shares
   * in person. The person must choose their own password at first sign-in. Only for email addresses that have no
   * NextCore account yet — an existing account joins through an invitation, so its password is never replaced.
   */
  async createWithTemporaryPassword(input: InviteUserInput) {
    const ctx = RequestContext.require();
    const orgId = RequestContext.orgId();
    await this.assertAssignableRoles(input.roleIds);
    await this.assertBranches(input.branchIds);
    const password = generateTemporaryPassword();
    const passwordHash = await hashPassword(password);
    const expiresAt = new Date(Date.now() + TEMP_PASSWORD_DAYS * 86400_000);
    const membership = await this.prisma.raw.$transaction(async (tx) => {
      if (await tx.user.findUnique({ where: { email: input.email } })) {
        throw conflict('This email already has a NextCore account. Send an invitation instead — they will join with their existing password.');
      }
      const user = await tx.user.create({
        data: { email: input.email, name: input.name, passwordHash, passwordChangedAt: new Date(), mustChangePassword: true, temporaryPasswordExpiresAt: expiresAt },
      });
      const m = await tx.membership.create({
        data: {
          organizationId: orgId, userId: user.id, status: 'ACTIVE', joinedAt: new Date(), jobTitle: input.jobTitle, isClinician: input.isClinician,
          invitedById: ctx.userId,
          roles: { create: input.roleIds.map((roleId) => ({ roleId })) },
          branches: { create: input.branchIds.map((branchId) => ({ branchId })) },
        },
      });
      // The password itself is never stored in the audit log.
      await this.audit.record({ action: 'membership.created_with_temporary_password', entityType: 'Membership', entityId: m.id, summary: input.email }, tx);
      return m;
    });
    return { member: await this.get(membership.id), temporaryPassword: password, expiresAt };
  }

  /**
   * Issues a new temporary password to an existing staff member (forgotten password without email access, or an
   * invitation that never arrived). Allowed only when the account belongs to this organization alone, so one clinic
   * can never take over an account used at another; and only by someone who could assign the member's roles.
   */
  async issueTemporaryPassword(id: string) {
    const ctx = RequestContext.require();
    const m = await this.prisma.db.membership.findUnique({ where: { id }, include: { user: true, roles: true } });
    if (!m) throw notFound('Staff member');
    if (m.id === ctx.membershipId) throw ruleViolation('SELF_CHANGE', 'Change your own password under My account');
    if (m.status === 'SUSPENDED') throw ruleViolation('SUSPENDED', 'Reactivate this staff member first');
    await this.assertAssignableRoles(m.roles.map((r) => r.roleId));
    const elsewhere = await this.prisma.raw.membership.count({ where: { userId: m.userId, organizationId: { not: m.organizationId } } });
    if (elsewhere || m.user.isPlatformAdmin) {
      throw ruleViolation('SHARED_ACCOUNT', 'This person also uses their account at another organization. They can reset their password from the sign-in page.');
    }
    const password = generateTemporaryPassword();
    const passwordHash = await hashPassword(password);
    const expiresAt = new Date(Date.now() + TEMP_PASSWORD_DAYS * 86400_000);
    await this.prisma.raw.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: m.userId },
        data: { passwordHash, passwordChangedAt: new Date(), mustChangePassword: true, temporaryPasswordExpiresAt: expiresAt, failedLoginCount: 0, lockedUntil: null },
      });
      if (m.status === 'INVITED') {
        await tx.membership.update({ where: { id: m.id }, data: { status: 'ACTIVE', joinedAt: new Date() } });
        await tx.authToken.updateMany({ where: { membershipId: m.id, type: 'INVITATION', consumedAt: null }, data: { consumedAt: new Date() } });
      }
      // Any existing sign-in (and pending reset link) stops working.
      await tx.session.updateMany({ where: { userId: m.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.authToken.updateMany({ where: { userId: m.userId, type: 'PASSWORD_RESET', consumedAt: null }, data: { consumedAt: new Date() } });
      await this.audit.record({ action: 'membership.temporary_password_issued', entityType: 'Membership', entityId: m.id, summary: m.user.email, organizationId: m.organizationId }, tx);
    });
    return { member: await this.get(m.id), temporaryPassword: password, expiresAt };
  }

  async resendInvite(id: string) {
    const m = await this.prisma.db.membership.findUnique({ where: { id }, include: { user: true } });
    if (!m) throw notFound('Staff member');
    if (m.status !== 'INVITED') throw ruleViolation('NOT_INVITED', 'This person has already joined');
    const token = randomToken(32);
    await this.prisma.raw.$transaction([
      this.prisma.raw.authToken.updateMany({
        where: { membershipId: m.id, type: 'INVITATION', consumedAt: null },
        data: { consumedAt: new Date() },
      }),
      this.prisma.raw.authToken.create({
        data: {
          type: 'INVITATION',
          tokenHash: sha256(token),
          userId: m.userId,
          organizationId: m.organizationId,
          membershipId: m.id,
          expiresAt: new Date(Date.now() + INVITE_DAYS * 86400_000),
        },
      }),
    ]);
    await this.sendInvite(m.user.email, m.user.name, token);
    await this.audit.record({ action: 'membership.invite_resent', entityType: 'Membership', entityId: m.id });
  }

  private async sendInvite(email: string, name: string, token: string) {
    const org = await this.prisma.raw.organization.findUniqueOrThrow({ where: { id: RequestContext.orgId() } });
    const inviter = RequestContext.require().userName ?? 'A colleague';
    const link = `${env().APP_URL}/accept-invite?token=${encodeURIComponent(token)}`;
    await this.mail.send({
      to: email,
      subject: `You're invited to ${org.name} on NextCore VCMS`,
      text: `Hello ${name},\n\n${inviter} has invited you to join ${org.name}.\nAccept within ${INVITE_DAYS} days: ${link}`,
      html: layout(
        `Join ${escapeHtml(org.name)}`,
        `<p>Hello ${escapeHtml(name)},</p><p>${escapeHtml(inviter)} has invited you to join <b>${escapeHtml(org.name)}</b> on NextCore VCMS.</p>
<p><a href="${link}" style="background:#0f766e;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Accept invitation</a></p>
<p style="color:#6b7b80">This invitation expires in ${INVITE_DAYS} days.</p>`,
      ),
    });
  }

  async update(id: string, input: UpdateMembershipInput) {
    const ctx = RequestContext.require();
    const before = await this.prisma.db.membership.findUnique({ where: { id }, include: memberInclude });
    if (!before) throw notFound('Staff member');

    if (input.roleIds) await this.assertAssignableRoles(input.roleIds);
    if (input.branchIds) await this.assertBranches(input.branchIds);

    // Members cannot be managed by someone lacking their permissions (prevents demoting an owner).
    const currentRoleIds = before.roles.map((r) => r.roleId);
    await this.assertAssignableRoles(currentRoleIds);

    if (before.id === ctx.membershipId && (input.status === 'SUSPENDED' || input.roleIds)) {
      throw ruleViolation('SELF_CHANGE', 'You cannot change your own roles or suspend yourself');
    }

    await this.prisma.db.$transaction(async (tx) => {
      if (input.roleIds || input.status === 'SUSPENDED') {
        const ownerRole = await tx.role.findFirst({ where: { key: 'owner' } });
        const wasOwner = ownerRole && currentRoleIds.includes(ownerRole.id);
        const staysOwner = ownerRole && (input.roleIds ?? currentRoleIds).includes(ownerRole.id) && input.status !== 'SUSPENDED';
        if (wasOwner && !staysOwner) {
          const owners = await tx.membership.count({ where: { status: 'ACTIVE', roles: { some: { roleId: ownerRole!.id } } } });
          if (owners <= 1) throw ruleViolation('LAST_OWNER', 'The organization must keep at least one active owner');
        }
      }
      await tx.membership.update({
        where: { id },
        data: {
          jobTitle: input.jobTitle,
          isClinician: input.isClinician,
          professionalRegistration: input.professionalRegistration,
          status: input.status,
        },
      });
      if (input.roleIds) {
        await tx.membershipRole.deleteMany({ where: { membershipId: id } });
        await tx.membershipRole.createMany({ data: input.roleIds.map((roleId) => ({ membershipId: id, roleId })) });
      }
      if (input.branchIds) {
        await tx.membershipBranch.deleteMany({ where: { membershipId: id } });
        await tx.membershipBranch.createMany({ data: input.branchIds.map((branchId) => ({ membershipId: id, branchId })) });
      }
      await this.audit.record(
        {
          action: input.status === 'SUSPENDED' ? 'membership.suspended' : 'membership.updated',
          entityType: 'Membership',
          entityId: id,
          summary: before.user.email,
          changes: {
            ...(input.roleIds ? { roles: { from: currentRoleIds, to: input.roleIds } } : {}),
            ...(input.branchIds ? { branches: { from: before.branches.map((b) => b.branchId), to: input.branchIds } } : {}),
            ...(input.status ? { status: { from: before.status, to: input.status } } : {}),
            ...(input.jobTitle !== undefined ? { jobTitle: { from: before.jobTitle, to: input.jobTitle } } : {}),
            ...(input.isClinician !== undefined ? { isClinician: { from: before.isClinician, to: input.isClinician } } : {}),
          },
        },
        tx,
      );
    });

    if (input.status === 'SUSPENDED') {
      await this.prisma.raw.session.updateMany({
        where: { userId: before.userId, organizationId: before.organizationId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    return this.get(id);
  }
}

function shape(m: any) {
  return {
    id: m.id,
    status: m.status,
    jobTitle: m.jobTitle,
    isClinician: m.isClinician,
    professionalRegistration: m.professionalRegistration,
    joinedAt: m.joinedAt,
    createdAt: m.createdAt,
    user: m.user,
    roles: m.roles.map((r: any) => r.role),
    branches: m.branches.map((b: any) => b.branch),
  };
}
