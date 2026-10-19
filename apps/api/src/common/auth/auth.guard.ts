import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { RequestContext } from '../context/request-context';
import { forbidden } from '../http/errors';
import { SessionService } from '../../modules/auth/session.service';
import { CSRF_HEADER, SESSION_COOKIE } from './session-cookies';
import { ALLOW_DURING_PASSWORD_CHANGE, ANY_PERMISSIONS, IS_PORTAL, IS_PUBLIC, PERMISSIONS, SKIP_CSRF } from './decorators';
import { safeEqual } from '../crypto/crypto';
import { isAllowedOrigin } from '../tenancy/hosts';
import { requestHost } from '../tenancy/tenant-resolver.middleware';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global guard:
 *  1. Rejects cross-origin state-changing requests.
 *  2. Resolves the session cookie into the request context (user, org, branch, permissions).
 *  3. Enforces CSRF double-submit on state-changing requests.
 *  4. Enforces @RequirePermissions / @RequireAnyPermission.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<Request>();
    const handlers = [context.getHandler(), context.getClass()];
    // Client-portal routes have their own guard and session; a staff session must not interfere.
    if (this.reflector.getAllAndOverride<boolean>(IS_PORTAL, handlers)) return true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, handlers);
    const skipCsrf = this.reflector.getAllAndOverride<boolean>(SKIP_CSRF, handlers);
    const unsafe = !SAFE_METHODS.has(req.method);

    if (unsafe) this.checkOrigin(req);

    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
    const resolved = token ? await this.sessions.resolve(token, req.header('x-branch-id') ?? undefined) : null;

    if (resolved) {
      const store = RequestContext.require();
      Object.assign(store, resolved.context);
      (req as any).session = resolved.session;
      if (unsafe && !skipCsrf) {
        const header = req.header(CSRF_HEADER) ?? '';
        if (!header || !safeEqual(header, resolved.session.csrfToken)) {
          throw forbidden('Invalid or missing CSRF token');
        }
      }
    }

    if (isPublic) return true;
    if (!resolved) throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Please sign in' });
    // Signed in with a temporary password: nothing else is allowed until the user chooses their own.
    if (resolved.session.user.mustChangePassword && !this.reflector.getAllAndOverride<boolean>(ALLOW_DURING_PASSWORD_CHANGE, handlers)) {
      throw new ForbiddenException({ code: 'PASSWORD_CHANGE_REQUIRED', message: 'Choose a new password to continue' });
    }

    const all = this.reflector.getAllAndOverride<string[]>(PERMISSIONS, handlers) ?? [];
    const any = this.reflector.getAllAndOverride<string[]>(ANY_PERMISSIONS, handlers) ?? [];
    const granted = resolved.context.permissions;
    if (all.length && !all.every((p) => granted.has(p))) throw forbidden();
    if (any.length && !any.some((p) => granted.has(p))) throw forbidden();
    return true;
  }

  private checkOrigin(req: Request) {
    const origin = req.header('origin');
    if (!origin) return; // non-browser clients; CSRF token still required for cookie sessions
    if (!isAllowedOrigin(origin, requestHost(req))) throw forbidden('Cross-origin request rejected');
  }
}
