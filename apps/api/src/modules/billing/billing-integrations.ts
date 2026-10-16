import type { Allocation } from '../inventory/stock.engine';
import { RequestContext } from '../../common/context/request-context';
import { localDayBounds } from '../../common/time/tz';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { formatNumber } from '../../common/counter/counter.service';
import { EncountersService } from '../clinical/encounters.service';
import { ClientMergeService } from '../clients/client-merge.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { InventoryService } from '../inventory/inventory.service';
import { DiagnosticOrdersService } from '../lab/diagnostic-orders.service';
import { PatientMergeService } from '../patients/patient-merge.service';
import { PatientTimelineService } from '../patients/patient-timeline.service';
import { AdministrationsService } from '../pharmacy/administrations.service';
import { PrescriptionsService } from '../pharmacy/prescriptions.service';
import { SearchService } from '../search/search.service';
import { ChargeCaptureService } from './charge-capture.service';
import { ClientPrivacyService } from '../clients/client-privacy.service';

/**
 * Connects clinical events to stock and billing, inside the same transaction as the event:
 *  dispensing / administration → FEFO stock issue + charge; lab order → charge per test (waived on cancel);
 *  consultation completed → consultation fee from the appointment type's service.
 */
/** Records the batch(es) actually issued from stock on the clinical record, for recalls and traceability. */
function traceability(issued: Allocation[]) {
  const expiries = issued.map((i) => i.expiryDate).filter(Boolean) as Date[];
  return { batchNumber: [...new Set(issued.map((i) => i.batchNumber))].join(', ').slice(0, 120), expiryDate: expiries.sort((a, b) => a.getTime() - b.getTime())[0] ?? null };
}

