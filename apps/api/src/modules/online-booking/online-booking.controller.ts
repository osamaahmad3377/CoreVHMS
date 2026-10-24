import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { onlineBookingSettingsSchema, publicBookingSchema, publicCancelSchema, publicRescheduleSchema } from '@vcms/shared';
import type { Request, Response } from 'express';
import QRCode from 'qrcode';
import { z } from 'zod';
import { Public, RequirePermissions, SkipCsrf } from '../../common/auth/decorators';
import { ApiZodBody, ApiZodQuery, zp } from '../../common/http/zod';
import { requestHost } from '../../common/tenancy/tenant-resolver.middleware';
import { env } from '../../config/env';
import { OnlineBookingService } from './online-booking.service';

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-25');
const slotsQuery = z.object({ branchId: z.string().uuid(), appointmentTypeId: z.string().uuid(), clinicianId: z.string().uuid().optional().or(z.literal('')), date: DATE });
const daysQuery = z.object({ branchId: z.string().uuid(), appointmentTypeId: z.string().uuid(), clinicianId: z.string().uuid().optional().or(z.literal('')), from: DATE, count: z.coerce.number().int().min(1).max(14).default(14) });

/** Settings → Online booking (staff). */
@ApiTags('online-booking')
@Controller('online-booking')
export class OnlineBookingSettingsController {
  constructor(private readonly booking: OnlineBookingService) {}

  @Get()
  @RequirePermissions('settings.manage')
  settings() {
    return this.booking.settings();
  }

  /** A QR code of the booking link, for posters at the counter and printed cards. */
  @Get('qr')
  @RequirePermissions('settings.manage')
  async qr(@Query('url') url: string) {
    if (!/^https?:\/\/[^\s]{1,300}$/.test(url ?? '')) return { dataUrl: null };
    return { dataUrl: await QRCode.toDataURL(url, { margin: 1, width: 480, errorCorrectionLevel: 'M' }) };
  }

  @Put()
  @RequirePermissions('settings.manage')
  @ApiZodBody(onlineBookingSettingsSchema)
  save(@Body(zp(onlineBookingSettingsSchema)) body: z.infer<typeof onlineBookingSettingsSchema>) {
    return this.booking.save(body);
  }
}

/**
 * The public booking page (no sign-in). Each clinic is identified by its address (/book/<slug>); requests are
 * rate-limited per visitor, and bookings carry a hidden field robots fill in.
 */
@ApiTags('online-booking')
@Controller('public/booking')
@Public()
export class PublicBookingController {
  constructor(private readonly booking: OnlineBookingService) {}

  @Get('manage/:token')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  manage(@Param('token') token: string) {
    return this.booking.manage(token);
  }

  @Post('manage/:token/cancel')
  @HttpCode(200)
  @SkipCsrf()
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  cancel(@Param('token') token: string, @Body(zp(publicCancelSchema)) body: z.infer<typeof publicCancelSchema>) {
    return this.booking.cancel(token, body.reason || undefined);
  }

  @Post('manage/:token/reschedule')
  @HttpCode(200)
  @SkipCsrf()
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  reschedule(@Param('token') token: string, @Body(zp(publicRescheduleSchema)) body: z.infer<typeof publicRescheduleSchema>) {
    return this.booking.reschedule(token, { startsAt: body.startsAt, clinicianId: body.clinicianId || undefined });
  }

  @Get(':slug')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  info(@Param('slug') slug: string) {
    return this.booking.info(slug);
  }

  @Get(':slug/logo')
  async logo(@Param('slug') slug: string, @Res() res: Response) {
    const { meta, stream } = await this.booking.logo(slug);
    res.setHeader('Content-Type', meta.mimeType);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    stream.pipe(res);
  }

  @Get(':slug/days')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiZodQuery(daysQuery)
  days(@Param('slug') slug: string, @Query(zp(daysQuery)) q: z.infer<typeof daysQuery>) {
    return this.booking.days(slug, { ...q, clinicianId: q.clinicianId || undefined });
  }

  @Get(':slug/slots')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiZodQuery(slotsQuery)
  slots(@Param('slug') slug: string, @Query(zp(slotsQuery)) q: z.infer<typeof slotsQuery>) {
    return this.booking.slots(slug, { ...q, clinicianId: q.clinicianId || undefined });
  }

  @Post(':slug')
  @SkipCsrf()
  @Throttle({ default: { limit: 8, ttl: 3_600_000 } })
  @ApiZodBody(publicBookingSchema)
  book(@Param('slug') slug: string, @Body(zp(publicBookingSchema)) body: z.infer<typeof publicBookingSchema>, @Req() req: Request) {
    // The change link points back at the address the client used (the clinic's own web address).
    const origin = `${new URL(env().APP_URL).protocol}//${requestHost(req) ?? new URL(env().APP_URL).host}`;
    return this.booking.book(slug, body, origin);
  }
}
