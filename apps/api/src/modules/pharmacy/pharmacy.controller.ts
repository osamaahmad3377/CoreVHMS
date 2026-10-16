import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  administrationSchema,
  createPrescriptionSchema,
  dispenseSchema,
  doseReferenceSchema,
  prescriptionItemSchema,
  prescriptionListQuery,
  productListQuery,
  productSchema,
  withdrawalSchema,
} from '@vcms/shared';
import { z } from 'zod';
import { RequireAnyPermission, RequirePermissions } from '../../common/auth/decorators';
import { ApiZodBody, ApiZodQuery, zp } from '../../common/http/zod';
import { AdministrationsService } from './administrations.service';
import { FormularyService } from './formulary.service';
import { PrescriptionsService } from './prescriptions.service';
import { WithdrawalService } from './withdrawal.service';

const UUID = new ParseUUIDPipe();
const evaluateSchema = z.object({ patientId: z.string().uuid(), weightKg: z.coerce.number().positive().nullish(), item: prescriptionItemSchema });
const reasonSchema = z.object({ reason: z.string().trim().min(1).max(500) });

@ApiTags('pharmacy')
@Controller()
export class PharmacyController {
  constructor(
    private readonly formulary: FormularyService,
    private readonly prescriptions: PrescriptionsService,
    private readonly administrations: AdministrationsService,
    private readonly withdrawals: WithdrawalService,
  ) {}

  // ── Formulary ──
  @Get('products')
  @RequireAnyPermission('prescriptions.read', 'inventory.read', 'formulary.manage', 'pos.use', 'clinical.write', 'hospital.write', 'procurement.request')
  @ApiZodQuery(productListQuery)
  products(@Query(zp(productListQuery)) q: z.infer<typeof productListQuery>) {
    return this.formulary.list(q);
  }

  @Get('products/:id')
  @RequireAnyPermission('prescriptions.read', 'inventory.read', 'formulary.manage', 'clinical.write')
  product(@Param('id', UUID) id: string) {
    return this.formulary.get(id);
  }

  @Post('products')
  @RequireAnyPermission('formulary.manage', 'inventory.write')
  @ApiZodBody(productSchema)
  createProduct(@Body(zp(productSchema)) body: z.infer<typeof productSchema>) {
    return this.formulary.create(body);
  }

  @Patch('products/:id')
  @RequireAnyPermission('formulary.manage', 'inventory.write')
  updateProduct(@Param('id', UUID) id: string, @Body(zp(productSchema.partial())) body: Partial<z.infer<typeof productSchema>>) {
    return this.formulary.update(id, body);
  }

  @Post('products/:id/withdrawals')
  @RequirePermissions('formulary.manage')
  @ApiZodBody(withdrawalSchema)
  saveWithdrawal(@Param('id', UUID) id: string, @Body(zp(withdrawalSchema)) body: z.infer<typeof withdrawalSchema>) {
    return this.formulary.saveWithdrawal(id, body);
  }

  @Delete('products/:id/withdrawals/:wid')
  @HttpCode(204)
  @RequirePermissions('formulary.manage')
  removeWithdrawal(@Param('id', UUID) id: string, @Param('wid', UUID) wid: string) {
    return this.formulary.removeWithdrawal(id, wid);
  }

  @Get('products/:id/dose-references')
  @RequireAnyPermission('prescriptions.read', 'formulary.manage')
  references(@Param('id', UUID) id: string, @Query('speciesId') speciesId?: string) {
    return this.formulary.listReferences(id, speciesId && /^[0-9a-f-]{36}$/i.test(speciesId) ? speciesId : undefined);
  }

  @Post('dose-references')
  @RequirePermissions('formulary.manage')
  @ApiZodBody(doseReferenceSchema)
  createReference(@Body(zp(doseReferenceSchema)) body: z.infer<typeof doseReferenceSchema>) {
    return this.formulary.createReference(body);
  }

  @Post('dose-references/:id/approve')
  @HttpCode(200)
  @RequirePermissions('formulary.manage', 'clinical.sign')
  approveReference(@Param('id', UUID) id: string) {
    return this.formulary.setReferenceStatus(id, 'APPROVED');
  }

