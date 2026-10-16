import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  addendumSchema,
  admitSchema,
  anaesthesiaReadingSchema,
  cageSchema,
  checklistItemSchema,
  checklistTickSchema,
  completeTaskSchema,
  consentSchema,
  dischargeSchema,
  escalateSchema,
  hospitalNoteSchema,
  moveAdmissionSchema,
  scheduleSurgerySchema,
  stopOrderSchema,
  surgeryItemSchema,
  surgeryTeamSchema,
  surgeryTransitionSchema,
  treatmentOrderSchema,
  updateAdmissionSchema,
  updateSurgerySchema,
  vitalsSchema,
  wardSchema,
} from '@vcms/shared';
import { z } from 'zod';
import { RequireAnyPermission, RequirePermissions } from '../../common/auth/decorators';
import { RequestContext } from '../../common/context/request-context';
import { forbidden, notFound } from '../../common/http/errors';
import { ApiZodBody, ApiZodQuery, zp } from '../../common/http/zod';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ClinicalRecordsService } from '../clinical/clinical-records.service';
import { AdmissionsService } from './admissions.service';
import { SurgeryService } from './surgery.service';
import { TreatmentsService } from './treatments.service';
import { WardsService } from './wards.service';

const UUID = new ParseUUIDPipe();
const reason = z.object({ reason: z.string().trim().min(1).max(500) });
const admissionListQuery = z.object({
  status: z.enum(['ADMITTED', 'DISCHARGED', 'CANCELLED']).optional(),
  patientId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
const windowQuery = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() });
const surgeryListQuery = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional(), status: z.string().max(100).optional(), patientId: z.string().uuid().optional() });

