import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { notFound, ruleViolation } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { ScopedTx } from '../../common/prisma/tenant-extension';
import { clientNo } from './clients.service';

export interface ClientExportSection {
  name: string;
  load(clientId: string, patientIds: string[]): Promise<unknown>;
}

export interface ClientAnonymiseStep {
  name: string;
  /** Throw a rule violation to block anonymisation (e.g. an animal still in hospital). */
  check?(clientId: string): Promise<void>;
  run(tx: ScopedTx, clientId: string): Promise<number>;
}

/**
 * Data-subject requests for clients: a complete export of what the clinic holds about a client, and
 * anonymisation (removal of personal details) on request. Clinical and financial records are retained,
 * because veterinary and tax record-keeping rules usually require it; they stay linked to the now
 * anonymous client record. Modules register their own export sections and anonymisation steps.
 */
@Injectable()
export class ClientPrivacyService {
  private readonly sections: ClientExportSection[] = [];
  private readonly steps: ClientAnonymiseStep[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  registerExport(section: ClientExportSection) {
    this.sections.push(section);
  }

  registerAnonymise(step: ClientAnonymiseStep) {
    this.steps.push(step);
  }

  async export(clientId: string) {
    const db = this.prisma.db;
    const client = await db.client.findUnique({ where: { id: clientId }, include: { addresses: true, contacts: true, clientNotes: { orderBy: { createdAt: 'asc' } } } });
    if (!client) throw notFound('Client');
    const ownerships = await db.patientOwnership.findMany({ where: { clientId }, orderBy: { startedAt: 'asc' } });
    const patientIds = [...new Set(ownerships.map((o) => o.patientId))];
    const patients = await db.patient.findMany({
      where: { id: { in: patientIds } },
      include: { species: { select: { name: true } }, breed: { select: { name: true } }, identifiers: true, weights: { orderBy: { measuredAt: 'asc' } }, alerts: true },
    });
    const sections: Record<string, unknown> = {};
    for (const s of this.sections) sections[s.name] = await s.load(clientId, patientIds);
    const org = await this.prisma.raw.organization.findUniqueOrThrow({ where: { id: RequestContext.orgId() }, select: { name: true, legalName: true, email: true, phone: true } });
    await this.audit.record({ action: 'client.data_exported', entityType: 'Client', entityId: clientId, summary: `${clientNo(client.number)} — ${Object.keys(sections).length + 3} sections` });
    return {
      format: 'nextcore-vcms/client-export',
      version: 1,
      exportedAt: new Date().toISOString(),
      exportedBy: RequestContext.get()?.userName ?? null,
      controller: org,
      client,
      ownerships,
      patients: patients.map((p) => ({ ...p, latestWeightKg: p.latestWeightKg === null ? null : Number(p.latestWeightKg), weights: p.weights.map((w) => ({ ...w, weightKg: Number(w.weightKg) })) })),
      ...sections,
    };
  }

  async anonymise(clientId: string, reason: string) {
    const client = await this.prisma.db.client.findUnique({ where: { id: clientId } });
    if (!client) throw notFound('Client');
    if (client.anonymisedAt) throw ruleViolation('ALREADY_ANONYMISED', 'This client has already been anonymised');
    if (client.status === 'MERGED') throw ruleViolation('CLIENT_MERGED', 'Anonymise the surviving client record instead');
    if (client.balanceMinor !== 0) throw ruleViolation('BALANCE_NOT_SETTLED', 'Settle the client’s outstanding balance or credit first');
    for (const s of this.steps) await s.check?.(clientId);
    const number = clientNo(client.number);
    return this.prisma.db.$transaction(
      async (tx) => {
        await tx.address.deleteMany({ where: { clientId } });
        await tx.clientContact.deleteMany({ where: { clientId } });
        await tx.clientNote.deleteMany({ where: { clientId } });
        await tx.client.update({
          where: { id: clientId },
          data: {
            title: null, firstName: null, lastName: null, organizationName: null, displayName: `Anonymised client ${number}`,
            email: null, mobilePhone: null, homePhone: null, workPhone: null, phoneDigits: null, nationalId: null, taxNumber: null,
            preferredLanguage: null, notes: null, referralSource: null, marketingConsent: false, remindersConsent: false, consentUpdatedAt: new Date(),
            status: 'ARCHIVED', archivedAt: client.archivedAt ?? new Date(), archivedReason: 'Anonymised on request', anonymisedAt: new Date(),
          },
        });
        const counts: Record<string, number> = {};
        for (const s of this.steps) counts[s.name] = await s.run(tx, clientId);
        // The audit entry deliberately contains no personal details.
        await this.audit.record({ action: 'client.anonymised', entityType: 'Client', entityId: clientId, summary: `${number}: ${reason.slice(0, 200)}` }, tx);
        return { anonymised: true, clientNo: number, steps: counts };
      },
      { timeout: 60_000 },
    );
  }
}
