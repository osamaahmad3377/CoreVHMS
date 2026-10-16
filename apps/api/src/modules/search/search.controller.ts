import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequireAnyPermission } from '../../common/auth/decorators';
import { RequestContext } from '../../common/context/request-context';
import { zp } from '../../common/http/zod';
import { SearchService } from './search.service';

const searchQuery = z.object({ q: z.string().trim().min(2).max(100) });

@ApiTags('search')
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  @RequireAnyPermission('clients.read', 'patients.read', 'appointments.read', 'billing.read')
  run(@Query(zp(searchQuery)) q: z.infer<typeof searchQuery>) {
    return this.search.search(q.q, RequestContext.require().permissions);
  }
}
