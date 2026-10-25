import { closeApp, getApp, makeClient, makePatient, prisma, registerOrg, schedulingFixture, staff, TestClient } from './helpers';

describe('Waiting room: tokens, calling, TV screen and check-in tablet', () => {
  afterAll(closeApp);

  it('numbers check-ins per day, calls them to a room for the screen, and lets clients check themselves in', async () => {
    const org = await registerOrg();
    const f = await schedulingFixture(org);
    const walkIn = (patientId: string, clientId: string) => org.owner.post('/front-desk/walk-in', { branchId: org.branchId, clientId, patientId, appointmentTypeId: f.typeId });

    // Tokens 1, 2… in check-in order.
    const first = await walkIn(f.patient.id, f.client.id);
    expect(first.body.tokenNumber).toBe(1);
    const c2 = await makeClient(org.owner);
    const p2 = await makePatient(org.owner, c2.id, { name: 'Bruno' });
    const second = await walkIn(p2.id, c2.id);
    expect(second.body.tokenNumber).toBe(2);

    // Settings: links for the screen and the tablet.
    const rooms = (await org.owner.get('/waiting-room')).body;
    const mine = rooms.find((r: { branch: { id: string } }) => r.branch.id === org.branchId);
    expect(mine).toMatchObject({ displayEnabled: true, kioskEnabled: true, displayPath: expect.stringMatching(/^\/display\//), kioskPath: expect.stringMatching(/^\/kiosk\//) });
    const displayKey = mine.displayPath.split('/').pop();
    const kioskKey = mine.kioskPath.split('/').pop();
    const anon = new TestClient(await getApp());

    let screen = (await anon.get(`/public/waiting-room/display/${displayKey}`)).body;
    expect(screen.calls).toEqual([]);
    expect(screen.waiting.map((w: { token: number }) => w.token)).toEqual([1, 2]);

    // Call token 2 to a room: it leaves the queue and shows on the screen.
    const called = await org.owner.post(`/appointments/${second.body.id}/call`, { room: 'Room 2' });
    expect(called.body).toMatchObject({ tokenNumber: 2, calledRoom: 'Room 2', callCount: 1 });
    screen = (await anon.get(`/public/waiting-room/display/${displayKey}`)).body;
    expect(screen.calls[0]).toMatchObject({ token: 2, room: 'Room 2', pet: 'Bruno', callCount: 1 });
    expect(screen.waiting.map((w: { token: number }) => w.token)).toEqual([1]);
    // Calling again repeats the announcement.
    await org.owner.post(`/appointments/${second.body.id}/call`, { room: 'Room 2' });
    expect((await anon.get(`/public/waiting-room/display/${displayKey}`)).body.calls[0].callCount).toBe(2);

    // Privacy option: tokens only.
    await org.owner.call('put', `/waiting-room/${org.branchId}`, { displayEnabled: true, kioskEnabled: true, showPetNames: false, kioskWalkIns: true, announce: true, message: 'Welcome' });
    screen = (await anon.get(`/public/waiting-room/display/${displayKey}`)).body;
    expect(screen.calls[0].pet).toBeNull();
    expect(screen.message).toBe('Welcome');

    // The tablet: a client types their mobile number and checks in as a walk-in for their pet (once).
    const c3 = await makeClient(org.owner, { mobilePhone: '0300 5556667', firstName: 'Hina' });
    const p3 = await makePatient(org.owner, c3.id, { name: 'Coco' });
    expect((await anon.post(`/public/waiting-room/kiosk/${kioskKey}/lookup`, { mobilePhone: '0399 0000000' })).body).toEqual({ found: false });
    const look = (await anon.post(`/public/waiting-room/kiosk/${kioskKey}/lookup`, { mobilePhone: '+92 300 5556667' })).body;
    expect(look).toMatchObject({ found: true, firstName: 'Hina', visits: [], pets: [{ id: p3.id, name: 'Coco' }] });
    const kiosk = (await anon.get(`/public/waiting-room/kiosk/${kioskKey}`)).body;
    const typeId = kiosk.walkIns[0]?.id ?? f.typeId;
    const self = await anon.post(`/public/waiting-room/kiosk/${kioskKey}/walk-in`, { mobilePhone: '0300 5556667', patientId: p3.id, appointmentTypeId: typeId });
    expect(self.status).toBe(200);
    expect(self.body).toMatchObject({ token: 3, petName: 'Coco' });
    const again = await anon.post(`/public/waiting-room/kiosk/${kioskKey}/walk-in`, { mobilePhone: '0300 5556667', patientId: p3.id, appointmentTypeId: typeId });
    expect(again.body.token).toBe(3);
    // Someone else's pet cannot be checked in with another number.
    expect((await anon.post(`/public/waiting-room/kiosk/${kioskKey}/walk-in`, { mobilePhone: '0300 5556667', patientId: f.patient.id, appointmentTypeId: typeId })).status).toBe(404);

    // Calling needs front-desk or clinical rights; switched-off devices are not found; new links replace old ones.
    const accounts = await staff(org, 'accountant');
    expect((await accounts.client.post(`/appointments/${first.body.id}/call`, { room: 'Room 1' })).status).toBe(403);
    await org.owner.post(`/waiting-room/${org.branchId}/new-links`);
    expect((await anon.get(`/public/waiting-room/display/${displayKey}`)).status).toBe(404);
    const fresh = (await org.owner.get('/waiting-room')).body.find((r: { branch: { id: string } }) => r.branch.id === org.branchId);
    await org.owner.call('put', `/waiting-room/${org.branchId}`, { displayEnabled: false, kioskEnabled: true, showPetNames: true, kioskWalkIns: true, announce: true });
    expect((await anon.get(`/public/waiting-room/display/${fresh.displayPath.split('/').pop()}`)).status).toBe(404);
    expect(await prisma().appointment.count({ where: { branchId: org.branchId, tokenNumber: { not: null } } })).toBe(3);
  });
});
