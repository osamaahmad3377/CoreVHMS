import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { localParts } from '../../common/time/tz';
import { DashboardService } from '../dashboard/dashboard.service';

/** Dashboard: online bookings still waiting for the front desk to confirm. */
@Injectable()
export class OnlineBookingIntegrations implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dashboard: DashboardService,
  ) {}

  onModuleInit() {
    this.dashboard.register({
      key: 'onlineBookings',
      permission: 'appointments.read',
      load: async () => {
        const where = { source: 'ONLINE' as const, status: 'BOOKED' as const, startsAt: { gte: new Date() } };
        const [toConfirm, first] = await Promise.all([
          this.prisma.db.appointment.count({ where }),
          this.prisma.db.appointment.findFirst({ where, orderBy: { startsAt: 'asc' }, select: { startsAt: true, branch: { select: { timezone: true } } } }),
        ]);
        return { toConfirm, firstDate: first ? localParts(first.startsAt, first.branch.timezone).date : null };
      },
    });
  }
}
