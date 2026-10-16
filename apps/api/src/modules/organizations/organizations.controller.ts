import { Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AttachmentsService } from '../attachments/attachments.service';
import { ApiTags } from '@nestjs/swagger';
import { branchSchema, branchUpdateSchema, organizationUpdateSchema } from '@vcms/shared';
import { z } from 'zod';
import { RequirePermissions } from '../../common/auth/decorators';
import { ApiZodBody, zp } from '../../common/http/zod';
import { OrganizationsService } from './organizations.service';

@ApiTags('organization')
@Controller()
export class OrganizationsController {
  constructor(
    private readonly orgs: OrganizationsService,
    private readonly attachments: AttachmentsService,
  ) {}

  @Post('organization/logo')
  @HttpCode(200)
  @RequirePermissions('org.manage')
  async setLogo(@Body(zp(z.object({ attachmentId: z.string().uuid().nullable() }))) body: { attachmentId: string | null }) {
    await this.orgs.setLogo(body.attachmentId);
    return { ok: true };
  }

  @Get('organization/logo')
  @RequirePermissions('dashboard.view')
  async logo(@Res() res: Response) {
    const org = await this.orgs.current();
    if (!org.logoAttachmentId) throw new NotFoundException({ code: 'NOT_FOUND', message: 'No logo' });
    const { meta, stream } = await this.attachments.open(org.logoAttachmentId);
    res.setHeader('Content-Type', meta.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    stream.pipe(res);
  }

  @Get('organization')
  @RequirePermissions('dashboard.view')
  current() {
    return this.orgs.current();
  }

  @Patch('organization')
  @RequirePermissions('org.manage')
  @ApiZodBody(organizationUpdateSchema)
  update(@Body(zp(organizationUpdateSchema)) body: z.infer<typeof organizationUpdateSchema>) {
    return this.orgs.update(body);
  }

  @Get('branches')
  @RequirePermissions('dashboard.view')
  branches() {
    return this.orgs.listBranches();
  }

  @Post('branches')
  @RequirePermissions('branches.manage')
  @ApiZodBody(branchSchema)
  createBranch(@Body(zp(branchSchema)) body: z.infer<typeof branchSchema>) {
    return this.orgs.createBranch(body);
  }

  @Patch('branches/:id')
  @RequirePermissions('branches.manage')
  @ApiZodBody(branchUpdateSchema)
  updateBranch(@Param('id', ParseUUIDPipe) id: string, @Body(zp(branchUpdateSchema)) body: z.infer<typeof branchUpdateSchema>) {
    return this.orgs.updateBranch(id, body);
  }
}
