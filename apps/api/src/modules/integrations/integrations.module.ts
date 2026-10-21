import { Module } from '@nestjs/common';
import { WhatsAppController, WhatsAppWebhookController } from './whatsapp.controller';
import { WhatsAppService } from './whatsapp.service';

/** Connections to outside services a clinic sets up itself (Settings → Integrations). */
@Module({
  controllers: [WhatsAppController, WhatsAppWebhookController],
  providers: [WhatsAppService],
  exports: [WhatsAppService],
})
export class IntegrationsModule {}
