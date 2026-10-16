import { csvRow } from '../../common/util/csv';
import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { auditQuerySchema } from '@vcms/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { AuditService } from '../../common/audit/audit.service';
import { RequirePermissions } from '../../common/auth/decorators';
import { RequestContext } from '../../common/context/request-context';
import { paginated } from '../../common/http/pagination';
import { ApiZodQuery, zp } from '../../common/http/zod';
import { PrismaService } from '../../common/prisma/prisma.service';

@ApiTags('audit')
@Controller('audit-events')
export class AuditLogController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private where(q: z.infer<typeof auditQuerySchema>): Prisma.AuditEventWhereInput {
    // `action` is one prefix or a comma-separated list of prefixes (e.g. every kind of export).
    const prefixes = q.action?.split(',').map((a) => a.trim()).filter(Boolean) ?? [];
    // AuditEvent is not covered by the tenant extension, so scope explicitly.
    return {
      organizationId: RequestContext.orgId(),
      entityType: q.entityType,
      entityId: q.entityId,
      actorUserId: q.actorId,
      createdAt: q.from || q.to ? { gte: q.from, lte: q.to } : undefined,
      ...(prefixes.length ? { OR: prefixes.map((p) => ({ action: { startsWith: p } })) } : {}),
    };
  }

  /** CSV download of the filtered log (e.g. to preserve evidence during an incident). The export itself is audited. */
  @Get('export.csv')
  @RequirePermissions('audit.read')
  @ApiZodQuery(auditQuerySchema)
  async exportCsv(@Query(zp(auditQuerySchema)) q: z.infer<typeof auditQuerySchema>, @Res() res: Response) {
    const rows = await this.prisma.raw.auditEvent.findMany({ where: this.where(q), orderBy: { createdAt: 'asc' }, take: 100_000 });
    const cols = ['createdAt', 'actorName', 'actorUserId', 'action', 'entityType', 'entityId', 'summary', 'changes', 'ip', 'userAgent', 'requestId', 'branchId', 'id'] as const;
    const csv = [cols.join(','), ...rows.map((r) => csvRow(cols.map((c) => r[c])))].join('\r\n');
    await this.audit.record({ action: 'audit.exported', entityType: 'Organization', entityId: RequestContext.orgId(), summary: `${rows.length} events` });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(csv);
  }

  @Get()
  @RequirePermissions('audit.read')
  @ApiZodQuery(auditQuerySchema)
  async list(@Query(zp(auditQuerySchema)) q: z.infer<typeof auditQuerySchema>) {
    const where = this.where(q);
    const [rows, total] = await Promise.all([
      this.prisma.raw.auditEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.raw.auditEvent.count({ where }),
    ]);
    return paginated(rows, total, q);
  }
}
