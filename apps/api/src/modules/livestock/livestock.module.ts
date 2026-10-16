import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { ClientsModule } from '../clients/clients.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PatientsModule } from '../patients/patients.module';
import { PharmacyModule } from '../pharmacy/pharmacy.module';
import { BreedingService } from './breeding.service';
import { FarmsService } from './farms.service';
import { FieldVisitsService } from './field-visits.service';
import { HerdHealthService } from './herd-health.service';
import { LivestockController } from './livestock.controller';
import { LivestockIntegrations } from './livestock-integrations';
import { ProductionService } from './production.service';

@Module({
  imports: [BillingModule, InventoryModule, PharmacyModule, PatientsModule, ClientsModule],
  controllers: [LivestockController],
  providers: [FarmsService, BreedingService, ProductionService, HerdHealthService, FieldVisitsService, LivestockIntegrations],
  exports: [FarmsService, BreedingService],
})
export class LivestockModule {}
