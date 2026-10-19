import { Injectable } from '@nestjs/common';
import { MessageChannel } from '@prisma/client';
import { EmailBrand, escapeHtml, layout, MailService } from '../../common/mail/mail.service';

export interface ChannelMessage {
  recipient: string;
  subject?: string | null;
  body: string;
  /** The sending clinic's branding (sender name, colour, reply-to, signature). */
  brand?: EmailBrand;
}

export interface ChannelResult {
  ok: boolean;
  providerMessageId?: string;
  error?: string;
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
 * Placeholder for channels without a configured provider. No SMS or WhatsApp provider has been
 * integrated or tested yet, so these channels report "not configured" instead of pretending to send.
 */
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
  private readonly adapters: Record<MessageChannel, ChannelAdapter>;
  constructor(mail: MailService) {
    this.adapters = { EMAIL: new EmailAdapter(mail), SMS: new NotConfiguredAdapter('SMS'), WHATSAPP: new NotConfiguredAdapter('WhatsApp') };
  }
  get(channel: MessageChannel) {
    return this.adapters[channel];
  }
  status() {
    return (Object.keys(this.adapters) as MessageChannel[]).map((c) => ({ channel: c, configured: this.adapters[c].configured, provider: this.adapters[c].provider }));
  }
}
