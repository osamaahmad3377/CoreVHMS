import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequireAnyPermission } from '../../common/auth/decorators';
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
}
