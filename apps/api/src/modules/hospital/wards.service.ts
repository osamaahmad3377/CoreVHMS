import { Injectable } from '@nestjs/common';
import { WardType } from '@prisma/client';
import { AuditService, diff } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { assertDeletable, deleteOrExplain, deletionCheck, usage } from '../../common/deletion/deletion';
import { conflict, notFound, ruleViolation } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';

const WARD_INSTEAD = 'Switch it off instead (untick “Active”) — it is hidden from the ward board, and past hospital stays keep it.';

@Injectable()
export class WardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Wards with their cages and who is in each cage right now. */
  async list(branchId?: string, includeInactive = false) {
    const wards = await this.prisma.db.ward.findMany({
      where: { branchId, ...(includeInactive ? {} : { isActive: true }) },
      include: {
        dailyService: { select: { id: true, name: true, priceMinor: true } },
        branch: { select: { name: true } },
        cages: {
          where: includeInactive ? {} : { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          include: { admissions: { where: { status: 'ADMITTED' }, select: { id: true, patient: { select: { id: true, name: true } } } } },
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return wards.map((w) => ({ ...w, cages: w.cages.map(({ admissions, ...c }) => ({ ...c, occupant: admissions[0] ?? null })) }));
  }

  async saveWard(id: string | null, input: { branchId: string; name: string; type: WardType; dailyServiceId?: string | null; sortOrder: number; isActive: boolean }) {
    if (!(await this.prisma.db.branch.findUnique({ where: { id: input.branchId } }))) throw ruleViolation('INVALID_BRANCH', 'Branch not found');
    if (input.dailyServiceId && !(await this.prisma.db.service.findUnique({ where: { id: input.dailyServiceId } }))) throw notFound('Service');
    if (id && !input.isActive && (await this.prisma.db.admission.count({ where: { wardId: id, status: 'ADMITTED' } }))) {
      throw ruleViolation('WARD_OCCUPIED', 'Move or discharge the patients in this ward before deactivating it');
    }
    try {
      return await this.prisma.db.$transaction(async (tx) => {
        if (id) {
          const before = await tx.ward.findUnique({ where: { id } });
          if (!before) throw notFound('Ward');
          const after = await tx.ward.update({ where: { id }, data: input });
          await this.audit.record({ action: 'ward.updated', entityType: 'Ward', entityId: id, summary: after.name, changes: diff(before, after, Object.keys(input)) }, tx);
          return after;
        }
        const w = await tx.ward.create({ data: { ...input, organizationId: RequestContext.orgId() } });
        await this.audit.record({ action: 'ward.created', entityType: 'Ward', entityId: w.id, summary: w.name }, tx);
        return w;
      });
    } catch (e: any) {
      if (e?.code === 'P2002') throw conflict('A ward with this name already exists at this branch');
      throw e;
    }
  }

  async saveCage(id: string | null, input: { wardId: string; name: string; notes?: string | null; isActive: boolean }) {
    if (!(await this.prisma.db.ward.findUnique({ where: { id: input.wardId } }))) throw notFound('Ward');
    if (id && !input.isActive && (await this.prisma.db.admission.count({ where: { cageId: id, status: 'ADMITTED' } }))) {
      throw ruleViolation('CAGE_OCCUPIED', 'This cage is occupied');
    }
    try {
      return await this.prisma.db.$transaction(async (tx) => {
        const c = id ? await tx.cage.update({ where: { id }, data: input }) : await tx.cage.create({ data: { ...input, organizationId: RequestContext.orgId() } });
        await this.audit.record({ action: id ? 'cage.updated' : 'cage.created', entityType: 'Ward', entityId: c.wardId, summary: c.name }, tx);
        return c;
      });
    } catch (e: any) {
      if (e?.code === 'P2002') throw conflict('A cage with this name already exists in this ward');
      if (e?.code === 'P2025') throw notFound('Cage');
      throw e;
    }
  }

  // ── Deleting wards and cages added by mistake (never used for a hospital stay) ──
  private wardHistory(where: { wardId: string } | { cageId: string }) {
    return usage([['hospital stay', 'hospital stays', this.prisma.db.admission.count({ where })]]);
  }

  async wardDeletionCheck(id: string) {
    if (!(await this.prisma.db.ward.findUnique({ where: { id }, select: { id: true } }))) throw notFound('Ward');
    return deletionCheck(await this.wardHistory({ wardId: id }), WARD_INSTEAD);
  }

  /** Deletes a ward that has never had a patient; its cages go with it. */
  async removeWard(id: string) {
    const w = await this.prisma.db.ward.findUnique({ where: { id }, include: { _count: { select: { cages: true } } } });
    if (!w) throw notFound('Ward');
    assertDeletable(w.name, deletionCheck(await this.wardHistory({ wardId: id }), WARD_INSTEAD));
    await this.prisma.db.$transaction(async (tx) => {
      await deleteOrExplain(w.name, WARD_INSTEAD, () => tx.ward.delete({ where: { id } }));
      await this.audit.record({ action: 'ward.deleted', entityType: 'Ward', entityId: id, summary: `${w.name} and its ${w._count.cages} cage(s) deleted — never used` }, tx);
    });
    return { ok: true };
  }

  async cageDeletionCheck(id: string) {
    if (!(await this.prisma.db.cage.findUnique({ where: { id }, select: { id: true } }))) throw notFound('Cage');
    return deletionCheck(await this.wardHistory({ cageId: id }), WARD_INSTEAD);
  }

  async removeCage(id: string) {
    const c = await this.prisma.db.cage.findUnique({ where: { id } });
    if (!c) throw notFound('Cage');
    assertDeletable(c.name, deletionCheck(await this.wardHistory({ cageId: id }), WARD_INSTEAD));
    await this.prisma.db.$transaction(async (tx) => {
      await deleteOrExplain(c.name, WARD_INSTEAD, () => tx.cage.delete({ where: { id } }));
      await this.audit.record({ action: 'cage.deleted', entityType: 'Ward', entityId: c.wardId, summary: `${c.name} deleted — never used` }, tx);
    });
    return { ok: true };
  }
}
