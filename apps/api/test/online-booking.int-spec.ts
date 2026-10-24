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

    // Settings: staff-only, unique address; switched off = not found.
    const reception = await staff(org, 'receptionist');
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
});
