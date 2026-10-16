import { Injectable, OnModuleInit } from '@nestjs/common';
import { env } from '../../config/env';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ClientMergeService } from '../clients/client-merge.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { ClientPrivacyService } from '../clients/client-privacy.service';

@Injectable()
export class CommsIntegrations implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly privacy: ClientPrivacyService,
    private readonly dashboard: DashboardService,
    private readonly clientMerge: ClientMergeService,
  ) {}

  onModuleInit() {
    const portal = env().CLIENT_PORTAL_ENABLED;
    this.dashboard.register({
      key: 'communications',
      permission: 'communications.read',
      load: async () => {
        const db = this.prisma.db;
        const [unreadMessages, pendingRequests, failedMessages] = await Promise.all([
          portal ? db.clientMessage.count({ where: { direction: 'INBOUND', readAt: null } }) : 0,
          portal ? db.appointmentRequest.count({ where: { status: 'PENDING' } }) : 0,
          db.outboundMessage.count({ where: { status: 'FAILED', createdAt: { gte: new Date(Date.now() - 7 * 86400_000) } } }),
        ]);
        return { unreadMessages, pendingRequests, failedMessages };
      },
    });
    // Client-portal records follow a client merge even while the portal is switched off.
    this.clientMerge.register({ name: 'clientMessages', run: async (tx, s, m) => (await tx.clientMessage.updateMany({ where: { clientId: m }, data: { clientId: s } })).count });
    this.clientMerge.register({ name: 'appointmentRequests', run: async (tx, s, m) => (await tx.appointmentRequest.updateMany({ where: { clientId: m }, data: { clientId: s } })).count });
    // Portal logins stay with their own record: the merged client's access is switched off (survivor can be invited).
    this.clientMerge.register({ name: 'portalAccess', run: async (tx, _s, m) => (await tx.portalAccess.updateMany({ where: { clientId: m }, data: { isActive: false } })).count });

    this.privacy.registerExport({
      name: 'communications',
      load: async (clientId) => ({
        messagesSent: await this.prisma.db.outboundMessage.findMany({ where: { clientId }, orderBy: { createdAt: 'asc' } }),
        clientMessages: await this.prisma.db.clientMessage.findMany({ where: { clientId }, orderBy: { createdAt: 'asc' } }),
      }),
    });
    // Anonymisation: delivery log keeps the fact a message was sent, without the address or content.
    this.privacy.registerAnonymise({
      name: 'communications',
      run: async (tx, clientId) => {
        const n = (await tx.outboundMessage.updateMany({ where: { clientId }, data: { recipient: 'removed', subject: null, body: '[removed on anonymisation]' } })).count;
        // Portal correspondence is locked; the database allows exactly this redaction (migration client_message_redaction).
        await tx.clientMessage.updateMany({ where: { clientId, direction: 'OUTBOUND' }, data: { subject: null, body: '[removed on anonymisation]' } });
        await tx.clientMessage.updateMany({ where: { clientId, direction: 'INBOUND' }, data: { subject: null, body: '[removed on anonymisation]', authorName: 'Anonymised client' } });
        await tx.portalAccess.updateMany({ where: { clientId }, data: { isActive: false } });
        return n;
      },
    });
  }
}
