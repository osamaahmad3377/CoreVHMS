import { Injectable } from '@nestjs/common';
import type { StaffNotificationKind } from '@prisma/client';
import { RequestContext } from '../../common/context/request-context';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { ScopedTx } from '../../common/prisma/tenant-extension';
import { appointmentNo } from '../scheduling/appointments.service';

/** How far back the bell looks. */
const KEEP_DAYS = 30;

/**
 * Staff notifications (the bell in the top bar): things that happened without anyone at the clinic doing them —
 * a client booked, moved or cancelled online. Each member of staff has their own read state.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Records a notification; pass the transaction of the change it is about when there is one. */
  async notify(input: { kind: StaffNotificationKind; branchId: string; appointmentId: string; previousStartsAt?: Date | null; detail?: string | null }, tx?: ScopedTx) {
    const db = tx ?? this.prisma.db;
    await db.staffNotification.create({ data: { kind: input.kind, branchId: input.branchId, appointmentId: input.appointmentId, previousStartsAt: input.previousStartsAt ?? null, detail: input.detail?.slice(0, 500) ?? null } as never });
  }

  private scope(branchId?: string) {
    return { createdAt: { gte: new Date(Date.now() - KEEP_DAYS * 86400_000) }, ...(branchId ? { branchId } : {}) };
  }

  async list(q: { branchId?: string; unread?: boolean; limit: number }) {
    const userId = RequestContext.get()!.userId!;
    const db = this.prisma.db;
    const where = { ...this.scope(q.branchId), ...(q.unread ? { reads: { none: { userId } } } : {}) };
    const [rows, unread] = await Promise.all([
      db.staffNotification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: q.limit,
        include: {
          reads: { where: { userId }, select: { readAt: true } },
          appointment: {
            select: {
              id: true,
              number: true,
              startsAt: true,
              status: true,
              location: true,
              visitAddress: true,
              reason: true,
              branch: { select: { name: true, timezone: true } },
              appointmentType: { select: { name: true } },
              patient: { select: { id: true, name: true, species: { select: { name: true } } } },
              client: { select: { id: true, displayName: true, mobilePhone: true } },
              clinician: { select: { user: { select: { name: true } } } },
            },
          },
        },
      }),
      db.staffNotification.count({ where: { ...this.scope(q.branchId), reads: { none: { userId } } } }),
    ]);
    return {
      unread,
      items: rows.map(({ reads, appointment: a, ...n }) => ({
        ...n,
        read: reads.length > 0,
        appointment: a && {
          id: a.id,
          appointmentNo: appointmentNo(a.number),
          startsAt: a.startsAt,
          status: a.status,
          location: a.location,
          visitAddress: a.visitAddress,
          reason: a.reason,
          service: a.appointmentType?.name ?? null,
          branch: a.branch,
          patient: a.patient && { id: a.patient.id, name: a.patient.name, species: a.patient.species?.name ?? null },
          client: a.client,
          vet: a.clinician?.user.name ?? null,
        },
      })),
    };
  }

  /** Marks the given notifications (or every one in the branch) as read for the signed-in user. */
  async markRead(input: { ids?: string[]; branchId?: string }) {
    const userId = RequestContext.get()!.userId!;
    const db = this.prisma.db;
    const unread = await db.staffNotification.findMany({
      where: { ...this.scope(input.branchId), reads: { none: { userId } }, ...(input.ids?.length ? { id: { in: input.ids } } : {}) },
      select: { id: true },
    });
    if (unread.length) await db.staffNotificationRead.createMany({ data: unread.map((n) => ({ notificationId: n.id, userId })) as never, skipDuplicates: true });
    return { marked: unread.length };
  }
}
