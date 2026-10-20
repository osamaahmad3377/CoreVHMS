import { Injectable } from '@nestjs/common';
import type { Permission } from '@vcms/shared';
import { AuditService } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PatientsService } from './patients.service';

export interface PatientRecordSection {
  /** Machine name (a key in the exported JSON). */
  name: string;
  /** Heading shown on the printed record. */
  title: string;
  /** The section is included only when the caller holds at least one of these permissions. */
  anyOf: Permission[];
  load(patientId: string): Promise<unknown>;
}

/**
 * The complete record of one patient: everything the clinic holds about the animal, gathered from every module
 * the user is allowed to see. Modules register their own sections (like the timeline), so the record grows with
 * the system. Used by the "Complete record" page and the download.
 */
@Injectable()
export class PatientRecordService {
  private readonly sections: PatientRecordSection[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly patients: PatientsService,
    private readonly audit: AuditService,
  ) {}

  register(section: PatientRecordSection) {
    this.sections.push(section);
  }

  async build(patientId: string, opts: { exported?: boolean } = {}) {
    const patient = await this.patients.get(patientId);
    const perms = RequestContext.get()?.permissions ?? new Set<string>();
    const allowed = this.sections.filter((s) => s.anyOf.some((p) => perms.has(p)));
    const loaded = await Promise.all(allowed.map(async (s) => [s, await s.load(patientId)] as const));
    const org = await this.prisma.raw.organization.findUniqueOrThrow({
      where: { id: RequestContext.orgId() },
      select: { name: true, legalName: true, email: true, phone: true },
    });
    if (opts.exported) {
      await this.audit.record({ action: 'patient.record_exported', entityType: 'Patient', entityId: patientId, summary: `Complete record downloaded — ${loaded.length} sections` });
    }
    return {
      format: 'nextcore-vcms/patient-record',
      version: 1,
      generatedAt: new Date().toISOString(),
      generatedBy: RequestContext.get()?.userName ?? null,
      clinic: org,
      patient,
      sections: loaded.map(([s, data]) => ({ name: s.name, title: s.title, data })),
      /** Sections left out because of the user's role, so the page can say so instead of looking incomplete. */
      omitted: this.sections.filter((s) => !allowed.includes(s)).map((s) => s.title),
    };
  }
}
