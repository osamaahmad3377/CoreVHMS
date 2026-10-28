import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Automation, AutomationRun, MessageChannel, Prisma } from '@prisma/client';
import {
  AUTOMATION_RECIPES,
  BASIC_AUTOMATION_KEYS,
  OFFER_CATCH_UP_DAYS,
  fitsWithoutBuilder,
  nextOfferDay,
  offerDayOnOrBefore,
  recipeKeyOf,
  sameAutomationShape,
  CHECK_INFO,
  TRIGGER_INFO,
  automationSchema,
  conditionsMet,
  waitMs,
  type AutomationCondition,
  type AutomationInput,
  type AutomationStep,
  type AutomationTrigger,
  type OfferRepeat,
  type AutomationTemplateInput,
} from '@vcms/shared';
import { formatInTimeZone } from 'date-fns-tz';
import { AuditService } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { ClientEvent, ClientEvents } from '../../common/events/client-events';
import { conflict, forbidden, notFound, ruleViolation } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { assertFeature, assertWithinLimit, currentEntitlements, featureAllowed } from '../../common/tenancy/entitlements';
import { appUrl } from '../../common/tenancy/hosts';
import { TenancyService } from '../../common/tenancy/tenancy.service';
import { addDays, localDateOnly, localDayBounds, localParts, zonedToUtc } from '../../common/time/tz';
import { renderTemplate } from '../comms/templates.service';
import { MessagesService } from '../comms/messages.service';
import { EmailIntegrationService } from '../integrations/email-integration.service';
import { WhatsAppService } from '../integrations/whatsapp.service';
import { buildContext, factNeeds, marketingFacts, OrgInfo, reach, RunContext, SOURCE_OF } from './automation-context';
import { unsubscribeLink } from './unsubscribe';
import { nextAt } from './automation-time';

const SCAN_EVERY_MS = 5 * 60_000;
const STUCK_MS = 10 * 60_000;
const TIMED: AutomationTrigger[] = ['APPOINTMENT_UPCOMING', 'CARE_DUE', 'PET_BIRTHDAY', 'SURGERY_UPCOMING', 'INVOICE_OVERDUE', 'PATIENT_LAPSED', 'SCHEDULED_OFFER'];
/** Offers started per automation per scan (the rest follow on the next scans, a few minutes apart). */
const OFFER_BATCH = 300;

const dayOf = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const asDate = (day: string | null | undefined) => (day ? new Date(`${day}T00:00:00Z`) : null);
const plusDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const offerOf = (a: Pick<Automation, 'sendOn' | 'repeat' | 'endsOn'>) => ({ sendOn: dayOf(a.sendOn), repeat: (a.repeat ?? 'NONE') as OfferRepeat, endsOn: dayOf(a.endsOn) });

/**
 * The last day of an offer that went out on `day`: its end date for a one-off offer, else the day before it goes
 * out again (never after the end date). Shown in messages as {{offerEnds}}.
 */
export function offerEndsOn(o: { sendOn: string | null; repeat: OfferRepeat; endsOn: string | null }, day: string): string | null {
  if (o.repeat === 'NONE') return o.endsOn;
  const next = nextOfferDay({ ...o, endsOn: null }, plusDays(day, 1));
  const end = next ? plusDays(next, -1) : null;
  return end && o.endsOn && o.endsOn < end ? o.endsOn : (end ?? o.endsOn);
}

