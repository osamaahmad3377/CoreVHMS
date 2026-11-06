import { Injectable } from '@nestjs/common';
import type { PatientHistorySummary } from '@vcms/shared';
import { RequestContext } from '../../common/context/request-context';
import { notFound } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { resolveTimezone } from '../../common/time/branch-timezone';

const MAX = 8;

/**
 * "Past history" for a consultation, written from what the clinic itself recorded for the animal: vaccinations,
 * deworming, tick and flea treatment, operations, hospital stays, medicines prescribed and given, grooming, boarding,
 * earlier diagnoses and long-term problems. Only records the user may read are included; nothing is invented.
 */
@Injectable()
export class HistorySummaryService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(patientId: string, excludeEncounterId?: string): Promise<PatientHistorySummary> {
    const db = this.prisma.db;
    const perms = RequestContext.require().permissions;
    const p = await db.patient.findUnique({ where: { id: patientId }, select: { id: true } });
    if (!p) throw notFound('Patient');
    const tz = await resolveTimezone(this.prisma);
    const fmt = (d: Date | null | undefined) => (d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: tz }) : '');
    // Everything except this visit's own entries (records not tied to a visit stay in).
    const notThisVisit = excludeEncounterId ? { OR: [{ encounterId: null }, { encounterId: { not: excludeEncounterId } }] } : {};
    const sections: PatientHistorySummary['sections'] = [];
    const add = (title: string, items: string[], extra?: number) => {
      if (items.length) sections.push({ title, items: extra ? [...items, `and ${extra} more`] : items });
    };
    const recent = <T,>(rows: T[]) => ({ rows: rows.slice(0, MAX), more: Math.max(0, rows.length - MAX) });

    if (perms.has('preventive.read')) {
      const care = await db.careItem.findMany({ where: { patientId, status: 'COMPLETED', kind: { in: ['VACCINATION', 'DEWORMING', 'PARASITE_PREVENTION'] } }, orderBy: { completedAt: 'desc' }, take: 60 });
      const line = (c: (typeof care)[number]) => `${c.productName ? `${c.title} (${c.productName})` : c.title} — ${fmt(c.completedAt)}${c.givenElsewhere ? ', given elsewhere' : ''}`;
      for (const [kind, title] of [['VACCINATION', 'Vaccinations'], ['DEWORMING', 'Deworming'], ['PARASITE_PREVENTION', 'Tick & flea treatment']] as const) {
        const r = recent(care.filter((c) => c.kind === kind));
        add(title, r.rows.map(line), r.more);
      }
    }
    if (perms.has('surgery.read')) {
      const r = recent(await db.surgery.findMany({ where: { patientId, status: 'COMPLETED' }, orderBy: { completedAt: 'desc' }, take: 30 }));
      add('Operations', r.rows.map((s) => `${s.procedure} — ${fmt(s.completedAt)}`), r.more);
    }
    if (perms.has('hospital.read')) {
      const r = recent(await db.admission.findMany({ where: { patientId, status: { not: 'CANCELLED' } }, orderBy: { admittedAt: 'desc' }, take: 30 }));
      add('Hospital stays', r.rows.map((a) => `${a.reason} — admitted ${fmt(a.admittedAt)}${a.dischargedAt ? `, home ${fmt(a.dischargedAt)}` : ' (still in)'}`), r.more);
    }
    if (perms.has('prescriptions.read')) {
      const rx = await db.prescription.findMany({
        where: { patientId, status: { notIn: ['DRAFT', 'CANCELLED'] }, ...notThisVisit },
        include: { items: { include: { product: { select: { name: true } } } } },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });
      const lines = rx.flatMap((r) => r.items.map((i) => `${i.product?.name ?? i.outsideName ?? 'Medicine'} — prescribed ${fmt(r.createdAt)}`));
      const r = recent(lines);
      add('Medicines prescribed', r.rows, r.more);
    }
    if (perms.has('clinical.read')) {
      const given = await db.medicationAdministration.findMany({
        where: { patientId, status: 'GIVEN', ...notThisVisit },
        include: { product: { select: { name: true } } },
        orderBy: { administeredAt: 'desc' },
        take: 30,
      });
      const r = recent(given);
      add('Medicines given in clinic', r.rows.map((a) => `${a.product.name} ${Number(a.dose)} ${a.doseUnit} — ${fmt(a.administeredAt)}`), r.more);
      const dx = recent(await db.diagnosis.findMany({ where: { patientId, status: { not: 'RULED_OUT' }, ...(excludeEncounterId ? { encounterId: { not: excludeEncounterId } } : {}) }, orderBy: { createdAt: 'desc' }, take: 30 }));
      add('Earlier diagnoses', dx.rows.map((d) => `${d.term} — ${fmt(d.createdAt)}${d.status === 'RESOLVED' ? ' (resolved)' : ''}`), dx.more);
      const problems = await db.problemListItem.findMany({ where: { patientId, status: 'ACTIVE' }, orderBy: { createdAt: 'desc' }, take: 20 });
      add('Long-term problems', problems.map((x) => `${x.term}${x.isChronic ? ' (chronic)' : ''}`));
    }
    if (perms.has('boarding.read')) {
      const groom = recent(await db.groomingJob.findMany({ where: { patientId, status: { in: ['READY', 'COLLECTED'] } }, include: { services: { select: { description: true } } }, orderBy: { createdAt: 'desc' }, take: 20 }));
      add('Grooming', groom.rows.map((g) => `${g.services.map((s) => s.description).join(', ') || 'Grooming'} — ${fmt(g.readyAt ?? g.createdAt)}`), groom.more);
      const stays = recent(await db.boardingStay.findMany({ where: { patientId, status: 'CHECKED_OUT' }, orderBy: { startDate: 'desc' }, take: 20 }));
      add('Boarding', stays.rows.map((s) => `${fmt(s.startDate)} to ${fmt(s.endDate)}`), stays.more);
    }
    return { sections, text: sections.map((s) => `${s.title}: ${s.items.join('; ')}.`).join('\n') };
  }
}
