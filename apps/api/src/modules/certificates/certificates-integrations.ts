import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ClientMergeService } from '../clients/client-merge.service';
import { ClientPrivacyService } from '../clients/client-privacy.service';
import { PatientMergeService } from '../patients/patient-merge.service';
import { PatientRecordService } from '../patients/patient-record.service';
import { PatientTimelineService } from '../patients/patient-timeline.service';
import { certificateNo } from './certificates.service';

/** Certificates on the patient timeline, in merges and in record exports. */
@Injectable()
export class CertificatesIntegrations implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly timeline: PatientTimelineService,
    private readonly patientMerge: PatientMergeService,
    private readonly clientMerge: ClientMergeService,
    private readonly record: PatientRecordService,
    private readonly privacy: ClientPrivacyService,
  ) {}

  onModuleInit() {
    const db = () => this.prisma.db;
    this.timeline.register('certificate', async (id) =>
      (await db().certificate.findMany({ where: { patientId: id }, orderBy: { issuedAt: 'desc' }, take: 100 })).map((c) => ({
        id: `cert-${c.id}`,
        at: c.issuedAt,
        kind: 'certificate',
        title: `${c.title} issued`,
        detail: [certificateNo(c.number), c.status === 'REVOKED' && `revoked: ${c.revokedReason}`].filter(Boolean).join(' · '),
        actor: c.issuedByName,
        href: `/certificates/${c.id}`,
        severity: c.status === 'REVOKED' ? ('WARNING' as const) : undefined,
      })),
    );
    // Certificates follow the surviving record (the lock allows re-pointing them, nothing else).
    this.patientMerge.register({ name: 'certificates', run: async (tx, s, m) => (await tx.certificate.updateMany({ where: { patientId: m }, data: { patientId: s } })).count });
    this.clientMerge.register({ name: 'certificates', run: async (tx, s, m) => (await tx.certificate.updateMany({ where: { clientId: m }, data: { clientId: s } })).count });

    const load = (where: { patientId: string } | { patientId: { in: string[] } }) =>
      this.prisma.db.certificate.findMany({
        where,
        select: { number: true, title: true, kind: true, issuedAt: true, validUntil: true, issuedByName: true, status: true, revokedAt: true, revokedReason: true, data: true },
        orderBy: { issuedAt: 'asc' },
      });
    this.record.register({ name: 'certificates', title: 'Certificates', anyOf: ['certificates.read'], load: (patientId) => load({ patientId }) });
    this.privacy.registerExport({ name: 'certificates', load: (_clientId, patientIds) => load({ patientId: { in: patientIds } }) });
  }
}
