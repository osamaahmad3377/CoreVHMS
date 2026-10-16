import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { notFound } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MessagesService } from './messages.service';

/** Secure client ↔ clinic messaging (staff side). The portal side lives in the portal module. */
@Injectable()
export class ClientMessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly messages: MessagesService,
  ) {}

  /** Conversations with the latest message and unread inbound count. */
  async inbox() {
    const db = this.prisma.db;
    const latest = await db.clientMessage.findMany({ distinct: ['clientId'], orderBy: [{ clientId: 'asc' }, { createdAt: 'desc' }], take: 200, include: { client: { select: { id: true, displayName: true } } } });
    const unread = await db.clientMessage.groupBy({ by: ['clientId'], where: { direction: 'INBOUND', readAt: null }, _count: true });
    return latest
      .map((m) => ({ client: m.client, last: { body: m.body.slice(0, 160), subject: m.subject, kind: m.kind, direction: m.direction, createdAt: m.createdAt }, unread: unread.find((u) => u.clientId === m.clientId)?._count ?? 0 }))
      .sort((a, b) => b.unread - a.unread || b.last.createdAt.getTime() - a.last.createdAt.getTime());
  }

  async unreadCount() {
    return { unread: await this.prisma.db.clientMessage.count({ where: { direction: 'INBOUND', readAt: null } }) };
  }

  /** The thread with one client; opening it marks the client's messages as read. */
  async thread(clientId: string) {
    const db = this.prisma.db;
    const client = await db.client.findUnique({ where: { id: clientId }, select: { id: true, displayName: true, email: true } });
    if (!client) throw notFound('Client');
    await db.clientMessage.updateMany({ where: { clientId, direction: 'INBOUND', readAt: null }, data: { readAt: new Date() } });
    const rows = await db.clientMessage.findMany({ where: { clientId }, orderBy: { createdAt: 'asc' }, take: 500 });
    return { client, messages: rows };
  }

  async reply(clientId: string, body: string, subject?: string | null) {
    const ctx = RequestContext.require();
    const client = await this.prisma.db.client.findUnique({ where: { id: clientId } });
    if (!client) throw notFound('Client');
    const portal = await this.prisma.db.portalAccess.findFirst({ where: { clientId, isActive: true } });
    const org = await this.prisma.raw.organization.findUniqueOrThrow({ where: { id: ctx.organizationId! } });
    return this.prisma.db.$transaction(async (tx) => {
      const m = await tx.clientMessage.create({ data: { organizationId: ctx.organizationId!, clientId, direction: 'OUTBOUND', subject: subject ?? null, body, authorName: ctx.userName ?? 'Clinic', staffUserId: ctx.userId } });
      // Let the client know there is a message waiting (the content itself stays in the portal).
      if (portal && client.email) {
        await this.messages.enqueueTemplate(tx, 'GENERAL', 'EMAIL', { clinicName: org.name, body: `Hello ${client.displayName},\n\nYou have a new message from ${org.name} in the client portal.` }, { clientId, recipient: client.email, sourceType: 'ClientMessage', sourceId: m.id, dedupeKey: `portal-msg:${m.id}` });
      }
      await this.audit.record({ action: 'client_message.sent', entityType: 'Client', entityId: clientId, summary: subject ?? body.slice(0, 60) }, tx);
      return m;
    });
  }
}
