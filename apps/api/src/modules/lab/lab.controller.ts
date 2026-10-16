import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  amendResultSchema,
  collectSampleSchema,
  createOrderSchema,
  enterResultsSchema,
  imagingReportSchema,
  labTestSchema,
  orderListQuery,
  referenceIntervalSchema,
  sampleActionSchema,
} from '@vcms/shared';
import { z } from 'zod';
import { RequireAnyPermission, RequirePermissions } from '../../common/auth/decorators';
import { ApiZodBody, ApiZodQuery, zp } from '../../common/http/zod';
import { DiagnosticOrdersService } from './diagnostic-orders.service';
import { LabCatalogService } from './lab-catalog.service';

const UUID = new ParseUUIDPipe();

@ApiTags('laboratory')
@Controller()
export class LabController {
  constructor(
    private readonly catalog: LabCatalogService,
    private readonly orders: DiagnosticOrdersService,
  ) {}

  // ── Catalogue ──
  @Get('lab-tests')
  @RequireAnyPermission('lab.read', 'lab.order', 'settings.manage')
  tests(@Query('all') all?: string, @Query('q') q?: string) {
    return this.catalog.list(all === 'true', q?.slice(0, 80));
  }

  @Get('lab-tests/:id')
  @RequireAnyPermission('lab.read', 'settings.manage')
  test(@Param('id', UUID) id: string) {
    return this.catalog.get(id);
  }

  @Post('lab-tests')
  @RequirePermissions('settings.manage')
  @ApiZodBody(labTestSchema)
  createTest(@Body(zp(labTestSchema)) body: z.infer<typeof labTestSchema>) {
    return this.catalog.create(body);
  }

  @Patch('lab-tests/:id')
  @RequirePermissions('settings.manage')
  updateTest(@Param('id', UUID) id: string, @Body(zp(labTestSchema.partial())) body: Partial<z.infer<typeof labTestSchema>>) {
    return this.catalog.update(id, body);
  }

  @Post('reference-intervals')
  @RequireAnyPermission('settings.manage', 'lab.approve')
  @ApiZodBody(referenceIntervalSchema)
  addInterval(@Body(zp(referenceIntervalSchema)) body: z.infer<typeof referenceIntervalSchema>) {
    return this.catalog.addInterval(body);
  }

  @Delete('reference-intervals/:id')
  @HttpCode(204)
  @RequireAnyPermission('settings.manage', 'lab.approve')
  removeInterval(@Param('id', UUID) id: string) {
    return this.catalog.removeInterval(id);
  }

  // ── Orders ──
  @Get('lab-orders')
  @RequirePermissions('lab.read')
  @ApiZodQuery(orderListQuery)
  list(@Query(zp(orderListQuery)) q: z.infer<typeof orderListQuery>) {
    return this.orders.list(q);
  }

  @Get('lab-orders/:id')
  @RequirePermissions('lab.read')
  get(@Param('id', UUID) id: string) {
    return this.orders.get(id);
  }

  @Post('lab-orders')
  @RequirePermissions('lab.order')
  @ApiZodBody(createOrderSchema)
  create(@Body(zp(createOrderSchema)) body: z.infer<typeof createOrderSchema>) {
    return this.orders.create(body);
  }

  @Post('lab-orders/:id/samples')
  @RequirePermissions('lab.result')
  @ApiZodBody(collectSampleSchema)
  collect(@Param('id', UUID) id: string, @Body(zp(collectSampleSchema)) body: z.infer<typeof collectSampleSchema>) {
    return this.orders.collectSample(id, body);
  }

  @Post('lab-samples/:id/events')
  @HttpCode(200)
  @RequirePermissions('lab.result')
  @ApiZodBody(sampleActionSchema)
  sampleEvent(@Param('id', UUID) id: string, @Body(zp(sampleActionSchema)) body: z.infer<typeof sampleActionSchema>) {
    return this.orders.sampleAction(id, body);
  }

  @Put('lab-orders/:id/results')
  @RequirePermissions('lab.result')
  @ApiZodBody(enterResultsSchema)
  results(@Param('id', UUID) id: string, @Body(zp(enterResultsSchema)) body: z.infer<typeof enterResultsSchema>) {
    return this.orders.enterResults(id, body);
  }

  @Put('lab-orders/:id/items/:itemId/imaging-report')
  @RequirePermissions('lab.result')
  @ApiZodBody(imagingReportSchema)
  imaging(@Param('id', UUID) id: string, @Param('itemId', UUID) itemId: string, @Body(zp(imagingReportSchema)) body: z.infer<typeof imagingReportSchema>) {
    return this.orders.saveImagingReport(id, itemId, body);
  }

  @Post('lab-orders/:id/release')
  @HttpCode(200)
  @RequirePermissions('lab.approve')
  release(@Param('id', UUID) id: string) {
    return this.orders.release(id);
  }

  @Post('lab-results/:id/amend')
  @RequirePermissions('lab.approve')
  @ApiZodBody(amendResultSchema)
  amend(@Param('id', UUID) id: string, @Body(zp(amendResultSchema)) body: z.infer<typeof amendResultSchema>) {
    return this.orders.amendResult(id, body);
  }

  @Post('lab-orders/:id/cancel')
  @HttpCode(200)
  @RequireAnyPermission('lab.order', 'lab.approve')
  cancel(@Param('id', UUID) id: string, @Body(zp(z.object({ reason: z.string().trim().min(1).max(500) }))) body: { reason: string }) {
    return this.orders.cancel(id, body.reason);
  }
}
