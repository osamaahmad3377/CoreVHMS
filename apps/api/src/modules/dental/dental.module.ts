import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { ClientsModule } from '../clients/clients.module';
import { PatientsModule } from '../patients/patients.module';
import { DentalIntegrations } from './dental-integrations';
import { DentalController } from './dental.controller';
import { DentalService } from './dental.service';

@Module({
  imports: [BillingModule, PatientsModule, ClientsModule],
  controllers: [DentalController],
  providers: [DentalService, DentalIntegrations],
})
export class DentalModule {}
