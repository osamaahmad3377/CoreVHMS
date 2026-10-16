import { Injectable } from '@nestjs/common';
import { Prisma, SampleType } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { CounterService, formatNumber } from '../../common/counter/counter.service';
import { notFound, ruleViolation } from '../../common/http/errors';
import { pageArgs, paginated } from '../../common/http/pagination';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { ScopedTx } from '../../common/prisma/tenant-extension';
import { ageInMonths, effectiveInterval, flagValue } from './lab-flags';

export const labOrderNo = (n: number) => formatNumber('LAB', n);
const dec = (d: Prisma.Decimal | null | undefined) => (d === null || d === undefined ? null : Number(d));

const include = {
  patient: {
    select: {
      id: true,
      name: true,
      number: true,
      sex: true,
      dateOfBirth: true,
      dobEstimated: true,
      status: true,
      latestWeightKg: true,
      photoAttachmentId: true,
      species: { select: { id: true, name: true, category: true } },
      breed: { select: { name: true } },
      alerts: { where: { isActive: true }, select: { id: true, severity: true, title: true, type: true } },
    },
  },
  client: { select: { id: true, displayName: true, mobilePhone: true } },
  items: {
    orderBy: { createdAt: 'asc' },
    include: {
      test: { include: { analytes: { orderBy: { sortOrder: 'asc' } } } },
      results: { orderBy: { enteredAt: 'asc' } },
      imagingReport: true,
    },
  },
  samples: { orderBy: { collectedAt: 'asc' }, include: { events: { orderBy: { at: 'asc' } } } },
} satisfies Prisma.DiagnosticOrderInclude;

type Row = Prisma.DiagnosticOrderGetPayload<{ include: typeof include }>;

function shape(o: Row) {
  return {
    ...o,
    orderNo: labOrderNo(o.number),
    patient: { ...o.patient, patientNo: formatNumber('P', o.patient.number), latestWeightKg: dec(o.patient.latestWeightKg) },
    items: o.items.map((i) => ({
      ...i,
      results: i.results.map((r) => ({ ...r, valueNumeric: dec(r.valueNumeric), refLow: dec(r.refLow), refHigh: dec(r.refHigh) })),
    })),
  };
}

export type OrderHook = (tx: ScopedTx, e: { orderId: string; itemIds: string[] }) => Promise<void>;

/** Lab and imaging orders: order → collect sample → enter results → validate/release → (amend). */
@Injectable()
export class DiagnosticOrdersService {
  private readonly createdHooks: OrderHook[] = [];
  private readonly cancelledHooks: OrderHook[] = [];

  /** Billing registers here to capture charges in the same transaction as the order. */
  registerCreatedHook(h: OrderHook) {
    this.createdHooks.push(h);
  }

  registerCancelledHook(h: OrderHook) {
    this.cancelledHooks.push(h);
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly counters: CounterService,
  ) {}

