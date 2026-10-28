import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { automationConditionSchema, automationSchema, automationTemplateSchema } from '@vcms/shared';
import { z } from 'zod';
import { Public, RequireAnyPermission, RequirePermissions, SkipCsrf } from '../../common/auth/decorators';
import { Throttle } from '@nestjs/throttler';
import { ApiZodBody, zp } from '../../common/http/zod';
import { AutomationsService } from './automations.service';
import { MarketingOptOutService } from './marketing-optout.service';

const UUID = new ParseUUIDPipe();
const runsQuery = z.object({ automationId: z.string().uuid().optional(), status: z.enum(['WAITING', 'DONE', 'SKIPPED', 'FAILED', 'STOPPED', 'RUNNING']).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(30) });
const previewSchema = z.object({ automation: automationSchema, sourceId: z.string().uuid().nullish() });
const activeSchema = z.object({ isActive: z.boolean() });
const audienceSchema = z.object({ conditions: z.array(automationConditionSchema).max(10).default([]) });
const testSendSchema = z.object({ automation: automationSchema, to: z.string().trim().email().nullish() });
const unsubscribeSchema = z.object({ t: z.string().min(10).max(300) });
const marketingSettingsSchema = z.object({ capDays: z.number().int().min(1).max(90).nullable().optional(), paused: z.boolean().optional(), approval: z.boolean().optional() });
const rejectSchema = z.object({ note: z.string().trim().min(3, 'Say what needs changing').max(300) });
const daysQuery = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });

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

  @Get('stats')
  @RequireAnyPermission('settings.manage', 'integrations.manage')
  stats() {
    return this.automations.stats();
  }

  @Post(':id/duplicate')
  @RequireAnyPermission('settings.manage', 'integrations.manage')
  duplicate(@Param('id', UUID) id: string) {
    return this.automations.duplicate(id);
  }

  @Get('options')
  @RequireAnyPermission('settings.manage', 'integrations.manage')
  options() {
    return this.automations.options();
  }

  /** The clinic's own templates (saved from automations and campaigns it made). */
  @Get('templates')
  @RequireAnyPermission('settings.manage', 'integrations.manage')
  templates() {
    return this.automations.templates();
  }

  @Get('templates/:id')
  @RequireAnyPermission('settings.manage', 'integrations.manage')
  template(@Param('id', UUID) id: string) {
    return this.automations.template(id);
  }

  @Post('templates')
  @RequireAnyPermission('settings.manage', 'integrations.manage')
  @ApiZodBody(automationTemplateSchema)
  saveTemplate(@Body(zp(automationTemplateSchema)) body: z.infer<typeof automationTemplateSchema>) {
    return this.automations.saveTemplate(body);
  }

  @Post('templates/:id/used')
  @HttpCode(200)
  @RequireAnyPermission('settings.manage', 'integrations.manage')
  templateUsed(@Param('id', UUID) id: string) {
    return this.automations.templateUsed(id);
  }

  @Delete('templates/:id')
  @RequireAnyPermission('settings.manage', 'integrations.manage')
  removeTemplate(@Param('id', UUID) id: string) {
    return this.automations.removeTemplate(id);
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

  /** How many clients an offer would reach with these conditions (only clients who agreed to marketing) — nothing is sent. */
  @Post('audience')
  @HttpCode(200)
  @RequireAnyPermission('settings.manage', 'integrations.manage')
  @ApiZodBody(audienceSchema)
  audience(@Body(zp(audienceSchema)) body: z.infer<typeof audienceSchema>) {
    return this.automations.audienceCounts(body.conditions);
  }

  /** Sends the first message to the person trying it (their email), filled in from a real client — nothing goes to clients. */
  @Post('test-send')
  @HttpCode(200)
  @RequireAnyPermission('settings.manage', 'integrations.manage')
  @ApiZodBody(testSendSchema)
  async testSend(@Body(zp(testSendSchema)) body: z.infer<typeof testSendSchema>) {
    const to = body.to ?? (await this.automations.myEmail());
    return this.automations.testSend(body.automation, to);
  }

  /** Marketing limit: at most one promotional message per client every N days. */
  @Put('marketing-settings')
  @RequireAnyPermission('settings.manage', 'integrations.manage')
  @ApiZodBody(marketingSettingsSchema)
  marketingSettings(@Body(zp(marketingSettingsSchema)) body: z.infer<typeof marketingSettingsSchema>) {
    return this.automations.setMarketingSettings(body);
  }

  /** Problems in the last days, grouped by automation and reason. */
  @Get('problems')
  @RequireAnyPermission('settings.manage', 'integrations.manage')
  problems(@Query(zp(daysQuery)) q: z.infer<typeof daysQuery>) {
    return this.automations.problems(q.days);
  }

  @Post('runs/:id/retry')
  @HttpCode(200)
  @RequireAnyPermission('settings.manage', 'integrations.manage')
  retry(@Param('id', UUID) id: string) {
    return this.automations.retryRun(id);
  }

  /** Marketing at a glance for the last N days. */
  @Get('marketing/overview')
  @RequireAnyPermission('settings.manage', 'integrations.manage')
  marketingOverview(@Query(zp(daysQuery)) q: z.infer<typeof daysQuery>) {
    return this.automations.marketingOverview(q.days);
  }

  /** Clients who stopped offers themselves. */
  @Get('marketing/opt-outs')
  @RequireAnyPermission('settings.manage', 'integrations.manage')
  optOuts() {
    return this.automations.optOuts();
  }

  /** A manager (not the last person to change it) approves a campaign; it switches on. */
  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermissions('org.manage')
  approve(@Param('id', UUID) id: string) {
    return this.automations.approve(id);
  }

  /** Sends a campaign back with a note on what to change. */
  @Post(':id/reject')
  @HttpCode(200)
  @RequirePermissions('org.manage')
  @ApiZodBody(rejectSchema)
  reject(@Param('id', UUID) id: string, @Body(zp(rejectSchema)) body: z.infer<typeof rejectSchema>) {
    return this.automations.reject(id, body.note);
  }

  /** Every saved state of an automation, newest first. */
  @Get(':id/versions')
  @RequireAnyPermission('settings.manage', 'integrations.manage')
  versions(@Param('id', UUID) id: string) {
    return this.automations.versions(id);
  }

  @Post(':id/versions/:version/restore')
  @HttpCode(200)
  @RequireAnyPermission('settings.manage', 'integrations.manage')
  restore(@Param('id', UUID) id: string, @Param('version') version: string) {
    return this.automations.restore(id, Number(version));
  }

  /** Runs, messages delivered and read, and (for offers) bookings and payments that followed. */
  @Get(':id/results')
  @RequireAnyPermission('settings.manage', 'integrations.manage')
  results(@Param('id', UUID) id: string) {
    return this.automations.results(id);
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

/** The "Stop offers" link in promotional emails (no sign-in: the signed link names the client). */
@ApiTags('automations')
@Controller('public/marketing')
@Public()
export class PublicMarketingController {
  constructor(private readonly optOut: MarketingOptOutService) {}

  @Get('unsubscribe')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  describe(@Query('t') token: string) {
    return this.optOut.describe(token);
  }

  @Post('unsubscribe')
  @HttpCode(200)
  @SkipCsrf()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  unsubscribe(@Body(zp(unsubscribeSchema)) body: z.infer<typeof unsubscribeSchema>) {
    return this.optOut.unsubscribe(body.t);
  }
}
