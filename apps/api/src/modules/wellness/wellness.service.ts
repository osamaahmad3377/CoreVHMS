import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma, type Charge, type WellnessEnrolment } from '@prisma/client';
import {
  addMonthsIso,
  dayBeforeIso,
  wellnessSchedule,
  type WellnessCancelInput,
  type WellnessEnrolInput,
  type WellnessMembersQuery,
  type WellnessPlanInput,
  type WellnessRenewInput,
  type WellnessUsageInput,
} from '@vcms/shared';
import { AuditService, diff } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { CounterService, formatNumber } from '../../common/counter/counter.service';
import { conflict, notFound, ruleViolation } from '../../common/http/errors';
import { pageArgs, paginated } from '../../common/http/pagination';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { ScopedTx } from '../../common/prisma/tenant-extension';
import { TenancyService } from '../../common/tenancy/tenancy.service';
import { resolveTimezone } from '../../common/time/branch-timezone';
import { localParts } from '../../common/time/tz';
import { ChargeCaptureService } from '../billing/charge-capture.service';
import { patientNo } from '../patients/patients.service';
import { benefitNote, computeBenefit } from './wellness-benefit';

export const enrolmentNo = (n: number) => formatNumber('WP', n);
export type WellnessState = 'ACTIVE' | 'UPCOMING' | 'EXPIRED' | 'CANCELLED';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const dateOnly = (s: string) => new Date(`${s}T00:00:00.000Z`);
const DAY = 86400_000;
/** How far back an enrolment can start (forgot to enrol at the visit) and how far ahead. */
const BACKDATE_DAYS = 31;
const AHEAD_DAYS = 92;
/** "Ending soon" on the members list and dashboard. */
const ENDING_DAYS = 30;

export function wellnessState(e: Pick<WellnessEnrolment, 'status' | 'startDate' | 'endDate'>, today: string): WellnessState {
  if (e.status === 'CANCELLED') return 'CANCELLED';
  if (iso(e.startDate) > today) return 'UPCOMING';
  if (iso(e.endDate) < today) return 'EXPIRED';
  return 'ACTIVE';
}

const planInclude = {
  species: { select: { id: true, name: true } },
  items: {
    orderBy: { sortOrder: 'asc' },
    include: {
      service: { select: { id: true, code: true, name: true, priceMinor: true, isActive: true } },
      product: { select: { id: true, name: true, sellPriceMinor: true, dispensingUnit: true, isActive: true } },
      labTest: { select: { id: true, code: true, name: true, priceMinor: true, isActive: true } },
    },
  },
} satisfies Prisma.WellnessPlanInclude;
type PlanRow = Prisma.WellnessPlanGetPayload<{ include: typeof planInclude }>;
type PlanItemRow = PlanRow['items'][number];

function itemLabel(i: Pick<PlanItemRow, 'service' | 'product' | 'labTest'>) {
  return i.service?.name ?? i.product?.name ?? i.labTest?.name ?? 'Item';
}
function itemValue(i: Pick<PlanItemRow, 'service' | 'product' | 'labTest'>) {
  return i.service?.priceMinor ?? i.product?.sellPriceMinor ?? i.labTest?.priceMinor ?? 0;
}

const enrolmentInclude = {
  patient: { select: { id: true, name: true, number: true, status: true, species: { select: { name: true } } } },
  client: { select: { id: true, displayName: true, number: true, mobilePhone: true, email: true } },
  plan: { select: { id: true, name: true, status: true, durationMonths: true, monthlyPriceMinor: true, priceMinor: true } },
  entitlements: { orderBy: { sortOrder: 'asc' } },
  instalments: { orderBy: { seq: 'asc' } },
  usages: { orderBy: { usedAt: 'desc' } },
  renewedTo: { select: { id: true, number: true, startDate: true, status: true } },
  renewedFrom: { select: { id: true, number: true, endDate: true } },
} satisfies Prisma.WellnessEnrolmentInclude;
type EnrolmentRow = Prisma.WellnessEnrolmentGetPayload<{ include: typeof enrolmentInclude }>;

/**
 * Wellness plans: care packages sold for a term (usually a year), paid up front or monthly. Each enrolment keeps a
 * copy of what was sold. Payments become unbilled charges on their due dates; included items and the member
 * discount are taken off the patient's charges automatically as they are captured (ChargeCaptureService hook).
 */
@Injectable()
export class WellnessService {
  private readonly log = new Logger(WellnessService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly counters: CounterService,
    private readonly charges: ChargeCaptureService,
    private readonly tenancy: TenancyService,
  ) {}

  private async today(branchId?: string | null) {
    return localParts(new Date(), await resolveTimezone(this.prisma, branchId)).date;
  }

  // ── Plans ──

  private shapePlan(p: PlanRow, activeMembers = 0) {
    const valueMinor = p.items.reduce((n, i) => n + itemValue(i) * i.quantity, 0);
    return {
      ...p,
      activeMembers,
      /** What the included items cost at today's prices: the saving shown to clients. */
      includedValueMinor: valueMinor,
      items: p.items.map((i) => ({ ...i, label: itemLabel(i), unitValueMinor: itemValue(i), unavailable: !(i.service?.isActive ?? i.product?.isActive ?? i.labTest?.isActive ?? true) })),
    };
  }

  async listPlans(all = false) {
    const plans = await this.prisma.db.wellnessPlan.findMany({ where: all ? {} : { status: 'ACTIVE' }, include: planInclude, orderBy: [{ status: 'asc' }, { name: 'asc' }] });
    const today = await this.today();
    const counts = await this.prisma.db.wellnessEnrolment.groupBy({
      by: ['planId'],
      where: { status: 'ACTIVE', startDate: { lte: dateOnly(today) }, endDate: { gte: dateOnly(today) } },
      _count: { _all: true },
    });
    return plans.map((p) => this.shapePlan(p, counts.find((c) => c.planId === p.id)?._count._all ?? 0));
  }

