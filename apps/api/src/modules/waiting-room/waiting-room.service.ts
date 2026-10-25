import { Injectable } from '@nestjs/common';
import type { WaitingRoomSettings } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { randomToken } from '../../common/crypto/crypto';
import { notFound, ruleViolation } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { localDayBounds } from '../../common/time/tz';
import { AttachmentsService } from '../attachments/attachments.service';
import { phoneKey } from '../clients/clients.service';
import { brandingOf, OrganizationsService } from '../organizations/organizations.service';
import { AppointmentsService } from '../scheduling/appointments.service';

const PRIORITY_RANK: Record<string, number> = { RESUSCITATION: 0, EMERGENT: 1, URGENT: 2, LESS_URGENT: 3, NON_URGENT: 4 };
const newKey = () => randomToken(18).replace(/[^A-Za-z0-9]/g, '').slice(0, 20) + randomToken(6).replace(/[^A-Za-z0-9]/g, '');

/**
 * The waiting room of a branch: a TV screen showing who is called to which room (and the queue by token), and a
 * tablet at the door where clients check themselves in with their mobile number. Each opens with its own secret
 * link, without a staff sign-in.
 */
@Injectable()
export class WaitingRoomService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly appointments: AppointmentsService,
    private readonly orgs: OrganizationsService,
    private readonly attachments: AttachmentsService,
  ) {}

  // ── Settings (staff) ──

  /** Every branch with its waiting-room settings (created on first look, with fresh secret links). */
  async list() {
    const db = this.prisma.db;
    const branches = await db.branch.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } });
    const rows = await db.waitingRoomSettings.findMany();
    const missing = branches.filter((b) => !rows.some((r) => r.branchId === b.id));
    if (missing.length) {
      await db.waitingRoomSettings.createMany({ data: missing.map((b) => ({ organizationId: RequestContext.orgId(), branchId: b.id, displayKey: newKey(), kioskKey: newKey() })), skipDuplicates: true });
    }
    const all = await db.waitingRoomSettings.findMany();
    const rooms = await db.resource.findMany({ where: { isActive: true, type: 'ROOM' }, orderBy: { name: 'asc' }, select: { branchId: true, name: true } });
    return branches.map((b) => {
      const s = all.find((r) => r.branchId === b.id)!;
      return { branch: b, ...this.view(s), rooms: rooms.filter((r) => r.branchId === b.id).map((r) => r.name) };
    });
  }

  private view(s: WaitingRoomSettings) {
    return {
      displayEnabled: s.displayEnabled,
      kioskEnabled: s.kioskEnabled,
      showPetNames: s.showPetNames,
      kioskWalkIns: s.kioskWalkIns,
      announce: s.announce,
      message: s.message ?? '',
      displayPath: `/display/${s.displayKey}`,
      kioskPath: `/kiosk/${s.kioskKey}`,
      updatedByName: s.updatedByName,
    };
  }

  private async mine(branchId: string) {
    await this.list();
    const s = await this.prisma.db.waitingRoomSettings.findFirst({ where: { branchId } });
    if (!s) throw notFound('Branch');
    return s;
  }

  async save(branchId: string, input: { displayEnabled: boolean; kioskEnabled: boolean; showPetNames: boolean; kioskWalkIns: boolean; announce: boolean; message?: string }) {
    const s = await this.mine(branchId);
    const ctx = RequestContext.require();
    await this.prisma.db.$transaction(async (tx) => {
      await tx.waitingRoomSettings.update({ where: { id: s.id }, data: { ...input, message: input.message || null, updatedByName: ctx.userName ?? null } });
      await this.audit.record({ action: 'waiting_room.updated', entityType: 'Organization', entityId: ctx.organizationId!, summary: `Screen ${input.displayEnabled ? 'on' : 'off'}, tablet ${input.kioskEnabled ? 'on' : 'off'}` }, tx);
    });
    return this.list();
  }

  /** New secret links (the old ones stop working at once), e.g. if a link was shared by mistake. */
  async newLinks(branchId: string) {
    const s = await this.mine(branchId);
    const ctx = RequestContext.require();
    await this.prisma.db.$transaction(async (tx) => {
      await tx.waitingRoomSettings.update({ where: { id: s.id }, data: { displayKey: newKey(), kioskKey: newKey(), updatedByName: ctx.userName ?? null } });
      await this.audit.record({ action: 'waiting_room.links_renewed', entityType: 'Organization', entityId: ctx.organizationId! }, tx);
    });
    return this.list();
  }

  /** Room names to call patients to (Rooms & equipment of type "room" at the branch). */
  async rooms(branchId: string) {
    return (await this.prisma.db.resource.findMany({ where: { branchId, isActive: true, type: 'ROOM' }, orderBy: { name: 'asc' }, select: { name: true } })).map((r) => r.name);
  }

  // ── Devices (public, by secret link) ──

  private async device(kind: 'display' | 'kiosk', key: string) {
    const s = /^[A-Za-z0-9]{16,40}$/.test(key) ? await this.prisma.raw.waitingRoomSettings.findUnique({ where: kind === 'display' ? { displayKey: key } : { kioskKey: key } }) : null;
    if (!s || !(kind === 'display' ? s.displayEnabled : s.kioskEnabled)) throw notFound(kind === 'display' ? 'Waiting-room screen' : 'Check-in tablet');
    const [org, branch] = await Promise.all([this.prisma.raw.organization.findUniqueOrThrow({ where: { id: s.organizationId } }), this.prisma.raw.branch.findUniqueOrThrow({ where: { id: s.branchId } })]);
    return { s, org, branch };
  }

  private run<T>(s: WaitingRoomSettings, fn: () => Promise<T>) {
    return RequestContext.runAs({ organizationId: s.organizationId, branchId: s.branchId, userName: 'Check-in tablet' }, fn);
  }

  async logo(kind: 'display' | 'kiosk', key: string) {
    const { s, org } = await this.device(kind, key);
    const id = this.orgs.brandImageId(org, 'logo');
    if (!id) throw notFound('Logo');
    return this.run(s, () => this.attachments.openBrandImage(id));
  }

  /** What the TV shows: the latest calls (token → room) and the tokens still waiting, in the order they will be seen. */
  async display(key: string) {
    const { s, org, branch } = await this.device('display', key);
    return this.run(s, async () => {
      const { start, end } = localDayBounds(new Date(), branch.timezone);
      const today = await this.prisma.db.appointment.findMany({
        where: { branchId: branch.id, tokenNumber: { not: null }, OR: [{ startsAt: { gte: start, lt: end } }, { checkedInAt: { gte: start, lt: end } }] },
        select: { id: true, tokenNumber: true, status: true, calledAt: true, calledRoom: true, callCount: true, checkedInAt: true, priority: true, patient: { select: { name: true } }, triage: { select: { priority: true }, orderBy: { assessedAt: 'desc' }, take: 1 } },
      });
      const pet = (n?: string | null) => (s.showPetNames && n ? n : null);
      const calls = today
        .filter((a) => a.calledAt && ['CHECKED_IN', 'IN_CONSULTATION', 'COMPLETED'].includes(a.status))
        .sort((a, b) => b.calledAt!.getTime() - a.calledAt!.getTime())
        .slice(0, 6)
        .map((a) => ({ id: a.id, token: a.tokenNumber, room: a.calledRoom, pet: pet(a.patient?.name), calledAt: a.calledAt, callCount: a.callCount }));
      const waiting = today
        .filter((a) => a.status === 'CHECKED_IN' && !a.calledAt)
        .sort((a, b) => (PRIORITY_RANK[a.triage[0]?.priority ?? a.priority ?? 'NON_URGENT'] ?? 5) - (PRIORITY_RANK[b.triage[0]?.priority ?? b.priority ?? 'NON_URGENT'] ?? 5) || (a.checkedInAt?.getTime() ?? 0) - (b.checkedInAt?.getTime() ?? 0))
        .map((a) => ({ token: a.tokenNumber, pet: pet(a.patient?.name) }));
      const branding = brandingOf(org, `/api/v1/public/waiting-room/display/${key}`);
      return { clinic: { name: branding.brandName, branding }, branch: { name: branch.name, timezone: branch.timezone }, message: s.message, announce: s.announce, now: new Date(), calls, waiting };
    });
  }

  /** What the tablet shows before anyone types: the clinic, and what walk-ins can come for. */
  async kiosk(key: string) {
    const { s, org, branch } = await this.device('kiosk', key);
    return this.run(s, async () => {
      const branding = brandingOf(org, `/api/v1/public/waiting-room/kiosk/${key}`);
      return { clinic: { name: branding.brandName, phone: org.phone, branding }, branch: { name: branch.name, timezone: branch.timezone }, walkIns: s.kioskWalkIns ? await this.walkInTypes() : [] };
    });
  }

  private async walkInTypes() {
    const db = this.prisma.db;
    const online = await db.appointmentType.findMany({ where: { isActive: true, allowOnlineBooking: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } });
    if (online.length) return online.slice(0, 6);
    return db.appointmentType.findMany({ where: { isActive: true, category: { in: ['CONSULTATION', 'VACCINATION'] } }, orderBy: { name: 'asc' }, take: 6, select: { id: true, name: true } });
  }

  /** The client with this mobile number, their visits today at this branch, and their animals. */
  private async whoIs(branchId: string, timezone: string, mobilePhone: string) {
    const key = phoneKey(mobilePhone);
    if (!key) throw ruleViolation('INVALID_PHONE', 'Please enter your full mobile number.');
    const db = this.prisma.db;
    const clients = await db.client.findMany({ where: { phoneDigits: key, status: 'ACTIVE' }, select: { id: true, firstName: true, displayName: true } });
    const { start, end } = localDayBounds(new Date(), timezone);
    const ids = clients.map((c) => c.id);
    const [visits, pets] = await Promise.all([
      db.appointment.findMany({ where: { clientId: { in: ids }, branchId, startsAt: { gte: start, lt: end }, status: { in: ['BOOKED', 'CONFIRMED', 'CHECKED_IN'] } }, orderBy: { startsAt: 'asc' }, select: { id: true, clientId: true, startsAt: true, status: true, tokenNumber: true, patient: { select: { name: true } }, appointmentType: { select: { name: true } } } }),
      db.patient.findMany({ where: { status: 'ACTIVE', ownerships: { some: { clientId: { in: ids }, endedAt: null } } }, orderBy: { name: 'asc' }, select: { id: true, name: true, ownerships: { where: { endedAt: null }, select: { clientId: true } } } }),
    ]);
    return { clients, visits, pets };
  }

  async lookup(key: string, mobilePhone: string) {
    const { s, branch } = await this.device('kiosk', key);
    return this.run(s, async () => {
      const w = await this.whoIs(branch.id, branch.timezone, mobilePhone);
      if (!w.clients.length) return { found: false as const };
      return {
        found: true as const,
        // Only a first name and the animals' names are shown: enough to recognise yourself, little to anyone else.
        firstName: w.clients[0].firstName ?? w.clients[0].displayName.split(' ')[0],
        visits: w.visits.map((v) => ({ id: v.id, startsAt: v.startsAt, petName: v.patient?.name ?? null, service: v.appointmentType.name, checkedIn: v.status === 'CHECKED_IN', token: v.tokenNumber })),
        pets: s.kioskWalkIns ? w.pets.map((p) => ({ id: p.id, name: p.name })) : [],
      };
    });
  }

  async checkIn(key: string, mobilePhone: string, appointmentId: string) {
    const { s, branch } = await this.device('kiosk', key);
    return this.run(s, async () => {
      const w = await this.whoIs(branch.id, branch.timezone, mobilePhone);
      if (!w.visits.some((v) => v.id === appointmentId)) throw notFound('Appointment');
      const a = await this.appointments.checkInSelf(appointmentId);
      return { token: a.tokenNumber, petName: a.patient?.name ?? null, startsAt: a.startsAt };
    });
  }

  async walkIn(key: string, input: { mobilePhone: string; patientId: string; appointmentTypeId: string }) {
    const { s, branch } = await this.device('kiosk', key);
    if (!s.kioskWalkIns) throw ruleViolation('WALK_INS_OFF', 'Please see the front desk to check in.');
    return this.run(s, async () => {
      const w = await this.whoIs(branch.id, branch.timezone, input.mobilePhone);
      const pet = w.pets.find((p) => p.id === input.patientId);
      if (!pet) throw notFound('Patient');
      if (!(await this.walkInTypes()).some((t) => t.id === input.appointmentTypeId)) throw notFound('Service');
      // Already checked in today for this animal: give the same token rather than a second place in the queue.
      const existing = w.visits.find((v) => v.patient?.name === pet.name && v.status === 'CHECKED_IN');
      if (existing) return { token: existing.tokenNumber, petName: pet.name, startsAt: existing.startsAt };
      const a = await this.appointments.walkIn({ branchId: branch.id, clientId: pet.ownerships[0].clientId, patientId: pet.id, appointmentTypeId: input.appointmentTypeId, reason: 'Checked in at the tablet (no appointment)' });
      return { token: a.tokenNumber, petName: pet.name, startsAt: a.startsAt };
    });
  }
}
