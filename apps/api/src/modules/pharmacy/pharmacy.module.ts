import { Module } from '@nestjs/common';
import { ClientsModule } from '../clients/clients.module';
import { PatientsModule } from '../patients/patients.module';
import { AdministrationsService } from './administrations.service';
import { FormularyService } from './formulary.service';
import { PharmacyController } from './pharmacy.controller';
import { ProductCategoriesService } from './product-categories.service';
import { PharmacyIntegrations } from './pharmacy-integrations';
import { PrescriptionsService } from './prescriptions.service';
import { WithdrawalService } from './withdrawal.service';

@Module({
  imports: [PatientsModule, ClientsModule],
  controllers: [PharmacyController],
  providers: [FormularyService, PrescriptionsService, AdministrationsService, WithdrawalService, ProductCategoriesService, PharmacyIntegrations],
  exports: [FormularyService, PrescriptionsService, AdministrationsService, WithdrawalService],
})
export class PharmacyModule {}
