import { Injectable } from '@nestjs/common';
import { OWNER_ONLY_PERMISSIONS, PERMISSION_GROUPS, isPermission, type RoleInput } from '@vcms/shared';
import { AuditService } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { forbidden, notFound, ruleViolation } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  catalogue() {
    return Object.entries(PERMISSION_GROUPS).map(([key, g]) => ({
      key,
      label: g.label,
      // Owner-only permissions (branding) cannot be given to other roles, so they are not offered.
      permissions: Object.entries(g.permissions)
        .filter(([permission]) => !(OWNER_ONLY_PERMISSIONS as readonly string[]).includes(permission))
        .map(([permission, description]) => ({ permission, description })),
    }));
  }

  async list() {
    const roles = await this.prisma.db.role.findMany({
      include: { permissions: true, _count: { select: { memberships: true } } },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    });
    return roles.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem,
      memberCount: r._count.memberships,
      permissions: r.permissions.map((p) => p.permission).sort(),
    }));
  }

  private validate(permissions: string[]) {
    const invalid = permissions.filter((p) => !isPermission(p));
    if (invalid.length) throw ruleViolation('INVALID_PERMISSION', `Unknown permissions: ${invalid.join(', ')}`);
    const ownerOnly = permissions.filter((p) => (OWNER_ONLY_PERMISSIONS as readonly string[]).includes(p));
    if (ownerOnly.length) throw ruleViolation('OWNER_ONLY_PERMISSION', 'Only the clinic owner can change the branding; it cannot be given to another role');
    const mine = RequestContext.require().permissions;
    const escalation = permissions.filter((p) => !mine.has(p));
    if (escalation.length) throw forbidden('A role cannot grant permissions you do not hold yourself');
    return [...new Set(permissions)];
  }

  async create(input: RoleInput) {
    const permissions = this.validate(input.permissions);
    return this.prisma.db.$transaction(async (tx) => {
      const role = await tx.role.create({
        data: {
          organizationId: RequestContext.orgId(),
          name: input.name,
          description: input.description,
          isSystem: false,
          permissions: { create: permissions.map((permission) => ({ permission })) },
        },
      });
      await this.audit.record(
        { action: 'role.created', entityType: 'Role', entityId: role.id, summary: role.name, changes: { permissions: { from: null, to: permissions } } },
        tx,
      );
      return role;
    });
  }

  async update(id: string, input: Partial<RoleInput>) {
    const role = await this.prisma.db.role.findUnique({ where: { id }, include: { permissions: true } });
    if (!role) throw notFound('Role');
    if (role.key === 'owner') throw ruleViolation('OWNER_ROLE_LOCKED', 'The owner role always has every permission and cannot be edited');
    if (role.isSystem && input.name && input.name !== role.name) {
      throw ruleViolation('SYSTEM_ROLE', 'System roles cannot be renamed');
    }
    const before = role.permissions.map((p) => p.permission).sort();
    const permissions = input.permissions ? this.validate(input.permissions) : undefined;
    if (permissions) {
      // Removing permissions you do not hold is also an escalation vector in reverse (locking others out) — allowed only within your own scope.
      const removed = before.filter((p) => !permissions.includes(p));
      const mine = RequestContext.require().permissions;
      if (removed.some((p) => !mine.has(p))) throw forbidden('You cannot remove permissions you do not hold yourself');
    }
    return this.prisma.db.$transaction(async (tx) => {
      const updated = await tx.role.update({
        where: { id },
        data: { name: input.name, description: input.description },
      });
      if (permissions) {
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
        await tx.rolePermission.createMany({ data: permissions.map((permission) => ({ roleId: id, permission })) });
      }
      await this.audit.record(
        {
          action: 'role.updated',
          entityType: 'Role',
          entityId: id,
          summary: updated.name,
          changes: permissions ? { permissions: { from: before, to: permissions.sort() } } : undefined,
        },
        tx,
      );
      return updated;
    });
  }

  async remove(id: string) {
    const role = await this.prisma.db.role.findUnique({ where: { id }, include: { _count: { select: { memberships: true } } } });
    if (!role) throw notFound('Role');
    if (role.isSystem) throw ruleViolation('SYSTEM_ROLE', 'System roles cannot be deleted');
    if (role._count.memberships > 0) throw ruleViolation('ROLE_IN_USE', 'Remove this role from all staff before deleting it');
    await this.prisma.db.$transaction(async (tx) => {
      await tx.role.delete({ where: { id } });
      await this.audit.record({ action: 'role.deleted', entityType: 'Role', entityId: id, summary: role.name }, tx);
    });
  }
}
