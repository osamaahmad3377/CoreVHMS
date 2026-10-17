import { csvRow } from '../../common/util/csv';
import { AuditService } from '../../common/audit/audit.service';
import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { forbidden } from '../../common/http/errors';
import { PosService } from './pos.service';
import { ApiTags } from '@nestjs/swagger';
import {
  PAYMENT_METHODS,
  allocateSchema,
  chargeListQuery,
  closeSessionSchema,
  createInvoiceSchema,
  creditNoteSchema,
  estimateSchema,
  expenseSchema,
  invoiceListQuery,
  openSessionSchema,
  paymentSchema,
  refundSchema,
  registerSchema,
  serviceSchema,
  taxRateSchema,
  updateInvoiceSchema,
  voidSchema,
  waiveSchema,
  PRODUCT_TYPES,
} from '@vcms/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { RequireAnyPermission, RequirePermissions } from '../../common/auth/decorators';
import { RequestContext } from '../../common/context/request-context';
import { ApiZodBody, ApiZodQuery, zp } from '../../common/http/zod';
import { BillingConfigService } from './billing-config.service';
import { ChargeCaptureService } from './charge-capture.service';
import { InvoicesService } from './invoices.service';
import { CashService, EstimatesAndExpensesService, PaymentsService } from './payments.service';

const UUID = new ParseUUIDPipe();
const paymentListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  clientId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
});
const posCatalogQuery = z.object({
  q: z.string().trim().max(80).optional(),
  category: z.enum(['SERVICE', ...PRODUCT_TYPES]).optional(),
  categoryId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(60),
});
const chargesByClientQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  q: z.string().trim().max(200).optional(),
});
const settingsSchema = z.object({
  allowNegativeStock: z.boolean().optional(),
  pricesIncludeTax: z.boolean().optional(),
  paymentTermsDays: z.coerce.number().int().min(0).max(365).optional(),
  requireCashSession: z.boolean().optional(),
  poRequiresSecondApprover: z.boolean().optional(),
});

@ApiTags('billing')
@Controller()
export class BillingController {
  constructor(
    private readonly config: BillingConfigService,
    private readonly charges: ChargeCaptureService,
    private readonly invoices: InvoicesService,
    private readonly paymentsService: PaymentsService,
    private readonly cash: CashService,
    private readonly misc: EstimatesAndExpensesService,
    private readonly pos: PosService,
    private readonly audit: AuditService,
  ) {}

  // ── Point of sale ──
  @Get('pos/catalog')
  @RequirePermissions('pos.use')
  @ApiZodQuery(posCatalogQuery)
  posCatalog(@Query(zp(posCatalogQuery)) q: z.infer<typeof posCatalogQuery>) {
    return this.pos.catalog(q);
  }

  @Get('pos/recent')
  @RequirePermissions('pos.use')
  posRecent() {
    return this.pos.recent();
  }

  // ── Configuration ──
  @Get('billing/settings')
  @RequireAnyPermission('billing.read', 'settings.manage')
  settings() {
    return this.config.settings();
  }

  @Patch('billing/settings')
  @RequirePermissions('settings.manage')
  updateSettings(@Body(zp(settingsSchema)) body: z.infer<typeof settingsSchema>) {
    return this.config.updateSettings(body);
  }

  @Get('tax-rates')
  @RequireAnyPermission('billing.read', 'settings.manage', 'formulary.manage', 'inventory.write')
  taxRates() {
    return this.config.taxRates();
  }

  @Post('tax-rates')
  @RequirePermissions('settings.manage')
  @ApiZodBody(taxRateSchema)
  createTax(@Body(zp(taxRateSchema)) body: z.infer<typeof taxRateSchema>) {
    return this.config.saveTaxRate(null, body);
  }

  @Patch('tax-rates/:id')
  @RequirePermissions('settings.manage')
  updateTax(@Param('id', UUID) id: string, @Body(zp(taxRateSchema)) body: z.infer<typeof taxRateSchema>) {
    return this.config.saveTaxRate(id, body);
  }

  @Get('services')
  @RequireAnyPermission('billing.read', 'settings.manage', 'pos.use', 'appointments.read')
  services(@Query('all') all?: string, @Query('q') q?: string) {
    return this.config.services(all === 'true', q?.slice(0, 80));
  }

  @Post('services')
  @RequirePermissions('settings.manage')
  @ApiZodBody(serviceSchema)
  createService(@Body(zp(serviceSchema)) body: z.infer<typeof serviceSchema>) {
    return this.config.saveService(null, body);
  }

  @Patch('services/:id')
  @RequirePermissions('settings.manage')
  updateService(@Param('id', UUID) id: string, @Body(zp(serviceSchema)) body: z.infer<typeof serviceSchema>) {
    return this.config.saveService(id, body);
  }

