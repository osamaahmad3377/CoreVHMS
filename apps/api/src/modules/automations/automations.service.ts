import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Automation, AutomationRun, MessageChannel, Prisma } from '@prisma/client';
import {
  AUTOMATION_RECIPES,
  CHECK_INFO,
  TRIGGER_INFO,
  conditionsMet,
  waitMs,
  type AutomationCondition,
  type AutomationInput,
  type AutomationStep,
  type AutomationTrigger,
} from '@vcms/shared';
import { AuditService } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { ClientEvent, ClientEvents } from '../../common/events/client-events';
import { notFound, ruleViolation } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { appUrl } from '../../common/tenancy/hosts';
import { TenancyService } from '../../common/tenancy/tenancy.service';
import { addDays, localDateOnly, localDayBounds, localParts, zonedToUtc } from '../../common/time/tz';
import { renderTemplate } from '../comms/templates.service';
import { MessagesService } from '../comms/messages.service';
import { EmailIntegrationService } from '../integrations/email-integration.service';
import { WhatsAppService } from '../integrations/whatsapp.service';
import { buildContext, OrgInfo, RunContext, SOURCE_OF } from './automation-context';
import { nextAt } from './automation-time';

const SCAN_EVERY_MS = 5 * 60_000;
const STUCK_MS = 10 * 60_000;
const TIMED: AutomationTrigger[] = ['APPOINTMENT_UPCOMING', 'CARE_DUE', 'PET_BIRTHDAY', 'SURGERY_UPCOMING', 'INVOICE_OVERDUE', 'PATIENT_LAPSED'];

interface LogEntry {
  step: number;
  type: string;
  at: string;
  ok: boolean;
  note: string;
  messageId?: string;
  taskId?: string;
}

const sourceIdOf = (e: ClientEvent): string =>
  'appointmentId' in e ? e.appointmentId
  : 'orderId' in e ? e.orderId
  : 'admissionId' in e ? e.admissionId
  : 'paymentId' in e ? e.paymentId
  : 'careItemId' in e ? e.careItemId
  : 'prescriptionId' in e ? e.prescriptionId
  : 'surgeryId' in e ? e.surgeryId
  : 'estimateId' in e ? e.estimateId
  : e.clientId;


/**
 * The clinic's own workflows: when something happens (or a date comes round), and the conditions hold, run the
 * steps — send a message on the client's best channel, wait, create a task for staff, email the team. Each run is
 * recorded step by step; waits park the run until it is due; a run stops by itself when the record no longer calls
 * for it (an appointment cancelled before its reminder). Messages respect the client's consent and go through the
 * normal queue (retries, delivery log).
 */
