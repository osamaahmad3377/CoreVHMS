import { Module } from '@nestjs/common';
import { ClientMergeService } from './client-merge.service';
import { ClientPrivacyService } from './client-privacy.service';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';

@Module({
  controllers: [ClientsController],
  providers: [ClientsService, ClientMergeService, ClientPrivacyService],
  exports: [ClientsService, ClientMergeService, ClientPrivacyService],
})
export class ClientsModule {}
