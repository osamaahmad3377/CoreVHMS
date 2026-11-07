import { Injectable } from '@nestjs/common';
import { CareKind, CareProtocol, CareRepeatUnit, Prisma } from '@prisma/client';
import { addRepeat, repeatSummary } from '@vcms/shared';
import { AuditService, diff } from '../../common/audit/audit.service';
import { ClientEvents } from '../../common/events/client-events';
import { RequestContext } from '../../common/context/request-context';
import { conflict, notFound, ruleViolation } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { ScopedTx } from '../../common/prisma/tenant-extension';
import { branchToday, resolveTimezone } from '../../common/time/branch-timezone';
import { addDays, dateOnlyInput, localDateOnly } from '../../common/time/tz';
import { AdministrationsService } from '../pharmacy/administrations.service';

const DAY = 86400_000;

/** Effective due date: a deferred item is due again on its deferral date. */
export const effectiveDue = (i: { status: string; dueDate: Date; deferredUntil: Date | null }) => (i.status === 'DEFERRED' && i.deferredUntil ? i.deferredUntil : i.dueDate);

const itemInclude = {
  protocol: { select: { id: true, name: true, intervalDays: true, productId: true } },
  patient: { select: { id: true, name: true, number: true, status: true, species: { select: { name: true } } } },
} satisfies Prisma.CareItemInclude;

/** `today` is the branch-local calendar date (see `branchToday`), so items are not overdue a day early or late. */
/** How an item repeats, as entered: left out = follow the protocol; repeatEvery 0 = never. */
export interface RepeatInput {
  repeatEvery?: number | null;
  repeatUnit?: CareRepeatUnit | null;
  repeatTimes?: number | null;
  repeatUntil?: Date | null;
}

/** The stored repeat columns for an input (a 0 interval clears the unit and the end). */
function repeatData(r: RepeatInput) {
  if (r.repeatEvery == null) return { repeatEvery: null, repeatUnit: null, repeatTimes: null, repeatUntil: null };
  if (r.repeatEvery === 0) return { repeatEvery: 0, repeatUnit: null, repeatTimes: null, repeatUntil: null };
  return { repeatEvery: r.repeatEvery, repeatUnit: r.repeatUnit ?? null, repeatTimes: r.repeatTimes ?? null, repeatUntil: r.repeatUntil ? dateOnlyInput(r.repeatUntil) : null };
}

export function shapeItem<T extends { status: string; dueDate: Date; deferredUntil: Date | null }>(i: T, today: Date) {
  const due = effectiveDue(i);
  return { ...i, effectiveDueDate: due, overdue: (i.status === 'DUE' || i.status === 'DEFERRED') && due < today };
}

/**
 * Preventive care: clinic-defined protocols (only approved ones, with a recorded source, are applied),
 * each patient's care plan, completion (through pharmacy administration when the clinic gives it),
 * deferral, cancellation and recurring scheduling.
 */
/** Runs when a care item is recorded as done, in the same transaction (billing charges a schedule's price here). */
export type CareCompletedHook = (tx: ScopedTx, item: CareItemRow, ctx: { encounterId: string | null }) => Promise<void>;
type CareItemRow = Prisma.CareItemGetPayload<object>;

@Injectable()
export class CareService {
  private readonly completedHooks: CareCompletedHook[] = [];
  registerCompletedHook(h: CareCompletedHook) {
    this.completedHooks.push(h);
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly administrations: AdministrationsService,
    private readonly events: ClientEvents,
  ) {}

  // ── Protocols ──

  listProtocols(includeRetired = false) {
    return this.prisma.db.careProtocol.findMany({
      where: includeRetired ? {} : { status: { not: 'RETIRED' } },
      include: { species: { select: { id: true, name: true } }, product: { select: { id: true, name: true } }, service: { select: { id: true, code: true, name: true, priceMinor: true, isActive: true } }, _count: { select: { items: true } } },
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
    });
  }

