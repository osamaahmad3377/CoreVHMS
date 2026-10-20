import { Injectable } from '@nestjs/common';
import { enabledModules, type OptionalModule } from '@vcms/shared';
import { featureAllowed } from '../../common/tenancy/entitlements';
import { RequestContext } from '../../common/context/request-context';
import { PrismaService } from '../../common/prisma/prisma.service';
import { localDayBounds } from '../../common/time/tz';
import { patientNo } from '../patients/patients.service';

export interface DashboardRange {
  from: Date;
  to: Date;
  branchId?: string;
}

/**
 * A widget contributed by a module; only loaded when the user holds its permission and, for an optional
 * module (Settings → Services you offer), only while the clinic has that module switched on.
 */
export interface DashboardWidget {
  key: string;
  permission: string;
  module?: OptionalModule;
  load(range: DashboardRange): Promise<unknown>;
}

/** Widgets registered before `module` existed, by key. */
const MODULE_OF_WIDGET: Record<string, OptionalModule> = {
  hospital: 'hospital',
  surgery: 'surgery',
  lab: 'lab',
  livestock: 'livestock',
  boarding: 'boarding',
  insurance: 'insurance',
};

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
    // Front desk: who is waiting now, and the next bookings to check in (current branch).
    this.register({
      key: 'frontDesk',
      permission: 'appointments.checkin',
      load: async (r) => {
        const db = this.prisma.db;
        const branchId = r.branchId ?? RequestContext.require().branchId;
        const branch = branchId ? await db.branch.findUnique({ where: { id: branchId } }) : null;
        const { start, end } = localDayBounds(new Date(), branch?.timezone ?? 'UTC');
        const where = { startsAt: { gte: start, lt: end }, ...(branchId ? { branchId } : {}) };
        const include = {
          patient: { select: { id: true, name: true } },
          client: { select: { id: true, displayName: true } },
          appointmentType: { select: { name: true, color: true } },
          clinician: { select: { user: { select: { name: true } } } },
        } as const;
        const [waitingCount, waiting, arriving] = await Promise.all([
          db.appointment.count({ where: { ...where, status: 'CHECKED_IN' } }),
          db.appointment.findMany({ where: { ...where, status: 'CHECKED_IN' }, include, orderBy: [{ checkedInAt: 'asc' }, { startsAt: 'asc' }], take: 6 }),
          db.appointment.findMany({ where: { ...where, status: { in: ['BOOKED', 'CONFIRMED'] } }, include, orderBy: { startsAt: 'asc' }, take: 5 }),
        ]);
        const late = Date.now() - 15 * 60_000;
        const shape = (a: (typeof waiting)[number]) => ({
          id: a.id,
          startsAt: a.startsAt,
          checkedInAt: a.checkedInAt,
          status: a.status,
          priority: a.priority,
          patient: a.patient,
          client: a.client ? { id: a.client.id, displayName: a.client.displayName } : null,
          type: a.appointmentType,
          clinician: a.clinician?.user.name ?? null,
          late: a.status !== 'CHECKED_IN' && a.startsAt.getTime() < late,
        });
        return { waitingCount, waiting: waiting.map(shape), arriving: arriving.map(shape) };
      },
    });
  }

  register(widget: DashboardWidget) {
    this.widgets.push(widget);
  }

  async load(range: DashboardRange) {
    const ctx = RequestContext.require();
    const perms = ctx.permissions;
    const org = await this.prisma.raw.organization.findUnique({ where: { id: RequestContext.orgId() }, select: { disabledModules: true } });
    const on = new Set(enabledModules(org?.disabledModules).filter(featureAllowed));
    const visible = this.widgets.filter((w) => {
      const module = w.module ?? MODULE_OF_WIDGET[w.key];
      return perms.has(w.permission) && (!module || on.has(module));
    });
    const entries = await Promise.all(visible.map(async (w) => [w.key, await w.load(range)] as const));
    return { range: { from: range.from, to: range.to, branchId: range.branchId ?? null }, generatedAt: new Date(), widgets: Object.fromEntries(entries) };
  }
}
