import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { notFound, ruleViolation } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { ScopedTx } from '../../common/prisma/tenant-extension';

export interface PatientMergeStep {
  name: string;
  run(tx: ScopedTx, survivorId: string, mergedId: string): Promise<number>;
}

/** Merges a duplicate patient registration into the surviving record. Modules register steps for their data. */
@Injectable()
export class PatientMergeService {
  private readonly steps: PatientMergeStep[] = [
    {
      name: 'identifiers',
      run: async (tx, s, m) => (await tx.patientIdentifier.updateMany({ where: { patientId: m }, data: { patientId: s } })).count,
    },
    {
      name: 'weights',
      run: async (tx, s, m) => (await tx.weightRecord.updateMany({ where: { patientId: m }, data: { patientId: s } })).count,
    },
    {
      name: 'alerts',
      run: async (tx, s, m) => (await tx.patientAlert.updateMany({ where: { patientId: m }, data: { patientId: s } })).count,
    },
    {
      name: 'ownershipHistory',
      // The survivor keeps its current owners; the duplicate's ownership rows are kept as closed history.
      run: async (tx, s, m) =>
        (
          await tx.patientOwnership.updateMany({
            where: { patientId: m },
            data: { patientId: s, endedAt: new Date(), endReason: 'Merged duplicate record' },
          })
        ).count,
    },
    {
      name: 'attachments',
      run: async (tx, s, m) =>
        (await tx.attachment.updateMany({ where: { entityType: 'Patient', entityId: m }, data: { entityId: s } })).count,
    },
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  register(step: PatientMergeStep) {
    this.steps.push(step);
  }

  async merge(survivorId: string, mergedId: string, reason: string) {
    if (survivorId === mergedId) throw ruleViolation('SAME_PATIENT', 'Choose two different patients to merge');
    return this.prisma.db.$transaction(
      async (tx) => {
        const [s, m] = await Promise.all([
          tx.patient.findUnique({ where: { id: survivorId } }),
          tx.patient.findUnique({ where: { id: mergedId } }),
        ]);
        if (!s || !m) throw notFound('Patient');
        if (s.status === 'MERGED' || m.status === 'MERGED') throw ruleViolation('ALREADY_MERGED', 'One of these patients has already been merged');
        if (s.speciesId !== m.speciesId) throw ruleViolation('SPECIES_MISMATCH', 'Patients of different species cannot be merged');

        // Closed ownership rows from the duplicate must not violate the "one current primary owner" rule.
        const moved: Record<string, number> = {};
        for (const step of this.steps) moved[step.name] = await step.run(tx, survivorId, mergedId);

        const latest = await tx.weightRecord.findFirst({ where: { patientId: survivorId }, orderBy: { measuredAt: 'desc' } });
        await tx.patient.update({
          where: { id: survivorId },
          data: {
            latestWeightKg: latest?.weightKg ?? s.latestWeightKg,
            dateOfBirth: s.dateOfBirth ?? m.dateOfBirth,
            breedId: s.breedId ?? m.breedId,
            colour: s.colour ?? m.colour,
            markings: s.markings ?? m.markings,
          },
        });
        await tx.patient.update({
          where: { id: mergedId },
          data: { status: 'MERGED', mergedIntoId: survivorId, archivedAt: new Date(), archivedReason: reason },
        });
        const summary = `Merged ${m.name} (P-${m.number}) into ${s.name} (P-${s.number}): ${reason}`;
        await this.audit.record({ action: 'patient.merged', entityType: 'Patient', entityId: survivorId, summary, changes: { moved } }, tx);
        await this.audit.record({ action: 'patient.merged_away', entityType: 'Patient', entityId: mergedId, summary, changes: { moved } }, tx);
        return { survivorId, mergedId, moved };
      },
      { timeout: 60_000 },
    );
  }
}
