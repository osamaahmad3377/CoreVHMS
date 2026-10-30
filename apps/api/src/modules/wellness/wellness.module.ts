import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { ClientsModule } from '../clients/clients.module';
import { PatientsModule } from '../patients/patients.module';
import { WellnessIntegrations } from './wellness-integrations';
import { WellnessController } from './wellness.controller';
import { WellnessService } from './wellness.service';

@Module({
  imports: [BillingModule, PatientsModule, ClientsModule],
  controllers: [WellnessController],
  providers: [WellnessService, WellnessIntegrations],
  exports: [WellnessService],
})
export class WellnessModule {}
