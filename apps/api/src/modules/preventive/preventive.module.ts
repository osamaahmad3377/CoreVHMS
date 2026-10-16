import { Module } from '@nestjs/common';
import { ClientsModule } from '../clients/clients.module';
import { CommsModule } from '../comms/comms.module';
import { PatientsModule } from '../patients/patients.module';
import { PharmacyModule } from '../pharmacy/pharmacy.module';
import { CareService } from './care.service';
import { PreventiveIntegrations } from './preventive-integrations';
import { PreventiveController } from './preventive.controller';

@Module({
  imports: [PharmacyModule, PatientsModule, CommsModule, ClientsModule],
  controllers: [PreventiveController],
  providers: [CareService, PreventiveIntegrations],
  exports: [CareService],
})
export class PreventiveModule {}
