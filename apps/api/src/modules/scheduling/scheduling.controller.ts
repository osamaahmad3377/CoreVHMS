import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  appointmentListQuery,
  callPatientSchema,
  appointmentStatusActionSchema,
  appointmentTypeSchema,
  availabilityQuery,
  createAppointmentSchema,
  leaveSchema,
  rescheduleAppointmentSchema,
  resourceSchema,
  triageSchema,
  waitlistSchema,
  walkInSchema,
  workingHoursSchema,
} from '@vcms/shared';
import { z } from 'zod';
import { RequireAnyPermission, RequirePermissions } from '../../common/auth/decorators';
import { RequestContext } from '../../common/context/request-context';
import { ApiZodBody, ApiZodQuery, zp } from '../../common/http/zod';
import { AppointmentsService } from './appointments.service';
import { FrontDeskService } from './front-desk.service';
import { ScheduleConfigService } from './schedule-config.service';

const UUID = new ParseUUIDPipe();
const rangeQuery = z.object({ from: z.coerce.date(), to: z.coerce.date(), membershipId: z.string().uuid().optional(), branchId: z.string().uuid().optional() });

@ApiTags('scheduling')
@Controller()
export class SchedulingController {
  constructor(
    private readonly config: ScheduleConfigService,
    private readonly appointments: AppointmentsService,
    private readonly frontDesk: FrontDeskService,
  ) {}

  // ── Appointment types ──
  @Get('appointment-types')
  @RequireAnyPermission('appointments.read', 'settings.manage')
  types(@Query('all') all?: string) {
    return this.config.listTypes(all === 'true');
  }

  @Post('appointment-types')
  @RequirePermissions('settings.manage')
  @ApiZodBody(appointmentTypeSchema)
  createType(@Body(zp(appointmentTypeSchema)) body: z.infer<typeof appointmentTypeSchema>) {
    return this.config.createType(body);
  }

  @Patch('appointment-types/:id')
  @RequirePermissions('settings.manage')
  updateType(@Param('id', UUID) id: string, @Body(zp(appointmentTypeSchema.partial())) body: Partial<z.infer<typeof appointmentTypeSchema>>) {
    return this.config.updateType(id, body);
  }

  // ── Resources ──
  @Get('resources')
  @RequireAnyPermission('appointments.read', 'settings.manage')
  resources(@Query('branchId') branchId?: string, @Query('all') all?: string) {
    return this.config.listResources(branchId && /^[0-9a-f-]{36}$/i.test(branchId) ? branchId : undefined, all === 'true');
  }

  @Post('resources')
  @RequirePermissions('settings.manage')
  @ApiZodBody(resourceSchema)
  createResource(@Body(zp(resourceSchema)) body: z.infer<typeof resourceSchema>) {
    return this.config.createResource(body);
  }

  @Patch('resources/:id')
  @RequirePermissions('settings.manage')
  updateResource(@Param('id', UUID) id: string, @Body(zp(resourceSchema.omit({ branchId: true }).partial())) body: any) {
    return this.config.updateResource(id, body);
  }

  // ── Rosters ──
  @Get('schedules/roster')
  @RequireAnyPermission('staff.read', 'appointments.read')
  roster(@Query(zp(rangeQuery.extend({ branchId: z.string().uuid() }))) q: { branchId: string; from: Date; to: Date }) {
    return this.config.roster(q.branchId, q.from, q.to);
  }

  @Get('schedules/working-hours/:membershipId')
  @RequireAnyPermission('staff.read', 'appointments.read')
  workingHours(@Param('membershipId', UUID) membershipId: string) {
    return this.config.getWorkingHours(membershipId);
  }

  @Put('schedules/working-hours/:membershipId')
  @RequirePermissions('staff.manage')
  @ApiZodBody(workingHoursSchema)
  setWorkingHours(@Param('membershipId', UUID) membershipId: string, @Body(zp(workingHoursSchema)) body: z.infer<typeof workingHoursSchema>) {
    return this.config.setWorkingHours(membershipId, body);
  }

  @Get('schedules/leave')
  @RequireAnyPermission('staff.read', 'appointments.read')
  leave(@Query(zp(rangeQuery)) q: z.infer<typeof rangeQuery>) {
    return this.config.listLeave(q.from, q.to, q.membershipId);
  }

  @Post('schedules/leave')
  @RequirePermissions('staff.manage')
  @ApiZodBody(leaveSchema)
  addLeave(@Body(zp(leaveSchema)) body: z.infer<typeof leaveSchema>) {
    return this.config.addLeave(body);
  }