  async getPlan(id: string) {
    const p = await this.prisma.db.wellnessPlan.findUnique({ where: { id }, include: planInclude });
    if (!p) throw notFound('Wellness plan');
    return this.shapePlan(p);
  }

  private async checkPlanRefs(input: WellnessPlanInput) {
    const db = this.prisma.db;
    if (input.speciesId && !(await db.species.findUnique({ where: { id: input.speciesId } }))) throw ruleViolation('INVALID_SPECIES', 'Species not found');
    if (input.taxRateId && !(await db.taxRate.findUnique({ where: { id: input.taxRateId } }))) throw ruleViolation('INVALID_TAX', 'Tax rate not found');
    for (const i of input.items) {
      if (i.kind === 'SERVICE') {
        const s = await db.service.findUnique({ where: { id: i.serviceId! } });
        if (!s || !s.isActive) throw ruleViolation('INVALID_ITEM', 'A service in the plan was not found or is switched off');
      } else if (i.kind === 'PRODUCT') {
        const p = await db.product.findUnique({ where: { id: i.productId! } });
        if (!p || !p.isActive) throw ruleViolation('INVALID_ITEM', 'A product in the plan was not found or is switched off');
      } else {
        const t = await db.labTest.findUnique({ where: { id: i.labTestId! } });
        if (!t || !t.isActive) throw ruleViolation('INVALID_ITEM', 'A lab test in the plan was not found or is switched off');
      }
    }
  }

  async savePlan(id: string | null, input: WellnessPlanInput) {
    await this.checkPlanRefs(input);
    const before = id ? await this.prisma.db.wellnessPlan.findUnique({ where: { id }, include: { items: true } }) : null;
    if (id && !before) throw notFound('Wellness plan');
    const data = {
      name: input.name,
      description: input.description ?? null,
      speciesId: input.speciesId ?? null,
      durationMonths: input.durationMonths,
      priceMinor: input.priceMinor,
      monthlyPriceMinor: input.monthlyPriceMinor ?? null,
      joiningFeeMinor: input.joiningFeeMinor,
      taxRateId: input.taxRateId ?? null,
      serviceDiscountBp: input.serviceDiscountBp,
      productDiscountBp: input.productDiscountBp,
      terms: input.terms ?? null,
    };
    try {
      const saved = await this.prisma.db.$transaction(async (tx) => {
        const plan = id
          ? await tx.wellnessPlan.update({ where: { id }, data })
          : await tx.wellnessPlan.create({ data: { ...data, organizationId: RequestContext.orgId(), createdByName: RequestContext.get()?.userName ?? null } });
        await tx.wellnessPlanItem.deleteMany({ where: { planId: plan.id } });
        if (input.items.length) {
          await tx.wellnessPlanItem.createMany({
            data: input.items.map((i, n) => ({
              organizationId: RequestContext.orgId(),
              planId: plan.id,
              kind: i.kind,
              serviceId: i.kind === 'SERVICE' ? i.serviceId : null,
              productId: i.kind === 'PRODUCT' ? i.productId : null,
              labTestId: i.kind === 'LAB' ? i.labTestId : null,
              quantity: i.quantity,
              sortOrder: n,
            })),
          });
        }
        await this.audit.record(
          {
            action: id ? 'wellness.plan_updated' : 'wellness.plan_created',
            entityType: 'WellnessPlan',
            entityId: plan.id,
            summary: `${plan.name}: ${input.items.length} included item(s)`,
            changes: before ? diff(before, plan, Object.keys(data)) : null,
          },
          tx,
        );
        return plan;
      });
      return this.getPlan(saved.id);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw conflict('There is already a plan with this name');
      throw e;
    }
  }

  async setPlanStatus(id: string, status: 'ACTIVE' | 'RETIRED') {
    const p = await this.prisma.db.wellnessPlan.findUnique({ where: { id } });
    if (!p) throw notFound('Wellness plan');
    await this.prisma.db.$transaction(async (tx) => {
      await tx.wellnessPlan.update({ where: { id }, data: { status } });
      await this.audit.record({ action: status === 'RETIRED' ? 'wellness.plan_retired' : 'wellness.plan_reactivated', entityType: 'WellnessPlan', entityId: id, summary: p.name }, tx);
    });
    return this.getPlan(id);
  }

  // ── Enrolment ──

