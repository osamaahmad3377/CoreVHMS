import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  adjustmentSchema,
  batchStatusSchema,
  branchTransferSchema,
  countLineSchema,
  locationSchema,
  prepareOrdersSchema,
  purchaseOrderSchema,
  purchaseRequestDecisionSchema,
  purchaseRequestSchema,
  purchaseRequestsToOrderSchema,
  receiveStockSchema,
  stockForecastQuery,
  stockListQuery,
  supplierReturnSchema,
  supplierSchema,
  transferSchema,
} from '@vcms/shared';
import { MOVEMENT_TYPES } from '@vcms/shared';
import { z } from 'zod';
import { RequireAnyPermission, RequirePermissions } from '../../common/auth/decorators';
import { assertFeature } from '../../common/tenancy/entitlements';
import { ApiZodBody, ApiZodQuery, zp } from '../../common/http/zod';
import { RequestContext } from '../../common/context/request-context';
import { ForecastService } from './forecast.service';
import { InventoryService } from './inventory.service';
import { PurchasingService } from './purchasing.service';
import { ProcurementService } from './procurement.service';

const UUID = new ParseUUIDPipe();
const ledgerQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  productId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  type: z.enum(MOVEMENT_TYPES).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
const rangeQuery = z.object({ from: z.coerce.date(), to: z.coerce.date() });
const reasonSchema = z.object({ reason: z.string().trim().min(1).max(500) });

@ApiTags('inventory')
@Controller()
export class InventoryController {
  constructor(
    private readonly inventory: InventoryService,
    private readonly procurement: ProcurementService,
    private readonly purchasing: PurchasingService,
    private readonly forecasts: ForecastService,
  ) {}

  // ── Stock forecast ──

  /** What runs out at each branch, ready supplier orders, and transfers between branches. */
  @Get('stock/forecast')
  @RequireAnyPermission('inventory.read', 'procurement.read')
  @ApiZodQuery(stockForecastQuery)
  forecast(@Query(zp(stockForecastQuery)) q: z.infer<typeof stockForecastQuery>) {
    assertFeature('forecast');
    return this.forecasts.forecast(q);
  }

  @Post('stock/forecast/orders')
  @RequirePermissions('procurement.write')
  @ApiZodBody(prepareOrdersSchema)
  prepareOrders(@Body(zp(prepareOrdersSchema)) body: z.infer<typeof prepareOrdersSchema>) {
    assertFeature('forecast');
    return this.forecasts.prepareOrders(body);
  }

  @Post('stock/branch-transfers')
  @RequirePermissions('inventory.adjust')
  @ApiZodBody(branchTransferSchema)
  branchTransfer(@Body(zp(branchTransferSchema)) body: z.infer<typeof branchTransferSchema>) {
    return this.forecasts.transferBetweenBranches(body);
  }

  // ── Locations ──
  @Get('stock-locations')
  @RequireAnyPermission('inventory.read', 'settings.manage')
  locations(@Query('branchId') branchId?: string, @Query('all') all?: string) {
    return this.inventory.listLocations(branchId && /^[0-9a-f-]{36}$/i.test(branchId) ? branchId : undefined, all === 'true');
  }

  @Post('stock-locations')
  @RequireAnyPermission('settings.manage', 'inventory.write')
  @ApiZodBody(locationSchema)
  createLocation(@Body(zp(locationSchema)) body: z.infer<typeof locationSchema>) {
    return this.inventory.saveLocation(null, body);
  }

  @Patch('stock-locations/:id')
  @RequireAnyPermission('settings.manage', 'inventory.write')
  updateLocation(@Param('id', UUID) id: string, @Body(zp(locationSchema)) body: z.infer<typeof locationSchema>) {
    return this.inventory.saveLocation(id, body);
  }

  // ── Stock ──
  @Get('stock')
  @RequirePermissions('inventory.read')
  @ApiZodQuery(stockListQuery)
  overview(@Query(zp(stockListQuery)) q: z.infer<typeof stockListQuery>) {
    return this.inventory.overview(q);
  }

  @Get('stock/products/:id')
  @RequirePermissions('inventory.read')
  productStock(@Param('id', UUID) id: string) {
    return this.inventory.productStock(id);
  }

