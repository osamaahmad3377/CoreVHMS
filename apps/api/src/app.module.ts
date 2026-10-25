import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { SessionAwareThrottlerGuard } from './common/http/throttler.guard';
import { AuditModule } from './common/audit/audit.module';
import { AuthGuard } from './common/auth/auth.guard';
import { CounterModule } from './common/counter/counter.module';
import { MailModule } from './common/mail/mail.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { StorageModule } from './common/storage/storage.module';
import { TenancyModule } from './common/tenancy/tenancy.module';
import { PlatformModule } from './modules/platform/platform.module';
import { AttachmentsModule } from './modules/attachments/attachments.module';
import { AuditLogModule } from './modules/audit-log/audit-log.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { ClinicalModule } from './modules/clinical/clinical.module';
import { SchedulingModule } from './modules/scheduling/scheduling.module';
import { PharmacyModule } from './modules/pharmacy/pharmacy.module';
import { LabModule } from './modules/lab/lab.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { BillingModule } from './modules/billing/billing.module';
import { ClientEventsModule } from './common/events/client-events';
import { WaitingRoomModule } from './modules/waiting-room/waiting-room.module';
import { OnlineBookingModule } from './modules/online-booking/online-booking.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { CommsModule } from './modules/comms/comms.module';
import { PortalModule } from './modules/portal/portal.module';
import { PreventiveModule } from './modules/preventive/preventive.module';
import { HospitalModule } from './modules/hospital/hospital.module';
import { LivestockModule } from './modules/livestock/livestock.module';
import { BoardingModule } from './modules/boarding/boarding.module';
import { InsuranceModule } from './modules/insurance/insurance.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { ReportsModule } from './modules/reports/reports.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { ClientsModule } from './modules/clients/clients.module';
import { PatientsModule } from './modules/patients/patients.module';
import { SearchModule } from './modules/search/search.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthController } from './modules/health/health.controller';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { RolesModule } from './modules/roles/roles.module';
import { UsersModule } from './modules/users/users.module';
import { env } from './config/env';

@Module({
  imports: [
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 1200 }],
      skipIf: () => process.env.NODE_ENV === 'test',
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    ClientEventsModule,
    TenancyModule,
    AuditModule,
    CounterModule,
    MailModule,
    StorageModule,
    AuthModule,
    OrganizationsModule,
    UsersModule,
    RolesModule,
    AuditLogModule,
    AttachmentsModule,
    CatalogModule,
    ClientsModule,
    PatientsModule,
    SearchModule,
    DashboardModule,
    ClinicalModule,
    SchedulingModule,
    PharmacyModule,
    LabModule,
    InventoryModule,
    BillingModule,
    ReportsModule,
    HospitalModule,
    IntegrationsModule,
    CommsModule,
    OnlineBookingModule,
    WaitingRoomModule,
    PreventiveModule,
    LivestockModule,
    BoardingModule,
    InsuranceModule,
    // The client portal is kept in the codebase but only loaded when CLIENT_PORTAL_ENABLED=true.
    ...(env().CLIENT_PORTAL_ENABLED ? [PortalModule] : []),
    OnboardingModule,
    PlatformModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: SessionAwareThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
