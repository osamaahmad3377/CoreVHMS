import { Module } from '@nestjs/common';
import { ClientsModule } from '../clients/clients.module';
import { PatientsModule } from '../patients/patients.module';
import { DiagnosticOrdersService } from './diagnostic-orders.service';
import { LabCatalogService } from './lab-catalog.service';
import { LabController } from './lab.controller';
import { LabIntegrations } from './lab-integrations';

@Module({
  imports: [PatientsModule, ClientsModule],
  controllers: [LabController],
  providers: [LabCatalogService, DiagnosticOrdersService, LabIntegrations],
  exports: [DiagnosticOrdersService, LabCatalogService],
})
export class LabModule {}