/** An automation as the app shows it: offer dates as plain days. */
const view = <T extends Pick<Automation, 'sendOn' | 'endsOn'>>(a: T) => ({ ...a, sendOn: dayOf(a.sendOn), endsOn: dayOf(a.endsOn) });

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

  /** Adds the basic automations, switched on, once per clinic (never again, so deleting one sticks). */
  async seedBasics(organizationId?: string) {
    const raw = this.prisma.raw;
    const orgs = await raw.organization.findMany({ where: { automationsSeededAt: null, ...(organizationId ? { id: organizationId } : {}) }, select: { id: true } });
    for (const o of orgs) {
      const claimed = await raw.organization.updateMany({ where: { id: o.id, automationsSeededAt: null }, data: { automationsSeededAt: new Date() } });
      if (!claimed.count) continue;
      const have = await raw.automation.count({ where: { organizationId: o.id } });
      if (have) continue; // already built their own
      // Only as many as the plan allows are switched on (the rest are ready to switch on after an upgrade or a swap).
      const room = currentEntitlements()?.maxAutomations ?? Infinity;
      let n = 0;
      for (const key of BASIC_AUTOMATION_KEYS) {
        const r = AUTOMATION_RECIPES.find((x) => x.key === key);
        if (!r) continue;
        await raw.automation.create({
          data: {
            organizationId: o.id,
            name: r.automation.name,
            description: r.automation.description || null,
            isActive: n++ < room,
            marketing: r.automation.marketing ?? false,
            trigger: r.automation.trigger,
            offset: r.automation.offset ?? null,
            atHour: r.automation.atHour ?? null,
            sendFromHour: r.automation.sendFromHour ?? null,
            sendToHour: r.automation.sendToHour ?? null,
            cooldownDays: r.automation.cooldownDays ?? null,
            conditions: r.automation.conditions as unknown as Prisma.InputJsonValue,
            steps: r.automation.steps as unknown as Prisma.InputJsonValue,
            recipeKey: r.key,
            createdByName: 'NextCore',
            updatedByName: 'NextCore',
          },
        });
      }
    }
  }

  /** Older automations made from a recipe (before recipes were recorded) count as ready-made again. */
  private async markRecipes() {
    const unmarked = await this.prisma.db.automation.findMany({ where: { recipeKey: null } });
    for (const a of unmarked) {
      const key = recipeKeyOf(a as never);
      if (key) await this.prisma.db.automation.update({ where: { id: a.id }, data: { recipeKey: key } });
    }
  }

  async list() {
    await this.seedBasics(RequestContext.orgId());
    await this.markRecipes();
    const db = this.prisma.db;
    const [rows, waiting, recent] = await Promise.all([
      db.automation.findMany({ orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }] }),
      db.automationRun.groupBy({ by: ['automationId'], where: { status: 'WAITING' }, _count: true }),
      db.automationRun.groupBy({ by: ['automationId', 'status'], where: { createdAt: { gte: new Date(Date.now() - 30 * 86400_000) } }, _count: true }),
    ]);
    return rows.map((a) => ({
      ...view(a),
      waiting: waiting.find((w) => w.automationId === a.id)?._count ?? 0,
      last30Days: Object.fromEntries(recent.filter((r) => r.automationId === a.id).map((r) => [r.status, r._count])),
    }));
  }

  async get(id: string) {
    return view(await this.find(id));
  }

  private async find(id: string) {
    const a = await this.prisma.db.automation.findUnique({ where: { id } });
    if (!a) throw notFound('Automation');
    return a;
  }

  /** Lists for the builder: species, branches, appointment types, staff, and which channels can send. */
  async options() {
    const db = this.prisma.db;
    const orgId = RequestContext.orgId();
    const [species, branches, types, staff, wa, mailbox, services] = await Promise.all([
      db.species.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      db.branch.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      db.appointmentType.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      db.membership.findMany({ where: { status: 'ACTIVE' }, orderBy: { user: { name: 'asc' } }, select: { id: true, jobTitle: true, user: { select: { name: true } } } }),
      this.whatsapp.sending(orgId),
      this.mailbox.usable(orgId),
      db.service.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    ]);
    return {
      species,
      services,
      marketing: await this.marketingState(),
      branches,
      appointmentTypes: types,
      staff: staff.map((m) => ({ id: m.id, name: m.user.name, jobTitle: m.jobTitle })),
      channels: { whatsapp: wa.active, email: mailbox ? { own: true, address: mailbox.email } : { own: false, address: null } },
      recipes: AUTOMATION_RECIPES,
    };
  }

  private data(input: AutomationInput, recipeKey: string | null) {
    const timed = TRIGGER_INFO[input.trigger].timed;
    return {
      recipeKey,
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
      sendOn: timed === 'ON_DATE' ? asDate(input.sendOn) : null,
      repeat: timed === 'ON_DATE' ? (input.repeat ?? 'NONE') : null,
      endsOn: timed === 'ON_DATE' ? asDate(input.endsOn) : null,
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

  /**
   * A plan allows only so many ready-made automations switched on at once, and only so many of the clinic's own;
   * turning on one more of either needs room (or an upgrade).
   */
  private async assertRoomToSwitchOn(recipeKey: string | null) {
    const e = currentEntitlements();
    if (recipeKey) {
      if (e?.maxAutomations == null) return;
      assertWithinLimit('automations', await this.prisma.db.automation.count({ where: { isActive: true, recipeKey: { not: null } } }));
    } else {
      if (e?.maxCustomAutomations == null) return;
      assertWithinLimit('customAutomations', await this.prisma.db.automation.count({ where: { isActive: true, recipeKey: null } }));
    }
  }

  /**
   * Plan rules for what an automation may be: without the full builder, the easy shape or a ready-made recipe's (or,
   * when editing, the shape it already has — the wording can always change); marketing needs its own feature.
   */
  private assertPlanAllows(input: AutomationInput, current?: { trigger: string; steps: unknown; conditions: unknown; sendFromHour: number | null; sendToHour: number | null; cooldownDays: number | null; marketing: boolean }) {
    if (input.marketing && !current?.marketing) assertFeature('marketing');
    if (featureAllowed('automationBuilder') || fitsWithoutBuilder(input)) return;
    if (current && sameAutomationShape(input, current as never)) return;
    assertFeature('automationBuilder');
  }

  /** The clinic's marketing switches: the limit per client, everything paused, and approval before sending. */
  async marketingState() {
    const o = await this.prisma.raw.organization.findUnique({ where: { id: RequestContext.orgId() }, select: { marketingCapDays: true, marketingPaused: true, marketingApproval: true } });
    return { capDays: o?.marketingCapDays ?? null, paused: !!o?.marketingPaused, approval: !!o?.marketingApproval };
  }

  /** Records a saved state of the automation (to see what changed, and restore it). */
  private async recordVersion(tx: { automationVersion: { create: (args: { data: Prisma.AutomationVersionUncheckedCreateInput }) => Promise<unknown> } }, a: Automation, action: string) {
    const snapshot = {
      name: a.name,
      description: a.description,
      isActive: a.isActive,
      marketing: a.marketing,
      trigger: a.trigger,
      offset: a.offset,
      atHour: a.atHour,
      sendFromHour: a.sendFromHour,
      sendToHour: a.sendToHour,
      cooldownDays: a.cooldownDays,
      sendOn: dayOf(a.sendOn),
      repeat: a.repeat,
      endsOn: dayOf(a.endsOn),
      conditions: a.conditions,
      steps: a.steps,
      recipeKey: a.recipeKey,
    };
    await tx.automationVersion.create({ data: { organizationId: a.organizationId, automationId: a.id, version: a.version, action, snapshot: snapshot as Prisma.InputJsonValue, changedByName: RequestContext.get()?.userName ?? null } });
  }

  /**
   * When the clinic requires approval for marketing, a new or changed promotional automation is held (switched off)
   * until another manager approves it.
   */
  private async approvalFields(marketing: boolean, isActive: boolean) {
    if (!marketing || !(await this.marketingState()).approval) return { isActive, approvalStatus: null, approvalNote: null, approvedByName: null, approvedAt: null };
    return { isActive: false, approvalStatus: 'PENDING', approvalNote: null, approvedByName: null, approvedAt: null };
  }

  async create(input: AutomationInput) {
    await this.validateRefs(input);
    this.assertPlanAllows(input);
    const recipeKey = recipeKeyOf(input, input.recipeKey);
    const approval = await this.approvalFields(input.marketing, input.isActive);
    if (approval.isActive) await this.assertRoomToSwitchOn(recipeKey);
    const ctx = RequestContext.require();
    return this.prisma.db.$transaction(async (tx) => {
      const a = await tx.automation.create({ data: { ...this.data(input, recipeKey), ...approval, organizationId: ctx.organizationId!, createdByName: ctx.userName ?? null, updatedByName: ctx.userName ?? null, updatedById: ctx.userId ?? null } });
      await this.recordVersion(tx, a, approval.approvalStatus ? 'created — sent for approval' : 'created');
      await this.audit.record({ action: 'automation.created', entityType: 'Organization', entityId: ctx.organizationId!, summary: `${a.name} (${TRIGGER_INFO[input.trigger].label})${approval.approvalStatus ? ' · waiting for approval' : ''}` }, tx);
      return view(a);
    });
  }

  async update(id: string, input: AutomationInput, action = 'edited') {
    const current = await this.find(id);
    await this.validateRefs(input);
    this.assertPlanAllows(input, current);
    const recipeKey = recipeKeyOf(input, current.recipeKey ?? input.recipeKey);
    const approval = await this.approvalFields(input.marketing, input.isActive);
    // Switching on, or turning a switched-on ready-made automation into one of the clinic's own, needs room.
    if (approval.isActive && (!current.isActive || (!!current.recipeKey && !recipeKey))) await this.assertRoomToSwitchOn(recipeKey);
    const ctx = RequestContext.require();
    return this.prisma.db.$transaction(async (tx) => {
      const a = await tx.automation.update({ where: { id }, data: { ...this.data(input, recipeKey), ...approval, version: { increment: 1 }, updatedByName: ctx.userName ?? null, updatedById: ctx.userId ?? null } });
      await this.recordVersion(tx, a, approval.approvalStatus ? `${action} — sent for approval` : action);
      await this.audit.record({ action: 'automation.updated', entityType: 'Organization', entityId: ctx.organizationId!, summary: `${a.name}${approval.approvalStatus ? ' · waiting for approval' : a.isActive ? '' : ' (off)'}` }, tx);
      return view(a);
    });
  }

  async setActive(id: string, isActive: boolean) {
    const before = await this.find(id);
    if (isActive && !before.isActive) {
      if (before.marketing) {
        assertFeature('marketing');
        if ((await this.marketingState()).approval && before.approvalStatus !== 'APPROVED') {
          throw ruleViolation('NEEDS_APPROVAL', before.approvalStatus === 'REJECTED' ? 'This campaign was not approved. Change it and send it for approval again.' : 'This campaign is waiting for approval by a manager before it can go out.');
        }
      }
      await this.assertRoomToSwitchOn(before.recipeKey);
    }
    const ctx = RequestContext.require();
    return this.prisma.db.$transaction(async (tx) => {
      const a = await tx.automation.update({ where: { id }, data: { isActive, version: { increment: 1 }, updatedByName: ctx.userName ?? null } });
      await this.recordVersion(tx, a, isActive ? 'switched on' : 'switched off');
      await this.audit.record({ action: isActive ? 'automation.switched_on' : 'automation.switched_off', entityType: 'Organization', entityId: ctx.organizationId!, summary: before.name }, tx);
      return view(a);
    });
  }

  /** A manager (not the person who made the last change) approves a promotional automation: it switches on. */
  async approve(id: string) {
    const a = await this.find(id);
    if (a.approvalStatus !== 'PENDING') throw ruleViolation('NOT_PENDING', 'Only a campaign waiting for approval can be approved');
    const ctx = RequestContext.require();
    if (a.updatedById && a.updatedById === ctx.userId) throw ruleViolation('SAME_PERSON', 'Someone other than the person who made the last change must approve it');
    assertFeature('marketing');
    await this.assertRoomToSwitchOn(a.recipeKey);
    return this.prisma.db.$transaction(async (tx) => {
      const after = await tx.automation.update({ where: { id }, data: { approvalStatus: 'APPROVED', approvalNote: null, approvedByName: ctx.userName ?? null, approvedAt: new Date(), isActive: true, version: { increment: 1 } } });
      await this.recordVersion(tx, after, 'approved and switched on');
      await this.audit.record({ action: 'automation.approved', entityType: 'Organization', entityId: ctx.organizationId!, summary: a.name }, tx);
      return view(after);
    });
  }

  async reject(id: string, note: string) {
    const a = await this.find(id);
    if (a.approvalStatus !== 'PENDING') throw ruleViolation('NOT_PENDING', 'Only a campaign waiting for approval can be sent back');
    const ctx = RequestContext.require();
    return this.prisma.db.$transaction(async (tx) => {
      const after = await tx.automation.update({ where: { id }, data: { approvalStatus: 'REJECTED', approvalNote: note, approvedByName: ctx.userName ?? null, approvedAt: new Date(), isActive: false, version: { increment: 1 } } });
      await this.recordVersion(tx, after, `sent back: ${note}`);
      await this.audit.record({ action: 'automation.rejected', entityType: 'Organization', entityId: ctx.organizationId!, summary: `${a.name}: ${note}` }, tx);
      return view(after);
    });
  }

  /** Every saved state, newest first. */
  async versions(id: string) {
    await this.find(id);
    return this.prisma.db.automationVersion.findMany({ where: { automationId: id }, orderBy: { version: 'desc' }, take: 100 });
  }

  /** Puts an earlier version back (saved as a new version, so nothing is lost). */
  async restore(id: string, version: number) {
    const v = await this.prisma.db.automationVersion.findUnique({ where: { automationId_version: { automationId: id, version } } });
    if (!v) throw notFound('Version');
    const parsed = automationSchema.safeParse(v.snapshot);
    if (!parsed.success) throw ruleViolation('VERSION_INVALID', 'This version can no longer be used as it is');
    return this.update(id, parsed.data, `restored version ${version}`);
  }

  async remove(id: string) {
    const a = await this.find(id);
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
    const a = await this.find(id);
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
          sendOn: a.sendOn,
          repeat: a.repeat,
          endsOn: a.endsOn,
          conditions: a.conditions as Prisma.InputJsonValue,
          steps: a.steps as Prisma.InputJsonValue,
          createdByName: ctx.userName ?? null,
          updatedByName: ctx.userName ?? null,
        },
      });
      await this.recordVersion(tx, copy, `created as a copy of “${a.name}”`);
      await this.audit.record({ action: 'automation.created', entityType: 'Organization', entityId: ctx.organizationId!, summary: `${copy.name} (copy of ${a.name})` }, tx);
      return copy;
    });
  }

  // ── The clinic's own templates ──

  /** Templates the clinic saved from its own automations and campaigns, most used first. */
  async templates() {
    return this.prisma.db.automationTemplate.findMany({ orderBy: [{ timesUsed: 'desc' }, { createdAt: 'desc' }] });
  }

  async template(id: string) {
    const t = await this.prisma.db.automationTemplate.findUnique({ where: { id } });
    if (!t) throw notFound('Template');
    return t;
  }

  /** Saves an automation or campaign as a template to start new ones from (nothing is switched on or sent). */
  async saveTemplate(input: AutomationTemplateInput) {
    await this.validateRefs(input.automation);
    if (input.automation.marketing) assertFeature('marketing');
    if (await this.prisma.db.automationTemplate.findFirst({ where: { name: { equals: input.name, mode: 'insensitive' } } })) throw conflict(`There is already a template called “${input.name}”`);
    const { isActive: _isActive, ...draft } = input.automation;
    const ctx = RequestContext.require();
    return this.prisma.db.$transaction(async (tx) => {
      const t = await tx.automationTemplate.create({
        data: { organizationId: ctx.organizationId!, name: input.name, description: input.description ?? null, marketing: input.automation.marketing, trigger: input.automation.trigger, draft: draft as Prisma.InputJsonValue, createdByName: ctx.userName ?? null },
      });
      await this.audit.record({ action: 'automation.template_saved', entityType: 'Organization', entityId: ctx.organizationId!, summary: `${t.name} (${TRIGGER_INFO[input.automation.trigger].label})` }, tx);
      return t;
    });
  }

  /** Counts a new automation made from the template (shown as "Used N times"). */
  async templateUsed(id: string) {
    await this.template(id);
    return this.prisma.db.automationTemplate.update({ where: { id }, data: { timesUsed: { increment: 1 } }, select: { id: true, timesUsed: true } });
  }

  async removeTemplate(id: string) {
    const t = await this.template(id);
    const ctx = RequestContext.require();
    await this.prisma.db.$transaction(async (tx) => {
      await tx.automationTemplate.delete({ where: { id } });
      await this.audit.record({ action: 'automation.template_deleted', entityType: 'Organization', entityId: ctx.organizationId!, summary: t.name }, tx);
    });
    return { ok: true };
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
    if (input.trigger === 'SCHEDULED_OFFER') {
      const o = { sendOn: input.sendOn ?? null, repeat: (input.repeat ?? 'NONE') as OfferRepeat, endsOn: input.endsOn ?? null };
      const day = nextOfferDay(o, localParts(new Date(), org.timezone).date) ?? o.sendOn;
      ctx.vars.offerEnds = this.offerEndsText(o, day, org.timezone);
    }
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
    // Booked online: the booking page’s own confirmation (with the change link) goes out instead.
    if (e.type === 'APPOINTMENT_BOOKED' && e.online) return;
    const list = await this.prisma.db.automation.findMany({ where: { trigger, isActive: true } });
    for (const a of list) await this.start(a, sourceIdOf(e));
  }

  /** Starts one automation for one record (once — the dedupe key guards repeats). */
  async start(a: Automation, sourceId: string, extraKey?: string) {
    // Promotional automations rest while the clinic's plan does not include marketing, or while marketing is paused.
    if (a.marketing && (!featureAllowed('marketing') || (await this.marketingState()).paused)) return null;
    const org = await this.orgInfo();
    const trigger = a.trigger as AutomationTrigger;
    const ctx = await buildContext(this.prisma.db, trigger, sourceId, org);
    if (!ctx || !ctx.live) return null;
    if (!conditionsMet(a.conditions as unknown as AutomationCondition[], ctx.facts)) return null;
    // An offer: its end date for this send ({{offerEnds}}), kept with the run.
    if (trigger === 'SCHEDULED_OFFER') ctx.vars.offerEnds = this.offerEndsText(offerOf(a), extraKey ?? null, org.timezone);
    // Marketing: at most one promotional message per client in the clinic's chosen number of days (all offers together).
    if (a.marketing && ctx.client && (await this.cappedRecently(ctx.client.id))) return null;
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

  private offerEndsText(o: { sendOn: string | null; repeat: OfferRepeat; endsOn: string | null }, day: string | null, tz: string) {
    const end = day ? offerEndsOn(o, day) : o.endsOn;
    return end ? formatInTimeZone(new Date(`${end}T12:00:00Z`), tz, 'd MMM yyyy') : '';
  }

  /**
   * Who an offer goes to: active clients who agreed to marketing (and to messages at all) and meet its conditions —
   * their animals' species, branch, last visit and how they can be reached. Counted for the editor, listed for sending.
   */
  async audience(conditions: AutomationCondition[]) {
    const db = this.prisma.db;
    const org = await this.orgInfo();
    const clients = await db.client.findMany({ where: { status: 'ACTIVE' }, select: { id: true, createdAt: true, email: true, mobilePhone: true, primaryBranchId: true, remindersConsent: true, marketingConsent: true } });
    const consented = clients.filter((c) => c.remindersConsent && c.marketingConsent);
    const known = await marketingFacts(db, consented, factNeeds(conditions));
    const ids: string[] = [];
    const reachBy = { whatsapp: 0, email: 0, none: 0 };
    for (const c of consented) {
      const r = reach(c, org);
      const facts = { ...known.get(c.id), branchId: c.primaryBranchId, ...r };
      if (!conditionsMet(conditions, facts)) continue;
      ids.push(c.id);
      if (r.hasWhatsApp) reachBy.whatsapp++;
      else if (r.hasEmail) reachBy.email++;
      else reachBy.none++;
    }
    return { ids, counts: { clients: clients.length, consented: consented.length, matching: ids.length, reach: reachBy } };
  }

  /** How many clients an offer with these conditions would reach (nothing is sent). */
  async audienceCounts(conditions: AutomationCondition[]) {
    return (await this.audience(conditions)).counts;
  }

  /** True when the client already had a promotional message within the clinic's marketing limit. */
  private async cappedRecently(clientId: string) {
    const org = await this.prisma.raw.organization.findUnique({ where: { id: RequestContext.orgId() }, select: { marketingCapDays: true } });
    if (!org?.marketingCapDays) return false;
    const since = new Date(Date.now() - org.marketingCapDays * 86_400_000);
    return (await this.prisma.db.automationRun.count({ where: { clientId, createdAt: { gte: since }, automation: { marketing: true } } })) > 0;
  }

  /** The signed-in person's email (where test messages go). */
  async myEmail() {
    const userId = RequestContext.require().userId;
    const u = userId ? await this.prisma.raw.user.findUnique({ where: { id: userId }, select: { email: true } }) : null;
    if (!u?.email) throw ruleViolation('NO_EMAIL', 'Your account has no email address to send the test to');
    return u.email;
  }

  /**
   * Marketing settings: at most one promotional message per client every N days, pause everything promotional, and
   * require another manager's approval before a campaign goes out.
   */
  async setMarketingSettings(input: { capDays?: number | null; paused?: boolean; approval?: boolean }) {
    const ctx = RequestContext.require();
    // Marketing is a plan feature (Professional and Premium, or switched on for the clinic by the platform admin).
    assertFeature('marketing');
    // Pausing marketing and the approval rule are for those who manage the clinic (nobody switches off their own check).
    if ((input.approval !== undefined || input.paused !== undefined) && !ctx.permissions.has('org.manage')) throw forbidden('Only the clinic’s managers can pause marketing or change the approval rule');
    const before = await this.marketingState();
    const data = { ...(input.capDays !== undefined ? { marketingCapDays: input.capDays } : {}), ...(input.paused !== undefined ? { marketingPaused: input.paused } : {}), ...(input.approval !== undefined ? { marketingApproval: input.approval } : {}) };
    await this.prisma.raw.$transaction(async (tx) => {
      await tx.organization.update({ where: { id: ctx.organizationId! }, data });
      // Approval switched on: campaigns already running count as approved (they keep running).
      if (input.approval && !before.approval) {
        await tx.automation.updateMany({ where: { organizationId: ctx.organizationId!, marketing: true, isActive: true }, data: { approvalStatus: 'APPROVED', approvedByName: 'Running before approval was required', approvedAt: new Date() } });
      }
      const said = [
        input.capDays !== undefined ? (input.capDays ? `at most one offer per client every ${input.capDays} days` : 'no limit on offers per client') : null,
        input.paused !== undefined ? (input.paused ? 'all marketing paused' : 'marketing resumed') : null,
        input.approval !== undefined ? (input.approval ? 'campaigns need approval' : 'no approval needed') : null,
      ].filter(Boolean);
      await this.audit.record({ action: 'automation.marketing_settings_changed', entityType: 'Organization', entityId: ctx.organizationId!, summary: said.join(' · ') }, tx);
    });
    return this.marketingState();
  }

  /** Problems in the last days, grouped by automation and reason (with the latest time). */
  async problems(days = 7) {
    const since = new Date(Date.now() - days * 86_400_000);
    const rows = await this.prisma.db.automationRun.groupBy({ by: ['automationId', 'status', 'error'], where: { status: { in: ['FAILED', 'SKIPPED'] }, updatedAt: { gte: since } }, _count: true, _max: { updatedAt: true } });
    const autos = await this.prisma.db.automation.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.automationId))] } }, select: { id: true, name: true, trigger: true } });
    return rows
      .map((r) => ({ automationId: r.automationId, name: autos.find((x) => x.id === r.automationId)?.name ?? '—', trigger: autos.find((x) => x.id === r.automationId)?.trigger ?? null, status: r.status, reason: r.error ?? 'No reason recorded', count: r._count, lastAt: r._max.updatedAt }))
      .sort((a, b) => b.count - a.count);
  }

  /** Tries a failed run again from the step where it stopped. */
  async retryRun(id: string) {
    const r = await this.prisma.db.automationRun.findUnique({ where: { id } });
    if (!r) throw notFound('Run');
    if (r.status !== 'FAILED') throw ruleViolation('NOT_FAILED', 'Only a failed run can be tried again');
    await this.prisma.db.automationRun.update({ where: { id }, data: { status: 'WAITING', runAt: new Date(), error: null } });
    return { ok: true };
  }

  /**
   * Marketing at a glance for a period: campaigns, who can be reached, messages sent / delivered / read, bookings
   * within 14 days and payments within 30 days of a campaign reaching a client, opt-outs, a weekly trend and each
   * campaign side by side.
   */
  async marketingOverview(days: number) {
    const orgId = RequestContext.orgId();
    const since = new Date(Date.now() - days * 86_400_000);
    const raw = this.prisma.raw;
    const db = this.prisma.db;
    const [autos, clients, consented, perAuto, booked, revenue, weekly, optOuts] = await Promise.all([
      db.automation.findMany({ where: { marketing: true }, select: { id: true, name: true, isActive: true, approvalStatus: true, trigger: true } }),
      db.client.count({ where: { status: 'ACTIVE' } }),
      db.client.count({ where: { status: 'ACTIVE', marketingConsent: true, remindersConsent: true } }),
      raw.$queryRaw<{ automationId: string; status: string; n: bigint; delivered: bigint; read: bigint }[]>`
        SELECT r."automationId", m."status", count(*) AS n, count(m."deliveredAt") AS delivered, count(m."readAt") AS read
        FROM "OutboundMessage" m
        JOIN "AutomationRun" r ON r."id"::text = split_part(m."dedupeKey", ':', 2)
        JOIN "Automation" a ON a."id" = r."automationId"
        WHERE m."organizationId" = ${orgId}::uuid AND m."dedupeKey" LIKE 'automation:%' AND a."marketing" = true AND m."createdAt" >= ${since}
        GROUP BY r."automationId", m."status"`,
      raw.$queryRaw<{ automationId: string; n: bigint }[]>`
        SELECT r."automationId", count(DISTINCT r."clientId") AS n FROM "AutomationRun" r JOIN "Automation" a ON a."id" = r."automationId"
        WHERE r."organizationId" = ${orgId}::uuid AND a."marketing" = true AND r."status" = 'DONE' AND r."clientId" IS NOT NULL AND r."createdAt" >= ${since} AND EXISTS (
          SELECT 1 FROM "Appointment" ap WHERE ap."clientId" = r."clientId" AND ap."organizationId" = ${orgId}::uuid
            AND ap."createdAt" >= r."createdAt" AND ap."createdAt" < r."createdAt" + interval '14 days' AND ap."status" <> 'CANCELLED')
        GROUP BY r."automationId"`,
      raw.$queryRaw<{ automationId: string; total: bigint | null }[]>`
        SELECT x."automationId", sum(p."amountMinor" - p."refundedMinor") AS total FROM "Payment" p JOIN (
          SELECT r."automationId", r."clientId", min(r."createdAt") AS at FROM "AutomationRun" r JOIN "Automation" a ON a."id" = r."automationId"
          WHERE r."organizationId" = ${orgId}::uuid AND a."marketing" = true AND r."status" = 'DONE' AND r."clientId" IS NOT NULL AND r."createdAt" >= ${since}
          GROUP BY r."automationId", r."clientId"
        ) x ON x."clientId" = p."clientId"
        WHERE p."organizationId" = ${orgId}::uuid AND p."receivedAt" >= x.at AND p."receivedAt" < x.at + interval '30 days'
        GROUP BY x."automationId"`,
      raw.$queryRaw<{ week: Date; n: bigint }[]>`
        SELECT date_trunc('week', m."createdAt") AS week, count(*) AS n
        FROM "OutboundMessage" m
        JOIN "AutomationRun" r ON r."id"::text = split_part(m."dedupeKey", ':', 2)
        JOIN "Automation" a ON a."id" = r."automationId"
        WHERE m."organizationId" = ${orgId}::uuid AND m."dedupeKey" LIKE 'automation:%' AND a."marketing" = true AND m."createdAt" >= ${since}
          AND m."status" = 'SENT'
        GROUP BY 1 ORDER BY 1`,
      raw.auditEvent.count({ where: { organizationId: orgId, action: 'client.marketing_stopped', createdAt: { gte: since } } }),
    ]);
    const sentStatuses = ['SENT'];
    const sum = <T>(rows: T[], f: (r: T) => number) => rows.reduce((n, r) => n + f(r), 0);
    const byCampaign = autos.map((a) => {
      const m = perAuto.filter((x) => x.automationId === a.id);
      return {
        id: a.id,
        name: a.name,
        isActive: a.isActive,
        approvalStatus: a.approvalStatus,
        trigger: a.trigger,
        sent: sum(m.filter((x) => sentStatuses.includes(x.status)), (x) => Number(x.n)),
        read: sum(m, (x) => Number(x.read)),
        failed: sum(m.filter((x) => x.status === 'FAILED'), (x) => Number(x.n)),
        booked: Number(booked.find((b) => b.automationId === a.id)?.n ?? 0),
        revenueMinor: Number(revenue.find((r) => r.automationId === a.id)?.total ?? 0),
      };
    });
    const total = (k: 'sent' | 'read' | 'failed' | 'booked' | 'revenueMinor') => sum(byCampaign, (c) => c[k]);
    return {
      days,
      campaigns: { total: autos.length, active: autos.filter((a) => a.isActive).length, pendingApproval: autos.filter((a) => a.approvalStatus === 'PENDING').length },
      audience: { clients, consented },
      messages: { sent: total('sent'), delivered: sum(perAuto, (x) => Number(x.delivered)), read: total('read'), failed: total('failed') },
      booked: total('booked'),
      revenueMinor: total('revenueMinor'),
      optOuts,
      weekly: weekly.map((w) => ({ week: w.week.toISOString().slice(0, 10), sent: Number(w.n) })),
      byCampaign: byCampaign.sort((a, b) => b.sent - a.sent || a.name.localeCompare(b.name)),
      settings: await this.marketingState(),
    };
  }

  /** Clients who stopped offers themselves (link or STOP), newest first. */
  async optOuts() {
    const rows = await this.prisma.raw.auditEvent.findMany({ where: { organizationId: RequestContext.orgId(), action: 'client.marketing_stopped' }, orderBy: { createdAt: 'desc' }, take: 500, select: { entityId: true, summary: true, createdAt: true } });
    const clients = await this.prisma.db.client.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.entityId).filter((x): x is string => !!x))] } }, select: { id: true, displayName: true, email: true, mobilePhone: true, marketingConsent: true } });
    return rows.map((r) => {
      const c = clients.find((x) => x.id === r.entityId);
      return { clientId: r.entityId, name: c?.displayName ?? 'Removed client', email: c?.email ?? null, phone: c?.mobilePhone ?? null, how: r.summary?.replace(/^Stopped offers \((.*)\)$/, '$1') ?? '', at: r.createdAt, offersOnAgain: !!c?.marketingConsent };
    });
  }

  /**
   * Sends the automation's first message to the person trying it (their own email), filled in from a real client
   * in its audience when there is one — so they see exactly what clients get.
   */
  async testSend(input: AutomationInput, to: string) {
    const step = input.steps.find((x): x is Extract<AutomationStep, { type: 'SEND_MESSAGE' }> => x.type === 'SEND_MESSAGE');
    if (!step) throw ruleViolation('NO_MESSAGE', 'Add a message to send a test');
    const org = await this.orgInfo();
    const sampleId = input.trigger === 'SCHEDULED_OFFER' ? (await this.audience(input.conditions)).ids[0] : await this.recentExample(input.trigger);
    const ctx = sampleId ? await buildContext(this.prisma.db, input.trigger, sampleId, org) : null;
    const vars = ctx?.vars ?? Object.fromEntries(TRIGGER_INFO[input.trigger].variables.map((v) => [v, `[${v}]`]));
    if (input.trigger === 'SCHEDULED_OFFER') {
      const o = { sendOn: input.sendOn ?? null, repeat: (input.repeat ?? 'NONE') as OfferRepeat, endsOn: input.endsOn ?? null };
      vars.offerEnds = this.offerEndsText(o, nextOfferDay(o, localParts(new Date(), org.timezone).date) ?? o.sendOn, org.timezone);
    }
    const body = renderTemplate(step.body, vars) + (input.marketing && ctx?.client ? this.optOutFooter('EMAIL', ctx.client.id) : '');
    await this.messages.enqueue(this.prisma.db, {
      channel: 'EMAIL',
      recipient: to,
      subject: `[Test] ${renderTemplate(step.subject || 'Message from {{clinicName}}', vars)}`,
      body,
      purpose: 'AUTOMATION_TEST',
      dedupeKey: `automation-test:${Date.now()}:${Math.random().toString(36).slice(2)}`,
    });
    return { ok: true, to, example: ctx?.client?.displayName ?? null };
  }

  /**
   * How an automation did: runs, messages delivered and read, and — for offers — how many of the clients it reached
   * booked within 14 days and what they paid within 30 days.
   */
  async results(id: string) {
    const a = await this.find(id);
    const orgId = RequestContext.orgId();
    const raw = this.prisma.raw;
    const [runs, messages, booked, revenue] = await Promise.all([
      this.prisma.db.automationRun.groupBy({ by: ['status'], where: { automationId: id }, _count: true }),
      raw.$queryRaw<{ status: string; n: bigint; delivered: bigint; read: bigint }[]>`
        SELECT m."status", count(*) AS n, count(m."deliveredAt") AS delivered, count(m."readAt") AS read
        FROM "OutboundMessage" m JOIN "AutomationRun" r ON r."id"::text = split_part(m."dedupeKey", ':', 2)
        WHERE m."organizationId" = ${orgId}::uuid AND m."dedupeKey" LIKE 'automation:%' AND r."automationId" = ${id}::uuid
        GROUP BY m."status"`,
      raw.$queryRaw<{ n: bigint }[]>`
        SELECT count(DISTINCT r."clientId") AS n FROM "AutomationRun" r
        WHERE r."automationId" = ${id}::uuid AND r."status" = 'DONE' AND r."clientId" IS NOT NULL AND EXISTS (
          SELECT 1 FROM "Appointment" ap WHERE ap."clientId" = r."clientId" AND ap."organizationId" = ${orgId}::uuid
            AND ap."createdAt" >= r."createdAt" AND ap."createdAt" < r."createdAt" + interval '14 days' AND ap."status" <> 'CANCELLED')`,
      raw.$queryRaw<{ total: bigint | null }[]>`
        SELECT sum(p."amountMinor" - p."refundedMinor") AS total FROM "Payment" p JOIN (
          SELECT r."clientId", min(r."createdAt") AS at FROM "AutomationRun" r
          WHERE r."automationId" = ${id}::uuid AND r."status" = 'DONE' AND r."clientId" IS NOT NULL GROUP BY r."clientId"
        ) x ON x."clientId" = p."clientId"
        WHERE p."organizationId" = ${orgId}::uuid AND p."receivedAt" >= x.at AND p."receivedAt" < x.at + interval '30 days'`,
    ]);
    const count = (st: string) => runs.find((r) => r.status === st)?._count ?? 0;
    const msg = (st: string[]) => messages.filter((m) => st.includes(m.status)).reduce((n, m) => n + Number(m.n), 0);
    return {
      automation: { id: a.id, name: a.name, marketing: a.marketing },
      runs: { total: runs.reduce((n, r) => n + r._count, 0), done: count('DONE'), waiting: count('WAITING') + count('RUNNING'), notSent: count('SKIPPED') + count('FAILED'), stopped: count('STOPPED') },
      messages: {
        sent: msg(['SENT']),
        delivered: messages.reduce((n, m) => n + Number(m.delivered), 0),
        read: messages.reduce((n, m) => n + Number(m.read), 0),
        failed: msg(['FAILED']),
        waiting: msg(['QUEUED', 'SENDING']),
      },
      booked: Number(booked[0]?.n ?? 0),
      revenueMinor: Number(revenue[0]?.total ?? 0),
    };
  }

  /** The line added to every promotional message: how to stop offers. */
  private optOutFooter(channel: MessageChannel, clientId: string) {
    return channel === 'EMAIL'
      ? `\n\n—\nDon’t want offers from us? Stop them here: ${unsubscribeLink(RequestContext.orgId(), clientId)}`
      : channel === 'WHATSAPP'
        ? '\n\nReply STOP to stop offers.'
        : '';
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
    // Marketing paused by the clinic: the run waits (checked again in half an hour) — nothing is sent meanwhile.
    if (a.marketing && (await this.marketingState()).paused) return finish('WAITING', null, { runAt: new Date(Date.now() + 30 * 60_000) });
    // Fresh facts each time it wakes up: the appointment may have moved or been cancelled meanwhile.
    const ctx = fresh ?? (await buildContext(db, a.trigger as AutomationTrigger, run.sourceId, await this.orgInfo()));
    if (!ctx) return finish('STOPPED', 'The record was removed');
    if (!ctx.live) return finish('STOPPED', ctx.why ?? 'No longer applies');
    // Values fixed when the run started (an offer's end date) stay the same after a wait.
    const kept = (run.vars ?? {}) as Record<string, string>;
    if (kept.offerEnds !== undefined) ctx.vars.offerEnds = kept.offerEnds;
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
    // Promotional messages always say how to stop offers (an unsubscribe link by email, "reply STOP" on WhatsApp).
    const body = renderTemplate(s.body, ctx.vars) + (a.marketing ? this.optOutFooter(channel, ctx.client.id) : '');
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
        if (scan) await this.seedBasics();
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

  /**
   * An offer whose day has come (at its hour, clinic time; a day or two late if the server was down): one run per
   * client in its audience, a batch per scan. Each client gets each send once.
   */
  private async sendOffer(a: Automation, today: string, minuteOfDay: number) {
    const day = offerDayOnOrBefore(offerOf(a), today);
    if (!day || daysBetween(day, today) > OFFER_CATCH_UP_DAYS) return 0;
    if (day === today && a.atHour != null && minuteOfDay < a.atHour * 60) return 0;
    if (a.marketing && (!featureAllowed('marketing') || (await this.marketingState()).paused)) return 0;
    const { ids } = await this.audience(a.conditions as unknown as AutomationCondition[]);
    const done = new Set((await this.prisma.db.automationRun.findMany({ where: { automationId: a.id, dedupeKey: { endsWith: `:${day}` } }, select: { clientId: true } })).map((r) => r.clientId));
    // Clients who had another offer within the clinic's marketing limit wait for the next send.
    const cap = (await this.prisma.raw.organization.findUnique({ where: { id: RequestContext.orgId() }, select: { marketingCapDays: true } }))?.marketingCapDays;
    if (cap) {
      const recent = await this.prisma.db.automationRun.findMany({ where: { createdAt: { gte: new Date(Date.now() - cap * 86_400_000) }, automation: { marketing: true }, clientId: { not: null } }, select: { clientId: true }, distinct: ['clientId'] });
      for (const r of recent) done.add(r.clientId);
    }
    let started = 0;
    for (const id of ids) {
      if (done.has(id)) continue;
      if (started >= OFFER_BATCH) break;
      if (await this.start(a, id, day)) started++;
    }
    return started;
  }

  /** Date-based triggers: appointments coming up, care falling due, pets' birthdays, offers. */
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
          if (a.trigger === 'SCHEDULED_OFFER') {
            started += await this.sendOffer(a, local.date, local.minuteOfDay);
            continue;
          }
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
