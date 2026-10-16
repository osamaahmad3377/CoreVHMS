import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { notFound, ruleViolation } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { ScopedTx } from '../../common/prisma/tenant-extension';

/**
 * A step that re-points records owned by the merged client to the survivor.
 * Modules that add client-owned data (appointments, invoices, …) register a step here
 * so a merge never leaves orphaned records behind.
 */
export interface ClientMergeStep {
  name: string;
  run(tx: ScopedTx, survivorId: string, mergedId: string): Promise<number>;
}

@Injectable()
export class ClientMergeService {
  private readonly steps: ClientMergeStep[] = [
    {
      name: 'patientOwnerships',
      run: async (tx, s, m) => (await tx.patientOwnership.updateMany({ where: { clientId: m }, data: { clientId: s } })).count,
    },
    {
      name: 'addresses',
      run: async (tx, s, m) =>
        (await tx.address.updateMany({ where: { clientId: m }, data: { clientId: s, isPrimary: false } })).count,
    },
    {
      name: 'contacts',
      run: async (tx, s, m) => (await tx.clientContact.updateMany({ where: { clientId: m }, data: { clientId: s } })).count,
    },
    {
      name: 'notes',
      run: async (tx, s, m) => (await tx.clientNote.updateMany({ where: { clientId: m }, data: { clientId: s } })).count,
    },
    {
      name: 'attachments',
      run: async (tx, s, m) =>
        (await tx.attachment.updateMany({ where: { entityType: 'Client', entityId: m }, data: { entityId: s } })).count,
    },
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  register(step: ClientMergeStep) {
    this.steps.push(step);
  }

  async merge(survivorId: string, mergedId: string, reason: string) {
    if (survivorId === mergedId) throw ruleViolation('SAME_CLIENT', 'Choose two different clients to merge');
    return this.prisma.db.$transaction(
      async (tx) => {
        const [survivor, merged] = await Promise.all([
          tx.client.findUnique({ where: { id: survivorId } }),
          tx.client.findUnique({ where: { id: mergedId } }),
        ]);
        if (!survivor || !merged) throw notFound('Client');
        if (survivor.status === 'MERGED' || merged.status === 'MERGED') {
          throw ruleViolation('ALREADY_MERGED', 'One of these clients has already been merged');
        }
        const moved: Record<string, number> = {};
        for (const step of this.steps) moved[step.name] = await step.run(tx, survivorId, mergedId);

        await tx.client.update({
          where: { id: survivorId },
          data: {
            balanceMinor: survivor.balanceMinor + merged.balanceMinor,
            email: survivor.email ?? merged.email,
            mobilePhone: survivor.mobilePhone ?? merged.mobilePhone,
            phoneDigits: survivor.phoneDigits ?? merged.phoneDigits,
            homePhone: survivor.homePhone ?? merged.homePhone,
            workPhone: survivor.workPhone ?? merged.workPhone,
          },
        });
        await tx.client.update({
          where: { id: mergedId },
          data: { status: 'MERGED', mergedIntoId: survivorId, balanceMinor: 0, archivedAt: new Date(), archivedReason: reason },
        });
        const summary = `Merged ${merged.displayName} into ${survivor.displayName}: ${reason}`;
        await this.audit.record({ action: 'client.merged', entityType: 'Client', entityId: survivorId, summary, changes: { moved } }, tx);
        await this.audit.record({ action: 'client.merged_away', entityType: 'Client', entityId: mergedId, summary, changes: { moved } }, tx);
        return { survivorId, mergedId, moved };
      },
      { timeout: 60_000 },
    );
  }
}
