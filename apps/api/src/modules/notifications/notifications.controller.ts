import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequirePermissions } from '../../common/auth/decorators';
import { ApiZodBody, ApiZodQuery, zp } from '../../common/http/zod';
import { NotificationsService } from './notifications.service';

const listQuery = z.object({
  branchId: z.string().uuid().optional(),
  unread: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
const readBody = z.object({ ids: z.array(z.string().uuid()).max(100).optional(), branchId: z.string().uuid().optional() });

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @RequirePermissions('appointments.read')
  @ApiZodQuery(listQuery)
  list(@Query(zp(listQuery)) q: z.infer<typeof listQuery>) {
    return this.notifications.list(q);
  }

  @Post('read')
  @HttpCode(200)
  @RequirePermissions('appointments.read')
  @ApiZodBody(readBody)
  read(@Body(zp(readBody)) body: z.infer<typeof readBody>) {
    return this.notifications.markRead(body);
  }
}
