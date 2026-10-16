import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { z } from 'zod';
import type { referralContactSchema, referralSchema, updateReferralSchema } from '@vcms/shared';
import { AuditService, diff } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { CounterService, formatNumber } from '../../common/counter/counter.service';
import { notFound, ruleViolation } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MessagesService } from '../comms/messages.service';
import { ClinicalSummaryService } from './clinical-summary.service';

export const referralNo = (n: number) => formatNumber('REF', n, 5);

const include = {
  patient: { select: { id: true, name: true, number: true, sex: true, dateOfBirth: true, latestWeightKg: true, species: { select: { name: true } }, breed: { select: { name: true } }, breedText: true, identifiers: { where: { type: 'MICROCHIP' }, select: { value: true } } } },
  client: { select: { id: true, displayName: true, mobilePhone: true, email: true } },
  contact: true,
} satisfies Prisma.ReferralInclude;
type Ref = Prisma.ReferralGetPayload<{ include: typeof include }>;
const shape = (r: Ref) => ({ ...r, referralNo: referralNo(r.number), patient: { ...r.patient, latestWeightKg: r.patient.latestWeightKg === null ? null : Number(r.patient.latestWeightKg) } });

const TRANSITIONS: Record<string, { from: string[]; to: string }> = {
  send: { from: ['DRAFT'], to: 'SENT' },
  accept: { from: ['SENT', 'RECEIVED'], to: 'ACCEPTED' },
  complete: { from: ['SENT', 'RECEIVED', 'ACCEPTED'], to: 'COMPLETED' },
  decline: { from: ['SENT', 'RECEIVED', 'ACCEPTED'], to: 'DECLINED' },
  cancel: { from: ['DRAFT', 'SENT', 'RECEIVED', 'ACCEPTED'], to: 'CANCELLED' },
};

