import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { z } from 'zod';
import type { boardingStaySchema, boardingUnitSchema, updateStaySchema } from '@vcms/shared';
import { AuditService, diff } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { CounterService, formatNumber } from '../../common/counter/counter.service';
import { conflict, notFound, ruleViolation } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { ScopedTx } from '../../common/prisma/tenant-extension';
import { branchToday } from '../../common/time/branch-timezone';
import { localParts } from '../../common/time/tz';
import { ChargeCaptureService } from '../billing/charge-capture.service';

export const stayNo = (n: number) => formatNumber('BRD', n, 5);
const DAY = 86400_000;
const ACTIVE = ['RESERVED', 'CHECKED_IN'] as const;
/** Normalises a date-only input (yyyy-MM-dd, parsed as UTC midnight). For "today" use `branchToday`. */
const dateOnly = (d: Date) => new Date(d.toISOString().slice(0, 10));

const include = {
  patient: {
    select: {
      id: true, name: true, number: true, sex: true, dateOfBirth: true,
      species: { select: { name: true } }, breed: { select: { name: true } },
      alerts: { where: { isActive: true }, select: { id: true, type: true, severity: true, title: true } },
    },
  },
  client: { select: { id: true, displayName: true, mobilePhone: true } },
  unit: { select: { id: true, name: true, type: true } },
} satisfies Prisma.BoardingStayInclude;
type Stay = Prisma.BoardingStayGetPayload<{ include: typeof include }>;

const shape = (s: Stay) => ({ ...s, stayNo: stayNo(s.number), nights: Math.round((s.endDate.getTime() - s.startDate.getTime()) / DAY) });

