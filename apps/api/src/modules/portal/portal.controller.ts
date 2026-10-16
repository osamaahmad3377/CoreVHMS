import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  portalAcceptSchema,
  portalCancelSchema,
  portalForgotSchema,
  portalLoginSchema,
  portalMessageSchema,
  portalPasswordSchema,
  portalPreferencesSchema,
  portalRequestSchema,
  portalResetSchema,
} from '@vcms/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { PortalPublic, PortalRoute } from '../../common/auth/decorators';
import { zp } from '../../common/http/zod';
import { PortalAuthService, type PortalContext } from './portal-auth.service';
import { PortalGuard } from './portal.guard';
import { PortalService } from './portal.service';

const UUID = new ParseUUIDPipe();
const ctxOf = (req: Request) => (req as any).portal as PortalContext;

/** Client-facing API. Authenticated with the portal session, never a staff session. */
@ApiTags('client portal')
@Controller('portal')
@PortalRoute()
@UseGuards(PortalGuard)
export class PortalController {
  constructor(
    private readonly auth: PortalAuthService,
    private readonly portal: PortalService,
  ) {}

  // ── Authentication ──
  @Post('auth/login')
  @HttpCode(200)
  @PortalPublic()
  async login(@Body(zp(portalLoginSchema)) body: z.infer<typeof portalLoginSchema>, @Res({ passthrough: true }) res: Response) {
    const s = await this.auth.login(body.email, body.password);
    this.auth.setCookies(res, s.token, s.csrf, s.expiresAt);
    return { ok: true };
  }

  @Post('auth/accept')
  @HttpCode(200)
  @PortalPublic()
  async accept(@Body(zp(portalAcceptSchema)) body: z.infer<typeof portalAcceptSchema>, @Res({ passthrough: true }) res: Response) {
    const s = await this.auth.accept(body.token, body.password);
    this.auth.setCookies(res, s.token, s.csrf, s.expiresAt);
    return { ok: true };
  }

  @Post('auth/forgot')
  @HttpCode(200)
  @PortalPublic()
  forgot(@Body(zp(portalForgotSchema)) body: z.infer<typeof portalForgotSchema>) {
    return this.auth.forgot(body.email);
  }

  @Post('auth/reset')
  @HttpCode(200)
  @PortalPublic()
  reset(@Body(zp(portalResetSchema)) body: z.infer<typeof portalResetSchema>) {
    return this.auth.reset(body.token, body.password);
  }

  @Post('auth/logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(ctxOf(req));
    this.auth.clearCookies(res);
    return { ok: true };
  }

  @Get('auth/session')
  session(@Req() req: Request) {
    return this.auth.session(ctxOf(req));
  }

  @Post('auth/switch')
  @HttpCode(200)
  switchClinic(@Req() req: Request, @Body(zp(z.object({ accessId: z.string().uuid() }))) body: { accessId: string }) {
    return this.auth.switchClinic(ctxOf(req), body.accessId);
  }

  @Post('auth/password')
  @HttpCode(200)
  password(@Req() req: Request, @Body(zp(portalPasswordSchema)) body: z.infer<typeof portalPasswordSchema>) {
    return this.auth.changePassword(ctxOf(req), body.current, body.next);
  }

  // ── Data ──
  @Get('overview')
  overview(@Req() req: Request) {
    return this.portal.overview(ctxOf(req));
  }

  @Get('pets/:id')
  pet(@Req() req: Request, @Param('id', UUID) id: string) {
    return this.portal.pet(ctxOf(req), id);
  }

  @Get('pets/:id/certificate')
  certificate(@Req() req: Request, @Param('id', UUID) id: string) {
    return this.portal.certificate(ctxOf(req), id);
  }

  @Get('lab-reports/:id')
  lab(@Req() req: Request, @Param('id', UUID) id: string) {
    return this.portal.labReport(ctxOf(req), id);
  }

  @Get('documents')
  documents(@Req() req: Request) {
    return this.portal.documents(ctxOf(req));
  }

  @Get('documents/:id')
  async document(@Req() req: Request, @Param('id', UUID) id: string, @Res() res: Response) {
    const { meta, stream } = await this.portal.openDocument(ctxOf(req), id);
    res.setHeader('Content-Type', meta.mimeType);
    res.setHeader('Content-Length', String(meta.sizeBytes));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(meta.fileName)}"`);
    stream.on('error', () => res.status(404).end());
    stream.pipe(res);
  }

  @Get('appointments')
  appointments(@Req() req: Request) {
    return this.portal.appointments(ctxOf(req));
  }

  @Post('appointments/:id/cancel')
  @HttpCode(200)
  cancelAppointment(@Req() req: Request, @Param('id', UUID) id: string, @Body(zp(portalCancelSchema)) body: z.infer<typeof portalCancelSchema>) {
    return this.portal.cancelAppointment(ctxOf(req), id, body.reason);
  }

  @Post('appointment-requests')
  request(@Req() req: Request, @Body(zp(portalRequestSchema)) body: z.infer<typeof portalRequestSchema>) {
    return this.portal.requestAppointment(ctxOf(req), body);
  }

  @Post('appointment-requests/:id/cancel')
  @HttpCode(200)
  cancelRequest(@Req() req: Request, @Param('id', UUID) id: string) {
    return this.portal.cancelRequest(ctxOf(req), id);
  }

  @Get('invoices')
  invoices(@Req() req: Request) {
    return this.portal.invoices(ctxOf(req));
  }

  @Get('invoices/:id')
  invoice(@Req() req: Request, @Param('id', UUID) id: string) {
    return this.portal.invoice(ctxOf(req), id);
  }

  @Get('messages')
  messages(@Req() req: Request) {
    return this.portal.messages(ctxOf(req));
  }

  @Post('messages')
  sendMessage(@Req() req: Request, @Body(zp(portalMessageSchema)) body: z.infer<typeof portalMessageSchema>) {
    return this.portal.sendMessage(ctxOf(req), body);
  }

  @Get('preferences')
  preferences(@Req() req: Request) {
    return this.portal.preferences(ctxOf(req));
  }

  @Patch('preferences')
  updatePreferences(@Req() req: Request, @Body(zp(portalPreferencesSchema)) body: z.infer<typeof portalPreferencesSchema>) {
    return this.portal.updatePreferences(ctxOf(req), body);
  }
}
