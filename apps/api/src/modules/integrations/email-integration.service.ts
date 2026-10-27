import { Injectable, Logger } from '@nestjs/common';
import type { EmailIntegration } from '@prisma/client';
import { EMAIL_SMTP_PRESETS, type EmailSmtpConnectInput } from '@vcms/shared';
import { createHmac } from 'node:crypto';
import nodemailer, { type Transporter } from 'nodemailer';
import { AuditService } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { decryptSecret, encryptSecret, randomToken, safeEqual } from '../../common/crypto/crypto';
import { ruleViolation } from '../../common/http/errors';
import { featureAllowed } from '../../common/tenancy/entitlements';
import { PrismaService } from '../../common/prisma/prisma.service';
import { multiClinic } from '../../common/tenancy/hosts';
import { TenancyService, tenantRef } from '../../common/tenancy/tenancy.service';
import { env } from '../../config/env';
import { accountEmail, authorizeUrl, exchangeCode, OAuthProvider, oauthAvailable, ProviderError, refreshAccess, sendWithProvider } from './email-providers';

export interface MailboxMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Sender name when the mailbox has none of its own (the clinic's brand name). */
  senderName?: string | null;
}

export interface MailboxResult {
  ok: boolean;
  providerMessageId?: string;
  error?: string;
  /** The mailbox stopped working (password changed, access removed): it was marked "needs attention". */
  needsAttention?: boolean;
}

/** SMTP transport factory — replaced in tests by a fake that records messages. */
type TransportLike = Pick<Transporter, 'sendMail' | 'verify'>;
type TransportFactory = (o: { host: string; port: number; secure: boolean; auth: { user: string; pass: string } }) => TransportLike;

const STATE_TTL_MS = 15 * 60_000;
const PROVIDER_NAMES: Record<string, string> = { GMAIL: 'Gmail', OUTLOOK: 'Outlook', SMTP: 'Email server' };

function shape(r: EmailIntegration) {
  return {
    provider: r.provider,
    providerName: PROVIDER_NAMES[r.provider] ?? r.provider,
    method: r.method,
    email: r.email,
    fromName: r.fromName,
    isActive: r.isActive,
    status: r.status,
    smtpHost: r.smtpHost,
    lastError: r.lastError,
    lastErrorAt: r.lastErrorAt,
    lastSentAt: r.lastSentAt,
    sentCount: r.sentCount,
    connectedByName: r.connectedByName,
    connectedAt: r.connectedAt,
  };
}

/** Friendly words for the usual SMTP sign-in failures. */
function smtpProblem(provider: string, e: unknown) {
  const err = e as { code?: string; responseCode?: number; message?: string };
  if (err.code === 'EAUTH' || err.responseCode === 535 || err.responseCode === 534) {
    if (provider === 'GMAIL') return 'Google did not accept the password. Use an app password: Google Account → Security → 2-Step Verification → App passwords.';
    if (provider === 'OUTLOOK') return 'Microsoft did not accept the password. Use an app password, or ask your IT person to allow SMTP sending for this mailbox.';
    return 'The email server did not accept the user name and password.';
  }
  if (err.code === 'ECONNECTION' || err.code === 'ETIMEDOUT' || err.code === 'ESOCKET' || err.code === 'EDNS') return 'Could not reach the email server. Check the server name and port.';
  return err.message ?? 'The email server refused the connection.';
}

/**
 * The clinic's own mailbox for client emails (Settings → Integrations → Email). Gmail and Outlook connect by
 * signing in (when the platform has an OAuth app) or with an app password; any other mailbox with its server
 * details. Secrets are stored encrypted; access tokens are refreshed automatically; a mailbox that stops working
 * is marked "needs attention" and emails go from the platform sender until it is reconnected.
 */
