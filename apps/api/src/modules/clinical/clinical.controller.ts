import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  ENCOUNTER_TYPES,
  amendNoteSchema,
  clinicalTemplateSchema,
  diagnosisSchema,
  encounterListQuery,
  noteContentSchema,
  problemSchema,
  startEncounterSchema,
  taskListQuery,
  taskSchema,
  vitalReferenceSchema,
  vitalsSchema,
} from '@vcms/shared';
import { z } from 'zod';
import { RequireAnyPermission, RequirePermissions } from '../../common/auth/decorators';
import { ApiZodBody, ApiZodQuery, zp } from '../../common/http/zod';
import { ClinicalRecordsService } from './clinical-records.service';
import { EncountersService } from './encounters.service';
import { NotesService } from './notes.service';

const UUID = new ParseUUIDPipe();

@ApiTags('clinical')
@Controller()
export class ClinicalController {
  constructor(
    private readonly encounters: EncountersService,
    private readonly notes: NotesService,
    private readonly records: ClinicalRecordsService,
  ) {}

  // ── Encounters ──
  @Get('encounters')
  @RequirePermissions('clinical.read')
  @ApiZodQuery(encounterListQuery)
  list(@Query(zp(encounterListQuery)) q: z.infer<typeof encounterListQuery>) {
    return this.encounters.list(q);
  }

  @Get('encounters/:id')
  @RequirePermissions('clinical.read')
  get(@Param('id', UUID) id: string) {
    return this.encounters.get(id);
  }

  @Post('encounters')
  @RequirePermissions('clinical.write')
  @ApiZodBody(startEncounterSchema)
  start(@Body(zp(startEncounterSchema)) body: z.infer<typeof startEncounterSchema>) {
    return this.encounters.start(body);
  }

  @Patch('encounters/:id')
  @RequirePermissions('clinical.write')
  update(
    @Param('id', UUID) id: string,
    @Body(zp(z.object({ chiefComplaint: z.string().max(500).nullish(), type: z.enum(ENCOUNTER_TYPES).optional(), clinicianId: z.string().uuid().nullish() }))) body: any,
  ) {
    return this.encounters.update(id, body);
  }

  @Post('encounters/:id/complete')
  @HttpCode(200)
  @RequirePermissions('clinical.write')
  complete(@Param('id', UUID) id: string) {
    return this.encounters.complete(id);
  }

