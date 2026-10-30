import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { homeVisitArriveSchema, homeVisitDayQuery, homeVisitDistanceSchema, homeVisitOnTheWaySchema, homeVisitSettingsSchema } from '@vcms/shared';
import { z } from 'zod';
import { RequireAnyPermission, RequirePermissions } from '../../common/auth/decorators';
import { ApiZodBody, ApiZodQuery, zp } from '../../common/http/zod';
import { HomeVisitsService } from './home-visits.service';

const UUID = new ParseUUIDPipe();

@ApiTags('home-visits')
@Controller('home-visits')
export class HomeVisitsController {
  constructor(private readonly visits: HomeVisitsService) {}

  @Get('settings')
  @RequireAnyPermission('appointments.read', 'settings.manage')
  settings() {
    return this.visits.settings();
  }

  @Put('settings')
  @RequirePermissions('settings.manage')
  @ApiZodBody(homeVisitSettingsSchema)
  saveSettings(@Body(zp(homeVisitSettingsSchema)) body: z.infer<typeof homeVisitSettingsSchema>) {
    return this.visits.saveSettings(body);
  }

  @Get()
  @RequirePermissions('appointments.read')
  @ApiZodQuery(homeVisitDayQuery)
  day(@Query(zp(homeVisitDayQuery)) q: z.infer<typeof homeVisitDayQuery>) {
    return this.visits.day(q);
  }

  @Post(':id/on-the-way')
  @HttpCode(200)
  @RequireAnyPermission('appointments.checkin', 'clinical.write')
  @ApiZodBody(homeVisitOnTheWaySchema)
  onTheWay(@Param('id', UUID) id: string, @Body(zp(homeVisitOnTheWaySchema)) body: z.infer<typeof homeVisitOnTheWaySchema>) {
    return this.visits.onTheWay(id, body.notifyClient);
  }

  @Post(':id/arrived')
  @HttpCode(200)
  @RequireAnyPermission('appointments.checkin', 'clinical.write')
  @ApiZodBody(homeVisitArriveSchema)
  arrived(@Param('id', UUID) id: string, @Body(zp(homeVisitArriveSchema)) body: z.infer<typeof homeVisitArriveSchema>) {
    return this.visits.arrived(id, body.distanceKm);
  }

  @Put(':id/distance')
  @RequireAnyPermission('appointments.checkin', 'clinical.write')
  @ApiZodBody(homeVisitDistanceSchema)
  distance(@Param('id', UUID) id: string, @Body(zp(homeVisitDistanceSchema)) body: z.infer<typeof homeVisitDistanceSchema>) {
    return this.visits.setDistance(id, body.distanceKm);
  }
}
