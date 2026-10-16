import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestContext } from '../context/request-context';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string | null;
  summary?: string;
  changes?: Record<string, unknown> | null;
  organizationId?: string | null;
  actorUserId?: string | null;
  actorName?: string | null;
}

/** Any Prisma client or transaction (plain or tenant-extended). */
type TxLike = { auditEvent: { create: (args: any) => PromiseLike<unknown> } };

const REDACT = /password|secret|token|hash|recovery/i;

/** Field-level diff for audit trails; redacts secrets. */
export function diff(before: Record<string, any> | null, after: Record<string, any>, fields?: string[]) {
  const keys = fields ?? Object.keys(after);
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of keys) {
    if (REDACT.test(k)) continue;
    const a = normalize(before?.[k]);
    const b = normalize(after[k]);
    if (JSON.stringify(a) !== JSON.stringify(b)) out[k] = { from: a, to: b };
  }
  return out;
}

function normalize(v: unknown) {
  if (v instanceof Date) return v.toISOString();
  if (v && typeof v === 'object' && 'toFixed' in (v as any)) return String(v); // Prisma Decimal
  return v === undefined ? null : v;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record an audit event. Pass `tx` to write it in the same transaction as the change,
   * so the change and its audit trail commit or roll back together.
   */
  async record(input: AuditInput, tx?: TxLike) {
    const ctx = RequestContext.get();
    const client = tx ?? this.prisma.raw;
    await client.auditEvent.create({
      data: {
        organizationId: input.organizationId !== undefined ? input.organizationId : (ctx?.organizationId ?? null),
        branchId: ctx?.branchId ?? null,
        actorUserId: input.actorUserId !== undefined ? input.actorUserId : (ctx?.userId ?? null),
        actorName: input.actorName ?? ctx?.userName ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        summary: input.summary,
        changes: (input.changes ?? undefined) as Prisma.InputJsonValue | undefined,
        ip: ctx?.ip,
        userAgent: ctx?.userAgent?.slice(0, 300),
        requestId: ctx?.requestId,
      },
    });
  }

  /** Fire-and-forget variant for read-access logging where failure must not block the user. */
  recordAsync(input: AuditInput) {
    this.record(input).catch((e) => this.logger.error(`Audit write failed: ${e.message}`));
  }
}
