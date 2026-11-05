import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CERTIFICATE_KIND_INFO, type CertificateKind, type CertificateTemplateInput, type CertificateTemplateUpdate } from '@vcms/shared';
import { AuditService } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { notFound, ruleViolation } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';

/** Templates are stored whole; this keeps one from growing past what prints sensibly (images included). */
const MAX_LAYOUT_BYTES = 3_000_000;

/**
 * The clinic's certificate designs. Each kind uses its default template unless the issuer picks another; with none,
 * the built-in design is used. A template that has been used to issue certificates can be switched off but not
 * deleted (the certificates keep their own copy of the design either way).
 */
@Injectable()
export class CertificateTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(kind?: CertificateKind) {
    const rows = await this.prisma.db.certificateTemplate.findMany({
      where: { kind },
      orderBy: [{ kind: 'asc' }, { isDefault: 'desc' }, { name: 'asc' }],
      select: { id: true, kind: true, name: true, isDefault: true, isActive: true, updatedAt: true, updatedByName: true, _count: { select: { certificates: true } } },
    });
    return rows.map(({ _count, ...t }) => ({ ...t, kindLabel: CERTIFICATE_KIND_INFO[t.kind].label, used: _count.certificates }));
  }

  async get(id: string) {
    const t = await this.prisma.db.certificateTemplate.findUnique({ where: { id }, include: { _count: { select: { certificates: true } } } });
    if (!t) throw notFound('Template');
    const { _count, ...rest } = t;
    return { ...rest, kindLabel: CERTIFICATE_KIND_INFO[t.kind].label, used: _count.certificates };
  }

  private checkSize(layout: unknown) {
    if (JSON.stringify(layout).length > MAX_LAYOUT_BYTES) throw ruleViolation('TOO_LARGE', 'This design is too large — use smaller images');
  }

  async create(input: CertificateTemplateInput) {
    this.checkSize(input.layout);
    const ctx = RequestContext.require();
    const id = await this.prisma.db.$transaction(async (tx) => {
      // The first template for a kind becomes its default.
      const hasDefault = await tx.certificateTemplate.count({ where: { kind: input.kind, isDefault: true } });
      const t = await tx.certificateTemplate.create({
        data: {
          organizationId: ctx.organizationId!,
          kind: input.kind,
          name: input.name,
          layout: input.layout as unknown as Prisma.InputJsonValue,
          isDefault: !hasDefault,
          createdByName: ctx.userName ?? null,
          updatedByName: ctx.userName ?? null,
        },
      });
      await this.audit.record({ action: 'certificate_template.created', entityType: 'CertificateTemplate', entityId: t.id, summary: `${t.name} (${CERTIFICATE_KIND_INFO[t.kind].label})` }, tx);
      return t.id;
    });
    return this.get(id);
  }

  async update(id: string, input: CertificateTemplateUpdate) {
    if (input.layout) this.checkSize(input.layout);
    const before = await this.prisma.db.certificateTemplate.findUnique({ where: { id } });
    if (!before) throw notFound('Template');
    await this.prisma.db.$transaction(async (tx) => {
      await tx.certificateTemplate.update({
        where: { id },
        data: {
          name: input.name,
          layout: input.layout as unknown as Prisma.InputJsonValue | undefined,
          isActive: input.isActive,
          // A template that is switched off stops being the default.
          ...(input.isActive === false ? { isDefault: false } : {}),
          updatedByName: RequestContext.require().userName ?? null,
        },
      });
      const what = [input.name !== undefined && input.name !== before.name && `renamed to ${input.name}`, input.layout && 'design changed', input.isActive === false && 'switched off', input.isActive === true && !before.isActive && 'switched on'];
      await this.audit.record({ action: 'certificate_template.updated', entityType: 'CertificateTemplate', entityId: id, summary: `${before.name}: ${what.filter(Boolean).join(', ') || 'saved'}` }, tx);
    });
    return this.get(id);
  }

  async setDefault(id: string) {
    const t = await this.prisma.db.certificateTemplate.findUnique({ where: { id } });
    if (!t) throw notFound('Template');
    if (!t.isActive) throw ruleViolation('INACTIVE', 'Switch the template on first');
    await this.prisma.db.$transaction(async (tx) => {
      await tx.certificateTemplate.updateMany({ where: { kind: t.kind, isDefault: true, id: { not: id } }, data: { isDefault: false } });
      await tx.certificateTemplate.update({ where: { id }, data: { isDefault: true } });
      await this.audit.record({ action: 'certificate_template.default', entityType: 'CertificateTemplate', entityId: id, summary: `${t.name} is the default for ${CERTIFICATE_KIND_INFO[t.kind].label}` }, tx);
    });
    return this.get(id);
  }

  async remove(id: string) {
    const t = await this.get(id);
    if (t.used) throw ruleViolation('IN_USE', `${t.used} certificate${t.used === 1 ? ' was' : 's were'} issued with this template — switch it off instead`);
    await this.prisma.db.$transaction(async (tx) => {
      await tx.certificateTemplate.delete({ where: { id } });
      await this.audit.record({ action: 'certificate_template.deleted', entityType: 'CertificateTemplate', entityId: id, summary: t.name }, tx);
    });
    return { ok: true };
  }
}
