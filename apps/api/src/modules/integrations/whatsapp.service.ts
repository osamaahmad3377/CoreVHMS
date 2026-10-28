import { Injectable, Logger } from '@nestjs/common';
import type { WhatsAppIntegration } from '@prisma/client';
import { templateParamCount, toWhatsAppNumber, WHATSAPP_VARIABLES, whatsAppParam, type WhatsAppPurpose, type WhatsAppSendPolicy } from '@vcms/shared';
import { createHmac } from 'node:crypto';
import { AuditService } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { decryptSecret, encryptSecret, randomToken, safeEqual } from '../../common/crypto/crypto';
import { forbidden, notFound, ruleViolation } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { featureAllowed } from '../../common/tenancy/entitlements';
import { STOP_WORDS } from '../automations/unsubscribe';
import { friendlyWhatsAppError, graph, GraphError, GraphPhoneNumber, GraphTemplate, PERMANENT_ERRORS } from './whatsapp-graph';

const DAY = 86_400_000;

export interface WhatsAppSendResult {
  ok: boolean;
  providerMessageId?: string;
  error?: string;
  /** No point retrying: a person has to fix something first. */
  permanent?: boolean;
}

/** Called when WhatsApp reports a message as failed after it was accepted (registered by the messages module). */
export type WhatsAppFailureHandler = (message: { id: string; organizationId: string }) => Promise<void>;

/** What the sending side needs to know about a clinic's WhatsApp, cached briefly. */
export interface WhatsAppSending {
  active: boolean;
  policy: WhatsAppSendPolicy;
  fallbackToEmail: boolean;
}

/**
 * A clinic's own WhatsApp Business number through Meta's WhatsApp Cloud API: connecting and checking it,
 * approved message templates and which kind of message uses which, sending, and the webhook that reports
 * deliveries, reads, failures and clients' replies.
 */
