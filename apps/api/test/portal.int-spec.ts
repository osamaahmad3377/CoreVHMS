import './enable-portal';
import { MessagesService } from '../src/modules/comms/messages.service';
import { booking, closeApp, getApp, makeClient, makePatient, portalClient, portalTokenFor, prisma, registerOrg, schedulingFixture, staff } from './helpers';

const dispatch = async () => (await getApp()).get(MessagesService).dispatch();
const PW = 'Portal-Passw0rd!';

async function invited(org: Awaited<ReturnType<typeof registerOrg>>, extra: Record<string, unknown> = {}) {
  const email = `owner-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const client = await makeClient(org.owner, { email, ...extra });
  const pet = await makePatient(org.owner, client.id, { name: 'Milo' });
  const inv = await org.owner.post(`/clients/${client.id}/portal-invite`);
  expect(inv.body).toMatchObject({ invited: true, isActive: true, accountStatus: 'INVITED' });
  await dispatch();
  const token = portalTokenFor(email, 'accept')!;
  const p = await portalClient();
  const acc = await p.post('/portal/auth/accept', { token, password: PW });
  expect(acc.status).toBe(200);
  return { client, pet, email, p, token };
}

describe('Client portal', () => {
  afterAll(closeApp);

  it('invites a client, sets a password from the link, signs in, locks after repeated failures', async () => {
    const org = await registerOrg();
    const noEmail = await makeClient(org.owner);
    expect((await org.owner.post(`/clients/${noEmail.id}/portal-invite`)).body.error.code).toBe('NO_EMAIL');
    const { email, p, token } = await invited(org);
    const session = (await p.get('/portal/auth/session')).body;
    expect(session).toMatchObject({ user: { email }, clinic: { name: expect.any(String) } });
    expect((await (await portalClient()).post('/portal/auth/accept', { token, password: PW })).body.error.code).toBe('INVALID_TOKEN');
    const fresh = await portalClient();
    expect((await fresh.post('/portal/auth/login', { email, password: PW })).status).toBe(200);
    const bad = await portalClient();
    for (let i = 0; i < 5; i++) await bad.post('/portal/auth/login', { email, password: 'wrong-password' });
    expect((await bad.post('/portal/auth/login', { email, password: PW })).body.error.code).toBe('ACCOUNT_LOCKED');
    // A staff session in the same browser does not interfere, and staff routes stay closed to portal users.
    expect((await p.get('/clients')).status).toBe(401);
    p.cookies.push(...org.owner.cookies.filter((c) => c.startsWith('vcms_sid')));
    expect((await p.post('/portal/messages', { body: 'Hello from a shared computer' })).status).toBe(201);
    const noCsrf = await portalClient();
    noCsrf.cookies = [...p.cookies];
    expect((await noCsrf.post('/portal/messages', { body: 'x' })).status).toBe(403);
  });

  it('shows only the client’s own animals and only approved records', async () => {
    const org = await registerOrg();
    const vet = await staff(org, 'veterinarian', { isClinician: true });
    const a = await invited(org);
    const b = await invited(org);
    const test = await org.owner.post('/lab-tests', { code: 'T1', name: 'Test panel', category: 'BIOCHEMISTRY', analytes: [{ code: 'A', name: 'Analyte A' }] });
    const pending = await vet.client.post('/lab-orders', { patientId: a.pet.id, testIds: [test.body.id] });
    const overview = (await a.p.get('/portal/overview')).body;
    expect(overview.pets.map((x: any) => x.id)).toEqual([a.pet.id]);
    expect((await a.p.get(`/portal/pets/${b.pet.id}`)).status).toBe(404);
    expect((await a.p.get(`/portal/pets/${a.pet.id}`)).body.labReports).toHaveLength(0); // not released yet
    expect((await a.p.get(`/portal/lab-reports/${pending.body.id}`)).status).toBe(404);
    await prisma().diagnosticOrder.update({ where: { id: pending.body.id }, data: { status: 'RELEASED', releasedAt: new Date(), releasedByName: 'Dr Test' } });
    expect((await a.p.get(`/portal/lab-reports/${pending.body.id}`)).body).toMatchObject({ patient: { id: a.pet.id }, tests: [{ name: 'Test panel' }] });
    expect((await b.p.get(`/portal/lab-reports/${pending.body.id}`)).status).toBe(404);

    // Documents appear only when shared, and never to another client.
    const up = await org.owner.upload('/attachments', { entityType: 'Patient', entityId: a.pet.id }, { buffer: Buffer.from('%PDF-1.4 test'), name: 'discharge.pdf', type: 'application/pdf' });
    expect((await a.p.get('/portal/documents')).body).toHaveLength(0);
    expect((await a.p.get(`/portal/documents/${up.body.id}`)).status).toBe(404);
    await org.owner.patch(`/attachments/${up.body.id}/share`, { shared: true });
    expect((await a.p.get('/portal/documents')).body.map((d: any) => d.id)).toEqual([up.body.id]);
    expect((await a.p.get(`/portal/documents/${up.body.id}`)).status).toBe(200);
    expect((await b.p.get(`/portal/documents/${up.body.id}`)).status).toBe(404);

    const inv = await org.owner.post('/invoices', { clientId: a.client.id, lines: [{ kind: 'CUSTOM', description: 'Consult', quantity: 1, unitPriceMinor: 5000 }], issue: true });
    expect((await a.p.get('/portal/invoices')).body.invoices.map((i: any) => i.id)).toEqual([inv.body.id]);
    expect((await a.p.get(`/portal/invoices/${inv.body.id}`)).body.invoice.totalMinor).toBe(5000);
    expect((await b.p.get(`/portal/invoices/${inv.body.id}`)).status).toBe(404);
  });

  it('handles appointment cancellation rules and requests booked by staff', async () => {
    const org = await registerOrg();
    const f = await schedulingFixture(org);
    await org.owner.patch(`/clients/${f.client.id}`, { email: `sched-${Date.now()}@example.test` });
    await org.owner.post(`/clients/${f.client.id}/portal-invite`);
    await dispatch();
    const client = await prisma().client.findUniqueOrThrow({ where: { id: f.client.id } });
    const p = await portalClient();
    await p.post('/portal/auth/accept', { token: portalTokenFor(client.email!, 'accept'), password: PW });
    const soon = await org.owner.post('/appointments', booking(org, f, new Date(Date.now() + 3 * 3600_000).toISOString(), { allowOutsideHours: true }));
    const later = await org.owner.post('/appointments', booking(org, f, new Date(Date.now() + 5 * 86400_000).toISOString(), { allowOutsideHours: true }));
    const list = (await p.get('/portal/appointments')).body;
    expect(list.appointments.find((x: any) => x.id === soon.body.id).canCancel).toBe(false);
    expect((await p.post(`/portal/appointments/${soon.body.id}/cancel`, { reason: 'Busy' })).body.error.code).toBe('TOO_LATE');
    await p.post(`/portal/appointments/${later.body.id}/cancel`, { reason: 'Away that week' });
    expect((await prisma().appointment.findUniqueOrThrow({ where: { id: later.body.id } })).status).toBe('CANCELLED');

    const req = await p.post('/portal/appointment-requests', { patientId: f.patient.id, reason: 'Annual check', preferredDate: new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10), preferredTime: 'MORNING' });
    expect(req.status).toBe(201);
    const pending = (await org.owner.get('/appointment-requests')).body;
    expect(pending.map((r: any) => r.id)).toContain(req.body.id);
    const other = await makeClient(org.owner);
    const wrong = await org.owner.post('/appointments', { ...booking(org, f, new Date(Date.now() + 8 * 86400_000).toISOString(), { allowOutsideHours: true }), clientId: other.id, patientId: null });
    expect((await org.owner.post(`/appointment-requests/${req.body.id}/decision`, { action: 'booked', appointmentId: wrong.body.id })).body.error.code).toBe('INVALID_APPOINTMENT');
    const booked = await org.owner.post('/appointments', booking(org, f, new Date(Date.now() + 7 * 86400_000).toISOString(), { allowOutsideHours: true }));
    expect((await org.owner.post(`/appointment-requests/${req.body.id}/decision`, { action: 'booked', appointmentId: booked.body.id })).body.status).toBe('BOOKED');
    const msgs = (await p.get('/portal/messages')).body;
    expect(msgs.at(-1)).toMatchObject({ direction: 'OUTBOUND', subject: 'Your appointment is booked' });
  });

  it('runs secure messaging both ways, updates preferences and stops access when revoked', async () => {
    const org = await registerOrg();
    const { client, p } = await invited(org);
    await p.post('/portal/messages', { subject: 'Question', body: 'Can Milo eat before surgery?' });
    expect((await org.owner.get('/client-messages/unread')).body.unread).toBe(1);
    const thread = (await org.owner.get(`/client-messages/${client.id}`)).body;
    expect(thread.messages[0]).toMatchObject({ direction: 'INBOUND', readAt: expect.any(String) });
    expect((await org.owner.get('/client-messages/unread')).body.unread).toBe(0);
    await org.owner.post('/client-messages', { clientId: client.id, body: 'No food after 10pm, water is fine.' });
    expect((await p.get('/portal/overview')).body.unreadMessages).toBe(1);
    expect((await p.get('/portal/messages')).body.at(-1)).toMatchObject({ direction: 'OUTBOUND', body: 'No food after 10pm, water is fine.' });
    await expect(prisma().clientMessage.update({ where: { id: thread.messages[0].id }, data: { body: 'edited' } })).rejects.toThrow(/cannot be edited/);

    const prefs = await p.patch('/portal/preferences', { remindersConsent: false, marketingConsent: false, preferredChannel: 'EMAIL' });
    expect(prefs.body).toMatchObject({ remindersConsent: false, preferredChannel: 'EMAIL' });
    expect((await prisma().client.findUniqueOrThrow({ where: { id: client.id } })).remindersConsent).toBe(false);
    expect(await prisma().auditEvent.count({ where: { action: 'portal.preferences_updated', entityId: client.id } })).toBe(1);

    await org.owner.post(`/clients/${client.id}/portal-revoke`);
    expect((await p.get('/portal/overview')).status).toBe(401);
  });
});