  @Post('dose-references/:id/retire')
  @HttpCode(200)
  @RequirePermissions('formulary.manage')
  retireReference(@Param('id', UUID) id: string) {
    return this.formulary.setReferenceStatus(id, 'RETIRED');
  }

  // ── Prescriptions ──
  @Get('prescriptions')
  @RequireAnyPermission('prescriptions.read', 'pharmacy.dispense')
  @ApiZodQuery(prescriptionListQuery)
  list(@Query(zp(prescriptionListQuery)) q: z.infer<typeof prescriptionListQuery>) {
    return this.prescriptions.list(q);
  }

  @Post('prescriptions/evaluate')
  @HttpCode(200)
  @RequirePermissions('prescriptions.write')
  @ApiZodBody(evaluateSchema)
  evaluate(@Body(zp(evaluateSchema)) body: z.infer<typeof evaluateSchema>) {
    return this.prescriptions.evaluateItem(body.patientId, body.weightKg ?? null, body.item);
  }

  @Get('prescriptions/:id')
  @RequireAnyPermission('prescriptions.read', 'pharmacy.dispense')
  get(@Param('id', UUID) id: string) {
    return this.prescriptions.get(id);
  }

  @Get('prescriptions/:id/verify')
  @RequireAnyPermission('prescriptions.read', 'pharmacy.dispense')
  verify(@Param('id', UUID) id: string) {
    return this.prescriptions.verify(id);
  }

  @Post('prescriptions')
  @RequirePermissions('prescriptions.write')
  @ApiZodBody(createPrescriptionSchema)
  create(@Body(zp(createPrescriptionSchema)) body: z.infer<typeof createPrescriptionSchema>) {
    return this.prescriptions.create(body);
  }

  @Post('prescriptions/:id/authorize')
  @HttpCode(200)
  @RequirePermissions('prescriptions.authorize')
  authorize(@Param('id', UUID) id: string) {
    return this.prescriptions.authorize(id);
  }

  @Post('prescriptions/:id/cancel')
  @HttpCode(200)
  @RequireAnyPermission('prescriptions.authorize', 'prescriptions.write')
  cancel(@Param('id', UUID) id: string, @Body(zp(reasonSchema)) body: { reason: string }) {
    return this.prescriptions.cancel(id, body.reason);
  }

  @Post('prescriptions/:id/dispense')
  @HttpCode(200)
  @RequirePermissions('pharmacy.dispense')
  @ApiZodBody(dispenseSchema)
  dispense(@Param('id', UUID) id: string, @Body(zp(dispenseSchema)) body: z.infer<typeof dispenseSchema>) {
    return this.prescriptions.dispense(id, body);
  }

  @Post('prescriptions/:id/repeat')
  @RequirePermissions('prescriptions.write')
  repeat(@Param('id', UUID) id: string) {
    return this.prescriptions.repeat(id);
  }

  // ── Administration & withdrawals ──
  @Post('administrations')
  @RequireAnyPermission('clinical.write', 'hospital.write', 'pharmacy.dispense', 'preventive.write')
  @ApiZodBody(administrationSchema)
  administer(@Body(zp(administrationSchema)) body: z.infer<typeof administrationSchema>) {
    return this.administrations.record(body);
  }

  @Get('patients/:id/administrations')
  @RequireAnyPermission('clinical.read', 'prescriptions.read', 'hospital.read')
  administered(@Param('id', UUID) id: string, @Query('encounterId') encounterId?: string) {
    return this.administrations.list(id, encounterId && /^[0-9a-f-]{36}$/i.test(encounterId) ? encounterId : undefined);
  }

  @Get('patients/:id/withdrawals')
  @RequireAnyPermission('patients.read', 'livestock.read')
  withdrawalsFor(@Param('id', UUID) id: string, @Query('all') all?: string) {
    return all === 'true' ? this.withdrawals.history(id) : this.withdrawals.active(id);
  }
}
