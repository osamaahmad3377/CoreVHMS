import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  boardingLogSchema,
  boardingStaySchema,
  boardingUnitSchema,
  cancelSchema,
  checkInStaySchema,
  groomingJobSchema,
  groomingServiceSchema,
  groomingTransitionSchema,
  updateGroomingSchema,
  updateStaySchema,
} from '@vcms/shared';
import { z } from 'zod';
import { RequireAnyPermission, RequirePermissions } from '../../common/auth/decorators';
import { RequestContext } from '../../common/context/request-context';
import { ruleViolation } from '../../common/http/errors';
import { ApiZodBody, ApiZodQuery, zp } from '../../common/http/zod';
import { BoardingService } from './boarding.service';
import { GroomingService } from './grooming.service';

const UUID = new ParseUUIDPipe();
const stayQuery = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional(), status: z.string().max(100).optional(), branchId: z.string().uuid().optional(), patientId: z.string().uuid().optional() });
const branchOf = (branchId?: string) => {
  const id = branchId && /^[0-9a-f-]{36}$/i.test(branchId) ? branchId : RequestContext.require().branchId;
  if (!id) throw ruleViolation('NO_BRANCH', 'Select a branch first');
  return id;
};

@ApiTags('boarding & grooming')
@Controller()
export class BoardingController {
  constructor(
    private readonly boarding: BoardingService,
    private readonly grooming: GroomingService,
  ) {}

  // ── Units ──
  @Get('boarding/units')
  @RequireAnyPermission('boarding.read', 'settings.manage')
  units(@Query('branchId') branchId?: string, @Query('all') all?: string) {
    return this.boarding.units(branchId && /^[0-9a-f-]{36}$/i.test(branchId) ? branchId : undefined, all === 'true');
  }

  @Post('boarding/units')
  @RequirePermissions('settings.manage')
  @ApiZodBody(boardingUnitSchema)
  createUnit(@Body(zp(boardingUnitSchema)) body: z.infer<typeof boardingUnitSchema>) {
    return this.boarding.createUnit(body);
  }

  @Patch('boarding/units/:id')
  @RequirePermissions('settings.manage')
  updateUnit(@Param('id', UUID) id: string, @Body(zp(boardingUnitSchema.partial())) body: Partial<z.infer<typeof boardingUnitSchema>>) {
    return this.boarding.updateUnit(id, body);
  }

  @Get('boarding/availability')
  @RequirePermissions('boarding.read')
  availability(@Query(zp(z.object({ branchId: z.string().uuid().optional(), from: z.coerce.date(), to: z.coerce.date() }))) q: { branchId?: string; from: Date; to: Date }) {
    return this.boarding.availability(branchOf(q.branchId), q.from, q.to);
  }

  // ── Stays ──
  @Get('boarding/board')
  @RequirePermissions('boarding.read')
  board(@Query('branchId') branchId?: string) {
    return this.boarding.board(branchOf(branchId));
  }

  @Get('boarding/stays')
  @RequirePermissions('boarding.read')
  @ApiZodQuery(stayQuery)
  stays(@Query(zp(stayQuery)) q: z.infer<typeof stayQuery>) {
    return this.boarding.list(q);
  }

  @Post('boarding/stays')
  @RequirePermissions('boarding.write')
  @ApiZodBody(boardingStaySchema)
  reserve(@Body(zp(boardingStaySchema)) body: z.infer<typeof boardingStaySchema>) {
    return this.boarding.create(body);
  }

  @Get('boarding/stays/:id')
  @RequirePermissions('boarding.read')
  stay(@Param('id', UUID) id: string) {
    return this.boarding.get(id);
  }

  @Patch('boarding/stays/:id')
  @RequirePermissions('boarding.write')
  updateStay(@Param('id', UUID) id: string, @Body(zp(updateStaySchema)) body: z.infer<typeof updateStaySchema>) {
    return this.boarding.update(id, body);
  }

  @Post('boarding/stays/:id/check-in')
  @HttpCode(200)
  @RequirePermissions('boarding.write')
  checkIn(@Param('id', UUID) id: string, @Body(zp(checkInStaySchema)) body: z.infer<typeof checkInStaySchema>) {
    return this.boarding.checkIn(id, body);
  }

  @Post('boarding/stays/:id/check-out')
  @HttpCode(200)
  @RequirePermissions('boarding.write')
  checkOut(@Param('id', UUID) id: string) {
    return this.boarding.checkOut(id);
  }

  @Post('boarding/stays/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('boarding.write')
  cancel(@Param('id', UUID) id: string, @Body(zp(cancelSchema)) body: { reason: string }) {
    return this.boarding.cancel(id, body.reason);
  }

  @Post('boarding/stays/:id/no-show')
  @HttpCode(200)
  @RequirePermissions('boarding.write')
  noShow(@Param('id', UUID) id: string) {
    return this.boarding.cancel(id, 'Did not arrive', true);
  }

  @Post('boarding/stays/:id/logs')
  @RequirePermissions('boarding.write')
  log(@Param('id', UUID) id: string, @Body(zp(boardingLogSchema)) body: z.infer<typeof boardingLogSchema>) {
    return this.boarding.addLog(id, body.kind, body.text);
  }

  // ── Grooming ──
  @Get('grooming/board')
  @RequirePermissions('boarding.read')
  groomingBoard(@Query('branchId') branchId?: string, @Query('date') date?: string) {
    return this.grooming.board(branchOf(branchId), date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined);
  }

  @Get('grooming/jobs')
  @RequirePermissions('boarding.read')
  jobs(@Query(zp(z.object({ patientId: z.string().uuid().optional(), clientId: z.string().uuid().optional() }))) q: { patientId?: string; clientId?: string }) {
    return this.grooming.list(q);
  }

  @Post('grooming/jobs')
  @RequirePermissions('boarding.write')
  @ApiZodBody(groomingJobSchema)
  createJob(@Body(zp(groomingJobSchema)) body: z.infer<typeof groomingJobSchema>) {
    return this.grooming.create(body);
  }

  @Get('grooming/jobs/:id')
  @RequirePermissions('boarding.read')
  job(@Param('id', UUID) id: string) {
    return this.grooming.get(id);
  }

  @Patch('grooming/jobs/:id')
  @RequirePermissions('boarding.write')
  updateJob(@Param('id', UUID) id: string, @Body(zp(updateGroomingSchema)) body: z.infer<typeof updateGroomingSchema>) {
    return this.grooming.update(id, body);
  }

  @Post('grooming/jobs/:id/services')
  @RequirePermissions('boarding.write')
  addService(@Param('id', UUID) id: string, @Body(zp(groomingServiceSchema)) body: z.infer<typeof groomingServiceSchema>) {
    return this.grooming.addService(id, body.serviceId, body.priceMinor);
  }

  @Delete('grooming/jobs/:id/services/:lineId')
  @RequirePermissions('boarding.write')
  removeService(@Param('id', UUID) id: string, @Param('lineId', UUID) lineId: string) {
    return this.grooming.removeService(id, lineId);
  }

  @Post('grooming/jobs/:id/transition')
  @HttpCode(200)
  @RequirePermissions('boarding.write')
  transition(@Param('id', UUID) id: string, @Body(zp(groomingTransitionSchema)) body: z.infer<typeof groomingTransitionSchema>) {
    return this.grooming.transition(id, body.action, body.reason);
  }
}
