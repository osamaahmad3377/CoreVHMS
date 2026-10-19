import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { CookieOptions, Response } from 'express';
import { AuditService } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { randomToken, sha256 } from '../../common/crypto/crypto';
import { hashPassword, verifyPassword } from '../../common/crypto/password';
import { conflict, notFound, ruleViolation } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { appUrl } from '../../common/tenancy/hosts';
import { env } from '../../config/env';
import { MessagesService } from '../comms/messages.service';

export const PORTAL_SESSION_COOKIE = 'vcms_psid';
export const PORTAL_CSRF_COOKIE = 'vcms_pcsrf';
const SESSION_DAYS = 7;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const INVITE_HOURS = 72;
const RESET_MINUTES = 60;

const cookieBase = (): CookieOptions => ({ secure: env().COOKIE_SECURE, sameSite: 'lax', path: '/' });

export interface PortalContext {
  sessionId: string;
  portalUserId: string;
  accessId: string;
  organizationId: string;
  clientId: string;
  name: string;
  csrfToken: string;
}

/**
 * Authentication for the client portal. Portal users are separate from staff users; every request is
 * bound to one clinic (organisation) and one client record through the active access.
 */
@Injectable()
export class PortalAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly messages: MessagesService,
  ) {}

  setCookies(res: Response, token: string, csrf: string, expiresAt: Date) {
    res.cookie(PORTAL_SESSION_COOKIE, token, { ...cookieBase(), httpOnly: true, expires: expiresAt });
    res.cookie(PORTAL_CSRF_COOKIE, csrf, { ...cookieBase(), httpOnly: false, expires: expiresAt });
  }

  clearCookies(res: Response) {
    res.clearCookie(PORTAL_SESSION_COOKIE, cookieBase());
    res.clearCookie(PORTAL_CSRF_COOKIE, cookieBase());
  }

  private async createSession(portalUserId: string, accessId: string) {
    const token = randomToken();
    const csrf = randomToken(16);
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
    const ctx = RequestContext.get();
    await this.prisma.raw.portalSession.create({ data: { portalUserId, accessId, tokenHash: sha256(token), csrfToken: csrf, ip: ctx?.ip ?? null, userAgent: ctx?.userAgent?.slice(0, 300) ?? null, expiresAt } });
    return { token, csrf, expiresAt };
  }

  /** Resolves a session cookie to a portal context, or null. */
  async resolve(token: string): Promise<PortalContext | null> {
    const raw = this.prisma.raw;
    const s = await raw.portalSession.findUnique({ where: { tokenHash: sha256(token) }, include: { portalUser: true } });
    if (!s || s.revokedAt || s.expiresAt < new Date() || s.portalUser.status !== 'ACTIVE') return null;
    const access = await raw.portalAccess.findUnique({ where: { id: s.accessId }, include: { organization: { select: { status: true, portalEnabled: true } }, client: { select: { status: true } } } });
    if (!access || !access.isActive || !access.organization.portalEnabled || access.organization.status !== 'ACTIVE' || access.client.status === 'MERGED') return null;
    if (Date.now() - s.lastSeenAt.getTime() > 5 * 60_000) await raw.portalSession.update({ where: { id: s.id }, data: { lastSeenAt: new Date() } });
    return { sessionId: s.id, portalUserId: s.portalUserId, accessId: access.id, organizationId: access.organizationId, clientId: access.clientId, name: s.portalUser.name, csrfToken: s.csrfToken };
  }

  async login(email: string, password: string) {
    const raw = this.prisma.raw;
    const user = await raw.portalUser.findUnique({ where: { email } });
    const now = new Date();
    const invalid = () => new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' });
    if (user?.lockedUntil && user.lockedUntil > now) {
      await verifyPassword(null, password);
      throw new UnauthorizedException({ code: 'ACCOUNT_LOCKED', message: 'Too many failed attempts. Try again in 15 minutes or reset your password.' });
    }
    const ok = await verifyPassword(user?.passwordHash, password);
    if (!user || !ok || user.status !== 'ACTIVE') {
      if (user) {
        const failed = user.failedLoginCount + 1;
        await raw.portalUser.update({ where: { id: user.id }, data: { failedLoginCount: failed >= MAX_FAILED ? 0 : failed, lockedUntil: failed >= MAX_FAILED ? new Date(now.getTime() + LOCK_MINUTES * 60_000) : null } });
      }
      throw invalid();
    }
    const access = await this.firstAccess(user.id);
    if (!access) throw new UnauthorizedException({ code: 'NO_ACCESS', message: 'Your portal access is not active. Please contact your clinic.' });
    await raw.portalUser.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now } });
    await this.audit.record({ action: 'portal.login', entityType: 'Client', entityId: access.clientId, organizationId: access.organizationId, actorUserId: null, actorName: `${user.name} (client portal)` });
    return this.createSession(user.id, access.id);
  }

  private async firstAccess(portalUserId: string, preferredId?: string) {
    const accesses = await this.prisma.raw.portalAccess.findMany({ where: { portalUserId, isActive: true, organization: { portalEnabled: true, status: 'ACTIVE' } }, orderBy: { createdAt: 'asc' } });
    return accesses.find((a) => a.id === preferredId) ?? accesses[0] ?? null;
  }

  async logout(ctx: PortalContext) {
    await this.prisma.raw.portalSession.update({ where: { id: ctx.sessionId }, data: { revokedAt: new Date() } });
  }

  /** Session summary: who is signed in, the active clinic and the other clinics they can switch to. */
  async session(ctx: PortalContext) {
    const raw = this.prisma.raw;
    const [user, accesses, client] = await Promise.all([
      raw.portalUser.findUniqueOrThrow({ where: { id: ctx.portalUserId }, select: { id: true, email: true, name: true } }),
      raw.portalAccess.findMany({ where: { portalUserId: ctx.portalUserId, isActive: true }, include: { organization: { select: { id: true, name: true, currency: true, phone: true, email: true, logoAttachmentId: true, defaultTimezone: true, portalCancelHours: true } } } }),
      raw.client.findUniqueOrThrow({ where: { id: ctx.clientId }, select: { id: true, displayName: true } }),
    ]);
    const active = accesses.find((a) => a.id === ctx.accessId)!;
    return { user, client, clinic: active.organization, clinics: accesses.map((a) => ({ accessId: a.id, name: a.organization.name })), csrfToken: ctx.csrfToken };
  }

  async switchClinic(ctx: PortalContext, accessId: string) {
    const access = await this.firstAccess(ctx.portalUserId, accessId);
    if (!access || access.id !== accessId) throw notFound('Clinic');
    await this.prisma.raw.portalSession.update({ where: { id: ctx.sessionId }, data: { accessId } });
    return { ok: true };
  }

  async changePassword(ctx: PortalContext, current: string, next: string) {
    const user = await this.prisma.raw.portalUser.findUniqueOrThrow({ where: { id: ctx.portalUserId } });
    if (!(await verifyPassword(user.passwordHash, current))) throw ruleViolation('WRONG_PASSWORD', 'Your current password is incorrect');
    await this.prisma.raw.portalUser.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next) } });
    // Sign out other devices.
    await this.prisma.raw.portalSession.updateMany({ where: { portalUserId: user.id, id: { not: ctx.sessionId }, revokedAt: null }, data: { revokedAt: new Date() } });
    return { ok: true };
  }

  // ── Invitations and password reset ──

  private async issueToken(portalUserId: string, type: 'INVITE' | 'RESET') {
    const token = randomToken();
    await this.prisma.raw.portalToken.updateMany({ where: { portalUserId, type, consumedAt: null }, data: { consumedAt: new Date() } });
    await this.prisma.raw.portalToken.create({ data: { portalUserId, type, tokenHash: sha256(token), expiresAt: new Date(Date.now() + (type === 'INVITE' ? INVITE_HOURS * 3600_000 : RESET_MINUTES * 60_000)) } });
    return token;
  }

  /** Staff: invite a client to the portal (or link an existing portal login to this clinic). */
  async invite(clientId: string) {
    const ctx = RequestContext.require();
    const client = await this.prisma.db.client.findUnique({ where: { id: clientId } });
    if (!client) throw notFound('Client');
    if (client.status !== 'ACTIVE') throw ruleViolation('CLIENT_NOT_ACTIVE', 'Only active clients can be invited');
    if (!client.email) throw ruleViolation('NO_EMAIL', 'Add an email address to the client record first');
    const org = await this.prisma.raw.organization.findUniqueOrThrow({ where: { id: ctx.organizationId! } });
    if (!org.portalEnabled) throw ruleViolation('PORTAL_DISABLED', 'The client portal is switched off in Settings');
    const email = client.email.trim().toLowerCase();
    const raw = this.prisma.raw;
    const personName = [client.firstName, client.lastName].filter(Boolean).join(' ') || client.displayName;
    const user = (await raw.portalUser.findUnique({ where: { email } })) ?? (await raw.portalUser.create({ data: { email, name: personName } }));
    const other = await raw.portalAccess.findFirst({ where: { portalUserId: user.id, organizationId: ctx.organizationId!, clientId: { not: clientId } } });
    if (other) throw conflict('This email is already used by another client’s portal login at this clinic');
    const access = await raw.portalAccess.upsert({
      where: { organizationId_clientId: { organizationId: ctx.organizationId!, clientId } },
      update: { isActive: true, portalUserId: user.id },
      create: { portalUserId: user.id, organizationId: ctx.organizationId!, clientId, invitedByName: ctx.userName },
    });
    const link = user.status === 'ACTIVE' ? `${appUrl()}/portal/login` : `${appUrl()}/portal/accept?token=${await this.issueToken(user.id, 'INVITE')}`;
    await this.prisma.db.$transaction(async (tx) => {
      await this.messages.enqueueTemplate(tx, 'PORTAL_INVITE', 'EMAIL', { clinicName: org.name, clientName: personName, link }, { clientId, recipient: email, sourceType: 'PortalAccess', sourceId: access.id });
      await this.audit.record({ action: 'portal.invited', entityType: 'Client', entityId: clientId, summary: email }, tx);
    });
    return this.status(clientId);
  }

  async revoke(clientId: string) {
    const access = await this.prisma.db.portalAccess.findFirst({ where: { clientId } });
    if (!access) throw notFound('Portal access');
    await this.prisma.db.$transaction(async (tx) => {
      await tx.portalAccess.update({ where: { id: access.id }, data: { isActive: false } });
      await this.audit.record({ action: 'portal.revoked', entityType: 'Client', entityId: clientId }, tx);
    });
    await this.prisma.raw.portalSession.updateMany({ where: { accessId: access.id, revokedAt: null }, data: { revokedAt: new Date() } });
    return this.status(clientId);
  }

  async status(clientId: string) {
    const access = await this.prisma.db.portalAccess.findFirst({ where: { clientId }, include: { portalUser: { select: { email: true, status: true, lastLoginAt: true } } } });
    return access ? { invited: true, isActive: access.isActive, email: access.portalUser.email, accountStatus: access.portalUser.status, lastLoginAt: access.portalUser.lastLoginAt, invitedAt: access.createdAt, invitedByName: access.invitedByName } : { invited: false };
  }

  /** Completes an invitation: sets the password, activates the login and signs the client in. */
  async accept(token: string, password: string) {
    const raw = this.prisma.raw;
    const t = await raw.portalToken.findUnique({ where: { tokenHash: sha256(token) }, include: { portalUser: true } });
    if (!t || t.type !== 'INVITE' || t.consumedAt || t.expiresAt < new Date()) throw ruleViolation('INVALID_TOKEN', 'This invitation link is invalid or has expired. Ask the clinic to send a new one.');
    await raw.$transaction([
      raw.portalToken.update({ where: { id: t.id }, data: { consumedAt: new Date() } }),
      raw.portalUser.update({ where: { id: t.portalUserId }, data: { passwordHash: await hashPassword(password), status: 'ACTIVE', failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } }),
    ]);
    const access = await this.firstAccess(t.portalUserId);
    if (!access) throw ruleViolation('NO_ACCESS', 'Your portal access is not active. Please contact your clinic.');
    return this.createSession(t.portalUserId, access.id);
  }

  /** Always succeeds (no account enumeration); sends a reset email when the login exists. */
  async forgot(email: string) {
    const user = await this.prisma.raw.portalUser.findUnique({ where: { email } });
    if (!user || user.status !== 'ACTIVE') return { ok: true };
    const access = await this.firstAccess(user.id);
    if (!access) return { ok: true };
    const token = await this.issueToken(user.id, 'RESET');
    await RequestContext.runAs({ organizationId: access.organizationId, userName: 'Client portal' }, async () => {
      await this.messages.enqueueTemplate(this.prisma.db, 'PORTAL_RESET', 'EMAIL', { clientName: user.name, link: `${appUrl()}/portal/reset?token=${token}` }, { clientId: access.clientId, recipient: user.email, sourceType: 'PortalUser', sourceId: user.id });
    });
    return { ok: true };
  }

  async reset(token: string, password: string) {
    const raw = this.prisma.raw;
    const t = await raw.portalToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!t || t.type !== 'RESET' || t.consumedAt || t.expiresAt < new Date()) throw ruleViolation('INVALID_TOKEN', 'This reset link is invalid or has expired');
    await raw.$transaction([
      raw.portalToken.update({ where: { id: t.id }, data: { consumedAt: new Date() } }),
      raw.portalUser.update({ where: { id: t.portalUserId }, data: { passwordHash: await hashPassword(password), failedLoginCount: 0, lockedUntil: null } }),
      raw.portalSession.updateMany({ where: { portalUserId: t.portalUserId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    return { ok: true };
  }
}