@ApiTags('hospital')
@Controller()
export class HospitalController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wards: WardsService,
    private readonly admissions: AdmissionsService,
    private readonly treatments: TreatmentsService,
    private readonly surgery: SurgeryService,
    private readonly clinical: ClinicalRecordsService,
  ) {}

  // ── Wards & cages ──
  @Get('wards')
  @RequireAnyPermission('hospital.read', 'settings.manage')
  listWards(@Query('branchId') branchId?: string, @Query('all') all?: string) {
    return this.wards.list(branchId || undefined, all === 'true');
  }

  @Post('wards')
  @RequirePermissions('settings.manage')
  @ApiZodBody(wardSchema)
  createWard(@Body(zp(wardSchema)) body: z.infer<typeof wardSchema>) {
    return this.wards.saveWard(null, body);
  }

  @Patch('wards/:id')
  @RequirePermissions('settings.manage')
  updateWard(@Param('id', UUID) id: string, @Body(zp(wardSchema)) body: z.infer<typeof wardSchema>) {
    return this.wards.saveWard(id, body);
  }

  @Post('cages')
  @RequirePermissions('settings.manage')
  @ApiZodBody(cageSchema)
  createCage(@Body(zp(cageSchema)) body: z.infer<typeof cageSchema>) {
    return this.wards.saveCage(null, body);
  }

  @Patch('cages/:id')
  @RequirePermissions('settings.manage')
  updateCage(@Param('id', UUID) id: string, @Body(zp(cageSchema)) body: z.infer<typeof cageSchema>) {
    return this.wards.saveCage(id, body);
  }

  // ── Admissions ──
  @Get('hospital/flowboard')
  @RequirePermissions('hospital.read')
  flowboard(@Query('branchId') branchId?: string) {
    return this.admissions.flowboard(branchId || undefined);
  }

  @Get('admissions')
  @RequirePermissions('hospital.read')
  @ApiZodQuery(admissionListQuery)
  list(@Query(zp(admissionListQuery)) q: z.infer<typeof admissionListQuery>) {
    return this.admissions.list(q);
  }

  @Post('admissions')
  @RequirePermissions('hospital.write')
  @ApiZodBody(admitSchema)
  admit(@Body(zp(admitSchema)) body: z.infer<typeof admitSchema>) {
    return this.admissions.admit(body);
  }

  @Get('admissions/:id')
  @RequirePermissions('hospital.read')
  get(@Param('id', UUID) id: string) {
    return this.admissions.get(id);
  }

  @Patch('admissions/:id')
  @RequirePermissions('hospital.write')
  @ApiZodBody(updateAdmissionSchema)
  update(@Param('id', UUID) id: string, @Body(zp(updateAdmissionSchema)) body: z.infer<typeof updateAdmissionSchema>) {
    return this.admissions.update(id, body);
  }

  @Post('admissions/:id/move')
  @HttpCode(200)
  @RequirePermissions('hospital.write')
  move(@Param('id', UUID) id: string, @Body(zp(moveAdmissionSchema)) body: z.infer<typeof moveAdmissionSchema>) {
    return this.admissions.move(id, body.wardId, body.cageId);
  }

  @Post('admissions/:id/notes')
  @RequirePermissions('hospital.write')
  note(@Param('id', UUID) id: string, @Body(zp(hospitalNoteSchema)) body: z.infer<typeof hospitalNoteSchema>) {
    return this.admissions.addNote(id, body.type, body.text);
  }

  @Post('admissions/:id/escalate')
  @HttpCode(200)
  @RequirePermissions('hospital.write')
  escalate(@Param('id', UUID) id: string, @Body(zp(escalateSchema)) body: z.infer<typeof escalateSchema>) {
    return this.admissions.escalate(id, body.reason);
  }

  @Post('admissions/:id/discharge')
  @HttpCode(200)
  @RequirePermissions('hospital.write')
  @ApiZodBody(dischargeSchema)
  discharge(@Param('id', UUID) id: string, @Body(zp(dischargeSchema)) body: z.infer<typeof dischargeSchema>) {
    return this.admissions.discharge(id, body);
  }

  @Post('admissions/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('hospital.write')
  cancel(@Param('id', UUID) id: string, @Body(zp(reason)) body: { reason: string }) {
    return this.admissions.cancel(id, body.reason);
  }

  @Get('admissions/:id/sheet')
  @RequirePermissions('hospital.read')
  sheet(@Param('id', UUID) id: string, @Query(zp(windowQuery)) q: z.infer<typeof windowQuery>) {
    return this.treatments.sheet(id, q.from, q.to);
  }

  @Post('admissions/:id/orders')
  @RequirePermissions('hospital.write')
  @ApiZodBody(treatmentOrderSchema)
  order(@Param('id', UUID) id: string, @Body(zp(treatmentOrderSchema)) body: z.infer<typeof treatmentOrderSchema>) {
    // Medication orders are prescribing decisions.
    if (body.kind === 'MEDICATION' && !RequestContext.require().permissions.has('prescriptions.write')) throw forbidden('Medication orders need prescribing permission');
    return this.treatments.createOrder(id, body);
  }

  @Post('treatment-orders/:id/stop')
  @HttpCode(200)
  @RequirePermissions('hospital.write')
  stopOrder(@Param('id', UUID) id: string, @Body(zp(stopOrderSchema)) body: z.infer<typeof stopOrderSchema>) {
    return this.treatments.stopOrder(id, body.reason);
  }

  @Post('treatment-orders/:id/give')
  @HttpCode(200)
  @RequirePermissions('hospital.write')
  giveNow(@Param('id', UUID) id: string, @Body(zp(completeTaskSchema)) body: z.infer<typeof completeTaskSchema>) {
    return this.treatments.giveNow(id, body);
  }

  @Post('treatment-tasks/:id/complete')
  @HttpCode(200)
  @RequirePermissions('hospital.write')
  @ApiZodBody(completeTaskSchema)
  complete(@Param('id', UUID) id: string, @Body(zp(completeTaskSchema)) body: z.infer<typeof completeTaskSchema>) {
    return this.treatments.completeTask(id, body);
  }

  @Get('admissions/:id/vitals')
  @RequirePermissions('hospital.read')
  async vitals(@Param('id', UUID) id: string) {
    const a = await this.prisma.db.admission.findUnique({ where: { id } });
    if (!a) throw notFound('Admission');
    return this.clinical.listVitals(a.patientId, 300, id);
  }

  @Post('admissions/:id/vitals')
  @RequirePermissions('hospital.write')
  @ApiZodBody(vitalsSchema)
  async recordVitals(@Param('id', UUID) id: string, @Body(zp(vitalsSchema)) body: z.infer<typeof vitalsSchema>) {
    const a = await this.prisma.db.admission.findUnique({ where: { id } });
    if (!a) throw notFound('Admission');
    return this.clinical.recordVitals(a.patientId, a.encounterId, body, id);
  }

  @Get('patients/:id/hospital-status')
  @RequirePermissions('patients.read')
  patientStatus(@Param('id', UUID) id: string) {
    return this.admissions.patientStatus(id);
  }

  // ── Surgery ──
  @Get('surgeries')
  @RequirePermissions('surgery.read')
  @ApiZodQuery(surgeryListQuery)
  surgeries(@Query(zp(surgeryListQuery)) q: z.infer<typeof surgeryListQuery>) {
    return this.surgery.list(q);
  }

  @Post('surgeries')
  @RequirePermissions('surgery.write')
  @ApiZodBody(scheduleSurgerySchema)
  schedule(@Body(zp(scheduleSurgerySchema)) body: z.infer<typeof scheduleSurgerySchema>) {
    return this.surgery.schedule(body);
  }

  @Get('surgeries/:id')
  @RequirePermissions('surgery.read')
  surgeryDetail(@Param('id', UUID) id: string) {
    return this.surgery.get(id);
  }

  @Patch('surgeries/:id')
  @RequirePermissions('surgery.write')
  @ApiZodBody(updateSurgerySchema)
  updateSurgery(@Param('id', UUID) id: string, @Body(zp(updateSurgerySchema)) body: z.infer<typeof updateSurgerySchema>) {
    return this.surgery.update(id, body);
  }

  @Post('surgeries/:id/consent')
  @HttpCode(200)
  @RequirePermissions('surgery.write')
  consent(@Param('id', UUID) id: string, @Body(zp(consentSchema)) body: z.infer<typeof consentSchema>) {
    return this.surgery.recordConsent(id, body.givenBy, body.notes);
  }

  @Post('surgeries/:id/checklist')
  @HttpCode(200)
  @RequirePermissions('surgery.write')
  tick(@Param('id', UUID) id: string, @Body(zp(checklistTickSchema)) body: z.infer<typeof checklistTickSchema>) {
    return this.surgery.tickChecklist(id, body.key, body.checked);
  }

  @Put('surgeries/:id/team')
  @RequirePermissions('surgery.write')
  team(@Param('id', UUID) id: string, @Body(zp(surgeryTeamSchema)) body: z.infer<typeof surgeryTeamSchema>) {
    return this.surgery.setTeam(id, body.members);
  }

  @Post('surgeries/:id/status')
  @HttpCode(200)
  @RequirePermissions('surgery.write')
  @ApiZodBody(surgeryTransitionSchema)
  surgeryStatus(@Param('id', UUID) id: string, @Body(zp(surgeryTransitionSchema)) body: z.infer<typeof surgeryTransitionSchema>) {
    return this.surgery.transition(id, body.action, body.reason);
  }

  @Post('surgeries/:id/readings')
  @RequirePermissions('surgery.write')
  @ApiZodBody(anaesthesiaReadingSchema)
  reading(@Param('id', UUID) id: string, @Body(zp(anaesthesiaReadingSchema)) body: z.infer<typeof anaesthesiaReadingSchema>) {
    return this.surgery.addReading(id, body);
  }

  @Post('surgeries/:id/items')
  @RequirePermissions('surgery.write')
  item(@Param('id', UUID) id: string, @Body(zp(surgeryItemSchema)) body: z.infer<typeof surgeryItemSchema>) {
    return this.surgery.addItem(id, body.productId, body.quantity, body.notes);
  }

  @Post('surgeries/:id/addenda')
  @RequirePermissions('surgery.write')
  addendum(@Param('id', UUID) id: string, @Body(zp(addendumSchema)) body: z.infer<typeof addendumSchema>) {
    return this.surgery.addAddendum(id, body.text);
  }

  @Get('surgery-checklist')
  @RequireAnyPermission('surgery.read', 'settings.manage')
  checklist() {
    return this.surgery.checklistTemplate();
  }

  @Post('surgery-checklist')
  @RequirePermissions('settings.manage')
  addChecklistItem(@Body(zp(checklistItemSchema)) body: z.infer<typeof checklistItemSchema>) {
    return this.surgery.saveChecklistItem(null, body);
  }

  @Patch('surgery-checklist/:id')
  @RequirePermissions('settings.manage')
  updateChecklistItem(@Param('id', UUID) id: string, @Body(zp(checklistItemSchema)) body: z.infer<typeof checklistItemSchema>) {
    return this.surgery.saveChecklistItem(id, body);
  }
}
