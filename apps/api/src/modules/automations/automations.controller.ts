import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { automationSchema } from '@vcms/shared';
import { z } from 'zod';
import { RequireAnyPermission } from '../../common/auth/decorators';
import { ApiZodBody, zp } from '../../common/http/zod';
import { AutomationsService } from './automations.service';

const UUID = new ParseUUIDPipe();
const runsQuery = z.object({ automationId: z.string().uuid().optional(), status: z.enum(['WAITING', 'DONE', 'SKIPPED', 'FAILED', 'STOPPED', 'RUNNING']).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(30) });
const previewSchema = z.object({ automation: automationSchema, sourceId: z.string().uuid().nullish() });
const activeSchema = z.object({ isActive: z.boolean() });

/** Settings → Automations: the clinic's own "when → only if → then" workflows. */
@ApiTags('automations')
@Controller('automations')
export class AutomationsController {
  constructor(private readonly automations: AutomationsService) {}

  @Get()
  @RequireAnyPermission('settings.manage', 'integrations.manage')
  list() {
    return this.automations.list();
  }

  @Get('options')
  @RequireAnyPermission('settings.manage', 'integrations.manage')
  options() {
    return this.automations.options();
  }

  @Get('runs')
  @RequireAnyPermission('settings.manage', 'integrations.manage', 'communications.read')
  runs(@Query(zp(runsQuery)) q: z.infer<typeof runsQuery>) {
    return this.automations.runs(q);
  }

  @Post('runs/:id/stop')
  @HttpCode(200)
  @RequireAnyPermission('settings.manage', 'integrations.manage')
  stop(@Param('id', UUID) id: string) {
    return this.automations.stopRun(id);
  }

  /** What the automation would do for a recent real record — nothing is sent. */
  @Post('preview')
  @HttpCode(200)
  @RequireAnyPermission('settings.manage', 'integrations.manage')
  @ApiZodBody(previewSchema)
  preview(@Body(zp(previewSchema)) body: z.infer<typeof previewSchema>) {
    return this.automations.preview(body.automation, body.sourceId);
  }

  @Get(':id')
  @RequireAnyPermission('settings.manage', 'integrations.manage')
  get(@Param('id', UUID) id: string) {
    return this.automations.get(id);
  }

  @Post()
  @RequireAnyPermission('settings.manage', 'integrations.manage')
  @ApiZodBody(automationSchema)
  create(@Body(zp(automationSchema)) body: z.infer<typeof automationSchema>) {
    return this.automations.create(body);
  }

  @Put(':id')
  @RequireAnyPermission('settings.manage', 'integrations.manage')
  @ApiZodBody(automationSchema)
  update(@Param('id', UUID) id: string, @Body(zp(automationSchema)) body: z.infer<typeof automationSchema>) {
    return this.automations.update(id, body);
  }

  @Patch(':id/active')
  @RequireAnyPermission('settings.manage', 'integrations.manage')
  @ApiZodBody(activeSchema)
  setActive(@Param('id', UUID) id: string, @Body(zp(activeSchema)) body: z.infer<typeof activeSchema>) {
    return this.automations.setActive(id, body.isActive);
  }

  @Delete(':id')
  @RequireAnyPermission('settings.manage', 'integrations.manage')
  remove(@Param('id', UUID) id: string) {
    return this.automations.remove(id);
  }
}
