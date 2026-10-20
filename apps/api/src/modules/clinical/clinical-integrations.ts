import { PatientRecordService } from '../patients/patient-record.service';
import { formatInTimeZone } from 'date-fns-tz';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { PrismaService } from '../../common/prisma/prisma.service';
import { localDayBounds } from '../../common/time/tz';
import { AttachmentsService } from '../attachments/attachments.service';
import { ClientMergeService } from '../clients/client-merge.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { PatientMergeService } from '../patients/patient-merge.service';
import { PatientTimelineService } from '../patients/patient-timeline.service';
import { appointmentNo } from '../scheduling/appointments.service';
import { encounterNo } from './encounters.service';
import { ClientPrivacyService } from '../clients/client-privacy.service';

/** Plugs scheduling and clinical data into the shared registries (timeline, merge, dashboard, files). */
@Injectable()
export class ClinicalIntegrations implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly privacy: ClientPrivacyService,
    private readonly record: PatientRecordService,
    private readonly timeline: PatientTimelineService,
    private readonly patientMerge: PatientMergeService,
    private readonly clientMerge: ClientMergeService,
    private readonly dashboard: DashboardService,
    private readonly attachments: AttachmentsService,
  ) {}

  onModuleInit() {
    const db = () => this.prisma.db;

    // ── Timeline ──
    this.timeline.register('appointment', async (id) =>
      (
        await db().appointment.findMany({
          where: { patientId: id },
          include: { appointmentType: { select: { name: true } }, clinician: { select: { user: { select: { name: true } } } } },
          orderBy: { startsAt: 'desc' },
          take: 200,
        })
      ).map((a) => ({
        id: a.id,
        at: a.startsAt,
        kind: 'appointment',
        title: `${a.appointmentType.name} appointment (${a.status.toLowerCase().replace('_', ' ')})`,
        detail: [appointmentNo(a.number), a.reason, a.cancelReason && `Cancelled: ${a.cancelReason}`].filter(Boolean).join(' · '),
        actor: a.clinician?.user.name,
        severity: a.status === 'NO_SHOW' ? ('WARNING' as const) : undefined,
      })),
    );
    this.timeline.register('consultation', async (id) =>
      (
        await db().encounter.findMany({
          where: { patientId: id, status: { not: 'CANCELLED' } },
          include: {
            clinician: { select: { user: { select: { name: true } } } },
            diagnoses: { select: { term: true, type: true } },
            notes: { where: { status: 'SIGNED' }, select: { assessment: true } },
          },
          orderBy: { startedAt: 'desc' },
          take: 200,
        })
      ).map((e) => ({
        id: e.id,
        at: e.startedAt,
        kind: 'consultation',
        title: `${e.type === 'CONSULTATION' ? 'Consultation' : e.type.charAt(0) + e.type.slice(1).toLowerCase().replace('_', ' ')}${e.chiefComplaint ? `: ${e.chiefComplaint}` : ''}`,
        detail: [encounterNo(e.number), e.diagnoses.map((d) => d.term).join(', ') || null].filter(Boolean).join(' · '),
        actor: e.clinician?.user.name,
        href: `/consultations/${e.id}`,
      })),
    );
    this.timeline.register('vitals', async (id) =>
      (await db().vitalSign.findMany({ where: { patientId: id }, orderBy: { recordedAt: 'desc' }, take: 200 })).map((v) => ({
        id: v.id,
        at: v.recordedAt,
        kind: 'vitals',
        title: 'Vital signs',
        detail: [
          v.temperatureC && `T ${Number(v.temperatureC)} °C`,
          v.heartRate && `HR ${v.heartRate}`,
          v.respiratoryRate && `RR ${v.respiratoryRate}`,
          v.painScore !== null && v.painScore !== undefined && `Pain ${v.painScore}/10`,
        ]
          .filter(Boolean)
          .join(' · '),
        actor: v.recordedByName,
        href: v.encounterId ? `/consultations/${v.encounterId}` : undefined,
      })),
    );

    // ── Merges ──
    const patientSteps: [string, (s: string, m: string, tx: any) => Promise<{ count: number }>][] = [
      ['appointments', (s, m, tx) => tx.appointment.updateMany({ where: { patientId: m }, data: { patientId: s } })],
      ['encounters', (s, m, tx) => tx.encounter.updateMany({ where: { patientId: m }, data: { patientId: s } })],
      // The DB trigger permits re-pointing patientId on signed notes while their content stays frozen.
      ['clinicalNotes', (s, m, tx) => tx.clinicalNote.updateMany({ where: { patientId: m }, data: { patientId: s } })],
      ['vitals', (s, m, tx) => tx.vitalSign.updateMany({ where: { patientId: m }, data: { patientId: s } })],
      ['diagnoses', (s, m, tx) => tx.diagnosis.updateMany({ where: { patientId: m }, data: { patientId: s } })],
      ['problems', (s, m, tx) => tx.problemListItem.updateMany({ where: { patientId: m }, data: { patientId: s } })],
      ['triage', (s, m, tx) => tx.triageAssessment.updateMany({ where: { patientId: m }, data: { patientId: s } })],
      ['tasks', (s, m, tx) => tx.task.updateMany({ where: { patientId: m }, data: { patientId: s } })],
      ['waitlist', (s, m, tx) => tx.waitlistEntry.updateMany({ where: { patientId: m }, data: { patientId: s } })],
    ];
    for (const [name, fn] of patientSteps) this.patientMerge.register({ name, run: async (tx, s, m) => (await fn(s, m, tx)).count });
    const clientSteps: [string, (s: string, m: string, tx: any) => Promise<{ count: number }>][] = [
      ['appointments', (s, m, tx) => tx.appointment.updateMany({ where: { clientId: m }, data: { clientId: s } })],
      ['encounters', (s, m, tx) => tx.encounter.updateMany({ where: { clientId: m }, data: { clientId: s } })],
      ['waitlist', (s, m, tx) => tx.waitlistEntry.updateMany({ where: { clientId: m }, data: { clientId: s } })],
      ['tasks', (s, m, tx) => tx.task.updateMany({ where: { clientId: m }, data: { clientId: s } })],
    ];
    for (const [name, fn] of clientSteps) this.clientMerge.register({ name, run: async (tx, s, m) => (await fn(s, m, tx)).count });

    // ── Files on consultations ──
    this.attachments.registerTarget('Encounter', {
      read: 'clinical.read',
      write: 'clinical.write',
      exists: async (id) => !!(await db().encounter.findUnique({ where: { id }, select: { id: true } })),
    });

    // ── Dashboard ──
    this.dashboard.register({
      key: 'appointmentsToday',
      permission: 'appointments.read',
      load: async (r) => {
        const ctx = RequestContext.require();
        const branchId = r.branchId ?? ctx.branchId;
        const branch = branchId ? await db().branch.findUnique({ where: { id: branchId } }) : null;
        const tz = branch?.timezone ?? 'UTC';
        const { start, end } = localDayBounds(new Date(), tz);
        const rows = await db().appointment.findMany({
          where: { startsAt: { gte: start, lt: end }, ...(r.branchId ? { branchId: r.branchId } : {}) },
          include: { patient: { select: { id: true, name: true } }, appointmentType: { select: { name: true, color: true } }, clinician: { select: { user: { select: { name: true } } } } },
          orderBy: { startsAt: 'asc' },
        });
        const byStatus: Record<string, number> = {};
        rows.forEach((a) => (byStatus[a.status] = (byStatus[a.status] ?? 0) + 1));
        const emergencies = rows.filter((a) => ['RESUSCITATION', 'EMERGENT'].includes(a.priority ?? '') && ['CHECKED_IN', 'IN_CONSULTATION'].includes(a.status)).length;
        // Booked patients more than 15 minutes late, and visits from earlier days nobody closed (still waiting / in consult / not marked).
        const lateCutoff = new Date(Date.now() - 15 * 60_000);
        const stale = await db().appointment.findMany({
          where: { startsAt: { lt: start, gte: new Date(start.getTime() - 14 * 86400_000) }, status: { in: ['BOOKED', 'CONFIRMED', 'CHECKED_IN', 'IN_CONSULTATION'] }, ...(r.branchId ? { branchId: r.branchId } : {}) },
          select: { startsAt: true, status: true },
          orderBy: { startsAt: 'desc' },
        });
        const staleOpen = stale.filter((a) => ['CHECKED_IN', 'IN_CONSULTATION'].includes(a.status)).length;
        const staleUnresolved = stale.length - staleOpen;
        const staleDate = stale.length ? formatInTimeZone(stale[0].startsAt, tz, 'yyyy-MM-dd') : null;
        return {
          total: rows.filter((a) => a.status !== 'CANCELLED').length,
          byStatus,
          emergencies,
          notArrived: rows.filter((a) => ['BOOKED', 'CONFIRMED'].includes(a.status) && a.startsAt < lateCutoff).length,
          staleOpen,
          staleUnresolved,
          staleDate,
          upcoming: rows
            .filter((a) => ['BOOKED', 'CONFIRMED'].includes(a.status) && a.startsAt >= lateCutoff)
            .slice(0, 8)
            .map((a) => ({
              id: a.id,
              startsAt: a.startsAt,
              status: a.status,
              priority: a.priority,
              patient: a.patient,
              type: a.appointmentType,
              clinician: a.clinician?.user.name ?? null,
            })),
        };
      },
    });
    this.dashboard.register({
      key: 'clinicalWork',
      permission: 'clinical.read',
      load: async () => {
        const ctx = RequestContext.require();
        const [openEncounters, myDrafts] = await Promise.all([
          db().encounter.count({ where: { status: 'OPEN' } }),
          db().clinicalNote.findMany({
            where: { status: { in: ['DRAFT', 'REVIEWED'] }, authorId: ctx.userId },
            include: { patient: { select: { name: true } }, encounter: { select: { id: true, number: true } } },
            orderBy: { updatedAt: 'desc' },
            take: 10,
          }),
        ]);
        return {
          openEncounters,
          unsignedNotes: myDrafts.map((n) => ({ id: n.id, encounterId: n.encounter.id, encounterNo: encounterNo(n.encounter.number), patient: n.patient.name, updatedAt: n.updatedAt, status: n.status })),
        };
      },
    });
    this.dashboard.register({
      key: 'tasks',
      permission: 'dashboard.view',
      load: async () => {
        const ctx = RequestContext.require();
        const endOfToday = new Date(Date.now() + 86400_000);
        const rows = await db().task.findMany({
          where: { status: 'OPEN', dueAt: { lt: endOfToday }, OR: [{ assigneeId: ctx.membershipId }, { assigneeId: null }] },
          include: { patient: { select: { id: true, name: true } } },
          orderBy: { dueAt: 'asc' },
          take: 10,
        });
        return { dueOrOverdue: rows.map((t) => ({ id: t.id, title: t.title, type: t.type, dueAt: t.dueAt, overdue: t.dueAt < new Date(), patient: t.patient })) };
      },
    });

    // ── Complete patient record ──
    this.record.register({
      name: 'consultations',
      title: 'Consultations',
      anyOf: ['clinical.read'],
      load: async (patientId) => {
        const rows = await this.prisma.db.encounter.findMany({
          where: { patientId },
          include: {
            clinician: { select: { user: { select: { name: true } } } },
            appointment: { select: { appointmentType: { select: { name: true } } } },
            // Drafts are working documents; signed notes and their earlier versions are the record.
            notes: { where: { status: { in: ['SIGNED', 'SUPERSEDED'] } }, orderBy: { createdAt: 'asc' } },
            vitals: { orderBy: { recordedAt: 'asc' } },
            diagnoses: { orderBy: { createdAt: 'asc' } },
            tasks: { orderBy: { dueAt: 'asc' } },
          },
          orderBy: { startedAt: 'asc' },
        });
        return rows.map(({ clinician, appointment, ...e }) => ({ ...e, encounterNo: encounterNo(e.number), clinician: clinician?.user.name ?? null, appointmentType: appointment?.appointmentType.name ?? null }));
      },
    });
    this.record.register({
      name: 'problems',
      title: 'Problem list',
      anyOf: ['clinical.read'],
      load: (patientId) => this.prisma.db.problemListItem.findMany({ where: { patientId }, orderBy: { createdAt: 'asc' } }),
    });
    this.record.register({
      name: 'appointments',
      title: 'Appointments',
      anyOf: ['appointments.read'],
      load: async (patientId) => {
        const rows = await this.prisma.db.appointment.findMany({
          where: { patientId },
          include: { appointmentType: { select: { name: true } }, clinician: { select: { user: { select: { name: true } } } } },
          orderBy: { startsAt: 'asc' },
        });
        return rows.map(({ appointmentType, clinician, ...a }) => ({ ...a, appointmentNo: appointmentNo(a.number), appointmentType: appointmentType.name, clinician: clinician?.user.name ?? null }));
      },
    });
    this.record.register({
      name: 'documents',
      title: 'Documents and photos',
      anyOf: ['documents.read', 'clinical.read'],
      load: async (patientId) => {
        const encounters = await this.prisma.db.encounter.findMany({ where: { patientId }, select: { id: true } });
        const rows = await this.prisma.db.attachment.findMany({
          where: { deletedAt: null, OR: [{ entityType: 'Patient', entityId: patientId }, { entityType: 'Encounter', entityId: { in: encounters.map((e) => e.id) } }] },
          orderBy: { createdAt: 'asc' },
        });
        // The files themselves are downloaded one by one from the link; the record lists what exists.
        return rows.map((a) => ({ id: a.id, fileName: a.fileName, category: a.category, description: a.description, mimeType: a.mimeType, sizeBytes: a.sizeBytes, uploadedBy: a.uploadedByName, uploadedAt: a.createdAt, attachedTo: a.entityType, downloadPath: `/api/v1/attachments/${a.id}/download` }));
      },
    });

    // Data-subject export: encounters, signed notes (drafts are working documents), diagnoses and vital signs.
    this.privacy.registerExport({
      name: 'clinical',
      load: async (clientId, patientIds) => {
        const encounters = await this.prisma.db.encounter.findMany({ where: { clientId }, orderBy: { createdAt: 'asc' } });
        const ids = encounters.map((e) => e.id);
        const [notes, diagnoses, vitals] = await Promise.all([
          this.prisma.db.clinicalNote.findMany({ where: { encounterId: { in: ids }, status: { in: ['SIGNED', 'SUPERSEDED'] } }, orderBy: { createdAt: 'asc' } }),
          this.prisma.db.diagnosis.findMany({ where: { encounterId: { in: ids } }, orderBy: { createdAt: 'asc' } }),
          this.prisma.db.vitalSign.findMany({ where: { patientId: { in: patientIds } }, orderBy: { recordedAt: 'asc' } }),
        ]);
        return { encounters, notes, diagnoses, vitals };
      },
    });
  }
}