  /** Creates an enrolment (new or renewal) with its benefits and payment schedule, and bills what is due today. */
  private async createEnrolment(
    tx: ScopedTx,
    o: { plan: PlanRow; patientId: string; clientId: string; branchId: string; startDate: string; billing: 'UPFRONT' | 'MONTHLY'; autoRenew: boolean; notes?: string | null; renewedFromId?: string | null },
    today: string,
  ) {
    const p = o.plan;
    if (o.billing === 'MONTHLY' && p.monthlyPriceMinor == null) throw ruleViolation('NO_MONTHLY', `${p.name} is paid up front only`);
    const endDate = dayBeforeIso(addMonthsIso(o.startDate, p.durationMonths));
    const schedule = wellnessSchedule({ startDate: o.startDate, months: p.durationMonths, billing: o.billing, priceMinor: p.priceMinor, monthlyPriceMinor: p.monthlyPriceMinor, joiningFeeMinor: o.renewedFromId ? 0 : p.joiningFeeMinor });
    const tax = await this.charges.taxFor(tx, p.taxRateId);
    const number = await this.counters.next(tx, 'wellness');
    const e = await tx.wellnessEnrolment.create({
      data: {
        organizationId: RequestContext.orgId(),
        number,
        planId: p.id,
        patientId: o.patientId,
        clientId: o.clientId,
        branchId: o.branchId,
        planName: p.name,
        startDate: dateOnly(o.startDate),
        endDate: dateOnly(endDate),
        billing: o.billing,
        totalMinor: schedule.reduce((n, s) => n + s.amountMinor, 0),
        joiningFeeMinor: o.renewedFromId ? 0 : p.joiningFeeMinor,
        taxRateBasisPoints: tax,
        serviceDiscountBp: p.serviceDiscountBp,
        productDiscountBp: p.productDiscountBp,
        terms: p.terms,
        notes: o.notes ?? null,
        autoRenew: o.autoRenew,
        renewedFromId: o.renewedFromId ?? null,
        createdByName: RequestContext.get()?.userName ?? null,
      },
    });
    if (p.items.length) {
      await tx.wellnessEntitlement.createMany({
        data: p.items.map((i, n) => ({
          organizationId: RequestContext.orgId(),
          enrolmentId: e.id,
          kind: i.kind,
          serviceId: i.serviceId,
          productId: i.productId,
          labTestId: i.labTestId,
          label: itemLabel(i),
          quantity: i.quantity,
          unitValueMinor: itemValue(i),
          sortOrder: n,
        })),
      });
    }
    await tx.wellnessInstalment.createMany({ data: schedule.map((s) => ({ organizationId: RequestContext.orgId(), enrolmentId: e.id, seq: s.seq, dueDate: dateOnly(s.dueDate), amountMinor: s.amountMinor })) });
    await this.billDueTx(tx, e.id, today);
    return e;
  }

  private overlapError(e: unknown, patientName: string) {
    const msg = (e as Error)?.message ?? '';
    if (msg.includes('WellnessEnrolment_no_overlap') || (e as any)?.meta?.code === '23P01') {
      return ruleViolation('ALREADY_ENROLLED', `${patientName} is already on a wellness plan for some of these dates`);
    }
    return e;
  }

  private async activePatient(patientId: string) {
    const patient = await this.prisma.db.patient.findUnique({ where: { id: patientId }, include: { species: true } });
    if (!patient) throw notFound('Patient');
    if (patient.status !== 'ACTIVE') throw ruleViolation('PATIENT_INACTIVE', `${patient.name} is ${patient.status.toLowerCase()} and can’t be enrolled`);
    const owner = await this.prisma.db.patientOwnership.findFirst({ where: { patientId, endedAt: null, isPrimary: true } });
    if (!owner) throw ruleViolation('NO_OWNER', `${patient.name} has no current owner to bill`);
    return { patient, clientId: owner.clientId };
  }

  private async activePlan(planId: string, speciesId: string) {
    const plan = await this.prisma.db.wellnessPlan.findUnique({ where: { id: planId }, include: planInclude });
    if (!plan) throw notFound('Wellness plan');
    if (plan.status !== 'ACTIVE') throw ruleViolation('PLAN_RETIRED', `${plan.name} is no longer offered`);
    if (plan.speciesId && plan.speciesId !== speciesId) throw ruleViolation('WRONG_SPECIES', `${plan.name} is for ${plan.species?.name ?? 'another species'} only`);
    return plan;
  }

  async enrol(input: WellnessEnrolInput) {
    const ctx = RequestContext.require();
    const { patient, clientId } = await this.activePatient(input.patientId);
    const plan = await this.activePlan(input.planId, patient.speciesId);
    const branchId = ctx.branchId ?? patient.primaryBranchId;
    if (!branchId) throw ruleViolation('BRANCH_REQUIRED', 'Choose a branch first');
    const today = await this.today(branchId);
    const startDate = input.startDate ?? today;
    const offset = (Date.parse(startDate) - Date.parse(today)) / DAY;
    if (offset < -BACKDATE_DAYS) throw ruleViolation('START_TOO_EARLY', `A plan can start at most ${BACKDATE_DAYS} days ago`);
    if (offset > AHEAD_DAYS) throw ruleViolation('START_TOO_LATE', `A plan can start at most ${AHEAD_DAYS} days ahead`);
    const clash = await this.prisma.db.wellnessEnrolment.findFirst({ where: { patientId: patient.id, status: 'ACTIVE', startDate: { lte: dateOnly(dayBeforeIso(addMonthsIso(startDate, plan.durationMonths))) }, endDate: { gte: dateOnly(startDate) } } });
    if (clash) throw ruleViolation('ALREADY_ENROLLED', `${patient.name} is already on ${clash.planName} until ${iso(clash.endDate)}. Renew or cancel that plan instead.`);
    let id: string;
    try {
      id = await this.prisma.db.$transaction(async (tx) => {
        const e = await this.createEnrolment(tx, { plan, patientId: patient.id, clientId, branchId, startDate, billing: input.billing, autoRenew: input.autoRenew, notes: input.notes }, today);
        // Unbilled work since the plan started gets the benefits too (e.g. the consultation where it was sold).
        await this.applyToPendingTx(tx, e.id);
        await this.audit.record({ action: 'wellness.enrolled', entityType: 'Patient', entityId: patient.id, summary: `${enrolmentNo(e.number)} ${plan.name}, ${input.billing === 'MONTHLY' ? 'paid monthly' : 'paid up front'}, from ${startDate}` }, tx);
        return e.id;
      });
    } catch (e) {
      throw this.overlapError(e, patient.name);
    }
    return this.detail(id);
  }

