import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { z } from 'zod';
import { env } from '../../config/env';
import { RequireAnyPermission } from '../../common/auth/decorators';
import { zp } from '../../common/http/zod';
import { AttachmentsService } from './attachments.service';

const uploadMeta = z.object({
  entityType: z.string().regex(/^[A-Za-z]{2,40}$/),
  entityId: z.string().uuid(),
  category: z.string().trim().max(40).optional().nullable(),
  description: z.string().trim().max(300).optional().nullable(),
});

const listQuery = z.object({
  entityType: z.string().regex(/^[A-Za-z]{2,40}$/),
  entityId: z.string().uuid(),
  /** Also list (read-only) files on related records, e.g. a patient's consultations and hospital stays. */
  includeRelated: z.enum(['true', 'false']).optional(),
});

@ApiTags('attachments')
@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Post()
  @ApiConsumes('multipart/form-data')
  @RequireAnyPermission('clients.write', 'patients.write', 'org.manage', 'clinical.write', 'lab.result', 'documents.write')
  @UseInterceptors(
    FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: env().MAX_UPLOAD_MB * 1024 * 1024, files: 1 } }),
  )
  upload(@UploadedFile() file: Express.Multer.File | undefined, @Body(zp(uploadMeta)) body: z.infer<typeof uploadMeta>) {
    return this.attachments.upload(file, body);
  }

  @Get()
  @RequireAnyPermission('clients.read', 'patients.read', 'dashboard.view')
  list(@Query(zp(listQuery)) q: z.infer<typeof listQuery>) {
    return this.attachments.list(q.entityType, q.entityId, q.includeRelated === 'true');
  }

  @Get(':id/download')
  @RequireAnyPermission('clients.read', 'patients.read', 'dashboard.view')
  async download(@Param('id', ParseUUIDPipe) id: string, @Query('inline') inline: string | undefined, @Res() res: Response) {
    const { meta, stream } = await this.attachments.open(id);
    const inlineOk = inline === '1' && (meta.mimeType.startsWith('image/') || meta.mimeType === 'application/pdf');
    res.setHeader('Content-Type', meta.mimeType);
    res.setHeader('Content-Length', String(meta.sizeBytes));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Content-Disposition', `${inlineOk ? 'inline' : 'attachment'}; filename="${encodeURIComponent(meta.fileName)}"`);
    stream.on('error', () => res.status(404).end());
    stream.pipe(res);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireAnyPermission('clients.write', 'patients.write', 'org.manage', 'clinical.write', 'documents.write')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.attachments.remove(id);
  }
}
