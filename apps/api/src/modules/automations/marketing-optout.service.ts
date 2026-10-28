import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { notFound } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { readUnsubscribeToken } from './unsubscribe';

/**
 * Clients stopping offers themselves: the link in every promotional email, or replying STOP on WhatsApp. Only
 * marketing stops — reminders and other messages about their animals carry on.
 */
@Injectable()
export class MarketingOptOutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async open(token: string) {
    const t = readUnsubscribeToken(token);
    if (!t) throw notFound('Link');
    return RequestContext.runAs({ organizationId: t.organizationId, userName: 'Client (unsubscribe link)' }, async () => {
      const [client, org] = await Promise.all([
        this.prisma.db.client.findUnique({ where: { id: t.clientId }, select: { id: true, marketingConsent: true, status: true } }),
        this.prisma.raw.organization.findUnique({ where: { id: t.organizationId }, select: { name: true, brandName: true } }),
      ]);
      if (!client || !org || client.status === 'MERGED') throw notFound('Link');
      return { t, client, clinicName: org.brandName ?? org.name };
    });
  }

  /** What the "Stop offers" page shows (the clinic's name, and whether offers are already off). */
  async describe(token: string) {
    const { clinicName, client } = await this.open(token);
    return { clinicName, offersOn: client.marketingConsent };
  }

  async unsubscribe(token: string) {
    const { t, clinicName } = await this.open(token);
    await RequestContext.runAs({ organizationId: t.organizationId, userName: 'Client (unsubscribe link)' }, () => this.stop(t.clientId, 'unsubscribe link'));
    return { clinicName, offersOn: false };
  }

  /** Switches offers off for a client (inside the clinic's context). */
  async stop(clientId: string, how: string) {
    await this.prisma.db.$transaction(async (tx) => {
      const r = await tx.client.updateMany({ where: { id: clientId, marketingConsent: true }, data: { marketingConsent: false, consentUpdatedAt: new Date() } });
      if (r.count) await this.audit.record({ action: 'client.marketing_stopped', entityType: 'Client', entityId: clientId, summary: `Stopped offers (${how})`, actorUserId: null }, tx);
    });
  }
}
