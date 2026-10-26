import { Module } from '@nestjs/common';
import { CommsModule } from '../comms/comms.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { AutomationsController } from './automations.controller';
import { AutomationsService } from './automations.service';

/** The clinic's own workflows (Settings → Automations). */
@Module({
  imports: [CommsModule, IntegrationsModule],
  controllers: [AutomationsController],
  providers: [AutomationsService],
  exports: [AutomationsService],
})
export class AutomationsModule {}
