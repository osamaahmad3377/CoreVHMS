import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { User } from '@prisma/client';
import type { RegisterOrganizationInput } from '@vcms/shared';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { env } from '../../config/env';
import { AuditService } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { decryptSecret, encryptSecret, randomToken, sha256 } from '../../common/crypto/crypto';
import { hashPassword, verifyPassword } from '../../common/crypto/password';
import { conflict, forbidden, ruleViolation } from '../../common/http/errors';
import { escapeHtml, layout, MailService } from '../../common/mail/mail.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OrgBootstrapService } from '../organizations/org-bootstrap.service';
import { SessionService } from './session.service';

authenticator.options = { window: 1 };

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const RESET_TOKEN_MINUTES = 60;
const MFA_CHALLENGE_MINUTES = 5;

export type LoginResult =
  | { status: 'ok'; token: string; sessionId: string; csrf: string; expiresAt: Date }
  | { status: 'mfa_required'; challengeId: string };

const invalidCredentials = () =>
  new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' });

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly bootstrap: OrgBootstrapService,
  ) {}

  async login(email: string, password: string): Promise<LoginResult> {
    const user = await this.prisma.raw.user.findUnique({ where: { email } });
    const now = new Date();
    if (user?.lockedUntil && user.lockedUntil > now) {
      await verifyPassword(null, password);
      throw new UnauthorizedException({
        code: 'ACCOUNT_LOCKED',
        message: 'Too many failed attempts. Try again later or reset your password.',
      });
    }
    const ok = await verifyPassword(user?.passwordHash, password);
    if (!user || !ok || user.status !== 'ACTIVE') {
      if (user) {
        const failed = user.failedLoginCount + 1;
        await this.prisma.raw.user.update({
          where: { id: user.id },
          data: {
            failedLoginCount: failed >= MAX_FAILED_LOGINS ? 0 : failed,
            lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(now.getTime() + LOCK_MINUTES * 60_000) : null,
          },
        });
        await this.audit.record({
          action: failed >= MAX_FAILED_LOGINS ? 'auth.account_locked' : 'auth.login_failed',
          entityType: 'User',
          entityId: user.id,
          organizationId: null,
          actorUserId: user.id,
          actorName: user.name,
        });
      }
      throw invalidCredentials();
    }

    if (user.mustChangePassword && user.temporaryPasswordExpiresAt && user.temporaryPasswordExpiresAt < now) {
      await this.audit.record({ action: 'auth.temporary_password_expired', entityType: 'User', entityId: user.id, organizationId: null, actorUserId: user.id, actorName: user.name });
      throw new UnauthorizedException({ code: 'TEMPORARY_PASSWORD_EXPIRED', message: 'This temporary password has expired. Ask your administrator for a new one.' });
    }

    if (user.mfaEnabled) {
      const challenge = await this.prisma.raw.mfaChallenge.create({
        data: {
          userId: user.id,
          ip: RequestContext.get()?.ip,
          expiresAt: new Date(now.getTime() + MFA_CHALLENGE_MINUTES * 60_000),
        },
      });
      return { status: 'mfa_required', challengeId: challenge.id };
    }
    return this.completeLogin(user);
  }

  async verifyMfa(challengeId: string, code: string): Promise<LoginResult> {
    const challenge = await this.prisma.raw.mfaChallenge.findUnique({ where: { id: challengeId }, include: { user: true } });
    if (!challenge || challenge.consumedAt || challenge.expiresAt < new Date() || challenge.attempts >= 5) {
      throw new UnauthorizedException({ code: 'MFA_EXPIRED', message: 'Verification expired. Please sign in again.' });
    }
    const user = challenge.user;
    const valid = this.checkTotpOrRecovery(user, code);
    if (!valid.ok) {
      await this.prisma.raw.mfaChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
      throw new UnauthorizedException({ code: 'MFA_INVALID', message: 'The verification code is incorrect' });
    }
    await this.prisma.raw.mfaChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });
    if (valid.recoveryHash) {
      await this.prisma.raw.user.update({
        where: { id: user.id },
        data: { mfaRecoveryHashes: user.mfaRecoveryHashes.filter((h) => h !== valid.recoveryHash) },
      });
      await this.audit.record({ action: 'auth.mfa_recovery_code_used', entityType: 'User', entityId: user.id, organizationId: null, actorUserId: user.id });
    }
    return this.completeLogin(user);
  }

  private checkTotpOrRecovery(user: User, code: string): { ok: boolean; recoveryHash?: string } {
    const clean = code.replace(/\s|-/g, '');
    if (/^\d{6}$/.test(clean) && user.mfaSecretEnc) {
      return { ok: authenticator.check(clean, decryptSecret(user.mfaSecretEnc)) };
    }
    const h = sha256(clean.toLowerCase());
    return user.mfaRecoveryHashes.includes(h) ? { ok: true, recoveryHash: h } : { ok: false };
  }

  private async completeLogin(user: User): Promise<LoginResult> {
    const ctx = RequestContext.get();
    const lastSession = await this.prisma.raw.session.findFirst({
      where: { userId: user.id, organizationId: { not: null } },
      orderBy: { createdAt: 'desc' },
    });
    const memberships = await this.prisma.raw.membership.findMany({
      where: { userId: user.id, status: 'ACTIVE', organization: { status: 'ACTIVE' } },
      include: { branches: true },
      orderBy: { createdAt: 'asc' },
    });
    const preferred = memberships.find((m) => m.organizationId === lastSession?.organizationId) ?? memberships[0];
    const branchId =
      preferred?.branches.find((b) => b.branchId === lastSession?.branchId)?.branchId ?? preferred?.branches[0]?.branchId;

    const { token, session } = await this.sessions.create(user.id, {
      organizationId: preferred?.organizationId,
      branchId,
      ip: ctx?.ip,
      userAgent: ctx?.userAgent,
    });
    await this.prisma.raw.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    await this.audit.record({
      action: 'auth.login',
      entityType: 'User',
      entityId: user.id,
      organizationId: preferred?.organizationId ?? null,
      actorUserId: user.id,
      actorName: user.name,
    });
    return { status: 'ok', token, sessionId: session.id, csrf: session.csrfToken, expiresAt: session.expiresAt };
  }

  async logout(sessionId: string) {
    await this.sessions.revoke(sessionId);
    await this.audit.record({ action: 'auth.logout', entityType: 'Session', entityId: sessionId });
  }

  async switchContext(sessionId: string, userId: string, organizationId: string, branchId?: string | null) {
    const m = await this.prisma.raw.membership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      include: { branches: { include: { branch: true } }, organization: true },
    });
    if (!m || m.status !== 'ACTIVE' || m.organization.status !== 'ACTIVE') throw forbidden('You are not a member of that organization');
    const allowed = m.branches.filter((b) => b.branch.isActive).map((b) => b.branchId);
    if (branchId && !allowed.includes(branchId)) throw forbidden('You do not have access to that branch');
    await this.prisma.raw.session.update({
      where: { id: sessionId },
      data: { organizationId, branchId: branchId ?? allowed[0] ?? null },
    });
  }

  async forgotPassword(email: string) {
    const user = await this.prisma.raw.user.findUnique({ where: { email } });
    if (!user || user.status !== 'ACTIVE' || !user.passwordHash) return; // never reveal whether an account exists
    const token = randomToken(32);
    await this.prisma.raw.authToken.updateMany({
      where: { userId: user.id, type: 'PASSWORD_RESET', consumedAt: null },
      data: { consumedAt: new Date() },
    });
    await this.prisma.raw.authToken.create({
      data: {
        type: 'PASSWORD_RESET',
        tokenHash: sha256(token),
        userId: user.id,
        expiresAt: new Date(Date.now() + RESET_TOKEN_MINUTES * 60_000),
      },
    });
    const link = `${env().APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
    await this.mail.send({
      to: user.email,
      subject: 'Reset your NextCore VCMS password',
      text: `Hello ${user.name},\n\nUse this link within ${RESET_TOKEN_MINUTES} minutes to reset your password:\n${link}\n\nIf you did not request this, you can ignore this email.`,
      html: layout(
        'Reset your password',
        `<p>Hello ${escapeHtml(user.name)},</p><p>Use the button below within ${RESET_TOKEN_MINUTES} minutes to choose a new password.</p>
<p><a href="${link}" style="background:#0f766e;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Reset password</a></p>
<p style="color:#6b7b80">If you did not request this, you can ignore this email.</p>`,
      ),
    });
    await this.audit.record({ action: 'auth.password_reset_requested', entityType: 'User', entityId: user.id, organizationId: null, actorUserId: user.id });
  }

  async resetPassword(token: string, password: string) {
    const record = await this.prisma.raw.authToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!record || record.type !== 'PASSWORD_RESET' || record.consumedAt || record.expiresAt < new Date()) {
      throw ruleViolation('TOKEN_INVALID', 'This reset link is invalid or has expired');
    }
    const passwordHash = await hashPassword(password);
    await this.prisma.raw.$transaction([
      this.prisma.raw.user.update({
        where: { id: record.userId },
        data: { passwordHash, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null, mustChangePassword: false, temporaryPasswordExpiresAt: null },
      }),
      this.prisma.raw.authToken.update({ where: { id: record.id }, data: { consumedAt: new Date() } }),
      this.prisma.raw.session.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await this.audit.record({ action: 'auth.password_reset', entityType: 'User', entityId: record.userId, organizationId: null, actorUserId: record.userId });
  }

  async changePassword(userId: string, sessionId: string, current: string, next: string) {
    const user = await this.prisma.raw.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await verifyPassword(user.passwordHash, current))) {
      throw ruleViolation('INVALID_PASSWORD', 'Current password is incorrect');
    }
    if (current === next) throw ruleViolation('SAME_PASSWORD', 'Choose a password different from the current one');
    await this.prisma.raw.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(next), passwordChangedAt: new Date(), mustChangePassword: false, temporaryPasswordExpiresAt: null },
    });
    await this.sessions.revokeAllForUser(userId, sessionId);
    await this.audit.record({ action: 'auth.password_changed', entityType: 'User', entityId: userId });
  }

  async previewInvitation(token: string) {
    const record = await this.validInvitation(token);
    const org = await this.prisma.raw.organization.findUniqueOrThrow({ where: { id: record.organizationId! } });
    return {
      email: record.user.email,
      name: record.user.name,
      organizationName: org.name,
      requiresPassword: !record.user.passwordHash,
    };
  }

  async acceptInvitation(token: string, name: string, password: string): Promise<LoginResult> {
    const record = await this.validInvitation(token);
    const user = record.user;
    // An existing account joining another organization must prove ownership with its current password.
    if (user.passwordHash && !(await verifyPassword(user.passwordHash, password))) throw invalidCredentials();
    const newHash = user.passwordHash ? null : await hashPassword(password);
    await this.prisma.raw.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: newHash ? { name, passwordHash: newHash, passwordChangedAt: new Date() } : {},
      });
      await tx.membership.update({ where: { id: record.membershipId! }, data: { status: 'ACTIVE', joinedAt: new Date() } });
      await tx.authToken.update({ where: { id: record.id }, data: { consumedAt: new Date() } });
    });
    await this.audit.record({
      action: 'membership.invitation_accepted',
      entityType: 'Membership',
      entityId: record.membershipId,
      organizationId: record.organizationId,
      actorUserId: user.id,
      actorName: name,
    });
    return this.completeLogin(await this.prisma.raw.user.findUniqueOrThrow({ where: { id: user.id } }));
  }

  private async validInvitation(token: string) {
    const record = await this.prisma.raw.authToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
    if (!record || record.type !== 'INVITATION' || record.consumedAt || record.expiresAt < new Date() || !record.membershipId) {
      throw ruleViolation('TOKEN_INVALID', 'This invitation is invalid or has expired');
    }
    return record;
  }

  async registerOrganization(input: RegisterOrganizationInput): Promise<LoginResult> {
    if (!env().ALLOW_SIGNUP) throw forbidden('Self-service registration is disabled');
    const existing = await this.prisma.raw.user.findUnique({ where: { email: input.email } });
    if (existing) throw conflict('An account with this email already exists. Sign in and ask to be invited instead.');
    const passwordHash = await hashPassword(input.password);
    const user = await this.prisma.raw.$transaction(
      async (tx) => {
        const u = await tx.user.create({
          data: { email: input.email, name: input.ownerName, passwordHash, passwordChangedAt: new Date() },
        });
        const { org } = await this.bootstrap.create(tx, {
          name: input.organizationName,
          country: input.country,
          branchName: input.branchName,
          ownerUserId: u.id,
        });
        await this.audit.record(
          { action: 'organization.created', entityType: 'Organization', entityId: org.id, organizationId: org.id, actorUserId: u.id, actorName: u.name },
          tx,
        );
        return u;
      },
      { timeout: 30_000 },
    );
    return this.completeLogin(user);
  }

  // ── MFA management ──

  async mfaSetup(userId: string) {
    const user = await this.prisma.raw.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.mfaEnabled) throw ruleViolation('MFA_ALREADY_ENABLED', 'Two-factor authentication is already enabled');
    const secret = authenticator.generateSecret();
    await this.prisma.raw.user.update({ where: { id: userId }, data: { mfaPendingSecret: encryptSecret(secret) } });
    const otpauthUrl = authenticator.keyuri(user.email, 'NextCore VCMS', secret);
    return { secret, otpauthUrl, qrDataUrl: await QRCode.toDataURL(otpauthUrl) };
  }

  async mfaEnable(userId: string, code: string) {
    const user = await this.prisma.raw.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.mfaPendingSecret) throw ruleViolation('MFA_NOT_STARTED', 'Start two-factor setup first');
    const secret = decryptSecret(user.mfaPendingSecret);
    if (!authenticator.check(code, secret)) throw ruleViolation('MFA_INVALID', 'The verification code is incorrect');
    const recoveryCodes = Array.from({ length: 8 }, () => randomToken(6).toLowerCase().replace(/[^a-z0-9]/g, 'x').slice(0, 8));
    await this.prisma.raw.user.update({
      where: { id: userId },
      data: {
        mfaEnabled: true,
        mfaSecretEnc: user.mfaPendingSecret,
        mfaPendingSecret: null,
        mfaRecoveryHashes: recoveryCodes.map((c) => sha256(c)),
      },
    });
    await this.audit.record({ action: 'auth.mfa_enabled', entityType: 'User', entityId: userId });
    return { recoveryCodes };
  }

  async mfaDisable(userId: string, password: string) {
    const user = await this.prisma.raw.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await verifyPassword(user.passwordHash, password))) throw ruleViolation('INVALID_PASSWORD', 'Password is incorrect');
    await this.prisma.raw.user.update({
      where: { id: userId },
      data: { mfaEnabled: false, mfaSecretEnc: null, mfaPendingSecret: null, mfaRecoveryHashes: [] },
    });
    await this.audit.record({ action: 'auth.mfa_disabled', entityType: 'User', entityId: userId });
  }

  async listSessions(userId: string, currentId: string) {
    const rows = await this.prisma.raw.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() }, idleExpiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
      select: { id: true, ip: true, userAgent: true, createdAt: true, lastSeenAt: true },
    });
    return rows.map((r) => ({ ...r, current: r.id === currentId }));
  }

  async revokeSession(userId: string, sessionId: string) {
    const s = await this.prisma.raw.session.findFirst({ where: { id: sessionId, userId } });
    if (!s) throw forbidden();
    await this.sessions.revoke(s.id);
    await this.audit.record({ action: 'auth.session_revoked', entityType: 'Session', entityId: s.id });
  }
}
