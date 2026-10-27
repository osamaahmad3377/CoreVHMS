import { Body, Controller, Delete, Get, HttpCode, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { emailSettingsSchema, emailSmtpConnectSchema } from '@vcms/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Public, RequireAnyPermission, SkipCsrf } from '../../common/auth/decorators';
import { ruleViolation } from '../../common/http/errors';
import { assertFeature } from '../../common/tenancy/entitlements';
import { ApiZodBody, zp } from '../../common/http/zod';
import { requestHost } from '../../common/tenancy/tenant-resolver.middleware';
import { EmailIntegrationService } from './email-integration.service';

const signInSchema = z.object({ provider: z.enum(['GMAIL', 'OUTLOOK']), email: z.string().trim().email().nullish() });
const testSchema = z.object({ to: z.string().trim().email('Enter an email address') });

/** Settings → Integrations → Email: the clinic's own mailbox for client emails. */
@ApiTags('integrations')
@Controller('integrations/email')
export class EmailIntegrationController {
  constructor(private readonly email: EmailIntegrationService) {}

  @Get()
  @RequireAnyPermission('integrations.manage', 'settings.manage')
  overview() {
    return this.email.overview();
  }

  /** Connects with an app password or the mailbox's server details, after checking it can sign in. */
  @Put('password')
  @RequireAnyPermission('integrations.manage', 'settings.manage')
  @ApiZodBody(emailSmtpConnectSchema)
  connect(@Body(zp(emailSmtpConnectSchema)) body: z.infer<typeof emailSmtpConnectSchema>) {
    assertFeature('mailbox');
    return this.email.connectWithPassword(body);
  }

  /** The Google / Microsoft sign-in page; after signing in the browser returns to this settings page. */
  @Post('sign-in')
  @HttpCode(200)
  @RequireAnyPermission('integrations.manage', 'settings.manage')
  @ApiZodBody(signInSchema)
  signIn(@Body(zp(signInSchema)) body: z.infer<typeof signInSchema>, @Req() req: Request) {
    assertFeature('mailbox');
    const origin = req.header('origin');
    // Back to the address the clinic is using (checked against the request, so it cannot point elsewhere).
    if (!origin || new URL(origin).host !== requestHost(req)) throw ruleViolation('BAD_ORIGIN', 'Open the settings page from your clinic’s address and try again');
    return this.email.startSignIn(body.provider, `${origin}/settings/integrations/email`, body.email);
  }

  @Post('test')
  @HttpCode(200)
  @RequireAnyPermission('integrations.manage', 'settings.manage')
  @ApiZodBody(testSchema)
  test(@Body(zp(testSchema)) body: z.infer<typeof testSchema>) {
    return this.email.test(body.to);
  }

  @Patch('settings')
  @RequireAnyPermission('integrations.manage', 'settings.manage')
  @ApiZodBody(emailSettingsSchema)
  settings(@Body(zp(emailSettingsSchema)) body: z.infer<typeof emailSettingsSchema>) {
    return this.email.updateSettings(body);
  }

  @Delete()
  @RequireAnyPermission('integrations.manage', 'settings.manage')
  disconnect() {
    return this.email.disconnect();
  }
}

/** Google and Microsoft send the browser back here after signing in (one address registered for every clinic). */
@ApiTags('integrations')
@Controller('oauth/email')
export class EmailOAuthController {
  constructor(private readonly email: EmailIntegrationService) {}

  @Get('callback')
  @Public()
  @SkipCsrf()
  async callback(@Query() q: { code?: string; state?: string; error?: string; error_description?: string }, @Res() res: Response) {
    res.redirect(302, await this.email.finishSignIn(q));
  }
}
