import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { ClientsModule } from '../clients/clients.module';
import { CommsModule } from '../comms/comms.module';
import { PreventiveModule } from '../preventive/preventive.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { PortalAdminController } from './portal-admin.controller';
import { PortalAuthService } from './portal-auth.service';
import { PortalController } from './portal.controller';
import { PortalGuard } from './portal.guard';
import { PortalService } from './portal.service';

@Module({
  imports: [CommsModule, PreventiveModule, BillingModule, SchedulingModule, ClientsModule],
  controllers: [PortalController, PortalAdminController],
  providers: [PortalAuthService, PortalService, PortalGuard],
})
export class PortalModule {}
