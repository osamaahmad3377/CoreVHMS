import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { formatNumber } from '../../common/counter/counter.service';
import { notFound, ruleViolation } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AttachmentsService } from '../attachments/attachments.service';
import { InvoicesService } from '../billing/invoices.service';
import { CareService, effectiveDue, shapeItem } from '../preventive/care.service';
import { branchToday } from '../../common/time/branch-timezone';
import { AppointmentsService } from '../scheduling/appointments.service';
import type { PortalContext } from './portal-auth.service';

const dec = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/**
 * Client-portal data. Every query is restricted to the signed-in client: their own record, the animals
 * they currently own, and only information approved for clients (released lab results, completed
 * discharges and surgical aftercare, authorised prescriptions, issued invoices, shared documents).
 */
@Injectable()
export class PortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly care: CareService,
    private readonly invoiceService: InvoicesService,
    private readonly appointmentService: AppointmentsService,
    private readonly attachments: AttachmentsService,
  ) {}

  private async petIds(ctx: PortalContext) {
    const own = await this.prisma.db.patientOwnership.findMany({ where: { clientId: ctx.clientId, endedAt: null }, select: { patientId: true } });
    return own.map((o) => o.patientId);
  }

  private async assertPet(ctx: PortalContext, patientId: string) {
    if (!(await this.petIds(ctx)).includes(patientId)) throw notFound('Animal');
  }

  async overview(ctx: PortalContext) {
    const db = this.prisma.db;
    const ids = await this.petIds(ctx);
    const today = await branchToday(this.prisma);
    const [client, pets, upcoming, care, unread, requests] = await Promise.all([
      db.client.findUniqueOrThrow({ where: { id: ctx.clientId }, select: { id: true, displayName: true, balanceMinor: true } }),
      db.patient.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, sex: true, dateOfBirth: true, status: true, species: { select: { name: true } }, breed: { select: { name: true } }, photoAttachmentId: true }, orderBy: { name: 'asc' } }),
      db.appointment.findMany({ where: { clientId: ctx.clientId, startsAt: { gte: new Date() }, status: { in: ['BOOKED', 'CONFIRMED', 'CHECKED_IN'] } }, include: { patient: { select: { name: true } }, appointmentType: { select: { name: true } }, branch: { select: { name: true, timezone: true } } }, orderBy: { startsAt: 'asc' }, take: 5 }),
      db.careItem.findMany({ where: { patientId: { in: ids }, status: { in: ['DUE', 'DEFERRED'] }, patient: { status: 'ACTIVE' } }, include: { patient: { select: { name: true } } }, orderBy: { dueDate: 'asc' }, take: 20 }),
      db.clientMessage.count({ where: { clientId: ctx.clientId, direction: 'OUTBOUND', readAt: null } }),
      db.appointmentRequest.count({ where: { clientId: ctx.clientId, status: 'PENDING' } }),
    ]);
    return {
      client,
      pets,
      upcomingAppointments: upcoming.map((a) => ({ id: a.id, startsAt: a.startsAt, status: a.status, patient: a.patient?.name ?? null, type: a.appointmentType.name, branch: a.branch.name, timezone: a.branch.timezone })),
      careDue: care.map((i) => ({ id: i.id, pet: i.patient.name, title: i.title, kind: i.kind, dueDate: effectiveDue(i), overdue: effectiveDue(i) < today })),
      unreadMessages: unread,
      pendingRequests: requests,
    };
  }

  async pet(ctx: PortalContext, patientId: string) {
    await this.assertPet(ctx, patientId);
    const db = this.prisma.db;
    const today = await branchToday(this.prisma);
    const [patient, items, labs, discharges, surgeries, prescriptions, weights] = await Promise.all([
      db.patient.findUniqueOrThrow({ where: { id: patientId }, select: { id: true, name: true, number: true, sex: true, dateOfBirth: true, dobEstimated: true, colour: true, latestWeightKg: true, status: true, species: { select: { name: true } }, breed: { select: { name: true } }, alerts: { where: { isActive: true, type: 'ALLERGY' }, select: { id: true, title: true, severity: true } } } }),
      db.careItem.findMany({ where: { patientId, status: { not: 'CANCELLED' } }, orderBy: { dueDate: 'desc' } }),
      db.diagnosticOrder.findMany({ where: { patientId, status: 'RELEASED' }, include: { items: { include: { test: { select: { name: true } } } } }, orderBy: { releasedAt: 'desc' }, take: 50 }),
      db.admission.findMany({ where: { patientId, status: 'DISCHARGED' }, select: { id: true, number: true, admittedAt: true, dischargedAt: true, reason: true, outcome: true, dischargeSummary: true, homeCareInstructions: true, followUpAt: true }, orderBy: { dischargedAt: 'desc' } }),
      db.surgery.findMany({ where: { patientId, status: 'COMPLETED' }, select: { id: true, number: true, procedure: true, completedAt: true, postOpInstructions: true, followUpAt: true }, orderBy: { completedAt: 'desc' } }),
      db.prescription.findMany({ where: { patientId, status: { in: ['AUTHORIZED', 'PARTIALLY_DISPENSED', 'DISPENSED'] } }, include: { items: { include: { product: { select: { name: true, dispensingUnit: true } } } } }, orderBy: { authorizedAt: 'desc' }, take: 30 }),
      db.weightRecord.findMany({ where: { patientId }, orderBy: { measuredAt: 'desc' }, take: 20, select: { measuredAt: true, weightKg: true } }),
    ]);
    const docs = await this.sharedDocuments(ctx, [patientId, ...discharges.map((d) => d.id), ...surgeries.map((s) => s.id), ...labs.map((l) => l.id)]);
    return {
      patient: { ...patient, latestWeightKg: dec(patient.latestWeightKg) },
      care: items.map((i) => shapeItem(i, today)).map((i) => ({ id: i.id, title: i.title, kind: i.kind, status: i.status, dueDate: i.effectiveDueDate, overdue: i.overdue, completedAt: i.completedAt, givenElsewhere: i.givenElsewhere })),
      labReports: labs.map((o) => ({ id: o.id, orderNo: formatNumber('LAB', o.number), releasedAt: o.releasedAt, tests: o.items.map((i) => i.test.name) })),
      discharges: discharges.map((d) => ({ ...d, admissionNo: formatNumber('HOSP', d.number) })),
      surgeries: surgeries.map((s) => ({ ...s, surgeryNo: formatNumber('SURG', s.number) })),
      prescriptions: prescriptions.map((p) => ({ id: p.id, prescriptionNo: formatNumber('RX', p.number), date: p.authorizedAt, items: p.items.map((i) => ({ product: i.product?.name ?? i.outsideName ?? 'Medicine', instructions: i.instructions, quantity: dec(i.quantity), unit: i.product?.dispensingUnit ?? i.doseUnit, outside: !i.productId })) })),
      weights: weights.map((w) => ({ measuredAt: w.measuredAt, weightKg: dec(w.weightKg) })),
      documents: docs,
    };
  }

  async certificate(ctx: PortalContext, patientId: string) {
    await this.assertPet(ctx, patientId);
    return this.care.certificate(patientId);
  }

  /** A released laboratory report for one of the client's animals. */
  async labReport(ctx: PortalContext, orderId: string) {
    const db = this.prisma.db;
    const o = await db.diagnosticOrder.findUnique({
      where: { id: orderId },
      include: {
        patient: { select: { id: true, name: true, species: { select: { name: true } } } },
        items: { include: { test: { select: { name: true } }, imagingReport: { select: { findings: true, conclusion: true } }, results: { where: { status: 'FINAL', supersededBy: null }, include: { analyte: { select: { name: true, sortOrder: true } } } } } },
      },
    });
    if (!o || o.status !== 'RELEASED') throw notFound('Report');
    await this.assertPet(ctx, o.patientId);
    this.audit.recordAsync({ action: 'portal.lab_report_viewed', entityType: 'Patient', entityId: o.patientId, summary: formatNumber('LAB', o.number) });
    return {
      id: o.id,
      orderNo: formatNumber('LAB', o.number),
      releasedAt: o.releasedAt,
      releasedByName: o.releasedByName,
      patient: o.patient,
      tests: o.items.map((i) => ({
        name: i.test.name,
        imaging: i.imagingReport,
        results: i.results
          .sort((a, b) => a.analyte.sortOrder - b.analyte.sortOrder)
          .map((r) => ({ analyte: r.analyte.name, value: r.valueNumeric !== null ? Number(r.valueNumeric) : r.valueText, unit: r.unit, refLow: dec(r.refLow), refHigh: dec(r.refHigh), flag: r.flag, comment: r.comment })),
      })),
    };
  }

  private async sharedDocuments(ctx: PortalContext, entityIds: string[]) {
    const rows = await this.prisma.db.attachment.findMany({
      where: { sharedWithClient: true, deletedAt: null, OR: [{ entityType: 'Client', entityId: ctx.clientId }, { entityId: { in: entityIds } }] },
      select: { id: true, fileName: true, description: true, category: true, mimeType: true, sizeBytes: true, sharedAt: true, entityType: true },
      orderBy: { sharedAt: 'desc' },
    });
    return rows.map((r) => ({ ...r, url: `/api/v1/portal/documents/${r.id}` }));
  }

  async documents(ctx: PortalContext) {
    const ids = await this.petIds(ctx);
    const db = this.prisma.db;
    const [adm, sur, lab] = await Promise.all([
      db.admission.findMany({ where: { patientId: { in: ids } }, select: { id: true } }),
      db.surgery.findMany({ where: { patientId: { in: ids } }, select: { id: true } }),
      db.diagnosticOrder.findMany({ where: { patientId: { in: ids }, status: 'RELEASED' }, select: { id: true } }),
    ]);
    return this.sharedDocuments(ctx, [...ids, ...adm.map((x) => x.id), ...sur.map((x) => x.id), ...lab.map((x) => x.id)]);
  }

  async openDocument(ctx: PortalContext, id: string) {
    const allowed = new Set((await this.documents(ctx)).map((d) => d.id));
    return this.attachments.openShared(id, () => allowed.has(id));
  }

  // ── Appointments ──

  async appointments(ctx: PortalContext) {
    const db = this.prisma.db;
    const org = await this.prisma.raw.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { portalCancelHours: true } });
    const rows = await db.appointment.findMany({ where: { clientId: ctx.clientId }, include: { patient: { select: { name: true } }, appointmentType: { select: { name: true } }, branch: { select: { name: true, timezone: true } } }, orderBy: { startsAt: 'desc' }, take: 100 });
    const requests = await db.appointmentRequest.findMany({ where: { clientId: ctx.clientId }, orderBy: { createdAt: 'desc' }, take: 50 });
    const cutoff = Date.now() + org.portalCancelHours * 3600_000;
    return {
      cancelHours: org.portalCancelHours,
      appointments: rows.map((a) => ({ id: a.id, startsAt: a.startsAt, endsAt: a.endsAt, status: a.status, patient: a.patient?.name ?? null, type: a.appointmentType.name, branch: a.branch.name, timezone: a.branch.timezone, canCancel: ['BOOKED', 'CONFIRMED'].includes(a.status) && a.startsAt.getTime() >= cutoff })),
      requests,
    };
  }

  async cancelAppointment(ctx: PortalContext, id: string, reason: string) {
    const org = await this.prisma.raw.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { portalCancelHours: true } });
    await this.appointmentService.cancelByClient(id, ctx.clientId, reason, org.portalCancelHours);
    return this.appointments(ctx);
  }

  async requestAppointment(ctx: PortalContext, input: { patientId?: string | null; reason: string; preferredDate: Date; preferredTime: string; notes?: string | null }) {
    if (input.patientId) await this.assertPet(ctx, input.patientId);
    if (input.preferredDate < (await branchToday(this.prisma))) throw ruleViolation('PAST_DATE', 'Choose today or a future date');
    return this.prisma.db.$transaction(async (tx) => {
      const r = await tx.appointmentRequest.create({ data: { ...input, patientId: input.patientId ?? null, organizationId: ctx.organizationId, clientId: ctx.clientId } });
      await this.audit.record({ action: 'portal.appointment_requested', entityType: 'Client', entityId: ctx.clientId, summary: input.reason }, tx);
      return r;
    });
  }

  async cancelRequest(ctx: PortalContext, id: string) {
    const r = await this.prisma.db.appointmentRequest.findFirst({ where: { id, clientId: ctx.clientId } });
    if (!r) throw notFound('Request');
    if (r.status !== 'PENDING') throw ruleViolation('NOT_PENDING', 'This request has already been handled');
    return this.prisma.db.appointmentRequest.update({ where: { id }, data: { status: 'CANCELLED' } });
  }

  // ── Billing ──

  async invoices(ctx: PortalContext) {
    const db = this.prisma.db;
    const [rows, payments, client] = await Promise.all([
      db.invoice.findMany({ where: { clientId: ctx.clientId, status: { notIn: ['DRAFT'] } }, select: { id: true, number: true, status: true, issuedAt: true, dueAt: true, totalMinor: true, balanceMinor: true, currency: true }, orderBy: { issuedAt: 'desc' }, take: 100 }),
      db.payment.findMany({ where: { clientId: ctx.clientId }, select: { id: true, number: true, amountMinor: true, refundedMinor: true, method: true, receivedAt: true }, orderBy: { receivedAt: 'desc' }, take: 100 }),
      db.client.findUniqueOrThrow({ where: { id: ctx.clientId }, select: { balanceMinor: true } }),
    ]);
    return {
      balanceMinor: client.balanceMinor,
      invoices: rows.map((i) => ({ ...i, invoiceNo: formatNumber('INV', i.number!) })),
      payments: payments.map((p) => ({ ...p, receiptNo: formatNumber('RCPT', p.number) })),
    };
  }

  async invoice(ctx: PortalContext, id: string) {
    const inv = await this.invoiceService.get(id);
    if (inv.clientId !== ctx.clientId || inv.status === 'DRAFT') throw notFound('Invoice');
    const org = await this.prisma.raw.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { name: true, legalName: true, taxNumber: true, phone: true, email: true, addressLine1: true, addressLine2: true, city: true, postcode: true } });
    return { invoice: inv, clinic: org };
  }

  // ── Messages & preferences ──

  async messages(ctx: PortalContext) {
    await this.prisma.db.clientMessage.updateMany({ where: { clientId: ctx.clientId, direction: 'OUTBOUND', readAt: null }, data: { readAt: new Date() } });
    return this.prisma.db.clientMessage.findMany({ where: { clientId: ctx.clientId }, select: { id: true, direction: true, kind: true, subject: true, body: true, authorName: true, createdAt: true, readAt: true }, orderBy: { createdAt: 'asc' }, take: 500 });
  }

  async sendMessage(ctx: PortalContext, input: { kind: 'MESSAGE' | 'FEEDBACK'; subject?: string | null; body: string; patientId?: string | null }) {
    if (input.patientId) await this.assertPet(ctx, input.patientId);
    return this.prisma.db.$transaction(async (tx) => {
      const m = await tx.clientMessage.create({ data: { organizationId: ctx.organizationId, clientId: ctx.clientId, patientId: input.patientId ?? null, direction: 'INBOUND', kind: input.kind, subject: input.subject ?? null, body: input.body, authorName: ctx.name } });
      await this.audit.record({ action: input.kind === 'FEEDBACK' ? 'portal.feedback' : 'portal.message', entityType: 'Client', entityId: ctx.clientId, summary: input.subject ?? input.body.slice(0, 60) }, tx);
      return m;
    });
  }

  async preferences(ctx: PortalContext) {
    return this.prisma.db.client.findUniqueOrThrow({ where: { id: ctx.clientId }, select: { remindersConsent: true, marketingConsent: true, preferredChannel: true, email: true, mobilePhone: true } });
  }

  async updatePreferences(ctx: PortalContext, input: { remindersConsent: boolean; marketingConsent: boolean; preferredChannel: 'EMAIL' | 'SMS' | 'WHATSAPP' | 'PHONE' }) {
    await this.prisma.db.$transaction(async (tx) => {
      const before = await tx.client.findUniqueOrThrow({ where: { id: ctx.clientId } });
      await tx.client.update({ where: { id: ctx.clientId }, data: input });
      const changes = Object.entries(input).filter(([k, v]) => (before as any)[k] !== v).map(([k, v]) => `${k}: ${(before as any)[k]} → ${v}`);
      if (changes.length) await this.audit.record({ action: 'portal.preferences_updated', entityType: 'Client', entityId: ctx.clientId, summary: changes.join(', ') }, tx);
    });
    return this.preferences(ctx);
  }
}
