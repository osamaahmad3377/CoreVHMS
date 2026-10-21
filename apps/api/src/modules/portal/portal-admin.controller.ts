import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { requestDecisionSchema } from '@vcms/shared';
import { z } from 'zod';
import { AuditService } from '../../common/audit/audit.service';
import { RequireAnyPermission, RequirePermissions } from '../../common/auth/decorators';
import { RequestContext } from '../../common/context/request-context';
import { notFound, ruleViolation } from '../../common/http/errors';
import { zp } from '../../common/http/zod';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AttachmentsService } from '../attachments/attachments.service';
import { PortalAuthService } from './portal-auth.service';

const UUID = new ParseUUIDPipe();

/**
 * Staff side of the client portal: invitations, appointment requests, secure client messages and sharing
 * documents with clients. Only loaded together with the portal (CLIENT_PORTAL_ENABLED=true).
 */
@ApiTags('client portal (staff)')
@Controller()
export class PortalAdminController {
  constructor(
    private readonly auth: PortalAuthService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly attachments: AttachmentsService,
  ) {}

  @Get('clients/:id/portal')
  @RequirePermissions('clients.read')
  status(@Param('id', UUID) id: string) {
    return this.auth.status(id);
  }

  @Post('clients/:id/portal-invite')
  @HttpCode(200)
  @RequirePermissions('communications.send', 'clients.read')
  invite(@Param('id', UUID) id: string) {
    return this.auth.invite(id);
  }

  @Post('clients/:id/portal-revoke')
  @HttpCode(200)
  @RequirePermissions('communications.send', 'clients.write')
  revoke(@Param('id', UUID) id: string) {
    return this.auth.revoke(id);
  }

  @Get('appointment-requests')
  @RequireAnyPermission('appointments.write', 'appointments.checkin')
  async requests(@Query('status') status?: string) {
    const rows = await this.prisma.db.appointmentRequest.findMany({
      where: { status: (status as any) || 'PENDING' },
      include: { client: { select: { id: true, displayName: true, mobilePhone: true, email: true } } },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    const patients = await this.prisma.db.patient.findMany({ where: { id: { in: rows.map((r) => r.patientId).filter(Boolean) as string[] } }, select: { id: true, name: true, species: { select: { name: true } } } });
    return rows.map((r) => ({ ...r, patient: patients.find((p) => p.id === r.patientId) ?? null }));
  }

  @Post('appointment-requests/:id/decision')
  @HttpCode(200)
  @RequirePermissions('appointments.write')
  async decide(@Param('id', UUID) id: string, @Body(zp(requestDecisionSchema)) body: z.infer<typeof requestDecisionSchema>) {
    const ctx = RequestContext.require();
    const r = await this.prisma.db.appointmentRequest.findUnique({ where: { id } });
    if (!r) throw notFound('Request');
    if (r.status !== 'PENDING') throw ruleViolation('NOT_PENDING', 'This request has already been handled');
    if (body.action === 'booked') {
      if (!body.appointmentId) throw ruleViolation('APPOINTMENT_REQUIRED', 'Book the appointment first, then mark the request as booked');
      const a = await this.prisma.db.appointment.findUnique({ where: { id: body.appointmentId } });
      if (!a || a.clientId !== r.clientId) throw ruleViolation('INVALID_APPOINTMENT', 'The appointment must belong to the same client');
    } else if (!body.reason) throw ruleViolation('REASON_REQUIRED', 'Give the client a reason');
    return this.prisma.db.$transaction(async (tx) => {
      const after = await tx.appointmentRequest.update({
        where: { id },
        data: { status: body.action === 'booked' ? 'BOOKED' : 'DECLINED', appointmentId: body.appointmentId ?? null, declineReason: body.reason ?? null, handledByName: ctx.userName, handledAt: new Date() },
      });
      // Tell the client in the portal inbox.
      await tx.clientMessage.create({
        data: { organizationId: ctx.organizationId!, clientId: r.clientId, direction: 'OUTBOUND', kind: 'APPOINTMENT', subject: body.action === 'booked' ? 'Your appointment is booked' : 'About your appointment request', body: body.action === 'booked' ? 'Your requested appointment has been booked. You can see the date and time under Appointments.' : `We could not book your request: ${body.reason}. Please contact us to arrange another time.`, authorName: ctx.userName ?? 'Clinic', staffUserId: ctx.userId },
      });
      await this.audit.record({ action: `appointment_request.${body.action}`, entityType: 'Client', entityId: r.clientId, summary: r.reason }, tx);
      return after;
    });
  }

  // ── Documents shared with the client ──
  @Patch('attachments/:id/share')
  @RequireAnyPermission('clients.write', 'patients.write', 'clinical.write', 'lab.result', 'documents.write', 'hospital.write', 'surgery.write')
  share(@Param('id', UUID) id: string, @Body(zp(z.object({ shared: z.boolean() }))) body: { shared: boolean }) {
    return this.attachments.share(id, body.shared);
  }
}
