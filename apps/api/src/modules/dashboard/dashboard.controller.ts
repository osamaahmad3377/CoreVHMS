import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequirePermissions } from '../../common/auth/decorators';
import { ApiZodQuery, zp } from '../../common/http/zod';
import { DashboardService } from './dashboard.service';

const dashboardQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  branchId: z.string().uuid().optional(),
});

@ApiTags('dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  @RequirePermissions('dashboard.view')
  @ApiZodQuery(dashboardQuery)
  get(@Query(zp(dashboardQuery)) q: z.infer<typeof dashboardQuery>) {
    const to = q.to ?? new Date();
    const from = q.from ?? new Date(to.getTime() - 30 * 86400_000);
    return this.dashboard.load({ from, to, branchId: q.branchId });
  }
}
