import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { inviteUserSchema, updateMembershipSchema } from '@vcms/shared';
import { z } from 'zod';
import { RequireAnyPermission, RequirePermissions } from '../../common/auth/decorators';
import { ApiZodBody, zp } from '../../common/http/zod';
import { UsersService } from './users.service';

@ApiTags('staff')
@Controller('staff')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions('users.read')
  list(@Query('q') q?: string) {
    return this.users.list(q?.slice(0, 100));
  }

  @Get('clinicians')
  @RequireAnyPermission('appointments.read', 'clinical.read', 'staff.read')
  clinicians(@Query('branchId') branchId?: string) {
    return this.users.clinicians(branchId && /^[0-9a-f-]{36}$/i.test(branchId) ? branchId : undefined);
  }

  @Get(':id')
  @RequirePermissions('users.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.get(id);
  }

  @Post('invite')
  @RequirePermissions('users.manage')
  @ApiZodBody(inviteUserSchema)
  invite(@Body(zp(inviteUserSchema)) body: z.infer<typeof inviteUserSchema>) {
    return this.users.invite(body);
  }

  /** Adds a staff member with a system-generated temporary password (shown once) instead of an email invitation. */
  @Post('with-temporary-password')
  @RequirePermissions('users.manage')
  @ApiZodBody(inviteUserSchema)
  createWithPassword(@Body(zp(inviteUserSchema)) body: z.infer<typeof inviteUserSchema>) {
    return this.users.createWithTemporaryPassword(body);
  }

  @Post(':id/temporary-password')
  @HttpCode(200)
  @RequirePermissions('users.manage')
  temporaryPassword(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.issueTemporaryPassword(id);
  }

  @Post(':id/resend-invite')
  @HttpCode(204)
  @RequirePermissions('users.manage')
  resend(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.resendInvite(id);
  }

  @Patch(':id')
  @RequirePermissions('users.manage')
  @ApiZodBody(updateMembershipSchema)
  update(@Param('id', ParseUUIDPipe) id: string, @Body(zp(updateMembershipSchema)) body: z.infer<typeof updateMembershipSchema>) {
    return this.users.update(id, body);
  }
}