@Injectable()
export class WhatsAppService {
  private readonly log = new Logger(WhatsAppService.name);
  private readonly failureHandlers: WhatsAppFailureHandler[] = [];
  private readonly sendingCache = new Map<string, { value: WhatsAppSending; at: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  onFailed(handler: WhatsAppFailureHandler) {
    this.failureHandlers.push(handler);
  }

  // ── Settings (staff with integrations.manage) ──

  private async current() {
    return this.prisma.db.whatsAppIntegration.findFirst();
  }

  private async credentials() {
    const i = await this.current();
    if (!i) throw ruleViolation('WHATSAPP_NOT_CONNECTED', 'Connect your WhatsApp Business number first.');
    return { i, token: decryptSecret(i.accessTokenEnc) };
  }

  /** The settings screen: connection, sending rules, template links and the last 30 days' delivery figures. */
  async overview() {
    const db = this.prisma.db;
    const i = await this.current();
    const links = await db.whatsAppTemplateLink.findMany({ orderBy: { purpose: 'asc' } });
    const since = new Date(Date.now() - 30 * DAY);
    const where = { channel: 'WHATSAPP' as const, createdAt: { gte: since } };
    const [byStatus, delivered, read] = await Promise.all([
      db.outboundMessage.groupBy({ by: ['status'], where, _count: true }),
      db.outboundMessage.count({ where: { ...where, deliveredAt: { not: null } } }),
      db.outboundMessage.count({ where: { ...where, readAt: { not: null } } }),
    ]);
    const count = (s: string) => byStatus.find((b) => b.status === s)?._count ?? 0;
    return {
      connected: !!i,
      enabled: i?.enabled ?? false,
      phoneNumberId: i?.phoneNumberId ?? null,
      businessAccountId: i?.businessAccountId ?? null,
      displayPhoneNumber: i?.displayPhoneNumber ?? null,
      verifiedName: i?.verifiedName ?? null,
      qualityRating: i?.qualityRating ?? null,
      sendPolicy: (i?.sendPolicy ?? 'PREFERRED') as WhatsAppSendPolicy,
      fallbackToEmail: i?.fallbackToEmail ?? true,
      hasAppSecret: !!i?.appSecretEnc,
      webhookPath: i ? `/api/v1/webhooks/whatsapp/${i.webhookKey}` : null,
      verifyToken: i?.verifyToken ?? null,
      connectedByName: i?.connectedByName ?? null,
      lastVerifiedAt: i?.lastVerifiedAt ?? null,
      lastError: i?.lastError ?? null,
      lastWebhookAt: i?.lastWebhookAt ?? null,
      links: links.map((l) => ({ purpose: l.purpose, templateName: l.templateName, language: l.language, params: l.params, updatedByName: l.updatedByName, updatedAt: l.updatedAt })),
      last30Days: { sent: count('SENT'), failed: count('FAILED'), queued: count('QUEUED') + count('SENDING'), skipped: count('SKIPPED'), delivered, read },
    };
  }

  /** Checks the number and account with Meta, then saves them (the token is stored encrypted). */
  async connect(input: { phoneNumberId: string; businessAccountId: string; accessToken?: string; appSecret?: string }) {
    const ctx = RequestContext.require();
    const existing = await this.current();
    const token = input.accessToken || (existing ? decryptSecret(existing.accessTokenEnc) : '');
    if (!token) throw ruleViolation('TOKEN_REQUIRED', 'Paste the permanent access token.');
    const phone = await this.check(token, input.phoneNumberId, input.businessAccountId);
    // Ask Meta to send this account's events to our app (best effort: it may already be subscribed).
    await graph(token, 'POST', `${input.businessAccountId}/subscribed_apps`).catch((e) => this.log.warn(`subscribed_apps: ${(e as Error).message}`));
    const data = {
      phoneNumberId: input.phoneNumberId,
      businessAccountId: input.businessAccountId,
      accessTokenEnc: encryptSecret(token),
      appSecretEnc: input.appSecret ? encryptSecret(input.appSecret) : (existing?.appSecretEnc ?? null),
      displayPhoneNumber: phone.display_phone_number ?? null,
      verifiedName: phone.verified_name ?? null,
      qualityRating: phone.quality_rating ?? null,
      lastVerifiedAt: new Date(),
      lastError: null,
      connectedByName: ctx.userName ?? null,
    };
    await this.prisma.db.$transaction(async (tx) => {
      if (existing) await tx.whatsAppIntegration.update({ where: { id: existing.id }, data });
      else await tx.whatsAppIntegration.create({ data: { ...data, organizationId: ctx.organizationId!, webhookKey: randomToken(18), verifyToken: randomToken(18) } });
      await this.audit.record({ action: existing ? 'whatsapp.updated' : 'whatsapp.connected', entityType: 'Organization', entityId: ctx.organizationId!, summary: `${phone.verified_name ?? ''} ${phone.display_phone_number ?? input.phoneNumberId}`.trim() }, tx);
    });
    this.sendingCache.delete(ctx.organizationId!);
    return this.overview();
  }

  private async check(token: string, phoneNumberId: string, businessAccountId: string) {
    try {
      const phone = await graph<GraphPhoneNumber>(token, 'GET', `${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`);
      await graph(token, 'GET', `${businessAccountId}/message_templates?limit=1&fields=name`);
      return phone;
    } catch (e) {
      if (e instanceof GraphError) throw ruleViolation('WHATSAPP_CHECK_FAILED', e.message);
      throw e;
    }
  }

  /** Re-checks the saved connection (number, name, quality rating). */
  async verify() {
    const { i, token } = await this.credentials();
    try {
      const phone = await this.check(token, i.phoneNumberId, i.businessAccountId);
      await this.prisma.db.whatsAppIntegration.update({ where: { id: i.id }, data: { displayPhoneNumber: phone.display_phone_number ?? null, verifiedName: phone.verified_name ?? null, qualityRating: phone.quality_rating ?? null, lastVerifiedAt: new Date(), lastError: null } });
    } catch (e) {
      await this.prisma.db.whatsAppIntegration.update({ where: { id: i.id }, data: { lastError: (e as Error).message, lastVerifiedAt: new Date() } });
      throw e;
    }
    return this.overview();
  }

  async updateSettings(input: { enabled?: boolean; sendPolicy?: WhatsAppSendPolicy; fallbackToEmail?: boolean }) {
    const { i } = await this.credentials();
    const ctx = RequestContext.require();
    await this.prisma.db.$transaction(async (tx) => {
      await tx.whatsAppIntegration.update({ where: { id: i.id }, data: input });
      const changes = Object.entries(input)
        .filter(([k, v]) => v !== undefined && (i as unknown as Record<string, unknown>)[k] !== v)
        .map(([k, v]) => `${k}: ${String(v)}`);
      if (changes.length) await this.audit.record({ action: 'whatsapp.settings_updated', entityType: 'Organization', entityId: ctx.organizationId!, summary: changes.join(', ') }, tx);
    });
    this.sendingCache.delete(ctx.organizationId!);
    return this.overview();
  }

  /** Removes the connection and template links (messages already sent stay in the log). */
  async disconnect() {
    const { i } = await this.credentials();
    const ctx = RequestContext.require();
    await this.prisma.db.$transaction(async (tx) => {
      await tx.whatsAppTemplateLink.deleteMany({});
      await tx.whatsAppIntegration.delete({ where: { id: i.id } });
      await this.audit.record({ action: 'whatsapp.disconnected', entityType: 'Organization', entityId: ctx.organizationId!, summary: i.displayPhoneNumber ?? i.phoneNumberId }, tx);
    });
    this.sendingCache.delete(ctx.organizationId!);
    return this.overview();
  }

  /** The account's message templates from Meta, with their text and how many values each needs. */
  async templates() {
    const { i, token } = await this.credentials();
    let data: GraphTemplate[];
    try {
      data = (await graph<{ data: GraphTemplate[] }>(token, 'GET', `${i.businessAccountId}/message_templates?fields=name,language,status,category,components&limit=250`)).data ?? [];
    } catch (e) {
      if (e instanceof GraphError) throw ruleViolation('WHATSAPP_TEMPLATES_FAILED', e.message);
      throw e;
    }
    return data
      .map((t) => {
        const body = t.components?.find((c) => c.type === 'BODY')?.text ?? '';
        const header = t.components?.find((c) => c.type === 'HEADER');
        const buttons = t.components?.find((c) => c.type === 'BUTTONS') as { buttons?: { type: string; url?: string }[] } | undefined;
        const headerOk = !header || (header.format === 'TEXT' && templateParamCount(header.text) === 0);
        const buttonsOk = !buttons?.buttons?.some((b) => b.type === 'URL' && /\{\{\d+\}\}/.test(b.url ?? ''));
        return {
          name: t.name,
          language: t.language,
          status: t.status,
          category: t.category,
          header: header?.format === 'TEXT' ? (header.text ?? null) : header ? `[${header.format?.toLowerCase() ?? 'media'}]` : null,
          body,
          paramCount: templateParamCount(body),
          supported: headerOk && buttonsOk,
          note: headerOk ? (buttonsOk ? null : 'Has a link button with a value — not supported yet') : 'Has an image, document or value in its header — not supported yet',
        };
      })
      .sort((a, b) => Number(b.status === 'APPROVED') - Number(a.status === 'APPROVED') || a.name.localeCompare(b.name));
  }

  /** Links an approved template to a kind of message (or removes the link when the name is empty). */
  async saveLink(input: { purpose: WhatsAppPurpose; templateName?: string; language?: string; params: string[] }) {
    await this.credentials();
    const ctx = RequestContext.require();
    const allowed = new Set(WHATSAPP_VARIABLES[input.purpose].map((v) => v.key));
    const bad = input.params.find((p) => !allowed.has(p));
    if (bad) throw ruleViolation('UNKNOWN_VALUE', `“${bad}” cannot be used in this kind of message.`);
    await this.prisma.db.$transaction(async (tx) => {
      if (!input.templateName) {
        await tx.whatsAppTemplateLink.deleteMany({ where: { purpose: input.purpose } });
      } else {
        if (!input.language) throw ruleViolation('LANGUAGE_REQUIRED', 'Choose the template’s language.');
        await tx.whatsAppTemplateLink.upsert({
          where: { organizationId_purpose: { organizationId: ctx.organizationId!, purpose: input.purpose } },
          update: { templateName: input.templateName, language: input.language, params: input.params, updatedByName: ctx.userName ?? null },
          create: { organizationId: ctx.organizationId!, purpose: input.purpose, templateName: input.templateName, language: input.language, params: input.params, updatedByName: ctx.userName ?? null },
        });
      }
      await this.audit.record({ action: 'whatsapp.template_linked', entityType: 'Organization', entityId: ctx.organizationId!, summary: `${input.purpose}: ${input.templateName || 'none (plain text)'}` }, tx);
    });
    return this.overview();
  }

  /** Sends a test: Meta's hello_world template, or a linked template filled with example values. */
  async sendTest(input: { to: string; purpose?: WhatsAppPurpose }) {
    const { i, token } = await this.credentials();
    const org = await this.prisma.raw.organization.findUniqueOrThrow({ where: { id: RequestContext.orgId() } });
    const to = toWhatsAppNumber(input.to, org.country);
    if (!to) throw ruleViolation('INVALID_NUMBER', 'Enter a full mobile number, for example 0300 1234567 or +92 300 1234567.');
    let template = { name: 'hello_world', language: { code: 'en_US' }, components: [] as unknown[] };
    if (input.purpose) {
      const link = await this.prisma.db.whatsAppTemplateLink.findFirst({ where: { purpose: input.purpose } });
      if (!link) throw ruleViolation('NO_TEMPLATE_LINK', 'Link a template to this kind of message first.');
      const examples = Object.fromEntries(WHATSAPP_VARIABLES[input.purpose].map((v) => [v.key, v.key === 'clinicName' ? org.name : v.example]));
      template = { name: link.templateName, language: { code: link.language }, components: link.params.length ? [{ type: 'body', parameters: link.params.map((k) => ({ type: 'text', text: whatsAppParam(examples[k]) })) }] : [] };
    }
    try {
      const r = await graph<{ messages?: { id: string }[] }>(token, 'POST', `${i.phoneNumberId}/messages`, { messaging_product: 'whatsapp', to, type: 'template', template });
      await this.audit.record({ action: 'whatsapp.test_sent', entityType: 'Organization', entityId: i.organizationId, summary: `${template.name} to ${to}` });
      return { ok: true, to, template: template.name, messageId: r.messages?.[0]?.id ?? null };
    } catch (e) {
      if (e instanceof GraphError) throw ruleViolation('WHATSAPP_SEND_FAILED', e.message);
      throw e;
    }
  }

  // ── Sending (message dispatcher; runs in the clinic's database without a signed-in user) ──

  /** Whether the clinic sends by WhatsApp, and its rules (cached for 30 s). */
  async sending(organizationId: string): Promise<WhatsAppSending> {
    // Not in the clinic's plan: nothing goes by WhatsApp (messages go by email instead). Checked on every call, so
    // switching the feature on or off for a plan or clinic applies straight away.
    if (!featureAllowed('whatsapp')) return { active: false, policy: 'PREFERRED', fallbackToEmail: true };
    const hit = this.sendingCache.get(organizationId);
    if (hit && Date.now() - hit.at < 30_000) return hit.value;
    const i = await this.prisma.raw.whatsAppIntegration.findUnique({ where: { organizationId }, select: { enabled: true, sendPolicy: true, fallbackToEmail: true } });
    const value: WhatsAppSending = { active: !!i?.enabled, policy: (i?.sendPolicy ?? 'PREFERRED') as WhatsAppSendPolicy, fallbackToEmail: i?.fallbackToEmail ?? false };
    this.sendingCache.set(organizationId, { value, at: Date.now() });
    return value;
  }

  /**
   * Sends one queued message: through the template linked to its kind (values filled from the message), or
   * as plain text when none is linked (WhatsApp only allows that within 24 hours of the client's last message).
   */
  async send(organizationId: string, m: { recipient: string; body: string; purpose: string; vars?: Record<string, unknown> | null }): Promise<WhatsAppSendResult> {
    const raw = this.prisma.raw;
    if (!featureAllowed('whatsapp')) return { ok: false, error: 'WhatsApp Business is not included in this clinic’s plan.', permanent: true };
    const i = await raw.whatsAppIntegration.findUnique({ where: { organizationId } });
    if (!i?.enabled) return { ok: false, error: 'WhatsApp sending is switched off in Settings → Integrations → WhatsApp.', permanent: true };
    const link = await raw.whatsAppTemplateLink.findUnique({ where: { organizationId_purpose: { organizationId, purpose: m.purpose } } });
    const payload = link
      ? {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: m.recipient,
          type: 'template',
          template: { name: link.templateName, language: { code: link.language }, components: link.params.length ? [{ type: 'body', parameters: link.params.map((k) => ({ type: 'text', text: whatsAppParam(m.vars?.[k]) })) }] : [] },
        }
      : { messaging_product: 'whatsapp', recipient_type: 'individual', to: m.recipient, type: 'text', text: { preview_url: false, body: m.body.slice(0, 4096) } };
    try {
      const r = await graph<{ messages?: { id: string }[] }>(decryptSecret(i.accessTokenEnc), 'POST', `${i.phoneNumberId}/messages`, payload);
      return { ok: true, providerMessageId: r.messages?.[0]?.id };
    } catch (e) {
      const g = e instanceof GraphError ? e : null;
      // A broken token or account affects every message: show it on the settings screen.
      if (g?.code && [190, 10, 200, 294, 133010, 368, 131031, 131042].includes(g.code)) {
        await raw.whatsAppIntegration.update({ where: { id: i.id }, data: { lastError: g.message } }).catch(() => undefined);
      }
      return { ok: false, error: (e as Error).message, permanent: !!g?.code && PERMANENT_ERRORS.has(g.code) };
    }
  }

  // ── Webhook (Meta → us; public, identified by the key in the address) ──

  private async byKey(key: string): Promise<WhatsAppIntegration> {
    const i = /^[\w-]{10,64}$/.test(key) ? await this.prisma.raw.whatsAppIntegration.findUnique({ where: { webhookKey: key } }) : null;
    if (!i) throw notFound('WhatsApp connection');
    return i;
  }

  /** Meta's one-time check when the webhook address is saved in the Meta app. */
  async verifyWebhook(key: string, mode?: string, token?: string, challenge?: string) {
    const i = await this.byKey(key);
    if (mode !== 'subscribe' || !token || !safeEqual(token, i.verifyToken)) throw forbidden('The verify token does not match');
    return challenge ?? '';
  }

  /** Delivery receipts, failures and clients' replies. Signed by Meta with the app secret when one is saved. */
  async receive(key: string, rawBody: Buffer | undefined, signature: string | undefined, body: WebhookBody) {
    const i = await this.byKey(key);
    if (i.appSecretEnc) {
      const expected = `sha256=${createHmac('sha256', decryptSecret(i.appSecretEnc)).update(rawBody ?? Buffer.from(JSON.stringify(body))).digest('hex')}`;
      if (!signature || !safeEqual(signature, expected)) throw forbidden('Invalid webhook signature');
    }
    return RequestContext.runAs({ organizationId: i.organizationId, userName: 'WhatsApp' }, async () => {
      const db = this.prisma.db;
      await db.whatsAppIntegration.update({ where: { id: i.id }, data: { lastWebhookAt: new Date() } });
      let statuses = 0;
      let replies = 0;
      for (const entry of body?.entry ?? []) {
        for (const change of entry.changes ?? []) {
          const v = change.value;
          if (!v || (v.metadata?.phone_number_id && v.metadata.phone_number_id !== i.phoneNumberId)) continue;
          for (const s of v.statuses ?? []) statuses += await this.applyStatus(s);
          for (const msg of v.messages ?? []) replies += await this.storeReply(msg, v.contacts ?? []);
        }
      }
      return { ok: true, statuses, replies };
    });
  }

  private async applyStatus(s: WebhookStatus) {
    const db = this.prisma.db;
    const m = s.id ? await db.outboundMessage.findFirst({ where: { providerMessageId: s.id, channel: 'WHATSAPP' } }) : null;
    if (!m) return 0;
    const at = s.timestamp ? new Date(Number(s.timestamp) * 1000) : new Date();
    if (s.status === 'delivered') await db.outboundMessage.update({ where: { id: m.id }, data: { deliveredAt: m.deliveredAt ?? at, status: m.status === 'FAILED' ? m.status : 'SENT' } });
    else if (s.status === 'read') await db.outboundMessage.update({ where: { id: m.id }, data: { readAt: m.readAt ?? at, deliveredAt: m.deliveredAt ?? at } });
    else if (s.status === 'failed') {
      const error = friendlyWhatsAppError(s.errors?.[0], 'WhatsApp could not deliver this message');
      await db.outboundMessage.update({ where: { id: m.id }, data: { status: 'FAILED', lastError: error } });
      for (const h of this.failureHandlers) await h({ id: m.id, organizationId: m.organizationId }).catch((e) => this.log.error(`Failure handler: ${(e as Error).message}`));
    }
    return 1;
  }

  /** A client's WhatsApp message lands in Messages → Client messages, matched by their mobile number. */
  private async storeReply(msg: WebhookMessage, contacts: { wa_id?: string; profile?: { name?: string } }[]) {
    const db = this.prisma.db;
    const org = await this.prisma.raw.organization.findUniqueOrThrow({ where: { id: RequestContext.orgId() }, select: { country: true } });
    const from = msg.from ?? '';
    if (!from) return 0;
    // Narrow by the last 9 digits (numbers are stored as typed, with spaces), then compare the full international number.
    const tail = `%${from.slice(-9)}`;
    const candidates = await this.prisma.raw.$queryRaw<{ id: string; mobilePhone: string | null }[]>`
      SELECT "id", "mobilePhone" FROM "Client"
      WHERE "organizationId" = ${RequestContext.orgId()}::uuid AND "status" <> 'MERGED' AND translate(coalesce("mobilePhone", ''), ' -().+/', '') LIKE ${tail}
      ORDER BY "updatedAt" DESC LIMIT 20`;
    const client = candidates.find((c) => toWhatsAppNumber(c.mobilePhone, org.country) === from);
    if (!client) {
      this.log.log(`WhatsApp message from an unknown number ending ${from.slice(-4)} was not stored`);
      return 0;
    }
    const text =
      msg.type === 'text'
        ? (msg.text?.body ?? '')
        : msg.type === 'button'
          ? (msg.button?.text ?? '')
          : msg.type === 'interactive'
            ? (msg.interactive?.button_reply?.title ?? msg.interactive?.list_reply?.title ?? '[reply]')
            : `[${msg.type ?? 'message'} sent on WhatsApp — open WhatsApp to see it]`;
    const name = contacts.find((c) => c.wa_id === from)?.profile?.name;
    await db.clientMessage.create({
      data: { organizationId: RequestContext.orgId(), clientId: client.id, direction: 'INBOUND', kind: 'WHATSAPP', subject: null, body: text.slice(0, 4000) || '[empty message]', authorName: name ? `${name} (WhatsApp)` : 'Client (WhatsApp)', createdAt: msg.timestamp ? new Date(Number(msg.timestamp) * 1000) : new Date() },
    });
    // "STOP": the client no longer wants offers (reminders about their animals carry on).
    if (STOP_WORDS.has(text.trim().toUpperCase().replace(/[.!]+$/, ''))) {
      await db.$transaction(async (tx) => {
        const r = await tx.client.updateMany({ where: { id: client.id, marketingConsent: true }, data: { marketingConsent: false, consentUpdatedAt: new Date() } });
        if (r.count) await this.audit.record({ action: 'client.marketing_stopped', entityType: 'Client', entityId: client.id, summary: 'Stopped offers (replied STOP on WhatsApp)', actorUserId: null, actorName: name ? `${name} (WhatsApp)` : 'Client (WhatsApp)' }, tx);
      });
    }
    return 1;
  }

  /** Whether a client wrote on WhatsApp in the last 24 hours (so a plain-text reply is allowed). */
  async inReplyWindow(clientId: string) {
    const last = await this.prisma.db.clientMessage.findFirst({ where: { clientId, direction: 'INBOUND', kind: 'WHATSAPP' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
    return !!last && Date.now() - last.createdAt.getTime() < DAY - 5 * 60_000;
  }
}

export interface WebhookStatus {
  id?: string;
  status?: 'sent' | 'delivered' | 'read' | 'failed' | string;
  timestamp?: string;
  recipient_id?: string;
  errors?: { code?: number; title?: string; message?: string; error_data?: { details?: string } }[];
}
export interface WebhookMessage {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
}
export interface WebhookBody {
  object?: string;
  entry?: { id?: string; changes?: { field?: string; value?: { metadata?: { phone_number_id?: string }; statuses?: WebhookStatus[]; messages?: WebhookMessage[]; contacts?: { wa_id?: string; profile?: { name?: string } }[] } }[] }[];
}
