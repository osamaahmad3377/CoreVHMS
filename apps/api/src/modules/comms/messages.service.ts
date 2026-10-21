import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { MessageChannel, OutboundMessage, Prisma } from '@prisma/client';
import { toWhatsAppNumber } from '@vcms/shared';
import { AuditService } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { notFound, ruleViolation } from '../../common/http/errors';
import { EmailBrand, emailBrandOf } from '../../common/mail/mail.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenancyService } from '../../common/tenancy/tenancy.service';
import type { ScopedTx } from '../../common/prisma/tenant-extension';
import { WhatsAppService } from '../integrations/whatsapp.service';
import { ChannelRegistry } from './channels';
import { defaultTemplate, renderTemplate, TemplatesService } from './templates.service';

export const MAX_ATTEMPTS = 5;
/** Per-organisation sending limit per minute (protects provider accounts and clients from bursts). */
export const ORG_RATE_PER_MINUTE = 60;

export interface EnqueueInput {
  clientId?: string | null;
  patientId?: string | null;
  channel: MessageChannel;
  recipient: string | null;
  subject?: string | null;
  body: string;
  purpose: string;
  dedupeKey?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  /** The values the text was written from (a WhatsApp template or an email fallback is filled from them). */
  vars?: Record<string, string | number | null | undefined> | null;
}

/** The contact details a channel choice needs. */
export interface ClientContactInfo {
  email: string | null;
  mobilePhone: string | null;
  preferredChannel: string;
}

type Db = ScopedTx | PrismaService['db'];

/**
 * Outgoing message queue and delivery log. Messages are stored first and sent by a background
 * dispatcher with retries and back-off, so a failed notification never undoes the business change
 * that triggered it, and a dedupe key guarantees the same notification is not sent twice.
 */
@Injectable()
export class MessagesService implements OnModuleInit {
  private readonly log = new Logger(MessagesService.name);
  private dispatching = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly channels: ChannelRegistry,
    private readonly templates: TemplatesService,
    private readonly tenancy: TenancyService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  onModuleInit() {
    // WhatsApp accepted a message but later could not deliver it: send it by email instead when the clinic wants that.
    this.whatsapp.onFailed(async (m) => {
      const msg = await this.prisma.raw.outboundMessage.findUnique({ where: { id: m.id } });
      if (msg) await this.fallbackToEmail(msg);
    });
  }

  /**
   * The channel for a client: their preferred one when it works for this clinic, otherwise the next that does.
   * With WhatsApp set to "every client with a mobile", WhatsApp comes first unless the client asked for email.
   */
  async chooseChannel(client: ClientContactInfo): Promise<MessageChannel> {
    const orgId = RequestContext.orgId();
    const preferred = (['EMAIL', 'SMS', 'WHATSAPP'].includes(client.preferredChannel) ? client.preferredChannel : 'SMS') as MessageChannel;
    const wa = await this.whatsapp.sending(orgId);
    const order: MessageChannel[] = wa.active && wa.policy === 'ALL_MOBILE' && preferred !== 'EMAIL' ? ['WHATSAPP', preferred, 'EMAIL', 'SMS'] : [preferred, 'EMAIL', 'WHATSAPP', 'SMS'];
    for (const ch of [...new Set(order)]) {
      if (MessagesService.recipientFor(client, ch) && (await this.channels.forOrg(ch, orgId)).configured) return ch;
    }
    return preferred;
  }

