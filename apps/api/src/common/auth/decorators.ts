import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Permission } from '@vcms/shared';
import { RequestContext, RequestContextStore } from '../context/request-context';

export const IS_PUBLIC = 'vcms:public';
export const PERMISSIONS = 'vcms:permissions';
export const ANY_PERMISSIONS = 'vcms:any-permissions';
export const SKIP_CSRF = 'vcms:skip-csrf';

/** Route does not require a session. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Route needs only a signed-in staff session (own account: session, password, MFA, logout). */
export const IS_AUTHENTICATED = 'vcms:authenticated';
/** Still reachable while the user must replace a temporary password (load the session, sign out, change password). */
export const ALLOW_DURING_PASSWORD_CHANGE = 'vcms:allow-during-password-change';
export const AllowDuringPasswordChange = () => SetMetadata(ALLOW_DURING_PASSWORD_CHANGE, true);
export const Authenticated = () => SetMetadata(IS_AUTHENTICATED, true);

/** Route requires ALL listed permissions in the active organization. */
export const RequirePermissions = (...permissions: Permission[]) => SetMetadata(PERMISSIONS, permissions);

/** Route requires AT LEAST ONE of the listed permissions. */
export const RequireAnyPermission = (...permissions: Permission[]) => SetMetadata(ANY_PERMISSIONS, permissions);

/** Unauthenticated state-changing endpoints (login, reset) that cannot carry a CSRF token. */
export const SkipCsrf = () => SetMetadata(SKIP_CSRF, true);

export const Ctx = createParamDecorator(
  (_data: unknown, _ctx: ExecutionContext): RequestContextStore => RequestContext.require(),
);

/** Client-portal route: authenticated by the portal guard, never by a staff session. */
export const IS_PORTAL = 'vcms:portal';
export const PortalRoute = () => SetMetadata(IS_PORTAL, true);
/** Portal route that does not need a signed-in client (login, invitation, password reset). */
export const PORTAL_PUBLIC = 'vcms:portal-public';
export const PortalPublic = () => SetMetadata(PORTAL_PUBLIC, true);