  async list(q: { page: number; pageSize: number; q?: string; status?: string; patientId?: string; encounterId?: string; critical?: boolean }) {
    const statuses = q.status?.split(',').filter(Boolean) as any[] | undefined;
    const where: Prisma.DiagnosticOrderWhereInput = {
      status: statuses?.length ? { in: statuses } : undefined,
      patientId: q.patientId,
      encounterId: q.encounterId,
      hasCritical: q.critical ? true : undefined,
      ...(q.q
        ? {
            OR: [
              { patient: { name: { contains: q.q, mode: 'insensitive' } } },
              { samples: { some: { barcode: q.q.toUpperCase() } } },
              { items: { some: { test: { name: { contains: q.q, mode: 'insensitive' } } } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.diagnosticOrder.findMany({
        where,
        include,
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        ...pageArgs(q),
      }),
      this.prisma.db.diagnosticOrder.count({ where }),
    ]);
    return paginated(rows.map(shape), total, q);
  }

  async get(id: string) {
    const o = await this.prisma.db.diagnosticOrder.findUnique({ where: { id }, include });
    if (!o) throw notFound('Diagnostic order');
    this.audit.recordAsync({ action: 'lab_order.viewed', entityType: 'DiagnosticOrder', entityId: id });
    // Applicable reference intervals for display in the result-entry grid.
    const analyteIds = o.items.flatMap((i) => i.test.analytes.map((a) => a.id));
    const intervals = await this.prisma.db.referenceInterval.findMany({ where: { analyteId: { in: analyteIds }, speciesId: o.patient.species.id } });
    const age = ageInMonths(o.patient.dateOfBirth);
    const applicable: Record<string, { low: number | null; high: number | null; criticalLow: number | null; criticalHigh: number | null; source: string }> = {};
    for (const aid of analyteIds) {
      const sel = effectiveInterval(
        intervals.filter((i) => i.analyteId === aid).map((i) => ({ ...i, low: dec(i.low), high: dec(i.high), criticalLow: dec(i.criticalLow), criticalHigh: dec(i.criticalHigh) })),
        { sex: o.patient.sex, ageMonths: age },
      );
      if (sel) applicable[aid] = { low: sel.low, high: sel.high, criticalLow: sel.criticalLow, criticalHigh: sel.criticalHigh, source: sel.source };
    }
    return { ...shape(o), referenceIntervals: applicable };
  }

  async create(input: { patientId: string; encounterId?: string | null; testIds: string[]; priority: 'ROUTINE' | 'URGENT' | 'STAT'; clinicalNotes?: string | null }) {
    const ctx = RequestContext.require();
    const patient = await this.prisma.db.patient.findUnique({ where: { id: input.patientId }, include: { ownerships: { where: { endedAt: null, isPrimary: true } } } });
    if (!patient) throw notFound('Patient');
    if (patient.status !== 'ACTIVE') throw ruleViolation('PATIENT_NOT_ACTIVE', `Cannot order tests for a ${patient.status.toLowerCase()} patient`);
    if (!patient.ownerships[0]) throw ruleViolation('NO_OWNER', 'The patient has no current owner');
    if (input.encounterId) {
      const e = await this.prisma.db.encounter.findUnique({ where: { id: input.encounterId } });
      if (!e || e.patientId !== patient.id) throw ruleViolation('INVALID_ENCOUNTER', 'Consultation does not belong to this patient');
    }
    const ids = [...new Set(input.testIds)];
    const tests = await this.prisma.db.labTest.findMany({ where: { id: { in: ids }, isActive: true } });
    if (tests.length !== ids.length) throw ruleViolation('INVALID_TEST', 'One or more tests are unavailable');
    const id = await this.prisma.db.$transaction(async (tx) => {
      const number = await this.counters.next(tx, 'lab_order');
      const o = await tx.diagnosticOrder.create({
        data: {
          organizationId: ctx.organizationId!,
          branchId: ctx.branchId!,
          number,
          patientId: patient.id,
          clientId: patient.ownerships[0].clientId,
          encounterId: input.encounterId ?? null,
          priority: input.priority,
          clinicalNotes: input.clinicalNotes,
          orderedById: ctx.userId!,
          orderedByName: ctx.userName ?? 'Unknown',
          orderingMembershipId: ctx.membershipId ?? null,
          // Imaging-only orders need no sample.
          status: tests.every((t) => t.sampleType === 'NONE') ? 'IN_PROGRESS' : 'ORDERED',
        },
      });
      await tx.diagnosticOrderItem.createMany({ data: tests.map((t) => ({ organizationId: ctx.organizationId!, orderId: o.id, testId: t.id })) });
      const items = await tx.diagnosticOrderItem.findMany({ where: { orderId: o.id }, select: { id: true } });
      for (const h of this.createdHooks) await h(tx, { orderId: o.id, itemIds: items.map((i) => i.id) });
      await this.audit.record(
        { action: 'lab_order.created', entityType: 'DiagnosticOrder', entityId: o.id, summary: `${labOrderNo(number)} ${input.priority}: ${tests.map((t) => t.code).join(', ')}` },
        tx,
      );
      return o.id;
    });
    return this.get(id);
  }

  private async mutable(orderId: string) {
    const o = await this.prisma.db.diagnosticOrder.findUnique({ where: { id: orderId }, include: { items: { include: { test: { include: { analytes: true } } } } } });
    if (!o) throw notFound('Diagnostic order');
    if (o.status === 'RELEASED') throw ruleViolation('ORDER_RELEASED', 'Results have been released. Use an amendment to correct a result.');
    if (o.status === 'CANCELLED') throw ruleViolation('ORDER_CANCELLED', 'This order was cancelled');
    return o;
  }

  async collectSample(orderId: string, input: { sampleType: SampleType; notes?: string | null }) {
    const ctx = RequestContext.require();
    const o = await this.mutable(orderId);
    return this.prisma.db.$transaction(async (tx) => {
      const n = await this.counters.next(tx, 'sample');
      const barcode = `S${String(n).padStart(8, '0')}`;
      const s = await tx.sample.create({
        data: { organizationId: ctx.organizationId!, orderId, barcode, sampleType: input.sampleType, notes: input.notes, collectedById: ctx.userId!, collectedByName: ctx.userName ?? 'Unknown' },
      });
      await tx.sampleEvent.create({ data: { organizationId: ctx.organizationId!, sampleId: s.id, action: 'COLLECTED', notes: input.notes, byId: ctx.userId!, byName: ctx.userName ?? 'Unknown' } });
      if (o.status === 'ORDERED') await tx.diagnosticOrder.update({ where: { id: orderId }, data: { status: 'COLLECTED' } });
      await this.audit.record({ action: 'lab_sample.collected', entityType: 'DiagnosticOrder', entityId: orderId, summary: `${barcode} ${input.sampleType}` }, tx);
      return s;
    });
  }

  async sampleAction(sampleId: string, input: { action: 'RECEIVED' | 'IN_ANALYSIS' | 'REJECTED' | 'DISPOSED'; notes?: string | null }) {
    const ctx = RequestContext.require();
    const s = await this.prisma.db.sample.findUnique({ where: { id: sampleId } });
    if (!s) throw notFound('Sample');
    if (s.status === 'REJECTED' || s.status === 'DISPOSED') throw ruleViolation('SAMPLE_CLOSED', `Sample is ${s.status.toLowerCase()}`);
    if (input.action === 'REJECTED' && !input.notes) throw ruleViolation('REASON_REQUIRED', 'Give the rejection reason (e.g. haemolysed, clotted, mislabelled)');
    return this.prisma.db.$transaction(async (tx) => {
      const after = await tx.sample.update({ where: { id: sampleId }, data: { status: input.action, rejectionReason: input.action === 'REJECTED' ? input.notes : undefined } });
      await tx.sampleEvent.create({ data: { organizationId: ctx.organizationId!, sampleId, action: input.action, notes: input.notes, byId: ctx.userId!, byName: ctx.userName ?? 'Unknown' } });
      if (input.action === 'IN_ANALYSIS') await tx.diagnosticOrder.updateMany({ where: { id: s.orderId, status: { in: ['ORDERED', 'COLLECTED'] } }, data: { status: 'IN_PROGRESS' } });
      await this.audit.record({ action: `lab_sample.${input.action.toLowerCase()}`, entityType: 'DiagnosticOrder', entityId: s.orderId, summary: `${s.barcode}${input.notes ? `: ${input.notes}` : ''}` }, tx);
      return after;
    });
  }

  private async intervalFor(tx: ScopedTx, analyteId: string, patient: { speciesId: string; sex: string; dateOfBirth: Date | null }) {
    const rows = await tx.referenceInterval.findMany({ where: { analyteId, speciesId: patient.speciesId } });
    return effectiveInterval(
      rows.map((i) => ({ ...i, low: dec(i.low), high: dec(i.high), criticalLow: dec(i.criticalLow), criticalHigh: dec(i.criticalHigh) })),
      { sex: patient.sex, ageMonths: ageInMonths(patient.dateOfBirth) },
    );
  }

  /** Enters or overwrites preliminary results. Released results are never touched here. */
  async enterResults(orderId: string, input: { results: { orderItemId: string; analyteId: string; valueNumeric?: number | null; valueText?: string | null; comment?: string | null }[]; externalReference?: string | null }) {
    const ctx = RequestContext.require();
    const o = await this.mutable(orderId);
    const patient = await this.prisma.db.patient.findUniqueOrThrow({ where: { id: o.patientId } });
    let newCritical = false;
    await this.prisma.db.$transaction(async (tx) => {
      for (const r of input.results) {
        const item = o.items.find((i) => i.id === r.orderItemId);
        if (!item) throw ruleViolation('INVALID_ITEM', 'Result does not belong to this order');
        if (item.status === 'CANCELLED') throw ruleViolation('ITEM_CANCELLED', `${item.test.name} was cancelled`);
        const analyte = item.test.analytes.find((a) => a.id === r.analyteId);
        if (!analyte) throw ruleViolation('INVALID_ANALYTE', `Analyte does not belong to ${item.test.name}`);
        if (analyte.resultType === 'NUMERIC' && (r.valueNumeric === null || r.valueNumeric === undefined)) {
          if (!r.valueText) continue; // blank entry — skip
        }
        if (analyte.resultType === 'OPTION' && r.valueText && !analyte.options.includes(r.valueText)) {
          throw ruleViolation('INVALID_OPTION', `${analyte.name}: “${r.valueText}” is not an allowed value`);
        }
        if (analyte.resultType !== 'NUMERIC' && !r.valueText) continue;
        const interval = analyte.resultType === 'NUMERIC' ? await this.intervalFor(tx, analyte.id, patient) : null;
        const flag = analyte.resultType === 'NUMERIC' && r.valueNumeric != null ? flagValue(r.valueNumeric, interval) : null;
        if (flag === 'CRITICAL_LOW' || flag === 'CRITICAL_HIGH') newCritical = true;
        const data = {
          valueNumeric: analyte.resultType === 'NUMERIC' ? r.valueNumeric ?? null : null,
          valueText: r.valueText ?? null,
          unit: analyte.unit,
          refLow: interval?.low ?? null,
          refHigh: interval?.high ?? null,
          refSource: interval?.source ?? null,
          flag,
          comment: r.comment,
          enteredById: ctx.userId!,
          enteredByName: ctx.userName ?? 'Unknown',
          enteredAt: new Date(),
        };
        const existing = await tx.labResult.findFirst({ where: { orderItemId: item.id, analyteId: analyte.id, status: 'PRELIMINARY' } });
        if (existing) await tx.labResult.update({ where: { id: existing.id }, data });
        else await tx.labResult.create({ data: { ...data, organizationId: ctx.organizationId!, orderItemId: item.id, analyteId: analyte.id } });
      }
      await this.refreshStatus(tx, orderId);
      if (input.externalReference !== undefined) await tx.diagnosticOrder.update({ where: { id: orderId }, data: { externalReference: input.externalReference } });
      if (newCritical) await this.flagCritical(tx, orderId);
      await this.audit.record({ action: 'lab_results.entered', entityType: 'DiagnosticOrder', entityId: orderId, summary: `${input.results.length} value(s)${newCritical ? ' — CRITICAL value present' : ''}` }, tx);
    });
    return this.get(orderId);
  }

  private async refreshStatus(tx: ScopedTx, orderId: string) {
    const items = await tx.diagnosticOrderItem.findMany({
      where: { orderId },
      include: { test: { include: { analytes: true } }, results: { where: { status: { not: 'SUPERSEDED' } } }, imagingReport: true },
    });
    for (const i of items) {
      if (i.status === 'CANCELLED') continue;
      const complete = i.test.category === 'IMAGING' ? !!i.imagingReport : i.test.analytes.every((a) => i.results.some((r) => r.analyteId === a.id));
      const status = complete ? 'RESULTED' : 'PENDING';
      if (status !== i.status) await tx.diagnosticOrderItem.update({ where: { id: i.id }, data: { status } });
      i.status = status;
    }
    const active = items.filter((i) => i.status !== 'CANCELLED');
    const anyResult = active.some((i) => i.results.length > 0 || i.imagingReport);
    const allDone = active.length > 0 && active.every((i) => i.status === 'RESULTED');
    const order = await tx.diagnosticOrder.findUniqueOrThrow({ where: { id: orderId } });
    const status = allDone ? 'AWAITING_VALIDATION' : anyResult ? 'IN_PROGRESS' : order.status;
    if (status !== order.status) await tx.diagnosticOrder.update({ where: { id: orderId }, data: { status } });
  }

  /** Critical values create an urgent review task for the ordering clinician (once per order). */
  private async flagCritical(tx: ScopedTx, orderId: string) {
    const o = await tx.diagnosticOrder.findUniqueOrThrow({ where: { id: orderId } });
    if (o.hasCritical) return;
    await tx.diagnosticOrder.update({ where: { id: orderId }, data: { hasCritical: true } });
    await tx.task.create({
      data: {
        organizationId: o.organizationId,
        branchId: o.branchId,
        type: 'RESULT_REVIEW',
        title: `CRITICAL lab value — review ${labOrderNo(o.number)} now`,
        dueAt: new Date(),
        patientId: o.patientId,
        clientId: o.clientId,
        encounterId: o.encounterId,
        assigneeId: o.orderingMembershipId,
        createdByName: 'Laboratory',
      },
    });
  }

  async saveImagingReport(orderId: string, itemId: string, input: { modality: string; bodyRegion?: string | null; views?: string | null; findings: string; conclusion: string; recommendations?: string | null; studyInstanceUid?: string | null }) {
    const ctx = RequestContext.require();
    const o = await this.mutable(orderId);
    const item = o.items.find((i) => i.id === itemId);
    if (!item) throw ruleViolation('INVALID_ITEM', 'Item does not belong to this order');
    if (item.test.category !== 'IMAGING') throw ruleViolation('NOT_IMAGING', 'Reports with findings apply to imaging tests');
    await this.prisma.db.$transaction(async (tx) => {
      const existing = await tx.imagingReport.findUnique({ where: { orderItemId: itemId } });
      const data = { ...input, reportedById: ctx.userId!, reportedByName: ctx.userName ?? 'Unknown', reportedAt: new Date() };
      if (existing) await tx.imagingReport.update({ where: { id: existing.id }, data });
      else await tx.imagingReport.create({ data: { ...data, organizationId: ctx.organizationId!, orderItemId: itemId } });
      await this.refreshStatus(tx, orderId);
      await this.audit.record({ action: 'imaging.reported', entityType: 'DiagnosticOrder', entityId: orderId, summary: `${item.test.name}: ${input.conclusion.slice(0, 120)}` }, tx);
    });
    return this.get(orderId);
  }

  /** Validates and releases all results; afterwards they are final and immutable. */
  async release(orderId: string) {
    const ctx = RequestContext.require();
    const o = await this.mutable(orderId);
    const pending = o.items.filter((i) => i.status === 'PENDING');
    if (pending.length) throw ruleViolation('RESULTS_INCOMPLETE', `Results are missing for: ${pending.map((p) => p.test.name).join(', ')}`);
    await this.prisma.db.$transaction(async (tx) => {
      await tx.labResult.updateMany({ where: { item: { orderId }, status: 'PRELIMINARY' }, data: { status: 'FINAL' } });
      await tx.diagnosticOrder.update({ where: { id: orderId }, data: { status: 'RELEASED', releasedById: ctx.userId, releasedByName: ctx.userName, releasedAt: new Date() } });
      await this.audit.record({ action: 'lab_order.released', entityType: 'DiagnosticOrder', entityId: orderId, summary: labOrderNo(o.number) }, tx);
    });
    return this.get(orderId);
  }

  /** Corrects a released result: the original stays (SUPERSEDED) and a new FINAL row records the correction. */
  async amendResult(resultId: string, input: { valueNumeric?: number | null; valueText?: string | null; comment?: string | null; amendmentReason: string }) {
    const ctx = RequestContext.require();
    const r = await this.prisma.db.labResult.findUnique({ where: { id: resultId }, include: { analyte: true, item: { include: { order: { include: { patient: true } } } } } });
    if (!r) throw notFound('Result');
    if (r.status !== 'FINAL') throw ruleViolation('NOT_FINAL', r.status === 'SUPERSEDED' ? 'This result was already amended' : 'Preliminary results can be edited directly before release');
    if (r.analyte.resultType === 'NUMERIC' && (input.valueNumeric === null || input.valueNumeric === undefined)) throw ruleViolation('VALUE_REQUIRED', 'Enter the corrected value');
    const order = r.item.order;
    const id = await this.prisma.db.$transaction(async (tx) => {
      const interval = r.analyte.resultType === 'NUMERIC' ? await this.intervalFor(tx, r.analyteId, order.patient) : null;
      const flag = r.analyte.resultType === 'NUMERIC' ? flagValue(input.valueNumeric!, interval) : null;
      await tx.labResult.update({ where: { id: r.id }, data: { status: 'SUPERSEDED' } });
      const created = await tx.labResult.create({
        data: {
          organizationId: ctx.organizationId!,
          orderItemId: r.orderItemId,
          analyteId: r.analyteId,
          valueNumeric: r.analyte.resultType === 'NUMERIC' ? input.valueNumeric : null,
          valueText: input.valueText ?? null,
          unit: r.unit,
          refLow: interval?.low ?? null,
          refHigh: interval?.high ?? null,
          refSource: interval?.source ?? null,
          flag,
          status: 'FINAL',
          comment: input.comment,
          enteredById: ctx.userId!,
          enteredByName: ctx.userName ?? 'Unknown',
          supersedesId: r.id,
          amendmentReason: input.amendmentReason,
        },
      });
      if (flag === 'CRITICAL_LOW' || flag === 'CRITICAL_HIGH') await this.flagCritical(tx, order.id);
      await this.audit.record(
        {
          action: 'lab_result.amended',
          entityType: 'DiagnosticOrder',
          entityId: order.id,
          summary: `${r.analyte.name}: ${input.amendmentReason}`,
          changes: { [r.analyte.code]: { from: r.valueNumeric !== null ? String(r.valueNumeric) : r.valueText, to: input.valueNumeric ?? input.valueText } },
        },
        tx,
      );
      return created.id;
    });
    return { id, order: await this.get(order.id) };
  }

  async cancel(orderId: string, reason: string) {
    const o = await this.mutable(orderId);
    await this.prisma.db.$transaction(async (tx) => {
      await tx.diagnosticOrder.update({ where: { id: orderId }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason } });
      const pending = await tx.diagnosticOrderItem.findMany({ where: { orderId, status: 'PENDING' }, select: { id: true } });
      await tx.diagnosticOrderItem.updateMany({ where: { orderId, status: 'PENDING' }, data: { status: 'CANCELLED' } });
      for (const h of this.cancelledHooks) await h(tx, { orderId, itemIds: pending.map((i) => i.id) });
      await this.audit.record({ action: 'lab_order.cancelled', entityType: 'DiagnosticOrder', entityId: orderId, summary: `${labOrderNo(o.number)}: ${reason}` }, tx);
    });
    return this.get(orderId);
  }
}
