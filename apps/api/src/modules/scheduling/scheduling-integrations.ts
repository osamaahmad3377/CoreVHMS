import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ClientPrivacyService } from '../clients/client-privacy.service';
import { ClinicalRecordsService } from '../clinical/clinical-records.service';
import { ScheduleConfigService } from './schedule-config.service';

/** Registers scheduling with the client data-export registry, and gives each new consultation template its appointment type. */
@Injectable()
export class SchedulingIntegrations implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly privacy: ClientPrivacyService,
    private readonly records: ClinicalRecordsService,
    private readonly config: ScheduleConfigService,
  ) {}

  onModuleInit() {
    this.records.registerTemplateCreatedHook((tx, t) => this.config.typeForTemplate(tx, t));
    this.privacy.registerExport({
      name: 'appointments',
      load: (clientId) => this.prisma.db.appointment.findMany({ where: { clientId }, include: { appointmentType: { select: { name: true } } }, orderBy: { startsAt: 'asc' } }),
    });
  }
}
