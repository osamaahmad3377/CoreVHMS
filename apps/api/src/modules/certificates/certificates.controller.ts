import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  CERTIFICATE_KINDS,
  certificateListQuery,
  certificateTemplateSchema,
  certificateTemplateUpdateSchema,
  issueCertificateSchema,
  revokeCertificateSchema,
} from '@vcms/shared';
import { z } from 'zod';
import { Public, RequireAnyPermission, RequirePermissions } from '../../common/auth/decorators';
import { ApiZodBody, zp } from '../../common/http/zod';
import { CertificateTemplatesService } from './certificate-templates.service';
import { CertificatesService } from './certificates.service';

const prefillQuery = z.object({ kind: z.enum(CERTIFICATE_KINDS), subjectId: z.string().uuid() });
const templateListQuery = z.object({ kind: z.enum(CERTIFICATE_KINDS).optional() });
/** The preview takes the form as it is (required answers may still be missing). */
const previewSchema = z.object({
  kind: z.enum(CERTIFICATE_KINDS),
  templateId: z.string().uuid().nullish(),
  patientId: z.string().uuid().nullish(),
  membershipId: z.string().uuid().nullish(),
  inputs: z.record(z.string().max(4000)).default({}),
  vaccinationIds: z.array(z.string().uuid()).max(200).optional(),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});

@ApiTags('certificates')
@Controller('certificates')
export class CertificatesController {
  constructor(private readonly certificates: CertificatesService) {}

  @Get()
  @RequireAnyPermission('certificates.read', 'certificates.staff')
  list(@Query(zp(certificateListQuery)) q: z.infer<typeof certificateListQuery>) {
    return this.certificates.list(q);
  }

  /** Suggested answers for the issue form (from the patient's or staff member's records). */
  @Get('prefill')
  @RequireAnyPermission('certificates.issue', 'certificates.staff')
  prefill(@Query(zp(prefillQuery)) q: z.infer<typeof prefillQuery>) {
    return this.certificates.prefill(q.kind, q.subjectId);
  }

  @Get(':id')
  @RequireAnyPermission('certificates.read', 'certificates.staff')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.certificates.get(id);
  }

  /** Patient certificates need certificates.issue, staff ones certificates.staff (checked per kind). */
  @Post()
  @RequireAnyPermission('certificates.issue', 'certificates.staff')
  @ApiZodBody(issueCertificateSchema)
  issue(@Body(zp(issueCertificateSchema)) body: z.infer<typeof issueCertificateSchema>) {
    return this.certificates.issue(body);
  }

  /** What the certificate will look like, filled from the records, before it is issued. */
  @Post('preview')
  @HttpCode(200)
  @RequireAnyPermission('certificates.issue', 'certificates.staff')
  @ApiZodBody(issueCertificateSchema)
  preview(@Body(zp(previewSchema)) body: z.infer<typeof previewSchema>) {
    return this.certificates.preview(body as z.infer<typeof issueCertificateSchema>);
  }

  @Post(':id/revoke')
  @HttpCode(200)
  @RequireAnyPermission('certificates.issue', 'certificates.staff')
  @ApiZodBody(revokeCertificateSchema)
  revoke(@Param('id', ParseUUIDPipe) id: string, @Body(zp(revokeCertificateSchema)) body: z.infer<typeof revokeCertificateSchema>) {
    return this.certificates.revoke(id, body.reason);
  }
}

@ApiTags('certificates')
@Controller('certificate-templates')
export class CertificateTemplatesController {
  constructor(private readonly templates: CertificateTemplatesService) {}

  @Get()
  @RequireAnyPermission('certificates.templates', 'certificates.issue', 'certificates.staff')
  list(@Query(zp(templateListQuery)) q: z.infer<typeof templateListQuery>) {
    return this.templates.list(q.kind);
  }

  @Get(':id')
  @RequireAnyPermission('certificates.templates', 'certificates.issue', 'certificates.staff')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.templates.get(id);
  }

  @Post()
  @RequirePermissions('certificates.templates')
  @ApiZodBody(certificateTemplateSchema)
  create(@Body(zp(certificateTemplateSchema)) body: z.infer<typeof certificateTemplateSchema>) {
    return this.templates.create(body);
  }

  @Patch(':id')
  @RequirePermissions('certificates.templates')
  @ApiZodBody(certificateTemplateUpdateSchema)
  update(@Param('id', ParseUUIDPipe) id: string, @Body(zp(certificateTemplateUpdateSchema)) body: z.infer<typeof certificateTemplateUpdateSchema>) {
    return this.templates.update(id, body);
  }

  @Post(':id/default')
  @HttpCode(200)
  @RequirePermissions('certificates.templates')
  setDefault(@Param('id', ParseUUIDPipe) id: string) {
    return this.templates.setDefault(id);
  }

  @Delete(':id')
  @RequirePermissions('certificates.templates')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.templates.remove(id);
  }
}

/** The page behind the QR code: anyone can check a certificate by its code. */
@ApiTags('certificates')
@Controller('public/certificates')
@Public()
export class PublicCertificatesController {
  constructor(private readonly certificates: CertificatesService) {}

  @Get(':code')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  verify(@Param('code') code: string) {
    return this.certificates.verify(code.slice(0, 40));
  }
}
