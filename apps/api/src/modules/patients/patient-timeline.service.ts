import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface TimelineEvent {
  id: string;
  at: Date;
  kind: string;
  title: string;
  detail?: string | null;
  actor?: string | null;
  severity?: 'INFO' | 'WARNING' | 'CRITICAL';
  /** Web route for drill-down. */
  href?: string;
}

export type TimelineProvider = (patientId: string) => Promise<TimelineEvent[]>;

/**
 * Unified patient timeline. Each clinical/financial module registers a provider that
 * contributes its events, so the timeline grows with the system without a god-query.
 */
@Injectable()
export class PatientTimelineService {
  private readonly providers: { kind: string; fn: TimelineProvider }[] = [];

  constructor(private readonly prisma: PrismaService) {
    this.register('registration', async (id) => {
      const p = await this.prisma.db.patient.findUnique({ where: { id } });
      if (!p) return [];
      const events: TimelineEvent[] = [{ id: `reg-${p.id}`, at: p.createdAt, kind: 'registration', title: 'Patient registered' }];
      if (p.deceasedAt) {
        events.push({
          id: `dec-${p.id}`,
          at: p.deceasedAt,
          kind: 'registration',
          title: p.euthanasia ? 'Euthanasia' : 'Deceased',
          detail: p.causeOfDeath,
          severity: 'WARNING',
        });
      }
      return events;
    });
    this.register('weight', async (id) =>
      (await this.prisma.db.weightRecord.findMany({ where: { patientId: id }, orderBy: { measuredAt: 'desc' }, take: 200 })).map((w) => ({
        id: w.id,
        at: w.measuredAt,
        kind: 'weight',
        title: `Weight ${Number(w.weightKg)} kg`,
        detail: w.bodyConditionScore ? `BCS ${w.bodyConditionScore}/${w.bcsScale}` : w.notes,
        actor: w.recordedByName,
      })),
    );
    this.register('alert', async (id) =>
      (await this.prisma.db.patientAlert.findMany({ where: { patientId: id } })).map((a) => ({
        id: a.id,
        at: a.createdAt,
        kind: 'alert',
        title: `${a.type === 'ALLERGY' ? 'Allergy' : 'Alert'}: ${a.title}`,
        detail: a.isActive ? a.details : `Resolved ${a.resolvedAt?.toISOString().slice(0, 10) ?? ''}`,
        actor: a.createdByName,
        severity: a.severity,
      })),
    );
    this.register('ownership', async (id) =>
      (
        await this.prisma.db.patientOwnership.findMany({
          where: { patientId: id },
          include: { client: { select: { displayName: true, id: true } } },
        })
      ).map((o) => ({
        id: o.id,
        at: o.startedAt,
        kind: 'ownership',
        title: o.isPrimary ? `Owner: ${o.client.displayName}` : `Co-owner added: ${o.client.displayName}`,
        detail: o.endedAt ? `Ended ${o.endedAt.toISOString().slice(0, 10)}${o.endReason ? ` — ${o.endReason}` : ''}` : null,
        href: `/clients/${o.client.id}`,
      })),
    );
    this.register('document', async (id) =>
      (await this.prisma.db.attachment.findMany({ where: { entityType: 'Patient', entityId: id, deletedAt: null } })).map((a) => ({
        id: a.id,
        at: a.createdAt,
        kind: 'document',
        title: `Document: ${a.fileName}`,
        detail: a.description ?? a.category,
        actor: a.uploadedByName,
      })),
    );
  }

  register(kind: string, fn: TimelineProvider) {
    this.providers.push({ kind, fn });
  }

  kinds() {
    return [...new Set(this.providers.map((p) => p.kind))];
  }

  async timeline(patientId: string, opts: { kinds?: string[]; limit?: number } = {}) {
    const selected = opts.kinds?.length ? this.providers.filter((p) => opts.kinds!.includes(p.kind)) : this.providers;
    const events = (await Promise.all(selected.map((p) => p.fn(patientId)))).flat();
    events.sort((a, b) => b.at.getTime() - a.at.getTime());
    return events.slice(0, opts.limit ?? 500);
  }
}
