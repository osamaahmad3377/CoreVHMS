import { Module } from '@nestjs/common';
import { PatientMergeService } from './patient-merge.service';
import { PatientRecordService } from './patient-record.service';
import { PatientTimelineService } from './patient-timeline.service';
import { PatientsController } from './patients.controller';
import { PatientsService } from './patients.service';

@Module({
  controllers: [PatientsController],
  providers: [PatientsService, PatientMergeService, PatientTimelineService, PatientRecordService],
  exports: [PatientsService, PatientMergeService, PatientTimelineService, PatientRecordService],
})
export class PatientsModule {}
