import { Injectable } from '@nestjs/common';
import { Prisma, type OnlineBookingSettings } from '@prisma/client';
import type { OnlineBookingSettingsInput, PublicBookingInput } from '@vcms/shared';
import { AuditService } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { randomToken, sha256 } from '../../common/crypto/crypto';
import { ClientEvents } from '../../common/events/client-events';
import { conflict, notFound, ruleViolation } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { localParts } from '../../common/time/tz';
import { AttachmentsService } from '../attachments/attachments.service';
import { ClientsService, phoneKey } from '../clients/clients.service';
import { brandingOf, OrganizationsService } from '../organizations/organizations.service';
import { PatientsService } from '../patients/patients.service';
import { AppointmentsService } from '../scheduling/appointments.service';

const DAY = 86_400_000;
/** Most bookings one mobile number can make online in a day (stops mistakes and abuse). */
const MAX_PER_PHONE_PER_DAY = 3;

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/, '') || 'clinic';

const fullAddress = (b: { addressLine1: string | null; addressLine2: string | null; city: string | null }) => [b.addressLine1, b.addressLine2, b.city].filter(Boolean).join(', ') || null;

/**
 * Online booking: a public page per clinic (/book/<slug>) where clients choose a service, a vet, a free time
 * from the real calendar, and enter their details. Existing clients are recognised by mobile number; new ones
 * are registered with their pet. Each booking gets a private link to change or cancel it.
 */
