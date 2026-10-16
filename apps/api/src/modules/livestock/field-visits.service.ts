import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { z } from 'zod';
import type { fieldVisitItemSchema, fieldVisitSchema, updateFieldVisitSchema } from '@vcms/shared';
import { AuditService, diff } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { CounterService, formatNumber } from '../../common/counter/counter.service';
import { conflict, notFound, ruleViolation } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ChargeCaptureService } from '../billing/charge-capture.service';
import { InventoryService } from '../inventory/inventory.service';
import { WithdrawalService } from '../pharmacy/withdrawal.service';
import { farmNo } from './farms.service';

export const visitNo = (n: number) => formatNumber('FV', n, 5);

const include = {
  farm: { select: { id: true, name: true, number: true, address: true, district: true, latitude: true, longitude: true } },
  client: { select: { id: true, displayName: true, mobilePhone: true } },
  clinician: { select: { id: true, user: { select: { name: true } } } },
  appointment: { select: { id: true, number: true, status: true, startsAt: true } },
} satisfies Prisma.FieldVisitInclude;

type Visit = Prisma.FieldVisitGetPayload<{ include: typeof include }>;

function shape(v: Visit) {
  return {
    ...v,
    visitNo: visitNo(v.number),
    distanceKm: v.distanceKm === null ? null : Number(v.distanceKm),
    farm: { ...v.farm, farmNo: farmNo(v.farm.number), latitude: v.farm.latitude === null ? null : Number(v.farm.latitude), longitude: v.farm.longitude === null ? null : Number(v.farm.longitude) },
    clinician: v.clinician ? { id: v.clinician.id, name: v.clinician.user.name } : null,
  };
}

