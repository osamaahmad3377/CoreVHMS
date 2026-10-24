import { Module } from '@nestjs/common';
import { ClientsModule } from '../clients/clients.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { PatientsModule } from '../patients/patients.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { OnlineBookingSettingsController, PublicBookingController } from './online-booking.controller';
import { OnlineBookingIntegrations } from './online-booking.integrations';
import { OnlineBookingService } from './online-booking.service';

/** The public online booking page and its settings. */
@Module({
  imports: [SchedulingModule, ClientsModule, PatientsModule, OrganizationsModule],
  controllers: [OnlineBookingSettingsController, PublicBookingController],
  providers: [OnlineBookingService, OnlineBookingIntegrations],
})
export class OnlineBookingModule {}