@Injectable()
export class OnlineBookingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly appointments: AppointmentsService,
    private readonly clients: ClientsService,
    private readonly patients: PatientsService,
    private readonly events: ClientEvents,
    private readonly orgs: OrganizationsService,
    private readonly attachments: AttachmentsService,
  ) {}

  // ── Settings (staff) ──

  async settings() {
    const db = this.prisma.db;
    const org = await this.prisma.raw.organization.findUniqueOrThrow({ where: { id: RequestContext.orgId() } });
    const [s, types, branches, clinicians, last30] = await Promise.all([
      db.onlineBookingSettings.findFirst(),
      db.appointmentType.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, durationMinutes: true, priceMinor: true, allowOnlineBooking: true, category: true } }),
      db.branch.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      db.membership.findMany({ where: { status: 'ACTIVE', isClinician: true }, orderBy: { user: { name: 'asc' } }, select: { id: true, jobTitle: true, user: { select: { name: true } } } }),
      db.appointment.count({ where: { source: 'ONLINE', createdAt: { gte: new Date(Date.now() - 30 * DAY) } } }),
    ]);
    return {
      enabled: s?.enabled ?? false,
      slug: s?.slug ?? (await this.freeSlug(slugify(org.brandName ?? org.name))),
      saved: !!s,
      daysAhead: s?.daysAhead ?? 30,
      minNoticeHours: s?.minNoticeHours ?? 2,
      cancelNoticeHours: s?.cancelNoticeHours ?? 4,
      branchIds: s?.branchIds ?? [],
      clinicianIds: s?.clinicianIds ?? [],
      allowNewClients: s?.allowNewClients ?? true,
      autoConfirm: s?.autoConfirm ?? false,
      welcomeMessage: s?.welcomeMessage ?? '',
      updatedByName: s?.updatedByName ?? null,
      appointmentTypes: types,
      branches,
      clinicians: clinicians.map((c) => ({ id: c.id, name: c.user.name, jobTitle: c.jobTitle })),
      last30Days: last30,
    };
  }

  /** A slug no other clinic uses: city-vet, city-vet-2, … */
  private async freeSlug(base: string) {
    const taken = await this.prisma.raw.onlineBookingSettings.findMany({ where: { slug: { startsWith: base } }, select: { slug: true, organizationId: true } });
    const mine = taken.find((t) => t.organizationId === RequestContext.orgId());
    if (mine) return mine.slug;
    const used = new Set(taken.map((t) => t.slug));
    if (!used.has(base) && base.length >= 3) return base;
    for (let i = 2; i < 1000; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`;
    return `${base}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, '')}`;
  }

  async save(input: OnlineBookingSettingsInput) {
    const ctx = RequestContext.require();
    const db = this.prisma.db;
    const other = await this.prisma.raw.onlineBookingSettings.findUnique({ where: { slug: input.slug } });
    if (other && other.organizationId !== ctx.organizationId) throw conflict('Another clinic already uses this address. Choose a different one.');
    // Only this clinic's own branches, vets and services can be chosen.
    const [branches, vets, types] = await Promise.all([
      db.branch.count({ where: { id: { in: input.branchIds } } }),
      db.membership.count({ where: { id: { in: input.clinicianIds }, isClinician: true } }),
      db.appointmentType.count({ where: { id: { in: input.appointmentTypeIds } } }),
    ]);
    if (branches !== input.branchIds.length || vets !== input.clinicianIds.length || types !== input.appointmentTypeIds.length) throw ruleViolation('INVALID_CHOICE', 'One of the chosen branches, vets or services was not found.');
    if (input.enabled && !input.appointmentTypeIds.length) throw ruleViolation('NO_SERVICES', 'Choose at least one service clients can book online.');
    const data = {
      enabled: input.enabled,
      slug: input.slug,
      daysAhead: input.daysAhead,
      minNoticeHours: input.minNoticeHours,
      cancelNoticeHours: input.cancelNoticeHours,
      branchIds: input.branchIds,
      clinicianIds: input.clinicianIds,
      allowNewClients: input.allowNewClients,
      autoConfirm: input.autoConfirm,
      welcomeMessage: input.welcomeMessage || null,
      updatedByName: ctx.userName ?? null,
    };
    await db.$transaction(async (tx) => {
      await tx.onlineBookingSettings.upsert({ where: { organizationId: ctx.organizationId! }, update: data, create: { ...data, organizationId: ctx.organizationId! } });
      await tx.appointmentType.updateMany({ where: { id: { in: input.appointmentTypeIds } }, data: { allowOnlineBooking: true } });
      await tx.appointmentType.updateMany({ where: { id: { notIn: input.appointmentTypeIds } }, data: { allowOnlineBooking: false } });
      await this.audit.record({ action: 'online_booking.updated', entityType: 'Organization', entityId: ctx.organizationId!, summary: `${input.enabled ? 'On' : 'Off'} · /book/${input.slug} · ${input.appointmentTypeIds.length} service(s)` }, tx);
    });
    return this.settings();
  }

  // ── Public page ──

  /** The clinic behind a booking address, or "not found" when it is switched off. */
  private async page(slug: string) {
    const s = /^[a-z0-9-]{3,50}$/.test(slug) ? await this.prisma.raw.onlineBookingSettings.findUnique({ where: { slug } }) : null;
    if (!s?.enabled) throw notFound('Online booking page');
    const org = await this.prisma.raw.organization.findUnique({ where: { id: s.organizationId } });
    if (!org || org.status !== 'ACTIVE') throw notFound('Online booking page');
    return { s, org };
  }

  private inClinic<T>(s: OnlineBookingSettings, fn: () => Promise<T>) {
    return RequestContext.runAs({ organizationId: s.organizationId, userName: 'Online booking' }, fn);
  }

  /** What the page shows: the clinic, its branches, services, vets and kinds of animal. */
  async info(slug: string) {
    const { s, org } = await this.page(slug);
    return this.inClinic(s, async () => {
      const db = this.prisma.db;
      const [branches, types, clinicians, species] = await Promise.all([
        db.branch.findMany({ where: { isActive: true, ...(s.branchIds.length ? { id: { in: s.branchIds } } : {}) }, orderBy: { name: 'asc' } }),
        db.appointmentType.findMany({ where: { isActive: true, allowOnlineBooking: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, durationMinutes: true, priceMinor: true, category: true, color: true } }),
        db.membership.findMany({ where: { status: 'ACTIVE', isClinician: true, ...(s.clinicianIds.length ? { id: { in: s.clinicianIds } } : {}) }, orderBy: { user: { name: 'asc' } }, select: { id: true, jobTitle: true, user: { select: { name: true } }, branches: { select: { branchId: true } } } }),
        db.species.findMany({ where: { isActive: true }, orderBy: [{ category: 'asc' }, { name: 'asc' }], select: { id: true, name: true, category: true } }),
      ]);
      const branding = brandingOf(org, `/api/v1/public/booking/${slug}`);
      return {
        clinic: { name: branding.brandName, phone: org.phone, country: org.country, currency: org.currency, branding },
        settings: { daysAhead: s.daysAhead, minNoticeHours: s.minNoticeHours, cancelNoticeHours: s.cancelNoticeHours, allowNewClients: s.allowNewClients, autoConfirm: s.autoConfirm, welcomeMessage: s.welcomeMessage },
        branches: branches.map((b) => ({ id: b.id, name: b.name, address: fullAddress(b), phone: b.phone, timezone: b.timezone })),
        appointmentTypes: types,
        clinicians: clinicians.map((c) => ({ id: c.id, name: c.user.name, jobTitle: c.jobTitle, branchIds: c.branches.map((b) => b.branchId) })),
        species,
      };
    });
  }

  /** The clinic's logo for the booking page. */
  async logo(slug: string) {
    const { s, org } = await this.page(slug);
    const id = this.orgs.brandImageId(org, 'logo');
    if (!id) throw notFound('Logo');
    return this.inClinic(s, () => this.attachments.openBrandImage(id));
  }

  private window(s: OnlineBookingSettings) {
    return { earliest: Date.now() + s.minNoticeHours * 3600_000, latest: Date.now() + s.daysAhead * DAY };
  }

  /** Free times on one day: each start time and the vets free then (only bookable services, vets and window). */
  private async freeTimes(s: OnlineBookingSettings, q: { branchId: string; appointmentTypeId: string; clinicianId?: string; date: string }) {
    const db = this.prisma.db;
    if (s.branchIds.length && !s.branchIds.includes(q.branchId)) throw notFound('Branch');
    const type = await db.appointmentType.findFirst({ where: { id: q.appointmentTypeId, isActive: true, allowOnlineBooking: true } });
    if (!type) throw notFound('Service');
    if (q.clinicianId && s.clinicianIds.length && !s.clinicianIds.includes(q.clinicianId)) throw notFound('Vet');
    const { earliest, latest } = this.window(s);
    const perVet = await this.appointments.availability({ branchId: q.branchId, date: q.date, appointmentTypeId: q.appointmentTypeId, clinicianId: q.clinicianId || undefined });
    const times = new Map<string, string[]>();
    for (const v of perVet) {
      if (s.clinicianIds.length && !s.clinicianIds.includes(v.clinicianId)) continue;
      for (const t of v.slots) {
        const at = new Date(t).getTime();
        if (at < earliest || at > latest) continue;
        times.set(t, [...(times.get(t) ?? []), v.clinicianId]);
      }
    }
    return [...times.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([startsAt, clinicianIds]) => ({ startsAt, clinicianIds }));
  }

  async slots(slug: string, q: { branchId: string; appointmentTypeId: string; clinicianId?: string; date: string }) {
    const { s } = await this.page(slug);
    return this.inClinic(s, () => this.freeTimes(s, q));
  }

  /** How many free times each day has, for the date strip (up to 14 days per call, within the booking window). */
  async days(slug: string, q: { branchId: string; appointmentTypeId: string; clinicianId?: string; from: string; count: number }) {
    const { s } = await this.page(slug);
    return this.inClinic(s, async () => {
      const branch = await this.prisma.db.branch.findUnique({ where: { id: q.branchId } });
      if (!branch) throw notFound('Branch');
      const today = localParts(new Date(), branch.timezone).date;
      const last = localParts(new Date(Date.now() + s.daysAhead * DAY), branch.timezone).date;
      const out: { date: string; free: number }[] = [];
      let d = q.from < today ? today : q.from;
      for (let i = 0; i < Math.min(q.count, 14) && d <= last; i++) {
        out.push({ date: d, free: (await this.freeTimes(s, { ...q, date: d })).length });
        d = new Date(new Date(`${d}T00:00:00Z`).getTime() + DAY).toISOString().slice(0, 10);
      }
      return { days: out, lastDate: last };
    });
  }

  /** Books a visit: recognises or registers the client and pet, takes a free vet, and returns a private change link. */
  async book(slug: string, input: PublicBookingInput, origin: string) {
    const { s, org } = await this.page(slug);
    return this.inClinic(s, async () => {
      const db = this.prisma.db;
      const startsAt = new Date(input.startsAt);
      const date = localParts(startsAt, (await db.branch.findUniqueOrThrow({ where: { id: input.branchId } })).timezone).date;
      const free = (await this.freeTimes(s, { branchId: input.branchId, appointmentTypeId: input.appointmentTypeId, clinicianId: input.clinicianId || undefined, date })).find((t) => t.startsAt === startsAt.toISOString());
      if (!free) throw conflict('Sorry — this time has just been taken. Please choose another time.', { code: 'SLOT_TAKEN' });
      const clinicianId = input.clinicianId || free.clinicianIds[0];

      // Who is booking: an existing client with this mobile number, or a new one.
      const key = phoneKey(input.mobilePhone);
      if (!key) throw ruleViolation('INVALID_PHONE', 'Enter your full mobile number, e.g. 0300 1234567');
      const since = new Date(Date.now() - DAY);
      let client = await db.client.findFirst({ where: { phoneDigits: key, status: 'ACTIVE' }, orderBy: { createdAt: 'asc' } });
      if (client && (await db.appointment.count({ where: { clientId: client.id, source: 'ONLINE', createdAt: { gte: since } } })) >= MAX_PER_PHONE_PER_DAY) {
        throw ruleViolation('TOO_MANY', 'You have already made several bookings today. Please call the clinic to book more.');
      }
      if (!client) {
        if (!s.allowNewClients) throw ruleViolation('NEW_CLIENTS_BY_PHONE', `We could not find this mobile number. Please call ${org.phone ?? 'the clinic'} to book your first visit.`);
        const [firstName, ...rest] = input.ownerName.split(/\s+/);
        client = (await this.clients.create({
          type: 'INDIVIDUAL',
          firstName,
          lastName: rest.join(' ') || undefined,
          mobilePhone: input.mobilePhone,
          email: input.email || null,
          preferredChannel: org.country === 'PK' ? 'WHATSAPP' : 'SMS',
          marketingConsent: false,
          remindersConsent: true,
          primaryBranchId: input.branchId,
          notes: 'Registered through online booking.',
        } as never)) as unknown as NonNullable<typeof client>;
      } else if (input.email && !client.email) {
        await db.client.update({ where: { id: client.id }, data: { email: input.email } });
      }

      // Their pet: the one with this name, or a new one.
      const owned = await db.patient.findMany({ where: { status: 'ACTIVE', ownerships: { some: { clientId: client.id, endedAt: null } } }, select: { id: true, name: true } });
      let patientId = owned.find((p) => p.name.trim().toLowerCase() === input.petName.trim().toLowerCase())?.id;
      if (!patientId) {
        const species = await db.species.findFirst({ where: { id: input.speciesId, isActive: true } });
        if (!species) throw ruleViolation('INVALID_SPECIES', 'Choose the kind of animal.');
        patientId = ((await this.patients.create({ ownerId: client.id, name: input.petName.trim(), speciesId: species.id, sex: 'UNKNOWN', dobEstimated: false, identifiers: [], primaryBranchId: input.branchId, notes: 'Added through online booking.' } as never)) as { id: string }).id;
      }

      const token = randomToken(24);
      let appointmentId: string;
      try {
        const created = (await this.appointments.create({
          branchId: input.branchId,
          clientId: client.id,
          patientId,
          appointmentTypeId: input.appointmentTypeId,
          clinicianId,
          startsAt,
          source: 'ONLINE',
          reason: input.reason || 'Booked online',
          notes: null,
          allowOverbook: false,
          allowOutsideHours: false,
          resourceIds: undefined,
        } as never)) as { id: string };
        appointmentId = created.id;
      } catch (e) {
        if ((e as { status?: number }).status === 409 || (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) {
          throw conflict('Sorry — this time has just been taken. Please choose another time.', { code: 'SLOT_TAKEN' });
        }
        throw e;
      }
      await db.$transaction(async (tx) => {
        await tx.appointment.update({ where: { id: appointmentId }, data: { manageTokenHash: sha256(token), ...(s.autoConfirm ? { status: 'CONFIRMED', confirmedAt: new Date() } : {}) } });
        await this.audit.record({ action: 'appointment.booked_online', entityType: 'Appointment', entityId: appointmentId, summary: `${input.ownerName} · ${input.petName}` }, tx);
      });
      const manageLink = `${origin}/book/manage/${token}`;
      await this.events.emit({ type: 'APPOINTMENT_BOOKED', appointmentId, online: { manageLink } });
      return { ...(await this.summary(appointmentId)), manageToken: token, manageLink };
    });
  }

  /** The booking as the client sees it. */
  private async summary(id: string) {
    const a = await this.prisma.db.appointment.findUniqueOrThrow({
      where: { id },
      include: { patient: { select: { name: true } }, client: { select: { displayName: true } }, appointmentType: { select: { name: true, durationMinutes: true } }, clinician: { select: { user: { select: { name: true } } } }, branch: true },
    });
    return {
      id: a.id,
      status: a.status,
      startsAt: a.startsAt,
      endsAt: a.endsAt,
      petName: a.patient?.name ?? null,
      ownerName: a.client.displayName,
      service: a.appointmentType.name,
      appointmentTypeId: a.appointmentTypeId,
      vet: a.clinician?.user.name ?? null,
      clinicianId: a.clinicianId,
      branch: { id: a.branch.id, name: a.branch.name, address: fullAddress(a.branch), phone: a.branch.phone, timezone: a.branch.timezone },
    };
  }

  // ── Change or cancel (private link) ──

  private async byToken(token: string) {
    const a = /^[\w-]{20,64}$/.test(token) ? await this.prisma.raw.appointment.findUnique({ where: { manageTokenHash: sha256(token) }, select: { id: true, organizationId: true, clientId: true } }) : null;
    if (!a) throw notFound('Booking');
    const s = await this.prisma.raw.onlineBookingSettings.findUnique({ where: { organizationId: a.organizationId } });
    if (!s) throw notFound('Booking');
    return { a, s };
  }

  async manage(token: string) {
    const { a, s } = await this.byToken(token);
    return this.inClinic(s, async () => {
      const b = await this.summary(a.id);
      const changeable = ['BOOKED', 'CONFIRMED'].includes(b.status) && b.startsAt.getTime() >= Date.now() + s.cancelNoticeHours * 3600_000;
      const org = await this.prisma.raw.organization.findUniqueOrThrow({ where: { id: s.organizationId } });
      return { booking: b, changeable, cancelNoticeHours: s.cancelNoticeHours, slug: s.enabled ? s.slug : null, clinic: { name: org.brandName ?? org.name, phone: org.phone, branding: brandingOf(org, `/api/v1/public/booking/${s.slug}`) } };
    });
  }

  async cancel(token: string, reason?: string) {
    const { a, s } = await this.byToken(token);
    return this.inClinic(s, async () => {
      await this.appointments.cancelByClient(a.id, a.clientId, reason || 'Cancelled online', s.cancelNoticeHours);
      return this.manage(token);
    });
  }

  async reschedule(token: string, input: { startsAt: Date; clinicianId?: string }) {
    const { a, s } = await this.byToken(token);
    if (!s.enabled) throw ruleViolation('BOOKING_OFF', 'Online changes are not available at the moment. Please call the clinic.');
    return this.inClinic(s, async () => {
      const current = await this.summary(a.id);
      if (!['BOOKED', 'CONFIRMED'].includes(current.status) || current.startsAt.getTime() < Date.now() + s.cancelNoticeHours * 3600_000) {
        throw ruleViolation('TOO_LATE', `Online changes close ${s.cancelNoticeHours} hours before the appointment. Please call the clinic.`);
      }
      const startsAt = new Date(input.startsAt);
      const date = localParts(startsAt, current.branch.timezone).date;
      const free = (await this.freeTimes(s, { branchId: current.branch.id, appointmentTypeId: current.appointmentTypeId, clinicianId: input.clinicianId || undefined, date })).find((t) => t.startsAt === startsAt.toISOString());
      if (!free) throw conflict('Sorry — this time has just been taken. Please choose another time.', { code: 'SLOT_TAKEN' });
      await this.appointments.reschedule(a.id, { startsAt, clinicianId: input.clinicianId || (free.clinicianIds.includes(current.clinicianId ?? '') ? current.clinicianId : free.clinicianIds[0]) } as never);
      return this.manage(token);
    });
  }
}
