import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { DisposalService } from './disposal.service';
import { ForecastService } from './forecast.service';
import { InventoryService } from './inventory.service';
import { ProcurementService } from './procurement.service';
import { PurchasingService } from './purchasing.service';
import { StockEngine } from './stock.engine';

@Module({
  controllers: [InventoryController],
  providers: [StockEngine, InventoryService, ProcurementService, PurchasingService, ForecastService, DisposalService],
  exports: [InventoryService, StockEngine],
})
export class InventoryModule {}
