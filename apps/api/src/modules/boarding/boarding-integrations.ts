import { PatientRecordService } from '../patients/patient-record.service';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { enumLabel } from '@vcms/shared';
import { RequestContext } from '../../common/context/request-context';
import { PrismaService } from '../../common/prisma/prisma.service';
import { localDayBounds, localParts } from '../../common/time/tz';
import { AttachmentsService } from '../attachments/attachments.service';
import { ClientMergeService } from '../clients/client-merge.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { PatientMergeService } from '../patients/patient-merge.service';
import { PatientTimelineService } from '../patients/patient-timeline.service';
import { SearchService } from '../search/search.service';
import { stayNo } from './boarding.service';
import { groomingNo } from './grooming.service';
import { ClientPrivacyService } from '../clients/client-privacy.service';
import { ruleViolation } from '../../common/http/errors';

/** Registers boarding and grooming with the shared timeline, merge, search, dashboard and attachment registries. */
@Injectable()
export class BoardingIntegrations implements OnModuleInit {
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
  ) {}

  onModuleInit() {
    const db = () => this.prisma.db;
    this.timeline.register('boarding', async (id) =>
      (await db().boardingStay.findMany({ where: { patientId: id, status: { notIn: ['CANCELLED'] } }, include: { unit: { select: { name: true } } }, orderBy: { startDate: 'desc' }, take: 50 })).map((s) => ({
        id: s.id,
        at: s.checkedInAt ?? s.startDate,
        kind: 'boarding',
        title: `Boarding ${enumLabel(s.status).toLowerCase()}${s.unit ? ` — ${s.unit.name}` : ''}`,
        detail: `${stayNo(s.number)} · ${s.startDate.toISOString().slice(0, 10)} → ${s.endDate.toISOString().slice(0, 10)}`,
        actor: s.checkedInByName ?? s.createdByName,
        href: `/boarding/stays/${s.id}`,
      })),
    );
    this.timeline.register('grooming', async (id) =>
      (await db().groomingJob.findMany({ where: { patientId: id, status: { not: 'CANCELLED' } }, include: { services: { select: { description: true } } }, orderBy: { createdAt: 'desc' }, take: 50 })).map((j) => ({
        id: j.id,
        at: j.readyAt ?? j.createdAt,
        kind: 'grooming',
        title: `Grooming${j.services.length ? `: ${j.services.map((s) => s.description).join(', ')}` : ''}`,
        detail: `${groomingNo(j.number)} · ${enumLabel(j.status).toLowerCase()}${j.groomerNotes ? ` · ${j.groomerNotes.slice(0, 120)}` : ''}`,
        actor: j.createdByName,
        href: `/boarding/grooming/${j.id}`,
      })),
    );
    for (const model of ['boardingStay', 'groomingJob'] as const) {
      this.patientMerge.register({ name: `${model}s`, run: async (tx, s, m) => (await (tx[model] as any).updateMany({ where: { patientId: m }, data: { patientId: s } })).count });
      this.clientMerge.register({ name: `${model}s`, run: async (tx, s, m) => (await (tx[model] as any).updateMany({ where: { clientId: m }, data: { clientId: s } })).count });
    }
    this.attachments.registerTarget('BoardingStay', { read: 'boarding.read', write: 'boarding.write', exists: async (id) => !!(await db().boardingStay.findUnique({ where: { id }, select: { id: true } })) });
    this.attachments.registerTarget('GroomingJob', { read: 'boarding.read', write: 'boarding.write', exists: async (id) => !!(await db().groomingJob.findUnique({ where: { id }, select: { id: true } })) });

    this.search.register(async (q, perms) => {
      if (!perms.has('boarding.read')) return [];
      const m = q.trim().match(/^(brd|grm)-?(\d+)$/i);
      if (!m) return [];
      const n = Number(m[2]);
      if (m[1].toLowerCase() === 'brd') {
        const s = await db().boardingStay.findFirst({ where: { number: n }, include: { patient: { select: { name: true } } } });
        return s ? [{ type: 'boarding', id: s.id, title: `Boarding ${stayNo(n)}`, subtitle: `${s.patient.name} · ${enumLabel(s.status)}`, href: `/boarding/stays/${s.id}` }] : [];
      }
      const j = await db().groomingJob.findFirst({ where: { number: n }, include: { patient: { select: { name: true } } } });
      return j ? [{ type: 'grooming', id: j.id, title: `Grooming ${groomingNo(n)}`, subtitle: `${j.patient.name} · ${enumLabel(j.status)}`, href: `/boarding/grooming/${j.id}` }] : [];
    });

    this.dashboard.register({
      key: 'boarding',
      permission: 'boarding.read',
      load: async (r) => {
        const ctx = RequestContext.require();
        const branchId = r.branchId ?? ctx.branchId;
        const branch = branchId ? await db().branch.findUnique({ where: { id: branchId } }) : null;
        const tz = branch?.timezone ?? 'UTC';
        const today = new Date(localParts(new Date(), tz).date);
        const { start, end } = localDayBounds(new Date(), tz);
        const b = branchId ? { branchId } : {};
        const [inHouse, arriving, departing, grooming] = await Promise.all([
          db().boardingStay.count({ where: { ...b, status: 'CHECKED_IN' } }),
          db().boardingStay.count({ where: { ...b, status: 'RESERVED', startDate: { lte: today } } }),
          db().boardingStay.count({ where: { ...b, status: 'CHECKED_IN', endDate: { lte: today } } }),
          db().groomingJob.groupBy({ by: ['status'], where: { ...b, OR: [{ createdAt: { gte: start, lt: end } }, { status: { in: ['WAITING', 'IN_PROGRESS', 'READY'] } }] }, _count: true }),
        ]);
        const g = (s: string) => grooming.find((x) => x.status === s)?._count ?? 0;
        return { inHouse, arrivingToday: arriving, departingToday: departing, grooming: { waiting: g('WAITING'), inProgress: g('IN_PROGRESS'), ready: g('READY') } };
      },
    });

    this.record.register({
      name: 'boardingAndGrooming',
      title: 'Boarding and grooming',
      anyOf: ['boarding.read'],
      load: async (patientId) => ({
        stays: (await this.prisma.db.boardingStay.findMany({ where: { patientId }, include: { logs: { orderBy: { recordedAt: 'asc' } } }, orderBy: { createdAt: 'asc' } })).map((s) => ({ ...s, stayNo: stayNo(s.number) })),
        grooming: (await this.prisma.db.groomingJob.findMany({ where: { patientId }, include: { services: true }, orderBy: { createdAt: 'asc' } })).map((g) => ({ ...g, groomingNo: groomingNo(g.number) })),
      }),
    });

    this.privacy.registerExport({
      name: 'boardingAndGrooming',
      load: async (clientId) => ({
        stays: await db().boardingStay.findMany({ where: { clientId }, include: { logs: true }, orderBy: { startDate: 'asc' } }),
        grooming: await db().groomingJob.findMany({ where: { clientId }, include: { services: true }, orderBy: { createdAt: 'asc' } }),
      }),
    });
    this.privacy.registerAnonymise({
      name: 'boarding',
      check: async (clientId) => {
        if (await db().boardingStay.findFirst({ where: { clientId, status: 'CHECKED_IN' } })) throw ruleViolation('BOARDING', 'An animal of this client is boarding; check it out first');
      },
      run: async (tx, clientId) => (await tx.boardingStay.updateMany({ where: { clientId }, data: { emergencyContact: null, belongings: null } })).count,
    });
  }
}