  @Patch('stock/products/:id/settings')
  @RequirePermissions('inventory.write')
  stockSettings(
    @Param('id', UUID) id: string,
    @Body(zp(z.object({ trackStock: z.boolean().optional(), reorderLevel: z.coerce.number().min(0).nullish(), reorderQuantity: z.coerce.number().min(0).nullish(), taxRateId: z.string().uuid().nullish() }))) body: any,
  ) {
    return this.inventory.updateStockSettings(id, body);
  }

  @Get('stock/movements')
  @RequirePermissions('inventory.read')
  @ApiZodQuery(ledgerQuery)
  ledger(@Query(zp(ledgerQuery)) q: z.infer<typeof ledgerQuery>) {
    return this.inventory.ledger(q);
  }

  @Get('stock/controlled-register')
  @RequirePermissions('inventory.read')
  controlled(@Query(zp(rangeQuery)) q: z.infer<typeof rangeQuery>) {
    return this.inventory.controlledRegister(q.from, q.to);
  }

  @Post('stock/receipts')
  @RequirePermissions('inventory.write')
  @ApiZodBody(receiveStockSchema)
  receive(@Body(zp(receiveStockSchema)) body: z.infer<typeof receiveStockSchema>) {
    return this.inventory.receive(body);
  }

  @Post('stock/adjustments')
  @RequirePermissions('inventory.adjust')
  @ApiZodBody(adjustmentSchema)
  adjust(@Body(zp(adjustmentSchema)) body: z.infer<typeof adjustmentSchema>) {
    return this.inventory.adjust(body);
  }

  @Post('stock/transfers')
  @RequirePermissions('inventory.adjust')
  @ApiZodBody(transferSchema)
  transfer(@Body(zp(transferSchema)) body: z.infer<typeof transferSchema>) {
    return this.inventory.transfer(body);
  }

  @Post('stock/batches/:id/status')
  @HttpCode(200)
  @RequirePermissions('inventory.adjust')
  @ApiZodBody(batchStatusSchema)
  batchStatus(@Param('id', UUID) id: string, @Body(zp(batchStatusSchema)) body: z.infer<typeof batchStatusSchema>) {
    return this.inventory.setBatchStatus(id, body.status, body.reason);
  }

  // ── Counts ──
  @Get('stock/counts')
  @RequirePermissions('inventory.read')
  counts() {
    return this.inventory.listCounts();
  }

  @Post('stock/counts')
  @RequirePermissions('inventory.adjust')
  startCount(@Body(zp(z.object({ locationId: z.string().uuid(), notes: z.string().max(500).nullish() }))) body: { locationId: string; notes?: string | null }) {
    return this.inventory.startCount(body.locationId, body.notes);
  }

  @Get('stock/counts/:id')
  @RequirePermissions('inventory.read')
  count(@Param('id', UUID) id: string) {
    return this.inventory.getCount(id);
  }

  @Patch('stock/counts/:id')
  @RequirePermissions('inventory.adjust')
  @ApiZodBody(countLineSchema)
  recordCount(@Param('id', UUID) id: string, @Body(zp(countLineSchema)) body: z.infer<typeof countLineSchema>) {
    return this.inventory.recordCount(id, body.lines);
  }

  @Post('stock/counts/:id/complete')
  @HttpCode(200)
  @RequirePermissions('inventory.adjust')
  completeCount(@Param('id', UUID) id: string) {
    return this.inventory.completeCount(id);
  }

  // ── Procurement ──
  @Get('suppliers')
  @RequireAnyPermission('procurement.read', 'inventory.read', 'expenses.write')
  suppliers(@Query('all') all?: string) {
    return this.procurement.listSuppliers(all === 'true');
  }

  @Get('suppliers/:id')
  @RequireAnyPermission('procurement.read', 'reports.financial')
  supplier(@Param('id', UUID) id: string) {
    return this.procurement.supplierBalance(id);
  }

  @Post('suppliers')
  @RequirePermissions('procurement.write')
  @ApiZodBody(supplierSchema)
  createSupplier(@Body(zp(supplierSchema)) body: z.infer<typeof supplierSchema>) {
    return this.procurement.saveSupplier(null, body);
  }

  @Patch('suppliers/:id')
  @RequirePermissions('procurement.write')
  updateSupplier(@Param('id', UUID) id: string, @Body(zp(supplierSchema.partial())) body: any) {
    return this.procurement.saveSupplier(id, body);
  }

  @Get('purchase-orders')
  @RequirePermissions('procurement.read')
  orders(@Query('status') status?: string) {
    return this.procurement.listOrders(status?.slice(0, 200));
  }

