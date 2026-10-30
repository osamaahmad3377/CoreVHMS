import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  wellnessAutoRenewSchema,
  wellnessCancelSchema,
  wellnessEnrolSchema,
  wellnessMembersQuery,
  wellnessPlanSchema,
  wellnessPlanStatusSchema,
  wellnessRenewSchema,
  wellnessReverseSchema,
  wellnessUsageSchema,
} from '@vcms/shared';
import { z } from 'zod';
import { RequireAnyPermission, RequirePermissions } from '../../common/auth/decorators';
import { ApiZodBody, ApiZodQuery, zp } from '../../common/http/zod';
import { WellnessService } from './wellness.service';

const UUID = new ParseUUIDPipe();

@ApiTags('wellness plans')
@Controller()
export class WellnessController {
  constructor(private readonly wellness: WellnessService) {}

  // ── Plans ──

  @Get('wellness/plans')
  @RequireAnyPermission('wellness.read', 'wellness.manage')
  plans(@Query('all') all?: string) {
    return this.wellness.listPlans(all === 'true');
  }

  @Get('wellness/plans/:id')
  @RequireAnyPermission('wellness.read', 'wellness.manage')
  plan(@Param('id', UUID) id: string) {
    return this.wellness.getPlan(id);
  }

  @Post('wellness/plans')
  @RequirePermissions('wellness.manage')
  @ApiZodBody(wellnessPlanSchema)
  createPlan(@Body(zp(wellnessPlanSchema)) body: z.infer<typeof wellnessPlanSchema>) {
    return this.wellness.savePlan(null, body);
  }

  @Patch('wellness/plans/:id')
  @RequirePermissions('wellness.manage')
  @ApiZodBody(wellnessPlanSchema)
  updatePlan(@Param('id', UUID) id: string, @Body(zp(wellnessPlanSchema)) body: z.infer<typeof wellnessPlanSchema>) {
    return this.wellness.savePlan(id, body);
  }

  @Post('wellness/plans/:id/status')
  @HttpCode(200)
  @RequirePermissions('wellness.manage')
  planStatus(@Param('id', UUID) id: string, @Body(zp(wellnessPlanStatusSchema)) body: z.infer<typeof wellnessPlanStatusSchema>) {
    return this.wellness.setPlanStatus(id, body.status);
  }

  // ── Members ──

  @Get('wellness/overview')
  @RequirePermissions('wellness.read')
  overview() {
    return this.wellness.overview();
  }

  @Get('wellness/members')
  @RequirePermissions('wellness.read')
  @ApiZodQuery(wellnessMembersQuery)
  members(@Query(zp(wellnessMembersQuery)) q: z.infer<typeof wellnessMembersQuery>) {
    return this.wellness.members(q);
  }

  @Get('patients/:id/wellness')
  @RequirePermissions('wellness.read')
  forPatient(@Param('id', UUID) id: string) {
    return this.wellness.forPatient(id);
  }

  @Post('wellness/enrolments')
  @RequirePermissions('wellness.enrol')
  @ApiZodBody(wellnessEnrolSchema)
  enrol(@Body(zp(wellnessEnrolSchema)) body: z.infer<typeof wellnessEnrolSchema>) {
    return this.wellness.enrol(body);
  }

  @Get('wellness/enrolments/:id')
  @RequirePermissions('wellness.read')
  detail(@Param('id', UUID) id: string) {
    return this.wellness.detail(id);
  }

  @Get('wellness/enrolments/:id/settlement')
  @RequirePermissions('wellness.read')
  settlement(@Param('id', UUID) id: string) {
    return this.wellness.settlement(id);
  }

  @Post('wellness/enrolments/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('wellness.enrol')
  @ApiZodBody(wellnessCancelSchema)
  cancel(@Param('id', UUID) id: string, @Body(zp(wellnessCancelSchema)) body: z.infer<typeof wellnessCancelSchema>) {
    return this.wellness.cancel(id, body);
  }

  @Post('wellness/enrolments/:id/renew')
  @HttpCode(200)
  @RequirePermissions('wellness.enrol')
  @ApiZodBody(wellnessRenewSchema)
  renew(@Param('id', UUID) id: string, @Body(zp(wellnessRenewSchema)) body: z.infer<typeof wellnessRenewSchema>) {
    return this.wellness.renew(id, body);
  }

  @Post('wellness/enrolments/:id/auto-renew')
  @HttpCode(200)
  @RequirePermissions('wellness.enrol')
  autoRenew(@Param('id', UUID) id: string, @Body(zp(wellnessAutoRenewSchema)) body: z.infer<typeof wellnessAutoRenewSchema>) {
    return this.wellness.setAutoRenew(id, body.autoRenew);
  }

  @Post('wellness/enrolments/:id/usage')
  @HttpCode(200)
  @RequirePermissions('wellness.enrol')
  @ApiZodBody(wellnessUsageSchema)
  usage(@Param('id', UUID) id: string, @Body(zp(wellnessUsageSchema)) body: z.infer<typeof wellnessUsageSchema>) {
    return this.wellness.recordUsage(id, body);
  }

  @Post('wellness/enrolments/:id/apply')
  @HttpCode(200)
  @RequirePermissions('wellness.enrol')
  apply(@Param('id', UUID) id: string) {
    return this.wellness.applyToPending(id);
  }

  @Post('wellness/usages/:id/reverse')
  @HttpCode(200)
  @RequirePermissions('wellness.enrol')
  reverse(@Param('id', UUID) id: string, @Body(zp(wellnessReverseSchema)) body: z.infer<typeof wellnessReverseSchema>) {
    return this.wellness.reverseUsage(id, body.reason);
  }

  @Post('wellness/bill-due')
  @HttpCode(200)
  @RequirePermissions('wellness.enrol')
  billDue() {
    return this.wellness.billDue();
  }
}
