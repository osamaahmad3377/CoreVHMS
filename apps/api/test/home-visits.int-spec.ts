import { booking, closeApp, futureDate, karachi, makeClient, makePatient, prisma, registerOrg, schedulingFixture } from './helpers';

/** A home visit at 10:00 (Karachi) with 30 minutes' travel, at the given address. */
const home = (extra: Record<string, unknown> = {}) => ({ location: 'HOME', visitAddress: 'House 12, Street 4, DHA Phase 5, Lahore', travelMinutes: 30, ...extra });

async function fees(org: Awaited<ReturnType<typeof registerOrg>>) {
  const callout = await org.owner.post('/services', { code: 'HVCALL', name: 'Home visit call-out', category: 'OTHER', priceMinor: 150000 });
  const perKm = await org.owner.post('/services', { code: 'HVKM', name: 'Travel per km', category: 'OTHER', priceMinor: 5000 });
  const saved = await org.owner.call('put', '/home-visits/settings', { calloutServiceId: callout.body.id, perKmServiceId: perKm.body.id, travelMinutes: 30 });
  expect(saved.status).toBe(200);
  return saved.body;
}

describe('Home visits', () => {
  afterAll(closeApp);

  it('books a home visit with its address, and blocks the travel time on the vet’s calendar', async () => {
    const org = await registerOrg();
    const f = await schedulingFixture(org);
    const d = futureDate(5);

    const noAddress = await org.owner.post('/appointments', booking(org, f, karachi(d, '10:00'), { location: 'HOME' }));
    expect(noAddress.status).toBe(400);

    const badPin = await org.owner.post('/appointments', booking(org, f, karachi(d, '10:00'), home({ visitMapUrl: 'javascript:alert(1)' })));
    expect(badPin.status).toBe(400);

    const v = await org.owner.post('/appointments', booking(org, f, karachi(d, '10:00'), home({ visitDirections: 'Green gate opposite the mosque', visitMapUrl: 'https://maps.app.goo.gl/abc123' })));
    expect(v.status).toBe(201);
    expect(v.body).toMatchObject({ location: 'HOME', visitAddress: 'House 12, Street 4, DHA Phase 5, Lahore', visitDirections: 'Green gate opposite the mosque', travelMinutes: 30 });
    expect(new Date(v.body.travelStartsAt).toISOString()).toBe(karachi(d, '09:30'));

    // 09:40–10:00 is inside the travel time → clash; 09:00–09:20 is free.
    const clash = await org.owner.post('/appointments', booking(org, f, karachi(d, '09:40')));
    expect(clash.status).toBe(409);
    expect(clash.body.error.message).toContain('including travel time');
    expect((await org.owner.post('/appointments', booking(org, f, karachi(d, '09:00')))).status).toBe(201);

    // Travel before 09:00 would be outside the vet's hours.
    const early = await org.owner.post('/appointments', booking(org, f, karachi(d, '09:15'), home()));
    expect(early.body.error?.code ?? JSON.stringify(early.body)).toBe('OUTSIDE_WORKING_HOURS');

    // Free times for a home visit leave room for travel, before the visit and after other bookings.
    const free = (await org.owner.get(`/appointments/availability?branchId=${org.branchId}&date=${d}&appointmentTypeId=${f.typeId}&clinicianId=${f.vet.membershipId}&travelMinutes=30`)).body[0].slots as string[];
    expect(free).not.toContain(karachi(d, '09:15'));
    expect(free).not.toContain(karachi(d, '10:30'));
    expect(free).toContain(karachi(d, '11:00'));

    // The database also refuses an overlap with the travel time (exclusion constraint).
    await expect(
      prisma().appointment.update({ where: { id: (await org.owner.post('/appointments', booking(org, f, karachi(d, '12:00')))).body.id }, data: { startsAt: new Date(karachi(d, '09:35')), endsAt: new Date(karachi(d, '09:55')) } }),
    ).rejects.toThrow();

    // Home visits are not checked in at the desk.
    const checkIn = await org.owner.post(`/appointments/${v.body.id}/status`, { action: 'check-in' });
    expect(checkIn.body.error.code).toBe('HOME_VISIT');
  });

  it('reschedules a home visit with its travel time, and turns it into a clinic visit', async () => {
    const org = await registerOrg();
    const f = await schedulingFixture(org);
    const d = futureDate(6);
    const v = await org.owner.post('/appointments', booking(org, f, karachi(d, '11:00'), home({ travelMinutes: 45 })));
    const moved = await org.owner.patch(`/appointments/${v.body.id}`, { startsAt: karachi(d, '14:00') });
    expect(moved.status).toBe(200);
    expect(moved.body.travelMinutes).toBe(45);
    expect(new Date(moved.body.travelStartsAt).toISOString()).toBe(karachi(d, '13:15'));

    const clinic = await org.owner.patch(`/appointments/${v.body.id}`, { location: 'CLINIC' });
    expect(clinic.body).toMatchObject({ location: 'CLINIC', visitAddress: null, travelStartsAt: null, travelMinutes: 0 });
    // Back to a home visit needs an address again.
    expect((await org.owner.patch(`/appointments/${v.body.id}`, { location: 'HOME' })).body.error.code).toBe('ADDRESS_REQUIRED');
  });

  it('runs the day on the road: on the way (client told), arrived with the call-out fee and travel, distance corrected', async () => {
    const org = await registerOrg();
    const f = await schedulingFixture(org);
    const settings = await fees(org);
    expect(settings).toMatchObject({ enabled: true, travelMinutes: 30, callout: { name: 'Home visit call-out', priceMinor: 150000 }, perKm: { name: 'Travel per km' } });

    const client = await makeClient(org.owner, { email: 'owner-home@example.com' });
    const patient = await makePatient(org.owner, client.id);
    const rule = await org.owner.call('put', '/client-notifications', { event: 'HOME_VISIT_ON_THE_WAY', whatsapp: false, email: true });
    expect(rule.status).toBe(200);
    const d = futureDate(4);
    // Default travel time from Settings → Home visits.
    const v = await org.owner.post('/appointments', booking(org, f, karachi(d, '15:00'), { location: 'HOME', visitAddress: '7 Canal View, Lahore', clientId: client.id, patientId: patient.id }));
    expect(v.body.travelMinutes).toBe(30);

    const otw = await f.vet.client.post(`/home-visits/${v.body.id}/on-the-way`, { notifyClient: true });
    expect(otw.status).toBe(200);
    expect(otw.body.onTheWayAt).toBeTruthy();
    const msg = await prisma().outboundMessage.findFirstOrThrow({ where: { organizationId: org.orgId, purpose: 'HOME_VISIT_ON_THE_WAY' } });
    expect(msg.channel).toBe('EMAIL');
    expect(msg.body).toContain(patient.name);
    expect(msg.body).toContain('is on the way');

    const there = await f.vet.client.post(`/home-visits/${v.body.id}/arrived`, { distanceKm: 12.5 });
    expect(there.status).toBe(200);
    expect(there.body).toMatchObject({ distanceKm: 12.5 });
    expect((await f.vet.client.post(`/home-visits/${v.body.id}/arrived`, {})).body.error.code).toBe('ALREADY_ARRIVED');

    const day = (await org.owner.get(`/home-visits?date=${d}`)).body;
    expect(day.visits).toHaveLength(1);
    expect(day.visits[0].fees.map((x: any) => [x.kind, x.totalMinor, x.status]).sort()).toEqual([
      ['CALLOUT', 150000, 'PENDING'],
      ['DISTANCE', 62500, 'PENDING'],
    ]);

    // Correcting the distance changes the unbilled travel charge.
    const fixed = await f.vet.client.call('put', `/home-visits/${v.body.id}/distance`, { distanceKm: 10 });
    expect(fixed.status).toBe(200);
    const travel = await prisma().charge.findFirstOrThrow({ where: { organizationId: org.orgId, sourceType: 'HomeVisitDistance' } });
    expect(Number(travel.quantity)).toBe(10);
    expect(travel.description).toContain('10 km');

    // Starting and finishing the consultation does not add the call-out fee twice.
    const started = await f.vet.client.post(`/appointments/${v.body.id}/status`, { action: 'start' });
    expect(started.body.status).toBe('IN_CONSULTATION');
    await f.vet.client.post(`/encounters/${started.body.encounterId}/complete`, {});
    expect(await prisma().charge.count({ where: { organizationId: org.orgId, sourceType: 'HomeVisitCallout' } })).toBe(1);

    const audit = await prisma().auditEvent.findMany({ where: { organizationId: org.orgId, action: { startsWith: 'appointment.home_visit' } }, select: { action: true } });
    expect(audit.map((a: { action: string }) => a.action).sort()).toEqual(['appointment.home_visit_arrived', 'appointment.home_visit_distance', 'appointment.home_visit_on_the_way']);
  });

  it('adds the call-out fee when the consultation is finished, even if nobody pressed "Arrived"', async () => {
    const org = await registerOrg();
    const f = await schedulingFixture(org);
    await fees(org);
    const v = await org.owner.post('/appointments', booking(org, f, karachi(futureDate(3), '12:00'), home()));
    const started = await f.vet.client.post(`/appointments/${v.body.id}/status`, { action: 'start' });
    expect(started.body.arrivedAt).toBeTruthy();
    await f.vet.client.post(`/encounters/${started.body.encounterId}/complete`, {});
    const charge = await prisma().charge.findFirstOrThrow({ where: { organizationId: org.orgId, sourceType: 'HomeVisitCallout' } });
    expect(charge).toMatchObject({ unitPriceMinor: 150000, status: 'PENDING', encounterId: started.body.encounterId });
  });

  it('settings accept only this clinic’s services, need settings permission, and home visits can be switched off', async () => {
    const org = await registerOrg();
    const other = await registerOrg();
    const foreign = await other.owner.post('/services', { code: 'X1', name: 'Other clinic fee', category: 'OTHER', priceMinor: 100 });
    const res = await org.owner.call('put', '/home-visits/settings', { calloutServiceId: foreign.body.id, travelMinutes: 20 });
    expect(res.body.error.code).toBe('INVALID_SERVICE');

    const f = await schedulingFixture(org);
    expect((await f.vet.client.call('put', '/home-visits/settings', { travelMinutes: 20 })).status).toBe(403);

    const mods = await org.owner.call('put', '/setup/modules', { enabled: ['lab'] });
    expect(mods.status).toBe(200);
    const off = await org.owner.post('/appointments', booking(org, f, karachi(futureDate(5), '12:00'), home()));
    expect(off.body.error.code).toBe('HOME_VISITS_OFF');
  });
});
