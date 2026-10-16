import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { ClientsModule } from '../clients/clients.module';
import { ClinicalModule } from '../clinical/clinical.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PatientsModule } from '../patients/patients.module';
import { PharmacyModule } from '../pharmacy/pharmacy.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { AdmissionsService } from './admissions.service';
import { HospitalController } from './hospital.controller';
import { HospitalIntegrations } from './hospital-integrations';
import { SurgeryService } from './surgery.service';
import { TreatmentsService } from './treatments.service';
import { WardsService } from './wards.service';

@Module({
  imports: [BillingModule, PharmacyModule, ClinicalModule, InventoryModule, SchedulingModule, PatientsModule, ClientsModule],
  controllers: [HospitalController],
  providers: [WardsService, AdmissionsService, TreatmentsService, SurgeryService, HospitalIntegrations],
  exports: [AdmissionsService],
})
export class HospitalModule {}
