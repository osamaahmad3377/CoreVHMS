import { Injectable } from '@nestjs/common';
import { DEFAULT_NOTE_PHRASES, NOTE_PHRASE_FIELDS, type NotePhraseInput } from '@vcms/shared';
import { AuditService } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { notFound, ruleViolation } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * One-tap phrases under the consultation note fields. Each clinic owns its list: the starter set is added once
 * (the first time anyone opens a note or the settings page) and can then be changed freely. The phrases only
 * ever add text to a draft; the vet reads and signs the note as usual.
 */
@Injectable()
export class NotePhrasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private starterRows(organizationId: string, skip?: Set<string>) {
    return NOTE_PHRASE_FIELDS.flatMap((field) =>
      DEFAULT_NOTE_PHRASES[field]
        .map((p, i) => ({ organizationId, field, groupName: p.group ?? null, label: p.label, text: p.text ?? null, sortOrder: (i + 1) * 10, isDefault: p.normal === true }))
        .filter((r) => !skip?.has(`${r.field}|${r.groupName ?? ''}|${r.label}`)),
    );
  }

  /** Adds the starter phrases the first time only, even if two requests arrive together. */
  private async ensureSeeded() {
    const orgId = RequestContext.orgId();
    const org = await this.prisma.raw.organization.findUnique({ where: { id: orgId }, select: { notePhrasesSeeded: true } });
    if (!org || org.notePhrasesSeeded) return;
    await this.prisma.raw.$transaction(async (tx) => {
      const claimed = await tx.organization.updateMany({ where: { id: orgId, notePhrasesSeeded: false }, data: { notePhrasesSeeded: true } });
      if (claimed.count) await tx.notePhrase.createMany({ data: this.starterRows(orgId) });
    });
  }

  async list(opts: { includeInactive?: boolean } = {}) {
    await this.ensureSeeded();
    return this.prisma.db.notePhrase.findMany({
      where: opts.includeInactive ? {} : { isActive: true },
      orderBy: [{ field: 'asc' }, { sortOrder: 'asc' }, { label: 'asc' }],
    });
  }

  async create(input: NotePhraseInput) {
    await this.ensureSeeded();
    return this.prisma.db.$transaction(async (tx) => {
      const clash = await tx.notePhrase.findFirst({ where: { field: input.field, groupName: input.groupName, label: input.label } });
      if (clash) throw ruleViolation('DUPLICATE_PHRASE', 'That button already exists for this field');
      const last = await tx.notePhrase.findFirst({ where: { field: input.field }, orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } });
      const row = await tx.notePhrase.create({
        data: { organizationId: RequestContext.orgId(), field: input.field, groupName: input.groupName, label: input.label, text: input.text, sortOrder: input.sortOrder ?? (last?.sortOrder ?? 0) + 10, isActive: input.isActive ?? true, isDefault: input.isDefault ?? false },
      });
      await this.audit.record({ action: 'note_phrase.created', entityType: 'NotePhrase', entityId: row.id, summary: `${row.field}: ${row.label}` }, tx);
      return row;
    });
  }

  async update(id: string, input: Partial<NotePhraseInput>) {
    return this.prisma.db.$transaction(async (tx) => {
      const before = await tx.notePhrase.findUnique({ where: { id } });
      if (!before) throw notFound('Phrase');
      const field = input.field ?? before.field;
      const label = input.label ?? before.label;
      const groupName = input.groupName !== undefined ? input.groupName : before.groupName;
      if (label !== before.label || field !== before.field || groupName !== before.groupName) {
        const clash = await tx.notePhrase.findFirst({ where: { field, groupName, label, NOT: { id } } });
        if (clash) throw ruleViolation('DUPLICATE_PHRASE', 'That button already exists for this field');
      }
      const row = await tx.notePhrase.update({
        where: { id },
        data: {
          ...(input.field !== undefined && { field: input.field }),
          ...(input.groupName !== undefined && { groupName: input.groupName }),
          ...(input.label !== undefined && { label: input.label }),
          ...(input.text !== undefined && { text: input.text }),
          ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
          ...(input.isActive !== undefined && { isActive: input.isActive }),
          ...(input.isDefault !== undefined && { isDefault: input.isDefault }),
        },
      });
      await this.audit.record({ action: 'note_phrase.updated', entityType: 'NotePhrase', entityId: id, summary: `${row.field}: ${row.label}` }, tx);
      return row;
    });
  }

  async remove(id: string) {
    await this.prisma.db.$transaction(async (tx) => {
      const row = await tx.notePhrase.findUnique({ where: { id } });
      if (!row) throw notFound('Phrase');
      await tx.notePhrase.delete({ where: { id } });
      await this.audit.record({ action: 'note_phrase.deleted', entityType: 'NotePhrase', entityId: id, summary: `${row.field}: ${row.label}` }, tx);
    });
    return { deleted: true };
  }

  /** Puts back any starter phrase that was removed, without touching the clinic's own changes. */
  async restoreStarter() {
    await this.ensureSeeded();
    return this.prisma.db.$transaction(async (tx) => {
      const existing = await tx.notePhrase.findMany({ select: { field: true, groupName: true, label: true } });
      const rows = this.starterRows(RequestContext.orgId(), new Set(existing.map((e) => `${e.field}|${e.groupName ?? ''}|${e.label}`)));
      if (rows.length) await tx.notePhrase.createMany({ data: rows });
      await this.audit.record({ action: 'note_phrase.starter_restored', entityType: 'NotePhrase', entityId: RequestContext.orgId(), summary: `${rows.length} starter phrases added` }, tx);
      return { added: rows.length };
    });
  }
}
