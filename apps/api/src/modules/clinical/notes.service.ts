import { Injectable } from '@nestjs/common';
import { ClinicalNote, Prisma } from '@prisma/client';
import type { NoteContentInput } from '@vcms/shared';
import { AuditService, diff } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { sha256 } from '../../common/crypto/crypto';
import { conflict, notFound, ruleViolation } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';

const CONTENT_FIELDS = [
  'presentingComplaint',
  'history',
  'subjective',
  'objective',
  'assessment',
  'plan',
  'followUpInstructions',
  'examFindings',
] as const;

/** Deterministic hash of a note's clinical content plus signer and time (tamper evidence). */
export function noteContentHash(n: Pick<ClinicalNote, (typeof CONTENT_FIELDS)[number]>, signedById: string, signedAt: Date) {
  const canonical = JSON.stringify({
    ...Object.fromEntries(CONTENT_FIELDS.map((f) => [f, (n as any)[f] ?? null])),
    signedById,
    signedAt: signedAt.toISOString(),
  });
  return sha256(canonical);
}

function contentData(input: Partial<NoteContentInput>) {
  const data: Prisma.ClinicalNoteUncheckedUpdateInput = {};
  for (const f of CONTENT_FIELDS) {
    if ((input as any)[f] !== undefined) (data as any)[f] = f === 'examFindings' ? ((input as any)[f] ?? Prisma.JsonNull) : (input as any)[f];
  }
  if (input.templateId !== undefined) data.templateId = input.templateId;
  return data;
}

function hasClinicalContent(n: Partial<ClinicalNote>) {
  return ['subjective', 'objective', 'assessment', 'plan', 'presentingComplaint'].some((f) => typeof (n as any)[f] === 'string' && (n as any)[f].trim());
}

/**
 * SOAP notes. Workflow: DRAFT → (REVIEWED) → SIGNED. A signed note is immutable (also enforced by a DB trigger).
 * Corrections are amendments: a new version linked by `amendsId`; when the amendment is signed the
 * original becomes SUPERSEDED (its content is never changed).
 */