  async renew(id: string, input: WellnessRenewInput) {
    const e = await this.prisma.db.wellnessEnrolment.findUnique({ where: { id }, include: { renewedTo: true } });
    if (!e) throw notFound('Wellness plan membership');
    if (e.status === 'CANCELLED') throw ruleViolation('CANCELLED', 'A cancelled plan can’t be renewed — enrol the patient again instead');
    if (e.renewedTo) throw ruleViolation('ALREADY_RENEWED', `Already renewed (${enrolmentNo(e.renewedTo.number)})`);
    const { patient, clientId } = await this.activePatient(e.patientId);
    const plan = await this.activePlan(input.planId ?? e.planId, patient.speciesId);
    const today = await this.today(e.branchId);
    // Renewing late (after a gap of more than the back-dating allowance) starts today rather than in the past.
    const next = iso(new Date(e.endDate.getTime() + DAY));
    const startDate = (Date.parse(today) - Date.parse(next)) / DAY > BACKDATE_DAYS ? today : next;
    let newId: string;
    try {
      newId = await this.prisma.db.$transaction(async (tx) => {
        const r = await this.createEnrolment(tx, { plan, patientId: patient.id, clientId, branchId: e.branchId, startDate, billing: input.billing ?? e.billing, autoRenew: input.autoRenew ?? e.autoRenew, renewedFromId: e.id }, today);
        await this.audit.record({ action: 'wellness.renewed', entityType: 'Patient', entityId: patient.id, summary: `${enrolmentNo(e.number)} renewed as ${enrolmentNo(r.number)} (${plan.name}) from ${startDate}` }, tx);
        return r.id;
      });
    } catch (err) {
      throw this.overlapError(err, patient.name);
    }
    return this.detail(newId);
  }

  async setAutoRenew(id: string, autoRenew: boolean) {
    const e = await this.prisma.db.wellnessEnrolment.findUnique({ where: { id } });
    if (!e) throw notFound('Wellness plan membership');
    if (e.status === 'CANCELLED') throw ruleViolation('CANCELLED', 'This plan was cancelled');
    await this.prisma.db.$transaction(async (tx) => {
      await tx.wellnessEnrolment.update({ where: { id }, data: { autoRenew } });
      await this.audit.record({ action: autoRenew ? 'wellness.auto_renew_on' : 'wellness.auto_renew_off', entityType: 'Patient', entityId: e.patientId, summary: enrolmentNo(e.number) }, tx);
    });
    return this.detail(id);
  }

  /** What cancelling now would leave: billed so far, the value of benefits used, and any shortfall. */
  async settlement(id: string) {
    const e = await this.prisma.db.wellnessEnrolment.findUnique({ where: { id }, include: { instalments: true, usages: true } });
    if (!e) throw notFound('Wellness plan membership');
    return this.settlementOf(e, await this.instalmentCharges(e.instalments.map((i) => i.id)));
  }

  private async instalmentCharges(instalmentIds: string[], tx: ScopedTx | PrismaService['db'] = this.prisma.db) {
    if (!instalmentIds.length) return [];
    return tx.charge.findMany({
      where: { sourceType: 'WellnessInstalment', sourceId: { in: instalmentIds } },
      include: { invoiceLine: { select: { invoice: { select: { id: true, number: true, status: true, balanceMinor: true } } } } },
    });
  }

  private settlementOf(e: { instalments: { id: string; status: string; amountMinor: number }[]; usages: { reversedAt: Date | null; savedMinor: number }[] }, charges: { sourceId: string; status: string }[]) {
    const chargeOf = (instId: string) => charges.find((c) => c.sourceId === instId);
    const invoiced = e.instalments.filter((i) => i.status === 'BILLED' && chargeOf(i.id)?.status === 'INVOICED');
    const notInvoiced = e.instalments.filter((i) => i.status === 'BILLED' && chargeOf(i.id)?.status === 'PENDING');
    const billedMinor = invoiced.reduce((n, i) => n + i.amountMinor, 0);
    const usedValueMinor = e.usages.filter((u) => !u.reversedAt).reduce((n, u) => n + u.savedMinor, 0);
    return {
      /** Payments already on an invoice. */
      billedMinor,
      /** Payments charged but not invoiced yet (waived on cancelling). */
      unbilledChargesMinor: notInvoiced.reduce((n, i) => n + i.amountMinor, 0),
      /** Payments not due yet (cancelled on cancelling). */
      scheduledMinor: e.instalments.filter((i) => i.status === 'SCHEDULED').reduce((n, i) => n + i.amountMinor, 0),
      usedValueMinor,
      /** Benefits used beyond what was invoiced: can be charged on cancelling. */
      shortfallMinor: Math.max(0, usedValueMinor - billedMinor),
      /** Invoiced beyond the benefits used: what could be refunded (a credit note on the plan invoice). */
      unusedMinor: Math.max(0, billedMinor - usedValueMinor),
    };
  }

