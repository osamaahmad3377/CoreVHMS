import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../../config/env';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
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
    if (env().NODE_ENV === 'test') {
      this.outbox.push(message);
      return true;
    }
    try {
      await this.transport.sendMail({ from: env().MAIL_FROM, ...message });
      return true;
    } catch (e) {
      this.logger.error(`Email to ${message.to} failed: ${(e as Error).message}`);
      return false;
    }
  }
}

export function layout(title: string, bodyHtml: string) {
  return `<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f5f7f8;padding:24px">
<div style="max-width:560px;margin:auto;background:#fff;border-radius:8px;padding:28px;border:1px solid #e3e8ea">
<h2 style="margin-top:0;color:#0f5f5a">${title}</h2>${bodyHtml}
<p style="color:#6b7b80;font-size:12px;margin-top:32px">NextCore Veterinary Clinic Management System</p></div></body></html>`;
}

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
