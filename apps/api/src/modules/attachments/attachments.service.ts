import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { sha256 } from '../../common/crypto/crypto';
import { forbidden, notFound, ruleViolation } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ALLOWED_MIME_TYPES, StorageService, sniffMatches } from '../../common/storage/storage.service';

export interface AttachmentTarget {
  read: string;
  write: string;
  exists(id: string): Promise<boolean>;
}

@Injectable()
export class AttachmentsService {
  private readonly targets = new Map<string, AttachmentTarget>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {
    this.registerTarget('Client', {
      read: 'clients.read',
      write: 'clients.write',
      exists: async (id) => !!(await this.prisma.db.client.findUnique({ where: { id }, select: { id: true } })),
    });
    this.registerTarget('Patient', {
      read: 'patients.read',
      write: 'patients.write',
      exists: async (id) => !!(await this.prisma.db.patient.findUnique({ where: { id }, select: { id: true } })),
    });
    this.registerTarget('Organization', {
      read: 'dashboard.view',
      write: 'org.manage',
      exists: async (id) => id === RequestContext.orgId(),
    });
  }

  /** Modules owning documents (encounters, lab results, …) register their entity type and permissions. */
  registerTarget(entityType: string, target: AttachmentTarget) {
    this.targets.set(entityType, target);
  }

  private async authorize(entityType: string, entityId: string, mode: 'read' | 'write') {
    const target = this.targets.get(entityType);
    if (!target) throw ruleViolation('INVALID_ENTITY', `Attachments are not supported for ${entityType}`);
    if (!RequestContext.require().permissions.has(target[mode])) throw forbidden();
    if (!(await target.exists(entityId))) throw notFound(entityType);
  }

  async upload(
    file: Express.Multer.File | undefined,
    meta: { entityType: string; entityId: string; category?: string | null; description?: string | null },
  ) {
    if (!file) throw ruleViolation('FILE_REQUIRED', 'Choose a file to upload');
    await this.authorize(meta.entityType, meta.entityId, 'write');
    const ext = file.originalname.split('.').pop()?.toLowerCase() ?? '';
    const allowedExt = ALLOWED_MIME_TYPES[file.mimetype];
    if (!allowedExt || !allowedExt.includes(ext)) {
      throw ruleViolation('UNSUPPORTED_FILE', 'This file type is not allowed. Upload images, PDF, Office documents, CSV, DICOM or audio/video.');
    }
    if (!sniffMatches(file.mimetype, file.buffer)) throw ruleViolation('FILE_MISMATCH', 'The file content does not match its type');

    const ctx = RequestContext.require();
    const now = new Date();
    const storageKey = `${ctx.organizationId}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}.${ext}`;
    await this.storage.put(storageKey, file.buffer);
    try {
      return await this.prisma.db.$transaction(async (tx) => {
        const a = await tx.attachment.create({
          data: {
            organizationId: ctx.organizationId!,
            entityType: meta.entityType,
            entityId: meta.entityId,
            category: meta.category ?? null,
            description: meta.description ?? null,
            fileName: sanitizeFileName(file.originalname),
            mimeType: file.mimetype,
            sizeBytes: file.size,
            sha256: sha256(file.buffer),
            storageKey,
            uploadedById: ctx.userId,
            uploadedByName: ctx.userName,
          },
        });
        await this.audit.record(
          { action: 'attachment.uploaded', entityType: meta.entityType, entityId: meta.entityId, summary: a.fileName },
          tx,
        );
        return publicShape(a);
      });
    } catch (e) {
      await this.storage.remove(storageKey);
      throw e;
    }
  }

  async list(entityType: string, entityId: string) {
    await this.authorize(entityType, entityId, 'read');
    const rows = await this.prisma.db.attachment.findMany({
      where: { entityType, entityId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(publicShape);
  }

  async open(id: string) {
    const a = await this.prisma.db.attachment.findUnique({ where: { id } });
    if (!a || a.deletedAt) throw notFound('File');
    await this.authorize(a.entityType, a.entityId, 'read');
    this.audit.recordAsync({ action: 'attachment.downloaded', entityType: a.entityType, entityId: a.entityId, summary: a.fileName });
    return { meta: a, stream: this.storage.get(a.storageKey) };
  }

  /** Shares (or stops sharing) a document with the client in the portal. */
  async share(id: string, shared: boolean) {
    const a = await this.prisma.db.attachment.findUnique({ where: { id } });
    if (!a || a.deletedAt) throw notFound('File');
    await this.authorize(a.entityType, a.entityId, 'write');
    return this.prisma.db.$transaction(async (tx) => {
      const after = await tx.attachment.update({ where: { id }, data: { sharedWithClient: shared, sharedAt: shared ? new Date() : null, sharedByName: shared ? RequestContext.require().userName : null } });
      await this.audit.record({ action: shared ? 'attachment.shared_with_client' : 'attachment.unshared', entityType: a.entityType, entityId: a.entityId, summary: a.fileName }, tx);
      return publicShape(after);
    });
  }

  /**
   * Portal download. The caller (portal service) must already have checked that the entity belongs to the
   * signed-in client; this only serves files explicitly shared with the client.
   */
  async openShared(id: string, allowed: (entityType: string, entityId: string) => boolean) {
    const a = await this.prisma.db.attachment.findUnique({ where: { id } });
    if (!a || a.deletedAt || !a.sharedWithClient || !allowed(a.entityType, a.entityId)) throw notFound('File');
    this.audit.recordAsync({ action: 'attachment.downloaded_by_client', entityType: a.entityType, entityId: a.entityId, summary: a.fileName });
    return { meta: a, stream: this.storage.get(a.storageKey) };
  }

  async remove(id: string) {
    const a = await this.prisma.db.attachment.findUnique({ where: { id } });
    if (!a || a.deletedAt) throw notFound('File');
    await this.authorize(a.entityType, a.entityId, 'write');
    await this.prisma.db.$transaction(async (tx) => {
      // Soft delete: the file is retained for record-keeping and can be purged by retention jobs.
      await tx.attachment.update({ where: { id }, data: { deletedAt: new Date(), deletedById: RequestContext.require().userId } });
      await this.audit.record({ action: 'attachment.deleted', entityType: a.entityType, entityId: a.entityId, summary: a.fileName }, tx);
    });
  }
}

function sanitizeFileName(name: string) {
  return name.replace(/[^\w.\- ()]/g, '_').slice(0, 180) || 'file';
}

function publicShape(a: {
  id: string;
  entityType: string;
  entityId: string;
  category: string | null;
  description: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedByName: string | null;
  createdAt: Date;
  sharedWithClient?: boolean;
}) {
  return {
    id: a.id,
    entityType: a.entityType,
    entityId: a.entityId,
    category: a.category,
    description: a.description,
    fileName: a.fileName,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    uploadedByName: a.uploadedByName,
    createdAt: a.createdAt,
    sharedWithClient: a.sharedWithClient ?? false,
    url: `/api/v1/attachments/${a.id}/download`,
  };
}
