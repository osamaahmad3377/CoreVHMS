import { Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AttachmentsService } from '../attachments/attachments.service';
import { ApiTags } from '@nestjs/swagger';
import { branchSchema, branchUpdateSchema, brandingUpdateSchema, organizationUpdateSchema } from '@vcms/shared';
import { z } from 'zod';
import { RequirePermissions } from '../../common/auth/decorators';
import { ApiZodBody, zp } from '../../common/http/zod';
import { BrandImage, OrganizationsService } from './organizations.service';

const imageBody = z.object({ attachmentId: z.string().uuid().nullable() });

@ApiTags('organization')
@Controller()
export class OrganizationsController {
  constructor(
    private readonly orgs: OrganizationsService,
    private readonly attachments: AttachmentsService,
  ) {}

  // ── Branding (white label): owner only ──

  @Get('organization/branding')
  @RequirePermissions('branding.manage')
  branding() {
    return this.orgs.branding();
  }

  @Put('organization/branding')
  @RequirePermissions('branding.manage')
  @ApiZodBody(brandingUpdateSchema)
  updateBranding(@Body(zp(brandingUpdateSchema)) body: z.infer<typeof brandingUpdateSchema>) {
    return this.orgs.updateBranding(body);
  }

  @Post('organization/logo')
  @HttpCode(200)
  @RequirePermissions('branding.manage')
  setLogo(@Body(zp(imageBody)) body: z.infer<typeof imageBody>) {
    return this.orgs.setBrandImage('logo', body.attachmentId);
  }

  @Post('organization/icon')
  @HttpCode(200)
  @RequirePermissions('branding.manage')
  setIcon(@Body(zp(imageBody)) body: z.infer<typeof imageBody>) {
    return this.orgs.setBrandImage('icon', body.attachmentId);
  }

  @Post('organization/logo-dark')
  @HttpCode(200)
  @RequirePermissions('branding.manage')
  setLogoDark(@Body(zp(imageBody)) body: z.infer<typeof imageBody>) {
    return this.orgs.setBrandImage('logo-dark', body.attachmentId);
  }

  @Post('organization/login-background')
  @HttpCode(200)
  @RequirePermissions('branding.manage')
  setLoginBackground(@Body(zp(imageBody)) body: z.infer<typeof imageBody>) {
    return this.orgs.setBrandImage('login-background', body.attachmentId);
  }

  @Get('organization/logo-dark')
  @RequirePermissions('dashboard.view')
  logoDark(@Res() res: Response) {
    return this.sendBrandImage('logo-dark', res);
  }

  @Get('organization/login-background')
  @RequirePermissions('dashboard.view')
  loginBackground(@Res() res: Response) {
    return this.sendBrandImage('login-background', res);
  }

  @Get('organization/logo')
  @RequirePermissions('dashboard.view')
  logo(@Res() res: Response) {
    return this.sendBrandImage('logo', res);
  }

  @Get('organization/icon')
  @RequirePermissions('dashboard.view')
  icon(@Res() res: Response) {
    return this.sendBrandImage('icon', res);
  }

  private async sendBrandImage(kind: BrandImage, res: Response) {
    const id = this.orgs.brandImageId(await this.orgs.current(), kind);
    if (!id) throw new NotFoundException({ code: 'NOT_FOUND', message: `No ${kind}` });
    const { meta, stream } = await this.attachments.open(id);
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
