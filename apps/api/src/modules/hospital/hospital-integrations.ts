import { PatientRecordService } from '../patients/patient-record.service';
import { overdueCutoff } from '@vcms/shared';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { PrismaService } from '../../common/prisma/prisma.service';
import { localDayBounds } from '../../common/time/tz';
import { AttachmentsService } from '../attachments/attachments.service';
import { ClientMergeService } from '../clients/client-merge.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { PatientMergeService } from '../patients/patient-merge.service';
import { PatientTimelineService } from '../patients/patient-timeline.service';
import { SearchService } from '../search/search.service';
import { admissionNo } from './admissions.service';
import { surgeryNo } from './surgery.service';
import { ClientPrivacyService } from '../clients/client-privacy.service';
import { ruleViolation } from '../../common/http/errors';

/** Registers hospital and surgery with the shared timeline, merge, search, dashboard and attachment registries. */
@Injectable()
export class HospitalIntegrations implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly privacy: ClientPrivacyService,
    private readonly record: PatientRecordService,
    private readonly timeline: PatientTimelineService,
    private readonly patientMerge: PatientMergeService,
    private readonly clientMerge: ClientMergeService,
    private readonly dashboard: DashboardService,
    private readonly attachments: AttachmentsService,
    private readonly search: SearchService,
  ) {}

  onModuleInit() {
    const db = () => this.prisma.db;

    this.timeline.register('hospital', async (id) => {
      const rows = await db().admission.findMany({ where: { patientId: id }, include: { ward: { select: { name: true } } }, orderBy: { admittedAt: 'desc' }, take: 100 });
      return rows.flatMap((a) => [
        { id: `adm-${a.id}`, at: a.admittedAt, kind: 'hospital', title: `Admitted to hospital${a.ward ? ` — ${a.ward.name}` : ''}`, detail: `${admissionNo(a.number)} · ${a.reason}`, actor: a.admittedByName, href: `/hospital/admissions/${a.id}` },
        ...(a.dischargedAt
          ? [{ id: `dis-${a.id}`, at: a.dischargedAt, kind: 'hospital', title: `Discharged (${a.outcome?.toLowerCase().replace('_', ' ')})`, detail: admissionNo(a.number), actor: a.dischargedByName, href: `/hospital/admissions/${a.id}`, severity: a.outcome === 'DECEASED' || a.outcome === 'EUTHANASED' ? ('CRITICAL' as const) : undefined }]
          : []),
      ]);
    });
    this.timeline.register('surgery', async (id) =>
      (await db().surgery.findMany({ where: { patientId: id }, orderBy: { scheduledAt: 'desc' }, take: 100 })).map((s) => ({
        id: s.id,
        at: s.completedAt ?? s.scheduledAt,
        kind: 'surgery',
        title: `Surgery: ${s.procedure}`,
        detail: `${surgeryNo(s.number)} · ${s.status.toLowerCase().replace('_', ' ')}${s.complications ? ' · complications recorded' : ''}`,
        actor: s.completedByName ?? s.createdByName,
        href: `/surgery/${s.id}`,
      })),
    );

    for (const model of ['admission', 'surgery'] as const) {
      this.patientMerge.register({ name: `${model}s`, run: async (tx, s, m) => (await (tx[model] as any).updateMany({ where: { patientId: m }, data: { patientId: s } })).count });
      this.clientMerge.register({ name: `${model}s`, run: async (tx, s, m) => (await (tx[model] as any).updateMany({ where: { clientId: m }, data: { clientId: s } })).count });
    }

    this.attachments.registerTarget('Admission', { read: 'hospital.read', write: 'hospital.write', exists: async (id) => !!(await db().admission.findUnique({ where: { id }, select: { id: true } })) });
    this.attachments.registerTarget('Surgery', { read: 'surgery.read', write: 'surgery.write', exists: async (id) => !!(await db().surgery.findUnique({ where: { id }, select: { id: true } })) });
    // Files on hospital stays and surgeries also appear (read-only) on the patient's Documents tab.
    this.attachments.registerRelated('Patient', {
      childType: 'Admission',
      children: async (patientId) => (await db().admission.findMany({ where: { patientId }, select: { id: true, number: true }, take: 500 })).map((a) => ({ id: a.id, label: `Hospital stay ${admissionNo(a.number)}` })),
    });
    this.attachments.registerRelated('Patient', {
      childType: 'Surgery',
      children: async (patientId) => (await db().surgery.findMany({ where: { patientId }, select: { id: true, number: true, procedure: true }, take: 500 })).map((x) => ({ id: x.id, label: `Surgery ${surgeryNo(x.number)} · ${x.procedure}` })),
    });

    this.search.register(async (q, perms) => {
      const m = q.trim().match(/^(hosp|surg)-?(\d+)$/i);
      if (!m) return [];
      const n = Number(m[2]);
      if (m[1].toLowerCase() === 'hosp' && perms.has('hospital.read')) {
        const a = await db().admission.findFirst({ where: { number: n }, include: { patient: { select: { name: true } } } });
        return a ? [{ type: 'admission', id: a.id, title: `Hospital stay ${admissionNo(n)}`, subtitle: `${a.patient.name} · ${a.status.toLowerCase()}`, href: `/hospital/admissions/${a.id}` }] : [];
      }
      if (m[1].toLowerCase() === 'surg' && perms.has('surgery.read')) {
        const s = await db().surgery.findFirst({ where: { number: n }, include: { patient: { select: { name: true } } } });
        return s ? [{ type: 'surgery', id: s.id, title: `Surgery ${surgeryNo(n)}`, subtitle: `${s.patient.name} · ${s.procedure}`, href: `/surgery/${s.id}` }] : [];
      }
      return [];
    });

    this.dashboard.register({
      key: 'hospital',
      permission: 'hospital.read',
      load: async (r) => {
        const b = r.branchId ? { branchId: r.branchId } : {};
        const now = new Date();
        const [inpatients, critical, overdue] = await Promise.all([
          db().admission.count({ where: { ...b, status: 'ADMITTED' } }),
          db().admission.findMany({ where: { ...b, status: 'ADMITTED', condition: 'CRITICAL' }, include: { patient: { select: { id: true, name: true } } }, take: 5 }),
          db().treatmentTask.count({ where: { status: 'DUE', dueAt: { lt: overdueCutoff(now) }, admission: { ...b, status: 'ADMITTED' } } }),
        ]);
        return { inpatients, overdueTreatments: overdue, critical: critical.map((a) => ({ id: a.id, admissionNo: admissionNo(a.number), patient: a.patient })) };
      },
    });
    this.dashboard.register({
      key: 'surgery',
      permission: 'surgery.read',
      load: async (r) => {
        const ctx = RequestContext.require();
        const branchId = r.branchId ?? ctx.branchId;
        const branch = branchId ? await db().branch.findUnique({ where: { id: branchId } }) : null;
        const { start, end } = localDayBounds(new Date(), branch?.timezone ?? 'UTC');
        const rows = await db().surgery.findMany({
          where: { scheduledAt: { gte: start, lt: end }, status: { not: 'CANCELLED' }, ...(r.branchId ? { branchId: r.branchId } : {}) },
          include: { patient: { select: { id: true, name: true } }, theatre: { select: { name: true } } },
          orderBy: { scheduledAt: 'asc' },
        });
        return { today: rows.map((s) => ({ id: s.id, surgeryNo: surgeryNo(s.number), procedure: s.procedure, status: s.status, scheduledAt: s.scheduledAt, patient: s.patient, theatre: s.theatre?.name ?? null })) };
      },
    });

    this.record.register({
      name: 'admissions',
      title: 'Hospital stays',
      anyOf: ['hospital.read'],
      load: async (patientId) => (await this.prisma.db.admission.findMany({ where: { patientId }, include: { notes: { orderBy: { createdAt: 'asc' } }, orders: { include: { product: { select: { name: true } } } } }, orderBy: { admittedAt: 'asc' } })).map((a) => ({ ...a, admissionNo: admissionNo(a.number) })),
    });
    this.record.register({
      name: 'surgeries',
      title: 'Surgeries',
      anyOf: ['surgery.read'],
      load: async (patientId) => (await this.prisma.db.surgery.findMany({ where: { patientId }, include: { addenda: { orderBy: { createdAt: 'asc' } } }, orderBy: { scheduledAt: 'asc' } })).map((s) => ({ ...s, surgeryNo: surgeryNo(s.number) })),
    });

    this.privacy.registerExport({
      name: 'hospital',
      load: async (clientId) => ({
        admissions: await this.prisma.db.admission.findMany({ where: { clientId }, include: { notes: true }, orderBy: { admittedAt: 'asc' } }),
        surgeries: await this.prisma.db.surgery.findMany({ where: { clientId }, include: { addenda: true }, orderBy: { scheduledAt: 'asc' } }),
      }),
    });
    this.privacy.registerAnonymise({
      name: 'hospital',
      check: async (clientId) => {
        if (await this.prisma.db.admission.findFirst({ where: { clientId, status: 'ADMITTED' } })) throw ruleViolation('IN_HOSPITAL', 'An animal of this client is in hospital; discharge it first');
      },
      run: async () => 0,
    });
  }
}