  async saveProtocol(id: string | null, withPrice: { name: string; kind: CareKind; speciesId?: string | null; productId?: string | null; firstDueAgeWeeks?: number | null; intervalDays?: number | null; source: string; notes?: string | null; priceMinor?: number | null }) {
    const { priceMinor, ...input } = withPrice;
    const db = this.prisma.db;
    if (input.speciesId && !(await db.species.findUnique({ where: { id: input.speciesId } }))) throw notFound('Species');
    if (input.productId && !(await db.product.findUnique({ where: { id: input.productId } }))) throw notFound('Product');
    const ctx = RequestContext.require();
    return db.$transaction(async (tx) => {
      if (id) {
        const before = await tx.careProtocol.findUnique({ where: { id } });
        if (!before) throw notFound('Protocol');
        if (before.status === 'RETIRED') throw ruleViolation('RETIRED', 'Retired protocols cannot be edited');
        // Changing the schedule itself sends an approved protocol back for review; a new price alone does not.
        const clinical = (Object.keys(input) as (keyof typeof input)[]).some((k) => String(input[k] ?? '') !== String((before as Record<string, unknown>)[k] ?? ''));
        const after = await tx.careProtocol.update({ where: { id }, data: clinical ? { ...input, status: 'DRAFT', reviewedByName: null, reviewedAt: null } : input });
        if (clinical) await this.audit.record({ action: 'care_protocol.updated', entityType: 'Organization', entityId: ctx.organizationId!, summary: after.name, changes: diff(before, after, Object.keys(input)) }, tx);
        return this.savePrice(tx, after, priceMinor);
      }
      const p = await tx.careProtocol.create({ data: { ...input, organizationId: ctx.organizationId!, createdByName: ctx.userName } });
      await this.audit.record({ action: 'care_protocol.created', entityType: 'Organization', entityId: ctx.organizationId!, summary: p.name }, tx);
      return this.savePrice(tx, p, priceMinor);
    });
  }

  /**
   * A schedule's price lives in Settings → Services & prices as its own service (e.g. “Deworming: Praziquantel”), so
   * it is edited in either place and charged like any other service. Undefined = leave it; null = no price.
   */
  private async savePrice(tx: ScopedTx, p: CareProtocol, priceMinor: number | null | undefined) {
    if (priceMinor === undefined) return p;
    const label = p.kind === 'DEWORMING' ? 'Deworming' : p.kind === 'VACCINATION' ? 'Vaccination' : 'Care';
    if (priceMinor === null) {
      if (!p.serviceId) return p;
      return tx.careProtocol.update({ where: { id: p.id }, data: { serviceId: null } });
    }
    const existing = p.serviceId ? await tx.service.findUnique({ where: { id: p.serviceId } }) : null;
    if (existing) {
      if (existing.priceMinor !== priceMinor || !existing.isActive) {
        await tx.service.update({ where: { id: existing.id }, data: { priceMinor, isActive: true } });
        await this.audit.record({ action: 'service.updated', entityType: 'Service', entityId: existing.id, summary: `${existing.code} ${existing.name}`, changes: { priceMinor: { from: existing.priceMinor, to: priceMinor } } }, tx);
      }
      return p;
    }
    const prefix = p.kind === 'DEWORMING' ? 'DEWORM' : p.kind === 'VACCINATION' ? 'VACC' : 'CARE';
    const taken = new Set((await tx.service.findMany({ where: { code: { startsWith: `${prefix}-` } }, select: { code: true } })).map((x) => x.code));
    let n = 1;
    while (taken.has(`${prefix}-${n}`)) n++;
    const service = await tx.service.create({
      data: { organizationId: p.organizationId, code: `${prefix}-${n}`, name: `${label}: ${p.name}`.slice(0, 160), category: p.kind === 'VACCINATION' ? 'VACCINATION' : 'PROCEDURE', priceMinor },
    });
    await this.audit.record({ action: 'service.created', entityType: 'Service', entityId: service.id, summary: `${service.code} ${service.name} — price of the ${label.toLowerCase()} schedule` }, tx);
    return tx.careProtocol.update({ where: { id: p.id }, data: { serviceId: service.id } });
  }

