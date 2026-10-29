import { Injectable } from '@nestjs/common';
import { Prisma, TreatmentOrder } from '@prisma/client';
import { allergyConflictText, allergyConflicts, type TreatmentOrderInput } from '@vcms/shared';
import { AuditService } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { conflict, notFound, ruleViolation } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { ScopedTx } from '../../common/prisma/tenant-extension';
import { AdministrationsService } from '../pharmacy/administrations.service';

/** Scheduled tasks are generated this far ahead; the hourly job keeps the window rolling. */
export const TASK_HORIZON_HOURS = 36;
const HOUR = 3600_000;

const dec = (v: Prisma.Decimal | null) => (v === null ? null : Number(v));
/** `outside`: a medicine the clinic does not stock (e.g. brought in by the owner) — no stock used, nothing charged. */
export const shapeOrder = <T extends TreatmentOrder>(o: T) => ({ ...o, dose: dec(o.dose), fluidRateMlPerHour: dec(o.fluidRateMlPerHour), outside: o.kind === 'MEDICATION' && !o.productId });

/**
 * The hospital treatment sheet. Orders are written by clinicians; each scheduled occurrence becomes a
 * task that nursing staff tick off (done, or not done with a reason). Medication tasks are recorded through
 * the pharmacy administration service, so allergy checks, stock, charges and withdrawal periods all apply.
 */
