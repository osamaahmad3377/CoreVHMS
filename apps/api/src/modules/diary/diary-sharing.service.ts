import { Injectable } from '@nestjs/common';
import type { DiaryBooklet, DiaryLinkInfo } from '@vcms/shared';
import { AuditService } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { notFound, ruleViolation } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AttachmentsService } from '../attachments/attachments.service';
import { MessagesService } from '../comms/messages.service';
import { diaryUrl, newDiaryToken } from './diary-link';
import { DiarySettingsService } from './diary-settings.service';
import { DiaryService } from './diary.service';

/**
 * The owner's online pet diary: the private link (QR code, messages), what the link opens, and sending it to the
 * owner by email or WhatsApp. The link shows the same diary the clinic prints — read-only, built from the records.
 */
@Injectable()
export class DiarySharingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly diary: DiaryService,
    private readonly settings: DiarySettingsService,
    private readonly messages: MessagesService,
    private readonly attachments: AttachmentsService,
  ) {}

  private info(l: { token: string; createdAt: Date; lastViewedAt: Date | null; viewCount: number }): DiaryLinkInfo {
    return { url: diaryUrl(l.token), createdAt: l.createdAt.toISOString(), lastViewedAt: l.lastViewedAt?.toISOString() ?? null, viewCount: l.viewCount };
  }

  private async activeLink(patientId: string) {
    const ctx = RequestContext.require();
    const p = await this.prisma.db.patient.findUnique({ where: { id: patientId }, select: { id: true, name: true, status: true } });
    if (!p || p.status === 'MERGED') throw notFound('Patient');
    const existing = await this.prisma.db.patientDiaryLink.findFirst({ where: { patientId, revokedAt: null }, orderBy: { createdAt: 'desc' } });
    if (existing) return { link: existing, patient: p };
    const link = await this.prisma.db.$transaction(async (tx) => {
      const l = await tx.patientDiaryLink.create({ data: { organizationId: ctx.organizationId!, patientId, token: newDiaryToken(), createdByName: ctx.userName ?? 'Unknown' } });
      await this.audit.record({ action: 'diary_link.created', entityType: 'Patient', entityId: patientId, summary: `Online diary link made for ${p.name}` }, tx);
      return l;
    });
    return { link, patient: p };
  }

  /** The patient's online link (made the first time it is needed). */
  async link(patientId: string): Promise<DiaryLinkInfo> {
    return this.info((await this.activeLink(patientId)).link);
  }

  /** A new link; the old one (on a printed QR code or in an old message) stops working. */
  async reset(patientId: string): Promise<DiaryLinkInfo> {
    const ctx = RequestContext.require();
    const { patient } = await this.activeLink(patientId);
    const fresh = await this.prisma.db.$transaction(async (tx) => {
      await tx.patientDiaryLink.updateMany({ where: { patientId, revokedAt: null }, data: { revokedAt: new Date() } });
      const l = await tx.patientDiaryLink.create({ data: { organizationId: ctx.organizationId!, patientId, token: newDiaryToken(), createdByName: ctx.userName ?? 'Unknown' } });
      await this.audit.record({ action: 'diary_link.reset', entityType: 'Patient', entityId: patientId, summary: `Online diary link reset for ${patient.name}` }, tx);
      return l;
    });
    return this.info(fresh);
  }

  /** What staff print and preview: the diary, the clinic's design and the QR address. */
  async booklet(patientId: string): Promise<DiaryBooklet> {
    const [diary, settings, { link }] = await Promise.all([this.diary.diary(patientId), this.settings.get(), this.activeLink(patientId)]);
    return { diary, settings, qrValue: settings.showQr ? diaryUrl(link.token) : null };
  }

  /** Sends the owner their pet's diary link by email or WhatsApp. */
  async send(patientId: string, channel: 'EMAIL' | 'WHATSAPP') {
    const { link, patient } = await this.activeLink(patientId);
    const owner = await this.prisma.db.patientOwnership.findFirst({ where: { patientId, endedAt: null }, orderBy: [{ isPrimary: 'desc' }, { startedAt: 'asc' }], include: { client: { select: { id: true, displayName: true } } } });
    if (!owner) throw ruleViolation('NO_OWNER', 'This animal has no owner to send the diary to');
    const org = await this.prisma.raw.organization.findUniqueOrThrow({ where: { id: RequestContext.orgId() }, select: { name: true } });
    const m = await this.messages.sendManual({
      clientId: owner.client.id,
      patientId,
      channel,
      subject: `${patient.name}’s pet diary — ${org.name}`,
      body: `Hello ${owner.client.displayName}, ${patient.name}’s pet diary from ${org.name} is ready. See vaccinations, treatments and what is due next, or print it: ${diaryUrl(link.token)}`,
    });
    return { status: m.status, channel };
  }

  // ── The public page (anyone with the link) ──

  private async byToken(token: string) {
    const l = await this.prisma.raw.patientDiaryLink.findUnique({ where: { token } });
    if (!l || l.revokedAt) throw notFound('Diary');
    return l;
  }

  /** The online diary behind the link (and its QR code). Counts the visit. */
  async open(token: string): Promise<DiaryBooklet> {
    const l = await this.byToken(token.slice(0, 80));
    await this.prisma.raw.patientDiaryLink.update({ where: { id: l.id }, data: { lastViewedAt: new Date(), viewCount: { increment: 1 } } });
    return RequestContext.runAs({ organizationId: l.organizationId, userName: 'Online diary' }, async () => {
      const [diary, settings] = await Promise.all([this.diary.diary(l.patientId), this.settings.get()]);
      return { diary, settings, qrValue: settings.showQr ? diaryUrl(l.token) : null };
    });
  }

  /** The pet's photo for the online diary — only the photo of the animal the link is for. */
  async photo(token: string) {
    const l = await this.byToken(token.slice(0, 80));
    return RequestContext.runAs({ organizationId: l.organizationId, userName: 'Online diary' }, async () => {
      const p = await this.prisma.db.patient.findUnique({ where: { id: l.patientId }, select: { photoAttachmentId: true } });
      if (!p?.photoAttachmentId) throw notFound('Photo');
      return this.attachments.openBrandImage(p.photoAttachmentId);
    });
  }
}