@Injectable()
export class EmailIntegrationService {
  private readonly log = new Logger(EmailIntegrationService.name);
  static transportFor: TransportFactory = (o) => nodemailer.createTransport({ ...o, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000 });

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tenancy: TenancyService,
  ) {}

  async overview() {
    const r = await this.prisma.db.emailIntegration.findFirst();
    const from = /<([^>]+)>/.exec(env().MAIL_FROM)?.[1] ?? env().MAIL_FROM;
    return { connection: r ? shape(r) : null, signIn: oauthAvailable(), platformSender: from };
  }

  /** A mailbox that can send right now, or null (emails then go from the platform sender). */
  async usable(organizationId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(organizationId)) return null;
    // A plan without its own mailbox sends from the platform address (the connection is kept for an upgrade).
    if (!featureAllowed('mailbox')) return null;
    const r = await this.prisma.raw.emailIntegration.findUnique({ where: { organizationId } });
    return r && r.isActive && r.status === 'CONNECTED' ? r : null;
  }

  // ── Connect with server details / app password ──

  async connectWithPassword(input: EmailSmtpConnectInput) {
    const ctx = RequestContext.require();
    const preset = input.provider === 'SMTP' ? null : EMAIL_SMTP_PRESETS[input.provider];
    const host = input.host?.trim() || preset?.host;
    const port = input.port ?? preset?.port ?? 587;
    const secure = input.secure ?? preset?.secure ?? port === 465;
    if (!host) throw ruleViolation('SMTP_HOST_REQUIRED', 'Enter the email server name (for example mail.yourclinic.com)');
    const user = input.username?.trim() || input.email;
    const transport = EmailIntegrationService.transportFor({ host, port, secure, auth: { user, pass: input.password } });
    try {
      await transport.verify();
    } catch (e) {
      throw ruleViolation('EMAIL_LOGIN_FAILED', smtpProblem(input.provider, e));
    }
    const data = {
      provider: input.provider,
      method: 'PASSWORD',
      email: input.email,
      fromName: input.fromName || null,
      isActive: true,
      status: 'CONNECTED',
      smtpHost: host,
      smtpPort: port,
      smtpSecure: secure,
      smtpUser: user,
      secretEnc: encryptSecret(input.password),
      accessTokenEnc: null,
      accessExpiresAt: null,
      lastError: null,
      lastErrorAt: null,
      connectedByName: ctx.userName ?? null,
      connectedAt: new Date(),
    };
    await this.prisma.db.$transaction(async (tx) => {
      await tx.emailIntegration.upsert({ where: { organizationId: ctx.organizationId! }, update: data, create: { ...data, organizationId: ctx.organizationId! } });
      await this.audit.record({ action: 'email_integration.connected', entityType: 'Organization', entityId: ctx.organizationId!, summary: `${PROVIDER_NAMES[input.provider]} ${input.email} (${host})` }, tx);
    });
    return this.overview();
  }

  // ── Connect by signing in with Google / Microsoft ──

  private sign(payload: object) {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${body}.${createHmac('sha256', env().SESSION_SECRET).update(`email-oauth:${body}`).digest('base64url')}`;
  }

  private verifyState(state: string | undefined) {
    const [body, mac] = (state ?? '').split('.');
    if (!body || !mac) return null;
    const expected = createHmac('sha256', env().SESSION_SECRET).update(`email-oauth:${body}`).digest('base64url');
    if (!safeEqual(mac, expected)) return null;
    const s = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { o: string; s: string | null; u: string | null; p: OAuthProvider; r: string; x: number };
    return s.x > Date.now() ? s : null;
  }

  /** The sign-in page to send the browser to; it comes back to /oauth/email/callback and then to `returnTo`. */
  startSignIn(provider: OAuthProvider, returnTo: string, loginHint?: string | null) {
    if (!oauthAvailable()[provider]) {
      throw ruleViolation('SIGN_IN_NOT_SET_UP', `Signing in with ${provider === 'GMAIL' ? 'Google' : 'Microsoft'} is not set up on this server yet. Connect with an app password instead, or ask NextCore support.`);
    }
    const ctx = RequestContext.require();
    const state = this.sign({ o: ctx.organizationId, s: ctx.tenant?.slug ?? null, u: ctx.userName ?? null, p: provider, r: returnTo, x: Date.now() + STATE_TTL_MS, n: randomToken(8) });
    return { url: authorizeUrl(provider, state, loginHint) };
  }

  /** Google/Microsoft send the browser back here; returns where to send it next (the clinic's settings page). */
  async finishSignIn(q: { code?: string; state?: string; error?: string; error_description?: string }) {
    const s = this.verifyState(q.state);
    if (!s) return `${env().APP_URL.replace(/\/$/, '')}/settings/integrations/email?email=expired`;
    const back = (status: string, reason?: string) => `${s.r}?email=${status}${reason ? `&reason=${encodeURIComponent(reason.slice(0, 200))}` : ''}`;
    if (q.error || !q.code) return back(q.error === 'access_denied' ? 'cancelled' : 'failed', q.error_description ?? q.error);
    const work = () =>
      RequestContext.runAs({ organizationId: s.o, userName: s.u ?? 'Email sign-in' }, async () => {
        const tokens = await exchangeCode(s.p, q.code!);
        if (!tokens.refreshToken) throw new ProviderError('The provider did not allow offline sending. Remove the app’s access in your account and try again.');
        const email = await accountEmail(s.p, tokens);
        const data = {
          provider: s.p,
          method: 'OAUTH',
          email,
          isActive: true,
          status: 'CONNECTED',
          smtpHost: null,
          smtpPort: null,
          smtpSecure: null,
          smtpUser: null,
          secretEnc: encryptSecret(tokens.refreshToken),
          accessTokenEnc: encryptSecret(tokens.accessToken),
          accessExpiresAt: tokens.expiresAt,
          lastError: null,
          lastErrorAt: null,
          connectedByName: s.u,
          connectedAt: new Date(),
        };
        await this.prisma.db.$transaction(async (tx) => {
          await tx.emailIntegration.upsert({ where: { organizationId: s.o }, update: data, create: { ...data, organizationId: s.o } });
          await this.audit.record({ action: 'email_integration.connected', entityType: 'Organization', entityId: s.o, summary: `${PROVIDER_NAMES[s.p]} ${email} (signed in)` }, tx);
        });
      });
    try {
      if (s.s && multiClinic()) {
        const t = await this.tenancy.bySlug(s.s);
        if (!t || t.status !== 'ACTIVE') return back('failed', 'Clinic not found');
        await RequestContext.runInTenant(tenantRef(t), work);
      } else {
        await work();
      }
      return back('connected');
    } catch (e) {
      this.log.warn(`Email sign-in failed: ${(e as Error).message}`);
      return back('failed', (e as Error).message);
    }
  }

  // ── Sending ──

  private async accessToken(r: EmailIntegration) {
    if (r.accessTokenEnc && r.accessExpiresAt && r.accessExpiresAt.getTime() > Date.now()) return decryptSecret(r.accessTokenEnc);
    const t = await refreshAccess(r.provider as OAuthProvider, decryptSecret(r.secretEnc!));
    await this.prisma.raw.emailIntegration.update({
      where: { id: r.id },
      data: { accessTokenEnc: encryptSecret(t.accessToken), accessExpiresAt: t.expiresAt, ...(t.refreshToken ? { secretEnc: encryptSecret(t.refreshToken) } : {}) },
    });
    return t.accessToken;
  }

  /** Sends from the clinic's mailbox. Never throws. */
  async send(organizationId: string, m: MailboxMessage, opts: { evenIfPaused?: boolean } = {}): Promise<MailboxResult> {
    const r = await this.prisma.raw.emailIntegration.findUnique({ where: { organizationId } });
    if (!r || (!r.isActive && !opts.evenIfPaused)) return { ok: false, error: 'No mailbox connected' };
    const name = (r.fromName || m.senderName || '').replace(/["\\<>\r\n]/g, '').trim();
    const from = name ? `"${name}" <${r.email}>` : r.email;
    try {
      let id: string | null = null;
      if (r.method === 'OAUTH') {
        id = await sendWithProvider(r.provider as OAuthProvider, await this.accessToken(r), { from, to: m.to, subject: m.subject, text: m.text, html: m.html });
      } else {
        const t = EmailIntegrationService.transportFor({ host: r.smtpHost!, port: r.smtpPort!, secure: !!r.smtpSecure, auth: { user: r.smtpUser!, pass: decryptSecret(r.secretEnc!) } });
        const info = await t.sendMail({ from, to: m.to, subject: m.subject, text: m.text, html: m.html });
        id = (info as { messageId?: string }).messageId ?? null;
      }
      await this.prisma.raw.emailIntegration.update({ where: { id: r.id }, data: { lastSentAt: new Date(), sentCount: { increment: 1 }, ...(r.status !== 'CONNECTED' ? { status: 'CONNECTED', lastError: null } : {}) } });
      return { ok: true, providerMessageId: id ?? undefined };
    } catch (e) {
      const auth = (e instanceof ProviderError && e.authProblem) || (e as { code?: string }).code === 'EAUTH';
      const error = e instanceof ProviderError ? e.message : smtpProblem(r.provider, e);
      await this.prisma.raw.emailIntegration.update({ where: { id: r.id }, data: { lastError: error, lastErrorAt: new Date(), ...(auth ? { status: 'NEEDS_ATTENTION' } : {}) } });
      return { ok: false, error, needsAttention: auth };
    }
  }

  /** A test email to check the connection (to the person testing, or another address). */
  async test(to: string) {
    const org = await this.prisma.raw.organization.findUniqueOrThrow({ where: { id: RequestContext.orgId() }, select: { name: true, brandName: true } });
    const name = org.brandName ?? org.name;
    const r = await this.send(
      RequestContext.orgId(),
      {
        to,
        subject: `Test email from ${name}`,
        text: `This is a test from ${name}. Client emails (appointment confirmations, reminders, results and your automations) will be sent from this mailbox.`,
        html: `<p>This is a test from <b>${name.replace(/[<>&]/g, '')}</b>.</p><p>Client emails — appointment confirmations, reminders, results and your automations — will be sent from this mailbox.</p>`,
        senderName: name,
      },
      { evenIfPaused: true },
    );
    if (!r.ok) throw ruleViolation('EMAIL_TEST_FAILED', r.error ?? 'The test email could not be sent');
    return { ok: true, to };
  }

  async updateSettings(input: { fromName?: string | null; isActive: boolean }) {
    const ctx = RequestContext.require();
    const r = await this.prisma.db.emailIntegration.findFirst();
    if (!r) throw ruleViolation('NOT_CONNECTED', 'Connect a mailbox first');
    await this.prisma.db.$transaction(async (tx) => {
      await tx.emailIntegration.update({ where: { id: r.id }, data: { fromName: input.fromName || null, isActive: input.isActive } });
      await this.audit.record({ action: 'email_integration.updated', entityType: 'Organization', entityId: ctx.organizationId!, summary: `${r.email}: ${input.isActive ? 'on' : 'paused'}` }, tx);
    });
    return this.overview();
  }

  async disconnect() {
    const ctx = RequestContext.require();
    const r = await this.prisma.db.emailIntegration.findFirst();
    if (!r) return this.overview();
    await this.prisma.db.$transaction(async (tx) => {
      await tx.emailIntegration.delete({ where: { id: r.id } });
      await this.audit.record({ action: 'email_integration.disconnected', entityType: 'Organization', entityId: ctx.organizationId!, summary: r.email }, tx);
    });
    return this.overview();
  }
}
