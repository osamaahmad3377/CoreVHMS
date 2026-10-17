import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  alertSchema,
  archiveSchema,
  createPatientSchema,
  deceasedSchema,
  identifierSchema,
  mergePatientsSchema,
  patientListQuery,
  transferOwnershipSchema,
  updatePatientSchema,
  weightSchema,
} from '@vcms/shared';
import { z } from 'zod';
import { RequirePermissions } from '../../common/auth/decorators';
import { ApiZodBody, ApiZodQuery, zp } from '../../common/http/zod';
import { PatientMergeService } from './patient-merge.service';
import { PatientTimelineService } from './patient-timeline.service';
import { PatientsService } from './patients.service';

const UUID = new ParseUUIDPipe();
// The check runs while the form is being filled in, so a field not chosen yet ('' or null) is simply ignored.
const optionalId = z.preprocess((v) => (v === '' || v === null ? undefined : v), z.string().uuid().optional());
const duplicateQuery = z.object({
  name: z.string().max(80).optional(),
  ownerId: optionalId,
  speciesId: optionalId,
  identifiers: z.array(z.string().max(64)).max(10).optional(),
  excludeId: optionalId,
});

@ApiTags('patients')
@Controller('patients')
export class PatientsController {
  constructor(
    private readonly patients: PatientsService,
    private readonly merger: PatientMergeService,
    private readonly timelines: PatientTimelineService,
  ) {}

  @Get()
  @RequirePermissions('patients.read')
  @ApiZodQuery(patientListQuery)
  list(@Query(zp(patientListQuery)) q: z.infer<typeof patientListQuery>) {
    return this.patients.list(q);
  }

  @Post('duplicates')
  @HttpCode(200)
  @RequirePermissions('patients.read')
  @ApiZodBody(duplicateQuery)
  duplicates(@Body(zp(duplicateQuery)) body: z.infer<typeof duplicateQuery>) {
    return this.patients.findDuplicates(body);
  }

  @Post('merge')
  @HttpCode(200)
  @RequirePermissions('patients.merge')
  @ApiZodBody(mergePatientsSchema)
  merge(@Body(zp(mergePatientsSchema)) body: z.infer<typeof mergePatientsSchema>) {
    return this.merger.merge(body.survivorId, body.mergedId, body.reason);
  }

  @Get(':id')
  @RequirePermissions('patients.read')
  get(@Param('id', UUID) id: string) {
    return this.patients.get(id);
  }

  @Get(':id/timeline')
  @RequirePermissions('patients.read')
  async timeline(@Param('id', UUID) id: string, @Query('kinds') kinds?: string) {
    await this.patients.mustExist(id);
    return {
      kinds: this.timelines.kinds(),
      events: await this.timelines.timeline(id, { kinds: kinds ? kinds.split(',').slice(0, 20) : undefined }),
    };
  }

  @Post()
  @RequirePermissions('patients.write')
  @ApiZodBody(createPatientSchema)
  create(@Body(zp(createPatientSchema)) body: z.infer<typeof createPatientSchema>) {
    return this.patients.create(body);
  }

  @Patch(':id')
  @RequirePermissions('patients.write')
  @ApiZodBody(updatePatientSchema)
  update(@Param('id', UUID) id: string, @Body(zp(updatePatientSchema)) body: z.infer<typeof updatePatientSchema>) {
    return this.patients.update(id, body);
  }

  @Post(':id/photo')
  @HttpCode(200)
  @RequirePermissions('patients.write')
  setPhoto(@Param('id', UUID) id: string, @Body(zp(z.object({ attachmentId: z.string().uuid().nullable() }))) body: { attachmentId: string | null }) {
    return this.patients.setPhoto(id, body.attachmentId);
  }

  @Post(':id/identifiers')
  @RequirePermissions('patients.write')
  @ApiZodBody(identifierSchema)
  addIdentifier(@Param('id', UUID) id: string, @Body(zp(identifierSchema)) body: z.infer<typeof identifierSchema>) {
    return this.patients.addIdentifier(id, body);
  }

  @Delete(':id/identifiers/:identifierId')
  @HttpCode(204)
  @RequirePermissions('patients.write')
  removeIdentifier(@Param('id', UUID) id: string, @Param('identifierId', UUID) identifierId: string) {
    return this.patients.removeIdentifier(id, identifierId);
  }

  @Post(':id/weights')
  @RequirePermissions('patients.write')
  @ApiZodBody(weightSchema)
  addWeight(@Param('id', UUID) id: string, @Body(zp(weightSchema)) body: z.infer<typeof weightSchema>) {
    return this.patients.addWeight(id, body);
  }

  @Post(':id/alerts')
  @RequirePermissions('patients.write')
  @ApiZodBody(alertSchema)
  addAlert(@Param('id', UUID) id: string, @Body(zp(alertSchema)) body: z.infer<typeof alertSchema>) {
    return this.patients.addAlert(id, body);
  }

  @Patch(':id/alerts/:alertId')
  @RequirePermissions('patients.write')
  updateAlert(
    @Param('id', UUID) id: string,
    @Param('alertId', UUID) alertId: string,
    @Body(zp(alertSchema.partial())) body: Partial<z.infer<typeof alertSchema>>,
  ) {
    return this.patients.updateAlert(id, alertId, body);
  }

  @Post(':id/deceased')
  @HttpCode(200)
  @RequirePermissions('patients.archive')
  @ApiZodBody(deceasedSchema)
  deceased(@Param('id', UUID) id: string, @Body(zp(deceasedSchema)) body: z.infer<typeof deceasedSchema>) {
    return this.patients.recordDeath(id, body);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermissions('patients.archive')
  @ApiZodBody(archiveSchema)
  archive(@Param('id', UUID) id: string, @Body(zp(archiveSchema)) body: z.infer<typeof archiveSchema>) {
    return this.patients.archive(id, body.reason);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @RequirePermissions('patients.archive')
  restore(@Param('id', UUID) id: string) {
    return this.patients.restore(id);
  }

  @Post(':id/transfer')
  @HttpCode(200)
  @RequirePermissions('patients.write', 'clients.read')
  @ApiZodBody(transferOwnershipSchema)
  transfer(@Param('id', UUID) id: string, @Body(zp(transferOwnershipSchema)) body: z.infer<typeof transferOwnershipSchema>) {
    return this.patients.transferOwnership(id, body.newOwnerId, body.reason, body.effectiveAt);
  }

  @Post(':id/co-owners')
  @RequirePermissions('patients.write', 'clients.read')
  addCoOwner(@Param('id', UUID) id: string, @Body(zp(z.object({ clientId: z.string().uuid() }))) body: { clientId: string }) {
    return this.patients.addCoOwner(id, body.clientId);
  }

  @Delete(':id/co-owners/:ownershipId')
  @HttpCode(204)
  @RequirePermissions('patients.write')
  removeCoOwner(@Param('id', UUID) id: string, @Param('ownershipId', UUID) ownershipId: string) {
    return this.patients.removeCoOwner(id, ownershipId);
  }
}
