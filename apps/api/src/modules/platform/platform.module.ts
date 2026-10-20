import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { HostInfoController, PlatformClinicsController, PlatformPlansController } from './platform.controller';
import { PlatformClinicsService } from './platform-clinics.service';
import { PlatformPlansService } from './platform-plans.service';

@Module({
  imports: [AuthModule, OrganizationsModule],
  controllers: [PlatformClinicsController, PlatformPlansController, HostInfoController],
  providers: [PlatformClinicsService, PlatformPlansService],
  exports: [PlatformClinicsService, PlatformPlansService],
})
export class PlatformModule {}
