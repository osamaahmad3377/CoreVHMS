import { PatientRecordService } from '../patients/patient-record.service';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { enumLabel } from '@vcms/shared';
import { RequestContext } from '../../common/context/request-context';
import { PrismaService } from '../../common/prisma/prisma.service';
import { localDayBounds } from '../../common/time/tz';
import { AttachmentsService } from '../attachments/attachments.service';
import { ClientMergeService } from '../clients/client-merge.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { PatientMergeService } from '../patients/patient-merge.service';
import { PatientTimelineService } from '../patients/patient-timeline.service';
import { SearchService } from '../search/search.service';
import { BreedingService } from './breeding.service';
import { farmNo } from './farms.service';
import { visitNo } from './field-visits.service';
import { outbreakNo } from './herd-health.service';
import { ClientPrivacyService } from '../clients/client-privacy.service';

/** Registers livestock with the shared timeline, merge, search, dashboard and attachment registries. */
@Injectable()
export class LivestockIntegrations implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly privacy: ClientPrivacyService,
    private readonly record: PatientRecordService,
    private readonly timeline: PatientTimelineService,
    private readonly patientMerge: PatientMergeService,
    private readonly clientMerge: ClientMergeService,
    private readonly dashboard: DashboardService,
    private readonly attachments: AttachmentsService,
    private readonly search: SearchService,
    private readonly breeding: BreedingService,
  ) {}

  onModuleInit() {
    const db = () => this.prisma.db;

    this.timeline.register('breeding', async (id) =>
      (await db().breedingEvent.findMany({ where: { patientId: id, voidedAt: null }, orderBy: { occurredAt: 'desc' }, take: 100 })).map((e) => ({
        id: e.id,
        at: e.occurredAt,
        kind: 'breeding',
        title: e.type === 'PREGNANCY_CHECK' ? `Pregnancy check: ${enumLabel(e.result)}` : e.type === 'BIRTH' ? `Gave birth (${e.liveCount ?? 0} alive of ${e.offspringCount ?? 0})` : enumLabel(e.type),
        detail: [e.sireText, e.method, e.expectedDueDate ? `due ${e.expectedDueDate.toISOString().slice(0, 10)}` : null].filter(Boolean).join(' · ') || null,
        actor: e.recordedByName,
        severity: e.type === 'ABORTION' ? ('WARNING' as const) : undefined,
      })),
    );
    this.timeline.register('livestock-movement', async (id) =>
      (await db().livestockMovement.findMany({ where: { patientId: id }, include: { toGroup: { select: { name: true } }, toFarm: { select: { name: true } } }, orderBy: { occurredAt: 'desc' }, take: 100 })).map((m) => ({
        id: m.id,
        at: m.occurredAt,
        kind: 'livestock',
        title: `${enumLabel(m.type)}${m.toGroup ? ` → ${m.toGroup.name}` : m.toFarm ? ` → ${m.toFarm.name}` : ''}`,
        detail: [m.counterparty, m.reason].filter(Boolean).join(' · ') || null,
        actor: m.recordedByName,
        severity: m.type === 'DEATH' || m.type === 'CULL' ? ('CRITICAL' as const) : undefined,
      })),
    );

    // Patient merges: breeding, production and movement history follow the surviving record, as do offspring links.
    this.patientMerge.register({ name: 'breedingEvents', run: async (tx, s, m) => (await tx.breedingEvent.updateMany({ where: { patientId: m }, data: { patientId: s } })).count + (await tx.breedingEvent.updateMany({ where: { sireId: m }, data: { sireId: s } })).count });
    this.patientMerge.register({ name: 'productionRecords', run: async (tx, s, m) => (await tx.productionRecord.updateMany({ where: { patientId: m }, data: { patientId: s } })).count });
    this.patientMerge.register({ name: 'livestockMovements', run: async (tx, s, m) => (await tx.livestockMovement.updateMany({ where: { patientId: m }, data: { patientId: s } })).count });
    this.patientMerge.register({ name: 'offspring', run: async (tx, s, m) => (await tx.patient.updateMany({ where: { sireId: m }, data: { sireId: s } })).count + (await tx.patient.updateMany({ where: { damId: m }, data: { damId: s } })).count });
    this.clientMerge.register({ name: 'farms', run: async (tx, s, m) => (await tx.farm.updateMany({ where: { clientId: m }, data: { clientId: s } })).count });
    this.clientMerge.register({ name: 'fieldVisits', run: async (tx, s, m) => (await tx.fieldVisit.updateMany({ where: { clientId: m }, data: { clientId: s } })).count });

    for (const [type, model] of [['Farm', 'farm'], ['FieldVisit', 'fieldVisit'], ['DiseaseOutbreak', 'diseaseOutbreak']] as const) {
      this.attachments.registerTarget(type, { read: 'livestock.read', write: 'livestock.write', exists: async (id) => !!(await (db()[model] as any).findUnique({ where: { id }, select: { id: true } })) });
    }

    this.search.register(async (q, perms) => {
      if (!perms.has('livestock.read')) return [];
      const term = q.trim();
      const code = term.match(/^(farm|fv|ob)-?(\d+)$/i);
      if (code) {
        const n = Number(code[2]);
        const kind = code[1].toLowerCase();
        if (kind === 'farm') {
          const f = await db().farm.findFirst({ where: { number: n }, include: { client: { select: { displayName: true } } } });
          return f ? [{ type: 'farm', id: f.id, title: f.name, subtitle: `${farmNo(n)} · ${f.client.displayName}`, href: `/livestock/farms/${f.id}`, badge: 'Farm' }] : [];
        }
        if (kind === 'fv') {
          const v = await db().fieldVisit.findFirst({ where: { number: n }, include: { farm: { select: { name: true } } } });
          return v ? [{ type: 'field-visit', id: v.id, title: `Field visit ${visitNo(n)}`, subtitle: `${v.farm.name} · ${v.purpose}`, href: `/livestock/visits/${v.id}`, badge: 'Visit' }] : [];
        }
        const o = await db().diseaseOutbreak.findFirst({ where: { number: n }, include: { farm: { select: { id: true, name: true } } } });
        return o ? [{ type: 'outbreak', id: o.id, title: `${outbreakNo(n)} ${o.disease}`, subtitle: o.farm.name, href: `/livestock/farms/${o.farm.id}?tab=health`, badge: 'Outbreak' }] : [];
      }
      if (term.length < 2) return [];
      const farms = await db().farm.findMany({ where: { OR: [{ name: { contains: term, mode: 'insensitive' } }, { registrationNumber: { contains: term, mode: 'insensitive' } }] }, include: { client: { select: { displayName: true } } }, take: 5 });
      return farms.map((f) => ({ type: 'farm', id: f.id, title: f.name, subtitle: `${farmNo(f.number)} · ${f.client.displayName}${f.district ? ` · ${f.district}` : ''}`, href: `/livestock/farms/${f.id}`, badge: 'Farm' }));
    });

    this.dashboard.register({
      key: 'livestock',
      permission: 'livestock.read',
      load: async (r) => {
        const ctx = RequestContext.require();
        const branchId = r.branchId ?? ctx.branchId;
        const branch = branchId ? await db().branch.findUnique({ where: { id: branchId } }) : null;
        const { start, end } = localDayBounds(new Date(), branch?.timezone ?? 'UTC');
        const now = new Date();
        const [visits, outbreaks, withdrawals, due] = await Promise.all([
          db().fieldVisit.findMany({ where: { scheduledAt: { gte: start, lt: end }, status: { not: 'CANCELLED' }, ...(r.branchId ? { branchId: r.branchId } : {}) }, include: { farm: { select: { id: true, name: true } } }, orderBy: { scheduledAt: 'asc' } }),
          db().diseaseOutbreak.count({ where: { status: { in: ['SUSPECTED', 'CONFIRMED'] } } }),
          db().patientWithdrawal.count({ where: { patient: { farmId: { not: null }, status: 'ACTIVE' }, OR: [{ meatClearAt: { gt: now } }, { milkClearAt: { gt: now } }] } }),
          this.breeding.dueSoon(14),
        ]);
        return {
          visitsToday: visits.map((v) => ({ id: v.id, visitNo: visitNo(v.number), farm: v.farm, purpose: v.purpose, status: v.status, scheduledAt: v.scheduledAt })),
          openOutbreaks: outbreaks,
          animalsUnderWithdrawal: withdrawals,
          birthsDue14Days: due.length,
        };
      },
    });

    this.record.register({
      name: 'livestock',
      title: 'Livestock records',
      anyOf: ['livestock.read'],
      load: async (patientId) => ({
        movements: await this.prisma.db.livestockMovement.findMany({ where: { patientId }, orderBy: { createdAt: 'asc' } }),
        breeding: await this.prisma.db.breedingEvent.findMany({ where: { patientId, voidedAt: null }, orderBy: { createdAt: 'asc' } }),
        production: await this.prisma.db.productionRecord.findMany({ where: { patientId, voidedAt: null }, orderBy: { createdAt: 'asc' } }),
      }),
    });

    this.privacy.registerExport({
      name: 'livestock',
      load: async (clientId) => ({
        farms: await db().farm.findMany({ where: { clientId }, include: { groups: true } }),
        fieldVisits: await db().fieldVisit.findMany({ where: { clientId }, include: { items: true }, orderBy: { scheduledAt: 'asc' } }),
      }),
    });
    // Farm names and locations often identify the owner; the herd records themselves are retained.
    this.privacy.registerAnonymise({
      name: 'farms',
      run: async (tx, clientId) => {
        const farms = await tx.farm.findMany({ where: { clientId } });
        for (const f of farms) await tx.farm.update({ where: { id: f.id }, data: { name: `Farm ${farmNo(f.number)}`, address: null, district: null, latitude: null, longitude: null, registrationNumber: null, notes: null } });
        return farms.length;
      },
    });
  }
}