/** Referral contacts and referrals in both directions, with a printable/emailable referral letter. */
@Injectable()
export class ReferralsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly counters: CounterService,
    private readonly messages: MessagesService,
    private readonly summaries: ClinicalSummaryService,
  ) {}

  // ── Contacts ──

  contacts(all = false) {
    return this.prisma.db.referralContact.findMany({ where: { isActive: all ? undefined : true }, orderBy: { name: 'asc' } });
  }

  async createContact(input: z.infer<typeof referralContactSchema>) {
    return this.prisma.db.$transaction(async (tx) => {
      const c = await tx.referralContact.create({ data: { ...input, organizationId: RequestContext.orgId() } });
      await this.audit.record({ action: 'referral_contact.created', entityType: 'ReferralContact', entityId: c.id, summary: [c.name, c.practice].filter(Boolean).join(', ') }, tx);
      return c;
    });
  }

  async updateContact(id: string, input: Partial<z.infer<typeof referralContactSchema>>) {
    const before = await this.prisma.db.referralContact.findUnique({ where: { id } });
    if (!before) throw notFound('Contact');
    return this.prisma.db.$transaction(async (tx) => {
      const after = await tx.referralContact.update({ where: { id }, data: input });
      await this.audit.record({ action: 'referral_contact.updated', entityType: 'ReferralContact', entityId: id, changes: diff(before, after, Object.keys(input)) }, tx);
      return after;
    });
  }

  // ── Referrals ──

  async list(q: { status?: string; direction?: string; patientId?: string; contactId?: string }) {
    const rows = await this.prisma.db.referral.findMany({
      where: {
        status: q.status === 'OPEN' ? { in: ['DRAFT', 'SENT', 'RECEIVED', 'ACCEPTED'] } : q.status ? { in: q.status.split(',') as any } : undefined,
        direction: (q.direction as any) || undefined,
        patientId: q.patientId,
        contactId: q.contactId,
      },
      include,
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    return rows.map(shape);
  }

  async get(id: string) {
    const r = await this.prisma.db.referral.findUnique({ where: { id }, include });
    if (!r) throw notFound('Referral');
    return shape(r);
  }

  /** Data for the printable referral letter. */
  async letter(id: string) {
    const r = await this.get(id);
    const [org, summary] = await Promise.all([
      this.prisma.raw.organization.findUniqueOrThrow({ where: { id: RequestContext.orgId() }, select: { name: true, legalName: true, phone: true, email: true } }),
      this.summaries.forPeriod(r.patientId),
    ]);
    return { referral: r, organization: org, summary };
  }

  /** A pre-filled clinical summary for a new referral (clinicians edit it before sending). */
  draftSummary(patientId: string) {
    return this.summaries.text(patientId);
  }

  private async contact(id?: string | null) {
    if (!id) return null;
    const c = await this.prisma.db.referralContact.findUnique({ where: { id } });
    if (!c || !c.isActive) throw ruleViolation('INVALID_CONTACT', 'Referral contact not found');
    return c;
  }

  async create(input: z.infer<typeof referralSchema>) {
    const patient = await this.prisma.db.patient.findUnique({ where: { id: input.patientId }, include: { ownerships: { where: { endedAt: null, isPrimary: true } } } });
    if (!patient || patient.status === 'MERGED') throw ruleViolation('INVALID_PATIENT', 'Animal not found');
    const owner = patient.ownerships[0];
    if (!owner) throw ruleViolation('NO_OWNER', 'This animal has no current owner');
    await this.contact(input.contactId);
    const ctx = RequestContext.require();
    return this.prisma.db.$transaction(async (tx) => {
      const number = await this.counters.next(tx, 'referral');
      const r = await tx.referral.create({
        data: { ...input, organizationId: ctx.organizationId!, number, clientId: owner.clientId, status: input.direction === 'INCOMING' ? 'RECEIVED' : 'DRAFT', createdByName: ctx.userName },
        include,
      });
      await this.audit.record({ action: input.direction === 'INCOMING' ? 'referral.received' : 'referral.created', entityType: 'Patient', entityId: patient.id, summary: `${referralNo(number)} ${input.reason}` }, tx);
      return shape(r);
    });
  }

  async update(id: string, input: z.infer<typeof updateReferralSchema>) {
    const before = await this.prisma.db.referral.findUnique({ where: { id } });
    if (!before) throw notFound('Referral');
    if (['COMPLETED', 'DECLINED', 'CANCELLED'].includes(before.status)) throw ruleViolation('REFERRAL_CLOSED', 'This referral is closed');
    if (before.status !== 'DRAFT' && before.direction === 'OUTGOING' && (input.reason !== undefined || input.clinicalSummary !== undefined || input.contactId !== undefined)) {
      throw ruleViolation('ALREADY_SENT', 'The letter has been sent; record further information in the outcome or create a new referral');
    }
    await this.contact(input.contactId);
    return this.prisma.db.$transaction(async (tx) => {
      const after = await tx.referral.update({ where: { id }, data: input, include });
      await this.audit.record({ action: 'referral.updated', entityType: 'Patient', entityId: before.patientId, summary: referralNo(before.number), changes: diff(before, after, Object.keys(input)) }, tx);
      return shape(after);
    });
  }

  async transition(id: string, input: { action: keyof typeof TRANSITIONS; email?: boolean; outcome?: string | null; reason?: string | null; appointmentAt?: Date | null }) {
    const r = await this.prisma.db.referral.findUnique({ where: { id }, include });
    if (!r) throw notFound('Referral');
    const t = TRANSITIONS[input.action];
    if (!t.from.includes(r.status)) throw ruleViolation('INVALID_TRANSITION', `Cannot ${input.action} a referral that is ${r.status.toLowerCase()}`);
    if (input.action === 'send' && r.direction !== 'OUTGOING') throw ruleViolation('NOT_OUTGOING', 'Only outgoing referrals are sent');
    if (input.action === 'send' && !r.clinicalSummary) throw ruleViolation('SUMMARY_REQUIRED', 'Add a clinical summary before sending');
    if (input.action === 'send' && input.email && !r.contact?.email) throw ruleViolation('NO_EMAIL', 'This contact has no email address');
    const ctx = RequestContext.require();
    const now = new Date();
    return this.prisma.db.$transaction(async (tx) => {
      const data: Prisma.ReferralUpdateInput = { status: t.to as any };
      if (input.action === 'send') Object.assign(data, { sentAt: now, sentByName: ctx.userName });
      if (input.action === 'accept') Object.assign(data, { acceptedAt: now, appointmentAt: input.appointmentAt ?? r.appointmentAt });
      if (input.action === 'complete') Object.assign(data, { completedAt: now, outcome: input.outcome });
      if (input.action === 'decline' || input.action === 'cancel') Object.assign(data, { declineReason: input.reason });
      const after = await tx.referral.update({ where: { id }, data, include });
      if (input.action === 'send' && input.email && r.contact?.email) {
        const org = await this.prisma.raw.organization.findUniqueOrThrow({ where: { id: ctx.organizationId! }, select: { name: true, phone: true, email: true } });
        await this.messages.enqueue(tx, {
          channel: 'EMAIL',
          recipient: r.contact.email,
          subject: `Referral ${referralNo(r.number)}: ${r.patient.name} (${r.patient.species.name}) — ${r.urgency.toLowerCase()}`,
          body: letterText(after, org),
          purpose: 'REFERRAL',
          clientId: r.clientId,
          patientId: r.patientId,
          dedupeKey: `REFERRAL:${r.id}`,
          sourceType: 'Referral',
          sourceId: r.id,
        });
      }
      await this.audit.record({ action: `referral.${input.action}`, entityType: 'Patient', entityId: r.patientId, summary: `${referralNo(r.number)}${input.reason ? `: ${input.reason}` : ''}${input.action === 'send' && input.email ? ' (emailed)' : ''}` }, tx);
      return shape(after);
    });
  }
}

function letterText(r: Ref, org: { name: string; phone: string | null; email: string | null }) {
  const p = r.patient;
  return [
    `Dear ${r.contact?.name ?? 'colleague'},`,
    '',
    `We would be grateful if you could see the following patient (${r.urgency.toLowerCase()} referral).`,
    '',
    `Patient: ${p.name} — ${p.species.name}${p.breed?.name || p.breedText ? `, ${p.breed?.name ?? p.breedText}` : ''}, ${p.sex.toLowerCase().replace('_', ' ')}${p.dateOfBirth ? `, born ${p.dateOfBirth.toISOString().slice(0, 10)}` : ''}${p.latestWeightKg ? `, ${Number(p.latestWeightKg)} kg` : ''}`,
    p.identifiers[0] ? `Microchip: ${p.identifiers[0].value}` : null,
    `Owner: ${r.client.displayName}${r.client.mobilePhone ? `, ${r.client.mobilePhone}` : ''}`,
    '',
    `Reason for referral: ${r.reason}`,
    '',
    'Clinical summary:',
    r.clinicalSummary ?? '',
    r.questions ? `\nQuestions for the specialist:\n${r.questions}` : null,
    '',
    `Kind regards,`,
    `${r.sentByName ?? r.createdByName ?? ''}`,
    `${org.name}${org.phone ? ` · ${org.phone}` : ''}${org.email ? ` · ${org.email}` : ''}`,
    `Reference: ${referralNo(r.number)}`,
  ]
    .filter((l) => l !== null)
    .join('\n');
}
