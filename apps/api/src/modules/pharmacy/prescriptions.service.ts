import { Injectable } from '@nestjs/common';
import { Prisma, Product } from '@prisma/client';
import { FREQUENCIES, allergyConflictText, allergyConflicts, allergyMatches, calculateDose, compareToRange, courseQuantity, type CreatePrescriptionInput, type PrescriptionItemInput } from '@vcms/shared';
import { AuditService } from '../../common/audit/audit.service';
import { ClientEvents } from '../../common/events/client-events';
import { RequestContext } from '../../common/context/request-context';
import { sha256 } from '../../common/crypto/crypto';
import { CounterService, formatNumber } from '../../common/counter/counter.service';
import { forbidden, notFound, ruleViolation } from '../../common/http/errors';
import { pageArgs, paginated } from '../../common/http/pagination';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { ScopedTx } from '../../common/prisma/tenant-extension';
import { PRESCRIBABLE_TYPES } from './formulary.service';
import { WithdrawalService } from './withdrawal.service';

export const prescriptionNo = (n: number) => formatNumber('RX', n);

export interface SafetyWarning {
  code: 'ALLERGY' | 'SPECIES' | 'DOSE_ABOVE_RANGE' | 'DOSE_BELOW_RANGE' | 'MAX_DOSE' | 'NO_REFERENCE' | 'CONTROLLED' | 'UNIT_MISMATCH';
  message: string;
  /** Blocking warnings need a documented override reason. */
  blocking: boolean;
}

/** Hook run inside the dispensing transaction (inventory registers stock deduction here in M5). */
export type DispenseHook = (tx: ScopedTx, e: { dispensationId: string; product: Product; quantity: number; batchNumber?: string | null; branchId: string }) => Promise<void>;

const include = {
  patient: {
    select: {
      id: true,
      name: true,
      number: true,
      sex: true,
      dateOfBirth: true,
      latestWeightKg: true,
      species: { select: { id: true, name: true, category: true } },
      alerts: { where: { isActive: true }, select: { id: true, severity: true, title: true, type: true, substance: true, reaction: true } },
    },
  },
  client: { select: { id: true, displayName: true, title: true, firstName: true, lastName: true, organizationName: true, mobilePhone: true } },
  encounter: { select: { id: true, number: true } },
  prescriber: { select: { id: true, professionalRegistration: true, user: { select: { name: true } } } },
  items: {
    orderBy: { createdAt: 'asc' },
    include: {
      product: true,
      dispensations: { orderBy: { dispensedAt: 'asc' } },
      doseReference: { select: { id: true, source: true, doseMin: true, doseMax: true, doseUnit: true } },
    },
  },
} satisfies Prisma.PrescriptionInclude;

type Row = Prisma.PrescriptionGetPayload<{ include: typeof include }>;

const n = (d: Prisma.Decimal | null | undefined) => (d === null || d === undefined ? null : Number(d));

export function shapePrescription(p: Row) {
  return {
    ...p,
    prescriptionNo: prescriptionNo(p.number),
    encounterNo: p.encounter ? formatNumber('E', p.encounter.number) : null,
    weightKg: n(p.weightKg),
    patient: { ...p.patient, latestWeightKg: n(p.patient.latestWeightKg) },
    prescriber: p.prescriber ? { id: p.prescriber.id, name: p.prescriber.user.name, registration: p.prescriber.professionalRegistration } : null,
    items: p.items.map((i) => ({
      ...i,
      doseValue: Number(i.doseValue),
      weightKgUsed: n(i.weightKgUsed),
      amountPerDose: Number(i.amountPerDose),
      frequencyPerDay: n(i.frequencyPerDay),
      quantity: Number(i.quantity),
      quantityDispensed: Number(i.quantityDispensed),
      remaining: Number(i.quantity) * (1 + i.repeats) - Number(i.quantityDispensed),
      product: { ...i.product, strengthValue: n(i.product.strengthValue), minDispenseIncrement: Number(i.product.minDispenseIncrement) },
      doseReference: i.doseReference ? { ...i.doseReference, doseMin: Number(i.doseReference.doseMin), doseMax: Number(i.doseReference.doseMax) } : null,
      dispensations: i.dispensations.map((d) => ({ ...d, quantity: Number(d.quantity) })),
    })),
  };
}

/** Allergy alerts matched against a product's name, ingredients and drug family (shared with the web). */
export { allergyMatches };