  @Post('encounters/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('clinical.write')
  cancel(@Param('id', UUID) id: string, @Body(zp(z.object({ reason: z.string().trim().min(1).max(500) }))) body: { reason: string }) {
    return this.encounters.cancel(id, body.reason);
  }

  // ── Notes ──
  @Post('encounters/:id/notes')
  @RequirePermissions('clinical.write')
  @ApiZodBody(noteContentSchema)
  createNote(@Param('id', UUID) id: string, @Body(zp(noteContentSchema)) body: z.infer<typeof noteContentSchema>) {
    return this.notes.create(id, body);
  }

  @Patch('notes/:id')
  @RequirePermissions('clinical.write')
  @ApiZodBody(noteContentSchema)
  updateNote(@Param('id', UUID) id: string, @Body(zp(noteContentSchema.partial())) body: Partial<z.infer<typeof noteContentSchema>>) {
    return this.notes.update(id, body);
  }

  @Delete('notes/:id')
  @HttpCode(204)
  @RequirePermissions('clinical.write')
  discardNote(@Param('id', UUID) id: string) {
    return this.notes.discard(id);
  }

  @Post('notes/:id/review')
  @HttpCode(200)
  @RequirePermissions('clinical.sign')
  review(@Param('id', UUID) id: string) {
    return this.notes.review(id);
  }

  @Post('notes/:id/sign')
  @HttpCode(200)
  @RequirePermissions('clinical.sign')
  sign(@Param('id', UUID) id: string) {
    return this.notes.sign(id);
  }

  @Post('notes/:id/amend')
  @RequirePermissions('clinical.amend')
  @ApiZodBody(amendNoteSchema)
  amend(@Param('id', UUID) id: string, @Body(zp(amendNoteSchema)) body: z.infer<typeof amendNoteSchema>) {
    return this.notes.amend(id, body);
  }

  @Get('notes/:id/verify')
  @RequirePermissions('clinical.read')
  verify(@Param('id', UUID) id: string) {
    return this.notes.verify(id);
  }

  // ── Vitals ──
  @Post('encounters/:id/vitals')
  @RequirePermissions('clinical.write')
  @ApiZodBody(vitalsSchema)
  async encounterVitals(@Param('id', UUID) id: string, @Body(zp(vitalsSchema)) body: z.infer<typeof vitalsSchema>) {
    const e = await this.encounters.get(id);
    return this.records.recordVitals(e.patientId, id, body);
  }

  @Post('patients/:id/vitals')
  @RequireAnyPermission('clinical.write', 'hospital.write', 'triage.write')
  @ApiZodBody(vitalsSchema)
  patientVitals(@Param('id', UUID) id: string, @Body(zp(vitalsSchema)) body: z.infer<typeof vitalsSchema>) {
    return this.records.recordVitals(id, null, body);
  }

  @Get('patients/:id/vitals')
  @RequirePermissions('clinical.read')
  listVitals(@Param('id', UUID) id: string) {
    return this.records.listVitals(id);
  }

  // ── Diagnoses & problems ──
  @Post('encounters/:id/diagnoses')
  @RequirePermissions('clinical.write')
  @ApiZodBody(diagnosisSchema)
  addDiagnosis(@Param('id', UUID) id: string, @Body(zp(diagnosisSchema)) body: z.infer<typeof diagnosisSchema>) {
    return this.records.addDiagnosis(id, body);
  }

  @Patch('diagnoses/:id')
  @RequirePermissions('clinical.write')
  updateDiagnosis(@Param('id', UUID) id: string, @Body(zp(diagnosisSchema.omit({ addToProblemList: true }).partial())) body: any) {
    return this.records.updateDiagnosis(id, body);
  }

  @Get('patients/:id/diagnoses')
  @RequirePermissions('clinical.read')
  diagnoses(@Param('id', UUID) id: string) {
    return this.records.patientDiagnoses(id);
  }

  @Get('patients/:id/problems')
  @RequirePermissions('clinical.read')
  problems(@Param('id', UUID) id: string) {
    return this.records.listProblems(id);
  }

  @Post('patients/:id/problems')
  @RequirePermissions('clinical.write')
  @ApiZodBody(problemSchema)
  addProblem(@Param('id', UUID) id: string, @Body(zp(problemSchema)) body: z.infer<typeof problemSchema>) {
    return this.records.addProblem(id, body);
  }

  @Patch('patients/:id/problems/:problemId')
  @RequirePermissions('clinical.write')
  updateProblem(@Param('id', UUID) id: string, @Param('problemId', UUID) problemId: string, @Body(zp(problemSchema.partial())) body: any) {
    return this.records.updateProblem(id, problemId, body);
  }

  // ── Templates & references ──
  @Get('clinical-templates')
  @RequireAnyPermission('clinical.read', 'settings.manage')
  templates(@Query('all') all?: string) {
    return this.records.listTemplates(all === 'true');
  }

  @Post('clinical-templates')
  @RequirePermissions('settings.manage')
  @ApiZodBody(clinicalTemplateSchema)
  createTemplate(@Body(zp(clinicalTemplateSchema)) body: z.infer<typeof clinicalTemplateSchema>) {
    return this.records.saveTemplate(null, body);
  }

  @Patch('clinical-templates/:id')
  @RequirePermissions('settings.manage')
  updateTemplate(@Param('id', UUID) id: string, @Body(zp(clinicalTemplateSchema)) body: z.infer<typeof clinicalTemplateSchema>) {
    return this.records.saveTemplate(id, body);
  }

  @Get('vital-references')
  @RequireAnyPermission('clinical.read', 'settings.manage')
  references(@Query('speciesId') speciesId?: string) {
    return this.records.listReferences(speciesId && /^[0-9a-f-]{36}$/i.test(speciesId) ? speciesId : undefined);
  }

  @Post('vital-references')
  @RequirePermissions('settings.manage', 'clinical.sign')
  @ApiZodBody(vitalReferenceSchema)
  saveReference(@Body(zp(vitalReferenceSchema)) body: z.infer<typeof vitalReferenceSchema>) {
    return this.records.saveReference(body);
  }

  @Delete('vital-references/:id')
  @HttpCode(204)
  @RequirePermissions('settings.manage')
  removeReference(@Param('id', UUID) id: string) {
    return this.records.removeReference(id);
  }

  // ── Tasks ──
  @Get('tasks')
  @RequireAnyPermission('clinical.read', 'appointments.read', 'dashboard.view')
  @ApiZodQuery(taskListQuery)
  tasks(@Query(zp(taskListQuery)) q: z.infer<typeof taskListQuery>) {
    return this.records.listTasks(q);
  }

  @Post('tasks')
  @RequireAnyPermission('clinical.write', 'appointments.write')
  @ApiZodBody(taskSchema)
  createTask(@Body(zp(taskSchema)) body: z.infer<typeof taskSchema>) {
    return this.records.createTask(body);
  }

  @Post('tasks/:id/status')
  @HttpCode(200)
  @RequireAnyPermission('clinical.write', 'appointments.write', 'appointments.checkin')
  taskStatus(@Param('id', UUID) id: string, @Body(zp(z.object({ status: z.enum(['OPEN', 'DONE', 'CANCELLED']) }))) body: { status: 'OPEN' | 'DONE' | 'CANCELLED' }) {
    return this.records.setTaskStatus(id, body.status);
  }
}
