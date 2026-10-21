import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { whatsappConnectSchema, whatsappSettingsSchema, whatsappTemplateLinkSchema, whatsappTestSchema } from '@vcms/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Public, RequirePermissions, SkipCsrf } from '../../common/auth/decorators';
import { ApiZodBody, zp } from '../../common/http/zod';
import { WebhookBody, WhatsAppService } from './whatsapp.service';

/** Settings → Integrations → WhatsApp (clinic owner / staff with integrations.manage). */
@ApiTags('integrations')
@Controller('integrations/whatsapp')
export class WhatsAppController {
  constructor(private readonly whatsapp: WhatsAppService) {}

  @Get()
  @RequirePermissions('integrations.manage')
  overview() {
    return this.whatsapp.overview();
  }

  /** Connects (or updates) the clinic's WhatsApp Business number after checking it with Meta. */
  @Put()
  @RequirePermissions('integrations.manage')
  @ApiZodBody(whatsappConnectSchema)
  connect(@Body(zp(whatsappConnectSchema)) body: z.infer<typeof whatsappConnectSchema>) {
    return this.whatsapp.connect({ ...body, accessToken: body.accessToken || undefined, appSecret: body.appSecret || undefined });
  }

  @Post('verify')
  @HttpCode(200)
  @RequirePermissions('integrations.manage')
  verify() {
    return this.whatsapp.verify();
  }

  @Patch('settings')
  @RequirePermissions('integrations.manage')
  @ApiZodBody(whatsappSettingsSchema)
  settings(@Body(zp(whatsappSettingsSchema)) body: z.infer<typeof whatsappSettingsSchema>) {
    return this.whatsapp.updateSettings(body);
  }

  @Delete()
  @RequirePermissions('integrations.manage')
  disconnect() {
    return this.whatsapp.disconnect();
  }

  @Get('templates')
  @RequirePermissions('integrations.manage')
  templates() {
    return this.whatsapp.templates();
  }

  @Put('template-links')
  @RequirePermissions('integrations.manage')
  @ApiZodBody(whatsappTemplateLinkSchema)
  link(@Body(zp(whatsappTemplateLinkSchema)) body: z.infer<typeof whatsappTemplateLinkSchema>) {
    return this.whatsapp.saveLink({ ...body, templateName: body.templateName || undefined, language: body.language || undefined });
  }

  @Post('test')
  @HttpCode(200)
  @RequirePermissions('integrations.manage')
  @ApiZodBody(whatsappTestSchema)
  test(@Body(zp(whatsappTestSchema)) body: z.infer<typeof whatsappTestSchema>) {
    return this.whatsapp.sendTest(body);
  }
}

/**
 * Meta → clinic: webhook verification and events (deliveries, reads, failures, clients' replies).
 * Public; each clinic's number has its own secret key in the address, and calls are signed with the app secret.
 */
@ApiTags('integrations')
@Controller('webhooks/whatsapp')
export class WhatsAppWebhookController {
  constructor(private readonly whatsapp: WhatsAppService) {}

  @Get(':key')
  @Public()
  async verify(@Param('key') key: string, @Query('hub.mode') mode: string, @Query('hub.verify_token') token: string, @Query('hub.challenge') challenge: string, @Res() res: Response) {
    res.type('text/plain').send(await this.whatsapp.verifyWebhook(key, mode, token, challenge));
  }

  @Post(':key')
  @Public()
  @SkipCsrf()
  @HttpCode(200)
  receive(@Param('key') key: string, @Req() req: Request & { rawBody?: Buffer }, @Headers('x-hub-signature-256') signature: string | undefined, @Body() body: WebhookBody) {
    return this.whatsapp.receive(key, req.rawBody, signature, body);
  }
}
