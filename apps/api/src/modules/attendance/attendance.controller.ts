import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  attendanceClockSchema,
  attendanceEditSchema,
  attendanceRangeQuery,
  attendanceRecordSchema,
  attendanceRegisterSchema,
  attendanceRemoveSchema,
  attendanceSettingsSchema,
} from '@vcms/shared';
import { z } from 'zod';
import { RequireAnyPermission, RequirePermissions } from '../../common/auth/decorators';
import { ApiZodBody, ApiZodQuery, zp } from '../../common/http/zod';
import { AttendanceService } from './attendance.service';

const UUID = new ParseUUIDPipe();

@ApiTags('attendance')
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get('settings')
  @RequireAnyPermission('attendance.clock', 'attendance.manage')
  settings() {
    return this.attendance.settings();
  }

  @Put('settings')
  @RequirePermissions('attendance.manage')
  @ApiZodBody(attendanceSettingsSchema)
  saveSettings(@Body(zp(attendanceSettingsSchema)) body: z.infer<typeof attendanceSettingsSchema>) {
    return this.attendance.saveSettings(body.graceMinutes);
  }

  // ── Yourself ──

  @Get('me')
  @RequirePermissions('attendance.clock')
  me() {
    return this.attendance.status();
  }

  @Get('me/history')
  @RequirePermissions('attendance.clock')
  @ApiZodQuery(attendanceRangeQuery)
  myHistory(@Query(zp(attendanceRangeQuery)) q: z.infer<typeof attendanceRangeQuery>) {
    return this.attendance.myHistory(q);
  }

  @Post('clock-in')
  @HttpCode(200)
  @RequirePermissions('attendance.clock')
  @ApiZodBody(attendanceClockSchema)
  clockIn(@Body(zp(attendanceClockSchema)) body: z.infer<typeof attendanceClockSchema>) {
    return this.attendance.clockIn(body.note);
  }

  @Post('clock-out')
  @HttpCode(200)
  @RequirePermissions('attendance.clock')
  @ApiZodBody(attendanceClockSchema)
  clockOut(@Body(zp(attendanceClockSchema)) body: z.infer<typeof attendanceClockSchema>) {
    return this.attendance.clockOut(body.note);
  }

  @Post('break/start')
  @HttpCode(200)
  @RequirePermissions('attendance.clock')
  startBreak() {
    return this.attendance.startBreak();
  }

  @Post('break/end')
  @HttpCode(200)
  @RequirePermissions('attendance.clock')
  endBreak() {
    return this.attendance.endBreak();
  }

  // ── Everyone (managers) ──

  @Get()
  @RequirePermissions('attendance.manage')
  @ApiZodQuery(attendanceRangeQuery)
  range(@Query(zp(attendanceRangeQuery)) q: z.infer<typeof attendanceRangeQuery>) {
    return this.attendance.range(q);
  }

  @Post()
  @RequirePermissions('attendance.manage')
  @ApiZodBody(attendanceRecordSchema)
  add(@Body(zp(attendanceRecordSchema)) body: z.infer<typeof attendanceRecordSchema>) {
    return this.attendance.add(body);
  }

  @Post('register')
  @HttpCode(200)
  @RequirePermissions('attendance.manage')
  @ApiZodBody(attendanceRegisterSchema)
  register(@Body(zp(attendanceRegisterSchema)) body: z.infer<typeof attendanceRegisterSchema>) {
    return this.attendance.register(body);
  }

  @Patch(':id')
  @RequirePermissions('attendance.manage')
  @ApiZodBody(attendanceEditSchema)
  edit(@Param('id', UUID) id: string, @Body(zp(attendanceEditSchema)) body: z.infer<typeof attendanceEditSchema>) {
    return this.attendance.edit(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('attendance.manage')
  @ApiZodQuery(attendanceRemoveSchema)
  remove(@Param('id', UUID) id: string, @Query(zp(attendanceRemoveSchema)) q: z.infer<typeof attendanceRemoveSchema>) {
    return this.attendance.remove(id, q.reason);
  }
}
