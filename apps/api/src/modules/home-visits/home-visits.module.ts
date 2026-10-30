import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { ClinicalModule } from '../clinical/clinical.module';
import { HomeVisitsController } from './home-visits.controller';
import { HomeVisitsService } from './home-visits.service';

@Module({
  imports: [BillingModule, ClinicalModule],
  controllers: [HomeVisitsController],
  providers: [HomeVisitsService],
})
export class HomeVisitsModule {}
