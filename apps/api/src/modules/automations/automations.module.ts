import { Module } from '@nestjs/common';
import { CommsModule } from '../comms/comms.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { AutomationsController, PublicMarketingController } from './automations.controller';
import { MarketingOptOutService } from './marketing-optout.service';
import { AutomationsService } from './automations.service';

/** The clinic's own workflows (Settings → Automations). */
@Module({
  imports: [CommsModule, IntegrationsModule],
  controllers: [AutomationsController, PublicMarketingController],
  providers: [AutomationsService, MarketingOptOutService],
  exports: [AutomationsService],
})
export class AutomationsModule {}
