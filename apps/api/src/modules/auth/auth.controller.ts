import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  acceptInvitationSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  mfaDisableSchema,
  mfaEnableSchema,
  mfaVerifySchema,
  registerOrganizationSchema,
  resetPasswordSchema,
  switchContextSchema,
} from '@vcms/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AllowDuringPasswordChange, Authenticated, Ctx, Public, SkipCsrf } from '../../common/auth/decorators';
import { SESSION_COOKIE, clearSessionCookies, setSessionCookies } from '../../common/auth/session-cookies';
import { RequestContextStore } from '../../common/context/request-context';
import { ApiZodBody, zp } from '../../common/http/zod';
import { AuthService, LoginResult } from './auth.service';
import { SessionService } from './session.service';

const AUTH_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  private async finish(res: Response, result: LoginResult) {
    if (result.status === 'mfa_required') return { mfaRequired: true, challengeId: result.challengeId };
    setSessionCookies(res, result.token, result.csrf, result.expiresAt);
    const resolved = await this.sessions.resolve(result.token);
    return { mfaRequired: false, session: await this.sessions.describe(result.sessionId, { requestId: '', ...resolved!.context }) };
  }

  @Public()
  @SkipCsrf()
  @Throttle(AUTH_THROTTLE)
  @Post('login')
  @HttpCode(200)
  @ApiZodBody(loginSchema)
  async login(@Body(zp(loginSchema)) body: z.infer<typeof loginSchema>, @Res({ passthrough: true }) res: Response) {
    return this.finish(res, await this.auth.login(body.email, body.password));
  }

  @Public()
  @SkipCsrf()
  @Throttle(AUTH_THROTTLE)
  @Post('mfa/verify')
  @HttpCode(200)
  @ApiZodBody(mfaVerifySchema)
  async verifyMfa(@Body(zp(mfaVerifySchema)) body: z.infer<typeof mfaVerifySchema>, @Res({ passthrough: true }) res: Response) {
    return this.finish(res, await this.auth.verifyMfa(body.challengeId, body.code));
  }

  @Public()
  @SkipCsrf()
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @Post('register')
  @ApiZodBody(registerOrganizationSchema)
  async register(
    @Body(zp(registerOrganizationSchema)) body: z.infer<typeof registerOrganizationSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.finish(res, await this.auth.registerOrganization(body));
  }

  @Authenticated()
  @AllowDuringPasswordChange()
  @Post('logout')
  @HttpCode(204)
  async logout(@Ctx() ctx: RequestContextStore, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(ctx.sessionId!);
    clearSessionCookies(res);
  }

  @Authenticated()
  @AllowDuringPasswordChange()
  @Get('session')
  async session(@Ctx() ctx: RequestContextStore) {
    return this.sessions.describe(ctx.sessionId!, ctx);
  }

  @Authenticated()
  @Post('switch')
  @HttpCode(200)
  @ApiZodBody(switchContextSchema)
  async switch(@Ctx() ctx: RequestContextStore, @Body(zp(switchContextSchema)) body: z.infer<typeof switchContextSchema>, @Req() req: Request) {
    await this.auth.switchContext(ctx.sessionId!, ctx.userId!, body.organizationId, body.branchId);
    const token = req.cookies?.[SESSION_COOKIE] as string;
    const resolved = await this.sessions.resolve(token);
    return this.sessions.describe(ctx.sessionId!, { requestId: ctx.requestId, ...resolved!.context });
  }

  @Public()
  @SkipCsrf()
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  @Post('forgot-password')
  @HttpCode(202)
  @ApiZodBody(forgotPasswordSchema)
  async forgot(@Body(zp(forgotPasswordSchema)) body: z.infer<typeof forgotPasswordSchema>) {
    await this.auth.forgotPassword(body.email);
    return { message: 'If an account exists for that email, a reset link has been sent.' };
  }

  @Public()
  @SkipCsrf()
  @Throttle(AUTH_THROTTLE)
  @Post('reset-password')
  @HttpCode(204)
  @ApiZodBody(resetPasswordSchema)
  async reset(@Body(zp(resetPasswordSchema)) body: z.infer<typeof resetPasswordSchema>) {
    await this.auth.resetPassword(body.token, body.password);
  }

  @Authenticated()
  @AllowDuringPasswordChange()
  @Post('change-password')
  @HttpCode(204)
  @ApiZodBody(changePasswordSchema)
  async changePassword(@Ctx() ctx: RequestContextStore, @Body(zp(changePasswordSchema)) body: z.infer<typeof changePasswordSchema>) {
    await this.auth.changePassword(ctx.userId!, ctx.sessionId!, body.currentPassword, body.newPassword);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Get('invitations/:token')
  async invitation(@Param('token') token: string) {
    return this.auth.previewInvitation(token);
  }

  @Public()
  @SkipCsrf()
  @Throttle(AUTH_THROTTLE)
  @Post('invitations/accept')
  @HttpCode(200)
  @ApiZodBody(acceptInvitationSchema)
  async accept(@Body(zp(acceptInvitationSchema)) body: z.infer<typeof acceptInvitationSchema>, @Res({ passthrough: true }) res: Response) {
    return this.finish(res, await this.auth.acceptInvitation(body.token, body.name, body.password));
  }

  @Authenticated()
  @Post('mfa/setup')
  @HttpCode(200)
  async mfaSetup(@Ctx() ctx: RequestContextStore) {
    return this.auth.mfaSetup(ctx.userId!);
  }

  @Authenticated()
  @Post('mfa/enable')
  @HttpCode(200)
  @ApiZodBody(mfaEnableSchema)
  async mfaEnable(@Ctx() ctx: RequestContextStore, @Body(zp(mfaEnableSchema)) body: z.infer<typeof mfaEnableSchema>) {
    return this.auth.mfaEnable(ctx.userId!, body.code);
  }

  @Authenticated()
  @Post('mfa/disable')
  @HttpCode(204)
  @ApiZodBody(mfaDisableSchema)
  async mfaDisable(@Ctx() ctx: RequestContextStore, @Body(zp(mfaDisableSchema)) body: z.infer<typeof mfaDisableSchema>) {
    await this.auth.mfaDisable(ctx.userId!, body.password);
  }

  @Authenticated()
  @Get('sessions')
  async listSessions(@Ctx() ctx: RequestContextStore) {
    return this.auth.listSessions(ctx.userId!, ctx.sessionId!);
  }

  @Authenticated()
  @Delete('sessions/:id')
  @HttpCode(204)
  async revokeSession(@Ctx() ctx: RequestContextStore, @Param('id', ParseUUIDPipe) id: string) {
    await this.auth.revokeSession(ctx.userId!, id);
  }
}
