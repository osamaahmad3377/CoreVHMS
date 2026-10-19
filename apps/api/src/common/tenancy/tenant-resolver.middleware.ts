import type { NextFunction, Request, Response } from 'express';
import { RequestContext } from '../context/request-context';
import { classifyHost } from './hosts';
import { TenancyService, tenantRef } from './tenancy.service';

/** Reachable on any address, including a paused clinic or the bare domain: health checks and "which clinic is this?". */
const OPEN_PATHS = /^\/api\/v1\/(health|tenant)(\/|$|\?)/;

/** The address the browser used. The web server forwards it as X-Forwarded-Host when proxying /api. */
export function requestHost(req: Request): string | undefined {
  return req.header('x-forwarded-host') || req.header('host') || undefined;
}

function reject(res: Response, status: number, code: string, message: string) {
  res.status(status).json({ error: { code, message, requestId: RequestContext.get()?.requestId } });
}

/**
 * Multi-clinic mode: maps the request's subdomain to a clinic and points all data access at that clinic's
 * database. The super admin address uses the platform database. Unknown, paused or unfinished clinics get
 * nothing beyond the open paths. In single-clinic mode this does nothing.
 */
export function tenantResolverMiddleware(tenancy: TenancyService) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const host = classifyHost(requestHost(req));
      const store = RequestContext.require();
      const open = OPEN_PATHS.test(req.originalUrl);
      switch (host.kind) {
        case 'single':
          return next();
        case 'platform':
          store.platform = true;
          return next();
        case 'tenant': {
          const t = await tenancy.bySlug(host.slug);
          if (t?.status === 'ACTIVE') store.tenant = tenantRef(t);
          if (store.tenant || open) return next();
          if (!t) return reject(res, 404, 'CLINIC_NOT_FOUND', 'No clinic uses this address. Check the spelling.');
          if (t.status === 'SUSPENDED') return reject(res, 403, 'CLINIC_SUSPENDED', 'This clinic’s account is paused. Please contact NextCore support.');
          return reject(res, 503, 'CLINIC_NOT_READY', 'This clinic is still being set up. Please try again in a few minutes.');
        }
        default:
          return open ? next() : reject(res, 404, 'CLINIC_NOT_FOUND', 'Open your clinic’s own web address to sign in.');
      }
    } catch (e) {
      next(e);
    }
  };
}
