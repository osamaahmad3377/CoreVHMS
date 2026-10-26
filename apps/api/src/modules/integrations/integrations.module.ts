import { Module } from '@nestjs/common';
import { EmailIntegrationController, EmailOAuthController } from './email-integration.controller';
import { EmailIntegrationService } from './email-integration.service';
import { WhatsAppController, WhatsAppWebhookController } from './whatsapp.controller';
import { WhatsAppService } from './whatsapp.service';

/** Connections to outside services a clinic sets up itself (Settings → Integrations). */
@Module({
  controllers: [WhatsAppController, WhatsAppWebhookController, EmailIntegrationController, EmailOAuthController],
  providers: [WhatsAppService, EmailIntegrationService],
  exports: [WhatsAppService, EmailIntegrationService],
})
export class IntegrationsModule {}
