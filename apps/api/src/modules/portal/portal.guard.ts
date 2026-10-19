import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PORTAL_PUBLIC } from '../../common/auth/decorators';
import { CSRF_HEADER } from '../../common/auth/session-cookies';
import { RequestContext } from '../../common/context/request-context';
import { safeEqual } from '../../common/crypto/crypto';
import { forbidden } from '../../common/http/errors';
import { isAllowedOrigin } from '../../common/tenancy/hosts';
import { requestHost } from '../../common/tenancy/tenant-resolver.middleware';
import { PORTAL_SESSION_COOKIE, PortalAuthService } from './portal-auth.service';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Authenticates client-portal requests and binds them to the client's clinic (tenant) and client record. */
@Injectable()
export class PortalGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: PortalAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const isPublic = this.reflector.getAllAndOverride<boolean>(PORTAL_PUBLIC, [context.getHandler(), context.getClass()]);
    const unsafe = !SAFE.has(req.method);
    if (unsafe) {
      const origin = req.header('origin');
      if (origin && !isAllowedOrigin(origin, requestHost(req))) throw forbidden('Cross-origin request rejected');
    }
    const token = req.cookies?.[PORTAL_SESSION_COOKIE] as string | undefined;
    const ctx = token ? await this.auth.resolve(token) : null;
    if (ctx) {
      if (unsafe && !isPublic && !safeEqual(req.header(CSRF_HEADER) ?? '', ctx.csrfToken)) throw forbidden('Invalid or missing CSRF token');
      Object.assign(RequestContext.require(), { organizationId: ctx.organizationId, userId: undefined, userName: `${ctx.name} (client portal)`, permissions: new Set<string>() });
      (req as any).portal = ctx;
    }
    if (isPublic) return true;
    if (!ctx) throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Please sign in to the client portal' });
    return true;
  }
}