  async cancel(id: string, input: WellnessCancelInput) {
    const e = await this.prisma.db.wellnessEnrolment.findUnique({ where: { id }, include: { instalments: true, usages: true } });
    if (!e) throw notFound('Wellness plan membership');
    if (e.status === 'CANCELLED') throw ruleViolation('CANCELLED', 'This plan is already cancelled');
    const ctx = RequestContext.require();
    await this.prisma.db.$transaction(async (tx) => {
      const ids = e.instalments.map((i) => i.id);
      // Payments not invoiced yet are dropped: scheduled ones cancelled, charged-but-unbilled ones waived.
      const pending = (await this.instalmentCharges(ids, tx)).filter((c) => c.status === 'PENDING');
      await this.charges.waiveForSource(tx, 'WellnessInstalment', pending.map((c) => c.sourceId), `Wellness plan ${enrolmentNo(e.number)} cancelled`);
      await tx.wellnessInstalment.updateMany({ where: { enrolmentId: id, OR: [{ status: 'SCHEDULED' }, { id: { in: pending.map((c) => c.sourceId) } }] }, data: { status: 'CANCELLED' } });
      const after = await tx.wellnessEnrolment.findUniqueOrThrow({ where: { id }, include: { instalments: true, usages: true } });
      const s = this.settlementOf(after, await this.instalmentCharges(ids, tx));
      if (input.chargeShortfall && s.shortfallMinor > 0) {
        await this.charges.capture(tx, {
          sourceType: 'WellnessCancellation',
          sourceId: id,
          clientId: e.clientId,
          patientId: e.patientId,
          branchId: e.branchId,
          kind: 'CUSTOM',
          description: `${e.planName} wellness plan cancelled — benefits used beyond payments (${enrolmentNo(e.number)})`,
          quantity: 1,
          unitPriceMinor: s.shortfallMinor,
          taxRateBasisPoints: e.taxRateBasisPoints,
        });
      }
      await tx.wellnessEnrolment.update({ where: { id }, data: { status: 'CANCELLED', autoRenew: false, cancelledAt: new Date(), cancelReason: input.reason, cancelledByName: ctx.userName ?? null } });
      await this.audit.record(
        {
          action: 'wellness.cancelled',
          entityType: 'Patient',
          entityId: e.patientId,
          summary: `${enrolmentNo(e.number)} ${e.planName}: ${input.reason}${input.chargeShortfall && s.shortfallMinor > 0 ? ` (shortfall ${s.shortfallMinor} charged)` : ''}`,
        },
        tx,
      );
    });
    return this.detail(id);
  }

  // ── Payments ──

  /** Turns the enrolment's payments due by `today` into unbilled charges (idempotent: one charge per payment). */
  private async billDueTx(tx: ScopedTx, enrolmentId: string, today: string) {
    const e = await tx.wellnessEnrolment.findUniqueOrThrow({ where: { id: enrolmentId }, include: { instalments: { where: { status: 'SCHEDULED', dueDate: { lte: dateOnly(today) } }, orderBy: { seq: 'asc' } }, _count: { select: { instalments: true } } } });
    if (e.status !== 'ACTIVE') return 0;
    const period = `${iso(e.startDate)} to ${iso(e.endDate)}`;
    for (const i of e.instalments) {
      const what = e.billing === 'UPFRONT' ? `${period}` : `payment ${i.seq} of ${e._count.instalments}`;
      await this.charges.capture(tx, {
        sourceType: 'WellnessInstalment',
        sourceId: i.id,
        clientId: e.clientId,
        patientId: e.patientId,
        branchId: e.branchId,
        kind: 'CUSTOM',
        description: `${e.planName} wellness plan — ${what}${i.seq === 1 && e.joiningFeeMinor > 0 ? ', including joining fee' : ''} (${enrolmentNo(e.number)})`,
        quantity: 1,
        unitPriceMinor: i.amountMinor,
        taxRateBasisPoints: e.taxRateBasisPoints,
      });
      await tx.wellnessInstalment.update({ where: { id: i.id }, data: { status: 'BILLED', billedAt: new Date() } });
    }
    return e.instalments.length;
  }

  /** Bills every payment that has fallen due for this clinic. Run hourly and from "Bill payments due". */
  async billDue() {
    const due = await this.prisma.db.wellnessInstalment.findMany({
      where: { status: 'SCHEDULED', dueDate: { lte: dateOnly(await this.today()) }, enrolment: { status: 'ACTIVE' } },
      select: { enrolmentId: true, enrolment: { select: { branchId: true } } },
      distinct: ['enrolmentId'],
    });
    let billed = 0;
    for (const d of due) {
      const today = await this.today(d.enrolment.branchId);
      billed += await this.prisma.db.$transaction((tx) => this.billDueTx(tx, d.enrolmentId, today));
    }
    return { billed };
  }

  /** Renews memberships set to renew automatically once they have ended. */
  async autoRenewDue() {
    const today = await this.today();
    const ended = await this.prisma.db.wellnessEnrolment.findMany({ where: { status: 'ACTIVE', autoRenew: true, endDate: { lt: dateOnly(today) }, renewedTo: null } });
    let renewed = 0;
    for (const e of ended) {
      try {
        await this.renew(e.id, {});
        renewed += 1;
      } catch (err) {
        // A retired plan, an archived patient or a clash: leave it on the "ended" list for staff to decide.
        this.log.warn(`Auto-renew skipped for ${enrolmentNo(e.number)}: ${(err as Error).message}`);
      }
    }
    return { renewed };
  }

  @Cron(CronExpression.EVERY_HOUR)
  async hourly() {
    if (process.env.NODE_ENV === 'test') return;
    await this.tenancy.forEachDatabase('Wellness billing', async () => {
      const orgs = await this.prisma.raw.organization.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
      for (const o of orgs) {
        try {
          await RequestContext.runAs({ organizationId: o.id, userName: 'System' }, async () => {
            await this.autoRenewDue();
            await this.billDue();
          });
        } catch (e) {
          this.log.error(`Wellness billing failed for ${o.id}: ${(e as Error).message}`);
        }
      }
    });
  }

  // ── Benefits ──

  private async usedOf(tx: ScopedTx | PrismaService['db'], entitlementIds: string[]) {
    if (!entitlementIds.length) return new Map<string, number>();
    const rows = await tx.wellnessUsage.groupBy({ by: ['entitlementId'], where: { entitlementId: { in: entitlementIds }, reversedAt: null }, _sum: { quantity: true } });
    return new Map(rows.map((r) => [r.entitlementId!, r._sum.quantity ?? 0]));
  }

