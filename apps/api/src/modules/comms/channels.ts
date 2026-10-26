import { Injectable } from '@nestjs/common';
import { MessageChannel } from '@prisma/client';
import { EmailBrand, escapeHtml, layout, MailService } from '../../common/mail/mail.service';
import { EmailIntegrationService } from '../integrations/email-integration.service';
import { WhatsAppService } from '../integrations/whatsapp.service';

export interface ChannelMessage {
  recipient: string;
  subject?: string | null;
  body: string;
  /** The sending clinic's branding (sender name, colour, reply-to, signature). */
  brand?: EmailBrand;
  /** Kind of message and the values it was written from (WhatsApp fills an approved template with them). */
  purpose?: string;
  vars?: Record<string, unknown> | null;
}

export interface ChannelResult {
  ok: boolean;
  providerMessageId?: string;
  error?: string;
  /** Retrying will not help (a person has to fix something first). */
  permanent?: boolean;
}

export interface ChannelAdapter {
  /** Whether a provider is configured for this channel. */
  readonly configured: boolean;
  /** Human-readable provider name shown in settings and logs. */
  readonly provider: string;
  send(m: ChannelMessage): Promise<ChannelResult>;
}

/** Email through the SMTP adapter (Mailpit captures messages in development). */
class EmailAdapter implements ChannelAdapter {
  readonly configured = true;
  readonly provider = 'SMTP';
  constructor(private readonly mail: MailService) {}
  async send(m: ChannelMessage): Promise<ChannelResult> {
    const ok = await this.mail.send({ to: m.recipient, brand: m.brand, subject: m.subject ?? '(no subject)', text: m.body, html: layout(escapeHtml(m.subject ?? ''), `<p>${escapeHtml(m.body).replace(/\n/g, '<br>')}</p>`, m.brand) });
    return ok ? { ok } : { ok, error: 'The SMTP server did not accept the message' };
  }
}

/**
 * The clinic's own mailbox (Gmail, Outlook or its email server). If the mailbox stops working (password changed,
 * access removed) the message still goes out from the platform sender, with the clinic as reply-to.
 */
class ClinicMailboxAdapter implements ChannelAdapter {
  readonly configured = true;
  constructor(
    private readonly mailbox: EmailIntegrationService,
    private readonly organizationId: string,
    readonly provider: string,
    private readonly fallback: ChannelAdapter,
  ) {}
  async send(m: ChannelMessage): Promise<ChannelResult> {
    const subject = m.subject ?? '(no subject)';
    const text = m.brand?.signature ? `${m.body}\n\n-- \n${m.brand.signature}` : m.body;
    const r = await this.mailbox.send(this.organizationId, { to: m.recipient, subject, text, html: layout(escapeHtml(subject), `<p>${escapeHtml(m.body).replace(/\n/g, '<br>')}</p>`, m.brand), senderName: m.brand?.senderName ?? m.brand?.name });
    if (r.ok) return { ok: true, providerMessageId: r.providerMessageId };
    if (r.needsAttention) return this.fallback.send(m);
    return { ok: false, error: r.error };
  }
}

/** The clinic's own WhatsApp Business number (Settings → Integrations → WhatsApp). */
class WhatsAppAdapter implements ChannelAdapter {
  readonly provider = 'WhatsApp Business (Meta)';
  constructor(
    private readonly whatsapp: WhatsAppService,
    private readonly organizationId: string,
    readonly configured: boolean,
  ) {}
  send(m: ChannelMessage): Promise<ChannelResult> {
    return this.whatsapp.send(this.organizationId, { recipient: m.recipient, body: m.body, purpose: m.purpose ?? 'GENERAL', vars: m.vars });
  }
}

/** Placeholder for channels without a configured provider (SMS): reports "not configured" instead of pretending to send. */
class NotConfiguredAdapter implements ChannelAdapter {
  readonly configured = false;
  readonly provider = 'Not configured';
  constructor(private readonly channel: string) {}
  async send(): Promise<ChannelResult> {
    return { ok: false, error: `No ${this.channel} provider is configured` };
  }
}

@Injectable()
export class ChannelRegistry {
  private readonly email: ChannelAdapter;
  private readonly sms: ChannelAdapter = new NotConfiguredAdapter('SMS');
  constructor(
    mail: MailService,
    private readonly whatsapp: WhatsAppService,
    private readonly mailbox: EmailIntegrationService,
  ) {
    this.email = new EmailAdapter(mail);
  }

  /** The adapter for a channel in one clinic (WhatsApp is each clinic's own number). */
  async forOrg(channel: MessageChannel, organizationId: string): Promise<ChannelAdapter> {
    if (channel === 'EMAIL') {
      const own = await this.mailbox.usable(organizationId);
      return own ? new ClinicMailboxAdapter(this.mailbox, organizationId, `${own.provider === 'GMAIL' ? 'Gmail' : own.provider === 'OUTLOOK' ? 'Outlook' : 'Clinic mailbox'} (${own.email})`, this.email) : this.email;
    }
    if (channel === 'SMS') return this.sms;
    return new WhatsAppAdapter(this.whatsapp, organizationId, (await this.whatsapp.sending(organizationId)).active);
  }

  async status(organizationId: string) {
    return Promise.all((['EMAIL', 'SMS', 'WHATSAPP'] as MessageChannel[]).map(async (c) => {
      const a = await this.forOrg(c, organizationId);
      return { channel: c, configured: a.configured, provider: a.configured || c !== 'WHATSAPP' ? a.provider : 'Not connected' };
    }));
  }
}
