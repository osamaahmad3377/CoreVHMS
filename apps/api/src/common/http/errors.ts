import { ConflictException, ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';

export const notFound = (entity: string) =>
  new NotFoundException({ code: 'NOT_FOUND', message: `${entity} not found` });

export const conflict = (message: string, details?: unknown) =>
  new ConflictException({ code: 'CONFLICT', message, details });

export const forbidden = (message = 'You do not have permission to perform this action') =>
  new ForbiddenException({ code: 'FORBIDDEN', message });

/** A business rule prevented the operation (e.g. editing a signed record). */
export const ruleViolation = (code: string, message: string, details?: unknown) =>
  new UnprocessableEntityException({ code, message, details });
