import { Injectable, OnModuleInit } from '@nestjs/common';
import { dentalProcedure, worstStage } from '@vcms/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ClientMergeService } from '../clients/client-merge.service';
import { ClientPrivacyService } from '../clients/client-privacy.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { PatientMergeService } from '../patients/patient-merge.service';
import { PatientRecordService } from '../patients/patient-record.service';
import { PatientTimelineService } from '../patients/patient-timeline.service';
import { dentalChartNo } from './dental.service';

/** Registers dental charts with the patient timeline, merges, dashboard and record export. */
@Injectable()
export class DentalIntegrations implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly timeline: PatientTimelineService,
    private readonly patientMerge: PatientMergeService,
    private readonly clientMerge: ClientMergeService,
    private readonly dashboard: DashboardService,
    private readonly record: PatientRecordService,
    private readonly privacy: ClientPrivacyService,
  ) {}

  onModuleInit() {
    const db = () => this.prisma.db;

    this.timeline.register('dental', async (id) =>
      (await db().dentalChart.findMany({ where: { patientId: id }, include: { teeth: { select: { pdStage: true } }, procedures: { select: { code: true } } }, orderBy: { examinedAt: 'desc' }, take: 100 })).map((c) => {
        const stage = c.periodontalStage ?? worstStage(c.teeth);
        const extracted = c.procedures.filter((p) => dentalProcedure(p.code)?.removesTooth).length;
        return {
          id: `den-${c.id}`,
          at: c.signedAt ?? c.examinedAt,
          kind: 'dental',
          title: c.status === 'SIGNED' ? 'Dental chart signed' : 'Dental chart (draft)',
          detail: [dentalChartNo(c.number), stage != null && `periodontal stage ${stage}`, c.procedures.length && `${c.procedures.length} procedure(s)`, extracted && `${extracted} extraction(s)`].filter(Boolean).join(' · '),
          actor: c.signedByName ?? c.clinicianName,
          href: `/dental/${c.id}`,
          severity: stage != null && stage >= 3 ? ('WARNING' as const) : undefined,
        };
      }),
    );

    this.patientMerge.register({ name: 'dentalCharts', run: async (tx, s, m) => (await tx.dentalChart.updateMany({ where: { patientId: m }, data: { patientId: s } })).count });
    this.clientMerge.register({ name: 'dentalCharts', run: async (tx, s, m) => (await tx.dentalChart.updateMany({ where: { clientId: m }, data: { clientId: s } })).count });

    this.dashboard.register({
      key: 'dental',
      permission: 'clinical.read',
      module: 'dental',
      load: async (r) => ({ draftsToSign: await db().dentalChart.count({ where: { status: 'DRAFT', ...(r.branchId ? { branchId: r.branchId } : {}) } }) }),
    });

    const load = (where: { patientId: string } | { patientId: { in: string[] } }) =>
      this.prisma.db.dentalChart.findMany({ where, include: { teeth: { orderBy: { tooth: 'asc' } }, procedures: { orderBy: { createdAt: 'asc' } }, addenda: { orderBy: { createdAt: 'asc' } } }, orderBy: { examinedAt: 'asc' } });
    this.record.register({ name: 'dentalCharts', title: 'Dental charts', anyOf: ['clinical.read'], load: (patientId) => load({ patientId }) });
    this.privacy.registerExport({ name: 'dentalCharts', load: (_clientId, patientIds) => load({ patientId: { in: patientIds } }) });
  }
}