@Injectable()
export class NotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async openEncounter(encounterId: string) {
    const e = await this.prisma.db.encounter.findUnique({ where: { id: encounterId } });
    if (!e) throw notFound('Encounter');
    if (e.status === 'CANCELLED') throw ruleViolation('ENCOUNTER_CANCELLED', 'This consultation was cancelled');
    return e;
  }

  async create(encounterId: string, input: NoteContentInput, aiAssisted = false) {
    const e = await this.openEncounter(encounterId);
    if (input.templateId) {
      const t = await this.prisma.db.clinicalTemplate.findUnique({ where: { id: input.templateId } });
      if (!t) throw ruleViolation('INVALID_TEMPLATE', 'Template not found');
    }
    const ctx = RequestContext.require();
    return this.prisma.db.$transaction(async (tx) => {
      const n = await tx.clinicalNote.create({
        data: {
          ...(contentData(input) as any),
          organizationId: ctx.organizationId!,
          encounterId,
          patientId: e.patientId,
          authorId: ctx.userId!,
          authorName: ctx.userName ?? 'Unknown',
          aiAssisted,
        },
      });
      await this.audit.record({ action: 'note.created', entityType: 'Encounter', entityId: encounterId, summary: `Note v${n.version} draft` }, tx);
      return n;
    });
  }

  private async editable(noteId: string) {
    const n = await this.prisma.db.clinicalNote.findUnique({ where: { id: noteId } });
    if (!n) throw notFound('Note');
    if (n.status === 'SIGNED' || n.status === 'SUPERSEDED') {
      throw ruleViolation('NOTE_SIGNED', 'Signed notes cannot be edited. Create an amendment instead.');
    }
    return n;
  }

  async update(noteId: string, input: Partial<NoteContentInput>) {
    const before = await this.editable(noteId);
    const data = contentData(input);
    // Editing a reviewed note invalidates the review.
    if (before.status === 'REVIEWED') Object.assign(data, { status: 'DRAFT', reviewedById: null, reviewedByName: null, reviewedAt: null });
    return this.prisma.db.$transaction(async (tx) => {
      const after = await tx.clinicalNote.update({ where: { id: noteId }, data });
      await this.audit.record(
        {
          action: 'note.edited',
          entityType: 'Encounter',
          entityId: before.encounterId,
          summary: `Note v${before.version}`,
          changes: diff(before, after, Object.keys(data).filter((k) => CONTENT_FIELDS.includes(k as any))),
        },
        tx,
      );
      return after;
    });
  }

  async review(noteId: string) {
    const n = await this.editable(noteId);
    if (n.status !== 'DRAFT') throw ruleViolation('INVALID_TRANSITION', 'Only draft notes can be marked as reviewed');
    const ctx = RequestContext.require();
    return this.prisma.db.$transaction(async (tx) => {
      const after = await tx.clinicalNote.update({
        where: { id: noteId },
        data: { status: 'REVIEWED', reviewedById: ctx.userId, reviewedByName: ctx.userName, reviewedAt: new Date() },
      });
      await this.audit.record({ action: 'note.reviewed', entityType: 'Encounter', entityId: n.encounterId, summary: `Note v${n.version}` }, tx);
      return after;
    });
  }

  async sign(noteId: string) {
    const n = await this.editable(noteId);
    if (!hasClinicalContent(n)) throw ruleViolation('NOTE_EMPTY', 'Add clinical content before signing');
    const ctx = RequestContext.require();
    const signedAt = new Date();
    return this.prisma.db.$transaction(async (tx) => {
      const after = await tx.clinicalNote.update({
        where: { id: noteId },
        data: {
          status: 'SIGNED',
          signedById: ctx.userId,
          signedByName: ctx.userName,
          signedAt,
          contentHash: noteContentHash(n, ctx.userId!, signedAt),
        },
      });
      if (n.amendsId) {
        await tx.clinicalNote.update({ where: { id: n.amendsId }, data: { status: 'SUPERSEDED' } });
      }
      await this.audit.record(
        {
          action: n.amendsId ? 'note.amendment_signed' : 'note.signed',
          entityType: 'Encounter',
          entityId: n.encounterId,
          summary: `Note v${n.version}${n.amendmentReason ? ` — ${n.amendmentReason}` : ''}`,
        },
        tx,
      );
      return after;
    });
  }

  async amend(noteId: string, input: NoteContentInput & { amendmentReason: string }) {
    const original = await this.prisma.db.clinicalNote.findUnique({ where: { id: noteId }, include: { amendedBy: true } });
    if (!original) throw notFound('Note');
    if (original.status !== 'SIGNED') throw ruleViolation('NOT_SIGNED', 'Only signed notes can be amended; edit the draft instead');
    if (original.amendedBy) {
      throw conflict('An amendment for this note already exists', { code: 'AMENDMENT_EXISTS', noteId: original.amendedBy.id });
    }
    const ctx = RequestContext.require();
    const carry = Object.fromEntries(CONTENT_FIELDS.map((f) => [f, (original as any)[f] ?? (f === 'examFindings' ? Prisma.JsonNull : null)]));
    return this.prisma.db.$transaction(async (tx) => {
      const n = await tx.clinicalNote.create({
        data: {
          ...(carry as any),
          ...(contentData(input) as any),
          organizationId: ctx.organizationId!,
          encounterId: original.encounterId,
          patientId: original.patientId,
          version: original.version + 1,
          amendsId: original.id,
          amendmentReason: input.amendmentReason,
          templateId: original.templateId,
          authorId: ctx.userId!,
          authorName: ctx.userName ?? 'Unknown',
        },
      });
      await this.audit.record(
        { action: 'note.amendment_started', entityType: 'Encounter', entityId: original.encounterId, summary: `v${original.version} → v${n.version}: ${input.amendmentReason}` },
        tx,
      );
      return n;
    });
  }

  /** Discards an unsigned draft. Signed notes can never be deleted. */
  async discard(noteId: string) {
    const n = await this.editable(noteId);
    await this.prisma.db.$transaction(async (tx) => {
      await tx.clinicalNote.delete({ where: { id: noteId } });
      await this.audit.record(
        { action: 'note.draft_discarded', entityType: 'Encounter', entityId: n.encounterId, summary: `Note v${n.version}`, changes: { assessment: { from: n.assessment, to: null } } },
        tx,
      );
    });
  }

  /** Verifies a signed note's content against its stored hash. */
  async verify(noteId: string) {
    const n = await this.prisma.db.clinicalNote.findUnique({ where: { id: noteId } });
    if (!n) throw notFound('Note');
    if (!n.signedAt || !n.signedById || !n.contentHash) return { signed: false, valid: null };
    return { signed: true, valid: noteContentHash(n, n.signedById, n.signedAt) === n.contentHash };
  }
}