@Injectable()
export class BillingIntegrations implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly privacy: ClientPrivacyService,
    private readonly charges: ChargeCaptureService,
    private readonly inventory: InventoryService,
    private readonly prescriptions: PrescriptionsService,
    private readonly administrations: AdministrationsService,
    private readonly labOrders: DiagnosticOrdersService,
    private readonly encounters: EncountersService,
    private readonly patientMerge: PatientMergeService,
    private readonly clientMerge: ClientMergeService,
    private readonly dashboard: DashboardService,
    private readonly timeline: PatientTimelineService,
    private readonly search: SearchService,
  ) {}

  onModuleInit() {
    this.prescriptions.registerDispenseHook(async (tx, e) => {
      const issued = await this.inventory.issueForEvent(tx, { productId: e.product.id, quantity: e.quantity, branchId: e.branchId, type: 'DISPENSE', referenceType: 'Dispensation', referenceId: e.dispensationId, preferredBatchNumber: e.batchNumber });
      if (issued.length) await tx.dispensation.update({ where: { id: e.dispensationId }, data: traceability(issued) });
      const d = await tx.dispensation.findUniqueOrThrow({ where: { id: e.dispensationId }, include: { item: { include: { prescription: true } } } });
      await this.charges.capture(tx, {
        sourceType: 'Dispensation',
        sourceId: d.id,
        clientId: d.item.prescription.clientId,
        patientId: d.item.prescription.patientId,
        encounterId: d.item.prescription.encounterId,
        branchId: e.branchId,
        kind: 'PRODUCT',
        productId: e.product.id,
        description: `${e.product.name} (${formatNumber('RX', d.item.prescription.number)})`,
        quantity: e.quantity,
        unitPriceMinor: e.product.sellPriceMinor ?? 0,
        taxRateBasisPoints: await this.charges.taxFor(tx, e.product.taxRateId),
      });
    });

    this.administrations.registerHook(async (tx, e) => {
      const product = await tx.product.findUniqueOrThrow({ where: { id: e.productId } });
      const a = await tx.medicationAdministration.findUniqueOrThrow({ where: { id: e.administrationId } });
      // Stock is deducted only when the dose is expressed in the product's dispensing unit.
      if (e.doseUnit.toLowerCase() === product.dispensingUnit.toLowerCase() && !a.prescriptionItemId) {
        const issued = await this.inventory.issueForEvent(tx, { productId: product.id, quantity: e.dose, branchId: e.branchId, type: 'ADMINISTER', referenceType: 'Administration', referenceId: a.id, preferredBatchNumber: e.batchNumber });
        if (issued.length) await tx.medicationAdministration.update({ where: { id: a.id }, data: traceability(issued) });
      }
      if (a.prescriptionItemId) return; // charged when the prescription was dispensed
      const owner = await tx.patientOwnership.findFirst({ where: { patientId: a.patientId, endedAt: null, isPrimary: true } });
      if (!owner || e.doseUnit.toLowerCase() !== product.dispensingUnit.toLowerCase()) return;
      await this.charges.capture(tx, {
        sourceType: 'Administration',
        sourceId: a.id,
        clientId: owner.clientId,
        patientId: a.patientId,
        encounterId: a.encounterId,
        branchId: e.branchId,
        kind: 'PRODUCT',
        productId: product.id,
        description: `${product.name} — administered`,
        quantity: e.dose,
        unitPriceMinor: product.sellPriceMinor ?? 0,
        taxRateBasisPoints: await this.charges.taxFor(tx, product.taxRateId),
      });
    });

    this.labOrders.registerCreatedHook(async (tx, e) => {
      const order = await tx.diagnosticOrder.findUniqueOrThrow({ where: { id: e.orderId }, include: { items: { include: { test: true } } } });
      const tax = await this.charges.defaultTaxBp(tx);
      for (const item of order.items) {
        await this.charges.capture(tx, {
          sourceType: 'DiagnosticOrderItem',
          sourceId: item.id,
          clientId: order.clientId,
          patientId: order.patientId,
          encounterId: order.encounterId,
          branchId: order.branchId,
          kind: 'LAB',
          labTestId: item.testId,
          description: `${item.test.name} (${formatNumber('LAB', order.number)})`,
          quantity: 1,
          unitPriceMinor: item.test.priceMinor ?? 0,
          taxRateBasisPoints: tax,
        });
      }
    });
    this.labOrders.registerCancelledHook(async (tx, e) => {
      await this.charges.waiveForSource(tx, 'DiagnosticOrderItem', e.itemIds, 'Diagnostic order cancelled');
    });

    this.encounters.registerCompletedHook(async (tx, encounterId) => {
      const enc = await tx.encounter.findUniqueOrThrow({ where: { id: encounterId }, include: { appointment: { include: { appointmentType: { include: { service: true } } } } } });
      const service = enc.appointment?.appointmentType.service;
      if (!service || !service.isActive) return;
      await this.charges.capture(tx, {
        sourceType: 'Encounter',
        sourceId: enc.id,
        clientId: enc.clientId,
        patientId: enc.patientId,
        encounterId: enc.id,
        branchId: enc.branchId,
        kind: 'SERVICE',
        serviceId: service.id,
        description: service.name,
        quantity: 1,
        unitPriceMinor: service.priceMinor,
        taxRateBasisPoints: await this.charges.taxFor(tx, service.taxRateId),
      });
    });

    // Merges
    for (const [name, fn] of [
      ['charges', (tx: any, s: string, m: string) => tx.charge.updateMany({ where: { clientId: m }, data: { clientId: s } })],
      ['invoices', (tx: any, s: string, m: string) => tx.$executeRaw`UPDATE "Invoice" SET "clientId" = ${s}::uuid WHERE "clientId" = ${m}::uuid`],
      ['payments', (tx: any, s: string, m: string) => tx.payment.updateMany({ where: { clientId: m }, data: { clientId: s } })],
      ['estimates', (tx: any, s: string, m: string) => tx.estimate.updateMany({ where: { clientId: m }, data: { clientId: s } })],
    ] as const) {
      this.clientMerge.register({ name, run: async (tx, s, m) => { const r = await fn(tx, s, m); return typeof r === 'number' ? r : r.count; } });
    }
    this.patientMerge.register({ name: 'charges', run: async (tx, s, m) => (await tx.charge.updateMany({ where: { patientId: m }, data: { patientId: s } })).count });

    this.timeline.register('billing', async (patientId) =>
      (await this.prisma.db.invoice.findMany({ where: { patientId, status: { not: 'DRAFT' } }, orderBy: { issuedAt: 'desc' }, take: 100 })).map((i) => ({
        id: i.id,
        at: i.issuedAt ?? i.createdAt,
        kind: 'billing',
        title: `Invoice ${formatNumber('INV', i.number!)} — ${i.status.toLowerCase().replace('_', ' ')}`,
        detail: `Total ${(i.totalMinor / 100).toFixed(2)} ${i.currency}${i.balanceMinor ? ` · balance ${(i.balanceMinor / 100).toFixed(2)}` : ''}`,
        actor: i.issuedByName,
        href: `/billing/invoices/${i.id}`,
      })),
    );

    this.search.register(async (q, perms) => {
      if (!perms.has('billing.read') || !/^inv-?\d+$/i.test(q.trim())) return [];
      const n = Number(q.replace(/\D/g, ''));
      const inv = await this.prisma.db.invoice.findFirst({ where: { number: n }, include: { client: { select: { displayName: true } } } });
      return inv ? [{ type: 'invoice', id: inv.id, title: `Invoice ${formatNumber('INV', n)}`, subtitle: `${inv.client?.displayName ?? 'Counter sale'} · ${inv.status}`, href: `/billing/invoices/${inv.id}` }] : [];
    });

    this.dashboard.register({
      key: 'finance',
      permission: 'billing.read',
      load: async (r) => {
        const db = this.prisma.db;
        const b = r.branchId ? { branchId: r.branchId } : {};
        const branchId = r.branchId ?? RequestContext.get()?.branchId;
        const branch = branchId ? await db.branch.findUnique({ where: { id: branchId } }) : null;
        const { start: startOfDay } = localDayBounds(new Date(), branch?.timezone ?? 'UTC');
        const [billedToday, receivedToday, outstanding, overdue, unbilled] = await Promise.all([
          db.invoice.aggregate({ where: { ...b, issuedAt: { gte: startOfDay }, status: { notIn: ['DRAFT', 'VOID'] } }, _sum: { totalMinor: true } }),
          db.payment.aggregate({ where: { ...b, receivedAt: { gte: startOfDay } }, _sum: { amountMinor: true } }),
          db.invoice.aggregate({ where: { ...b, status: { in: ['ISSUED', 'PARTIALLY_PAID'] } }, _sum: { balanceMinor: true } }),
          db.invoice.count({ where: { ...b, status: { in: ['ISSUED', 'PARTIALLY_PAID'] }, dueAt: { lt: new Date() }, balanceMinor: { gt: 0 } } }),
          db.charge.findMany({ where: { ...b, status: 'PENDING' }, select: { quantity: true, unitPriceMinor: true } }),
        ]);
        return {
          billedTodayMinor: billedToday._sum.totalMinor ?? 0,
          receivedTodayMinor: receivedToday._sum.amountMinor ?? 0,
          outstandingMinor: outstanding._sum.balanceMinor ?? 0,
          overdueInvoices: overdue,
          unbilledCount: unbilled.length,
          unbilledMinor: unbilled.reduce((n, c) => n + Math.round(Number(c.quantity) * c.unitPriceMinor), 0),
        };
      },
    });
    this.dashboard.register({
      key: 'inventory',
      permission: 'inventory.read',
      load: async () => {
        const overview = await this.inventory.overview({ page: 1, pageSize: 1000 });
        const expiring = await this.inventory.overview({ page: 1, pageSize: 1000, expiringDays: 60 });
        return {
          lowStock: overview.data.filter((p) => p.low).slice(0, 8).map((p) => ({ id: p.id, name: p.name, available: p.available, reorderLevel: p.reorderLevel, unit: p.dispensingUnit })),
          lowStockCount: overview.data.filter((p) => p.low).length,
          expiringCount: expiring.meta.total,
          expiring: expiring.data.slice(0, 8).map((p) => ({ id: p.id, name: p.name, nextExpiry: p.nextExpiry })),
          valueMinor: overview.totals.valueMinor,
        };
      },
    });

    this.privacy.registerExport({
      name: 'billing',
      load: async (clientId) => {
        const [invoices, payments, estimates] = await Promise.all([
          this.prisma.db.invoice.findMany({ where: { clientId }, include: { lines: true }, orderBy: { createdAt: 'asc' } }),
          this.prisma.db.payment.findMany({ where: { clientId }, include: { allocations: true }, orderBy: { receivedAt: 'asc' } }),
          this.prisma.db.estimate.findMany({ where: { clientId }, include: { lines: true }, orderBy: { createdAt: 'asc' } }),
        ]);
        return { invoices, payments, estimates };
      },
    });
  }
}
