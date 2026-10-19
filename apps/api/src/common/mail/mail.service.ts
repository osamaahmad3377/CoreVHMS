import { Injectable, Logger } from '@nestjs/common';
import { contrastRatio } from '@vcms/shared';
import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../../config/env';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Clinic emails: sender name, reply-to address and signature (white label). Platform emails leave it out. */
  brand?: EmailBrand;
  /** Filled in by send(): the From and Reply-To actually used (kept in the test outbox). */
  from?: string;
  replyTo?: string;
}

/** The address part of MAIL_FROM ("Name <a@b>" or "a@b"). */
function mailFromAddress() {
  const raw = env().MAIL_FROM;
  return /<([^>]+)>/.exec(raw)?.[1] ?? raw.trim();
}

/** From, Reply-To and the plain-text signature for a message. */
function addressing(message: MailMessage): MailMessage {
  const { brand, ...rest } = message;
  if (!brand) return { ...rest, from: env().MAIL_FROM };
  // Only the display name changes; the sending address stays the platform's (SPF/DKIM).
  const name = (brand.senderName ?? brand.name).replace(/["\\<>\r\n]/g, '').trim();
  return {
    ...rest,
    from: `"${name}" <${mailFromAddress()}>`,
    replyTo: brand.replyTo ?? undefined,
    text: brand.signature ? `${rest.text}\n\n-- \n${brand.signature}` : rest.text,
  };
}

/**
 * SMTP email adapter. In development it points at Mailpit (http://localhost:8025),
 * which captures every message without delivering it.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;
  /** Messages sent during tests (inspected by integration tests). */
  readonly outbox: MailMessage[] = [];

  private get transport(): Transporter {
    if (!this.transporter) {
      const e = env();
      this.transporter = nodemailer.createTransport({
        host: e.SMTP_HOST,
        port: e.SMTP_PORT,
        secure: e.SMTP_PORT === 465,
        auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASSWORD } : undefined,
      });
    }
    return this.transporter;
  }

  /** Returns true when the SMTP server accepted the message. Never throws. */
  async send(message: MailMessage): Promise<boolean> {
    const m = addressing(message);
    if (env().NODE_ENV === 'test') {
      this.outbox.push(m);
      return true;
    }
    try {
      await this.transport.sendMail(m);
      return true;
    } catch (e) {
      this.logger.error(`Email to ${message.to} failed: ${(e as Error).message}`);
      return false;
    }
  }
}

/** Who an email comes from: the clinic's brand name and colour (white label), or NextCore for platform emails. */
export interface EmailBrand {
  name: string;
  color?: string | null;
  /** Shown as the sender ("Happy Paws <no-reply@…>"); defaults to the name. */
  senderName?: string | null;
  /** Replies go to the clinic, not the no-reply address. */
  replyTo?: string | null;
  /** Closing lines under every email. */
  signature?: string | null;
}

const DEFAULT_EMAIL_COLOUR = '#0f766e';
export const NEXTCORE_EMAIL: EmailBrand = { name: 'NextCore Veterinary Clinic Management System' };

/** The branding a clinic's emails carry (its brand name and main colour). */
export const emailBrandOf = (org: {
  name: string;
  brandName?: string | null;
  primaryColor?: string | null;
  email?: string | null;
  emailSenderName?: string | null;
  emailSignature?: string | null;
}): EmailBrand => ({
  name: org.brandName ?? org.name,
  color: org.primaryColor,
  senderName: org.emailSenderName ?? org.brandName ?? org.name,
  replyTo: org.email,
  signature: org.emailSignature,
});

/** A link styled as a button in the brand colour, with readable text. */
export function emailButton(href: string, label: string, brand?: EmailBrand) {
  const bg = brand?.color ?? DEFAULT_EMAIL_COLOUR;
  const fg = contrastRatio(bg, '#ffffff') >= 4.5 ? '#ffffff' : '#111827';
  return `<p><a href="${href}" style="background:${bg};color:${fg};padding:10px 16px;border-radius:6px;text-decoration:none">${escapeHtml(label)}</a></p>`;
}

export function layout(title: string, bodyHtml: string, brand: EmailBrand = NEXTCORE_EMAIL) {
  const heading = brand.color && contrastRatio(brand.color, '#ffffff') >= 3 ? brand.color : '#0f5f5a';
  return `<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f5f7f8;padding:24px">
<div style="max-width:560px;margin:auto;background:#fff;border-radius:8px;padding:28px;border:1px solid #e3e8ea">
<h2 style="margin-top:0;color:${heading}">${title}</h2>${bodyHtml}
${brand.signature ? `<p style="white-space:pre-line;margin-top:24px">${escapeHtml(brand.signature)}</p>` : ''}
<p style="color:#6b7b80;font-size:12px;margin-top:32px">${escapeHtml(brand.name)}</p></div></body></html>`;
}

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
