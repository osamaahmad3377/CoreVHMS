import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AttachmentsService } from '../attachments/attachments.service';
import { ClientMergeService } from '../clients/client-merge.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { PatientMergeService } from '../patients/patient-merge.service';
import { PatientTimelineService } from '../patients/patient-timeline.service';
import { SearchService } from '../search/search.service';
import { labOrderNo } from './diagnostic-orders.service';
import { ClientPrivacyService } from '../clients/client-privacy.service';

@Injectable()
export class LabIntegrations implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly privacy: ClientPrivacyService,
    private readonly timeline: PatientTimelineService,
    private readonly patientMerge: PatientMergeService,
    private readonly clientMerge: ClientMergeService,
    private readonly dashboard: DashboardService,
    private readonly attachments: AttachmentsService,
    private readonly search: SearchService,
  ) {}

  onModuleInit() {
    const db = () => this.prisma.db;
    this.timeline.register('lab', async (id) =>
      (
        await db().diagnosticOrder.findMany({
          where: { patientId: id },
          include: { items: { include: { test: { select: { name: true } } } } },
          orderBy: { createdAt: 'desc' },
          take: 200,
        })
      ).map((o) => ({
        id: o.id,
        at: o.releasedAt ?? o.createdAt,
        kind: 'lab',
        title: `${o.status === 'RELEASED' ? 'Results released' : 'Diagnostics ordered'}: ${o.items.map((i) => i.test.name).join(', ')}`,
        detail: `${labOrderNo(o.number)} · ${o.status.toLowerCase().replace(/_/g, ' ')}${o.hasCritical ? ' · CRITICAL value' : ''}`,
        actor: o.releasedByName ?? o.orderedByName,
        severity: o.hasCritical ? ('CRITICAL' as const) : undefined,
        href: `/lab/orders/${o.id}`,
      })),
    );
    this.patientMerge.register({ name: 'diagnosticOrders', run: async (tx, s, m) => (await tx.diagnosticOrder.updateMany({ where: { patientId: m }, data: { patientId: s } })).count });
    this.clientMerge.register({ name: 'diagnosticOrders', run: async (tx, s, m) => (await tx.diagnosticOrder.updateMany({ where: { clientId: m }, data: { clientId: s } })).count });

    this.attachments.registerTarget('DiagnosticOrder', {
      read: 'lab.read',
      write: 'lab.result',
      exists: async (id) => !!(await db().diagnosticOrder.findUnique({ where: { id }, select: { id: true } })),
    });

    this.search.register(async (q, perms) => {
      if (!perms.has('lab.read') || !/^s\d{3,}$/i.test(q.trim())) return [];
      const s = await db().sample.findFirst({ where: { barcode: q.trim().toUpperCase() }, include: { order: { include: { patient: { select: { name: true } } } } } });
      return s ? [{ type: 'sample', id: s.id, title: `Sample ${s.barcode}`, subtitle: `${labOrderNo(s.order.number)} · ${s.order.patient.name}`, href: `/lab/orders/${s.orderId}` }] : [];
    });

    this.dashboard.register({
      key: 'lab',
      permission: 'lab.read',
      load: async (r) => {
        const branch = r.branchId ? { branchId: r.branchId } : {};
        const [toCollect, inProgress, awaitingValidation, critical] = await Promise.all([
          db().diagnosticOrder.count({ where: { status: 'ORDERED', ...branch } }),
          db().diagnosticOrder.count({ where: { status: { in: ['COLLECTED', 'IN_PROGRESS'] }, ...branch } }),
          db().diagnosticOrder.count({ where: { status: 'AWAITING_VALIDATION', ...branch } }),
          db().diagnosticOrder.findMany({
            where: { hasCritical: true, createdAt: { gte: new Date(Date.now() - 7 * 86400_000) }, ...branch },
            include: { patient: { select: { id: true, name: true } } },
            orderBy: { updatedAt: 'desc' },
            take: 5,
          }),
        ]);
        return { toCollect, inProgress, awaitingValidation, critical: critical.map((o) => ({ id: o.id, orderNo: labOrderNo(o.number), patient: o.patient, status: o.status })) };
      },
    });

    // Only released results are part of the record shared with the client.
    this.privacy.registerExport({
      name: 'diagnostics',
      load: (clientId) => this.prisma.db.diagnosticOrder.findMany({ where: { clientId, status: 'RELEASED' }, include: { items: { include: { results: true } } }, orderBy: { createdAt: 'asc' } }),
    });
  }
}
