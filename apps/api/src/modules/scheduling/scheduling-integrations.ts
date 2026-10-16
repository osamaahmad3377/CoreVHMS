import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ClientPrivacyService } from '../clients/client-privacy.service';

/** Registers scheduling with the client data-export registry. */
@Injectable()
export class SchedulingIntegrations implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly privacy: ClientPrivacyService,
  ) {}

  onModuleInit() {
    this.privacy.registerExport({
      name: 'appointments',
      load: (clientId) => this.prisma.db.appointment.findMany({ where: { clientId }, include: { appointmentType: { select: { name: true } } }, orderBy: { startsAt: 'asc' } }),
    });
  }
}
