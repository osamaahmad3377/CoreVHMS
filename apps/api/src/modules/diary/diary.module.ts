import { Module } from '@nestjs/common';
import { AttachmentsModule } from '../attachments/attachments.module';
import { AutomationsModule } from '../automations/automations.module';
import { ClientsModule } from '../clients/clients.module';
import { CommsModule } from '../comms/comms.module';
import { PatientsModule } from '../patients/patients.module';
import { DiaryController, DiarySettingsController, PublicDiaryController } from './diary.controller';
import { DiaryAutomationsService } from './diary-automations.service';
import { DiaryIntegrations } from './diary-integrations';
import { DiarySettingsService } from './diary-settings.service';
import { DiarySharingService } from './diary-sharing.service';
import { HistorySummaryService } from './history-summary.service';
import { DiaryService } from './diary.service';

@Module({
  imports: [PatientsModule, ClientsModule, CommsModule, AttachmentsModule, AutomationsModule],
  controllers: [DiaryController, DiarySettingsController, PublicDiaryController],
  providers: [DiaryService, DiarySettingsService, DiarySharingService, DiaryAutomationsService, HistorySummaryService, DiaryIntegrations],
})
export class DiaryModule {}
