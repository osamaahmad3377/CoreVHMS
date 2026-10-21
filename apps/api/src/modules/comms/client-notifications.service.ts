import { Injectable, OnModuleInit } from '@nestjs/common';
import { MessageChannel } from '@prisma/client';
import { CLIENT_NOTIFICATION_EVENTS, formatMoney, toWhatsAppNumber, type ClientNotificationEvent } from '@vcms/shared';
import { formatInTimeZone } from 'date-fns-tz';
import { AuditService } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { ClientEvent, ClientEvents } from '../../common/events/client-events';
import { PrismaService } from '../../common/prisma/prisma.service';
import { receiptNo } from '../billing/payments.service';
import { WhatsAppService } from '../integrations/whatsapp.service';
import { MessagesService } from './messages.service';

type Vars = Record<string, string | number | null | undefined>;

interface Notification {
  client: { id: string; displayName: string; email: string | null; mobilePhone: string | null; preferredChannel: string; status: string };
  patientId: string | null;
  vars: Vars;
  dedupeKey: string;
  sourceType: string;
  sourceId: string;
}

const day = (d: Date, tz: string) => formatInTimeZone(d, tz, 'd MMM yyyy');
const dateOnly = (d: Date) => formatInTimeZone(d, 'UTC', 'd MMM yyyy');

/**
 * Automatic client notifications: when an appointment is booked, moved or cancelled, results are ready, an
 * animal goes home, a payment is received or a vaccination is given, the client gets a message — on WhatsApp
 * when the clinic has connected it, and by email when the clinic switches that on (Settings → Client
 * notifications). Messages go through the normal queue (retries, delivery log, dedupe), after the change is saved.
 */
