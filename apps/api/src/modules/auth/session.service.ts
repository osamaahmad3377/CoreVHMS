import { Injectable } from '@nestjs/common';
import type { Session, User } from '@prisma/client';
import { ALL_PLATFORM_PERMISSIONS, enabledModules, hasFeature, permissionInPlan, type SessionContext } from '@vcms/shared';
import { env } from '../../config/env';
import { RequestContext, RequestContextStore } from '../../common/context/request-context';
import { randomToken, sha256 } from '../../common/crypto/crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { brandingOf } from '../organizations/organizations.service';

export interface ResolvedSession {
  session: Session & { user: User };
  context: Pick<
    RequestContextStore,
    'userId' | 'userName' | 'sessionId' | 'organizationId' | 'branchId' | 'membershipId' | 'permissions'
  >;
  branchIds: string[];
}

const TOUCH_INTERVAL_MS = 60_000;

@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, opts: { organizationId?: string | null; branchId?: string | null; ip?: string; userAgent?: string }) {
    const token = randomToken(32);
    const now = Date.now();
    const e = env();
    const expiresAt = new Date(now + e.SESSION_ABSOLUTE_HOURS * 3600_000);
    const idleExpiresAt = new Date(Math.min(now + e.SESSION_IDLE_MINUTES * 60_000, expiresAt.getTime()));
    const session = await this.prisma.raw.session.create({
      data: {
        userId,
        tokenHash: sha256(token),
        csrfToken: randomToken(24),
        organizationId: opts.organizationId ?? null,
        branchId: opts.branchId ?? null,
        ip: opts.ip,
        userAgent: opts.userAgent?.slice(0, 300),
        expiresAt,
        idleExpiresAt,
      },
    });
    return { token, session };
  }

  async resolve(token: string, branchHeader?: string): Promise<ResolvedSession | null> {
    const session = await this.prisma.raw.session.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: true },
    });
    const now = new Date();
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= now ||
      session.idleExpiresAt <= now ||
      session.user.status !== 'ACTIVE'
    ) {
      return null;
    }

    if (now.getTime() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      const idle = new Date(Math.min(now.getTime() + env().SESSION_IDLE_MINUTES * 60_000, session.expiresAt.getTime()));
      await this.prisma.raw.session.update({ where: { id: session.id }, data: { lastSeenAt: now, idleExpiresAt: idle } });
    }

    let permissions = new Set<string>();
    let organizationId: string | undefined;
    let branchId: string | undefined;
    let membershipId: string | undefined;
    let branchIds: string[] = [];

    if (RequestContext.get()?.platform) {
      // Super admin address: platform permissions only, never clinic data.
      if (session.user.isPlatformAdmin) permissions = new Set(ALL_PLATFORM_PERMISSIONS);
    } else if (session.organizationId) {
      const m = await this.prisma.raw.membership.findUnique({
        where: { organizationId_userId: { organizationId: session.organizationId, userId: session.userId } },
        include: {
          organization: { select: { status: true } },
          roles: { include: { role: { include: { permissions: true } } } },
          branches: { include: { branch: { select: { id: true, isActive: true } } } },
        },
      });
      if (m && m.status === 'ACTIVE' && m.organization.status === 'ACTIVE') {
        organizationId = m.organizationId;
        membershipId = m.id;
        // Areas the clinic's plan does not include are closed for everyone, whatever their role says.
        const entitlements = RequestContext.get()?.tenant?.entitlements;
        permissions = new Set(m.roles.flatMap((r) => r.role.permissions.map((p) => p.permission)).filter((p) => permissionInPlan(entitlements, p)));
        branchIds = m.branches.filter((b) => b.branch.isActive).map((b) => b.branchId);
        if (branchHeader && branchIds.includes(branchHeader)) branchId = branchHeader;
        else if (session.branchId && branchIds.includes(session.branchId)) branchId = session.branchId;
        else branchId = branchIds[0];
      }
    }

    return {
      session,
      branchIds,
      context: {
        userId: session.userId,
        userName: session.user.name,
        sessionId: session.id,
        organizationId,
        branchId,
        membershipId,
        permissions,
      },
    };
  }

  async revoke(sessionId: string) {
    await this.prisma.raw.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async revokeAllForUser(userId: string, exceptSessionId?: string) {
    await this.prisma.raw.session.updateMany({
      where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
      data: { revokedAt: new Date() },
    });
  }

  /** Full context returned to the web app after login and on page load. */
  async describe(sessionId: string, store: RequestContextStore): Promise<SessionContext> {
    const session = await this.prisma.raw.session.findUniqueOrThrow({ where: { id: sessionId }, include: { user: true } });
    const memberships = await this.prisma.raw.membership.findMany({
      where: { userId: session.userId, status: 'ACTIVE', organization: { status: 'ACTIVE' } },
      include: { organization: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });

    let organization: SessionContext['organization'] = null;
    let branches: SessionContext['branches'] = [];
    let roles: SessionContext['roles'] = [];
    if (store.organizationId && store.membershipId) {
      const org = await this.prisma.raw.organization.findUniqueOrThrow({ where: { id: store.organizationId } });
      organization = {
        id: org.id,
        name: org.name,
        country: org.country,
        currency: org.currency,
        logoUrl: org.logoAttachmentId ? `/api/v1/organization/logo` : null,
        // The clinic's own choices (Services you offer), limited to what its plan includes.
        enabledModules: enabledModules(org.disabledModules).filter((m) => hasFeature(RequestContext.get()?.tenant?.entitlements, m)),
        branding: brandingOf(org),
      };
      const m = await this.prisma.raw.membership.findUniqueOrThrow({
        where: { id: store.membershipId },
        include: {
          roles: { include: { role: { select: { id: true, name: true } } } },
          branches: { include: { branch: true }, where: { branch: { isActive: true } } },
        },
      });
      roles = m.roles.map((r) => r.role);
      branches = m.branches
        .map((b) => ({ id: b.branch.id, name: b.branch.name, timezone: b.branch.timezone }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }

    return {
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        isPlatformAdmin: session.user.isPlatformAdmin,
        mfaEnabled: session.user.mfaEnabled,
        mustChangePassword: session.user.mustChangePassword,
      },
      organization,
      branch: branches.find((b) => b.id === store.branchId) ?? null,
      branches,
      organizations: memberships.map((m) => m.organization),
      roles,
      permissions: [...store.permissions].sort(),
      csrfToken: session.csrfToken,
      features: { clientPortal: env().CLIENT_PORTAL_ENABLED },
      platform: RequestContext.get()?.platform === true,
      entitlements: RequestContext.get()?.tenant?.entitlements ?? null,
    };
  }
}
