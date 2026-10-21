import { formatInTimeZone } from 'date-fns-tz';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CARE_KINDS, cancelCareSchema, careItemSchema, careRepeatSchema, careProtocolSchema, completeCareSchema, deferCareSchema } from '@vcms/shared';
import { z } from 'zod';
import { AuditService } from '../../common/audit/audit.service';
import { RequireAnyPermission, RequirePermissions } from '../../common/auth/decorators';
import { RequestContext } from '../../common/context/request-context';
import { forbidden, notFound } from '../../common/http/errors';
import { ApiZodBody, ApiZodQuery, zp } from '../../common/http/zod';
import { PrismaService } from '../../common/prisma/prisma.service';
import { branchToday } from '../../common/time/branch-timezone';
import { MessagesService } from '../comms/messages.service';
import { CareService, effectiveDue } from './care.service';

const UUID = new ParseUUIDPipe();
const worklistQuery = z.object({
  range: z.enum(['overdue', 'week', 'month', 'all']).default('week'),
  kind: z.enum(CARE_KINDS).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

@ApiTags('preventive care')
@Controller()
export class PreventiveController {
  constructor(
    private readonly care: CareService,
    private readonly prisma: PrismaService,
    private readonly messages: MessagesService,
    private readonly audit: AuditService,
  ) {}

  @Get('care-protocols')
  @RequireAnyPermission('preventive.read', 'settings.manage')
  protocols(@Query('all') all?: string) {
    return this.care.listProtocols(all === 'true');
  }

  @Post('care-protocols')
  @RequirePermissions('preventive.write')
  @ApiZodBody(careProtocolSchema)
  createProtocol(@Body(zp(careProtocolSchema)) body: z.infer<typeof careProtocolSchema>) {
    return this.care.saveProtocol(null, body);
  }

  @Patch('care-protocols/:id')
  @RequirePermissions('preventive.write')
  updateProtocol(@Param('id', UUID) id: string, @Body(zp(careProtocolSchema)) body: z.infer<typeof careProtocolSchema>) {
    return this.care.saveProtocol(id, body);
  }

  @Post('care-protocols/:id/status')
  @HttpCode(200)
  @RequirePermissions('preventive.write')
  protocolStatus(@Param('id', UUID) id: string, @Body(zp(z.object({ status: z.enum(['APPROVED', 'RETIRED']) }))) body: { status: 'APPROVED' | 'RETIRED' }) {
    return this.care.setProtocolStatus(id, body.status);
  }

  @Post('care-protocols/:id/apply-all')
  @HttpCode(200)
  @RequirePermissions('preventive.write')
  applyAll(@Param('id', UUID) id: string) {
    return this.care.applyToAll(id);
  }

  @Get('patients/:id/care-plan')
  @RequirePermissions('preventive.read')
  plan(@Param('id', UUID) id: string) {
    return this.care.plan(id);
  }

  @Post('patients/:id/care-plan/apply')
  @HttpCode(200)
  @RequirePermissions('preventive.write')
  apply(@Param('id', UUID) id: string, @Body(zp(z.object({ protocolIds: z.array(z.string().uuid()).max(50).optional() }))) body: { protocolIds?: string[] }) {
    return this.care.applyProtocols(id, body.protocolIds);
  }

  @Get('patients/:id/vaccination-certificate')
  @RequirePermissions('preventive.read')
  certificate(@Param('id', UUID) id: string) {
    return this.care.certificate(id);
  }

  @Get('care-items')
  @RequirePermissions('preventive.read')
  @ApiZodQuery(worklistQuery)
  worklist(@Query(zp(worklistQuery)) q: z.infer<typeof worklistQuery>) {
    return this.care.worklist(q);
  }

  @Post('care-items')
  @RequirePermissions('preventive.write')
  @ApiZodBody(careItemSchema)
  addItem(@Body(zp(careItemSchema)) body: z.infer<typeof careItemSchema>) {
    return this.care.addItem(body);
  }

  @Post('care-items/:id/complete')
  @HttpCode(200)
  @RequirePermissions('preventive.write')
  @ApiZodBody(completeCareSchema)
  complete(@Param('id', UUID) id: string, @Body(zp(completeCareSchema)) body: z.infer<typeof completeCareSchema>) {
    // Giving a vaccine or medicine here is a clinical administration.
    if (body.mode === 'ADMINISTER' && !RequestContext.require().permissions.has('clinical.write')) throw forbidden('Recording an administration needs clinical permission');
    return this.care.complete(id, body);
  }

  @Post('care-items/:id/repeat')
  @HttpCode(200)
  @RequirePermissions('preventive.write')
  @ApiZodBody(careRepeatSchema)
  setRepeat(@Param('id', UUID) id: string, @Body(zp(careRepeatSchema)) body: z.infer<typeof careRepeatSchema>) {
    return this.care.setRepeat(id, body);
  }

  @Post('care-items/:id/defer')
  @HttpCode(200)
  @RequirePermissions('preventive.write')
  defer(@Param('id', UUID) id: string, @Body(zp(deferCareSchema)) body: z.infer<typeof deferCareSchema>) {
    return this.care.defer(id, body.until, body.reason);
  }

  @Post('care-items/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('preventive.write')
  cancel(@Param('id', UUID) id: string, @Body(zp(cancelCareSchema)) body: z.infer<typeof cancelCareSchema>) {
    return this.care.cancel(id, body.reason);
  }

  /** Sends a care reminder for one item now (staff-initiated; still respects the client's opt-out). */
  @Post('care-items/:id/remind')
  @HttpCode(200)
  @RequirePermissions('communications.send')
  async remind(@Param('id', UUID) id: string) {
    const db = this.prisma.db;
    const item = await db.careItem.findUnique({ where: { id }, include: { patient: { select: { name: true, ownerships: { where: { endedAt: null, isPrimary: true }, select: { client: true } } } } } });
    if (!item) throw notFound('Care item');
    const client = item.patient.ownerships[0]?.client;
    if (!client) throw notFound('Owner');
    if (!client.remindersConsent) return { status: 'OPTED_OUT' };
    const org = await this.prisma.raw.organization.findUniqueOrThrow({ where: { id: RequestContext.orgId() } });
    const channel = await this.messages.chooseChannel(client);
    const due = effectiveDue(item);
    const today = await branchToday(this.prisma);
    const overdue = due < today;
    return db.$transaction(async (tx) => {
      const m = await this.messages.enqueueTemplate(
        tx,
        overdue ? 'CARE_OVERDUE' : 'CARE_REMINDER',
        channel,
        { clinicName: org.name, clinicPhone: org.phone ?? '', clinicPhoneLine: org.phone ? ` on ${org.phone}` : '', clientName: client.displayName, petNames: item.patient.name, items: `• ${item.patient.name}: ${item.title} — ${due.toISOString().slice(0, 10)}`, itemsShort: item.title, dueDate: formatInTimeZone(due, 'UTC', 'd MMM yyyy') },
        { clientId: client.id, patientId: item.patientId, recipient: MessagesService.recipientFor(client, channel), dedupeKey: `manual-care:${item.id}:${today.toISOString().slice(0, 10)}`, sourceType: 'CareItem', sourceId: item.id },
      );
      await tx.careItem.update({ where: { id }, data: overdue ? { overdueRemindedAt: new Date() } : { remindedAt: new Date() } });
      await this.audit.record({ action: 'care_item.reminder_sent', entityType: 'Patient', entityId: item.patientId, summary: item.title }, tx);
      return { status: m.status, messageId: m.id };
    });
  }

  @Get('preventive/compliance')
  @RequireAnyPermission('preventive.read', 'reports.view')
  compliance() {
    return this.care.compliance();
  }
}