@Injectable()
export class AutomationsService implements OnModuleInit {
  private readonly log = new Logger(AutomationsService.name);
  private ticking = false;
  private lastScan = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: ClientEvents,
    private readonly messages: MessagesService,
    private readonly whatsapp: WhatsAppService,
    private readonly mailbox: EmailIntegrationService,
    private readonly tenancy: TenancyService,
  ) {}

  onModuleInit() {
    this.events.subscribe((e) => this.onEvent(e));
  }

  // ── Managing automations ──

  async list() {
    const db = this.prisma.db;
    const [rows, waiting, recent] = await Promise.all([
      db.automation.findMany({ orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }] }),
      db.automationRun.groupBy({ by: ['automationId'], where: { status: 'WAITING' }, _count: true }),
      db.automationRun.groupBy({ by: ['automationId', 'status'], where: { createdAt: { gte: new Date(Date.now() - 30 * 86400_000) } }, _count: true }),
    ]);
    return rows.map((a) => ({
      ...a,
      waiting: waiting.find((w) => w.automationId === a.id)?._count ?? 0,
      last30Days: Object.fromEntries(recent.filter((r) => r.automationId === a.id).map((r) => [r.status, r._count])),
    }));
  }

  async get(id: string) {
    const a = await this.prisma.db.automation.findUnique({ where: { id } });
    if (!a) throw notFound('Automation');
    return a;
  }

  /** Lists for the builder: species, branches, appointment types, staff, and which channels can send. */
  async options() {
    const db = this.prisma.db;
    const orgId = RequestContext.orgId();
    const [species, branches, types, staff, wa, mailbox] = await Promise.all([
      db.species.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      db.branch.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      db.appointmentType.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      db.membership.findMany({ where: { status: 'ACTIVE' }, orderBy: { user: { name: 'asc' } }, select: { id: true, jobTitle: true, user: { select: { name: true } } } }),
      this.whatsapp.sending(orgId),
      this.mailbox.usable(orgId),
    ]);
    return {
      species,
      branches,
      appointmentTypes: types,
      staff: staff.map((m) => ({ id: m.id, name: m.user.name, jobTitle: m.jobTitle })),
      channels: { whatsapp: wa.active, email: mailbox ? { own: true, address: mailbox.email } : { own: false, address: null } },
      recipes: AUTOMATION_RECIPES,
    };
  }

  private data(input: AutomationInput) {
    const timed = TRIGGER_INFO[input.trigger].timed;
    return {
      name: input.name,
      description: input.description || null,
      isActive: input.isActive,
      marketing: input.marketing,
      trigger: input.trigger,
      offset: timed && timed !== 'ON_DAY' ? (input.offset ?? 0) : null,
      atHour: timed && timed !== 'HOURS_BEFORE' ? (input.atHour ?? null) : null,
      sendFromHour: input.sendFromHour != null && input.sendToHour != null ? input.sendFromHour : null,
      sendToHour: input.sendFromHour != null && input.sendToHour != null ? input.sendToHour : null,
      cooldownDays: input.cooldownDays ?? null,
      conditions: input.conditions as unknown as Prisma.InputJsonValue,
      steps: input.steps as unknown as Prisma.InputJsonValue,
    };
  }

  private async validateRefs(input: AutomationInput) {
    const staffIds = input.steps.flatMap((s) => (s.type === 'CREATE_TASK' && s.assigneeId ? [s.assigneeId] : []));
    if (staffIds.length && (await this.prisma.db.membership.count({ where: { id: { in: staffIds } } })) !== new Set(staffIds).size) {
      throw ruleViolation('INVALID_STAFF', 'Choose a staff member from this clinic');
    }
    const allowed = new Set(TRIGGER_INFO[input.trigger].conditions);
    const bad = input.conditions.find((c) => !allowed.has(c.field));
    if (bad) throw ruleViolation('INVALID_CONDITION', `“${bad.field}” does not apply to ${TRIGGER_INFO[input.trigger].label.toLowerCase()}`);
  }

  async create(input: AutomationInput) {
    await this.validateRefs(input);
    const ctx = RequestContext.require();
    return this.prisma.db.$transaction(async (tx) => {
      const a = await tx.automation.create({ data: { ...this.data(input), organizationId: ctx.organizationId!, createdByName: ctx.userName ?? null, updatedByName: ctx.userName ?? null } });
      await this.audit.record({ action: 'automation.created', entityType: 'Organization', entityId: ctx.organizationId!, summary: `${a.name} (${TRIGGER_INFO[input.trigger].label})` }, tx);
      return a;
    });
  }

  async update(id: string, input: AutomationInput) {
    await this.get(id);
    await this.validateRefs(input);
    const ctx = RequestContext.require();
    return this.prisma.db.$transaction(async (tx) => {
      const a = await tx.automation.update({ where: { id }, data: { ...this.data(input), updatedByName: ctx.userName ?? null } });
      await this.audit.record({ action: 'automation.updated', entityType: 'Organization', entityId: ctx.organizationId!, summary: `${a.name}${a.isActive ? '' : ' (off)'}` }, tx);
      return a;
    });
  }

  async setActive(id: string, isActive: boolean) {
    const before = await this.get(id);
    const ctx = RequestContext.require();
    return this.prisma.db.$transaction(async (tx) => {
      const a = await tx.automation.update({ where: { id }, data: { isActive, updatedByName: ctx.userName ?? null } });
      await this.audit.record({ action: isActive ? 'automation.switched_on' : 'automation.switched_off', entityType: 'Organization', entityId: ctx.organizationId!, summary: before.name }, tx);
      return a;
    });
  }

  async remove(id: string) {
    const a = await this.get(id);
    const ctx = RequestContext.require();
    await this.prisma.db.$transaction(async (tx) => {
      await tx.automation.delete({ where: { id } });
      await this.audit.record({ action: 'automation.deleted', entityType: 'Organization', entityId: ctx.organizationId!, summary: a.name }, tx);
    });
    return { ok: true };
  }

  /** Headline numbers for the last 30 days. */
  async stats() {
    const db = this.prisma.db;
    const since = new Date(Date.now() - 30 * 86_400_000);
    const [total, active, waiting, runs, problems, sent, tasks] = await Promise.all([
      db.automation.count(),
      db.automation.count({ where: { isActive: true } }),
      db.automationRun.count({ where: { status: 'WAITING' } }),
      db.automationRun.count({ where: { createdAt: { gte: since } } }),
      db.automationRun.count({ where: { createdAt: { gte: since }, status: { in: ['FAILED', 'SKIPPED'] } } }),
      db.outboundMessage.count({ where: { purpose: { in: ['AUTOMATION', 'AUTOMATION_TEAM'] }, status: 'SENT', createdAt: { gte: since } } }),
      db.task.count({ where: { createdByName: { startsWith: 'Automation:' }, createdAt: { gte: since } } }),
    ]);
    return { total, active, waiting, runs, problems, sent, tasks };
  }

  /** A copy to adapt (switched off until saved on). */
  async duplicate(id: string) {
    const a = await this.get(id);
    const ctx = RequestContext.require();
    return this.prisma.db.$transaction(async (tx) => {
      const copy = await tx.automation.create({
        data: {
          organizationId: ctx.organizationId!,
          name: `${a.name} (copy)`.slice(0, 120),
          description: a.description,
          isActive: false,
          marketing: a.marketing,
          trigger: a.trigger,
          offset: a.offset,
          atHour: a.atHour,
          sendFromHour: a.sendFromHour,
          sendToHour: a.sendToHour,
          cooldownDays: a.cooldownDays,
          conditions: a.conditions as Prisma.InputJsonValue,
          steps: a.steps as Prisma.InputJsonValue,
          createdByName: ctx.userName ?? null,
          updatedByName: ctx.userName ?? null,
        },
      });
      await this.audit.record({ action: 'automation.created', entityType: 'Organization', entityId: ctx.organizationId!, summary: `${copy.name} (copy of ${a.name})` }, tx);
      return copy;
    });
  }

  /** What automations did lately (or one automation's runs), newest first. */
  async runs(q: { automationId?: string; status?: string; page: number; pageSize: number }) {
    const where: Prisma.AutomationRunWhereInput = { automationId: q.automationId, status: q.status || undefined };
    const [rows, total] = await Promise.all([
      this.prisma.db.automationRun.findMany({ where, orderBy: { updatedAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { automation: { select: { name: true, trigger: true, steps: true } } } }),
      this.prisma.db.automationRun.count({ where }),
    ]);
    return { data: rows, meta: { page: q.page, pageSize: q.pageSize, total } };
  }

  async stopRun(id: string) {
    const r = await this.prisma.db.automationRun.findUnique({ where: { id } });
    if (!r) throw notFound('Run');
    if (r.status !== 'WAITING') throw ruleViolation('NOT_WAITING', 'Only a run that is waiting can be stopped');
    const ctx = RequestContext.require();
    return this.prisma.db.automationRun.update({ where: { id }, data: { status: 'STOPPED', error: `Stopped by ${ctx.userName ?? 'staff'}` } });
  }

  /**
   * A dry run on a recent real record (or the one given): whether the conditions hold and what each step would
   * send or create — nothing is sent.
   */
  async preview(input: AutomationInput, sourceId?: string | null) {
    const org = await this.orgInfo();
    const id = sourceId ?? (await this.recentExample(input.trigger));
    if (!id) return { example: null, conditionsMet: false, steps: [] as unknown[] };
    const ctx = await buildContext(this.prisma.db, input.trigger, id, org);
    if (!ctx) return { example: null, conditionsMet: false, steps: [] as unknown[] };
    const met = conditionsMet(input.conditions, ctx.facts);
    let delayMs = 0;
    const steps = [];
    for (const s of input.steps) {
      if (s.type === 'WAIT') {
        delayMs += waitMs(s);
        steps.push({ type: s.type, note: `Wait ${s.amount} ${s.unit.toLowerCase()}` });
        continue;
      }
      if (s.type === 'WAIT_UNTIL') {
        steps.push({ type: s.type, note: `Wait until ${String(s.hour).padStart(2, '0')}:00${s.skipDays.length ? ' (not on closed days)' : ''}` });
        continue;
      }
      if (s.type === 'CHECK') {
        const stops = await this.checkFails(s.check, ctx);
        steps.push({ type: s.type, note: stops ? `${CHECK_INFO[s.check].stopped} (right now it would stop here)` : `Only continues if ${CHECK_INFO[s.check].label} — right now it would continue` });
        continue;
      }
      const hours = delayMs / 3_600_000;
      const when = !delayMs ? 'straight away' : hours >= 48 ? `after ${Math.round(hours / 24)} days` : hours >= 1 ? `after ${Math.round(hours)} h` : `after ${Math.round(delayMs / 60_000)} min`;
      if (s.type === 'SEND_MESSAGE') {
        const channel = ctx.client ? (s.channel === 'BEST' ? await this.messages.chooseChannel(ctx.client) : s.channel) : null;
        const consent = this.consentProblem(ctx, input.marketing);
        steps.push({
          type: s.type,
          when,
          channel,
          recipient: ctx.client && channel ? MessagesService.recipientFor(ctx.client, channel) : null,
          subject: channel === 'EMAIL' ? renderTemplate(s.subject || 'Message from {{clinicName}}', ctx.vars) : null,
          body: renderTemplate(s.body, ctx.vars),
          note: consent ?? (!ctx.client ? 'No client to write to' : null),
        });
      } else if (s.type === 'CREATE_TASK') {
        steps.push({ type: s.type, when, title: renderTemplate(s.title, ctx.vars), details: s.details ? renderTemplate(s.details, ctx.vars) : null, note: s.dueInDays ? `Due ${s.dueInDays} day(s) later` : 'Due the same day' });
      } else if (s.type === 'EMAIL_TEAM') {
        steps.push({ type: s.type, when, recipient: s.to, subject: renderTemplate(s.subject, ctx.vars), body: renderTemplate(s.body, ctx.vars) });
      }
    }
    return { example: { id, label: ctx.label, client: ctx.client?.displayName ?? null }, conditionsMet: met, steps };
  }

  private async recentExample(trigger: AutomationTrigger): Promise<string | null> {
    const db = this.prisma.db;
    const pick = (r: { id: string } | null) => r?.id ?? null;
    switch (SOURCE_OF[trigger]) {
      case 'Appointment': {
        const status = trigger === 'APPOINTMENT_CANCELLED' ? 'CANCELLED' : trigger === 'APPOINTMENT_NO_SHOW' ? 'NO_SHOW' : trigger === 'APPOINTMENT_COMPLETED' ? 'COMPLETED' : trigger === 'APPOINTMENT_CHECKED_IN' ? { in: ['CHECKED_IN', 'IN_CONSULTATION', 'COMPLETED'] as ('CHECKED_IN' | 'IN_CONSULTATION' | 'COMPLETED')[] } : undefined;
        return pick(await db.appointment.findFirst({ where: { status, patientId: { not: null } }, orderBy: { startsAt: 'desc' }, select: { id: true } }));
      }
      case 'DiagnosticOrder':
        return pick(await db.diagnosticOrder.findFirst({ where: { status: 'RELEASED' }, orderBy: { releasedAt: 'desc' }, select: { id: true } }));
      case 'Admission':
        return pick(await db.admission.findFirst({ orderBy: { createdAt: 'desc' }, select: { id: true } }));
      case 'Payment':
        return pick(await db.payment.findFirst({ where: { clientId: { not: null } }, orderBy: { receivedAt: 'desc' }, select: { id: true } }));
      case 'CareItem':
        return pick(await db.careItem.findFirst({ where: trigger === 'CARE_DUE' ? { status: 'DUE' } : { status: 'COMPLETED' }, orderBy: trigger === 'CARE_DUE' ? { dueDate: 'asc' } : { completedAt: 'desc' }, select: { id: true } }));
      case 'Client':
        return pick(await db.client.findFirst({ where: { status: 'ACTIVE' }, orderBy: { createdAt: 'desc' }, select: { id: true } }));
      case 'Patient':
        if (trigger === 'PATIENT_LAPSED') return (await db.appointment.findFirst({ where: { status: 'COMPLETED', patientId: { not: null } }, orderBy: { startsAt: 'asc' }, select: { patientId: true } }))?.patientId ?? null;
        return pick(await db.patient.findFirst({ where: { status: 'ACTIVE', dateOfBirth: { not: null } }, orderBy: { createdAt: 'desc' }, select: { id: true } }));
      case 'Surgery':
        return pick(await db.surgery.findFirst({ where: trigger === 'SURGERY_COMPLETED' ? { status: 'COMPLETED' } : {}, orderBy: { scheduledAt: 'desc' }, select: { id: true } }));
      case 'Prescription':
        return pick(await db.prescription.findFirst({ where: { status: { in: ['DISPENSED', 'PARTIALLY_DISPENSED'] } }, orderBy: { updatedAt: 'desc' }, select: { id: true } }));
      case 'Estimate':
        return pick(await db.estimate.findFirst({ orderBy: { createdAt: 'desc' }, select: { id: true } }));
      case 'Invoice':
        return pick(await db.invoice.findFirst({ where: { status: { in: ['ISSUED', 'PARTIALLY_PAID'] }, balanceMinor: { gt: 0 }, clientId: { not: null } }, orderBy: { dueAt: 'asc' }, select: { id: true } }));
    }
    return null;
  }

  // ── Running ──

  private async orgInfo(): Promise<OrgInfo> {
    const orgId = RequestContext.orgId();
    const [org, wa, booking] = await Promise.all([
      this.prisma.raw.organization.findUniqueOrThrow({ where: { id: orgId }, select: { name: true, brandName: true, phone: true, country: true, currency: true, defaultTimezone: true } }),
      this.whatsapp.sending(orgId),
      this.prisma.db.onlineBookingSettings.findFirst({ where: { enabled: true }, select: { slug: true } }),
    ]);
    return {
      name: org.brandName ?? org.name,
      phone: org.phone,
      country: org.country,
      currency: org.currency,
      timezone: org.defaultTimezone,
      whatsappActive: wa.active,
      bookingLine: booking ? `Book online: ${appUrl()}/book/${booking.slug}` : '',
    };
  }

  /** Something happened in the app: start every active automation listening for it. */
  async onEvent(e: ClientEvent) {
    const trigger = e.type as AutomationTrigger;
    if (!TRIGGER_INFO[trigger]) return;
    const list = await this.prisma.db.automation.findMany({ where: { trigger, isActive: true } });
    for (const a of list) await this.start(a, sourceIdOf(e));
  }

  /** Starts one automation for one record (once — the dedupe key guards repeats). */
  async start(a: Automation, sourceId: string, extraKey?: string) {
    const org = await this.orgInfo();
    const trigger = a.trigger as AutomationTrigger;
    const ctx = await buildContext(this.prisma.db, trigger, sourceId, org);
    if (!ctx || !ctx.live) return null;
    if (!conditionsMet(a.conditions as unknown as AutomationCondition[], ctx.facts)) return null;
    // Not again for the same client within the cooling-off period.
    if (a.cooldownDays && ctx.client) {
      const recent = await this.prisma.db.automationRun.count({ where: { automationId: a.id, clientId: ctx.client.id, createdAt: { gte: new Date(Date.now() - a.cooldownDays * 86_400_000) } } });
      if (recent) return null;
    }
    // A moved appointment counts once per new time.
    const dedupeKey = [trigger, sourceId, trigger === 'APPOINTMENT_RESCHEDULED' ? ctx.vars.appointmentTime : null, extraKey].filter(Boolean).join(':');
    let run: AutomationRun;
    try {
      run = await this.prisma.db.automationRun.create({
        data: {
          organizationId: RequestContext.orgId(),
          automationId: a.id,
          trigger,
          sourceType: ctx.sourceType,
          sourceId,
          dedupeKey,
          // RUNNING while this request works through the first steps, so the scheduler does not pick it up too.
          status: 'RUNNING',
          runAt: new Date(),
          clientId: ctx.client?.id ?? null,
          patientId: ctx.patientId,
          vars: ctx.vars as Prisma.InputJsonValue,
          facts: ctx.facts as unknown as Prisma.InputJsonValue,
          log: [] as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return null;
      throw err;
    }
    await this.prisma.db.automation.update({ where: { id: a.id }, data: { runCount: { increment: 1 }, lastRunAt: new Date() } });
    return this.process(run.id, ctx);
  }

  private consentProblem(ctx: RunContext, marketing: boolean) {
    if (!ctx.client) return null;
    if (ctx.client.status !== 'ACTIVE') return 'The client is not active';
    if (!ctx.client.remindersConsent) return 'The client asked not to receive messages';
    if (marketing && !ctx.client.marketingConsent) return 'The client has not agreed to marketing messages';
    return null;
  }

  /** Works through the steps from where the run stopped, until a wait or the end. */
  async process(runId: string, fresh?: RunContext) {
    const db = this.prisma.db;
    const run = await db.automationRun.findUnique({ where: { id: runId }, include: { automation: true } });
    if (!run || !['WAITING', 'RUNNING'].includes(run.status)) return run;
    const a = run.automation;
    const log = [...((run.log as unknown as LogEntry[]) ?? [])];
    const finish = (status: string, error?: string | null, extra: Partial<AutomationRun> = {}) =>
      db.automationRun.update({ where: { id: run.id }, data: { status, error: error ?? null, log: log as unknown as Prisma.InputJsonValue, ...extra } as Prisma.AutomationRunUpdateInput });
    if (!a.isActive) return finish('STOPPED', 'The automation was switched off');
    // Fresh facts each time it wakes up: the appointment may have moved or been cancelled meanwhile.
    const ctx = fresh ?? (await buildContext(db, a.trigger as AutomationTrigger, run.sourceId, await this.orgInfo()));
    if (!ctx) return finish('STOPPED', 'The record was removed');
    if (!ctx.live) return finish('STOPPED', ctx.why ?? 'No longer applies');
    const steps = a.steps as unknown as AutomationStep[];
    for (let i = run.nextStep; i < steps.length; i++) {
      const s = steps[i];
      const at = new Date().toISOString();
      try {
        if (s.type === 'WAIT') {
          const until = new Date(Date.now() + waitMs(s));
          log.push({ step: i, type: s.type, at, ok: true, note: `Waiting until ${until.toISOString()}` });
          return finish('WAITING', null, { nextStep: i + 1, runAt: until });
        }
        if (s.type === 'WAIT_UNTIL') {
          const until = nextAt(s.hour, s.skipDays, (await this.orgInfo()).timezone);
          log.push({ step: i, type: s.type, at, ok: true, note: `Waiting until ${until.toISOString()}` });
          return finish('WAITING', null, { nextStep: i + 1, runAt: until });
        }
        // Sending hours: a client message outside them waits for the next start of the window.
        if (s.type === 'SEND_MESSAGE' && a.sendFromHour != null && a.sendToHour != null) {
          const tz = (await this.orgInfo()).timezone;
          const minute = localParts(new Date(), tz).minuteOfDay;
          if (minute < a.sendFromHour * 60 || minute >= a.sendToHour * 60) {
            const until = nextAt(a.sendFromHour, [], tz);
            log.push({ step: i, type: 'WAIT', at, ok: true, note: `Waiting until ${until.toISOString()}` });
            return finish('WAITING', null, { nextStep: i, runAt: until });
          }
        }
        if (s.type === 'CHECK') {
          const failed = await this.checkFails(s.check, ctx);
          if (failed) {
            log.push({ step: i, type: s.type, at, ok: true, note: CHECK_INFO[s.check].stopped });
            return finish('DONE', null, { nextStep: steps.length });
          }
          log.push({ step: i, type: s.type, at, ok: true, note: `Checked: ${CHECK_INFO[s.check].label}` });
          continue;
        }
        if (s.type === 'SEND_MESSAGE') log.push(await this.sendStep(a, run, ctx, s, i));
        else if (s.type === 'CREATE_TASK') log.push(await this.taskStep(a, ctx, s, i));
        else if (s.type === 'EMAIL_TEAM') log.push(await this.teamStep(run, ctx, s, i));
      } catch (e) {
        log.push({ step: i, type: s.type, at, ok: false, note: (e as Error).message });
        return finish('FAILED', (e as Error).message, { nextStep: i });
      }
    }
    const skipped = log.length > 0 && log.filter((l) => !['WAIT', 'WAIT_UNTIL', 'CHECK'].includes(l.type)).every((l) => !l.ok);
    return finish(skipped ? 'SKIPPED' : 'DONE', skipped ? log[log.length - 1]?.note : null, { nextStep: steps.length });
  }

  /** True when an "Only continue if…" check no longer holds (the run then ends quietly). */
  private async checkFails(check: string, ctx: RunContext) {
    const db = this.prisma.db;
    if (check === 'NOT_BOOKED') {
      if (!ctx.client) return false;
      const booked = await db.appointment.count({
        where: { status: { in: ['BOOKED', 'CONFIRMED', 'CHECKED_IN'] }, startsAt: { gt: new Date() }, ...(ctx.patientId ? { patientId: ctx.patientId } : { clientId: ctx.client.id }), ...(ctx.sourceType === 'Appointment' ? { id: { not: ctx.sourceId } } : {}) },
      });
      return booked > 0;
    }
    if (check === 'STILL_UNPAID') {
      if (ctx.sourceType !== 'Invoice') return false;
      const inv = await db.invoice.findUnique({ where: { id: ctx.sourceId }, select: { status: true, balanceMinor: true } });
      return !inv || !['ISSUED', 'PARTIALLY_PAID'].includes(inv.status) || inv.balanceMinor <= 0;
    }
    if (check === 'ESTIMATE_OPEN') {
      if (ctx.sourceType !== 'Estimate') return false;
      const es = await db.estimate.findUnique({ where: { id: ctx.sourceId }, select: { status: true } });
      return es?.status !== 'SENT';
    }
    if (check === 'STILL_DUE') {
      if (ctx.sourceType !== 'CareItem') return false;
      const it = await db.careItem.findUnique({ where: { id: ctx.sourceId }, select: { status: true } });
      return it?.status !== 'DUE';
    }
    return false;
  }

  private async sendStep(a: Automation, run: AutomationRun, ctx: RunContext, s: Extract<AutomationStep, { type: 'SEND_MESSAGE' }>, i: number): Promise<LogEntry> {
    const at = new Date().toISOString();
    const problem = !ctx.client ? 'No client to write to' : this.consentProblem(ctx, a.marketing);
    if (problem || !ctx.client) return { step: i, type: s.type, at, ok: false, note: problem ?? 'No client to write to' };
    const channel: MessageChannel = s.channel === 'BEST' ? await this.messages.chooseChannel(ctx.client) : s.channel;
    const body = renderTemplate(s.body, ctx.vars);
    const m = await this.messages.enqueue(this.prisma.db, {
      clientId: ctx.client.id,
      patientId: ctx.patientId,
      channel,
      recipient: MessagesService.recipientFor(ctx.client, channel),
      subject: channel === 'EMAIL' ? renderTemplate(s.subject || 'Message from {{clinicName}}', ctx.vars) : null,
      body,
      purpose: 'AUTOMATION',
      dedupeKey: `automation:${run.id}:${i}`,
      sourceType: ctx.sourceType,
      sourceId: ctx.sourceId,
      vars: { ...ctx.vars, body },
    });
    const ok = m.status !== 'SKIPPED';
    return { step: i, type: s.type, at, ok, note: ok ? `${channel === 'WHATSAPP' ? 'WhatsApp' : channel === 'EMAIL' ? 'Email' : 'SMS'} to ${m.recipient}` : (m.lastError ?? 'Not sent'), messageId: m.id };
  }

  private async taskStep(a: Automation, ctx: RunContext, s: Extract<AutomationStep, { type: 'CREATE_TASK' }>, i: number): Promise<LogEntry> {
    const t = await this.prisma.db.task.create({
      data: {
        organizationId: RequestContext.orgId(),
        branchId: ctx.branchId,
        type: 'FOLLOW_UP_CALL',
        title: renderTemplate(s.title, ctx.vars).slice(0, 200),
        details: s.details ? renderTemplate(s.details, ctx.vars) : null,
        dueAt: addDays(new Date(), s.dueInDays),
        patientId: ctx.patientId,
        clientId: ctx.client?.id ?? null,
        assigneeId: s.assigneeId ?? ctx.vetMembershipId,
        createdByName: `Automation: ${a.name}`,
      },
    });
    return { step: i, type: s.type, at: new Date().toISOString(), ok: true, note: `Task “${t.title}”`, taskId: t.id };
  }

  private async teamStep(run: AutomationRun, ctx: RunContext, s: Extract<AutomationStep, { type: 'EMAIL_TEAM' }>, i: number): Promise<LogEntry> {
    const m = await this.messages.enqueue(this.prisma.db, {
      channel: 'EMAIL',
      recipient: s.to,
      subject: renderTemplate(s.subject, ctx.vars),
      body: renderTemplate(s.body, ctx.vars),
      purpose: 'AUTOMATION_TEAM',
      dedupeKey: `automation:${run.id}:${i}`,
      sourceType: ctx.sourceType,
      sourceId: ctx.sourceId,
    });
    return { step: i, type: s.type, at: new Date().toISOString(), ok: m.status !== 'SKIPPED', note: `Email to ${s.to}`, messageId: m.id };
  }

  // ── Scheduler (platform job: every clinic database) ──

  @Interval(30_000)
  async tick() {
    if (process.env.NODE_ENV === 'test' || this.ticking) return;
    this.ticking = true;
    try {
      const scan = Date.now() - this.lastScan >= SCAN_EVERY_MS;
      if (scan) this.lastScan = Date.now();
      await this.tenancy.forEachDatabase('Automations', async () => {
        await this.runDue();
        if (scan) await this.scanTimed();
      });
    } catch (e) {
      this.log.error(`Automations failed: ${(e as Error).message}`);
    } finally {
      this.ticking = false;
    }
  }

  /** Continues runs whose wait is over (claimed with SKIP LOCKED, so several API processes never double up). */
  async runDue(limit = 50) {
    const raw = this.prisma.raw;
    await raw.automationRun.updateMany({ where: { status: 'RUNNING', updatedAt: { lt: new Date(Date.now() - STUCK_MS) } }, data: { status: 'WAITING' } });
    const claimed = await raw.$queryRaw<{ id: string; organizationId: string }[]>`
      UPDATE "AutomationRun" SET "status" = 'RUNNING', "updatedAt" = now()
      WHERE "id" IN (
        SELECT "id" FROM "AutomationRun" WHERE "status" = 'WAITING' AND "runAt" <= now()
        ORDER BY "runAt" LIMIT ${limit} FOR UPDATE SKIP LOCKED
      ) RETURNING "id", "organizationId"`;
    for (const r of claimed) {
      await RequestContext.runAs({ organizationId: r.organizationId, userName: 'Automation' }, async () => {
        try {
          await this.process(r.id);
        } catch (e) {
          this.log.error(`Automation run ${r.id} failed: ${(e as Error).message}`);
          await raw.automationRun.update({ where: { id: r.id }, data: { status: 'FAILED', error: (e as Error).message } });
        }
      });
    }
    return claimed.length;
  }

  /** Date-based triggers: appointments coming up, care falling due, pets' birthdays. */
  async scanTimed(now = new Date()) {
    const autos = await this.prisma.raw.automation.findMany({ where: { isActive: true, trigger: { in: TIMED } } });
    const byOrg = new Map<string, Automation[]>();
    for (const a of autos) byOrg.set(a.organizationId, [...(byOrg.get(a.organizationId) ?? []), a]);
    let started = 0;
    for (const [organizationId, list] of byOrg) {
      await RequestContext.runAs({ organizationId, userName: 'Automation' }, async () => {
        const db = this.prisma.db;
        const tz = (await this.orgInfo()).timezone;
        const local = localParts(now, tz);
        for (const a of list) {
          // "At 10:00": not before that hour, clinic time.
          if (a.atHour != null && local.minuteOfDay < a.atHour * 60) continue;
          if (a.trigger === 'APPOINTMENT_UPCOMING') {
            const hours = a.offset ?? 24;
            const appts = await db.appointment.findMany({
              where: { status: { in: ['BOOKED', 'CONFIRMED'] }, startsAt: { gt: now, lte: new Date(now.getTime() + hours * 3_600_000) }, patientId: { not: null } },
              select: { id: true, startsAt: true, createdAt: true },
              take: 500,
            });
            for (const ap of appts) {
              // Booked inside the reminder window: the booking confirmation already told them.
              if (ap.createdAt.getTime() > ap.startsAt.getTime() - hours * 3_600_000) continue;
              if (await this.start(a, ap.id, ap.startsAt.toISOString())) started++;
            }
          } else if (a.trigger === 'CARE_DUE') {
            const target = addDays(localDateOnly(now, tz), a.offset ?? 0);
            const items = await db.careItem.findMany({ where: { status: 'DUE', dueDate: target }, select: { id: true }, take: 500 });
            for (const it of items) if (await this.start(a, it.id, `${a.offset ?? 0}:${target.toISOString().slice(0, 10)}`)) started++;
          } else if (a.trigger === 'SURGERY_UPCOMING') {
            const hours = a.offset ?? 24;
            const ops = await db.surgery.findMany({ where: { status: { in: ['SCHEDULED', 'PRE_OP'] }, scheduledAt: { gt: now, lte: new Date(now.getTime() + hours * 3_600_000) } }, select: { id: true, scheduledAt: true, createdAt: true }, take: 500 });
            for (const op of ops) {
              if (op.createdAt.getTime() > op.scheduledAt.getTime() - hours * 3_600_000) continue;
              if (await this.start(a, op.id, op.scheduledAt.toISOString())) started++;
            }
          } else if (a.trigger === 'INVOICE_OVERDUE') {
            const days = a.offset ?? 7;
            // Invoices whose due date was exactly `days` days ago (clinic calendar), still owing.
            const bounds = localDayBounds(new Date(now.getTime() - days * 86_400_000), tz);
            const invs = await db.invoice.findMany({ where: { status: { in: ['ISSUED', 'PARTIALLY_PAID'] }, balanceMinor: { gt: 0 }, clientId: { not: null }, dueAt: { gte: bounds.start, lt: bounds.end } }, select: { id: true }, take: 500 });
            for (const inv of invs) if (await this.start(a, inv.id, `${days}`)) started++;
          } else if (a.trigger === 'PATIENT_LAPSED') {
            const months = a.offset ?? 12;
            // Last visit on this calendar day `months` months ago, and nothing booked since.
            const [y, m, dd] = local.date.split('-').map(Number);
            const target = new Date(Date.UTC(y, m - 1 - months, dd)).toISOString().slice(0, 10);
            const from = zonedToUtc(target, 0, tz);
            const to = new Date(from.getTime() + 86_400_000);
            const rows = await this.prisma.raw.$queryRaw<{ patientId: string; last: Date }[]>`
              SELECT a."patientId", max(a."startsAt") AS last
              FROM "Appointment" a JOIN "Patient" p ON p."id" = a."patientId"
              WHERE a."organizationId" = ${organizationId}::uuid AND a."status" = 'COMPLETED' AND p."status" = 'ACTIVE'
              GROUP BY a."patientId"
              HAVING max(a."startsAt") >= ${from} AND max(a."startsAt") < ${to}
              LIMIT 500`;
            for (const r of rows) {
              const upcoming = await db.appointment.count({ where: { patientId: r.patientId, status: { in: ['BOOKED', 'CONFIRMED', 'CHECKED_IN'] }, startsAt: { gt: now } } });
              if (upcoming) continue;
              if (await this.start(a, r.patientId, new Date(r.last).toISOString().slice(0, 10))) started++;
            }
          } else if (a.trigger === 'PET_BIRTHDAY') {
            const today = localDateOnly(now, tz);
            const pets = await this.prisma.raw.$queryRaw<{ id: string }[]>`
              SELECT "id" FROM "Patient"
              WHERE "organizationId" = ${organizationId}::uuid AND "status" = 'ACTIVE' AND "dateOfBirth" IS NOT NULL AND "dobEstimated" = false
                AND "dateOfBirth" < ${today}::date
                AND EXTRACT(MONTH FROM "dateOfBirth") = ${local.month} AND EXTRACT(DAY FROM "dateOfBirth") = ${local.day}
              LIMIT 500`;
            for (const p of pets) if (await this.start(a, p.id, String(local.year))) started++;
          }
        }
      });
    }
    return started;
  }
}