  async setProtocolStatus(id: string, status: 'APPROVED' | 'RETIRED') {
    const ctx = RequestContext.require();
    const p = await this.prisma.db.careProtocol.findUnique({ where: { id } });
    if (!p) throw notFound('Protocol');
    if (status === 'APPROVED' && !ctx.permissions.has('clinical.sign')) throw ruleViolation('REVIEW_REQUIRED', 'Only a veterinarian can approve a care protocol');
    return this.prisma.db.$transaction(async (tx) => {
      const after = await tx.careProtocol.update({ where: { id }, data: status === 'APPROVED' ? { status, reviewedByName: ctx.userName, reviewedAt: new Date() } : { status } });
      await this.audit.record({ action: `care_protocol.${status.toLowerCase()}`, entityType: 'Organization', entityId: ctx.organizationId!, summary: p.name }, tx);
      return after;
    });
  }

  // ── Care plans ──

  /** First due date for a protocol for this patient: after the last completion, by age, or today. */
  private async firstDue(tx: ScopedTx | PrismaService['db'], protocol: CareProtocol, patient: { id: string; dateOfBirth: Date | null }, tz: string) {
    const last = await tx.careItem.findFirst({ where: { patientId: patient.id, protocolId: protocol.id, status: 'COMPLETED' }, orderBy: { completedAt: 'desc' } });
    const today = localDateOnly(new Date(), tz);
    if (last?.completedAt) return protocol.intervalDays ? addDays(localDateOnly(last.completedAt, tz), protocol.intervalDays) : null;
    if (protocol.firstDueAgeWeeks != null && patient.dateOfBirth) {
      const byAge = addDays(dateOnlyInput(patient.dateOfBirth), protocol.firstDueAgeWeeks * 7);
      return byAge > today ? byAge : today;
    }
    return today;
  }