@Injectable()
export class TreatmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly administrations: AdministrationsService,
  ) {}

  /** Creates any missing scheduled tasks up to the horizon. Idempotent (unique order + due time). */
  async ensureTasks(tx: ScopedTx, order: Pick<TreatmentOrder, 'id' | 'organizationId' | 'admissionId' | 'schedule' | 'intervalHours' | 'startAt' | 'endAt' | 'status'>, now = new Date()) {
    if (order.status !== 'ACTIVE') return 0;
    const limit = new Date(Math.min(now.getTime() + TASK_HORIZON_HOURS * HOUR, order.endAt?.getTime() ?? Infinity));
    const due: Date[] = [];
    if (order.schedule === 'ONCE') due.push(order.startAt);
    else if ((order.schedule === 'INTERVAL' || order.schedule === 'CONTINUOUS') && order.intervalHours) {
      for (let t = order.startAt.getTime(); t <= limit.getTime() && due.length < 500; t += order.intervalHours * HOUR) due.push(new Date(t));
    }
    if (!due.length) return 0;
    const r = await tx.treatmentTask.createMany({
      data: due.map((dueAt) => ({ organizationId: order.organizationId, admissionId: order.admissionId, orderId: order.id, dueAt })),
      skipDuplicates: true,
    });
    return r.count;
  }

  private async admissionOpen(admissionId: string) {
    const a = await this.prisma.db.admission.findUnique({ where: { id: admissionId } });
    if (!a) throw notFound('Admission');
    if (a.status !== 'ADMITTED') throw ruleViolation('NOT_ADMITTED', 'This patient is no longer in hospital');
    return a;
  }

  async createOrder(admissionId: string, input: TreatmentOrderInput) {
    const ctx = RequestContext.require();
    await this.admissionOpen(admissionId);
    if (input.productId) {
      const p = await this.prisma.db.product.findUnique({ where: { id: input.productId } });
      if (!p || !p.isActive) throw ruleViolation('INVALID_PRODUCT', 'Product not found or inactive');
    }
    const startAt = input.startAt ?? new Date();
    return this.prisma.db.$transaction(async (tx) => {
      const order = await tx.treatmentOrder.create({
        data: {
          organizationId: ctx.organizationId!,
          admissionId,
          kind: input.kind,
          schedule: input.schedule,
          description: input.description.trim(),
          productId: input.productId ?? null,
          dose: input.dose ?? null,
          doseUnit: input.doseUnit ?? null,
          route: input.route ?? null,
          fluidRateMlPerHour: input.fluidRateMlPerHour ?? null,
          intervalHours: input.schedule === 'INTERVAL' || input.schedule === 'CONTINUOUS' ? (input.intervalHours ?? null) : null,
          instructions: input.instructions ?? null,
          startAt,
          endAt: input.endAt ?? null,
          orderedById: ctx.userId!,
          orderedByName: ctx.userName ?? 'Unknown',
        },
      });
      await this.ensureTasks(tx, order);
      const outside = order.kind === 'MEDICATION' && !order.productId ? ' (not from our pharmacy)' : '';
      await this.audit.record({ action: 'treatment.ordered', entityType: 'Admission', entityId: admissionId, summary: `${order.kind}: ${order.description}${outside}` }, tx);
      return shapeOrder(order);
    });
  }

  async stopOrder(orderId: string, reason: string) {
    const ctx = RequestContext.require();
    const o = await this.prisma.db.treatmentOrder.findUnique({ where: { id: orderId } });
    if (!o) throw notFound('Treatment');
    if (o.status !== 'ACTIVE') throw ruleViolation('NOT_ACTIVE', 'This treatment is already stopped');
    return this.prisma.db.$transaction(async (tx) => {
      const after = await tx.treatmentOrder.update({ where: { id: orderId }, data: { status: 'STOPPED', stoppedAt: new Date(), stoppedByName: ctx.userName, stopReason: reason } });
      await tx.treatmentTask.updateMany({ where: { orderId, status: 'DUE', dueAt: { gt: new Date() } }, data: { status: 'CANCELLED' } });
      await this.audit.record({ action: 'treatment.stopped', entityType: 'Admission', entityId: o.admissionId, summary: `${o.description}: ${reason}` }, tx);
      return shapeOrder(after);
    });
  }

  /**
   * Records a task as done or not done. Two staff ticking the same task at once cannot both succeed:
   * the update only matches a task that is still DUE.
   */
  async completeTask(taskId: string, input: { status: 'DONE' | 'SKIPPED'; value?: string | null; notes?: string | null; skipReason?: string | null; batchNumber?: string | null; overrideReason?: string | null; at?: Date | null }) {
    const ctx = RequestContext.require();
    const task = await this.prisma.db.treatmentTask.findUnique({ where: { id: taskId }, include: { order: true, admission: true } });
    if (!task) throw notFound('Treatment task');
    if (task.status !== 'DUE') throw conflict('This treatment has already been recorded');
    if (task.admission.status !== 'ADMITTED') throw ruleViolation('NOT_ADMITTED', 'This patient is no longer in hospital');
    const at = input.at ?? new Date();
    if (at.getTime() > Date.now() + 5 * 60_000) throw ruleViolation('FUTURE_TIME', 'Time cannot be in the future');
    const o = task.order;
    // A medicine the clinic does not stock is not recorded through the pharmacy (no stock, no charge), but the
    // patient's allergy alerts are still checked against the name written, with a documented override.
    const outside = o.kind === 'MEDICATION' && !o.productId;
    let overrideNote: string | null = null;
    if (outside && input.status === 'DONE') {
      const alerts = await this.prisma.db.patientAlert.findMany({ where: { patientId: task.admission.patientId, isActive: true } });
      const conflicts = allergyConflicts(alerts, { name: o.description });
      if (conflicts.length) {
        if (!input.overrideReason?.trim()) {
          throw ruleViolation('SAFETY_OVERRIDE_REQUIRED', `${allergyConflictText(conflicts[0], o.description)}. Write a reason for overriding the allergy warning.`, {
            warnings: conflicts.map((c) => ({ code: 'ALLERGY', message: allergyConflictText(c, o.description), blocking: true })),
          });
        }
        overrideNote = `Allergy warning overridden: ${input.overrideReason.trim()}`;
      }
    }
    const notes = [input.notes, overrideNote].filter(Boolean).join(' — ') || null;
    const mark = async (tx: ScopedTx, administrationId: string | null) => {
      const r = await tx.treatmentTask.updateMany({
        where: { id: taskId, status: 'DUE' },
        data: {
          status: input.status,
          doneAt: at,
          doneById: ctx.userId,
          doneByName: ctx.userName,
          value: input.value ?? null,
          notes,
          skipReason: input.status === 'SKIPPED' ? input.skipReason : null,
          administrationId,
        },
      });
      if (!r.count) throw conflict('This treatment has already been recorded');
      await this.audit.record(
        { action: input.status === 'DONE' ? 'treatment.given' : 'treatment.not_given', entityType: 'Admission', entityId: task.admissionId, summary: `${task.order.description}${outside ? ' (not from our pharmacy)' : ''}${input.value ? ` — ${input.value}` : ''}${input.skipReason ? ` (not done: ${input.skipReason})` : ''}${overrideNote ? ` — ${overrideNote}` : ''}` },
        tx,
      );
    };
    if (o.kind === 'MEDICATION' && o.productId && o.dose && o.doseUnit && o.route) {
      // Through pharmacy: allergy check, stock deduction, charge capture and withdrawal periods.
      await this.administrations.record(
        {
          patientId: task.admission.patientId,
          encounterId: task.admission.encounterId,
          productId: o.productId,
          status: input.status === 'DONE' ? 'GIVEN' : 'NOT_GIVEN',
          dose: Number(o.dose),
          doseUnit: o.doseUnit,
          route: o.route,
          batchNumber: input.batchNumber ?? null,
          reasonNotGiven: input.status === 'SKIPPED' ? input.skipReason : null,
          notes: [`Hospital treatment sheet`, input.notes].filter(Boolean).join(' — '),
          administeredAt: at,
          overrideReason: input.overrideReason ?? null,
        },
        (tx, a) => mark(tx, a.id),
      );
    } else {
      await this.prisma.db.$transaction((tx) => mark(tx, null));
    }
    return this.prisma.db.treatmentTask.findUniqueOrThrow({ where: { id: taskId } });
  }

  /** Gives an as-needed (or extra) dose now: creates the occurrence and records it in one step. */
  async giveNow(orderId: string, input: Parameters<TreatmentsService['completeTask']>[1]) {
    const o = await this.prisma.db.treatmentOrder.findUnique({ where: { id: orderId } });
    if (!o) throw notFound('Treatment');
    if (o.status !== 'ACTIVE') throw ruleViolation('NOT_ACTIVE', 'This treatment has been stopped');
    await this.admissionOpen(o.admissionId);
    const task = await this.prisma.db.treatmentTask.create({ data: { organizationId: o.organizationId, admissionId: o.admissionId, orderId, dueAt: input.at ?? new Date() } });
    try {
      return await this.completeTask(task.id, input);
    } catch (e) {
      // Recording failed (e.g. allergy override needed): remove the empty occurrence so the sheet stays clean.
      await this.prisma.db.treatmentTask.updateMany({ where: { id: task.id, status: 'DUE' }, data: { status: 'CANCELLED' } });
      throw e;
    }
  }

  /** Orders and their tasks within a time window (defaults: last 24 h to next 24 h). */
  async sheet(admissionId: string, from?: Date, to?: Date) {
    const start = from ?? new Date(Date.now() - 24 * HOUR);
    const end = to ?? new Date(Date.now() + 24 * HOUR);
    const orders = await this.prisma.db.treatmentOrder.findMany({
      where: { admissionId },
      include: {
        product: { select: { id: true, name: true, dispensingUnit: true } },
        tasks: { where: { dueAt: { gte: start, lt: end }, status: { not: 'CANCELLED' } }, orderBy: { dueAt: 'asc' } },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    });
    return { from: start, to: end, orders: orders.map(shapeOrder) };
  }
}