  @Delete('schedules/leave/:id')
  @HttpCode(204)
  @RequirePermissions('staff.manage')
  removeLeave(@Param('id', UUID) id: string) {
    return this.config.removeLeave(id);
  }

  // ── Appointments ──
  @Get('appointments')
  @RequirePermissions('appointments.read')
  @ApiZodQuery(appointmentListQuery)
  list(@Query(zp(appointmentListQuery)) q: z.infer<typeof appointmentListQuery>) {
    return this.appointments.list(q);
  }

  @Get('appointments/availability')
  @RequirePermissions('appointments.read')
  @ApiZodQuery(availabilityQuery)
  availability(@Query(zp(availabilityQuery)) q: z.infer<typeof availabilityQuery>) {
    return this.appointments.availability(q);
  }

  @Get('appointments/:id')
  @RequirePermissions('appointments.read')
  get(@Param('id', UUID) id: string) {
    return this.appointments.get(id);
  }

  @Post('appointments')
  @RequirePermissions('appointments.write')
  @ApiZodBody(createAppointmentSchema)
  create(@Body(zp(createAppointmentSchema)) body: z.infer<typeof createAppointmentSchema>) {
    return this.appointments.create(body);
  }

  @Patch('appointments/:id')
  @RequirePermissions('appointments.write')
  @ApiZodBody(rescheduleAppointmentSchema)
  reschedule(@Param('id', UUID) id: string, @Body(zp(rescheduleAppointmentSchema)) body: z.infer<typeof rescheduleAppointmentSchema>) {
    return this.appointments.reschedule(id, body);
  }

  @Post('appointments/:id/status')
  @HttpCode(200)
  @RequireAnyPermission('appointments.write', 'appointments.checkin', 'clinical.write')
  @ApiZodBody(appointmentStatusActionSchema)
  transition(@Param('id', UUID) id: string, @Body(zp(appointmentStatusActionSchema)) body: z.infer<typeof appointmentStatusActionSchema>) {
    return this.appointments.transition(id, body.action, body.reason);
  }

  /** Calls a waiting patient to a room (waiting-room screen). */
  @Post('appointments/:id/call')
  @HttpCode(200)
  @RequireAnyPermission('appointments.checkin', 'clinical.write')
  @ApiZodBody(callPatientSchema)
  call(@Param('id', UUID) id: string, @Body(zp(callPatientSchema)) body: z.infer<typeof callPatientSchema>) {
    return this.appointments.call(id, body.room);
  }

  // ── Front desk ──
  @Get('front-desk/queue')
  @RequireAnyPermission('appointments.checkin', 'appointments.read')
  queue(@Query('branchId') branchId?: string) {
    const id = branchId && /^[0-9a-f-]{36}$/i.test(branchId) ? branchId : RequestContext.require().branchId!;
    return this.appointments.queue(id);
  }

  @Post('front-desk/walk-in')
  @RequirePermissions('appointments.checkin')
  @ApiZodBody(walkInSchema)
  walkIn(@Body(zp(walkInSchema)) body: z.infer<typeof walkInSchema>) {
    return this.appointments.walkIn(body);
  }

  @Post('triage')
  @RequirePermissions('triage.write')
  @ApiZodBody(triageSchema)
  triage(@Body(zp(triageSchema)) body: z.infer<typeof triageSchema>) {
    return this.frontDesk.triage(body);
  }

  @Get('patients/:id/triage')
  @RequireAnyPermission('clinical.read', 'triage.write')
  triageHistory(@Param('id', UUID) id: string) {
    return this.frontDesk.triageHistory(id);
  }

  @Get('waitlist')
  @RequirePermissions('appointments.read')
  waitlist(@Query('branchId') branchId?: string) {
    return this.frontDesk.listWaitlist(branchId && /^[0-9a-f-]{36}$/i.test(branchId) ? branchId : undefined);
  }

  @Post('waitlist')
  @RequirePermissions('appointments.write')
  @ApiZodBody(waitlistSchema)
  addWaitlist(@Body(zp(waitlistSchema)) body: z.infer<typeof waitlistSchema>) {
    return this.frontDesk.addToWaitlist(body);
  }

  @Post('waitlist/:id/close')
  @HttpCode(200)
  @RequirePermissions('appointments.write')
  closeWaitlist(@Param('id', UUID) id: string, @Body(zp(z.object({ status: z.enum(['BOOKED', 'REMOVED']) }))) body: { status: 'BOOKED' | 'REMOVED' }) {
    return this.frontDesk.closeWaitlist(id, body.status);
  }
}
