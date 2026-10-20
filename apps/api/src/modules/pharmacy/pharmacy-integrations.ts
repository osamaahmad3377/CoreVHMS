import { PatientRecordService } from '../patients/patient-record.service';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ClientMergeService } from '../clients/client-merge.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { PatientMergeService } from '../patients/patient-merge.service';
import { PatientTimelineService } from '../patients/patient-timeline.service';
import { prescriptionNo } from './prescriptions.service';
import { ClientPrivacyService } from '../clients/client-privacy.service';
import { SearchService } from '../search/search.service';
import { AttachmentsService } from '../attachments/attachments.service';

@Injectable()
export class PharmacyIntegrations implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly privacy: ClientPrivacyService,
    private readonly record: PatientRecordService,
    private readonly timeline: PatientTimelineService,
    private readonly patientMerge: PatientMergeService,
    private readonly clientMerge: ClientMergeService,
    private readonly dashboard: DashboardService,
    private readonly search: SearchService,
    private readonly attachments: AttachmentsService,
  ) {}

  onModuleInit() {
    const db = () => this.prisma.db;
    // Product photos for the shop counter: visible to anyone who can see stock, managed by stock staff.
    this.attachments.registerTarget('Product', { read: 'inventory.read', write: 'inventory.write', exists: async (id) => !!(await db().product.findUnique({ where: { id }, select: { id: true } })), auditDownloads: false });
    // Global search: a prescription number (RX-12, rx12, RX-000012) opens that prescription.
    this.search.register(async (q, perms) => {
      if (!perms.has('prescriptions.read') || !/^rx-?\d+$/i.test(q.trim())) return [];
      const n = Number(q.replace(/\D/g, ''));
      const p = await db().prescription.findFirst({
        where: { number: n },
        include: { patient: { select: { name: true } }, items: { include: { product: { select: { name: true } } } } },
      });
      return p
        ? [{ type: 'prescription', id: p.id, title: `Prescription ${prescriptionNo(n)}`, subtitle: `${p.patient.name} · ${p.items.map((i) => i.product.name).join(', ')}`, href: `/pharmacy/prescriptions/${p.id}`, badge: p.status.replace('_', ' ') }]
        : [];
    });
    this.timeline.register('prescription', async (id) =>
      (
        await db().prescription.findMany({
          where: { patientId: id },
          include: { items: { include: { product: { select: { name: true } } } } },
          orderBy: { createdAt: 'desc' },
          take: 200,
        })
      ).map((p) => ({
        id: p.id,
        at: p.createdAt,
        kind: 'prescription',
        title: `Prescription: ${p.items.map((i) => i.product.name).join(', ')}`,
        detail: `${prescriptionNo(p.number)} · ${p.status.toLowerCase().replace('_', ' ')}${p.cancelReason ? ` — ${p.cancelReason}` : ''}`,
        actor: p.authorizedByName ?? p.createdByName,
        href: `/pharmacy/prescriptions/${p.id}`,
      })),
    );
    this.timeline.register('medication', async (id) =>
      (
        await db().medicationAdministration.findMany({
          where: { patientId: id },
          include: { product: { select: { name: true } } },
          orderBy: { administeredAt: 'desc' },
          take: 200,
        })
      ).map((a) => ({
        id: a.id,
        at: a.administeredAt,
        kind: 'medication',
        title: `${a.status === 'GIVEN' ? 'Given' : 'Not given'}: ${a.product.name} ${Number(a.dose)} ${a.doseUnit} ${a.route}`,
        detail: [a.batchNumber && `Batch ${a.batchNumber}`, a.reasonNotGiven].filter(Boolean).join(' · ') || null,
        actor: a.administeredByName,
        severity: a.status === 'NOT_GIVEN' ? ('WARNING' as const) : undefined,
      })),
    );

    const pSteps: [string, (s: string, m: string, tx: any) => Promise<{ count: number }>][] = [
      ['prescriptions', (s, m, tx) => tx.prescription.updateMany({ where: { patientId: m }, data: { patientId: s } })],
      ['administrations', (s, m, tx) => tx.medicationAdministration.updateMany({ where: { patientId: m }, data: { patientId: s } })],
      ['withdrawals', (s, m, tx) => tx.patientWithdrawal.updateMany({ where: { patientId: m }, data: { patientId: s } })],
    ];
    for (const [name, fn] of pSteps) this.patientMerge.register({ name, run: async (tx, s, m) => (await fn(s, m, tx)).count });
    this.clientMerge.register({ name: 'prescriptions', run: async (tx, s, m) => (await tx.prescription.updateMany({ where: { clientId: m }, data: { clientId: s } })).count });

    this.dashboard.register({
      key: 'pharmacy',
      permission: 'prescriptions.read',
      load: async (r) => {
        const branch = r.branchId ? { branchId: r.branchId } : {};
        const [awaitingAuthorization, readyToDispense] = await Promise.all([
          db().prescription.count({ where: { status: 'DRAFT', ...branch } }),
          db().prescription.count({ where: { status: { in: ['AUTHORIZED', 'PARTIALLY_DISPENSED'] }, ...branch } }),
        ]);
        return { awaitingAuthorization, readyToDispense };
      },
    });

    this.record.register({
      name: 'prescriptions',
      title: 'Prescriptions and medicines supplied',
      anyOf: ['prescriptions.read'],
      load: async (patientId) =>
        (
          await this.prisma.db.prescription.findMany({
            where: { patientId },
            include: { items: { include: { product: { select: { name: true } }, dispensations: true } } },
            orderBy: { createdAt: 'asc' },
          })
        ).map((p) => ({ ...p, prescriptionNo: prescriptionNo(p.number) })),
    });
    this.record.register({
      name: 'administrations',
      title: 'Medicines given in the clinic',
      anyOf: ['clinical.read', 'prescriptions.read'],
      load: (patientId) => this.prisma.db.medicationAdministration.findMany({ where: { patientId }, include: { product: { select: { name: true } } }, orderBy: { administeredAt: 'asc' } }),
    });
    this.record.register({
      name: 'withdrawals',
      title: 'Withdrawal periods (food animals)',
      anyOf: ['prescriptions.read', 'livestock.read'],
      load: (patientId) => this.prisma.db.patientWithdrawal.findMany({ where: { patientId }, include: { product: { select: { name: true } } }, orderBy: { treatedAt: 'asc' } }),
    });

    this.privacy.registerExport({
      name: 'prescriptions',
      load: (clientId) => this.prisma.db.prescription.findMany({ where: { clientId }, include: { items: { include: { dispensations: true } } }, orderBy: { createdAt: 'asc' } }),
    });
  }
}