  // ── Charges ──
  @Get('charges')
  @RequirePermissions('billing.read')
  @ApiZodQuery(chargeListQuery)
  listCharges(@Query(zp(chargeListQuery)) q: z.infer<typeof chargeListQuery>) {
    return this.charges.list(q);
  }

  @Get('charges/by-client')
  @RequirePermissions('billing.read')
  @ApiZodQuery(chargesByClientQuery)
  chargesByClient(@Query(zp(chargesByClientQuery)) q: z.infer<typeof chargesByClientQuery>) {
    return this.charges.byClient(q);
  }

  @Post('charges/:id/waive')
  @HttpCode(200)
  @RequirePermissions('billing.void')
  waive(@Param('id', UUID) id: string, @Body(zp(waiveSchema)) body: { reason: string }) {
    return this.charges.waive(id, body.reason);
  }

  @Post('charges/:id/restore')
  @HttpCode(200)
  @RequirePermissions('billing.write')
  restore(@Param('id', UUID) id: string) {
    return this.charges.restore(id);
  }

  // ── Invoices ──
  @Get('invoices')
  @RequirePermissions('billing.read')
  @ApiZodQuery(invoiceListQuery)
  list(@Query(zp(invoiceListQuery)) q: z.infer<typeof invoiceListQuery>) {
    return this.invoices.list(q);
  }

  @Get('invoices/:id')
  @RequirePermissions('billing.read')
  get(@Param('id', UUID) id: string) {
    return this.invoices.get(id);
  }

  @Post('invoices')
  @RequireAnyPermission('billing.write', 'pos.use')
  @ApiZodBody(createInvoiceSchema)
  create(@Body(zp(createInvoiceSchema)) body: z.infer<typeof createInvoiceSchema>) {
    if (!RequestContext.require().permissions.has('billing.write')) {
      // Point-of-sale-only users sell catalogue items at catalogue prices; overrides need billing.write.
      body.isPos = true;
      const override = body.chargeIds.length || body.lines.some((l) => l.kind === 'CUSTOM' || l.unitPriceMinor !== undefined || l.discountMinor > 0 || l.taxRateBasisPoints !== undefined);
      if (override) throw forbidden('Custom items, price changes and discounts need billing permission');
    }
    return this.invoices.create(body);
  }

  @Patch('invoices/:id')
  @RequirePermissions('billing.write')
  @ApiZodBody(updateInvoiceSchema)
  update(@Param('id', UUID) id: string, @Body(zp(updateInvoiceSchema)) body: z.infer<typeof updateInvoiceSchema>) {
    return this.invoices.updateDraft(id, body);
  }

  @Delete('invoices/:id')
  @HttpCode(204)
  @RequirePermissions('billing.write')
  discard(@Param('id', UUID) id: string) {
    return this.invoices.discardDraft(id);
  }

  @Post('invoices/:id/issue')
  @HttpCode(200)
  @RequireAnyPermission('billing.write', 'pos.use')
  issue(@Param('id', UUID) id: string) {
    return this.invoices.issue(id);
  }

  @Post('invoices/:id/void')
  @HttpCode(200)
  @RequirePermissions('billing.void')
  void(@Param('id', UUID) id: string, @Body(zp(voidSchema)) body: { reason: string }) {
    return this.invoices.void(id, body.reason);
  }

  @Post('invoices/:id/credit-notes')
  @RequirePermissions('billing.refund')
  @ApiZodBody(creditNoteSchema)
  credit(@Param('id', UUID) id: string, @Body(zp(creditNoteSchema)) body: z.infer<typeof creditNoteSchema>) {
    return this.invoices.creditNote(id, body.amountMinor, body.reason);
  }

  @Get('clients/:id/statement')
  @RequirePermissions('billing.read')
  statement(@Param('id', UUID) id: string) {
    return this.invoices.statement(id);
  }

  // ── Payments ──
  @Get('payments')
  @RequirePermissions('billing.read')
  @ApiZodQuery(paymentListQuery)
  listPayments(@Query(zp(paymentListQuery)) q: z.infer<typeof paymentListQuery>) {
    return this.paymentsService.list(q);
  }

  @Get('payments/:id')
  @RequirePermissions('billing.read')
  payment(@Param('id', UUID) id: string) {
    return this.paymentsService.get(id);
  }

  @Post('payments')
  @RequirePermissions('payments.take')
  @ApiZodBody(paymentSchema)
  take(@Body(zp(paymentSchema)) body: z.infer<typeof paymentSchema>, @Headers('idempotency-key') key?: string) {
    return this.paymentsService.take({ ...body, idempotencyKey: body.idempotencyKey ?? (key && key.length >= 8 && key.length <= 100 ? key : undefined) });
  }

  @Post('payments/:id/allocate')
  @HttpCode(200)
  @RequirePermissions('payments.take')
  @ApiZodBody(allocateSchema)
  allocate(@Param('id', UUID) id: string, @Body(zp(allocateSchema)) body: z.infer<typeof allocateSchema>) {
    return this.paymentsService.allocate(id, body.allocations);
  }

