import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { ClientsModule } from '../clients/clients.module';
import { ClinicalModule } from '../clinical/clinical.module';
import { PatientsModule } from '../patients/patients.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { DentalIntegrations } from './dental-integrations';
import { DentalController } from './dental.controller';
import { DentalService } from './dental.service';

@Module({
  imports: [BillingModule, PatientsModule, ClientsModule, SchedulingModule, ClinicalModule],
  controllers: [DentalController],
  providers: [DentalService, DentalIntegrations],
})
export class DentalModule {}
