import { Module } from '@nestjs/common';
import { ClientsModule } from '../clients/clients.module';
import { PatientsModule } from '../patients/patients.module';
import { ClinicalController } from './clinical.controller';
import { ClinicalIntegrations } from './clinical-integrations';
import { ClinicalRecordsService } from './clinical-records.service';
import { EncountersService } from './encounters.service';
import { NotesService } from './notes.service';

@Module({
  imports: [PatientsModule, ClientsModule],
  controllers: [ClinicalController],
  providers: [EncountersService, NotesService, ClinicalRecordsService, ClinicalIntegrations],
  exports: [EncountersService, NotesService, ClinicalRecordsService],
})
export class ClinicalModule {}
