import { Module } from '@nestjs/common';
import { ClientsModule } from '../clients/clients.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { ChannelRegistry } from './channels';
import { ClientMessagesService } from './client-messages.service';
import { CommsController } from './comms.controller';
import { CommsIntegrations } from './comms-integrations';
import { MessagesService } from './messages.service';
import { RemindersService } from './reminders.service';
import { TemplatesService } from './templates.service';

@Module({
  imports: [ClientsModule, IntegrationsModule],
  controllers: [CommsController],
  providers: [ChannelRegistry, TemplatesService, MessagesService, RemindersService, ClientMessagesService, CommsIntegrations],
  exports: [MessagesService, TemplatesService, ChannelRegistry, ClientMessagesService],
})
export class CommsModule {}
