import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { dentalAddendumSchema, dentalChartCreateSchema, dentalChartListQuery, dentalChartUpdateSchema, dentalPricesSchema, dentalProcedureSchema, dentalTeethSchema } from '@vcms/shared';
import { z } from 'zod';
import { RequireAnyPermission, RequirePermissions } from '../../common/auth/decorators';
import { ApiZodBody, ApiZodQuery, zp } from '../../common/http/zod';
import { DentalService } from './dental.service';

const UUID = new ParseUUIDPipe();

/** Dental charts are clinical records: read, write and sign with the clinical permissions. */
@ApiTags('dental charts')
@Controller()
export class DentalController {
  constructor(private readonly dental: DentalService) {}

  @Get('dental/charts')
  @RequirePermissions('clinical.read')
  @ApiZodQuery(dentalChartListQuery)
  list(@Query(zp(dentalChartListQuery)) q: z.infer<typeof dentalChartListQuery>) {
    return this.dental.list(q);
  }

  @Get('patients/:id/dental')
  @RequirePermissions('clinical.read')
  forPatient(@Param('id', UUID) id: string) {
    return this.dental.forPatient(id);
  }

  @Post('dental/charts')
  @RequirePermissions('clinical.write')
  @ApiZodBody(dentalChartCreateSchema)
  create(@Body(zp(dentalChartCreateSchema)) body: z.infer<typeof dentalChartCreateSchema>) {
    return this.dental.create(body);
  }

  @Get('dental/charts/:id')
  @RequirePermissions('clinical.read')
  get(@Param('id', UUID) id: string) {
    return this.dental.get(id);
  }

  @Patch('dental/charts/:id')
  @RequirePermissions('clinical.write')
  @ApiZodBody(dentalChartUpdateSchema)
  update(@Param('id', UUID) id: string, @Body(zp(dentalChartUpdateSchema)) body: z.infer<typeof dentalChartUpdateSchema>) {
    return this.dental.update(id, body);
  }

  @Put('dental/charts/:id/teeth')
  @RequirePermissions('clinical.write')
  @ApiZodBody(dentalTeethSchema)
  teeth(@Param('id', UUID) id: string, @Body(zp(dentalTeethSchema)) body: z.infer<typeof dentalTeethSchema>) {
    return this.dental.saveTeeth(id, body.teeth);
  }

  @Post('dental/charts/:id/procedures')
  @HttpCode(200)
  @RequirePermissions('clinical.write')
  @ApiZodBody(dentalProcedureSchema)
  addProcedure(@Param('id', UUID) id: string, @Body(zp(dentalProcedureSchema)) body: z.infer<typeof dentalProcedureSchema>) {
    return this.dental.addProcedure(id, body);
  }

  @Delete('dental/charts/:id/procedures/:procedureId')
  @RequirePermissions('clinical.write')
  removeProcedure(@Param('id', UUID) id: string, @Param('procedureId', UUID) procedureId: string) {
    return this.dental.removeProcedure(id, procedureId);
  }

  @Post('dental/charts/:id/sign')
  @HttpCode(200)
  @RequirePermissions('clinical.sign')
  sign(@Param('id', UUID) id: string) {
    return this.dental.sign(id);
  }

  @Post('dental/charts/:id/addenda')
  @HttpCode(200)
  @RequireAnyPermission('clinical.amend', 'clinical.sign')
  @ApiZodBody(dentalAddendumSchema)
  addendum(@Param('id', UUID) id: string, @Body(zp(dentalAddendumSchema)) body: z.infer<typeof dentalAddendumSchema>) {
    return this.dental.addAddendum(id, body.text);
  }

  @Delete('dental/charts/:id')
  @RequirePermissions('clinical.write')
  discard(@Param('id', UUID) id: string) {
    return this.dental.discard(id);
  }

  @Get('dental/prices')
  @RequireAnyPermission('clinical.read', 'settings.manage')
  prices() {
    return this.dental.prices();
  }

  @Put('dental/prices')
  @RequirePermissions('settings.manage')
  @ApiZodBody(dentalPricesSchema)
  savePrices(@Body(zp(dentalPricesSchema)) body: z.infer<typeof dentalPricesSchema>) {
    return this.dental.savePrices(body);
  }
}
