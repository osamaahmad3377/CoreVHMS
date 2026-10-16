import { Module } from '@nestjs/common';
import { ClientsModule } from '../clients/clients.module';
import { ClinicalModule } from '../clinical/clinical.module';
import { AppointmentsService } from './appointments.service';
import { FrontDeskService } from './front-desk.service';
import { ScheduleConfigService } from './schedule-config.service';
import { SchedulingIntegrations } from './scheduling-integrations';
import { SchedulingController } from './scheduling.controller';

@Module({
  imports: [ClinicalModule, ClientsModule],
  controllers: [SchedulingController],
  providers: [ScheduleConfigService, AppointmentsService, FrontDeskService, SchedulingIntegrations],
  exports: [AppointmentsService],
})
export class SchedulingModule {}