/** Farm visits: scheduling, on-site work and billing to the farm owner. */
@Injectable()
export class FieldVisitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly counters: CounterService,
    private readonly charges: ChargeCaptureService,
    private readonly inventory: InventoryService,
    private readonly withdrawals: WithdrawalService,
  ) {}

  private async clinician(id?: string | null) {
    if (!id) return null;
    const m = await this.prisma.db.membership.findUnique({ where: { id } });
    if (!m || m.status !== 'ACTIVE') throw ruleViolation('INVALID_CLINICIAN', 'Clinician not found');
    return m.id;
  }

  private async service(id?: string | null) {
    if (!id) return null;
    const s = await this.prisma.db.service.findUnique({ where: { id } });
    if (!s || !s.isActive) throw ruleViolation('INVALID_SERVICE', 'Service not found or inactive');
    return s;
  }

  async list(q: { from?: Date; to?: Date; status?: string; farmId?: string; clinicianId?: string }) {
    const rows = await this.prisma.db.fieldVisit.findMany({
      where: {
        farmId: q.farmId,
        clinicianId: q.clinicianId,
        status: q.status ? { in: q.status.split(',') as any } : undefined,
        scheduledAt: q.from || q.to ? { gte: q.from, lt: q.to } : undefined,
      },
      include,
      orderBy: { scheduledAt: q.from ? 'asc' : 'desc' },
      take: 300,
    });
    return rows.map(shape);
  }

  async get(id: string) {
    const v = await this.prisma.db.fieldVisit.findUnique({ where: { id }, include });
    if (!v) throw notFound('Field visit');
    const items = await this.prisma.db.fieldVisitItem.findMany({ where: { visitId: id }, orderBy: { createdAt: 'asc' } });
    const patients = await this.prisma.db.patient.findMany({ where: { id: { in: items.map((i) => i.patientId).filter(Boolean) as string[] } }, select: { id: true, name: true } });
    const treatments = await this.prisma.db.groupTreatment.findMany({ where: { fieldVisitId: id }, include: { group: { select: { id: true, name: true } } }, orderBy: { administeredAt: 'asc' } });
    const charges = await this.prisma.db.charge.findMany({
      where: { OR: [{ sourceType: 'FieldVisit', sourceId: id }, { sourceType: 'FieldVisitItem', sourceId: { in: items.map((i) => i.id) } }, { sourceType: 'GroupTreatment', sourceId: { in: treatments.map((t) => t.id) } }] },
      select: { id: true, description: true, quantity: true, unitPriceMinor: true, taxRateBasisPoints: true, status: true, sourceType: true, sourceId: true },
      orderBy: { createdAt: 'asc' },
    });
    return {
      ...shape(v),
      items: items.map((i) => ({ ...i, quantity: Number(i.quantity), patient: patients.find((p) => p.id === i.patientId) ?? null })),
      treatments: treatments.map((t) => ({ ...t, quantityIssued: t.quantityIssued === null ? null : Number(t.quantityIssued) })),
      charges: charges.map((c) => ({ ...c, quantity: Number(c.quantity), totalMinor: Math.round(Number(c.quantity) * c.unitPriceMinor) })),
    };
  }

  async create(input: z.infer<typeof fieldVisitSchema>) {
    const ctx = RequestContext.require();
    const farm = await this.prisma.db.farm.findUnique({ where: { id: input.farmId } });
    if (!farm || farm.status !== 'ACTIVE') throw ruleViolation('INVALID_FARM', 'Farm not found or inactive');
    let branchId = input.branchId ?? ctx.branchId ?? null;
    if (input.appointmentId) {
      const a = await this.prisma.db.appointment.findUnique({ where: { id: input.appointmentId } });
      if (!a) throw notFound('Appointment');
      if (a.clientId !== farm.clientId) throw ruleViolation('APPOINTMENT_CLIENT', 'The appointment is for a different client than the farm owner');
      if (await this.prisma.db.fieldVisit.findUnique({ where: { appointmentId: a.id } })) throw conflict('A visit record already exists for this appointment');
      branchId = a.branchId;
    }
    if (!branchId) throw ruleViolation('NO_BRANCH', 'Select a branch first');
    const branch = await this.prisma.db.branch.findUnique({ where: { id: branchId } });
    if (!branch || !branch.isActive) throw ruleViolation('INVALID_BRANCH', 'Branch not found');
    const clinicianId = await this.clinician(input.clinicianId);
    const callout = await this.service(input.calloutServiceId);
    return this.prisma.db.$transaction(async (tx) => {
      const number = await this.counters.next(tx, 'fieldVisit');
      const v = await tx.fieldVisit.create({
        data: { organizationId: ctx.organizationId!, branchId: branch.id, number, farmId: farm.id, clientId: farm.clientId, appointmentId: input.appointmentId ?? null, clinicianId, scheduledAt: input.scheduledAt, purpose: input.purpose, calloutServiceId: callout?.id ?? null, createdByName: ctx.userName },
        include,
      });
      await this.audit.record({ action: 'field_visit.scheduled', entityType: 'Farm', entityId: farm.id, summary: `${visitNo(number)} ${input.purpose}` }, tx);
      return shape(v);
    });
  }

  private async open(id: string) {
    const v = await this.prisma.db.fieldVisit.findUnique({ where: { id } });
    if (!v) throw notFound('Field visit');
    if (v.status === 'COMPLETED' || v.status === 'CANCELLED') throw ruleViolation('VISIT_CLOSED', `This visit is ${v.status.toLowerCase()}`);
    return v;
  }

  async update(id: string, input: z.infer<typeof updateFieldVisitSchema>) {
    const before = await this.open(id);
    if (input.clinicianId !== undefined) await this.clinician(input.clinicianId);
    if (input.calloutServiceId) await this.service(input.calloutServiceId);
    return this.prisma.db.$transaction(async (tx) => {
      const after = await tx.fieldVisit.update({ where: { id }, data: input, include });
      await this.audit.record({ action: 'field_visit.updated', entityType: 'Farm', entityId: before.farmId, summary: visitNo(before.number), changes: diff(before, after, Object.keys(input)) }, tx);
      return shape(after);
    });
  }

  async start(id: string) {
    const v = await this.open(id);
    if (v.status !== 'SCHEDULED') throw ruleViolation('ALREADY_STARTED', 'This visit has already started');
    return this.prisma.db.$transaction(async (tx) => {
      const after = await tx.fieldVisit.update({ where: { id }, data: { status: 'IN_PROGRESS', startedAt: new Date() }, include });
      await this.audit.record({ action: 'field_visit.started', entityType: 'Farm', entityId: v.farmId, summary: visitNo(v.number) }, tx);
      return shape(after);
    });
  }

  /** Records a service or product supplied on the visit and bills it to the farm owner straight away. */
  async addItem(id: string, input: z.infer<typeof fieldVisitItemSchema>) {
    const v = await this.open(id);
    const ctx = RequestContext.require();
    const service = await this.service(input.serviceId);
    const product = input.productId ? await this.prisma.db.product.findUnique({ where: { id: input.productId } }) : null;
    if (input.productId && (!product || !product.isActive)) throw ruleViolation('INVALID_PRODUCT', 'Product not found or inactive');
    const patient = input.patientId ? await this.prisma.db.patient.findUnique({ where: { id: input.patientId } }) : null;
    if (input.patientId && (!patient || patient.farmId !== v.farmId)) throw ruleViolation('PATIENT_FARM', 'That animal is not on this farm');
    const price = input.unitPriceMinor ?? (service ? service.priceMinor : product?.sellPriceMinor ?? 0);
    const description = input.description || (service ? service.name : product!.name);
    return this.prisma.db.$transaction(async (tx) => {
      if (v.status === 'SCHEDULED') await tx.fieldVisit.update({ where: { id }, data: { status: 'IN_PROGRESS', startedAt: new Date() } });
      const item = await tx.fieldVisitItem.create({
        data: { organizationId: ctx.organizationId!, visitId: id, kind: service ? 'SERVICE' : 'PRODUCT', serviceId: service?.id ?? null, productId: product?.id ?? null, patientId: patient?.id ?? null, description, quantity: input.quantity, unitPriceMinor: price, recordedByName: ctx.userName ?? 'Unknown' },
      });
      if (product) {
        await this.inventory.issueForEvent(tx, { productId: product.id, quantity: input.quantity, branchId: v.branchId, type: 'ADMINISTER', referenceType: 'FieldVisitItem', referenceId: item.id });
        if (patient) await this.withdrawals.record(tx, { patientId: patient.id, speciesId: patient.speciesId, productId: product.id, sourceType: 'FIELD_VISIT_ITEM', sourceId: item.id, treatedAt: new Date() });
      }
      await this.charges.capture(tx, {
        sourceType: 'FieldVisitItem',
        sourceId: item.id,
        clientId: v.clientId,
        patientId: patient?.id ?? null,
        branchId: v.branchId,
        kind: service ? 'SERVICE' : 'PRODUCT',
        serviceId: service?.id ?? null,
        productId: product?.id ?? null,
        description: `${description}${patient ? ` — ${patient.name}` : ''} (${visitNo(v.number)})`,
        quantity: input.quantity,
        unitPriceMinor: price,
        taxRateBasisPoints: await this.charges.taxFor(tx, service?.taxRateId ?? product?.taxRateId),
      });
      await this.audit.record({ action: 'field_visit.item_added', entityType: 'Farm', entityId: v.farmId, summary: `${visitNo(v.number)}: ${description} × ${input.quantity}` }, tx);
      return { ...item, quantity: Number(item.quantity) };
    });
  }

  async complete(id: string, input: { findings: string; recommendations?: string | null; distanceKm?: number | null }) {
    const v = await this.open(id);
    const ctx = RequestContext.require();
    const callout = v.calloutServiceId ? await this.prisma.db.service.findUnique({ where: { id: v.calloutServiceId } }) : null;
    return this.prisma.db.$transaction(async (tx) => {
      if (callout && callout.isActive) {
        await this.charges.capture(tx, {
          sourceType: 'FieldVisit',
          sourceId: v.id,
          clientId: v.clientId,
          branchId: v.branchId,
          kind: 'SERVICE',
          serviceId: callout.id,
          description: `${callout.name} (${visitNo(v.number)})`,
          quantity: 1,
          unitPriceMinor: callout.priceMinor,
          taxRateBasisPoints: await this.charges.taxFor(tx, callout.taxRateId),
        });
      }
      const after = await tx.fieldVisit.update({
        where: { id },
        data: { status: 'COMPLETED', findings: input.findings, recommendations: input.recommendations, distanceKm: input.distanceKm ?? v.distanceKm, startedAt: v.startedAt ?? new Date(), completedAt: new Date(), completedByName: ctx.userName },
        include,
      });
      if (v.appointmentId) await tx.appointment.updateMany({ where: { id: v.appointmentId, status: { in: ['BOOKED', 'CONFIRMED', 'CHECKED_IN', 'IN_CONSULTATION'] } }, data: { status: 'COMPLETED', completedAt: new Date() } });
      await this.audit.record({ action: 'field_visit.completed', entityType: 'Farm', entityId: v.farmId, summary: visitNo(v.number) }, tx);
      return shape(after);
    });
  }

  async cancel(id: string, reason: string) {
    const v = await this.open(id);
    const items = await this.prisma.db.fieldVisitItem.count({ where: { visitId: id } });
    const treatments = await this.prisma.db.groupTreatment.count({ where: { fieldVisitId: id } });
    if (items || treatments) throw ruleViolation('VISIT_HAS_WORK', 'Work has been recorded on this visit; complete it instead of cancelling');
    return this.prisma.db.$transaction(async (tx) => {
      const after = await tx.fieldVisit.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason }, include });
      if (v.appointmentId) await tx.appointment.updateMany({ where: { id: v.appointmentId, status: { in: ['BOOKED', 'CONFIRMED'] } }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: `Field visit cancelled: ${reason}` } });
      await this.audit.record({ action: 'field_visit.cancelled', entityType: 'Farm', entityId: v.farmId, summary: `${visitNo(v.number)}: ${reason}` }, tx);
      return shape(after);
    });
  }
}