  /**
   * Applies the patient's plan to a new unbilled charge: included items covered while any are left, then the member
   * discount. Runs inside the capture transaction (ChargeCaptureService hook), so the charge is never billed without it.
   */
  async applyToCharge(tx: ScopedTx, charge: Charge, enrolmentId?: string) {
    if (!charge.patientId || charge.status !== 'PENDING' || charge.kind === 'CUSTOM' || charge.discountMinor > 0) return null;
    // Runs for every charge in the clinic: stop at one indexed query when the patient has no plan.
    if (!(await tx.wellnessEnrolment.count({ where: { patientId: charge.patientId, status: 'ACTIVE', ...(enrolmentId ? { id: enrolmentId } : {}) } }))) return null;
    if (await tx.wellnessUsage.findFirst({ where: { chargeId: charge.id, reversedAt: null } })) return null;
    const branch = await tx.branch.findUnique({ where: { id: charge.branchId }, select: { timezone: true } });
    const day = dateOnly(localParts(charge.createdAt, branch?.timezone ?? 'UTC').date);
    const e = await tx.wellnessEnrolment.findFirst({
      where: { ...(enrolmentId ? { id: enrolmentId } : {}), patientId: charge.patientId, status: 'ACTIVE', startDate: { lte: day }, endDate: { gte: day } },
      include: { entitlements: true },
    });
    if (!e) return null;
    const target = charge.kind === 'SERVICE' ? charge.serviceId : charge.kind === 'PRODUCT' ? charge.productId : charge.labTestId;
    const ent = target ? e.entitlements.find((x) => x.kind === charge.kind && (x.serviceId ?? x.productId ?? x.labTestId) === target) : undefined;
    const discountBp = charge.kind === 'PRODUCT' ? e.productDiscountBp : e.serviceDiscountBp;
    if (!ent && !discountBp) return null;
    let used = 0;
    if (ent) {
      // Two charges captured at once must not both use the last included item.
      await tx.$queryRaw`SELECT "id" FROM "WellnessEntitlement" WHERE "id" = ${ent.id}::uuid FOR UPDATE`;
      used = (await this.usedOf(tx, [ent.id])).get(ent.id) ?? 0;
    }
    const b = computeBenefit({ quantity: Number(charge.quantity), unitPriceMinor: charge.unitPriceMinor, remaining: ent ? ent.quantity - used : null, discountBp });
    if (b.discountMinor <= 0) return null;
    const note = benefitNote(e.planName, b, used + b.usedUnits, ent?.quantity ?? 0, discountBp);
    await tx.charge.update({ where: { id: charge.id }, data: { discountMinor: b.discountMinor, discountNote: note } });
    const usage = await tx.wellnessUsage.create({
      data: {
        organizationId: RequestContext.orgId(),
        enrolmentId: e.id,
        entitlementId: b.usedUnits > 0 ? ent!.id : null,
        chargeId: charge.id,
        kind: b.usedUnits > 0 ? 'INCLUDED' : 'DISCOUNT',
        description: charge.description,
        quantity: b.usedUnits,
        savedMinor: b.discountMinor,
        recordedByName: RequestContext.get()?.userName ?? null,
      },
    });
    await this.audit.record({ action: 'wellness.benefit_applied', entityType: 'Patient', entityId: e.patientId, summary: `${charge.description}: ${note}` }, tx);
    return usage;
  }

  /** Gives benefits back when their unbilled charges are waived (ChargeCaptureService hook). */
  async releaseForCharges(tx: ScopedTx, chargeIds: string[], reason: string) {
    const usages = await tx.wellnessUsage.findMany({ where: { chargeId: { in: chargeIds }, reversedAt: null } });
    for (const u of usages) {
      await tx.wellnessUsage.update({ where: { id: u.id }, data: { reversedAt: new Date(), reversedReason: `Charge waived: ${reason}`.slice(0, 300), reversedByName: RequestContext.get()?.userName ?? null } });
      await tx.charge.update({ where: { id: u.chargeId! }, data: { discountMinor: 0, discountNote: null } });
    }
  }

  private async applyToPendingTx(tx: ScopedTx, enrolmentId: string) {
    const e = await tx.wellnessEnrolment.findUniqueOrThrow({ where: { id: enrolmentId } });
    // The plan's first day in UTC minus a day covers every timezone; applyToCharge checks the branch-local date.
    const charges = await tx.charge.findMany({ where: { patientId: e.patientId, status: 'PENDING', discountMinor: 0, kind: { not: 'CUSTOM' }, createdAt: { gte: new Date(e.startDate.getTime() - DAY) } }, orderBy: { createdAt: 'asc' } });
    let applied = 0;
    for (const c of charges) if (await this.applyToCharge(tx, c, e.id)) applied += 1;
    return applied;
  }

  /** "Apply to unbilled items": benefits for the patient's unbilled charges since the plan started. */
  async applyToPending(id: string) {
    const e = await this.prisma.db.wellnessEnrolment.findUnique({ where: { id } });
    if (!e) throw notFound('Wellness plan membership');
    if (e.status !== 'ACTIVE') throw ruleViolation('CANCELLED', 'This plan was cancelled');
    const applied = await this.prisma.db.$transaction((tx) => this.applyToPendingTx(tx, id));
    return { applied };
  }

