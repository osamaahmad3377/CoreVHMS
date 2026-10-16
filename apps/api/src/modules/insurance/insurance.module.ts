import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { ClientsModule } from '../clients/clients.module';
import { CommsModule } from '../comms/comms.module';
import { PatientsModule } from '../patients/patients.module';
import { ClinicalSummaryService } from './clinical-summary.service';
import { InsuranceController } from './insurance.controller';
import { InsuranceIntegrations } from './insurance-integrations';
import { InsuranceService } from './insurance.service';
import { ReferralsService } from './referrals.service';

@Module({
  imports: [BillingModule, CommsModule, PatientsModule, ClientsModule],
  controllers: [InsuranceController],
  providers: [InsuranceService, ReferralsService, ClinicalSummaryService, InsuranceIntegrations],
})
export class InsuranceModule {}
