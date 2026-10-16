import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MessageChannel } from '@prisma/client';
import { formatInTimeZone } from 'date-fns-tz';
import { RequestContext } from '../../common/context/request-context';
import { PrismaService } from '../../common/prisma/prisma.service';
import { localParts } from '../../common/time/tz';
import { MessagesService } from './messages.service';

const DAY = 86400_000;

interface ClientContact {
  id: string;
  displayName: string;
  email: string | null;
  mobilePhone: string | null;
  preferredChannel: string;
  remindersConsent: boolean;
  status: string;
}

/**
 * Generates reminder messages (care due soon, care overdue, upcoming appointments). Each item or
 * appointment is flagged in the same transaction as its message is queued, and messages carry a dedupe
 * key, so reminders are never sent twice even if the job runs concurrently or is retried.
 * Clients who have opted out of reminders receive none.
 */
@Injectable()
export class RemindersService {
  private readonly log = new Logger(RemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly messages: MessagesService,
  ) {}

  /** Preferred channel when usable, otherwise email, otherwise the preferred channel (logged as not sent). */
  private channelFor(c: ClientContact): MessageChannel {
    const preferred = (['EMAIL', 'SMS', 'WHATSAPP'].includes(c.preferredChannel) ? c.preferredChannel : 'SMS') as MessageChannel;
    if (preferred !== 'EMAIL' && c.mobilePhone) return preferred;
    if (preferred === 'EMAIL' && c.email) return 'EMAIL';
    if (c.email) return 'EMAIL';
    return preferred;
  }

  @Cron(CronExpression.EVERY_HOUR)
  async hourly() {
    if (process.env.NODE_ENV === 'test') return;
    const orgs = await this.prisma.raw.organization.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
    for (const o of orgs) {
      try {
        await RequestContext.runAs({ organizationId: o.id, userName: 'System' }, () => this.run());
      } catch (e) {
        this.log.error(`Reminders failed for ${o.id}: ${(e as Error).message}`);
      }
    }
  }

  /** Runs all reminder types for the current organisation. */
  async run(now = new Date()) {
    const org = await this.prisma.raw.organization.findUniqueOrThrow({ where: { id: RequestContext.orgId() } });
    const today = new Date(localParts(now, org.defaultTimezone).date);
    const base = { clinicName: org.name, clinicPhoneLine: org.phone ? ` on ${org.phone}` : '' };
    const due = await this.careReminders('CARE_REMINDER', today, org.reminderLeadDays, org.overdueReminderDays, base);
    const overdue = await this.careReminders('CARE_OVERDUE', today, org.reminderLeadDays, org.overdueReminderDays, base);
    const appointments = await this.appointmentReminders(now, org.appointmentReminderHours, base);
    return { careDue: due, careOverdue: overdue, appointments };
  }

  private async careReminders(purpose: 'CARE_REMINDER' | 'CARE_OVERDUE', today: Date, leadDays: number, overdueDays: number, base: Record<string, string>) {
    const db = this.prisma.db;
    const horizon = new Date(today.getTime() + leadDays * DAY);
    const overdueBefore = new Date(today.getTime() - overdueDays * DAY);
    const items = await db.careItem.findMany({
      where:
        purpose === 'CARE_REMINDER'
          ? { remindedAt: null, OR: [{ status: 'DUE', dueDate: { gte: today, lte: horizon } }, { status: 'DEFERRED', deferredUntil: { gte: today, lte: horizon } }], patient: { status: 'ACTIVE' } }
          : { overdueRemindedAt: null, OR: [{ status: 'DUE', dueDate: { lt: overdueBefore } }, { status: 'DEFERRED', deferredUntil: { lt: overdueBefore } }], patient: { status: 'ACTIVE' } },
      include: { patient: { select: { id: true, name: true, ownerships: { where: { endedAt: null, isPrimary: true }, select: { client: true } } } } },
      orderBy: { dueDate: 'asc' },
    });
    // One message per client, listing all of their animals' items.
    const byClient = new Map<string, { client: ClientContact; items: typeof items }>();
    for (const i of items) {
      const client = i.patient.ownerships[0]?.client as ClientContact | undefined;
      if (!client || client.status !== 'ACTIVE') continue;
      const entry = byClient.get(client.id) ?? { client, items: [] };
      entry.items.push(i);
      byClient.set(client.id, entry);
    }
    let queued = 0;
    const stamp = today.toISOString().slice(0, 10);
    for (const { client, items: list } of byClient.values()) {
      const flag = purpose === 'CARE_REMINDER' ? { remindedAt: new Date() } : { overdueRemindedAt: new Date() };
      await db.$transaction(async (tx) => {
        // Opted-out clients get no message; their items are still flagged so we don't re-check them hourly.
        if (client.remindersConsent) {
          const channel = this.channelFor(client);
          const pets = [...new Set(list.map((i) => i.patient.name))];
          await this.messages.enqueueTemplate(
            tx,
            purpose,
            channel,
            {
              ...base,
              clientName: client.displayName,
              petNames: pets.join(' & '),
              items: list.map((i) => `• ${i.patient.name}: ${i.title} — ${(i.status === 'DEFERRED' && i.deferredUntil ? i.deferredUntil : i.dueDate).toISOString().slice(0, 10)}`).join('\n'),
              itemsShort: [...new Set(list.map((i) => i.title))].join(', '),
            },
            { clientId: client.id, patientId: list.length === 1 ? list[0].patientId : null, recipient: MessagesService.recipientFor(client, channel), dedupeKey: `${purpose}:${client.id}:${stamp}`, sourceType: 'CareItem', sourceId: list[0].id },
          );
          queued++;
        }
        await tx.careItem.updateMany({ where: { id: { in: list.map((i) => i.id) } }, data: flag });
      });
    }
    return queued;
  }

  private async appointmentReminders(now: Date, hours: number, base: Record<string, string>) {
    const db = this.prisma.db;
    const appts = await db.appointment.findMany({
      where: { status: { in: ['BOOKED', 'CONFIRMED'] }, reminderSentAt: null, startsAt: { gt: new Date(now.getTime() + 3600_000), lte: new Date(now.getTime() + hours * 3600_000) } },
      include: { client: true, patient: { select: { name: true } }, appointmentType: { select: { name: true } }, branch: { select: { timezone: true } } },
    });
    let queued = 0;
    for (const a of appts) {
      const client = a.client as unknown as ClientContact;
      await db.$transaction(async (tx) => {
        if (client.remindersConsent && client.status === 'ACTIVE') {
          const channel = this.channelFor(client);
          await this.messages.enqueueTemplate(
            tx,
            'APPOINTMENT_REMINDER',
            channel,
            { ...base, clientName: client.displayName, petName: a.patient?.name ?? 'your animal', appointmentType: a.appointmentType.name, appointmentTime: formatInTimeZone(a.startsAt, a.branch.timezone, 'EEE d MMM, HH:mm') },
            { clientId: client.id, patientId: a.patientId, recipient: MessagesService.recipientFor(client, channel), dedupeKey: `APPOINTMENT_REMINDER:${a.id}`, sourceType: 'Appointment', sourceId: a.id },
          );
          queued++;
        }
        await tx.appointment.update({ where: { id: a.id }, data: { reminderSentAt: new Date() } });
      });
    }
    return queued;
  }
}