  async recordUsage(id: string, input: WellnessUsageInput) {
    const e = await this.prisma.db.wellnessEnrolment.findUnique({ where: { id }, include: { entitlements: true } });
    if (!e) throw notFound('Wellness plan membership');
    const today = await this.today(e.branchId);
    const state = wellnessState(e, today);
    if (state !== 'ACTIVE') throw ruleViolation('NOT_ACTIVE', state === 'UPCOMING' ? 'This plan hasn’t started yet' : state === 'EXPIRED' ? 'This plan has ended' : 'This plan was cancelled');
    const ent = e.entitlements.find((x) => x.id === input.entitlementId);
    if (!ent) throw ruleViolation('INVALID_ITEM', 'That item is not part of this plan');
    await this.prisma.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "WellnessEntitlement" WHERE "id" = ${ent.id}::uuid FOR UPDATE`;
      const used = (await this.usedOf(tx, [ent.id])).get(ent.id) ?? 0;
      if (used + input.quantity > ent.quantity) throw ruleViolation('NOTHING_LEFT', `Only ${Math.max(0, ent.quantity - used)} ${ent.label} left on this plan`);
      await tx.wellnessUsage.create({
        data: {
          organizationId: RequestContext.orgId(),
          enrolmentId: id,
          entitlementId: ent.id,
          kind: 'MANUAL',
          description: ent.label,
          quantity: input.quantity,
          savedMinor: ent.unitValueMinor * input.quantity,
          note: input.note,
          recordedByName: RequestContext.get()?.userName ?? null,
        },
      });
      await this.audit.record({ action: 'wellness.usage_recorded', entityType: 'Patient', entityId: e.patientId, summary: `${input.quantity} × ${ent.label}: ${input.note}` }, tx);
    });
    return this.detail(id);
  }

  async reverseUsage(usageId: string, reason: string) {
    const u = await this.prisma.db.wellnessUsage.findUnique({ where: { id: usageId }, include: { charge: true, enrolment: true } });
    if (!u) throw notFound('Benefit');
    if (u.reversedAt) throw ruleViolation('ALREADY_REVERSED', 'This benefit was already given back');
    if (u.charge && u.charge.status === 'INVOICED') throw ruleViolation('ALREADY_INVOICED', 'This benefit is on an invoice. Remove the item from the draft invoice, or void the invoice, first.');
    await this.prisma.db.$transaction(async (tx) => {
      await tx.wellnessUsage.update({ where: { id: usageId }, data: { reversedAt: new Date(), reversedReason: reason, reversedByName: RequestContext.get()?.userName ?? null } });
      if (u.charge && u.charge.status === 'PENDING') await tx.charge.update({ where: { id: u.charge.id }, data: { discountMinor: 0, discountNote: null } });
      await this.audit.record({ action: 'wellness.usage_reversed', entityType: 'Patient', entityId: u.enrolment.patientId, summary: `${u.description}: ${reason}` }, tx);
    });
    return this.detail(u.enrolmentId);
  }

  // ── Reading ──

  private async shape(e: EnrolmentRow, today: string) {
    const [used, charges] = await Promise.all([this.usedOf(this.prisma.db, e.entitlements.map((x) => x.id)), this.instalmentCharges(e.instalments.map((i) => i.id))]);
    const chargeOf = (id: string) => charges.find((c) => c.sourceId === id);
    const state = wellnessState(e, today);
    const instalments = e.instalments.map((i) => {
      const c = chargeOf(i.id);
      const inv = c?.invoiceLine?.invoice;
      return {
        id: i.id,
        seq: i.seq,
        dueDate: iso(i.dueDate),
        amountMinor: i.amountMinor,
        status: i.status,
        billedAt: i.billedAt,
        chargeStatus: c?.status ?? null,
        invoice: inv ? { id: inv.id, invoiceNo: inv.number ? formatNumber('INV', inv.number) : 'Draft', status: inv.status, balanceMinor: inv.balanceMinor } : null,
      };
    });
    const next = instalments.find((i) => i.status === 'SCHEDULED');
    const savedMinor = e.usages.filter((u) => !u.reversedAt).reduce((n, u) => n + u.savedMinor, 0);
    return {
      id: e.id,
      number: e.number,
      enrolmentNo: enrolmentNo(e.number),
      planId: e.planId,
      planName: e.planName,
      plan: e.plan,
      patient: { ...e.patient, patientNo: patientNo(e.patient.number) },
      client: e.client,
      branchId: e.branchId,
      startDate: iso(e.startDate),
      endDate: iso(e.endDate),
      state,
      status: e.status,
      daysLeft: state === 'ACTIVE' ? Math.round((Date.parse(iso(e.endDate)) - Date.parse(today)) / DAY) : null,
      billing: e.billing,
      totalMinor: e.totalMinor,
      joiningFeeMinor: e.joiningFeeMinor,
      serviceDiscountBp: e.serviceDiscountBp,
      productDiscountBp: e.productDiscountBp,
      terms: e.terms,
      notes: e.notes,
      autoRenew: e.autoRenew,
      cancelledAt: e.cancelledAt,
      cancelReason: e.cancelReason,
      cancelledByName: e.cancelledByName,
      createdByName: e.createdByName,
      createdAt: e.createdAt,
      renewedTo: e.renewedTo ? { ...e.renewedTo, enrolmentNo: enrolmentNo(e.renewedTo.number), startDate: iso(e.renewedTo.startDate) } : null,
      renewedFrom: e.renewedFrom ? { ...e.renewedFrom, enrolmentNo: enrolmentNo(e.renewedFrom.number), endDate: iso(e.renewedFrom.endDate) } : null,
      entitlements: e.entitlements.map((x) => ({ ...x, used: used.get(x.id) ?? 0, remaining: Math.max(0, x.quantity - (used.get(x.id) ?? 0)) })),
      instalments,
      nextPayment: next ? { dueDate: next.dueDate, amountMinor: next.amountMinor } : null,
      paidInFullMinor: instalments.filter((i) => i.invoice?.status === 'PAID').reduce((n, i) => n + i.amountMinor, 0),
      usages: e.usages,
      savedMinor,
      includedValueMinor: e.entitlements.reduce((n, x) => n + x.unitValueMinor * x.quantity, 0),
    };
  }

  async detail(id: string) {
    const e = await this.prisma.db.wellnessEnrolment.findUnique({ where: { id }, include: enrolmentInclude });
    if (!e) throw notFound('Wellness plan membership');
    return this.shape(e, await this.today(e.branchId));
  }

  /** The patient's current (and next) plan, past plans, and the plans that can be offered. */
  async forPatient(patientId: string) {
    const patient = await this.prisma.db.patient.findUnique({ where: { id: patientId } });
    if (!patient) throw notFound('Patient');
    const today = await this.today();
    const rows = await this.prisma.db.wellnessEnrolment.findMany({ where: { patientId }, include: enrolmentInclude, orderBy: { startDate: 'desc' } });
    const shaped = await Promise.all(rows.map((r) => this.shape(r, today)));
    const plans = await this.prisma.db.wellnessPlan.findMany({ where: { status: 'ACTIVE', OR: [{ speciesId: null }, { speciesId: patient.speciesId }] }, include: planInclude, orderBy: { name: 'asc' } });
    return {
      today,
      current: shaped.find((s) => s.state === 'ACTIVE') ?? null,
      upcoming: shaped.find((s) => s.state === 'UPCOMING') ?? null,
      history: shaped.filter((s) => s.state === 'EXPIRED' || s.state === 'CANCELLED'),
      availablePlans: plans.map((p) => this.shapePlan(p)),
    };
  }

  async members(q: WellnessMembersQuery) {
    const today = dateOnly(await this.today());
    const soon = new Date(today.getTime() + ENDING_DAYS * DAY);
    const byState: Record<WellnessMembersQuery['status'], Prisma.WellnessEnrolmentWhereInput> = {
      ACTIVE: { status: 'ACTIVE', startDate: { lte: today }, endDate: { gte: today } },
      ENDING: { status: 'ACTIVE', startDate: { lte: today }, endDate: { gte: today, lte: soon }, renewedTo: null },
      UPCOMING: { status: 'ACTIVE', startDate: { gt: today } },
      EXPIRED: { status: 'ACTIVE', endDate: { lt: today } },
      CANCELLED: { status: 'CANCELLED' },
      ALL: {},
    };
    const term = q.q?.trim();
    const num = term && /^(wp-?)?\d+$/i.test(term) ? Number(term.replace(/\D/g, '')) : null;
    const where: Prisma.WellnessEnrolmentWhereInput = {
      ...byState[q.status],
      planId: q.planId,
      ...(term
        ? { OR: [{ patient: { name: { contains: term, mode: 'insensitive' } } }, { client: { displayName: { contains: term, mode: 'insensitive' } } }, ...(num ? [{ number: num }] : [])] }
        : {}),
    };
    const order: Prisma.WellnessEnrolmentOrderByWithRelationInput[] = q.status === 'ENDING' || q.status === 'ACTIVE' ? [{ endDate: 'asc' }] : q.status === 'UPCOMING' ? [{ startDate: 'asc' }] : [{ createdAt: 'desc' }];
    const [rows, total] = await Promise.all([
      this.prisma.db.wellnessEnrolment.findMany({ where, include: enrolmentInclude, orderBy: order, ...pageArgs(q) }),
      this.prisma.db.wellnessEnrolment.count({ where }),
    ]);
    const t = iso(today);
    const data = await Promise.all(rows.map((r) => this.shape(r, t)));
    return paginated(
      data.map(({ usages: _u, instalments: _i, terms: _t, ...m }) => ({
        ...m,
        includedTotal: m.entitlements.reduce((n, x) => n + x.quantity, 0),
        includedUsed: m.entitlements.reduce((n, x) => n + Math.min(x.used, x.quantity), 0),
      })),
      total,
      q,
    );
  }

  async overview() {
    const db = this.prisma.db;
    const todayStr = await this.today();
    const today = dateOnly(todayStr);
    const soon = new Date(today.getTime() + ENDING_DAYS * DAY);
    const monthStart = dateOnly(`${todayStr.slice(0, 7)}-01`);
    const active = { status: 'ACTIVE' as const, startDate: { lte: today }, endDate: { gte: today } };
    const [members, ending, toBill, monthly, savedMonth, billedMonth, plans] = await Promise.all([
      db.wellnessEnrolment.count({ where: active }),
      db.wellnessEnrolment.count({ where: { ...active, endDate: { gte: today, lte: soon }, renewedTo: null } }),
      db.wellnessInstalment.count({ where: { status: 'SCHEDULED', dueDate: { lte: today }, enrolment: { status: 'ACTIVE' } } }),
      db.wellnessEnrolment.findMany({ where: { ...active, billing: 'MONTHLY' }, select: { instalments: { where: { seq: 2 }, select: { amountMinor: true } } } }),
      db.wellnessUsage.aggregate({ where: { reversedAt: null, usedAt: { gte: monthStart } }, _sum: { savedMinor: true } }),
      db.wellnessInstalment.aggregate({ where: { status: 'BILLED', billedAt: { gte: monthStart } }, _sum: { amountMinor: true } }),
      this.listPlans(),
    ]);
    return {
      activeMembers: members,
      endingSoon: ending,
      paymentsToBill: toBill,
      /** Monthly payments coming in from members paying monthly. */
      monthlyRecurringMinor: monthly.reduce((n, m) => n + (m.instalments[0]?.amountMinor ?? 0), 0),
      savedThisMonthMinor: savedMonth._sum.savedMinor ?? 0,
      billedThisMonthMinor: billedMonth._sum.amountMinor ?? 0,
      plans: plans.map((p) => ({ id: p.id, name: p.name, activeMembers: p.activeMembers })),
    };
  }
}
