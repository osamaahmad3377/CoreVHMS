import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { HostInfoController, PlatformBillingController, PlatformClinicsController, PlatformPlanRequestsController, PlatformPlansController } from './platform.controller';
import { PlatformBillingService } from './platform-billing.service';
import { PlatformClinicsService } from './platform-clinics.service';
import { PlatformPlansService } from './platform-plans.service';

@Module({
  imports: [AuthModule, OrganizationsModule],
  controllers: [PlatformClinicsController, PlatformBillingController, PlatformPlansController, PlatformPlanRequestsController, HostInfoController],
  providers: [PlatformClinicsService, PlatformPlansService, PlatformBillingService],
  exports: [PlatformClinicsService, PlatformPlansService],
})
export class PlatformModule {}