  /**
   * What can be chosen when adding a patient for vaccination or deworming: the approved schedules of that kind and
   * the products behind them — for vaccination every active vaccine in stock — each with the quantity on hand at
   * this branch.
   */
  async careOptions(kind: 'VACCINATION' | 'DEWORMING') {
    const db = this.prisma.db;
    const protocols = await db.careProtocol.findMany({
      where: { status: 'APPROVED', kind },
      select: { id: true, name: true, kind: true, speciesId: true, productId: true, intervalDays: true, species: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    });
    const linked = protocols.map((p) => p.productId).filter((x): x is string => !!x);
    const products = await db.product.findMany({
      where: kind === 'VACCINATION' ? { type: 'VACCINE', isActive: true } : { id: { in: linked }, isActive: true },
      select: { id: true, name: true, dispensingUnit: true },
      orderBy: { name: 'asc' },
    });
    const branchId = RequestContext.get()?.branchId;
    const levels = products.length
      ? await db.stockLevel.findMany({ where: { productId: { in: products.map((p) => p.id) }, ...(branchId ? { location: { branchId } } : {}) }, select: { productId: true, quantity: true } })
      : [];
    const onHand = (id: string) => levels.filter((l) => l.productId === id).reduce((n, l) => n + Number(l.quantity), 0);
    return { protocols, products: products.map((p) => ({ ...p, onHand: onHand(p.id) })) };
  }

  /** Adds approved protocols that apply to the patient's species and are not yet in its plan. Returns created count. */
  async applyProtocols(patientId: string, protocolIds?: string[]) {
    const db = this.prisma.db;
    const patient = await db.patient.findUnique({ where: { id: patientId } });
    if (!patient) throw notFound('Patient');
    if (patient.status !== 'ACTIVE') throw ruleViolation('PATIENT_NOT_ACTIVE', 'Care plans apply to active patients only');
    const protocols = await db.careProtocol.findMany({ where: { status: 'APPROVED', id: protocolIds ? { in: protocolIds } : undefined, OR: [{ speciesId: null }, { speciesId: patient.speciesId }] } });
    const tz = await resolveTimezone(this.prisma);
    let created = 0;
    await db.$transaction(async (tx) => {
      for (const p of protocols) {
        if (await tx.careItem.findFirst({ where: { patientId, protocolId: p.id, status: { in: ['DUE', 'DEFERRED'] } } })) continue;
        const due = await this.firstDue(tx, p, patient, tz);
        if (!due) continue;
        await tx.careItem.create({ data: { organizationId: patient.organizationId, patientId, protocolId: p.id, kind: p.kind, title: p.name, dueDate: due, createdByName: RequestContext.get()?.userName ?? 'System' } });
        created++;
      }
      if (created) await this.audit.record({ action: 'care_plan.protocols_applied', entityType: 'Patient', entityId: patientId, summary: `${created} item(s)` }, tx);
    });
    return { created };
  }

  /** Applies one approved protocol to every active patient of the matching species. */
  async applyToAll(protocolId: string) {
    const p = await this.prisma.db.careProtocol.findUnique({ where: { id: protocolId } });
    if (!p) throw notFound('Protocol');
    if (p.status !== 'APPROVED') throw ruleViolation('NOT_APPROVED', 'Approve the protocol before applying it');
    const patients = await this.prisma.db.patient.findMany({ where: { status: 'ACTIVE', speciesId: p.speciesId ?? undefined }, select: { id: true } });
    let created = 0;
    for (const pt of patients) created += (await this.applyProtocols(pt.id, [p.id])).created;
    return { patients: patients.length, created };
  }

  async plan(patientId: string) {
    const db = this.prisma.db;
    const patient = await db.patient.findUnique({ where: { id: patientId } });
    if (!patient) throw notFound('Patient');
    const [items, protocols, today] = await Promise.all([
      db.careItem.findMany({ where: { patientId }, include: itemInclude, orderBy: [{ dueDate: 'asc' }] }),
      db.careProtocol.findMany({ where: { status: 'APPROVED', OR: [{ speciesId: null }, { speciesId: patient.speciesId }] }, select: { id: true, name: true, kind: true } }),
      branchToday(this.prisma),
    ]);
    const open = new Set(items.filter((i) => i.status === 'DUE' || i.status === 'DEFERRED').map((i) => i.protocolId));
    // Batch and expiry of what was given here live on the administration (the batch issued from stock).
    const adminIds = items.map((i) => i.administrationId).filter(Boolean) as string[];
    const admins = adminIds.length ? await db.medicationAdministration.findMany({ where: { id: { in: adminIds } }, select: { id: true, batchNumber: true, expiryDate: true } }) : [];
    const withBatch = items.map((i) => {
      const a = admins.find((x) => x.id === i.administrationId);
      return { ...shapeItem(i, today), batchNumber: i.batchNumber ?? a?.batchNumber ?? null, expiryDate: a?.expiryDate ?? null };
    });
    return { items: withBatch, availableProtocols: protocols.filter((p) => !open.has(p.id)) };
  }

  async addItem(input: { patientId: string; protocolId?: string | null; productId?: string | null; kind: CareKind; title: string; dueDate: Date; notes?: string | null } & RepeatInput) {
    const patient = await this.prisma.db.patient.findUnique({ where: { id: input.patientId } });
    if (!patient) throw notFound('Patient');
    if (input.protocolId && !(await this.prisma.db.careProtocol.findUnique({ where: { id: input.protocolId } }))) throw notFound('Protocol');
    if (input.productId) {
      const product = await this.prisma.db.product.findUnique({ where: { id: input.productId }, select: { type: true, isActive: true } });
      if (!product || !product.isActive) throw notFound('Product');
      if (input.kind === 'VACCINATION' && product.type !== 'VACCINE') throw ruleViolation('NOT_A_VACCINE', 'Choose a vaccine from stock');
    }
    const today = await branchToday(this.prisma);
    try {
      return await this.prisma.db.$transaction(async (tx) => {
        const { repeatEvery, repeatUnit, repeatTimes, repeatUntil, ...rest } = input;
        const i = await tx.careItem.create({ data: { ...rest, ...repeatData({ repeatEvery, repeatUnit, repeatTimes, repeatUntil }), protocolId: input.protocolId ?? null, dueDate: dateOnlyInput(input.dueDate), organizationId: patient.organizationId, createdByName: RequestContext.require().userName } });
        const repeats = repeatSummary({ every: i.repeatEvery, unit: i.repeatUnit, times: i.repeatTimes, until: i.repeatUntil?.toISOString().slice(0, 10) });
        await this.audit.record({ action: 'care_item.added', entityType: 'Patient', entityId: input.patientId, summary: `${i.title} due ${i.dueDate.toISOString().slice(0, 10)}${repeats ? ` · ${repeats}` : ''}` }, tx);
        return shapeItem(i, today);
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw conflict('This protocol already has an open item in the care plan');
      throw e;
    }
  }

  private async openItem(id: string) {
    const i = await this.prisma.db.careItem.findUnique({ where: { id }, include: { protocol: true } });
    if (!i) throw notFound('Care item');
    if (i.status !== 'DUE' && i.status !== 'DEFERRED') throw ruleViolation('NOT_OPEN', 'This care item is already closed');
    return i;
  }

  /** Changes (or stops) how an open item repeats after it is given. */
  async setRepeat(id: string, input: RepeatInput) {
    const item = await this.openItem(id);
    if (input.repeatUntil && dateOnlyInput(input.repeatUntil) < (item.deferredUntil ?? item.dueDate)) throw ruleViolation('REPEAT_UNTIL_BEFORE_DUE', 'The end date must be on or after the due date');
    const data = repeatData(input);
    const today = await branchToday(this.prisma);
    return this.prisma.db.$transaction(async (tx) => {
      const i = await tx.careItem.update({ where: { id }, data });
      const summary = data.repeatEvery === 0 ? 'does not repeat' : (repeatSummary({ every: i.repeatEvery, unit: i.repeatUnit, times: i.repeatTimes, until: i.repeatUntil?.toISOString().slice(0, 10) }) ?? 'follows the protocol');
      await this.audit.record({ action: 'care_item.repeat_changed', entityType: 'Patient', entityId: i.patientId, summary: `${i.title}: ${summary}` }, tx);
      return shapeItem(i, today);
    });
  }

  /**
   * Schedules the next occurrence after a completion: the item's own repeat when it has one (every N days,
   * weeks, months or years, until its end), otherwise the protocol's interval.
   */
  async scheduleNext(
    tx: ScopedTx,
    item: { id: string; organizationId: string; patientId: string; protocolId: string | null; productId?: string | null; kind: CareKind; title: string; repeatEvery?: number | null; repeatUnit?: CareRepeatUnit | null; repeatTimes?: number | null; repeatUntil?: Date | null },
    completedAt: Date,
  ) {
    if (item.repeatEvery === 0) return null;
    if (item.repeatEvery && item.repeatUnit) {
      if (item.repeatTimes === 0) return null;
      // Count from the calendar day it was given in the branch, not the UTC day.
      const due = addRepeat(localDateOnly(completedAt, await resolveTimezone(this.prisma)), item.repeatEvery, item.repeatUnit);
      if (item.repeatUntil && due > item.repeatUntil) return null;
      if (item.protocolId && (await tx.careItem.findFirst({ where: { patientId: item.patientId, protocolId: item.protocolId, status: { in: ['DUE', 'DEFERRED'] } } }))) return null;
      return tx.careItem.create({
        data: {
          organizationId: item.organizationId,
          patientId: item.patientId,
          protocolId: item.protocolId,
          productId: item.productId ?? null,
          kind: item.kind,
          title: item.title,
          dueDate: due,
          repeatEvery: item.repeatEvery,
          repeatUnit: item.repeatUnit,
          repeatTimes: item.repeatTimes == null ? null : item.repeatTimes - 1,
          repeatUntil: item.repeatUntil ?? null,
          previousItemId: item.id,
          createdByName: 'System (recurring)',
        },
      });
    }
    if (!item.protocolId) return null;
    const p = await tx.careProtocol.findUnique({ where: { id: item.protocolId } });
    if (!p || p.status !== 'APPROVED' || !p.intervalDays) return null;
    if (await tx.careItem.findFirst({ where: { patientId: item.patientId, protocolId: p.id, status: { in: ['DUE', 'DEFERRED'] } } })) return null;
    // Count the interval from the calendar day it was given in the branch, not the UTC day.
    const givenOn = localDateOnly(completedAt, await resolveTimezone(this.prisma));
    return tx.careItem.create({
      data: { organizationId: item.organizationId, patientId: item.patientId, protocolId: p.id, productId: item.productId ?? p.productId, kind: p.kind, title: p.name, dueDate: addDays(givenOn, p.intervalDays), previousItemId: item.id, createdByName: 'System (recurring)' },
    });
  }

  /** Marks an open item completed inside a transaction (shared by all completion paths). Idempotent per administration. */
  async markCompleted(tx: ScopedTx, itemId: string, data: { completedAt: Date; administrationId?: string | null; givenElsewhere?: boolean; productName?: string | null; batchNumber?: string | null; notes?: string | null; encounterId?: string | null }) {
    // Batch left empty → the one actually issued from stock (first-expiring), recorded on the administration
    // by the stock hook. Completed items are locked, so it has to be stored now.
    let batchNumber = data.batchNumber || null;
    if (!batchNumber && data.administrationId) batchNumber = (await tx.medicationAdministration.findUnique({ where: { id: data.administrationId }, select: { batchNumber: true } }))?.batchNumber ?? null;
    const r = await tx.careItem.updateMany({
      where: { id: itemId, status: { in: ['DUE', 'DEFERRED'] } },
      data: { status: 'COMPLETED', completedAt: data.completedAt, completedByName: RequestContext.get()?.userName ?? 'System', administrationId: data.administrationId ?? null, givenElsewhere: data.givenElsewhere ?? false, productName: data.productName ?? null, batchNumber, notes: data.notes ?? undefined },
    });
    if (!r.count) return false;
    const item = await tx.careItem.findUniqueOrThrow({ where: { id: itemId } });
    await this.scheduleNext(tx, item, data.completedAt);
    const encounterId = data.encounterId ?? (item.administrationId ? ((await tx.medicationAdministration.findUnique({ where: { id: item.administrationId }, select: { encounterId: true } }))?.encounterId ?? null) : null);
    for (const h of this.completedHooks) await h(tx, item, { encounterId });
    await this.audit.record({ action: 'care_item.completed', entityType: 'Patient', entityId: item.patientId, summary: `${item.title}${data.givenElsewhere ? ' (given elsewhere)' : ''}${batchNumber ? ` batch ${batchNumber}` : ''}` }, tx);
    return true;
  }

  async complete(id: string, input: { mode: 'ADMINISTER' | 'ELSEWHERE' | 'DONE'; productId?: string | null; dose?: number | null; doseUnit?: string | null; route?: string | null; site?: string | null; batchNumber?: string | null; expiryDate?: Date | null; productName?: string | null; notes?: string | null; completedAt?: Date | null; overrideReason?: string | null; encounterId?: string | null }) {
    const item = await this.openItem(id);
    const at = input.completedAt ?? new Date();
    if (at.getTime() > Date.now() + 5 * 60_000) throw ruleViolation('FUTURE_TIME', 'Completion time cannot be in the future');
    if (input.mode === 'ADMINISTER') {
      // Given here: through pharmacy, so allergy checks, stock, charges and withdrawal periods apply.
      await this.administrations.record(
        { patientId: item.patientId, encounterId: input.encounterId ?? null, productId: input.productId!, status: 'GIVEN', dose: input.dose!, doseUnit: input.doseUnit!, route: input.route!, site: input.site ?? null, batchNumber: input.batchNumber ?? null, expiryDate: input.expiryDate ?? null, notes: input.notes ?? null, administeredAt: at, overrideReason: input.overrideReason ?? null },
        async (tx, a) => {
          const done = await this.markCompleted(tx, id, { completedAt: at, administrationId: a.id, batchNumber: input.batchNumber, notes: input.notes, encounterId: input.encounterId ?? null });
          // The administration hook may already have completed it (same product); anything else is a conflict.
          if (!done && (await tx.careItem.findUniqueOrThrow({ where: { id } })).administrationId !== a.id) throw conflict('This care item was completed by someone else');
        },
      );
    } else {
      await this.prisma.db.$transaction(async (tx) => {
        const done = await this.markCompleted(tx, id, { completedAt: at, givenElsewhere: input.mode === 'ELSEWHERE', productName: input.productName, batchNumber: input.batchNumber, notes: input.notes, encounterId: input.encounterId ?? null });
        if (!done) throw conflict('This care item was completed by someone else');
      });
    }
    // Given at this clinic: the owner gets a note with the next due date (not for doses given elsewhere).
    if (item.kind === 'VACCINATION' && input.mode !== 'ELSEWHERE') await this.events.emit({ type: 'VACCINATION_GIVEN', careItemId: id });
    return shapeItem(await this.prisma.db.careItem.findUniqueOrThrow({ where: { id }, include: itemInclude }), await branchToday(this.prisma));
  }

  async defer(id: string, until: Date, reason: string) {
    const item = await this.openItem(id);
    const today = await branchToday(this.prisma);
    if (dateOnlyInput(until) <= today) throw ruleViolation('INVALID_DATE', 'Defer to a future date');
    return this.prisma.db.$transaction(async (tx) => {
      // A new deferral resets reminders so the client is reminded again before the new date.
      const after = await tx.careItem.update({ where: { id }, data: { status: 'DEFERRED', deferredUntil: dateOnlyInput(until), deferReason: reason, remindedAt: null, overdueRemindedAt: null } });
      await this.audit.record({ action: 'care_item.deferred', entityType: 'Patient', entityId: item.patientId, summary: `${item.title} to ${until.toISOString().slice(0, 10)}: ${reason}` }, tx);
      return shapeItem(after, today);
    });
  }

  async cancel(id: string, reason: string) {
    const item = await this.openItem(id);
    const today = await branchToday(this.prisma);
    return this.prisma.db.$transaction(async (tx) => {
      const after = await tx.careItem.update({ where: { id }, data: { status: 'CANCELLED', cancelReason: reason } });
      await this.audit.record({ action: 'care_item.cancelled', entityType: 'Patient', entityId: item.patientId, summary: `${item.title}: ${reason}` }, tx);
      return shapeItem(after, today);
    });
  }

  /** Worklist of open care across the practice. */
  async worklist(q: { range: 'overdue' | 'week' | 'month' | 'all'; kind?: string; page: number; pageSize: number }) {
    const today = await branchToday(this.prisma);
    const horizon = q.range === 'week' ? new Date(today.getTime() + 7 * DAY) : q.range === 'month' ? new Date(today.getTime() + 31 * DAY) : null;
    const dateCond = q.range === 'overdue' ? { lt: today } : horizon ? { lt: horizon } : undefined;
    const where: Prisma.CareItemWhereInput = {
      kind: (q.kind as CareKind) || undefined,
      patient: { status: 'ACTIVE' },
      OR: [
        { status: 'DUE', dueDate: dateCond },
        { status: 'DEFERRED', deferredUntil: dateCond },
      ],
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.careItem.findMany({ where, include: { ...itemInclude, patient: { select: { id: true, name: true, number: true, status: true, species: { select: { name: true } }, ownerships: { where: { endedAt: null, isPrimary: true }, select: { client: { select: { id: true, displayName: true, mobilePhone: true, email: true, remindersConsent: true } } } } } } }, orderBy: { dueDate: 'asc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.db.careItem.count({ where }),
    ]);
    return {
      data: rows.map((r) => ({ ...shapeItem(r, today), owner: r.patient.ownerships[0]?.client ?? null, patient: { id: r.patient.id, name: r.patient.name, number: r.patient.number, species: r.patient.species } })),
      meta: { page: q.page, pageSize: q.pageSize, total },
    };
  }

  /** Vaccination certificate data: completed vaccinations with product and batch, and what is due next. */
  async certificate(patientId: string) {
    const db = this.prisma.db;
    const patient = await db.patient.findUnique({
      where: { id: patientId },
      include: { species: { select: { name: true } }, breed: { select: { name: true } }, identifiers: true, ownerships: { where: { endedAt: null, isPrimary: true }, include: { client: { select: { displayName: true, addresses: { where: { isPrimary: true }, take: 1 } } } } } },
    });
    if (!patient) throw notFound('Patient');
    const items = await db.careItem.findMany({ where: { patientId, kind: 'VACCINATION', status: { in: ['COMPLETED', 'DUE', 'DEFERRED'] } }, orderBy: { completedAt: 'asc' } });
    const adminIds = items.map((i) => i.administrationId).filter(Boolean) as string[];
    const admins = await db.medicationAdministration.findMany({ where: { id: { in: adminIds } }, include: { product: { select: { name: true, manufacturer: true } } } });
    return {
      patient: { id: patient.id, name: patient.name, number: patient.number, sex: patient.sex, dateOfBirth: patient.dateOfBirth, species: patient.species.name, breed: patient.breed?.name ?? patient.breedText, colour: patient.colour, identifiers: patient.identifiers.map((x) => ({ type: x.type, value: x.value })) },
      owner: patient.ownerships[0]?.client ?? null,
      given: items.filter((i) => i.status === 'COMPLETED').map((i) => {
        const a = admins.find((x) => x.id === i.administrationId);
        return { id: i.id, title: i.title, date: i.completedAt, product: a?.product.name ?? i.productName, manufacturer: a?.product.manufacturer ?? null, batchNumber: a?.batchNumber ?? i.batchNumber, expiryDate: a?.expiryDate ?? null, givenBy: a?.administeredByName ?? i.completedByName, givenElsewhere: i.givenElsewhere };
      }),
      nextDue: items.filter((i) => i.status !== 'COMPLETED').map((i) => ({ title: i.title, dueDate: effectiveDue(i) })),
      generatedAt: new Date(),
    };
  }

  /** Compliance per approved protocol: in scope, up to date, overdue, not yet in a plan. */
  async compliance() {
    const db = this.prisma.db;
    const today = await branchToday(this.prisma);
    const protocols = await db.careProtocol.findMany({ where: { status: 'APPROVED' }, include: { species: { select: { name: true } } } });
    const rows = [];
    for (const p of protocols) {
      const scope = await db.patient.count({ where: { status: 'ACTIVE', speciesId: p.speciesId ?? undefined } });
      const openItems = await db.careItem.findMany({ where: { protocolId: p.id, status: { in: ['DUE', 'DEFERRED'] }, patient: { status: 'ACTIVE' } }, select: { status: true, dueDate: true, deferredUntil: true, patientId: true } });
      const overdue = openItems.filter((i) => effectiveDue(i) < today).length;
      const inPlan = new Set(openItems.map((i) => i.patientId)).size;
      rows.push({ protocolId: p.id, name: p.name, kind: p.kind, species: p.species?.name ?? 'All species', patientsInScope: scope, inPlan, upToDate: inPlan - overdue, overdue, notInPlan: Math.max(0, scope - inPlan), compliancePercent: scope ? Math.round(((inPlan - overdue) / scope) * 100) : null });
    }
    return rows;
  }
}