  @Post('payments/:id/refunds')
  @RequirePermissions('billing.refund')
  @ApiZodBody(refundSchema)
  refund(@Param('id', UUID) id: string, @Body(zp(refundSchema)) body: z.infer<typeof refundSchema>) {
    return this.paymentsService.refund(id, body);
  }

  // ── Cash ──
  @Get('cash/registers')
  @RequireAnyPermission('cash.manage', 'payments.take', 'pos.use')
  registers(@Query('branchId') branchId?: string) {
    return this.cash.listRegisters(branchId && /^[0-9a-f-]{36}$/i.test(branchId) ? branchId : undefined);
  }

  @Post('cash/registers')
  @RequirePermissions('cash.manage')
  @ApiZodBody(registerSchema)
  createRegister(@Body(zp(registerSchema)) body: z.infer<typeof registerSchema>) {
    return this.cash.createRegister(body);
  }

  @Get('cash/sessions')
  @RequireAnyPermission('cash.manage', 'reports.financial')
  sessions(@Query('registerId') registerId?: string) {
    return this.cash.sessions(registerId && /^[0-9a-f-]{36}$/i.test(registerId) ? registerId : undefined);
  }

  @Post('cash/sessions')
  @RequireAnyPermission('cash.manage', 'pos.use')
  @ApiZodBody(openSessionSchema)
  open(@Body(zp(openSessionSchema)) body: z.infer<typeof openSessionSchema>) {
    return this.cash.open(body.registerId, body.openingFloatMinor);
  }

  @Get('cash/sessions/:id')
  @RequireAnyPermission('cash.manage', 'pos.use')
  session(@Param('id', UUID) id: string) {
    return this.cash.expected(id);
  }

  @Post('cash/sessions/:id/close')
  @HttpCode(200)
  @RequirePermissions('cash.manage')
  @ApiZodBody(closeSessionSchema)
  close(@Param('id', UUID) id: string, @Body(zp(closeSessionSchema)) body: z.infer<typeof closeSessionSchema>) {
    return this.cash.close(id, body.countedCashMinor, body.notes);
  }

  // ── Estimates & expenses ──
  @Get('estimates')
  @RequirePermissions('billing.read')
  estimates(@Query('clientId') clientId?: string) {
    return this.misc.listEstimates(clientId && /^[0-9a-f-]{36}$/i.test(clientId) ? clientId : undefined);
  }

  @Post('estimates')
  @RequirePermissions('billing.write')
  @ApiZodBody(estimateSchema)
  createEstimate(@Body(zp(estimateSchema)) body: z.infer<typeof estimateSchema>) {
    return this.misc.createEstimate(body);
  }

  @Post('estimates/:id/status')
  @HttpCode(200)
  @RequirePermissions('billing.write')
  estimateStatus(@Param('id', UUID) id: string, @Body(zp(z.object({ status: z.enum(['SENT', 'ACCEPTED', 'DECLINED']) }))) body: { status: 'SENT' | 'ACCEPTED' | 'DECLINED' }) {
    return this.misc.setEstimateStatus(id, body.status);
  }

  @Post('estimates/:id/convert')
  @RequirePermissions('billing.write')
  convert(@Param('id', UUID) id: string) {
    return this.misc.convert(id);
  }

  @Get('expenses')
  @RequireAnyPermission('expenses.write', 'reports.financial')
  expenses(@Query('from') from?: string, @Query('to') to?: string) {
    return this.misc.listExpenses(from ? new Date(from) : undefined, to ? new Date(to) : undefined);
  }

  @Post('expenses')
  @RequirePermissions('expenses.write')
  @ApiZodBody(expenseSchema)
  createExpense(@Body(zp(expenseSchema)) body: z.infer<typeof expenseSchema>) {
    return this.misc.createExpense(body);
  }

  /** Printable/downloadable statement as CSV. */
  @Get('clients/:id/statement.csv')
  @RequirePermissions('billing.read')
  async statementCsv(@Param('id', UUID) id: string, @Res() res: Response) {
    const s = await this.invoices.statement(id);
    const rows = [['Date', 'Type', 'Reference', 'Description', 'Debit', 'Credit', 'Balance'].join(','), ...s.lines.map((l) => csvRow([l.date.toISOString().slice(0, 10), l.type, l.reference, l.description, l.debitMinor, l.creditMinor, l.balanceMinor]))];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    await this.audit.record({ action: 'client.statement_exported', entityType: 'Client', entityId: id, summary: `Statement CSV, ${s.lines.length} lines` });
    res.setHeader('Content-Disposition', `attachment; filename="statement-${id.slice(0, 8)}.csv"`);
    res.send(rows.join('\n'));
  }
}
