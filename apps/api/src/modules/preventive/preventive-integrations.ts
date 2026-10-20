import { PatientRecordService } from '../patients/patient-record.service';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { branchToday } from '../../common/time/branch-timezone';
import { DashboardService } from '../dashboard/dashboard.service';
import { PatientMergeService } from '../patients/patient-merge.service';
import { PatientTimelineService } from '../patients/patient-timeline.service';
import { AdministrationsService } from '../pharmacy/administrations.service';
import { CareService } from './care.service';
import { ClientPrivacyService } from '../clients/client-privacy.service';

@Injectable()
export class PreventiveIntegrations implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly privacy: ClientPrivacyService,
    private readonly record: PatientRecordService,
    private readonly care: CareService,
    private readonly administrations: AdministrationsService,
    private readonly timeline: PatientTimelineService,
    private readonly patientMerge: PatientMergeService,
    private readonly dashboard: DashboardService,
  ) {}

  onModuleInit() {
    const db = () => this.prisma.db;

    // A vaccine or preventive product given anywhere (consultation, hospital…) completes the matching
    // open care-plan item and schedules the next one, in the same transaction as the administration.
    this.administrations.registerHook(async (tx, e) => {
      const a = await tx.medicationAdministration.findUniqueOrThrow({ where: { id: e.administrationId } });
      const item = await tx.careItem.findFirst({ where: { patientId: a.patientId, status: { in: ['DUE', 'DEFERRED'] }, administrationId: null, protocol: { productId: e.productId, status: 'APPROVED' } }, orderBy: { dueDate: 'asc' } });
      if (item) await this.care.markCompleted(tx, item.id, { completedAt: a.administeredAt, administrationId: a.id, batchNumber: e.batchNumber ?? null });
    }, { late: true }); // after the stock issue, so the batch picked first-expiry-first is known

    this.timeline.register('preventive', async (id) =>
      (await db().careItem.findMany({ where: { patientId: id, status: { in: ['COMPLETED', 'CANCELLED'] } }, orderBy: { updatedAt: 'desc' }, take: 200 })).map((i) => ({
        id: i.id,
        at: i.completedAt ?? i.updatedAt,
        kind: 'preventive',
        title: i.status === 'COMPLETED' ? `${i.title}${i.givenElsewhere ? ' (given elsewhere)' : ''}` : `${i.title} cancelled`,
        detail: [i.batchNumber && `batch ${i.batchNumber}`, i.cancelReason].filter(Boolean).join(' · ') || undefined,
        actor: i.completedByName,
      })),
    );

    this.patientMerge.register({ name: 'careItems', run: async (tx, s, m) => (await tx.careItem.updateMany({ where: { patientId: m }, data: { patientId: s } })).count });

    this.dashboard.register({
      key: 'preventive',
      permission: 'preventive.read',
      load: async (r) => {
        const today = await branchToday(this.prisma, r.branchId);
        const week = new Date(today.getTime() + 7 * 86400_000);
        const active = { patient: { status: 'ACTIVE' as const } };
        const [overdue, dueWeek] = await Promise.all([
          db().careItem.count({ where: { ...active, OR: [{ status: 'DUE', dueDate: { lt: today } }, { status: 'DEFERRED', deferredUntil: { lt: today } }] } }),
          db().careItem.count({ where: { ...active, OR: [{ status: 'DUE', dueDate: { gte: today, lt: week } }, { status: 'DEFERRED', deferredUntil: { gte: today, lt: week } }] } }),
        ]);
        return { overdue, dueThisWeek: dueWeek };
      },
    });

    this.record.register({
      name: 'preventiveCare',
      title: 'Vaccinations and preventive care',
      anyOf: ['preventive.read'],
      load: (patientId) => this.prisma.db.careItem.findMany({ where: { patientId }, orderBy: { dueDate: 'asc' } }),
    });

    this.privacy.registerExport({
      name: 'preventiveCare',
      load: (_clientId, patientIds) => this.prisma.db.careItem.findMany({ where: { patientId: { in: patientIds } }, orderBy: { dueDate: 'asc' } }),
    });
  }
}
