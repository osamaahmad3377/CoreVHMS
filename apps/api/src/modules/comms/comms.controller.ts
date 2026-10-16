import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { MESSAGE_CHANNELS, MESSAGE_STATUSES, commsSettingsSchema, sendMessageSchema, templateSchema } from '@vcms/shared';
import { z } from 'zod';
import { AuditService, diff } from '../../common/audit/audit.service';
import { RequireAnyPermission, RequirePermissions } from '../../common/auth/decorators';
import { RequestContext } from '../../common/context/request-context';
import { ApiZodBody, ApiZodQuery, zp } from '../../common/http/zod';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MessagesService } from './messages.service';
import { RemindersService } from './reminders.service';
import { TemplatesService } from './templates.service';

const UUID = new ParseUUIDPipe();
const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  status: z.enum(MESSAGE_STATUSES).optional(),
  channel: z.enum(MESSAGE_CHANNELS).optional(),
  clientId: z.string().uuid().optional(),
  purpose: z.string().max(40).optional(),
});

@ApiTags('communications')
@Controller()
export class CommsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly messages: MessagesService,
    private readonly templates: TemplatesService,
    private readonly reminders: RemindersService,
  ) {}

  @Get('messages')
  @RequirePermissions('communications.read')
  @ApiZodQuery(listQuery)
  list(@Query(zp(listQuery)) q: z.infer<typeof listQuery>) {
    return this.messages.list(q);
  }

  @Post('messages')
  @RequirePermissions('communications.send')
  @ApiZodBody(sendMessageSchema)
  send(@Body(zp(sendMessageSchema)) body: z.infer<typeof sendMessageSchema>) {
    return this.messages.sendManual(body);
  }

  @Post('messages/:id/retry')
  @HttpCode(200)
  @RequirePermissions('communications.send')
  retry(@Param('id', UUID) id: string) {
    return this.messages.retry(id);
  }

  @Post('messages/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('communications.send')
  cancel(@Param('id', UUID) id: string) {
    return this.messages.cancel(id);
  }

  /** Runs reminder generation now for this organisation (also runs hourly in the background). */
  @Post('reminders/run')
  @HttpCode(200)
  @RequirePermissions('communications.send')
  runReminders() {
    return this.reminders.run();
  }

  @Get('message-templates')
  @RequireAnyPermission('communications.read', 'settings.manage')
  listTemplates() {
    return this.templates.list();
  }

  @Put('message-templates')
  @RequirePermissions('settings.manage')
  @ApiZodBody(templateSchema)
  saveTemplate(@Body(zp(templateSchema)) body: z.infer<typeof templateSchema>) {
    return this.templates.save(body);
  }

  @Get('communications/settings')
  @RequireAnyPermission('communications.read', 'settings.manage')
  async settings() {
    const o = await this.prisma.raw.organization.findUniqueOrThrow({ where: { id: RequestContext.orgId() } });
    return { reminderLeadDays: o.reminderLeadDays, overdueReminderDays: o.overdueReminderDays, appointmentReminderHours: o.appointmentReminderHours, portalEnabled: o.portalEnabled, portalCancelHours: o.portalCancelHours };
  }

  @Patch('communications/settings')
  @RequirePermissions('settings.manage')
  @ApiZodBody(commsSettingsSchema)
  async updateSettings(@Body(zp(commsSettingsSchema)) body: z.infer<typeof commsSettingsSchema>) {
    const id = RequestContext.orgId();
    await this.prisma.raw.$transaction(async (tx) => {
      const before = await tx.organization.findUniqueOrThrow({ where: { id } });
      const after = await tx.organization.update({ where: { id }, data: body });
      await this.audit.record({ action: 'communications_settings.updated', entityType: 'Organization', entityId: id, changes: diff(before, after, Object.keys(body)) }, tx);
    });
    return this.settings();
  }
}
