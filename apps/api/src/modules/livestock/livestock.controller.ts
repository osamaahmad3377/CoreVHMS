import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  animalGroupSchema,
  assignAnimalSchema,
  breedingEventSchema,
  bulkAnimalsSchema,
  cancelSchema,
  closeGroupSchema,
  completeFieldVisitSchema,
  farmSchema,
  fieldVisitItemSchema,
  fieldVisitSchema,
  gestationSchema,
  groupTreatmentSchema,
  milkSheetSchema,
  movementSchema,
  outbreakSchema,
  PRODUCTION_KINDS,
  productionSchema,
  updateFarmSchema,
  updateFieldVisitSchema,
  updateGroupSchema,
  updateOutbreakSchema,
  voidSchema,
} from '@vcms/shared';
import { z } from 'zod';
import { AuditService, diff } from '../../common/audit/audit.service';
import { RequirePermissions } from '../../common/auth/decorators';
import { notFound } from '../../common/http/errors';
import { ApiZodBody, ApiZodQuery, zp } from '../../common/http/zod';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BreedingService } from './breeding.service';
import { FarmsService } from './farms.service';
import { FieldVisitsService } from './field-visits.service';
import { HerdHealthService } from './herd-health.service';
import { ProductionService } from './production.service';

const UUID = new ParseUUIDPipe();
const farmQuery = z.object({ q: z.string().max(100).optional(), clientId: z.string().uuid().optional(), status: z.enum(['ACTIVE', 'INACTIVE', 'ALL']).optional() });
const periodQuery = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() });
const productionQuery = z.object({
  farmId: z.string().uuid().optional(),
  kind: z.enum(PRODUCTION_KINDS).optional(),
  groupId: z.string().uuid().optional(),
  patientId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  includeVoided: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
});
const visitQuery = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional(), status: z.string().max(100).optional(), farmId: z.string().uuid().optional(), clinicianId: z.string().uuid().optional() });
const movementQuery = z.object({ farmId: z.string().uuid().optional(), patientId: z.string().uuid().optional(), groupId: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(500).optional() });

const lastDays = (q: { from?: Date; to?: Date }, days: number) => ({ from: q.from ?? new Date(Date.now() - days * 86400_000), to: q.to ?? new Date() });

