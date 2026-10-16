import { Injectable } from '@nestjs/common';
import type { BranchInput, OrganizationUpdateInput } from '@vcms/shared';
import { AuditService, diff } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { notFound, ruleViolation } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async current() {
    return this.prisma.raw.organization.findUniqueOrThrow({ where: { id: RequestContext.orgId() } });
  }

  async update(input: OrganizationUpdateInput) {
    const id = RequestContext.orgId();
    return this.prisma.raw.$transaction(async (tx) => {
      const before = await tx.organization.findUniqueOrThrow({ where: { id } });
      const after = await tx.organization.update({ where: { id }, data: input });
      await this.audit.record(
        { action: 'organization.updated', entityType: 'Organization', entityId: id, changes: diff(before, after, Object.keys(input)) },
        tx,
      );
      return after;
    });
  }

  async setLogo(attachmentId: string | null) {
    const id = RequestContext.orgId();
    if (attachmentId) {
      const a = await this.prisma.db.attachment.findUnique({ where: { id: attachmentId } });
      if (!a || a.deletedAt || a.entityType !== 'Organization' || !a.mimeType.startsWith('image/')) {
        throw ruleViolation('INVALID_LOGO', 'Upload an image file first');
      }
    }
    await this.prisma.raw.organization.update({ where: { id }, data: { logoAttachmentId: attachmentId } });
    await this.audit.record({ action: 'organization.logo_updated', entityType: 'Organization', entityId: id });
  }

  listBranches(includeInactive = true) {
    return this.prisma.db.branch.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { members: true } } },
    });
  }

  async createBranch(input: BranchInput) {
    return this.prisma.db.$transaction(async (tx) => {
      const branch = await tx.branch.create({ data: { ...input, organizationId: RequestContext.orgId() } });
      // Owners automatically get access to new branches.
      const owners = await tx.membership.findMany({ where: { roles: { some: { role: { key: 'owner' } } } }, select: { id: true } });
      if (owners.length) {
        await tx.membershipBranch.createMany({ data: owners.map((o) => ({ membershipId: o.id, branchId: branch.id })), skipDuplicates: true });
      }
      await this.audit.record({ action: 'branch.created', entityType: 'Branch', entityId: branch.id, summary: branch.name }, tx);
      return branch;
    });
  }

  async updateBranch(id: string, input: Partial<BranchInput>) {
    return this.prisma.db.$transaction(async (tx) => {
      const before = await tx.branch.findUnique({ where: { id } });
      if (!before) throw notFound('Branch');
      if (input.isActive === false && before.isActive) {
        const active = await tx.branch.count({ where: { isActive: true } });
        if (active <= 1) throw ruleViolation('LAST_BRANCH', 'An organization needs at least one active branch');
      }
      const after = await tx.branch.update({ where: { id }, data: input });
      await this.audit.record(
        { action: 'branch.updated', entityType: 'Branch', entityId: id, changes: diff(before, after, Object.keys(input)) },
        tx,
      );
      return after;
    });
  }
}