@Injectable()
export class ClientNotificationsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: ClientEvents,
    private readonly messages: MessagesService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  onModuleInit() {
    this.events.subscribe(async (e) => {
      await this.handle(e);
    });
  }

  /** Each notification and its channels (defaults: WhatsApp on, email off). */
  async rules() {
    const rows = await this.prisma.db.clientNotificationRule.findMany();
    return CLIENT_NOTIFICATION_EVENTS.map((event) => {
      const r = rows.find((x) => x.event === event);
      return { event, whatsapp: r?.whatsapp ?? true, email: r?.email ?? false, updatedByName: r?.updatedByName ?? null };
    });
  }

  async overview() {
    const orgId = RequestContext.orgId();
    const [rules, wa, links] = await Promise.all([this.rules(), this.whatsapp.sending(orgId), this.prisma.db.whatsAppTemplateLink.findMany({ select: { purpose: true } })]);
    const connected = !!(await this.prisma.db.whatsAppIntegration.findFirst({ select: { id: true } }));
    return { rules, whatsapp: { connected, active: wa.active, linked: links.map((l) => l.purpose) } };
  }

  async saveRule(input: { event: ClientNotificationEvent; whatsapp: boolean; email: boolean }) {
    const ctx = RequestContext.require();
    await this.prisma.db.$transaction(async (tx) => {
      await tx.clientNotificationRule.upsert({
        where: { organizationId_event: { organizationId: ctx.organizationId!, event: input.event } },
        update: { whatsapp: input.whatsapp, email: input.email, updatedByName: ctx.userName ?? null },
        create: { organizationId: ctx.organizationId!, event: input.event, whatsapp: input.whatsapp, email: input.email, updatedByName: ctx.userName ?? null },
      });
      await this.audit.record({ action: 'client_notification.updated', entityType: 'Organization', entityId: ctx.organizationId!, summary: `${input.event}: WhatsApp ${input.whatsapp ? 'on' : 'off'}, email ${input.email ? 'on' : 'off'}` }, tx);
    });
    return this.overview();
  }

  /** Builds the message for an event and queues it on the right channel (or nothing when no channel applies). */
  async handle(e: ClientEvent) {
    const orgId = RequestContext.orgId();
    const rule = (await this.rules()).find((r) => r.event === e.type)!;
    if (!rule.whatsapp && !rule.email) return null;
    const org = await this.prisma.raw.organization.findUniqueOrThrow({ where: { id: orgId }, select: { name: true, phone: true, country: true, currency: true, defaultTimezone: true } });
    const n = await this.build(e, org);
    if (!n || n.client.status !== 'ACTIVE') return null;
    const wa = await this.whatsapp.sending(orgId);
    const byWhatsApp = rule.whatsapp && wa.active && !!toWhatsAppNumber(n.client.mobilePhone, org.country);
    const byEmail = rule.email && !!n.client.email;
    // A client who asked for email gets email when the clinic sends it; otherwise WhatsApp comes first.
    const channel: MessageChannel | null = n.client.preferredChannel === 'EMAIL' && byEmail ? 'EMAIL' : byWhatsApp ? 'WHATSAPP' : byEmail ? 'EMAIL' : null;
    if (!channel) return null;
    return this.messages.enqueueTemplate(
      this.prisma.db,
      e.type,
      channel,
      { clinicName: org.name, clinicPhone: org.phone ?? '', clinicPhoneLine: org.phone ? ` on ${org.phone}` : '', clientName: n.client.displayName, ...n.vars },
      { clientId: n.client.id, patientId: n.patientId, recipient: MessagesService.recipientFor(n.client, channel), dedupeKey: n.dedupeKey, sourceType: n.sourceType, sourceId: n.sourceId },
    );
  }

  private async build(e: ClientEvent, org: { currency: string; defaultTimezone: string }): Promise<Notification | null> {
    const db = this.prisma.db;
    const owner = { select: { id: true, displayName: true, email: true, mobilePhone: true, preferredChannel: true, status: true } } as const;
    switch (e.type) {
      case 'APPOINTMENT_BOOKED':
      case 'APPOINTMENT_RESCHEDULED':
      case 'APPOINTMENT_CANCELLED': {
        const a = await db.appointment.findUnique({ where: { id: e.appointmentId }, include: { client: owner, patient: { select: { name: true } }, appointmentType: { select: { name: true } }, branch: { select: { name: true, timezone: true } } } });
        if (!a) return null;
        return {
          client: a.client,
          patientId: a.patientId,
          vars: { petName: a.patient?.name ?? 'your animal', appointmentTime: formatInTimeZone(a.startsAt, a.branch.timezone, 'EEE d MMM, HH:mm'), appointmentType: a.appointmentType.name, branchName: a.branch.name },
          // A move is announced once per new time; booking and cancelling once per appointment.
          dedupeKey: e.type === 'APPOINTMENT_RESCHEDULED' ? `${e.type}:${a.id}:${a.startsAt.toISOString()}` : `${e.type}:${a.id}`,
          sourceType: 'Appointment',
          sourceId: a.id,
        };
      }
      case 'LAB_RESULTS_READY': {
        const o = await db.diagnosticOrder.findUnique({ where: { id: e.orderId }, include: { client: owner, patient: { select: { name: true } }, items: { where: { status: { not: 'CANCELLED' } }, select: { test: { select: { name: true } } } } } });
        if (!o) return null;
        return { client: o.client, patientId: o.patientId, vars: { petName: o.patient.name, testNames: o.items.map((i) => i.test.name).join(', ') }, dedupeKey: `${e.type}:${o.id}`, sourceType: 'DiagnosticOrder', sourceId: o.id };
      }
      case 'PATIENT_DISCHARGED': {
        const a = await db.admission.findUnique({ where: { id: e.admissionId }, include: { client: owner, patient: { select: { name: true } } } });
        if (!a) return null;
        return {
          client: a.client,
          patientId: a.patientId,
          vars: { petName: a.patient.name, homeCare: a.homeCareInstructions || 'As discussed at discharge', followUpDate: a.followUpAt ? day(a.followUpAt, org.defaultTimezone) : 'none booked' },
          dedupeKey: `${e.type}:${a.id}`,
          sourceType: 'Admission',
          sourceId: a.id,
        };
      }
      case 'PAYMENT_RECEIVED': {
        const p = await db.payment.findUnique({ where: { id: e.paymentId }, include: { client: { select: { ...owner.select, balanceMinor: true } } } });
        if (!p?.client) return null;
        return {
          client: p.client,
          patientId: null,
          vars: { amount: formatMoney(p.amountMinor, org.currency), receiptNumber: receiptNo(p.number), paymentDate: day(p.receivedAt, org.defaultTimezone), balance: formatMoney(Math.max(0, p.client.balanceMinor), org.currency) },
          dedupeKey: `${e.type}:${p.id}`,
          sourceType: 'Payment',
          sourceId: p.id,
        };
      }
      case 'VACCINATION_GIVEN': {
        const i = await db.careItem.findUnique({ where: { id: e.careItemId }, include: { patient: { select: { name: true, ownerships: { where: { endedAt: null, isPrimary: true }, select: { client: owner } } } } } });
        const client = i?.patient.ownerships[0]?.client;
        if (!i || !client) return null;
        const next = await db.careItem.findFirst({ where: { previousItemId: i.id, status: { in: ['DUE', 'DEFERRED'] } }, select: { dueDate: true } });
        return {
          client,
          patientId: i.patientId,
          vars: { petName: i.patient.name, vaccineName: i.title, givenDate: day(i.completedAt ?? new Date(), org.defaultTimezone), nextDueDate: next ? dateOnly(next.dueDate) : 'we will let you know' },
          dedupeKey: `${e.type}:${i.id}`,
          sourceType: 'CareItem',
          sourceId: i.id,
        };
      }
    }
  }
}
