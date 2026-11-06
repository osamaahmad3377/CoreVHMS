import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { diarySettingsSchema, serologyTestSchema, voidSerologySchema } from '@vcms/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { Public, RequireAnyPermission, RequirePermissions } from '../../common/auth/decorators';
import { ApiZodBody, zp } from '../../common/http/zod';
import { DiaryAutomationsService, type SharingAutomation } from './diary-automations.service';
import { DiarySettingsService } from './diary-settings.service';
import { DiarySharingService } from './diary-sharing.service';
import { HistorySummaryService } from './history-summary.service';
import { DiaryService } from './diary.service';

const sendSchema = z.object({ channel: z.enum(['EMAIL', 'WHATSAPP']) });
const autoSchema = z.object({ which: z.enum(['diary', 'certificate']), on: z.boolean() });

@ApiTags('diary')
@Controller()
export class DiaryController {
  constructor(
    private readonly diary: DiaryService,
    private readonly sharing: DiarySharingService,
    private readonly history: HistorySummaryService,
  ) {}

  /** The animal's earlier care from the clinic's records, for the consultation's past history. */
  @Get('patients/:id/history-summary')
  @RequirePermissions('clinical.read')
  historySummary(@Param('id', ParseUUIDPipe) id: string, @Query('exclude') exclude?: string) {
    return this.history.summary(id, exclude && /^[0-9a-f-]{36}$/i.test(exclude) ? exclude : undefined);
  }

  /** Everything the pet diary prints, read from the patient's records. */
  @Get('patients/:id/diary')
  @RequirePermissions('preventive.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.diary.diary(id);
  }

  /** The diary with the clinic's design and the QR address — what is previewed and printed. */
  @Get('patients/:id/diary/booklet')
  @RequirePermissions('preventive.read')
  booklet(@Param('id', ParseUUIDPipe) id: string) {
    return this.sharing.booklet(id);
  }

  /** The owner's online link (made the first time). */
  @Get('patients/:id/diary/link')
  @RequirePermissions('preventive.read')
  link(@Param('id', ParseUUIDPipe) id: string) {
    return this.sharing.link(id);
  }

  /** A new link: the old one stops working. */
  @Post('patients/:id/diary/link/reset')
  @HttpCode(200)
  @RequirePermissions('preventive.write')
  reset(@Param('id', ParseUUIDPipe) id: string) {
    return this.sharing.reset(id);
  }

  /** Sends the owner the link by email or WhatsApp. */
  @Post('patients/:id/diary/send')
  @HttpCode(200)
  @RequirePermissions('communications.send')
  @ApiZodBody(sendSchema)
  send(@Param('id', ParseUUIDPipe) id: string, @Body(zp(sendSchema)) body: z.infer<typeof sendSchema>) {
    return this.sharing.send(id, body.channel);
  }

  @Get('patients/:id/serology')
  @RequirePermissions('preventive.read')
  list(@Param('id', ParseUUIDPipe) id: string) {
    return this.diary.list(id);
  }

  /** A rabies antibody test: planned, or taken with its result. */
  @Post('patients/:id/serology')
  @RequirePermissions('preventive.write')
  @ApiZodBody(serologyTestSchema)
  record(@Param('id', ParseUUIDPipe) id: string, @Body(zp(serologyTestSchema)) body: z.infer<typeof serologyTestSchema>) {
    return this.diary.record(id, body);
  }

  @Patch('serology/:id')
  @RequirePermissions('preventive.write')
  @ApiZodBody(serologyTestSchema)
  update(@Param('id', ParseUUIDPipe) id: string, @Body(zp(serologyTestSchema)) body: z.infer<typeof serologyTestSchema>) {
    return this.diary.update(id, body);
  }

  @Post('serology/:id/void')
  @HttpCode(200)
  @RequirePermissions('preventive.write')
  @ApiZodBody(voidSerologySchema)
  void(@Param('id', ParseUUIDPipe) id: string, @Body(zp(voidSerologySchema)) body: z.infer<typeof voidSerologySchema>) {
    return this.diary.void(id, body.reason);
  }
}

/** Settings → Pet diary. */
@ApiTags('diary')
@Controller('diary-settings')
export class DiarySettingsController {
  constructor(
    private readonly settings: DiarySettingsService,
    private readonly automations: DiaryAutomationsService,
  ) {}

  @Get()
  @RequireAnyPermission('settings.manage', 'preventive.read')
  get() {
    return this.settings.get();
  }

  @Put()
  @RequirePermissions('settings.manage')
  @ApiZodBody(diarySettingsSchema)
  update(@Body(zp(diarySettingsSchema)) body: z.infer<typeof diarySettingsSchema>) {
    return this.settings.update(body);
  }

  /** Back to the standard design. */
  @Post('reset')
  @HttpCode(200)
  @RequirePermissions('settings.manage')
  reset() {
    return this.settings.reset();
  }

  /** Whether the links are sent automatically (diary after a visit, certificate when issued). */
  @Get('automatic-sending')
  @RequirePermissions('settings.manage')
  automatic() {
    return this.automations.state();
  }

  @Put('automatic-sending')
  @RequirePermissions('settings.manage')
  @ApiZodBody(autoSchema)
  setAutomatic(@Body(zp(autoSchema)) body: z.infer<typeof autoSchema>) {
    return this.automations.set(body.which as SharingAutomation, body.on);
  }
}

/** The page behind the owner's link and QR code: anyone with the link can read the diary. */
@ApiTags('diary')
@Controller('public/diary')
@Public()
export class PublicDiaryController {
  constructor(private readonly sharing: DiarySharingService) {}

  @Get(':token')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  open(@Param('token') token: string) {
    return this.sharing.open(token);
  }

  @Get(':token/photo')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async photo(@Param('token') token: string, @Res() res: Response) {
    const { meta, stream } = await this.sharing.photo(token);
    res.setHeader('Content-Type', meta.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    stream.pipe(res);
  }
}
