import { Injectable, OnModuleInit } from '@nestjs/common';
import type { Appointment } from '@prisma/client';
import type { HomeVisitSettingsInput } from '@vcms/shared';
import { AuditService } from '../../common/audit/audit.service';
import { ClientEvents } from '../../common/events/client-events';
import { RequestContext } from '../../common/context/request-context';
import { notFound, ruleViolation } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { ScopedTx } from '../../common/prisma/tenant-extension';
import { localDayBounds, zonedToUtc } from '../../common/time/tz';
import { ChargeCaptureService } from '../billing/charge-capture.service';
import { EncountersService } from '../clinical/encounters.service';
import { appointmentInclude, appointmentNo, shapeAppointment } from '../scheduling/appointments.service';

/** Charge sources: one call-out fee and one travel (per km) charge per home visit. */
const CALLOUT = 'HomeVisitCallout';
const DISTANCE = 'HomeVisitDistance';

const CLOSED = ['CANCELLED', 'NO_SHOW'];

/**
 * Home visits: a vet goes to the client's home. The booking itself is an ordinary appointment (with the address and
 * travel time); this service covers the vet's day on the road (set off, arrived, distance) and the call-out fee and
 * travel charge, which come from services in the clinic's price list (Settings → Home visits).
 */
@Injectable()
export class HomeVisitsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly charges: ChargeCaptureService,
    private readonly encounters: EncountersService,
    private readonly events: ClientEvents,
  ) {}

  onModuleInit() {
    // A home visit whose consultation is finished owes its call-out fee, even if nobody pressed "Arrived".
    this.encounters.registerCompletedHook(async (tx, encounterId) => {
      const e = await tx.encounter.findUnique({ where: { id: encounterId }, select: { id: true, appointment: true } });
      if (e?.appointment?.location === 'HOME') await this.captureFees(tx, e.appointment, e.id);
    });
  }

  // ── Settings ──

  private async org() {
    return this.prisma.raw.organization.findUniqueOrThrow({
      where: { id: RequestContext.orgId() },
      select: { homeVisitCalloutServiceId: true, homeVisitPerKmServiceId: true, homeVisitTravelMinutes: true, disabledModules: true },
    });
  }

  async settings() {
    const org = await this.org();
    const ids = [org.homeVisitCalloutServiceId, org.homeVisitPerKmServiceId].filter(Boolean) as string[];
    const services = ids.length ? await this.prisma.db.service.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, priceMinor: true, isActive: true } }) : [];
    const find = (id: string | null) => services.find((s) => s.id === id) ?? null;
    return {
      enabled: !org.disabledModules.includes('homeVisits'),
      travelMinutes: org.homeVisitTravelMinutes,
      callout: find(org.homeVisitCalloutServiceId),
      perKm: find(org.homeVisitPerKmServiceId),
    };
  }

  private async activeService(id: string | null | undefined) {
    if (!id) return null;
    // Scoped lookup: the service must belong to this clinic.
    const s = await this.prisma.db.service.findUnique({ where: { id } });
    if (!s || !s.isActive) throw ruleViolation('INVALID_SERVICE', 'Choose an active service from the price list');
    return s;
  }

  async saveSettings(input: HomeVisitSettingsInput) {
    const callout = await this.activeService(input.calloutServiceId);
    const perKm = await this.activeService(input.perKmServiceId);
    const id = RequestContext.orgId();
    await this.prisma.raw.$transaction(async (tx) => {
      const before = await tx.organization.findUniqueOrThrow({ where: { id }, select: { homeVisitCalloutServiceId: true, homeVisitPerKmServiceId: true, homeVisitTravelMinutes: true } });
      await tx.organization.update({ where: { id }, data: { homeVisitCalloutServiceId: callout?.id ?? null, homeVisitPerKmServiceId: perKm?.id ?? null, homeVisitTravelMinutes: input.travelMinutes } });
      await this.audit.record(
        {
          action: 'organization.home_visits_updated',
          entityType: 'Organization',
          entityId: id,
          summary: `Call-out fee: ${callout?.name ?? 'none'}; per km: ${perKm?.name ?? 'none'}; travel time ${input.travelMinutes} min`,
          changes: {
            homeVisitCalloutServiceId: { from: before.homeVisitCalloutServiceId, to: callout?.id ?? null },
            homeVisitPerKmServiceId: { from: before.homeVisitPerKmServiceId, to: perKm?.id ?? null },
            homeVisitTravelMinutes: { from: before.homeVisitTravelMinutes, to: input.travelMinutes },
          },
        },
        tx,
      );
    });
    return this.settings();
  }

  // ── The day on the road ──

  /** Home visits on a branch-local day, in time order, with the fees already added to the client's bill. */
  async day(q: { date: string; branchId?: string; clinicianId?: string }) {
    const ctx = RequestContext.require();
    const branchId = q.branchId ?? ctx.branchId;
    if (!branchId) throw ruleViolation('NO_BRANCH', 'Select a branch first');
    const branch = await this.prisma.db.branch.findUnique({ where: { id: branchId }, select: { id: true, timezone: true } });
    if (!branch) throw notFound('Branch');
    const start = zonedToUtc(q.date, 0, branch.timezone);
    const end = localDayBounds(new Date(start.getTime() + 12 * 3600_000), branch.timezone).end;
    const rows = await this.prisma.db.appointment.findMany({
      where: { branchId: branch.id, location: 'HOME', clinicianId: q.clinicianId, startsAt: { gte: start, lt: end } },
      include: { ...appointmentInclude, client: { select: { id: true, displayName: true, mobilePhone: true, email: true } } },
      orderBy: { startsAt: 'asc' },
    });
    const ids = rows.map((r) => r.id);
    const fees = ids.length
      ? await this.prisma.db.charge.findMany({
          where: { sourceType: { in: [CALLOUT, DISTANCE] }, sourceId: { in: ids } },
          select: { id: true, sourceType: true, sourceId: true, description: true, quantity: true, unitPriceMinor: true, status: true },
        })
      : [];
    return {
      date: q.date,
      timezone: branch.timezone,
      visits: rows.map((r) => ({
        ...shapeAppointment(r),
        client: r.client,
        fees: fees
          .filter((f) => f.sourceId === r.id)
          .map((f) => ({ id: f.id, kind: f.sourceType === CALLOUT ? 'CALLOUT' : 'DISTANCE', description: f.description, totalMinor: Math.round(Number(f.quantity) * f.unitPriceMinor), status: f.status })),
      })),
    };
  }

  private async visit(id: string) {
    const a = await this.prisma.db.appointment.findUnique({ where: { id } });
    if (!a || a.location !== 'HOME') throw notFound('Home visit');
    return a;
  }

  /** The vet sets off. Optionally tells the client (WhatsApp or email, as set in Settings → Client notifications). */
  async onTheWay(id: string, notifyClient: boolean) {
    const a = await this.visit(id);
    if (!['BOOKED', 'CONFIRMED'].includes(a.status)) throw ruleViolation('INVALID_TRANSITION', `This home visit is ${a.status.toLowerCase().replace('_', ' ')}`);
    if (a.arrivedAt) throw ruleViolation('ALREADY_ARRIVED', 'The vet has already arrived at this home visit');
    const now = new Date();
    await this.prisma.db.$transaction(async (tx) => {
      await tx.appointment.update({ where: { id }, data: { onTheWayAt: now } });
      await this.audit.record({ action: 'appointment.home_visit_on_the_way', entityType: 'Appointment', entityId: id, summary: `${appointmentNo(a.number)}${notifyClient ? ' (client told)' : ''}` }, tx);
    });
    if (notifyClient) await this.events.emit({ type: 'HOME_VISIT_ON_THE_WAY', appointmentId: id });
    return this.get(id);
  }

  /** The vet is at the house: the call-out fee (and travel, when the distance is known) go on the client's bill. */
  async arrived(id: string, distanceKm?: number | null) {
    const a = await this.visit(id);
    if (CLOSED.includes(a.status) || a.status === 'COMPLETED') throw ruleViolation('INVALID_TRANSITION', `This home visit is ${a.status.toLowerCase().replace('_', ' ')}`);
    if (a.arrivedAt) throw ruleViolation('ALREADY_ARRIVED', 'The vet is already marked as arrived');
    const now = new Date();
    await this.prisma.db.$transaction(async (tx) => {
      const after = await tx.appointment.update({
        where: { id },
        data: { arrivedAt: now, distanceKm: distanceKm ?? a.distanceKm },
      });
      await this.captureFees(tx, after);
      await this.audit.record(
        { action: 'appointment.home_visit_arrived', entityType: 'Appointment', entityId: id, summary: `${appointmentNo(a.number)}${distanceKm != null ? ` · ${distanceKm} km` : ''}` },
        tx,
      );
    });
    return this.get(id);
  }

  /** Records (or corrects) the distance travelled; an unbilled travel charge follows it. */
  async setDistance(id: string, distanceKm: number) {
    const a = await this.visit(id);
    if (CLOSED.includes(a.status)) throw ruleViolation('INVALID_TRANSITION', `This home visit is ${a.status.toLowerCase().replace('_', ' ')}`);
    const charge = await this.prisma.db.charge.findFirst({ where: { sourceType: DISTANCE, sourceId: id } });
    if (charge?.status === 'INVOICED' && Number(charge.quantity) !== distanceKm) {
      throw ruleViolation('ALREADY_INVOICED', 'The travel charge is already on an invoice. Correct the invoice instead.');
    }
    await this.prisma.db.$transaction(async (tx) => {
      const after = await tx.appointment.update({ where: { id }, data: { distanceKm } });
      if (charge?.status === 'PENDING') {
        if (distanceKm > 0) await tx.charge.update({ where: { id: charge.id }, data: { quantity: distanceKm, description: this.distanceText(a, distanceKm) } });
        else await tx.charge.update({ where: { id: charge.id }, data: { status: 'WAIVED', waivedReason: 'Distance corrected to 0 km' } });
      } else if (!charge && a.arrivedAt) {
        // Fees are added once the vet is there; before that the distance is only noted.
        await this.captureFees(tx, after);
      }
      await this.audit.record(
        { action: 'appointment.home_visit_distance', entityType: 'Appointment', entityId: id, summary: `${appointmentNo(a.number)}: ${a.distanceKm === null ? '—' : Number(a.distanceKm)} → ${distanceKm} km` },
        tx,
      );
    });
    return this.get(id);
  }

  private distanceText(a: Pick<Appointment, 'number'>, km: number) {
    return `Home visit travel: ${km} km (${appointmentNo(a.number)})`;
  }

  /** Adds the call-out fee and travel charge from the clinic's settings. Safe to call more than once (one charge per source). */
  private async captureFees(tx: ScopedTx, a: Appointment, encounterId?: string | null) {
    const org = await this.org();
    const encounter = encounterId ?? (await tx.encounter.findUnique({ where: { appointmentId: a.id }, select: { id: true } }))?.id ?? null;
    const base = { clientId: a.clientId, patientId: a.patientId, encounterId: encounter, branchId: a.branchId, kind: 'SERVICE' as const };
    const callout = org.homeVisitCalloutServiceId ? await tx.service.findUnique({ where: { id: org.homeVisitCalloutServiceId } }) : null;
    if (callout?.isActive) {
      await this.charges.capture(tx, {
        ...base,
        sourceType: CALLOUT,
        sourceId: a.id,
        serviceId: callout.id,
        description: `${callout.name} (${appointmentNo(a.number)})`,
        quantity: 1,
        unitPriceMinor: callout.priceMinor,
        taxRateBasisPoints: await this.charges.taxFor(tx, callout.taxRateId),
      });
    }
    const km = a.distanceKm === null ? 0 : Number(a.distanceKm);
    const perKm = org.homeVisitPerKmServiceId ? await tx.service.findUnique({ where: { id: org.homeVisitPerKmServiceId } }) : null;
    if (perKm?.isActive && km > 0) {
      await this.charges.capture(tx, {
        ...base,
        sourceType: DISTANCE,
        sourceId: a.id,
        serviceId: perKm.id,
        description: this.distanceText(a, km),
        quantity: km,
        unitPriceMinor: perKm.priceMinor,
        taxRateBasisPoints: await this.charges.taxFor(tx, perKm.taxRateId),
      });
    }
  }

  private async get(id: string) {
    const a = await this.prisma.db.appointment.findUniqueOrThrow({ where: { id }, include: appointmentInclude });
    return shapeAppointment(a);
  }
}