  /** Stores a message for delivery. Returns the existing message when the dedupe key was already used. */
  async enqueue(db: Db, input: EnqueueInput): Promise<OutboundMessage> {
    const orgId = RequestContext.orgId();
    if (input.dedupeKey) {
      const existing = await db.outboundMessage.findFirst({ where: { dedupeKey: input.dedupeKey } });
      if (existing) return existing;
    }
    const adapter = await this.channels.forOrg(input.channel, orgId);
    let recipient = input.recipient;
    // WhatsApp needs the number in international form (country code, digits only).
    if (input.channel === 'WHATSAPP' && recipient) {
      const org = await this.prisma.raw.organization.findUnique({ where: { id: orgId }, select: { country: true } });
      recipient = toWhatsAppNumber(recipient, org?.country);
    }
    const skipReason = !recipient
      ? input.channel === 'WHATSAPP' && input.recipient
        ? 'The mobile number is not a full WhatsApp number'
        : 'No contact details for this channel'
      : !adapter.configured
        ? input.channel === 'WHATSAPP'
          ? 'WhatsApp is not connected (Settings → Integrations)'
          : `No ${input.channel} provider is configured`
        : null;
    try {
      return await db.outboundMessage.create({
        data: {
          organizationId: orgId,
          clientId: input.clientId ?? null,
          patientId: input.patientId ?? null,
          channel: input.channel,
          recipient: recipient ?? input.recipient ?? '—',
          subject: input.subject ?? null,
          body: input.body,
          purpose: input.purpose,
          dedupeKey: input.dedupeKey ?? null,
          sourceType: input.sourceType ?? null,
          sourceId: input.sourceId ?? null,
          templateVars: input.vars ? (input.vars as Prisma.InputJsonValue) : undefined,
          status: skipReason ? 'SKIPPED' : 'QUEUED',
          lastError: skipReason,
          createdByName: RequestContext.get()?.userName ?? 'System',
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && input.dedupeKey) {
        return db.outboundMessage.findFirstOrThrow({ where: { dedupeKey: input.dedupeKey } });
      }
      throw e;
    }
  }

  /** Renders a template for the purpose and channel, then enqueues it. */
  async enqueueTemplate(db: Db, purpose: string, channel: MessageChannel, vars: Record<string, string | number | null | undefined>, input: Omit<EnqueueInput, 'subject' | 'body' | 'purpose' | 'channel'>) {
    const t = await this.templates.get(purpose, channel);
    if (!t) throw ruleViolation('NO_TEMPLATE', `No active ${purpose} template for ${channel}`);
    return this.enqueue(db, { ...input, channel, purpose, vars, subject: t.subject ? renderTemplate(t.subject, vars) : null, body: renderTemplate(t.body, vars) });
  }

  /** Which contact detail to use for a client and channel. */
  static recipientFor(client: { email: string | null; mobilePhone: string | null }, channel: MessageChannel) {
    return channel === 'EMAIL' ? client.email : client.mobilePhone;
  }

  /** Staff-composed message to a client (logged; delivered by the dispatcher). */
  async sendManual(input: { clientId: string; patientId?: string | null; channel: MessageChannel; subject?: string | null; body: string }) {
    const client = await this.prisma.db.client.findUnique({ where: { id: input.clientId } });
    if (!client) throw notFound('Client');
    const org = await this.prisma.raw.organization.findUniqueOrThrow({ where: { id: RequestContext.orgId() } });
    return this.prisma.db.$transaction(async (tx) => {
      const m = await this.enqueueTemplate(tx, 'GENERAL', input.channel, { body: input.body, clinicName: org.name, clientName: client.displayName }, {
        clientId: client.id,
        patientId: input.patientId,
        recipient: MessagesService.recipientFor(client, input.channel),
        sourceType: 'Manual',
      });
      if (input.subject && m.status !== 'SKIPPED') await tx.outboundMessage.update({ where: { id: m.id }, data: { subject: input.subject } });
      await this.audit.record({ action: 'message.sent_manual', entityType: 'Client', entityId: client.id, summary: `${input.channel}: ${input.subject ?? input.body.slice(0, 60)}` }, tx);
      return m;
    });
  }

  async list(q: { page: number; pageSize: number; status?: string; channel?: string; clientId?: string; purpose?: string }) {
    const where: Prisma.OutboundMessageWhereInput = { status: (q.status as any) || undefined, channel: (q.channel as any) || undefined, clientId: q.clientId, purpose: q.purpose || undefined };
    const [rows, total, counts] = await Promise.all([
      this.prisma.db.outboundMessage.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.db.outboundMessage.count({ where }),
      this.prisma.db.outboundMessage.groupBy({ by: ['status'], _count: true, where: { createdAt: { gte: new Date(Date.now() - 30 * 86400_000) } } }),
    ]);
    const clientIds = [...new Set(rows.map((r) => r.clientId).filter(Boolean))] as string[];
    const clients = await this.prisma.db.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, displayName: true } });
    return {
      data: rows.map((r) => ({ ...r, client: clients.find((c) => c.id === r.clientId) ?? null })),
      meta: { page: q.page, pageSize: q.pageSize, total },
      last30Days: Object.fromEntries(counts.map((c) => [c.status, c._count])),
      channels: await this.channels.status(RequestContext.orgId()),
    };
  }

  async retry(id: string) {
    const m = await this.prisma.db.outboundMessage.findUnique({ where: { id } });
    if (!m) throw notFound('Message');
    if (m.status !== 'FAILED') throw ruleViolation('NOT_FAILED', 'Only failed messages can be retried');
    return this.prisma.db.$transaction(async (tx) => {
      const after = await tx.outboundMessage.update({ where: { id }, data: { status: 'QUEUED', attempts: 0, nextAttemptAt: new Date(), lastError: null } });
      await this.audit.record({ action: 'message.retried', entityType: 'Client', entityId: m.clientId ?? RequestContext.orgId(), summary: m.subject ?? m.purpose }, tx);
      return after;
    });
  }

  async cancel(id: string) {
    const m = await this.prisma.db.outboundMessage.findUnique({ where: { id } });
    if (!m) throw notFound('Message');
    if (m.status !== 'QUEUED') throw ruleViolation('NOT_QUEUED', 'Only queued messages can be cancelled');
    const r = await this.prisma.db.outboundMessage.updateMany({ where: { id, status: 'QUEUED' }, data: { status: 'CANCELLED' } });
    if (!r.count) throw ruleViolation('NOT_QUEUED', 'The message is already being sent');
    return this.prisma.db.outboundMessage.findUniqueOrThrow({ where: { id } });
  }

  // ── Dispatcher (platform job: works across organisations) ──

  @Interval(15_000)
  async tick() {
    if (process.env.NODE_ENV === 'test' || this.dispatching) return;
    this.dispatching = true;
    try {
      await this.tenancy.forEachDatabase('Message dispatch', () => this.dispatch());
    } catch (e) {
      this.log.error(`Dispatch failed: ${(e as Error).message}`);
    } finally {
      this.dispatching = false;
    }
  }

  /**
   * Claims due messages with FOR UPDATE SKIP LOCKED (safe with several API instances), sends them and
   * records the outcome. Failures back off exponentially (1, 2, 4, 8 minutes) up to MAX_ATTEMPTS.
   */
  async dispatch(limit = 50) {
    const raw = this.prisma.raw;
    // Recover messages left "sending" by a crashed worker.
    await raw.outboundMessage.updateMany({ where: { status: 'SENDING', updatedAt: { lt: new Date(Date.now() - 10 * 60_000) } }, data: { status: 'QUEUED' } });
    const claimed = await raw.$queryRaw<OutboundMessage[]>`
      UPDATE "OutboundMessage" SET "status" = 'SENDING', "attempts" = "attempts" + 1, "updatedAt" = now()
      WHERE "id" IN (
        SELECT "id" FROM "OutboundMessage" WHERE "status" = 'QUEUED' AND "nextAttemptAt" <= now()
        ORDER BY "nextAttemptAt" LIMIT ${limit} FOR UPDATE SKIP LOCKED
      ) RETURNING *`;
    const sentLastMinute = new Map<string, number>();
    // Each clinic's emails carry its own sender name, colour, reply-to and signature.
    const brands = new Map<string, EmailBrand | undefined>();
    const brandOf = async (orgId: string) => {
      if (!brands.has(orgId)) {
        const org = await raw.organization.findUnique({ where: { id: orgId } });
        brands.set(orgId, org ? emailBrandOf(org) : undefined);
      }
      return brands.get(orgId);
    };
    let sent = 0;
    let failed = 0;
    for (const m of claimed) {
      if (!sentLastMinute.has(m.organizationId)) {
        sentLastMinute.set(m.organizationId, await raw.outboundMessage.count({ where: { organizationId: m.organizationId, status: 'SENT', sentAt: { gte: new Date(Date.now() - 60_000) } } }));
      }
      if ((sentLastMinute.get(m.organizationId) ?? 0) >= ORG_RATE_PER_MINUTE) {
        await raw.outboundMessage.update({ where: { id: m.id }, data: { status: 'QUEUED', attempts: m.attempts - 1, nextAttemptAt: new Date(Date.now() + 60_000) } });
        continue;
      }
      const adapter = await this.channels.forOrg(m.channel, m.organizationId);
      const result = await adapter.send({ recipient: m.recipient, subject: m.subject, body: m.body, brand: await brandOf(m.organizationId), purpose: m.purpose, vars: m.templateVars as Record<string, unknown> | null });
      if (result.ok) {
        await raw.outboundMessage.update({ where: { id: m.id }, data: { status: 'SENT', sentAt: new Date(), providerMessageId: result.providerMessageId ?? null, lastError: null } });
        sentLastMinute.set(m.organizationId, (sentLastMinute.get(m.organizationId) ?? 0) + 1);
        sent++;
      } else {
        const final = m.attempts >= MAX_ATTEMPTS || !!result.permanent;
        const after = await raw.outboundMessage.update({
          where: { id: m.id },
          data: { status: final ? 'FAILED' : 'QUEUED', lastError: result.error ?? 'Unknown error', nextAttemptAt: new Date(Date.now() + 2 ** (m.attempts - 1) * 60_000) },
        });
        if (final) await this.fallbackToEmail(after);
        failed++;
      }
    }
    return { claimed: claimed.length, sent, failed };
  }

  /**
   * A WhatsApp message that finally failed goes by email instead, when the clinic chose that and the client has
   * an email address. Written from the same values, with the clinic's email wording; sent once (dedupe key).
   */
  async fallbackToEmail(m: OutboundMessage) {
    if (m.channel !== 'WHATSAPP' || m.status !== 'FAILED' || !m.clientId) return null;
    const raw = this.prisma.raw;
    if (!(await this.whatsapp.sending(m.organizationId)).fallbackToEmail) return null;
    const client = await raw.client.findFirst({ where: { id: m.clientId, organizationId: m.organizationId }, select: { email: true } });
    if (!client?.email) return null;
    const saved = await raw.messageTemplate.findFirst({ where: { organizationId: m.organizationId, purpose: m.purpose, channel: 'EMAIL', isActive: true } });
    const t = saved ?? defaultTemplate(m.purpose, 'EMAIL');
    const vars = (m.templateVars ?? {}) as Record<string, string | number | null | undefined>;
    const subject = t?.subject ? renderTemplate(t.subject, vars) : 'Message from your veterinary clinic';
    const body = t ? renderTemplate(t.body, vars) : m.body;
    const dedupeKey = `whatsapp-fallback:${m.id}`;
    if (await raw.outboundMessage.findFirst({ where: { organizationId: m.organizationId, dedupeKey } })) return null;
    const email = await raw.outboundMessage.create({
      data: { organizationId: m.organizationId, clientId: m.clientId, patientId: m.patientId, channel: 'EMAIL', recipient: client.email, subject, body, purpose: m.purpose, dedupeKey, sourceType: m.sourceType, sourceId: m.sourceId, templateVars: m.templateVars ?? undefined, createdByName: 'System (WhatsApp failed, sent by email)' },
    });
    await raw.outboundMessage.update({ where: { id: m.id }, data: { lastError: `${m.lastError ?? 'Not delivered'} — sent by email instead.` } });
    return email;
  }
}
