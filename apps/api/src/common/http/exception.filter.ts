import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { RequestContext } from '../context/request-context';
import { TenantIsolationError } from '../prisma/tenant-extension';
import { formatZodError } from './zod';

const STATUS_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE',
  429: 'RATE_LIMITED',
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const requestId = RequestContext.get()?.requestId;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'An unexpected error occurred';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse() as any;
      code = (typeof body === 'object' && body?.code) || STATUS_CODES[status] || 'ERROR';
      message =
        typeof body === 'string'
          ? body
          : Array.isArray(body?.message)
            ? body.message.join(', ')
            : body?.message || exception.message;
      details = typeof body === 'object' ? body?.details : undefined;
    } else if (exception instanceof ZodError) {
      status = 400;
      code = 'VALIDATION_ERROR';
      message = 'The request contains invalid data';
      details = formatZodError(exception);
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        status = 409;
        code = 'CONFLICT';
        const target = (exception.meta?.target as string[] | undefined)?.filter((t) => t !== 'organizationId');
        message = `A record with the same ${target?.join(', ') || 'unique value'} already exists`;
        details = { fields: target };
      } else if (exception.code === 'P2025') {
        status = 404;
        code = 'NOT_FOUND';
        message = 'Record not found';
      } else if (exception.code === 'P2003') {
        status = 409;
        code = 'REFERENCE_CONFLICT';
        message = 'The record is referenced by other data or references missing data';
      } else {
        this.logger.error(`Prisma ${exception.code}: ${exception.message}`);
      }
    } else if (isExclusionViolation(exception)) {
      status = 409;
      code = 'SCHEDULING_CONFLICT';
      message = 'That time slot was just taken by another booking. Refresh and choose another time.';
    } else if (exception instanceof TenantIsolationError) {
      status = 403;
      code = 'FORBIDDEN';
      message = 'Access denied';
      this.logger.warn(`Tenant isolation violation: ${exception.message} (${req.method} ${req.url})`);
    } else {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }

    if (status >= 500) {
      this.logger.error(`${req.method} ${req.url} → ${status} [${requestId}]`);
    }

    res.status(status).json({ error: { code, message, details, requestId } });
  }
}

/** Postgres exclusion-constraint violation (23P01) — the database rejected an overlapping booking. */
function isExclusionViolation(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const m = e.message ?? '';
  return m.includes('23P01') || m.includes('exclusion constraint') || m.includes('_no_overlap');
}
