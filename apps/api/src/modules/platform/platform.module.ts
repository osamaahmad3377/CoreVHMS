import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { HostInfoController, PlatformClinicsController } from './platform.controller';
import { PlatformClinicsService } from './platform-clinics.service';

@Module({
  imports: [AuthModule, OrganizationsModule],
  controllers: [PlatformClinicsController, HostInfoController],
  providers: [PlatformClinicsService],
  exports: [PlatformClinicsService],
})
export class PlatformModule {}
