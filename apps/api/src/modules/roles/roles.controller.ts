import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { roleSchema, roleUpdateSchema } from '@vcms/shared';
import { z } from 'zod';
import { RequireAnyPermission, RequirePermissions } from '../../common/auth/decorators';
import { ApiZodBody, zp } from '../../common/http/zod';
import { RolesService } from './roles.service';

@ApiTags('roles')
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get('permissions')
  @RequireAnyPermission('roles.manage', 'users.read')
  catalogue() {
    return this.roles.catalogue();
  }

  @Get()
  @RequireAnyPermission('roles.manage', 'users.read')
  list() {
    return this.roles.list();
  }

  @Post()
  @RequirePermissions('roles.manage')
  @ApiZodBody(roleSchema)
  create(@Body(zp(roleSchema)) body: z.infer<typeof roleSchema>) {
    return this.roles.create(body);
  }

  @Patch(':id')
  @RequirePermissions('roles.manage')
  @ApiZodBody(roleUpdateSchema)
  update(@Param('id', ParseUUIDPipe) id: string, @Body(zp(roleUpdateSchema)) body: z.infer<typeof roleUpdateSchema>) {
    return this.roles.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('roles.manage')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.roles.remove(id);
  }
}