@ApiTags('livestock')
@Controller()
export class LivestockController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly farms: FarmsService,
    private readonly breeding: BreedingService,
    private readonly production: ProductionService,
    private readonly health: HerdHealthService,
    private readonly visits: FieldVisitsService,
  ) {}

  @Get('livestock/overview')
  @RequirePermissions('livestock.read')
  async overview() {
    const [o, due] = await Promise.all([this.farms.overview(), this.breeding.dueSoon(30)]);
    return { ...o, birthsDue30Days: due.length };
  }

  // ── Farms ──
  @Get('farms')
  @RequirePermissions('livestock.read')
  @ApiZodQuery(farmQuery)
  list(@Query(zp(farmQuery)) q: z.infer<typeof farmQuery>) {
    return this.farms.list(q);
  }

  @Post('farms')
  @RequirePermissions('livestock.write')
  @ApiZodBody(farmSchema)
  create(@Body(zp(farmSchema)) body: z.infer<typeof farmSchema>) {
    return this.farms.create(body);
  }

  @Get('farms/:id')
  @RequirePermissions('livestock.read')
  get(@Param('id', UUID) id: string) {
    return this.farms.get(id);
  }

  @Patch('farms/:id')
  @RequirePermissions('livestock.write')
  @ApiZodBody(updateFarmSchema)
  update(@Param('id', UUID) id: string, @Body(zp(updateFarmSchema)) body: z.infer<typeof updateFarmSchema>) {
    return this.farms.update(id, body);
  }

  @Get('farms/:id/report')
  @RequirePermissions('livestock.read')
  @ApiZodQuery(periodQuery)
  report(@Param('id', UUID) id: string, @Query(zp(periodQuery)) q: z.infer<typeof periodQuery>) {
    const p = lastDays(q, 30);
    return this.farms.report(id, p.from, p.to);
  }

  @Get('farms/:id/fertility')
  @RequirePermissions('livestock.read')
  fertility(@Param('id', UUID) id: string) {
    return this.breeding.herd(id);
  }

  @Get('farms/:id/daily-production')
  @RequirePermissions('livestock.read')
  daily(@Param('id', UUID) id: string, @Query(zp(periodQuery.extend({ groupId: z.string().uuid().optional() }))) q: { from?: Date; to?: Date; groupId?: string }) {
    const p = lastDays(q, 30);
    return this.production.daily(id, p.from, p.to, q.groupId);
  }

  // ── Groups & animals ──
  @Get('animal-groups')
  @RequirePermissions('livestock.read')
  groups(@Query('farmId', UUID) farmId: string, @Query('includeClosed') includeClosed?: string) {
    return this.farms.groups(farmId, includeClosed === 'true');
  }

  @Post('animal-groups')
  @RequirePermissions('livestock.write')
  @ApiZodBody(animalGroupSchema)
  createGroup(@Body(zp(animalGroupSchema)) body: z.infer<typeof animalGroupSchema>) {
    return this.farms.createGroup(body);
  }

  @Get('animal-groups/:id')
  @RequirePermissions('livestock.read')
  group(@Param('id', UUID) id: string) {
    return this.farms.group(id);
  }

  @Patch('animal-groups/:id')
  @RequirePermissions('livestock.write')
  updateGroup(@Param('id', UUID) id: string, @Body(zp(updateGroupSchema)) body: z.infer<typeof updateGroupSchema>) {
    return this.farms.updateGroup(id, body);
  }

  @Post('animal-groups/:id/close')
  @HttpCode(200)
  @RequirePermissions('livestock.write')
  closeGroup(@Param('id', UUID) id: string, @Body(zp(closeGroupSchema)) body: { reason: string }) {
    return this.farms.closeGroup(id, body.reason);
  }

  @Post('livestock/animals/bulk')
  @RequirePermissions('livestock.write', 'patients.write')
  @ApiZodBody(bulkAnimalsSchema)
  bulk(@Body(zp(bulkAnimalsSchema)) body: z.infer<typeof bulkAnimalsSchema>) {
    return this.farms.bulkAdd(body);
  }

  @Post('livestock/animals/assign')
  @HttpCode(200)
  @RequirePermissions('livestock.write')
  assign(@Body(zp(assignAnimalSchema)) body: z.infer<typeof assignAnimalSchema>) {
    return this.farms.assign(body.patientId, body.farmId, body.groupId);
  }

  @Post('livestock/movements')
  @RequirePermissions('livestock.write')
  @ApiZodBody(movementSchema)
  move(@Body(zp(movementSchema)) body: z.infer<typeof movementSchema>) {
    return this.farms.move(body);
  }

  @Get('livestock/movements')
  @RequirePermissions('livestock.read')
  movements(@Query(zp(movementQuery)) q: z.infer<typeof movementQuery>) {
    return this.farms.movements(q);
  }

  @Get('livestock/withdrawals')
  @RequirePermissions('livestock.read')
  withdrawals(@Query('farmId') farmId?: string) {
    return this.farms.withdrawals(farmId && /^[0-9a-f-]{36}$/i.test(farmId) ? farmId : undefined);
  }

  // ── Breeding ──
  @Post('breeding-events')
  @RequirePermissions('livestock.write')
  @ApiZodBody(breedingEventSchema)
  breed(@Body(zp(breedingEventSchema)) body: z.infer<typeof breedingEventSchema>) {
    return this.breeding.record(body);
  }

  @Post('breeding-events/:id/void')
  @HttpCode(200)
  @RequirePermissions('livestock.write')
  voidBreeding(@Param('id', UUID) id: string, @Body(zp(voidSchema)) body: { reason: string }) {
    return this.breeding.void(id, body.reason);
  }

  @Get('livestock/animals/:id/breeding')
  @RequirePermissions('livestock.read')
  animalBreeding(@Param('id', UUID) id: string) {
    return this.breeding.forAnimal(id);
  }

  @Get('livestock/births-due')
  @RequirePermissions('livestock.read')
  birthsDue(@Query('days') days?: string, @Query('farmId') farmId?: string) {
    return this.breeding.dueSoon(Math.min(Math.max(Number(days) || 30, 1), 365), farmId && /^[0-9a-f-]{36}$/i.test(farmId) ? farmId : undefined);
  }

  // ── Species reproduction settings (configurable, sourced) ──
  @Get('livestock/species')
  @RequirePermissions('livestock.read')
  species() {
    return this.prisma.db.species.findMany({ where: { isActive: true, category: { not: 'COMPANION' } }, select: { id: true, name: true, category: true, gestationDays: true, gestationSource: true }, orderBy: { name: 'asc' } });
  }

  @Patch('livestock/species/:id')
  @RequirePermissions('settings.manage')
  @ApiZodBody(gestationSchema)
  async setGestation(@Param('id', UUID) id: string, @Body(zp(gestationSchema)) body: z.infer<typeof gestationSchema>) {
    const before = await this.prisma.db.species.findUnique({ where: { id } });
    if (!before) throw notFound('Species');
    const data = { gestationDays: body.gestationDays ?? null, gestationSource: body.gestationDays ? body.gestationSource ?? null : null };
    return this.prisma.db.$transaction(async (tx) => {
      const after = await tx.species.update({ where: { id }, data });
      await this.audit.record({ action: 'species.gestation_updated', entityType: 'Species', entityId: id, summary: before.name, changes: diff(before, after, ['gestationDays', 'gestationSource']) }, tx);
      return { id: after.id, name: after.name, category: after.category, gestationDays: after.gestationDays, gestationSource: after.gestationSource };
    });
  }

  // ── Production ──
  @Get('production')
  @RequirePermissions('livestock.read')
  @ApiZodQuery(productionQuery)
  productionList(@Query(zp(productionQuery)) q: z.infer<typeof productionQuery>) {
    return this.production.list(q);
  }

  @Post('production')
  @RequirePermissions('livestock.write')
  @ApiZodBody(productionSchema)
  record(@Body(zp(productionSchema)) body: z.infer<typeof productionSchema>) {
    return this.production.record(body);
  }

  @Post('production/milk-sheet')
  @RequirePermissions('livestock.write')
  @ApiZodBody(milkSheetSchema)
  milkSheet(@Body(zp(milkSheetSchema)) body: z.infer<typeof milkSheetSchema>) {
    return this.production.milkSheet(body);
  }

  @Post('production/:id/void')
  @HttpCode(200)
  @RequirePermissions('livestock.write')
  voidProduction(@Param('id', UUID) id: string, @Body(zp(voidSchema)) body: { reason: string }) {
    return this.production.void(id, body.reason);
  }

  // ── Herd health ──
  @Get('group-treatments')
  @RequirePermissions('livestock.read')
  treatments(@Query(zp(z.object({ farmId: z.string().uuid().optional(), groupId: z.string().uuid().optional(), fieldVisitId: z.string().uuid().optional() }))) q: { farmId?: string; groupId?: string; fieldVisitId?: string }) {
    return this.health.treatments(q);
  }

  @Post('group-treatments')
  @RequirePermissions('livestock.write')
  @ApiZodBody(groupTreatmentSchema)
  treat(@Body(zp(groupTreatmentSchema)) body: z.infer<typeof groupTreatmentSchema>) {
    return this.health.treat(body);
  }

  @Get('outbreaks')
  @RequirePermissions('livestock.read')
  outbreaks(@Query('farmId') farmId?: string, @Query('status') status?: string) {
    return this.health.outbreaks({ farmId: farmId && /^[0-9a-f-]{36}$/i.test(farmId) ? farmId : undefined, status: status && /^[A-Z_]{2,20}$/.test(status) ? status : undefined });
  }

  @Post('outbreaks')
  @RequirePermissions('livestock.write')
  @ApiZodBody(outbreakSchema)
  createOutbreak(@Body(zp(outbreakSchema)) body: z.infer<typeof outbreakSchema>) {
    return this.health.createOutbreak(body);
  }

  @Patch('outbreaks/:id')
  @RequirePermissions('livestock.write')
  @ApiZodBody(updateOutbreakSchema)
  updateOutbreak(@Param('id', UUID) id: string, @Body(zp(updateOutbreakSchema)) body: z.infer<typeof updateOutbreakSchema>) {
    return this.health.updateOutbreak(id, body);
  }

  // ── Field visits ──
  @Get('field-visits')
  @RequirePermissions('livestock.read')
  @ApiZodQuery(visitQuery)
  visitList(@Query(zp(visitQuery)) q: z.infer<typeof visitQuery>) {
    return this.visits.list(q);
  }

  @Post('field-visits')
  @RequirePermissions('livestock.write')
  @ApiZodBody(fieldVisitSchema)
  createVisit(@Body(zp(fieldVisitSchema)) body: z.infer<typeof fieldVisitSchema>) {
    return this.visits.create(body);
  }

  @Get('field-visits/:id')
  @RequirePermissions('livestock.read')
  visit(@Param('id', UUID) id: string) {
    return this.visits.get(id);
  }

  @Patch('field-visits/:id')
  @RequirePermissions('livestock.write')
  updateVisit(@Param('id', UUID) id: string, @Body(zp(updateFieldVisitSchema)) body: z.infer<typeof updateFieldVisitSchema>) {
    return this.visits.update(id, body);
  }

  @Post('field-visits/:id/start')
  @HttpCode(200)
  @RequirePermissions('livestock.write')
  startVisit(@Param('id', UUID) id: string) {
    return this.visits.start(id);
  }

  @Post('field-visits/:id/items')
  @RequirePermissions('livestock.write')
  @ApiZodBody(fieldVisitItemSchema)
  addItem(@Param('id', UUID) id: string, @Body(zp(fieldVisitItemSchema)) body: z.infer<typeof fieldVisitItemSchema>) {
    return this.visits.addItem(id, body);
  }

  @Post('field-visits/:id/complete')
  @HttpCode(200)
  @RequirePermissions('livestock.write')
  completeVisit(@Param('id', UUID) id: string, @Body(zp(completeFieldVisitSchema)) body: z.infer<typeof completeFieldVisitSchema>) {
    return this.visits.complete(id, body);
  }

  @Post('field-visits/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('livestock.write')
  cancelVisit(@Param('id', UUID) id: string, @Body(zp(cancelSchema)) body: { reason: string }) {
    return this.visits.cancel(id, body.reason);
  }
}
