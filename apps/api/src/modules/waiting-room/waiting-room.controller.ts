import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { kioskCheckInSchema, kioskLookupSchema, kioskWalkInSchema, waitingRoomSettingsSchema } from '@vcms/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { Public, RequireAnyPermission, RequirePermissions, SkipCsrf } from '../../common/auth/decorators';
import { ApiZodBody, zp } from '../../common/http/zod';
import { WaitingRoomService } from './waiting-room.service';

const UUID = new ParseUUIDPipe();

/** Settings → Waiting room, and the room list for calling patients. */
@ApiTags('waiting-room')
@Controller('waiting-room')
export class WaitingRoomController {
  constructor(private readonly room: WaitingRoomService) {}

  @Get()
  @RequirePermissions('settings.manage')
  list() {
    return this.room.list();
  }

  @Get('rooms')
  @RequireAnyPermission('appointments.checkin', 'clinical.write')
  rooms(@Query('branchId', UUID) branchId: string) {
    return this.room.rooms(branchId);
  }

  @Put(':branchId')
  @RequirePermissions('settings.manage')
  @ApiZodBody(waitingRoomSettingsSchema)
  save(@Param('branchId', UUID) branchId: string, @Body(zp(waitingRoomSettingsSchema)) body: z.infer<typeof waitingRoomSettingsSchema>) {
    return this.room.save(branchId, { ...body, message: body.message || undefined });
  }

  @Post(':branchId/new-links')
  @HttpCode(200)
  @RequirePermissions('settings.manage')
  newLinks(@Param('branchId', UUID) branchId: string) {
    return this.room.newLinks(branchId);
  }
}

/** The TV screen and the check-in tablet: opened by their secret links, no staff sign-in. */
@ApiTags('waiting-room')
@Controller('public/waiting-room')
@Public()
export class PublicWaitingRoomController {
  constructor(private readonly room: WaitingRoomService) {}

  @Get('display/:key')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  display(@Param('key') key: string) {
    return this.room.display(key);
  }

  @Get(':kind/:key/logo')
  async logo(@Param('kind') kind: string, @Param('key') key: string, @Res() res: Response) {
    const { meta, stream } = await this.room.logo(kind === 'kiosk' ? 'kiosk' : 'display', key);
    res.setHeader('Content-Type', meta.mimeType);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    stream.pipe(res);
  }

  @Get('kiosk/:key')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  kiosk(@Param('key') key: string) {
    return this.room.kiosk(key);
  }

  @Post('kiosk/:key/lookup')
  @HttpCode(200)
  @SkipCsrf()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  lookup(@Param('key') key: string, @Body(zp(kioskLookupSchema)) body: z.infer<typeof kioskLookupSchema>) {
    return this.room.lookup(key, body.mobilePhone);
  }

  @Post('kiosk/:key/check-in')
  @HttpCode(200)
  @SkipCsrf()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  checkIn(@Param('key') key: string, @Body(zp(kioskCheckInSchema)) body: z.infer<typeof kioskCheckInSchema>) {
    return this.room.checkIn(key, body.mobilePhone, body.appointmentId);
  }

  @Post('kiosk/:key/walk-in')
  @HttpCode(200)
  @SkipCsrf()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  walkIn(@Param('key') key: string, @Body(zp(kioskWalkInSchema)) body: z.infer<typeof kioskWalkInSchema>) {
    return this.room.walkIn(key, body);
  }
}
