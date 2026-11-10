import { OPTIONAL_MODULES } from '@vcms/shared';
import { closeApp, futureDate, getApp, prisma, registerOrg, schedulingFixture, staff, TestClient, unique } from './helpers';

const settings = (typeId: string, extra: Record<string, unknown> = {}) => ({
  enabled: true,
  slug: unique('clinic').toLowerCase().replace(/[^a-z0-9-]/g, '-'),
  daysAhead: 30,
  minNoticeHours: 2,
  cancelNoticeHours: 4,
  branchIds: [],
  clinicianIds: [],
  allowNewClients: true,
  autoConfirm: false,
  welcomeMessage: 'Book in under a minute.',
  appointmentTypeIds: [typeId],
  ...extra,
});

describe('Online booking page', () => {
  afterAll(closeApp);

  it('lets a new client book a free time, recognises returning clients, protects the slot, and lets them change or cancel', async () => {
    const org = await registerOrg();
    const f = await schedulingFixture(org);
    const s = settings(f.typeId);
    const saved = await org.owner.call('put', '/online-booking', s);
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ enabled: true, slug: s.slug, appointmentTypes: expect.arrayContaining([expect.objectContaining({ id: f.typeId, allowOnlineBooking: true })]) });

    const anon = new TestClient(await getApp());
    const info = await anon.get(`/public/booking/${s.slug}`);
    expect(info.status).toBe(200);
    expect(info.body).toMatchObject({ settings: { welcomeMessage: 'Book in under a minute.' }, appointmentTypes: [expect.objectContaining({ id: f.typeId })], clinicians: [expect.objectContaining({ id: f.vet.membershipId })] });
    // No prices on the public page.
    expect(info.body.appointmentTypes[0]).not.toHaveProperty('priceMinor');
    const branchId = info.body.branches[0].id;
    const speciesId = info.body.species[0].id;
    const day = futureDate(5);
    const days = await anon.get(`/public/booking/${s.slug}/days?branchId=${branchId}&appointmentTypeId=${f.typeId}&from=${day}&count=3`);
    expect(days.body.days[0]).toMatchObject({ date: day, free: expect.any(Number) });
    const slots = (await anon.get(`/public/booking/${s.slug}/slots?branchId=${branchId}&appointmentTypeId=${f.typeId}&date=${day}`)).body;
    expect(slots.length).toBeGreaterThan(3);

    // A new client: registered with their pet; the appointment waits for the front desk to confirm.
    const mobile = `0300 ${String(Math.floor(Math.random() * 9e6) + 1e6)}`;
    const booked = await anon.post(`/public/booking/${s.slug}`, { branchId, appointmentTypeId: f.typeId, startsAt: slots[0].startsAt, ownerName: 'Sana Malik', mobilePhone: mobile, email: '', petName: 'Moti', speciesId, reason: 'Vaccination' });
    expect(booked.status).toBe(201);
    expect(booked.body).toMatchObject({ petName: 'Moti', ownerName: 'Sana Malik', status: 'BOOKED', manageToken: expect.any(String), manageLink: expect.stringContaining('/book/manage/') });
    const appt = await prisma().appointment.findUniqueOrThrow({ where: { id: booked.body.id } });
    expect(appt).toMatchObject({ source: 'ONLINE', clinicianId: f.vet.membershipId, manageTokenHash: expect.any(String) });
    expect(appt.manageTokenHash).not.toBe(booked.body.manageToken);

    // The same time cannot be taken twice; robots filling the hidden field are refused.
    expect((await anon.post(`/public/booking/${s.slug}`, { branchId, appointmentTypeId: f.typeId, startsAt: slots[0].startsAt, ownerName: 'Other Person', mobilePhone: '0311 2223334', petName: 'Rex', speciesId })).status).toBe(409);
    expect((await anon.post(`/public/booking/${s.slug}`, { branchId, appointmentTypeId: f.typeId, startsAt: slots[1].startsAt, ownerName: 'Bot', mobilePhone: '0311 2223335', petName: 'Bot', speciesId, website: 'spam.example' })).status).toBe(400);

    // The same client again (number typed differently, same pet name): no duplicate client or pet.
    const again = await anon.post(`/public/booking/${s.slug}`, { branchId, appointmentTypeId: f.typeId, startsAt: slots[2].startsAt, ownerName: 'Sana', mobilePhone: `+92 ${mobile.slice(1)}`, petName: 'moti', speciesId });
    expect(again.status).toBe(201);
    const a2 = await prisma().appointment.findUniqueOrThrow({ where: { id: again.body.id } });
    expect([a2.clientId, a2.patientId]).toEqual([appt.clientId, appt.patientId]);

    // The private link: see it, move it, cancel it.
    const token = booked.body.manageToken;
    expect((await anon.get(`/public/booking/manage/${token}`)).body).toMatchObject({ changeable: true, booking: { petName: 'Moti' } });
    const later = slots[slots.length - 1].startsAt; // well clear of the other bookings
    const moved = await anon.post(`/public/booking/manage/${token}/reschedule`, { startsAt: later });
    expect(moved.status).toBe(200);
    expect(new Date(moved.body.booking.startsAt).toISOString()).toBe(later);
    const cancelled = await anon.post(`/public/booking/manage/${token}/cancel`, { reason: 'Feeling better' });
    expect(cancelled.body).toMatchObject({ booking: { status: 'CANCELLED' }, changeable: false });
    expect((await anon.get('/public/booking/manage/not-a-real-token-at-all-123')).status).toBe(404);

    // The bell in the top bar: staff see each online booking, move and cancellation, newest first, each with their own unread count.
    const reception = await staff(org, 'receptionist');
    const bell = await reception.client.get(`/notifications?branchId=${branchId}`);
    expect(bell.status).toBe(200);
    expect(bell.body.items.map((n: { kind: string }) => n.kind)).toEqual(['ONLINE_CANCELLED', 'ONLINE_RESCHEDULED', 'ONLINE_BOOKED', 'ONLINE_BOOKED']);
    expect(bell.body.unread).toBe(4);
    expect(bell.body.items[0]).toMatchObject({ read: false, detail: 'Feeling better', appointment: { id: booked.body.id, status: 'CANCELLED', patient: { name: 'Moti' }, client: { displayName: expect.stringContaining('Sana') } } });
    expect(new Date(bell.body.items[1].previousStartsAt).toISOString()).toBe(slots[0].startsAt);
    // Reading one, then the rest; the owner's count is untouched.
    expect((await reception.client.post('/notifications/read', { ids: [bell.body.items[0].id] })).body).toEqual({ marked: 1 });
    expect((await reception.client.get(`/notifications?branchId=${branchId}&unread=true`)).body).toMatchObject({ unread: 3, items: expect.arrayContaining([expect.objectContaining({ kind: 'ONLINE_BOOKED' })]) });
    expect((await reception.client.post('/notifications/read', { branchId })).body).toEqual({ marked: 3 });
    expect((await reception.client.get('/notifications')).body.unread).toBe(0);
    expect((await org.owner.get('/notifications')).body.unread).toBe(4);
    // Another clinic sees none of them.
    const elsewhere = await registerOrg();
    expect((await elsewhere.owner.get('/notifications')).body).toEqual({ unread: 0, items: [] });

    // Settings: staff-only, unique address; switched off = not found.
    expect((await reception.client.call('put', '/online-booking', s)).status).toBe(403);
    const other = await registerOrg();
    const g = await schedulingFixture(other);
    expect((await other.owner.call('put', '/online-booking', settings(g.typeId, { slug: s.slug }))).status).toBe(409);
    await org.owner.call('put', '/online-booking', { ...s, enabled: false });
    expect((await anon.get(`/public/booking/${s.slug}`)).status).toBe(404);
  });

  it('auto-confirms when chosen, respects the notice period, and can be limited to registered clients', async () => {
    const org = await registerOrg();
    const f = await schedulingFixture(org);
    const s = settings(f.typeId, { autoConfirm: true, allowNewClients: false, minNoticeHours: 72 });
    await org.owner.call('put', '/online-booking', s);
    const anon = new TestClient(await getApp());
    const info = (await anon.get(`/public/booking/${s.slug}`)).body;
    const q = (date: string) => `/public/booking/${s.slug}/slots?branchId=${info.branches[0].id}&appointmentTypeId=${f.typeId}&date=${date}`;
    expect((await anon.get(q(futureDate(1)))).body).toEqual([]); // inside the 72-hour notice
    const slots = (await anon.get(q(futureDate(6)))).body;
    const body = { branchId: info.branches[0].id, appointmentTypeId: f.typeId, startsAt: slots[0].startsAt, ownerName: 'New Person', mobilePhone: '0345 9998887', petName: 'Kitty', speciesId: info.species[0].id };
    const refused = await anon.post(`/public/booking/${s.slug}`, body);
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe('NEW_CLIENTS_BY_PHONE');
    const known = await anon.post(`/public/booking/${s.slug}`, { ...body, mobilePhone: f.client.mobilePhone, petName: f.patient.name });
    expect(known.status).toBe(201);
    expect(known.body.status).toBe('CONFIRMED');
  });

  it('books several services in one visit, long enough for them all, and the consultation knows them', async () => {
    const org = await registerOrg();
    const f = await schedulingFixture(org); // a 20-minute consultation
    const nails = await org.owner.post('/appointment-types', { name: unique('Nail trim'), durationMinutes: 15, category: 'GROOMING' });
    expect(nails.status).toBe(201);
    const s = settings(f.typeId, { appointmentTypeIds: [f.typeId, nails.body.id] });
    expect((await org.owner.call('put', '/online-booking', s)).status).toBe(200);
    const anon = new TestClient(await getApp());
    const info = (await anon.get(`/public/booking/${s.slug}`)).body;
    expect(info.appointmentTypes.map((t: { categoryName: string }) => t.categoryName).sort()).toEqual(['Consultation', 'Grooming']);
    const branchId = info.branches[0].id;
    const day = futureDate(5);
    const slots = (await anon.get(`/public/booking/${s.slug}/slots?branchId=${branchId}&appointmentTypeId=${f.typeId}&extraTypeIds=${nails.body.id}&date=${day}`)).body;
    expect(slots.length).toBeGreaterThan(0);
    const booked = await anon.post(`/public/booking/${s.slug}`, { branchId, appointmentTypeId: f.typeId, extraTypeIds: [nails.body.id], startsAt: slots[0].startsAt, ownerName: 'Ayesha Khan', mobilePhone: '0333 7776661', petName: 'Coco', speciesId: info.species[0].id });
    expect(booked.status).toBe(201);
    expect(booked.body.service).toBe(`${(await prisma().appointmentType.findUniqueOrThrow({ where: { id: f.typeId } })).name} + ${nails.body.name}`);
    const appt = await prisma().appointment.findUniqueOrThrow({ where: { id: booked.body.id } });
    expect(appt.extraTypeIds).toEqual([nails.body.id]);
    expect((appt.endsAt.getTime() - appt.startsAt.getTime()) / 60_000).toBe(35);
    // A service not offered online cannot be added.
    const hidden = await org.owner.post('/appointment-types', { name: unique('Surgery'), durationMinutes: 60, category: 'SURGERY' });
    expect((await anon.get(`/public/booking/${s.slug}/slots?branchId=${branchId}&appointmentTypeId=${f.typeId}&extraTypeIds=${hidden.body.id}&date=${day}`)).status).toBe(404);
    // The consultation opened from it sees every service booked.
    const e = await org.owner.post('/encounters', { patientId: appt.patientId, appointmentId: appt.id, chiefComplaint: 'Check' });
    expect(e.status).toBe(201);
    expect(e.body.appointment.extraTypeIds).toEqual([nails.body.id]);
  });

  it('offers vaccination and deworming even with no appointment type for them yet', async () => {
    const org = await registerOrg();
    const f = await schedulingFixture(org);
    const view = (await org.owner.get('/online-booking')).body;
    const cats = view.categories as { id: string; name: string }[];
    // Both are always listed (the starter categories, or `new:` ones).
    expect(cats.map((c) => c.name)).toEqual(expect.arrayContaining(['Vaccination', 'Deworming']));
    const deworm = cats.find((c) => c.name === 'Deworming')!;
    const s = settings(f.typeId, { offerCategoryIds: [deworm.id] });
    const saved = await org.owner.call('put', '/online-booking', s);
    expect(saved.status).toBe(200);
    const offered = (saved.body.appointmentTypes as { name: string; categoryName: string; allowOnlineBooking: boolean }[]).filter((t) => t.categoryName === 'Deworming' && t.allowOnlineBooking);
    expect(offered).toHaveLength(1);
    // Saving again with the category offered does not add a second type.
    await org.owner.call('put', '/online-booking', s);
    expect(await prisma().appointmentType.count({ where: { organizationId: org.orgId, categoryId: deworm.id, isActive: true, allowOnlineBooking: true } })).toBe(1);
    const anon = new TestClient(await getApp());
    const info = (await anon.get(`/public/booking/${s.slug}`)).body;
    expect(info.appointmentTypes.map((t: { categoryName: string }) => t.categoryName)).toEqual(expect.arrayContaining(['Consultation', 'Deworming']));
    // Someone else's or an unknown category is refused.
    expect((await org.owner.call('put', '/online-booking', settings(f.typeId, { slug: s.slug, offerCategoryIds: ['00000000-0000-4000-8000-000000000000'] }))).status).toBe(422);
  });

  it('asks clinic or home visit first when home visits are offered, keeps travel time free, and can be switched off', async () => {
    const org = await registerOrg();
    const f = await schedulingFixture(org);
    await org.owner.call('put', '/home-visits/settings', { calloutServiceId: null, perKmServiceId: null, travelMinutes: 30 });
    const s = settings(f.typeId);
    await org.owner.call('put', '/online-booking', s);
    const anon = new TestClient(await getApp());
    let info = (await anon.get(`/public/booking/${s.slug}`)).body;
    expect(info.settings.allowHomeVisits).toBe(false);
    const branchId = info.branches[0].id;
    const day = futureDate(5);
    const q = (extra = '') => `/public/booking/${s.slug}/slots?branchId=${branchId}&appointmentTypeId=${f.typeId}&date=${day}${extra}`;
    // Off: home visits cannot be asked for.
    expect((await anon.get(q('&location=HOME'))).status).toBe(422);

    expect((await org.owner.call('put', '/online-booking', { ...s, allowHomeVisits: true })).body).toMatchObject({ allowHomeVisits: true, homeVisits: { available: true, travelMinutes: 30 } });
    info = (await anon.get(`/public/booking/${s.slug}`)).body;
    expect(info.settings.allowHomeVisits).toBe(true);
    // The vet needs the travel time free before a home visit, so the first home slot is later than the first clinic slot.
    const clinic = (await anon.get(q())).body as { startsAt: string }[];
    const homeSlots = (await anon.get(q('&location=HOME'))).body as { startsAt: string }[];
    expect(new Date(homeSlots[0].startsAt).getTime() - new Date(clinic[0].startsAt).getTime()).toBeGreaterThanOrEqual(30 * 60_000);
    const body = { branchId, appointmentTypeId: f.typeId, startsAt: homeSlots[0].startsAt, ownerName: 'Hina Ali', mobilePhone: '0321 4445556', petName: 'Snowy', speciesId: info.species[0].id, location: 'HOME' };
    const noAddress = await anon.post(`/public/booking/${s.slug}`, body);
    expect(noAddress.status).toBe(400);
    const booked = await anon.post(`/public/booking/${s.slug}`, { ...body, visitAddress: 'House 7, Street 2, Gulberg III, Lahore', visitDirections: 'Blue gate' });
    expect(booked.status).toBe(201);
    expect(booked.body).toMatchObject({ location: 'HOME', visitAddress: 'House 7, Street 2, Gulberg III, Lahore' });
    const appt = await prisma().appointment.findUniqueOrThrow({ where: { id: booked.body.id } });
    expect(appt).toMatchObject({ location: 'HOME', visitDirections: 'Blue gate' });
    expect((appt.startsAt.getTime() - appt.travelStartsAt!.getTime()) / 60_000).toBe(30);

    // Home visits switched off for the clinic: not offered online, and cannot be switched on there.
    await org.owner.call('put', '/setup/modules', { enabled: OPTIONAL_MODULES.filter((m) => m !== 'homeVisits') });
    expect((await anon.get(`/public/booking/${s.slug}`)).body.settings.allowHomeVisits).toBe(false);
    expect((await org.owner.call('put', '/online-booking', { ...s, allowHomeVisits: true })).status).toBe(422);
    expect((await org.owner.get('/online-booking')).body.homeVisits.available).toBe(false);
  });

  it('asks name and mobile first: shows the pets only when both match, and books for the pet chosen', async () => {
    const org = await registerOrg();
    const f = await schedulingFixture(org);
    const s = settings(f.typeId);
    await org.owner.call('put', '/online-booking', s);
    const anon = new TestClient(await getApp());
    const info = (await anon.get(`/public/booking/${s.slug}`)).body;
    const owner = f.client.displayName as string;
    const look = (ownerName: string, mobilePhone: string) => anon.post(`/public/booking/${s.slug}/lookup`, { ownerName, mobilePhone });

    // Name and mobile both match: their pets, to choose from.
    const known = await look(owner.split(' ')[0].toLowerCase(), f.client.mobilePhone);
    expect(known.status).toBe(200);
    expect(known.body).toMatchObject({ known: true, pets: [expect.objectContaining({ id: f.patient.id, name: f.patient.name })] });
    // The right number with another name, or an unknown number: nothing is given away.
    expect((await look('Somebody Else', f.client.mobilePhone)).body).toEqual({ known: false, firstName: null, pets: [], allowNewClients: true });
    expect((await look(owner, '0399 1112223')).body).toMatchObject({ known: false, pets: [] });

    // Booked for the pet chosen (no pet name or species needed).
    const day = futureDate(5);
    const slots = (await anon.get(`/public/booking/${s.slug}/slots?branchId=${info.branches[0].id}&appointmentTypeId=${f.typeId}&date=${day}`)).body;
    const base = { branchId: info.branches[0].id, appointmentTypeId: f.typeId, ownerName: owner, mobilePhone: f.client.mobilePhone };
    const booked = await anon.post(`/public/booking/${s.slug}`, { ...base, startsAt: slots[0].startsAt, patientId: f.patient.id });
    expect(booked.status).toBe(201);
    expect(booked.body.petName).toBe(f.patient.name);
    // Someone else's pet cannot be booked with this number.
    const other = await org.owner.post('/patients', { ownerId: (await org.owner.post('/clients', { type: 'INDIVIDUAL', firstName: 'Other', lastName: 'Owner', mobilePhone: '0311 5556667', preferredChannel: 'SMS' })).body.id, name: 'Notmine', speciesId: info.species[0].id, sex: 'UNKNOWN', identifiers: [] });
    expect(other.status).toBe(201);
    expect((await anon.post(`/public/booking/${s.slug}`, { ...base, startsAt: slots[slots.length - 1].startsAt, patientId: other.body.id })).body.error.code).toBe('INVALID_PET');
    // Neither a pet chosen nor a new pet named: refused.
    expect((await anon.post(`/public/booking/${s.slug}`, { ...base, startsAt: slots[slots.length - 1].startsAt })).status).toBe(400);
  });

  it('lists every branch, with only vets who have working hours there', async () => {
    const org = await registerOrg();
    const f = await schedulingFixture(org); // the vet works at the main branch only
    const second = await org.owner.post('/branches', { name: 'Second branch', code: 'B2', timezone: 'Asia/Karachi' });
    expect(second.status).toBe(201);
    const s = settings(f.typeId);
    await org.owner.call('put', '/online-booking', s);
    const anon = new TestClient(await getApp());
    const info = (await anon.get(`/public/booking/${s.slug}`)).body;
    // A branch with no vet on the roster is still listed (shown as "call to book"), with no vets.
    expect(info.branches).toEqual(expect.arrayContaining([expect.objectContaining({ id: org.branchId, vetCount: 1 }), expect.objectContaining({ id: second.body.id, vetCount: 0 })]));
    expect(info.clinicians).toEqual([expect.objectContaining({ id: f.vet.membershipId, branchIds: [org.branchId] })]);
    const view = (await org.owner.get('/online-booking')).body;
    expect(view.branches).toEqual(expect.arrayContaining([expect.objectContaining({ id: second.body.id, rosteredVets: 0 })]));
  });
});
