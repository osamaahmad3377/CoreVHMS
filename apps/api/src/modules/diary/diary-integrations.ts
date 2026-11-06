import { Injectable, OnModuleInit } from '@nestjs/common';
import { SEROLOGY_OUTCOME_LABELS } from '@vcms/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ClientPrivacyService } from '../clients/client-privacy.service';
import { PatientMergeService } from '../patients/patient-merge.service';
import { PatientRecordService } from '../patients/patient-record.service';
import { PatientTimelineService } from '../patients/patient-timeline.service';

/** Rabies antibody tests on the patient timeline, in merges and in record exports. */
@Injectable()
export class DiaryIntegrations implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly timeline: PatientTimelineService,
    private readonly patientMerge: PatientMergeService,
    private readonly record: PatientRecordService,
    private readonly privacy: ClientPrivacyService,
  ) {}

  onModuleInit() {
    const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '');
    this.timeline.register('serology', async (id) =>
      (await this.prisma.db.serologyTest.findMany({ where: { patientId: id, status: { not: 'VOIDED' } }, orderBy: { createdAt: 'desc' }, take: 100 })).map((t) => ({
        id: `sero-${t.id}`,
        at: t.sampleDate ?? t.plannedFor ?? t.createdAt,
        kind: 'serology',
        title: t.status === 'PLANNED' ? 'Rabies antibody test planned' : 'Rabies antibody test',
        detail:
          t.status === 'PLANNED'
            ? `planned for ${day(t.plannedFor)}`
            : [t.outcome && SEROLOGY_OUTCOME_LABELS[t.outcome], t.resultValue != null && `${Number(t.resultValue)} ${t.resultUnit}`, t.laboratory].filter(Boolean).join(' · '),
        actor: t.recordedByName,
        severity: t.outcome === 'UNSATISFACTORY' ? ('WARNING' as const) : undefined,
      })),
    );
    this.patientMerge.register({ name: 'serologyTests', run: async (tx, s, m) => (await tx.serologyTest.updateMany({ where: { patientId: m }, data: { patientId: s } })).count });
    const load = (where: { patientId: string } | { patientId: { in: string[] } }) => this.prisma.db.serologyTest.findMany({ where, orderBy: { createdAt: 'asc' } });
    this.record.register({ name: 'serologyTests', title: 'Rabies antibody tests', anyOf: ['preventive.read'], load: (patientId) => load({ patientId }) });
    this.privacy.registerExport({ name: 'serologyTests', load: (_clientId, patientIds) => load({ patientId: { in: patientIds } }) });
  }
}
