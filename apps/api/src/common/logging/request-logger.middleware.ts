import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { RequestContext } from '../context/request-context';

const log = new Logger('HTTP');

/** Access log: method, route path (no query string, which may hold personal data), status, duration, user. */
export function requestLoggerMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.path.startsWith('/api/v1/health')) return next();
  const started = process.hrtime.bigint();
  // Capture the request context now: the guard fills in user/org later, on the same object.
  const ctx = RequestContext.get();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const msg = `${req.method} ${req.path} ${res.statusCode} ${ms.toFixed(1)}ms${ctx?.userId ? ` user=${ctx.userId}` : ''}${ctx?.organizationId ? ` org=${ctx.organizationId}` : ''}`;
    if (res.statusCode >= 500) log.error(msg);
    else if (res.statusCode >= 400) log.warn(msg);
    else log.log(msg);
  });
  next();
}
