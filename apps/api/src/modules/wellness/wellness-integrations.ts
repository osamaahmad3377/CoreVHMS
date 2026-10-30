import { Injectable, OnModuleInit } from '@nestjs/common';
import { ruleViolation } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ChargeCaptureService } from '../billing/charge-capture.service';
import { ClientMergeService } from '../clients/client-merge.service';
import { ClientPrivacyService } from '../clients/client-privacy.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { PatientMergeService } from '../patients/patient-merge.service';
import { PatientRecordService } from '../patients/patient-record.service';
import { PatientTimelineService } from '../patients/patient-timeline.service';
import { enrolmentNo, WellnessService } from './wellness.service';

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Registers wellness plans with billing (benefits on new charges), the timeline, merges, dashboard and record export. */
@Injectable()
export class WellnessIntegrations implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wellness: WellnessService,
    private readonly charges: ChargeCaptureService,
    private readonly timeline: PatientTimelineService,
    private readonly patientMerge: PatientMergeService,
    private readonly clientMerge: ClientMergeService,
    private readonly dashboard: DashboardService,
    private readonly record: PatientRecordService,
    private readonly privacy: ClientPrivacyService,
  ) {}

  onModuleInit() {
    const db = () => this.prisma.db;

    // Every new unbilled charge for a member gets the plan's benefit in the same transaction.
    this.charges.registerCapturedHook(async (tx, charge) => {
      await this.wellness.applyToCharge(tx, charge);
    });
    this.charges.registerWaivedHook((tx, ids, reason) => this.wellness.releaseForCharges(tx, ids, reason));

    this.timeline.register('wellness', async (id) => {
      const rows = await db().wellnessEnrolment.findMany({ where: { patientId: id }, orderBy: { createdAt: 'desc' }, take: 50 });
      return rows.flatMap((e) => [
        {
          id: `wp-${e.id}`,
          at: e.createdAt,
          kind: 'wellness',
          title: `${e.renewedFromId ? 'Wellness plan renewed' : 'Joined wellness plan'}: ${e.planName}`,
          detail: `${enrolmentNo(e.number)} · ${iso(e.startDate)} to ${iso(e.endDate)} · ${e.billing === 'MONTHLY' ? 'paid monthly' : 'paid up front'}`,
          actor: e.createdByName,
          href: `/patients/${id}?tab=wellness`,
        },
        ...(e.cancelledAt
          ? [{ id: `wpc-${e.id}`, at: e.cancelledAt, kind: 'wellness', title: `Wellness plan cancelled: ${e.planName}`, detail: e.cancelReason, actor: e.cancelledByName, href: `/patients/${id}?tab=wellness`, severity: 'WARNING' as const }]
          : []),
      ]);
    });

    this.patientMerge.register({
      name: 'wellnessEnrolments',
      run: async (tx, survivor, merged) => {
        const both = await tx.wellnessEnrolment.findMany({ where: { patientId: { in: [survivor, merged] }, status: 'ACTIVE' } });
        const a = both.filter((e) => e.patientId === survivor);
        const b = both.filter((e) => e.patientId === merged);
        const clash = b.find((m) => a.some((s) => s.startDate <= m.endDate && m.startDate <= s.endDate));
        if (clash) throw ruleViolation('WELLNESS_CLASH', `Both records are on a wellness plan for the same dates (${enrolmentNo(clash.number)}). Cancel one plan before merging.`);
        return (await tx.wellnessEnrolment.updateMany({ where: { patientId: merged }, data: { patientId: survivor } })).count;
      },
    });
    this.clientMerge.register({ name: 'wellnessEnrolments', run: async (tx, s, m) => (await tx.wellnessEnrolment.updateMany({ where: { clientId: m }, data: { clientId: s } })).count });

    this.dashboard.register({
      key: 'wellness',
      permission: 'wellness.read',
      module: 'wellness',
      load: async () => {
        const o = await this.wellness.overview();
        return { activeMembers: o.activeMembers, endingSoon: o.endingSoon, paymentsToBill: o.paymentsToBill, monthlyRecurringMinor: o.monthlyRecurringMinor };
      },
    });

    const load = (where: { patientId: string } | { patientId: { in: string[] } }) =>
      this.prisma.db.wellnessEnrolment.findMany({ where, include: { entitlements: true, instalments: { orderBy: { seq: 'asc' } }, usages: { orderBy: { usedAt: 'asc' } } }, orderBy: { startDate: 'asc' } });
    this.record.register({ name: 'wellnessPlans', title: 'Wellness plans', anyOf: ['wellness.read'], load: (patientId) => load({ patientId }) });
    this.privacy.registerExport({ name: 'wellnessPlans', load: (_clientId, patientIds) => load({ patientId: { in: patientIds } }) });
  }
}