/** Countable dispensing units (tablets, capsules…) for the "N per dose — is that correct?" prompt; liquids and masses are not counted. */
const MEASURED_UNIT = /^(mL|L|g|kg|mg|mcg|µg|IU|cm|mm)$/i;

@Injectable()
export class PrescriptionsService {
  private readonly dispenseHooks: DispenseHook[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly counters: CounterService,
    private readonly withdrawals: WithdrawalService,
    private readonly events: ClientEvents,
  ) {}

  registerDispenseHook(hook: DispenseHook) {
    this.dispenseHooks.push(hook);
  }

  async list(q: { page: number; pageSize: number; q?: string; status?: string; clientId?: string; patientId?: string; encounterId?: string }) {
    const statuses = q.status?.split(',').filter(Boolean) as any[] | undefined;
    const where: Prisma.PrescriptionWhereInput = {
      status: statuses?.length ? { in: statuses } : undefined,
      clientId: q.clientId,
      patientId: q.patientId,
      encounterId: q.encounterId,
      ...(q.q
        ? {
            OR: [
              { patient: { name: { contains: q.q, mode: 'insensitive' } } },
              { client: { displayName: { contains: q.q, mode: 'insensitive' } } },
              { items: { some: { product: { name: { contains: q.q, mode: 'insensitive' } } } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.prescription.findMany({ where, include, orderBy: { createdAt: 'desc' }, ...pageArgs(q) }),
      this.prisma.db.prescription.count({ where }),
    ]);
    return paginated(rows.map(shapePrescription), total, q);
  }

  async get(id: string) {
    const p = await this.prisma.db.prescription.findUnique({ where: { id }, include });
    if (!p) throw notFound('Prescription');
    return shapePrescription(p);
  }

  /**
   * Validates one item and computes the amount per dose, quantity and safety warnings.
   * Exposed as a dry-run endpoint so the UI can show the calculation before saving.
   */
  async evaluateItem(patientId: string, weightKg: number | null, item: PrescriptionItemInput) {
    const patient = await this.prisma.db.patient.findUnique({
      where: { id: patientId },
      include: { species: true, alerts: { where: { isActive: true } } },
    });
    if (!patient) throw notFound('Patient');
    weightKg = weightKg ?? (patient.latestWeightKg ? Number(patient.latestWeightKg) : null);
    const product = await this.prisma.db.product.findUnique({ where: { id: item.productId } });
    if (!product || !product.isActive) throw ruleViolation('INVALID_PRODUCT', 'Product not found or inactive');
    if (!PRESCRIBABLE_TYPES.includes(product.type)) throw ruleViolation('NOT_PRESCRIBABLE', `${product.name} is not a prescribable medicine`);

    const calc = calculateDose({
      weightKg,
      doseValue: item.doseValue,
      doseUnit: item.doseUnit,
      strengthValue: product.strengthValue ? Number(product.strengthValue) : null,
      strengthUnit: product.strengthUnit,
      dispensingUnit: product.dispensingUnit,
      increment: Number(product.minDispenseIncrement),
      rounding: item.rounding,
    });
    if (!calc.ok) throw ruleViolation('DOSE_CALCULATION', calc.error);

    const freq = FREQUENCIES.find((f) => f.code === item.frequencyCode);
    if (!freq) throw ruleViolation('INVALID_FREQUENCY', 'Unknown frequency');
    const increment = Number(product.minDispenseIncrement);
    const quantity =
      item.quantity ?? (freq.perDay && item.durationDays ? courseQuantity(calc.amount, freq.perDay, item.durationDays, increment) : calc.amount);

    const warnings: SafetyWarning[] = [];
    for (const c of allergyConflicts(patient.alerts, product)) {
      warnings.push({ code: 'ALLERGY', message: `${allergyConflictText(c, product.name)}${c.alert.reaction ? ` (reaction: ${c.alert.reaction})` : ''}`, blocking: true });
    }
    if (product.targetSpecies.length && !product.targetSpecies.includes(patient.species.category)) {
      warnings.push({ code: 'SPECIES', message: `${product.name} is not listed for ${patient.species.category.toLowerCase()} species`, blocking: true });
    }
    if (product.isControlled) warnings.push({ code: 'CONTROLLED', message: `${product.name} is a controlled medicine${product.controlledSchedule ? ` (${product.controlledSchedule})` : ''}`, blocking: false });

    let doseReferenceId: string | null = null;
    const ref = item.doseReferenceId
      ? await this.prisma.db.doseReference.findUnique({ where: { id: item.doseReferenceId } })
      : await this.prisma.db.doseReference.findFirst({ where: { productId: product.id, speciesId: patient.speciesId, status: 'APPROVED', route: item.route } });
    if (item.doseReferenceId && (!ref || ref.productId !== product.id || ref.speciesId !== patient.speciesId || ref.status !== 'APPROVED')) {
      throw ruleViolation('INVALID_REFERENCE', 'Dose reference does not apply to this product and species, or is not approved');
    }
    if (ref) {
      doseReferenceId = ref.id;
      const perKgRef = /\/kg$/i.test(ref.doseUnit);
      let position: ReturnType<typeof compareToRange> = 'INCOMPATIBLE';
      if (perKgRef && calc.deliveredPerKg !== null && calc.deliveredUnit) {
        position = compareToRange(calc.deliveredPerKg, `${calc.deliveredUnit}/kg`, Number(ref.doseMin), Number(ref.doseMax), ref.doseUnit);
      } else if (!perKgRef && calc.deliveredDose !== null && calc.deliveredUnit) {
        position = compareToRange(calc.deliveredDose, calc.deliveredUnit, Number(ref.doseMin), Number(ref.doseMax), ref.doseUnit.replace(/\/animal$/i, ''));
      }
      const range = `${Number(ref.doseMin)}–${Number(ref.doseMax)} ${ref.doseUnit} (${ref.source})`;
      if (position === 'ABOVE') warnings.push({ code: 'DOSE_ABOVE_RANGE', message: `Delivered dose is above the approved reference ${range}`, blocking: true });
      if (position === 'BELOW') warnings.push({ code: 'DOSE_BELOW_RANGE', message: `Delivered dose is below the approved reference ${range}`, blocking: true });
      if (position === 'INCOMPATIBLE') warnings.push({ code: 'UNIT_MISMATCH', message: `Cannot compare this dose with the reference unit (${ref.doseUnit})`, blocking: true });
      if (ref.maxPerDose && calc.deliveredDose !== null && calc.deliveredDose > Number(ref.maxPerDose)) {
        warnings.push({ code: 'MAX_DOSE', message: `Exceeds the reference maximum of ${Number(ref.maxPerDose)} ${calc.deliveredUnit} per dose`, blocking: true });
      }
    } else {
      warnings.push({ code: 'NO_REFERENCE', message: `No dose range is set up for this medicine in ${patient.species.name}. Please double-check the dose before approving.`, blocking: false });
    }

    // Data-entry safety prompt (clinic setting), not a dose limit: the UI asks the prescriber to confirm.
    const org = await this.prisma.db.organization.findUnique({ where: { id: RequestContext.orgId() }, select: { rxConfirmUnitsPerDose: true } });
    const confirmAbove = org?.rxConfirmUnitsPerDose ?? null;
    const largeDose = confirmAbove !== null && !MEASURED_UNIT.test(product.dispensingUnit) && calc.amount > confirmAbove ? { amount: calc.amount, unit: product.dispensingUnit, confirmAbove } : null;

    return {
      product: { id: product.id, name: product.name, dispensingUnit: product.dispensingUnit, isControlled: product.isControlled },
      calculation: calc,
      frequency: freq,
      quantity,
      warnings,
      doseReferenceId,
      requiresOverride: warnings.some((w) => w.blocking),
      largeDose,
    };
  }

  private hash(items: { id: string; productId: string; doseValue: unknown; doseUnit: string; amountPerDose: unknown; route: string; frequencyText: string; quantity: unknown; instructions: string; repeats: number }[], at: Date, by: string) {
    return sha256(
      JSON.stringify({
        items: [...items].sort((a, b) => a.id.localeCompare(b.id)).map((i) => [i.productId, String(i.doseValue), i.doseUnit, String(i.amountPerDose), i.route, i.frequencyText, String(i.quantity), i.instructions, i.repeats]),
        at: at.toISOString(),
        by,
      }),
    );
  }

  async create(input: CreatePrescriptionInput) {
    const ctx = RequestContext.require();
    if (input.authorize && !ctx.permissions.has('prescriptions.authorize')) throw forbidden('You can draft prescriptions but not authorise them');
    const patient = await this.prisma.db.patient.findUnique({
      where: { id: input.patientId },
      include: { ownerships: { where: { endedAt: null, isPrimary: true } } },
    });
    if (!patient) throw notFound('Patient');
    if (patient.status !== 'ACTIVE') throw ruleViolation('PATIENT_NOT_ACTIVE', `Cannot prescribe for a ${patient.status.toLowerCase()} patient`);
    const owner = patient.ownerships[0];
    if (!owner) throw ruleViolation('NO_OWNER', 'The patient has no current owner');
    if (input.encounterId) {
      const e = await this.prisma.db.encounter.findUnique({ where: { id: input.encounterId } });
      if (!e || e.patientId !== patient.id) throw ruleViolation('INVALID_ENCOUNTER', 'Consultation does not belong to this patient');
    }
    const weightKg = input.weightKg ?? (patient.latestWeightKg ? Number(patient.latestWeightKg) : null);

    const evaluated: { item: PrescriptionItemInput; ev: Awaited<ReturnType<PrescriptionsService["evaluateItem"]>> }[] = [];
    for (const [idx, item] of input.items.entries()) {
      const ev = await this.evaluateItem(patient.id, weightKg, item);
      if (ev.requiresOverride && !item.overrideReason) {
        throw ruleViolation('SAFETY_OVERRIDE_REQUIRED', `Item ${idx + 1} (${ev.product.name}) has safety warnings that need a documented reason`, {
          itemIndex: idx,
          warnings: ev.warnings,
        });
      }
      if (ev.product.isControlled && !ctx.permissions.has('prescriptions.authorize')) {
        throw forbidden(`${ev.product.name} is a controlled medicine and can only be prescribed by an authorised prescriber`);
      }
      evaluated.push({ item, ev });
    }

    const prescriber = ctx.membershipId ? await this.prisma.db.membership.findUnique({ where: { id: ctx.membershipId } }) : null;
    const now = new Date();
    const id = await this.prisma.db.$transaction(async (tx) => {
      const number = await this.counters.next(tx, 'prescription');
      const rx = await tx.prescription.create({
        data: {
          organizationId: ctx.organizationId!,
          branchId: ctx.branchId!,
          number,
          patientId: patient.id,
          clientId: owner.clientId,
          encounterId: input.encounterId ?? null,
          prescriberId: prescriber?.isClinician ? prescriber.id : null,
          weightKg,
          notes: input.notes,
          validUntil: input.validUntil ?? null,
          createdById: ctx.userId,
          createdByName: ctx.userName,
        },
      });
      const rows = evaluated.map(({ item, ev }) => ({
        organizationId: ctx.organizationId!,
        prescriptionId: rx.id,
        productId: item.productId,
        route: item.route,
        doseValue: item.doseValue,
        doseUnit: item.doseUnit,
        weightKgUsed: /\/kg$/i.test(item.doseUnit) ? weightKg : null,
        amountPerDose: ev.calculation.amount,
        frequencyPerDay: ev.frequency.perDay,
        frequencyText: ev.frequency.label,
        durationDays: item.durationDays ?? null,
        quantity: ev.quantity,
        repeats: item.repeats,
        instructions: item.instructions,
        doseReferenceId: ev.doseReferenceId,
        warnings: ev.warnings.length ? (ev.warnings as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        overrideReason: ev.requiresOverride ? item.overrideReason : null,
      }));
      await tx.prescriptionItem.createMany({ data: rows });
      await this.audit.record(
        {
          action: 'prescription.created',
          entityType: 'Prescription',
          entityId: rx.id,
          summary: `${prescriptionNo(number)}: ${evaluated.map(({ ev, item }) => `${ev.product.name} ${ev.calculation.amount} ${ev.product.dispensingUnit} ${item.frequencyCode}`).join('; ')}`,
          changes: evaluated.some(({ ev }) => ev.requiresOverride)
            ? { overrides: { from: null, to: evaluated.filter(({ ev }) => ev.requiresOverride).map(({ ev, item }) => `${ev.product.name}: ${item.overrideReason}`) } }
            : undefined,
        },
        tx,
      );
      if (input.authorize) await this.authorizeTx(tx, rx.id, now);
      return rx.id;
    });
    return this.get(id);
  }

  private async authorizeTx(tx: ScopedTx, id: string, at: Date) {
    const ctx = RequestContext.require();
    const rx = await tx.prescription.findUnique({ where: { id }, include: { items: true } });
    if (!rx) throw notFound('Prescription');
    if (rx.status !== 'DRAFT') throw ruleViolation('INVALID_TRANSITION', 'Only draft prescriptions can be authorised');
    // Allergy alerts may have been added (or a draft repeated) since the draft was written: check again at authorisation.
    const [alerts, products] = await Promise.all([
      tx.patientAlert.findMany({ where: { patientId: rx.patientId, isActive: true } }),
      tx.product.findMany({ where: { id: { in: rx.items.map((i) => i.productId) } } }),
    ]);
    for (const i of rx.items) {
      const product = products.find((p) => p.id === i.productId);
      const conflicts = product ? allergyConflicts(alerts, product) : [];
      if (conflicts.length && !i.overrideReason?.trim()) {
        throw ruleViolation('SAFETY_OVERRIDE_REQUIRED', `${allergyConflictText(conflicts[0], product!.name)}. Write a reason for overriding the allergy warning before authorising.`, {
          itemId: i.id,
          warnings: conflicts.map((c) => ({ code: 'ALLERGY', message: allergyConflictText(c, product!.name), blocking: true })),
        });
      }
    }
    const prescriber = ctx.membershipId ? await tx.membership.findUnique({ where: { id: ctx.membershipId } }) : null;
    await tx.prescription.update({
      where: { id },
      data: {
        status: 'AUTHORIZED',
        authorizedById: ctx.userId,
        authorizedByName: ctx.userName,
        authorizedAt: at,
        prescriberId: rx.prescriberId ?? (prescriber?.isClinician ? prescriber.id : null),
        contentHash: this.hash(rx.items, at, ctx.userId!),
      },
    });
    await this.audit.record({ action: 'prescription.authorized', entityType: 'Prescription', entityId: id, summary: prescriptionNo(rx.number) }, tx);
  }

  async authorize(id: string) {
    await this.prisma.db.$transaction((tx) => this.authorizeTx(tx, id, new Date()));
    return this.get(id);
  }

  async cancel(id: string, reason: string) {
    const rx = await this.prisma.db.prescription.findUnique({ where: { id } });
    if (!rx) throw notFound('Prescription');
    if (rx.status === 'CANCELLED' || rx.status === 'DISPENSED') throw ruleViolation('INVALID_TRANSITION', `A ${rx.status.toLowerCase()} prescription cannot be cancelled`);
    await this.prisma.db.$transaction(async (tx) => {
      await tx.prescription.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason } });
      await this.audit.record({ action: 'prescription.cancelled', entityType: 'Prescription', entityId: id, summary: `${prescriptionNo(rx.number)}: ${reason}` }, tx);
    });
    return this.get(id);
  }

  async dispense(id: string, input: { lines: { itemId: string; quantity: number; batchNumber?: string | null; expiryDate?: Date | null }[]; notes?: string | null }) {
    const ctx = RequestContext.require();
    const rx = await this.prisma.db.prescription.findUnique({ where: { id }, include: { items: { include: { product: true } }, patient: { include: { species: true } } } });
    if (!rx) throw notFound('Prescription');
    if (!['AUTHORIZED', 'PARTIALLY_DISPENSED'].includes(rx.status)) {
      throw ruleViolation('NOT_DISPENSABLE', rx.status === 'DRAFT' ? 'The prescription must be authorised by a veterinarian before dispensing' : `A ${rx.status.toLowerCase()} prescription cannot be dispensed`);
    }
    if (rx.validUntil && rx.validUntil < new Date(new Date().toDateString())) throw ruleViolation('EXPIRED', 'This prescription has expired');

    await this.prisma.db.$transaction(async (tx) => {
      for (const line of input.lines) {
        const item = rx.items.find((i) => i.id === line.itemId);
        if (!item) throw ruleViolation('INVALID_ITEM', 'Item does not belong to this prescription');
        const remaining = Number(item.quantity) * (1 + item.repeats) - Number(item.quantityDispensed);
        if (line.quantity > remaining + 1e-9) {
          throw ruleViolation('OVER_DISPENSE', `Only ${remaining} ${item.product.dispensingUnit} of ${item.product.name} remain on this prescription`);
        }
        if (line.expiryDate && line.expiryDate < new Date(new Date().toDateString())) {
          throw ruleViolation('EXPIRED_BATCH', `Batch ${line.batchNumber ?? ''} of ${item.product.name} has expired`);
        }
        const d = await tx.dispensation.create({
          data: {
            organizationId: ctx.organizationId!,
            prescriptionItemId: item.id,
            quantity: line.quantity,
            batchNumber: line.batchNumber,
            expiryDate: line.expiryDate ?? null,
            notes: input.notes,
            dispensedById: ctx.userId!,
            dispensedByName: ctx.userName ?? 'Unknown',
          },
        });
        await tx.prescriptionItem.update({ where: { id: item.id }, data: { quantityDispensed: { increment: line.quantity } } });
        for (const hook of this.dispenseHooks) await hook(tx, { dispensationId: d.id, product: item.product, quantity: line.quantity, batchNumber: line.batchNumber, branchId: ctx.branchId ?? rx.branchId });
        // Course is assumed to finish after the prescribed duration; withdrawal runs from the last dose.
        const lastDose = new Date(Date.now() + (item.durationDays ?? 0) * 86400_000);
        await this.withdrawals.record(tx, { patientId: rx.patientId, speciesId: rx.patient.speciesId, productId: item.productId, sourceType: 'DISPENSATION', sourceId: d.id, treatedAt: lastDose });
      }
      const items = await tx.prescriptionItem.findMany({ where: { prescriptionId: id } });
      const complete = items.every((i) => Number(i.quantityDispensed) + 1e-9 >= Number(i.quantity) * (1 + i.repeats));
      await tx.prescription.update({ where: { id }, data: { status: complete ? 'DISPENSED' : 'PARTIALLY_DISPENSED' } });
      await this.audit.record(
        {
          action: 'prescription.dispensed',
          entityType: 'Prescription',
          entityId: id,
          summary: `${prescriptionNo(rx.number)}: ${input.lines.map((l) => `${rx.items.find((i) => i.id === l.itemId)!.product.name} × ${l.quantity}${l.batchNumber ? ` (batch ${l.batchNumber})` : ''}`).join('; ')}`,
        },
        tx,
      );
    });
    await this.events.emit({ type: 'PRESCRIPTION_DISPENSED', prescriptionId: id });
    return this.get(id);
  }

  /** Creates a new draft copying a previous prescription (repeat / re-prescribe). */
  async repeat(id: string, encounterId: string | null = null) {
    const ctx = RequestContext.require();
    const src = await this.prisma.db.prescription.findUnique({ where: { id }, include: { items: true, patient: true } });
    if (!src) throw notFound('Prescription');
    if (src.patient.status !== 'ACTIVE') throw ruleViolation('PATIENT_NOT_ACTIVE', 'The patient is not active');
    if (encounterId) {
      const e = await this.prisma.db.encounter.findUnique({ where: { id: encounterId } });
      if (!e || e.patientId !== src.patientId) throw ruleViolation('INVALID_ENCOUNTER', 'The consultation must belong to this patient');
    }
    const newId = await this.prisma.db.$transaction(async (tx) => {
      const number = await this.counters.next(tx, 'prescription');
      const rx = await tx.prescription.create({
        data: {
          organizationId: ctx.organizationId!,
          branchId: ctx.branchId!,
          number,
          patientId: src.patientId,
          clientId: src.clientId,
          encounterId,
          weightKg: src.patient.latestWeightKg ?? src.weightKg,
          notes: src.notes,
          repeatOfId: src.id,
          createdById: ctx.userId,
          createdByName: ctx.userName,
        },
      });
      await tx.prescriptionItem.createMany({
        data: src.items.map((i) => ({
          organizationId: ctx.organizationId!,
          prescriptionId: rx.id,
          productId: i.productId,
          route: i.route,
          doseValue: i.doseValue,
          doseUnit: i.doseUnit,
          weightKgUsed: i.weightKgUsed,
          amountPerDose: i.amountPerDose,
          frequencyPerDay: i.frequencyPerDay,
          frequencyText: i.frequencyText,
          durationDays: i.durationDays,
          quantity: i.quantity,
          repeats: 0,
          instructions: i.instructions,
          doseReferenceId: i.doseReferenceId,
          warnings: i.warnings ?? Prisma.JsonNull,
          overrideReason: i.overrideReason,
        })),
      });
      await this.audit.record({ action: 'prescription.repeated', entityType: 'Prescription', entityId: rx.id, summary: `Repeat of ${prescriptionNo(src.number)}` }, tx);
      return rx.id;
    });
    return this.get(newId);
  }

  async verify(id: string) {
    const rx = await this.prisma.db.prescription.findUnique({ where: { id }, include: { items: { orderBy: { createdAt: 'asc' } } } });
    if (!rx) throw notFound('Prescription');
    if (!rx.contentHash || !rx.authorizedAt || !rx.authorizedById) return { authorized: false, valid: null };
    return { authorized: true, valid: this.hash(rx.items, rx.authorizedAt, rx.authorizedById) === rx.contentHash };
  }
}
