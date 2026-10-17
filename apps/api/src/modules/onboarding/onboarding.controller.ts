import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { clinicModulesSchema, type ClinicModulesInput } from '@vcms/shared';
import { RequireAnyPermission } from '../../common/auth/decorators';
import { ApiZodBody, zp } from '../../common/http/zod';
import { OnboardingService } from './onboarding.service';

@ApiTags('onboarding')
@Controller('setup')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get('status')
  @RequireAnyPermission('org.manage', 'settings.manage')
  status() {
    return this.onboarding.status();
  }

  @Post('steps/:key/skip')
  @HttpCode(200)
  @RequireAnyPermission('org.manage', 'settings.manage')
  skip(@Param('key') key: string) {
    return this.onboarding.skip(key);
  }

  @Post('hide')
  @HttpCode(200)
  @RequireAnyPermission('org.manage', 'settings.manage')
  hide() {
    return this.onboarding.hide();
  }

  @Post('show')
  @HttpCode(200)
  @RequireAnyPermission('org.manage', 'settings.manage')
  show() {
    return this.onboarding.show();
  }

  /** Same permissions as creating a stock location by hand. */
  @Post('store-room')
  @HttpCode(200)
  @RequireAnyPermission('settings.manage', 'inventory.write')
  storeRoom() {
    return this.onboarding.ensureStoreRoom();
  }

  @Get('modules')
  @RequireAnyPermission('org.manage', 'settings.manage')
  modules() {
    return this.onboarding.modules();
  }

  @Put('modules')
  @RequireAnyPermission('org.manage', 'settings.manage')
  @ApiZodBody(clinicModulesSchema)
  setModules(@Body(zp(clinicModulesSchema)) body: ClinicModulesInput) {
    return this.onboarding.setModules(body.enabled);
  }
}
