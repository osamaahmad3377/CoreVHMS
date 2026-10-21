import { Injectable } from '@nestjs/common';
import { MessageChannel } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { PrismaService } from '../../common/prisma/prisma.service';

/** Neutral default wording (administrative, no clinical advice). Clinics edit these in Settings. */
const DEFAULTS: { purpose: string; channel: MessageChannel; subject?: string; body: string }[] = [
  { purpose: 'CARE_REMINDER', channel: 'EMAIL', subject: '{{clinicName}}: care due for {{petNames}}', body: 'Hello {{clientName}},\n\nThis is a reminder from {{clinicName}} that the following care is coming up:\n{{items}}\n\nPlease contact us{{clinicPhoneLine}} to book an appointment.\n\nYou can change your reminder preferences in the client portal or by contacting the clinic.' },
  { purpose: 'CARE_REMINDER', channel: 'SMS', body: '{{clinicName}}: {{petNames}} {{itemsShort}} due soon. Please call{{clinicPhoneLine}} to book.' },
  { purpose: 'CARE_REMINDER', channel: 'WHATSAPP', body: 'Hello {{clientName}}, a reminder from {{clinicName}}: {{itemsShort}} for {{petNames}} is due soon. Reply or call{{clinicPhoneLine}} to book.' },
  { purpose: 'CARE_OVERDUE', channel: 'EMAIL', subject: '{{clinicName}}: care overdue for {{petNames}}', body: 'Hello {{clientName}},\n\nOur records show the following care is now overdue:\n{{items}}\n\nIf it has already been done elsewhere, please let us know so we can update the record. Otherwise contact us{{clinicPhoneLine}} to book.' },
  { purpose: 'CARE_OVERDUE', channel: 'SMS', body: '{{clinicName}}: {{petNames}} {{itemsShort}} now overdue. Please call{{clinicPhoneLine}}.' },
  { purpose: 'CARE_OVERDUE', channel: 'WHATSAPP', body: 'Hello {{clientName}}, {{clinicName}} here: {{itemsShort}} for {{petNames}} is overdue. Please reply or call{{clinicPhoneLine}}.' },
  { purpose: 'APPOINTMENT_REMINDER', channel: 'EMAIL', subject: 'Appointment reminder: {{petName}} on {{appointmentTime}}', body: 'Hello {{clientName}},\n\nThis is a reminder that {{petName}} has an appointment ({{appointmentType}}) at {{clinicName}} on {{appointmentTime}}.\n\nIf you need to change or cancel, please contact us{{clinicPhoneLine}} or use the client portal.' },
  { purpose: 'APPOINTMENT_REMINDER', channel: 'SMS', body: '{{clinicName}}: reminder, {{petName}} appointment {{appointmentTime}}. To change call{{clinicPhoneLine}}.' },
  { purpose: 'APPOINTMENT_REMINDER', channel: 'WHATSAPP', body: 'Hello {{clientName}}, reminder from {{clinicName}}: {{petName}} has an appointment on {{appointmentTime}}.' },
  { purpose: 'PORTAL_INVITE', channel: 'EMAIL', subject: 'Your {{clinicName}} client portal', body: 'Hello {{clientName}},\n\n{{clinicName}} has invited you to its client portal, where you can see your animals’ records, vaccinations, appointments and invoices, and message the clinic.\n\nSet your password here (link valid for 72 hours):\n{{link}}' },
  { purpose: 'PORTAL_RESET', channel: 'EMAIL', subject: 'Reset your client portal password', body: 'Hello {{clientName}},\n\nUse this link to set a new password (valid for 1 hour):\n{{link}}\n\nIf you did not ask for this, you can ignore this email.' },
  { purpose: 'GENERAL', channel: 'EMAIL', subject: 'Message from {{clinicName}}', body: '{{body}}' },
  { purpose: 'GENERAL', channel: 'SMS', body: '{{body}}' },
  { purpose: 'GENERAL', channel: 'WHATSAPP', body: '{{body}}' },
];

/** The built-in wording for a purpose and channel (used when a clinic has not saved its own yet). */
export function defaultTemplate(purpose: string, channel: MessageChannel) {
  return DEFAULTS.find((d) => d.purpose === purpose && d.channel === channel) ?? null;
}

/** Fills {{placeholders}}; unknown placeholders become empty strings. */
export function renderTemplate(text: string, vars: Record<string, string | number | null | undefined>) {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (vars[k] === null || vars[k] === undefined ? '' : String(vars[k])));
}

@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** All templates for the organisation, creating any missing defaults first. */
  async list() {
    const db = this.prisma.db;
    const existing = await db.messageTemplate.findMany();
    const missing = DEFAULTS.filter((d) => !existing.some((e) => e.purpose === d.purpose && e.channel === d.channel));
    if (missing.length) {
      await db.messageTemplate.createMany({ data: missing.map((d) => ({ ...d, subject: d.subject ?? null, organizationId: RequestContext.orgId() })), skipDuplicates: true });
    }
    return db.messageTemplate.findMany({ orderBy: [{ purpose: 'asc' }, { channel: 'asc' }] });
  }

  async get(purpose: string, channel: MessageChannel) {
    const t = await this.prisma.db.messageTemplate.findFirst({ where: { purpose, channel, isActive: true } });
    if (t) return t;
    await this.list();
    return this.prisma.db.messageTemplate.findFirst({ where: { purpose, channel, isActive: true } });
  }

  async save(input: { purpose: string; channel: MessageChannel; subject?: string | null; body: string; isActive: boolean }) {
    await this.list();
    const ctx = RequestContext.require();
    return this.prisma.db.$transaction(async (tx) => {
      const t = await tx.messageTemplate.upsert({
        where: { organizationId_purpose_channel: { organizationId: ctx.organizationId!, purpose: input.purpose, channel: input.channel } },
        update: { subject: input.subject ?? null, body: input.body, isActive: input.isActive, updatedByName: ctx.userName },
        create: { ...input, subject: input.subject ?? null, organizationId: ctx.organizationId!, updatedByName: ctx.userName },
      });
      await this.audit.record({ action: 'message_template.updated', entityType: 'Organization', entityId: ctx.organizationId!, summary: `${input.purpose} (${input.channel})` }, tx);
      return t;
    });
  }
}
