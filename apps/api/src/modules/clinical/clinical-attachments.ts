import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AttachmentsService } from '../attachments/attachments.service';
import { encounterNo } from './encounters.service';

/** Photos and documents uploaded in a consultation also appear (read-only) on the patient's Documents tab. */
@Injectable()
export class ClinicalAttachments implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly attachments: AttachmentsService,
  ) {}

  onModuleInit() {
    this.attachments.registerRelated('Patient', {
      childType: 'Encounter',
      children: async (patientId) =>
        (await this.prisma.db.encounter.findMany({ where: { patientId }, select: { id: true, number: true }, orderBy: { startedAt: 'desc' }, take: 500 })).map((e) => ({ id: e.id, label: `Consultation ${encounterNo(e.number)}` })),
    });
  }
}