  @Get('purchase-orders/reorder-suggestions')
  @RequireAnyPermission('procurement.read', 'inventory.read')
  suggestions() {
    return this.procurement.reorderSuggestions();
  }

  /** Whether orders need a second person to approve them (drives "Approve & send" in one step). */
  @Get('purchase-orders/approval-rule')
  @RequirePermissions('procurement.read')
  approvalRule() {
    return this.procurement.approvalRule();
  }

  @Get('purchase-orders/:id')
  @RequirePermissions('procurement.read')
  order(@Param('id', UUID) id: string) {
    return this.procurement.getOrder(id);
  }

  @Post('purchase-orders')
  @RequirePermissions('procurement.write')
  @ApiZodBody(purchaseOrderSchema)
  createOrder(@Body(zp(purchaseOrderSchema)) body: z.infer<typeof purchaseOrderSchema>) {
    return this.procurement.createOrder(body);
  }

  @Post('purchase-orders/:id/submit')
  @HttpCode(200)
  @RequirePermissions('procurement.write')
  submit(@Param('id', UUID) id: string) {
    return this.procurement.submit(id);
  }

  @Post('purchase-orders/:id/approve')
  @HttpCode(200)
  @RequirePermissions('procurement.approve')
  approve(@Param('id', UUID) id: string) {
    return this.procurement.approve(id);
  }

  @Post('purchase-orders/:id/cancel')
  @HttpCode(200)
  @RequireAnyPermission('procurement.write', 'procurement.approve')
  cancel(@Param('id', UUID) id: string, @Body(zp(reasonSchema)) body: { reason: string }) {
    return this.procurement.cancel(id, body.reason);
  }

  // ── Purchase requests ──
  @Get('purchase-requests')
  @RequireAnyPermission('procurement.request', 'procurement.read')
  requests(@Query('status') status?: string) {
    return this.purchasing.listRequests(status?.slice(0, 100));
  }

  @Post('purchase-requests')
  @RequireAnyPermission('procurement.request', 'procurement.write')
  @ApiZodBody(purchaseRequestSchema)
  createRequest(@Body(zp(purchaseRequestSchema)) body: z.infer<typeof purchaseRequestSchema>) {
    return this.purchasing.createRequest(body);
  }

  @Post('purchase-requests/:id/cancel')
  @HttpCode(200)
  @RequireAnyPermission('procurement.request', 'procurement.write')
  @ApiZodBody(purchaseRequestDecisionSchema)
  cancelRequest(@Param('id', UUID) id: string, @Body(zp(purchaseRequestDecisionSchema)) body: { note: string }) {
    return this.purchasing.closeRequest(id, 'CANCELLED', body.note, RequestContext.require().permissions.has('procurement.write'));
  }

  @Post('purchase-requests/:id/reject')
  @HttpCode(200)
  @RequirePermissions('procurement.write')
  @ApiZodBody(purchaseRequestDecisionSchema)
  rejectRequest(@Param('id', UUID) id: string, @Body(zp(purchaseRequestDecisionSchema)) body: { note: string }) {
    return this.purchasing.closeRequest(id, 'REJECTED', body.note, true);
  }

  @Post('purchase-requests/order')
  @RequirePermissions('procurement.write')
  @ApiZodBody(purchaseRequestsToOrderSchema)
  orderRequests(@Body(zp(purchaseRequestsToOrderSchema)) body: z.infer<typeof purchaseRequestsToOrderSchema>) {
    return this.purchasing.convertToOrder(body);
  }

  // ── Supplier returns ──
  @Get('supplier-returns')
  @RequireAnyPermission('procurement.read', 'inventory.read')
  returns(@Query('supplierId', new ParseUUIDPipe({ optional: true })) supplierId?: string) {
    return this.purchasing.listReturns(supplierId);
  }

  @Get('supplier-returns/returnable')
  @RequirePermissions('procurement.write', 'inventory.adjust')
  returnable(@Query('supplierId', UUID) supplierId: string, @Query('locationId', UUID) locationId: string) {
    return this.purchasing.returnable(supplierId, locationId);
  }

  @Post('supplier-returns')
  @RequirePermissions('procurement.write', 'inventory.adjust')
  @ApiZodBody(supplierReturnSchema)
  createReturn(@Body(zp(supplierReturnSchema)) body: z.infer<typeof supplierReturnSchema>) {
    return this.purchasing.createReturn(body);
  }
}
