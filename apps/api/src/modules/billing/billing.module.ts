import { Module } from '@nestjs/common';
import { ClientsModule } from '../clients/clients.module';
import { ClinicalModule } from '../clinical/clinical.module';
import { InventoryModule } from '../inventory/inventory.module';
import { LabModule } from '../lab/lab.module';
import { PatientsModule } from '../patients/patients.module';
import { PharmacyModule } from '../pharmacy/pharmacy.module';
import { BillingConfigService } from './billing-config.service';
import { BillingController } from './billing.controller';
import { ReceiptsController } from './receipts.controller';
import { ReceiptSettingsService } from './receipt-settings.service';
import { BillingIntegrations } from './billing-integrations';
import { ChargeCaptureService } from './charge-capture.service';
import { InvoicesService } from './invoices.service';
import { PosService } from './pos.service';
import { CashService, EstimatesAndExpensesService, PaymentsService } from './payments.service';

@Module({
  imports: [InventoryModule, PharmacyModule, LabModule, ClinicalModule, PatientsModule, ClientsModule],
  controllers: [BillingController, ReceiptsController],
  providers: [BillingConfigService, ChargeCaptureService, InvoicesService, PaymentsService, CashService, EstimatesAndExpensesService, PosService, ReceiptSettingsService, BillingIntegrations],
  exports: [ChargeCaptureService, InvoicesService, PaymentsService],
})
export class BillingModule {}
