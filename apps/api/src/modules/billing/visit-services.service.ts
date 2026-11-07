import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { ServiceCategory } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { notFound, ruleViolation } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ChargeCaptureService } from './charge-capture.service';

const SOURCE = 'VisitService';

/**
 * Services done during a consultation and charged with it — e.g. grooming (nail trim, ear clean) chosen in the
 * visit's first step. Each one is a charge on the visit; prices come from Services & prices.
 */
@Injectable()
export class VisitServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly charges: ChargeCaptureService,
  ) {}

  private async encounter(id: string) {
    const enc = await this.prisma.db.encounter.findUnique({ where: { id } });
    if (!enc) throw notFound('Consultation');
    return enc;
  }

  /** The clinic's services in one group (offered ones only), and those already added to this visit. */
  async list(encounterId: string, category: ServiceCategory) {
    await this.encounter(encounterId);
    const group = await this.prisma.db.service.findMany({ where: { category }, orderBy: [{ name: 'asc' }], select: { id: true, name: true, priceMinor: true, isActive: true } });
    const added = await this.prisma.db.charge.findMany({
      where: { encounterId, sourceType: SOURCE, status: { not: 'WAIVED' }, serviceId: { in: group.map((s) => s.id) } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, serviceId: true, description: true, unitPriceMinor: true, status: true },
    });
    return { options: group.filter((s) => s.isActive).map(({ isActive: _, ...s }) => s), added };
  }

  async add(encounterId: string, serviceId: string) {
    const enc = await this.encounter(encounterId);
    if (enc.status !== 'OPEN') throw ruleViolation('ENCOUNTER_CLOSED', 'This consultation is finished');
    const svc = await this.prisma.db.service.findUnique({ where: { id: serviceId } });
    if (!svc || !svc.isActive) throw ruleViolation('INVALID_SERVICE', 'Service not found or switched off');
    if (svc.priceMinor <= 0) throw ruleViolation('NO_PRICE', `Give “${svc.name}” a price in Settings → Services & prices first`);
    return this.prisma.db.$transaction(async (tx) => {
      const already = await tx.charge.findFirst({ where: { encounterId, sourceType: SOURCE, serviceId, status: { not: 'WAIVED' } } });
      if (already) return already;
      const charge = await this.charges.capture(tx, {
        sourceType: SOURCE,
        sourceId: randomUUID(),
        clientId: enc.clientId,
        patientId: enc.patientId,
        encounterId: enc.id,
        branchId: enc.branchId,
        kind: 'SERVICE',
        serviceId: svc.id,
        description: svc.name,
        quantity: 1,
        unitPriceMinor: svc.priceMinor,
        taxRateBasisPoints: await this.charges.taxFor(tx, svc.taxRateId),
      });
      await this.audit.record({ action: 'encounter.service_added', entityType: 'Patient', entityId: enc.patientId, summary: svc.name }, tx);
      return charge;
    });
  }

  async remove(encounterId: string, chargeId: string) {
    const enc = await this.encounter(encounterId);
    const charge = await this.prisma.db.charge.findFirst({ where: { id: chargeId, encounterId, sourceType: SOURCE } });
    if (!charge) throw notFound('Service');
    if (charge.status === 'INVOICED') throw ruleViolation('ALREADY_INVOICED', 'This service has been invoiced; issue a credit note instead');
    return this.prisma.db.$transaction(async (tx) => {
      await this.charges.waiveForSource(tx, SOURCE, [charge.sourceId], 'Taken off the consultation');
      await this.audit.record({ action: 'encounter.service_removed', entityType: 'Patient', entityId: enc.patientId, summary: charge.description }, tx);
      return { removed: true };
    });
  }
}
