import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { ClientsModule } from '../clients/clients.module';
import { PatientsModule } from '../patients/patients.module';
import { BoardingController } from './boarding.controller';
import { BoardingIntegrations } from './boarding-integrations';
import { BoardingService } from './boarding.service';
import { GroomingService } from './grooming.service';

@Module({
  imports: [BillingModule, PatientsModule, ClientsModule],
  controllers: [BoardingController],
  providers: [BoardingService, GroomingService, BoardingIntegrations],
})
export class BoardingModule {}
