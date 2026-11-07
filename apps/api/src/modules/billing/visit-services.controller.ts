import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SERVICE_CATEGORIES } from '@vcms/shared';
import { z } from 'zod';
import { RequirePermissions } from '../../common/auth/decorators';
import { zp } from '../../common/http/zod';
import { VisitServicesService } from './visit-services.service';

const UUID = new ParseUUIDPipe();
const listQuery = z.object({ category: z.enum(SERVICE_CATEGORIES) });
const addBody = z.object({ serviceId: z.string().uuid() });

/** Services done during a consultation (e.g. grooming) and charged with it. */
@ApiTags('clinical')
@Controller('encounters/:id/services')
export class VisitServicesController {
  constructor(private readonly visitServices: VisitServicesService) {}

  @Get()
  @RequirePermissions('clinical.read')
  list(@Param('id', UUID) id: string, @Query(zp(listQuery)) q: z.infer<typeof listQuery>) {
    return this.visitServices.list(id, q.category);
  }

  @Post()
  @RequirePermissions('clinical.write')
  add(@Param('id', UUID) id: string, @Body(zp(addBody)) body: z.infer<typeof addBody>) {
    return this.visitServices.add(id, body.serviceId);
  }

  @Delete(':chargeId')
  @RequirePermissions('clinical.write')
  remove(@Param('id', UUID) id: string, @Param('chargeId', UUID) chargeId: string) {
    return this.visitServices.remove(id, chargeId);
  }
}
