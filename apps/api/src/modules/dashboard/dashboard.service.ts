import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { PrismaService } from '../../common/prisma/prisma.service';
import { patientNo } from '../patients/patients.service';

export interface DashboardRange {
  from: Date;
  to: Date;
  branchId?: string;
}

/** A widget contributed by a module; only rendered when the user holds its permission. */
export interface DashboardWidget {
  key: string;
  permission: string;
  load(range: DashboardRange): Promise<unknown>;
}

@Injectable()
export class DashboardService {
  private readonly widgets: DashboardWidget[] = [];

  constructor(private readonly prisma: PrismaService) {
    this.register({
      key: 'registrations',
      permission: 'patients.read',
      load: async (r) => {
        const branch = r.branchId ? { primaryBranchId: r.branchId } : {};
        const [activeClients, activePatients, newClients, newPatients, species] = await Promise.all([
          this.prisma.db.client.count({ where: { status: 'ACTIVE', ...branch } }),
          this.prisma.db.patient.count({ where: { status: 'ACTIVE', ...branch } }),
          this.prisma.db.client.count({ where: { createdAt: { gte: r.from, lte: r.to }, status: { not: 'MERGED' }, ...branch } }),
          this.prisma.db.patient.count({ where: { createdAt: { gte: r.from, lte: r.to }, status: { not: 'MERGED' }, ...branch } }),
          this.prisma.db.patient.groupBy({ by: ['speciesId'], where: { status: 'ACTIVE', ...branch }, _count: { _all: true } }),
        ]);
        const speciesNames = await this.prisma.db.species.findMany({
          where: { id: { in: species.map((s) => s.speciesId) } },
          select: { id: true, name: true },
        });
        return {
          activeClients,
          activePatients,
          newClients,
          newPatients,
          species: species
            .map((s) => ({ name: speciesNames.find((n) => n.id === s.speciesId)?.name ?? 'Unknown', count: s._count._all }))
            .sort((a, b) => b.count - a.count),
        };
      },
    });
    this.register({
      key: 'recentPatients',
      permission: 'patients.read',
      load: async (r) => {
        const rows = await this.prisma.db.patient.findMany({
          where: { status: { not: 'MERGED' }, ...(r.branchId ? { primaryBranchId: r.branchId } : {}) },
          orderBy: { createdAt: 'desc' },
          take: 8,
          include: {
            species: { select: { name: true } },
            ownerships: { where: { endedAt: null, isPrimary: true }, include: { client: { select: { id: true, displayName: true } } } },
          },
        });
        return rows.map((p) => ({
          id: p.id,
          name: p.name,
          patientNo: patientNo(p.number),
          species: p.species.name,
          owner: p.ownerships[0]?.client ?? null,
          createdAt: p.createdAt,
        }));
      },
    });
    this.register({
      key: 'criticalAlerts',
      permission: 'patients.read',
      load: async () => {
        const rows = await this.prisma.db.patientAlert.findMany({
          where: { isActive: true, severity: 'CRITICAL', patient: { status: 'ACTIVE' } },
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: { patient: { select: { id: true, name: true } } },
        });
        return rows.map((a) => ({ id: a.id, title: a.title, type: a.type, patient: a.patient, createdAt: a.createdAt }));
      },
    });
  }

  register(widget: DashboardWidget) {
    this.widgets.push(widget);
  }

  async load(range: DashboardRange) {
    const perms = RequestContext.require().permissions;
    const visible = this.widgets.filter((w) => perms.has(w.permission));
    const entries = await Promise.all(visible.map(async (w) => [w.key, await w.load(range)] as const));
    return { range: { from: range.from, to: range.to, branchId: range.branchId ?? null }, generatedAt: new Date(), widgets: Object.fromEntries(entries) };
  }
}
