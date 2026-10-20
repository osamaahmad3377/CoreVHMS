import { PatientRecordService } from '../patients/patient-record.service';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { enumLabel } from '@vcms/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AttachmentsService } from '../attachments/attachments.service';
import { ClientMergeService } from '../clients/client-merge.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { PatientMergeService } from '../patients/patient-merge.service';
import { PatientTimelineService } from '../patients/patient-timeline.service';
import { SearchService } from '../search/search.service';
import { claimNo } from './insurance.service';
import { referralNo } from './referrals.service';
import { ClientPrivacyService } from '../clients/client-privacy.service';

/** Registers insurance and referrals with the shared timeline, merge, search, dashboard and attachment registries. */
@Injectable()
export class InsuranceIntegrations implements OnModuleInit {
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
    this.timeline.register('insurance-claim', async (id) =>
      (await db().insuranceClaim.findMany({ where: { patientId: id }, include: { policy: { include: { provider: { select: { name: true } } } } }, orderBy: { createdAt: 'desc' }, take: 50 })).map((c) => ({
        id: c.id,
        at: c.submittedAt ?? c.createdAt,
        kind: 'insurance',
        title: `Insurance claim ${enumLabel(c.status).toLowerCase()}: ${c.condition}`,
        detail: `${claimNo(c.number)} · ${c.policy.provider.name}`,
        actor: c.submittedByName ?? c.createdByName,
        href: `/insurance/claims/${c.id}`,
      })),
    );
    this.timeline.register('referral', async (id) =>
      (await db().referral.findMany({ where: { patientId: id }, include: { contact: { select: { name: true, practice: true } } }, orderBy: { createdAt: 'desc' }, take: 50 })).map((r) => ({
        id: r.id,
        at: r.sentAt ?? r.createdAt,
        kind: 'referral',
        title: `${r.direction === 'OUTGOING' ? 'Referred to' : 'Referred from'} ${r.contact ? [r.contact.name, r.contact.practice].filter(Boolean).join(', ') : r.externalVet ?? 'external vet'}`,
        detail: `${referralNo(r.number)} · ${enumLabel(r.status).toLowerCase()} · ${r.reason}`,
        actor: r.sentByName ?? r.createdByName,
        href: `/insurance/referrals/${r.id}`,
        severity: r.urgency === 'EMERGENCY' ? ('WARNING' as const) : undefined,
      })),
    );
    for (const model of ['insurancePolicy', 'insuranceClaim', 'referral'] as const) {
      this.patientMerge.register({ name: `${model}s`, run: async (tx, s, m) => (await (tx[model] as any).updateMany({ where: { patientId: m }, data: { patientId: s } })).count });
      this.clientMerge.register({ name: `${model}s`, run: async (tx, s, m) => (await (tx[model] as any).updateMany({ where: { clientId: m }, data: { clientId: s } })).count });
    }
    this.attachments.registerTarget('InsuranceClaim', { read: 'insurance.read', write: 'insurance.write', exists: async (id) => !!(await db().insuranceClaim.findUnique({ where: { id }, select: { id: true } })) });
    this.attachments.registerTarget('Referral', { read: 'insurance.read', write: 'insurance.write', exists: async (id) => !!(await db().referral.findUnique({ where: { id }, select: { id: true } })) });

    this.search.register(async (q, perms) => {
      if (!perms.has('insurance.read')) return [];
      const term = q.trim();
      const m = term.match(/^(clm|ref)-?(\d+)$/i);
      if (m) {
        const n = Number(m[2]);
        if (m[1].toLowerCase() === 'clm') {
          const c = await db().insuranceClaim.findFirst({ where: { number: n }, include: { patient: { select: { name: true } } } });
          return c ? [{ type: 'claim', id: c.id, title: `Claim ${claimNo(n)}`, subtitle: `${c.patient.name} · ${c.condition}`, href: `/insurance/claims/${c.id}` }] : [];
        }
        const r = await db().referral.findFirst({ where: { number: n }, include: { patient: { select: { name: true } } } });
        return r ? [{ type: 'referral', id: r.id, title: `Referral ${referralNo(n)}`, subtitle: `${r.patient.name} · ${r.reason}`, href: `/insurance/referrals/${r.id}` }] : [];
      }
      if (term.length < 3) return [];
      const policies = await db().insurancePolicy.findMany({ where: { policyNumber: { contains: term, mode: 'insensitive' } }, include: { patient: { select: { id: true, name: true } }, provider: { select: { name: true } } }, take: 5 });
      return policies.map((p) => ({ type: 'policy', id: p.id, title: `${p.provider.name} ${p.policyNumber}`, subtitle: p.patient.name, href: `/patients/${p.patient.id}?tab=insurance`, badge: 'Policy' }));
    });

    this.dashboard.register({
      key: 'insurance',
      permission: 'insurance.read',
      load: async () => {
        const [awaiting, queried, approvedUnpaid, referrals] = await Promise.all([
          db().insuranceClaim.count({ where: { status: 'SUBMITTED' } }),
          db().insuranceClaim.count({ where: { status: 'QUERIED' } }),
          db().insuranceClaim.findMany({ where: { status: { in: ['APPROVED', 'PARTIALLY_APPROVED'] }, payee: 'CLINIC' }, select: { approvedMinor: true, paidMinor: true } }),
          db().referral.count({ where: { status: { in: ['SENT', 'RECEIVED', 'ACCEPTED'] } } }),
        ]);
        return { claimsAwaitingDecision: awaiting, claimsQueried: queried, insurerOwedMinor: approvedUnpaid.reduce((n, c) => n + (c.approvedMinor ?? 0) - c.paidMinor, 0), openReferrals: referrals };
      },
    });

    this.record.register({
      name: 'insurance',
      title: 'Insurance and referrals',
      anyOf: ['insurance.read'],
      load: async (patientId) => ({
        policies: await this.prisma.db.insurancePolicy.findMany({ where: { patientId }, include: { provider: { select: { name: true } } }, orderBy: { createdAt: 'asc' } }),
        claims: (await this.prisma.db.insuranceClaim.findMany({ where: { patientId }, orderBy: { createdAt: 'asc' } })).map((c) => ({ ...c, claimNo: claimNo(c.number) })),
        referrals: (await this.prisma.db.referral.findMany({ where: { patientId }, orderBy: { createdAt: 'asc' } })).map((r) => ({ ...r, referralNo: referralNo(r.number) })),
      }),
    });

    this.privacy.registerExport({
      name: 'insuranceAndReferrals',
      load: async (clientId) => ({
        policies: await db().insurancePolicy.findMany({ where: { clientId }, include: { provider: { select: { name: true } } } }),
        claims: await db().insuranceClaim.findMany({ where: { clientId }, include: { invoices: true } }),
        referrals: await db().referral.findMany({ where: { clientId }, include: { contact: { select: { name: true, practice: true } } } }),
      }),
    });
  }
}