/** Boarding units, reservations, check-in/out with nightly billing, and the daily care log. */
@Injectable()
export class BoardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly counters: CounterService,
    private readonly charges: ChargeCaptureService,
  ) {}

  // ── Units ──

  units(branchId?: string, all = false) {
    return this.prisma.db.boardingUnit.findMany({
      where: { branchId, isActive: all ? undefined : true },
      include: { nightlyService: { select: { id: true, name: true, priceMinor: true } } },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  private async checkService(id?: string | null) {
    if (!id) return;
    const s = await this.prisma.db.service.findUnique({ where: { id } });
    if (!s || !s.isActive) throw ruleViolation('INVALID_SERVICE', 'Nightly rate service not found or inactive');
  }

  async createUnit(input: z.infer<typeof boardingUnitSchema>) {
    const b = await this.prisma.db.branch.findUnique({ where: { id: input.branchId } });
    if (!b) throw notFound('Branch');
    await this.checkService(input.nightlyServiceId);
    try {
      return await this.prisma.db.$transaction(async (tx) => {
        const u = await tx.boardingUnit.create({ data: { ...input, organizationId: RequestContext.orgId() } });
        await this.audit.record({ action: 'boarding_unit.created', entityType: 'BoardingUnit', entityId: u.id, summary: u.name }, tx);
        return u;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw conflict('A unit with this name already exists at this branch');
      throw e;
    }
  }

  async updateUnit(id: string, input: Partial<z.infer<typeof boardingUnitSchema>>) {
    const before = await this.prisma.db.boardingUnit.findUnique({ where: { id } });
    if (!before) throw notFound('Unit');
    await this.checkService(input.nightlyServiceId);
    if (input.isActive === false && (await this.prisma.db.boardingStay.findFirst({ where: { unitId: id, status: 'CHECKED_IN' } }))) throw ruleViolation('UNIT_OCCUPIED', 'An animal is boarding in this unit');
    const { branchId: _ignored, ...data } = input;
    try {
      return await this.prisma.db.$transaction(async (tx) => {
        const after = await tx.boardingUnit.update({ where: { id }, data });
        await this.audit.record({ action: 'boarding_unit.updated', entityType: 'BoardingUnit', entityId: id, changes: diff(before, after, Object.keys(data)) }, tx);
        return after;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw conflict('A unit with this name already exists at this branch');
      throw e;
    }
  }

  /** Locks the unit and rejects overlapping reservations or stays (arrival day < other departure and vice versa). */
  private async assertFree(tx: ScopedTx, unitId: string, start: Date, end: Date, exceptId?: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'boarding-unit:' + unitId}))`;
    const clash = await tx.boardingStay.findFirst({
      where: { unitId, status: { in: [...ACTIVE] }, startDate: { lt: end }, endDate: { gt: start }, NOT: exceptId ? { id: exceptId } : undefined },
      include: { patient: { select: { name: true } } },
    });
    if (clash) throw conflict(`This unit is booked for ${clash.patient.name} (${clash.startDate.toISOString().slice(0, 10)} to ${clash.endDate.toISOString().slice(0, 10)})`, { code: 'UNIT_BOOKED' });
  }

  async availability(branchId: string, start: Date, end: Date) {
    const units = await this.units(branchId);
    const stays = await this.prisma.db.boardingStay.findMany({
      where: { branchId, unitId: { in: units.map((u) => u.id) }, status: { in: [...ACTIVE] }, startDate: { lt: dateOnly(end) }, endDate: { gt: dateOnly(start) } },
      include: { patient: { select: { id: true, name: true } } },
    });
    return units.map((u) => ({ ...u, stays: stays.filter((s) => s.unitId === u.id).map((s) => ({ id: s.id, stayNo: stayNo(s.number), patient: s.patient, startDate: s.startDate, endDate: s.endDate, status: s.status })) }));
  }

  // ── Stays ──

  private async unit(unitId: string | null | undefined, branchId: string) {
    if (!unitId) return null;
    const u = await this.prisma.db.boardingUnit.findUnique({ where: { id: unitId }, include: { nightlyService: true } });
    if (!u || !u.isActive || u.branchId !== branchId) throw ruleViolation('INVALID_UNIT', 'Unit not found at this branch');
    return u;
  }

  async list(q: { from?: Date; to?: Date; status?: string; branchId?: string; patientId?: string }) {
    const rows = await this.prisma.db.boardingStay.findMany({
      where: {
        branchId: q.branchId,
        patientId: q.patientId,
        status: q.status ? { in: q.status.split(',') as any } : undefined,
        ...(q.from || q.to ? { startDate: q.to ? { lte: dateOnly(q.to) } : undefined, endDate: q.from ? { gte: dateOnly(q.from) } : undefined } : {}),
      },
      include,
      orderBy: { startDate: 'asc' },
      take: 300,
    });
    return rows.map(shape);
  }

  /** Today at a glance for a branch: arrivals, departures and who is in. */
  async board(branchId: string) {
    const branch = await this.prisma.db.branch.findUnique({ where: { id: branchId } });
    if (!branch) throw notFound('Branch');
    const today = new Date(localParts(new Date(), branch.timezone).date);
    const [arriving, inHouse, upcoming] = await Promise.all([
      this.prisma.db.boardingStay.findMany({ where: { branchId, status: 'RESERVED', startDate: { lte: today } }, include, orderBy: { startDate: 'asc' } }),
      this.prisma.db.boardingStay.findMany({ where: { branchId, status: 'CHECKED_IN' }, include, orderBy: { endDate: 'asc' } }),
      this.prisma.db.boardingStay.findMany({ where: { branchId, status: 'RESERVED', startDate: { gt: today, lte: new Date(today.getTime() + 14 * DAY) } }, include, orderBy: { startDate: 'asc' } }),
    ]);
    const units = await this.units(branchId);
    return {
      today,
      arriving: arriving.map(shape),
      inHouse: inHouse.map((s) => ({ ...shape(s), departingToday: s.endDate.getTime() <= today.getTime() })),
      upcoming: upcoming.map(shape),
      occupancy: { units: units.length, occupied: new Set(inHouse.map((s) => s.unitId).filter(Boolean)).size },
    };
  }

  async get(id: string) {
    const s = await this.prisma.db.boardingStay.findUnique({ where: { id }, include });
    if (!s) throw notFound('Boarding stay');
    const [logs, overdue, charge] = await Promise.all([
      this.prisma.db.boardingLog.findMany({ where: { stayId: id }, orderBy: { recordedAt: 'desc' }, take: 300 }),
      this.overdueVaccinations(s.patientId, s.branchId),
      this.prisma.db.charge.findFirst({ where: { sourceType: 'BoardingStay', sourceId: id }, select: { id: true, status: true, quantity: true, unitPriceMinor: true } }),
    ]);
    return { ...shape(s), logs, overdueVaccinations: overdue, charge: charge ? { ...charge, quantity: Number(charge.quantity) } : null };
  }

  /** Vaccinations due before today and not done (from the preventive-care plan). */
  async overdueVaccinations(patientId: string, branchId?: string | null) {
    const today = await branchToday(this.prisma, branchId);
    return this.prisma.db.careItem.findMany({
      where: { patientId, kind: 'VACCINATION', OR: [{ status: 'DUE', dueDate: { lt: today } }, { status: 'DEFERRED', deferredUntil: { lt: today } }] },
      select: { id: true, title: true, dueDate: true, status: true },
      orderBy: { dueDate: 'asc' },
    });
  }

  async create(input: z.infer<typeof boardingStaySchema>) {
    const ctx = RequestContext.require();
    const branchId = input.branchId ?? ctx.branchId;
    if (!branchId) throw ruleViolation('NO_BRANCH', 'Select a branch first');
    const patient = await this.prisma.db.patient.findUnique({ where: { id: input.patientId }, include: { ownerships: { where: { endedAt: null, isPrimary: true } } } });
    if (!patient || patient.status !== 'ACTIVE') throw ruleViolation('INVALID_PATIENT', 'Animal not found or not active');
    const owner = patient.ownerships[0];
    if (!owner) throw ruleViolation('NO_OWNER', 'This animal has no current owner');
    const start = dateOnly(input.startDate);
    const end = dateOnly(input.endDate);
    if (end.getTime() < (await branchToday(this.prisma, branchId)).getTime()) throw ruleViolation('PAST_DATES', 'This stay has already ended');
    const overlap = await this.prisma.db.boardingStay.findFirst({ where: { patientId: patient.id, status: { in: [...ACTIVE] }, startDate: { lt: end }, endDate: { gt: start } } });
    if (overlap) throw conflict(`${patient.name} already has a booking for these dates (${stayNo(overlap.number)})`);
    const unit = await this.unit(input.unitId, branchId);
    return this.prisma.db.$transaction(async (tx) => {
      if (unit) await this.assertFree(tx, unit.id, start, end);
      const number = await this.counters.next(tx, 'boarding');
      const s = await tx.boardingStay.create({
        data: {
          organizationId: ctx.organizationId!,
          branchId,
          number,
          patientId: patient.id,
          clientId: owner.clientId,
          unitId: unit?.id ?? null,
          startDate: start,
          endDate: end,
          nightlyRateMinor: unit?.nightlyService?.isActive ? unit.nightlyService.priceMinor : 0,
          nightlyServiceId: unit?.nightlyService?.isActive ? unit.nightlyService.id : null,
          feedingInstructions: input.feedingInstructions,
          medicationInstructions: input.medicationInstructions,
          belongings: input.belongings,
          behaviourNotes: input.behaviourNotes,
          emergencyContact: input.emergencyContact,
          createdByName: ctx.userName,
        },
        include,
      });
      await this.audit.record({ action: 'boarding.reserved', entityType: 'Patient', entityId: patient.id, summary: `${stayNo(number)} ${start.toISOString().slice(0, 10)} → ${end.toISOString().slice(0, 10)}` }, tx);
      return shape(s);
    });
  }

  private async stay(id: string) {
    const s = await this.prisma.db.boardingStay.findUnique({ where: { id } });
    if (!s) throw notFound('Boarding stay');
    return s;
  }

  async update(id: string, input: z.infer<typeof updateStaySchema>) {
    const before = await this.stay(id);
    if (!ACTIVE.includes(before.status as any)) throw ruleViolation('STAY_CLOSED', `This stay is ${before.status.toLowerCase().replace('_', ' ')}`);
    if (before.status === 'CHECKED_IN' && input.startDate && dateOnly(input.startDate).getTime() !== before.startDate.getTime()) throw ruleViolation('ALREADY_ARRIVED', 'The arrival date cannot change after check-in');
    const start = input.startDate ? dateOnly(input.startDate) : before.startDate;
    const end = input.endDate ? dateOnly(input.endDate) : before.endDate;
    if (end <= start) throw ruleViolation('INVALID_DATES', 'Departure must be after arrival');
    const unitId = input.unitId === undefined ? before.unitId : input.unitId;
    const unit = await this.unit(unitId, before.branchId);
    return this.prisma.db.$transaction(async (tx) => {
      if (unit) await this.assertFree(tx, unit.id, start, end, id);
      const rate = unit && unit.id !== before.unitId && before.status === 'RESERVED' ? { nightlyRateMinor: unit.nightlyService?.isActive ? unit.nightlyService.priceMinor : 0, nightlyServiceId: unit.nightlyService?.isActive ? unit.nightlyService.id : null } : {};
      const after = await tx.boardingStay.update({ where: { id }, data: { ...input, startDate: start, endDate: end, unitId: unit?.id ?? null, ...rate }, include });
      await this.audit.record({ action: 'boarding.updated', entityType: 'Patient', entityId: before.patientId, summary: stayNo(before.number), changes: diff(before, after, [...Object.keys(input), 'nightlyRateMinor']) }, tx);
      return shape(after);
    });
  }

  async checkIn(id: string, input: { unitId?: string | null; vaccinationOverride?: string | null }) {
    const s = await this.stay(id);
    if (s.status !== 'RESERVED') throw ruleViolation('NOT_RESERVED', 'Only reservations can be checked in');
    const unit = await this.unit(input.unitId ?? s.unitId, s.branchId);
    if (!unit) throw ruleViolation('UNIT_REQUIRED', 'Choose a kennel/unit for the animal');
    const overdue = await this.overdueVaccinations(s.patientId, s.branchId);
    if (overdue.length && !input.vaccinationOverride) {
      throw ruleViolation('VACCINATIONS_OVERDUE', `Vaccinations overdue: ${overdue.map((o) => o.title).join(', ')}. Record them or note why the animal is accepted anyway.`, { overdue });
    }
    const ctx = RequestContext.require();
    try {
      return await this.prisma.db.$transaction(async (tx) => {
        await this.assertFree(tx, unit.id, s.startDate, s.endDate, id);
        const rate = unit.id !== s.unitId ? { nightlyRateMinor: unit.nightlyService?.isActive ? unit.nightlyService.priceMinor : 0, nightlyServiceId: unit.nightlyService?.isActive ? unit.nightlyService.id : null } : {};
        const after = await tx.boardingStay.update({ where: { id }, data: { status: 'CHECKED_IN', unitId: unit.id, checkedInAt: new Date(), checkedInByName: ctx.userName, vaccinationOverride: overdue.length ? input.vaccinationOverride : null, ...rate }, include });
        await this.audit.record({ action: 'boarding.checked_in', entityType: 'Patient', entityId: s.patientId, summary: `${stayNo(s.number)} → ${unit.name}${overdue.length ? ` (vaccinations overdue, accepted: ${input.vaccinationOverride})` : ''}` }, tx);
        return shape(after);
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw conflict('This animal is already checked in to another stay');
      throw e;
    }
  }

  /** Checks out and bills the nights stayed (at least one) at the rate fixed when booked. */
  async checkOut(id: string) {
    const s = await this.prisma.db.boardingStay.findUnique({ where: { id }, include: { branch: true } });
    if (!s) throw notFound('Boarding stay');
    if (s.status !== 'CHECKED_IN') throw ruleViolation('NOT_CHECKED_IN', 'Only animals that are checked in can be checked out');
    const today = new Date(localParts(new Date(), s.branch.timezone).date);
    const nights = Math.max(1, Math.round((today.getTime() - s.startDate.getTime()) / DAY));
    const ctx = RequestContext.require();
    return this.prisma.db.$transaction(async (tx) => {
      if (s.nightlyRateMinor > 0) {
        const svc = s.nightlyServiceId ? await tx.service.findUnique({ where: { id: s.nightlyServiceId } }) : null;
        await this.charges.capture(tx, {
          sourceType: 'BoardingStay',
          sourceId: s.id,
          clientId: s.clientId,
          patientId: s.patientId,
          branchId: s.branchId,
          kind: 'SERVICE',
          serviceId: s.nightlyServiceId,
          description: `${svc?.name ?? 'Boarding'} — ${nights} night${nights === 1 ? '' : 's'} (${stayNo(s.number)})`,
          quantity: nights,
          unitPriceMinor: s.nightlyRateMinor,
          taxRateBasisPoints: await this.charges.taxFor(tx, svc?.taxRateId),
        });
      }
      const after = await tx.boardingStay.update({ where: { id }, data: { status: 'CHECKED_OUT', checkedOutAt: new Date(), checkedOutByName: ctx.userName, nightsCharged: nights }, include });
      await this.audit.record({ action: 'boarding.checked_out', entityType: 'Patient', entityId: s.patientId, summary: `${stayNo(s.number)}: ${nights} night(s)` }, tx);
      return shape(after);
    });
  }

  async cancel(id: string, reason: string, noShow = false) {
    const s = await this.stay(id);
    if (s.status !== 'RESERVED') throw ruleViolation('NOT_RESERVED', 'Only reservations can be cancelled; check the animal out instead');
    return this.prisma.db.$transaction(async (tx) => {
      const after = await tx.boardingStay.update({ where: { id }, data: { status: noShow ? 'NO_SHOW' : 'CANCELLED', cancelledAt: new Date(), cancelReason: reason }, include });
      await this.audit.record({ action: noShow ? 'boarding.no_show' : 'boarding.cancelled', entityType: 'Patient', entityId: s.patientId, summary: `${stayNo(s.number)}: ${reason}` }, tx);
      return shape(after);
    });
  }

  async addLog(id: string, kind: 'FEEDING' | 'WALK' | 'MEDICATION' | 'NOTE' | 'INCIDENT', text: string) {
    const s = await this.stay(id);
    if (s.status !== 'CHECKED_IN') throw ruleViolation('NOT_CHECKED_IN', 'Care is logged while the animal is boarding');
    const ctx = RequestContext.require();
    return this.prisma.db.$transaction(async (tx) => {
      const log = await tx.boardingLog.create({ data: { organizationId: ctx.organizationId!, stayId: id, kind, text, recordedById: ctx.userId, recordedByName: ctx.userName ?? 'Unknown' } });
      if (kind === 'INCIDENT') await this.audit.record({ action: 'boarding.incident', entityType: 'Patient', entityId: s.patientId, summary: `${stayNo(s.number)}: ${text.slice(0, 200)}` }, tx);
      return log;
    });
  }
}
