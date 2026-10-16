import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { notFound, ruleViolation } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { ScopedTx } from '../../common/prisma/tenant-extension';
import { allergyMatches } from './prescriptions.service';
import { WithdrawalService } from './withdrawal.service';

export type AdministrationHook = (tx: ScopedTx, e: { administrationId: string; productId: string; dose: number; doseUnit: string; batchNumber?: string | null; branchId: string }) => Promise<void>;

/** Medication given in the clinic (injections, in-clinic doses, vaccines). */
@Injectable()
export class AdministrationsService {
  private readonly hooks: AdministrationHook[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly withdrawals: WithdrawalService,
  ) {}

  registerHook(h: AdministrationHook) {
    this.hooks.push(h);
  }

  async record(input: {
    patientId: string;
    encounterId?: string | null;
    productId: string;
    prescriptionItemId?: string | null;
    status: 'GIVEN' | 'NOT_GIVEN';
    dose: number;
    doseUnit: string;
    route: string;
    site?: string | null;
    batchNumber?: string | null;
    expiryDate?: Date | null;
    reasonNotGiven?: string | null;
    notes?: string | null;
    administeredAt?: Date | null;
    overrideReason?: string | null;
  }, within?: (tx: ScopedTx, administration: { id: string }) => Promise<void>) {
    const ctx = RequestContext.require();
    const patient = await this.prisma.db.patient.findUnique({ where: { id: input.patientId }, include: { alerts: { where: { isActive: true } } } });
    if (!patient) throw notFound('Patient');
    if (patient.status !== 'ACTIVE') throw ruleViolation('PATIENT_NOT_ACTIVE', 'The patient is not active');
    const product = await this.prisma.db.product.findUnique({ where: { id: input.productId } });
    if (!product || !product.isActive) throw ruleViolation('INVALID_PRODUCT', 'Product not found or inactive');
    if (input.encounterId) {
      const e = await this.prisma.db.encounter.findUnique({ where: { id: input.encounterId } });
      if (!e || e.patientId !== patient.id) throw ruleViolation('INVALID_ENCOUNTER', 'Consultation does not belong to this patient');
    }
    if (input.prescriptionItemId) {
      const item = await this.prisma.db.prescriptionItem.findUnique({ where: { id: input.prescriptionItemId }, include: { prescription: true } });
      if (!item || item.prescription.patientId !== patient.id || item.productId !== product.id) throw ruleViolation('INVALID_PRESCRIPTION', 'Prescription item does not match this patient and product');
      if (!['AUTHORIZED', 'PARTIALLY_DISPENSED', 'DISPENSED'].includes(item.prescription.status)) throw ruleViolation('NOT_AUTHORIZED', 'The prescription is not authorised');
    }
    if (input.status === 'NOT_GIVEN' && !input.reasonNotGiven) throw ruleViolation('REASON_REQUIRED', 'Record why the dose was not given');
    if (input.expiryDate && input.expiryDate < new Date(new Date().toDateString())) throw ruleViolation('EXPIRED_BATCH', 'This batch has expired');
    const allergies = input.status === 'GIVEN' ? allergyMatches(patient.alerts, product) : [];
    if (allergies.length && !input.overrideReason) {
      throw ruleViolation('SAFETY_OVERRIDE_REQUIRED', `Patient alert “${allergies[0].title}” matches ${product.name}`, {
        warnings: allergies.map((a) => ({ code: 'ALLERGY', message: `Patient alert “${a.title}” matches ${product.name}`, blocking: true })),
      });
    }
    const at = input.administeredAt ?? new Date();
    if (at.getTime() > Date.now() + 5 * 60_000) throw ruleViolation('FUTURE_TIME', 'Administration time cannot be in the future');
    const { overrideReason, ...data } = input;
    return this.prisma.db.$transaction(async (tx) => {
      const a = await tx.medicationAdministration.create({
        data: {
          ...data,
          notes: [data.notes, overrideReason && `Allergy override: ${overrideReason}`].filter(Boolean).join('\n') || null,
          administeredAt: at,
          organizationId: ctx.organizationId!,
          administeredById: ctx.userId!,
          administeredByName: ctx.userName ?? 'Unknown',
        },
      });
      if (input.status === 'GIVEN') {
        for (const h of this.hooks) await h(tx, { administrationId: a.id, productId: product.id, dose: input.dose, doseUnit: input.doseUnit, batchNumber: input.batchNumber, branchId: ctx.branchId! });
        await this.withdrawals.record(tx, { patientId: patient.id, speciesId: patient.speciesId, productId: product.id, sourceType: 'ADMINISTRATION', sourceId: a.id, treatedAt: at });
      }
      // Callers (e.g. the hospital treatment sheet) can record their own changes in the same transaction.
      if (within) await within(tx, a);
      await this.audit.record(
        {
          action: input.status === 'GIVEN' ? 'medication.administered' : 'medication.not_given',
          entityType: 'Patient',
          entityId: patient.id,
          summary: `${product.name} ${input.dose} ${input.doseUnit} ${input.route}${input.batchNumber ? ` batch ${input.batchNumber}` : ''}${overrideReason ? ` (allergy override: ${overrideReason})` : ''}`,
        },
        tx,
      );
      return { ...a, dose: Number(a.dose) };
    });
  }

  async list(patientId: string, encounterId?: string) {
    const rows = await this.prisma.db.medicationAdministration.findMany({
      where: { patientId, encounterId },
      include: { product: { select: { id: true, name: true, dispensingUnit: true } } },
      orderBy: { administeredAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => ({ ...r, dose: Number(r.dose) }));
  }
}
