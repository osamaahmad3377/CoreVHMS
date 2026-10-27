import type { ClinicPayment, Tenant } from '@prisma/client';
import { receiptNumber, type ClinicPaymentView } from '@vcms/shared';

/** A clinic payment as the super admin (and the clinic owner, as a receipt) sees it. */
export function toPayment(p: ClinicPayment & { tenant: Pick<Tenant, 'name'> }): ClinicPaymentView {
  return {
    id: p.id,
    receipt: receiptNumber(p.number),
    clinicId: p.tenantId,
    clinicName: p.tenant.name,
    planName: p.planName,
    billingCycle: p.billingCycle,
    amountMinor: p.amountMinor,
    currency: p.currency,
    paidMonths: p.paidMonths,
    freeMonths: p.freeMonths,
    periodStart: p.periodStart.toISOString(),
    periodEnd: p.periodEnd.toISOString(),
    paidAt: p.paidAt.toISOString(),
    method: p.method,
    reference: p.reference,
    note: p.note,
    recordedByName: p.recordedByName,
    createdAt: p.createdAt.toISOString(),
    voidedAt: p.voidedAt?.toISOString() ?? null,
    voidedByName: p.voidedByName,
    voidReason: p.voidReason,
  };
}
