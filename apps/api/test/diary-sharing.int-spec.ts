import { AutomationsService } from '../src/modules/automations/automations.service';
import { TestClient, closeApp, getApp, makeClient, makePatient, prisma, registerOrg, schedulingFixture, staff } from './helpers';

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });
const tokenOf = (url: string) => url.split('/d/')[1];

describe('Pet diary: design, owner link, sending and automatic messages', () => {
  afterAll(closeApp);

  it('keeps the clinic’s design and gives the owner a private link that can be replaced', async () => {
    const org = await registerOrg('Happy Paws Clinic');
    const vet = await staff(org, 'veterinarian', { isClinician: true });
    const client = await makeClient(org.owner, { firstName: 'Ahmed', lastName: 'Khan', email: 'ahmed@example.test' });
    const patient = await makePatient(org.owner, client.id, { name: 'Bruno' });
    const anon = new TestClient(await getApp());

    // The standard design until the clinic changes it; only settings managers change it.
    expect((await org.owner.get('/diary-settings')).body).toMatchObject({ title: 'Pet Health Diary', theme: 'CLASSIC', showQr: true, hiddenSections: [], notesPages: 1 });
    const want = { title: 'Pet Passport', tagline: 'Healthy and happy', theme: 'ELEGANT', hiddenSections: ['treatments'], notesPages: 2, footerNote: 'Open daily 9–8', emergencyNote: 'Night line 0300 1234567', accentColor: '#112233' };
    expect((await vet.client.call('put', '/diary-settings', want)).status).toBe(403);
    expect((await org.owner.call('put', '/diary-settings', { ...want, accentColor: 'red' })).status).toBe(400);
    expect((await org.owner.call('put', '/diary-settings', { ...want, hiddenSections: ['owner'] })).status).toBe(400);
    expect((await org.owner.call('put', '/diary-settings', want)).body).toMatchObject({ title: 'Pet Passport', theme: 'ELEGANT', hiddenSections: ['treatments'], notesPages: 2, accentColor: '#112233' });
    // Vets read the design (they print the book).
    expect((await vet.client.get('/diary-settings')).body.theme).toBe('ELEGANT');

    // The booklet carries the design and the address the QR code opens.
    const booklet = (await vet.client.get(`/patients/${patient.id}/diary/booklet`)).body;
    expect(booklet.settings.title).toBe('Pet Passport');
    expect(booklet.diary.patient.name).toBe('Bruno');
    expect(booklet.qrValue).toMatch(/\/d\/[\w-]{30,}$/);
    const link = (await vet.client.get(`/patients/${patient.id}/diary/link`)).body;
    expect(link).toMatchObject({ url: booklet.qrValue, viewCount: 0, lastViewedAt: null });
    expect(await prisma().patientDiaryLink.count({ where: { patientId: patient.id } })).toBe(1);

    // Anyone with the link reads it (and the visit is counted); nothing else opens.
    const open = await anon.get(`/public/diary/${tokenOf(link.url)}`);
    expect(open.status).toBe(200);
    expect(open.body.diary.patient.name).toBe('Bruno');
    expect(open.body.diary.clinic.name).toBe('Happy Paws Clinic');
    expect(open.body.settings.theme).toBe('ELEGANT');
    expect((await vet.client.get(`/patients/${patient.id}/diary/link`)).body).toMatchObject({ viewCount: 1 });
    expect((await anon.get('/public/diary/not-a-real-token')).status).toBe(404);

    // A new link: the old one (an old message, a printed QR code) stops working. Reception can't make one.
    const desk = await staff(org, 'receptionist');
    expect((await desk.client.post(`/patients/${patient.id}/diary/link/reset`)).status).toBe(403);
    const fresh = (await vet.client.post(`/patients/${patient.id}/diary/link/reset`)).body;
    expect(fresh.url).not.toBe(link.url);
    expect((await anon.get(`/public/diary/${tokenOf(link.url)}`)).status).toBe(404);
    expect((await anon.get(`/public/diary/${tokenOf(fresh.url)}`)).status).toBe(200);

    // QR code off → none printed; another clinic can't see this animal's link.
    await org.owner.call('put', '/diary-settings', { ...want, showQr: false });
    expect((await vet.client.get(`/patients/${patient.id}/diary/booklet`)).body.qrValue).toBeNull();
    const other = await registerOrg();
    expect((await other.owner.get(`/patients/${patient.id}/diary/link`)).status).toBe(404);

    // Back to the standard design.
    expect((await org.owner.post('/diary-settings/reset')).body).toMatchObject({ title: 'Pet Health Diary', theme: 'CLASSIC' });
  });

  it('sends the owner the link by email, and the same for a certificate', async () => {
    const org = await registerOrg('Happy Paws Clinic');
    const client = await makeClient(org.owner, { firstName: 'Ahmed', lastName: 'Khan', email: 'ahmed@example.test' });
    const patient = await makePatient(org.owner, client.id, { name: 'Bruno' });

    const sent = await org.owner.post(`/patients/${patient.id}/diary/send`, { channel: 'EMAIL' });
    expect(sent.status).toBe(200);
    const link = (await org.owner.get(`/patients/${patient.id}/diary/link`)).body;
    const msg = await prisma().outboundMessage.findFirstOrThrow({ where: { organizationId: org.orgId, recipient: 'ahmed@example.test' } });
    expect(msg.subject).toContain('Bruno’s pet diary');
    expect(msg.body).toContain(link.url);
    // Staff without the right to message clients can't send.
    const nurse = await staff(org, 'nurse');
    expect((await nurse.client.post(`/patients/${patient.id}/diary/send`, { channel: 'EMAIL' })).status).toBe(403);

    const cert = (await org.owner.post('/certificates', { kind: 'FITNESS_TO_TRAVEL', patientId: patient.id, inputs: { examDate: today(), destination: 'Dubai, UAE', travelMode: 'by air' } })).body;
    expect((await org.owner.post(`/certificates/${cert.id}/send`, { channel: 'EMAIL' })).status).toBe(200);
    const cm = await prisma().outboundMessage.findFirstOrThrow({ where: { organizationId: org.orgId, subject: { contains: 'Fitness to Travel' } } });
    expect(cm.body).toContain(`/verify/${cert.verificationCode.replace(/-/g, '')}`);

    // The owner's copy of the certificate is public while it is in force, and gone once revoked.
    const anon = new TestClient(await getApp());
    const code = cert.verificationCode.replace(/-/g, '');
    const copy = (await anon.get(`/public/certificates/${code}/document`)).body;
    expect(copy.fields['patient.name']).toBe('Bruno');
    expect(copy.qrValue).toContain(`/verify/${code}`);
    expect((await anon.get('/public/certificates/ZZZZZZZZZZZZ/document')).status).toBe(404);
    expect((await org.owner.post(`/certificates/${cert.id}/revoke`, { reason: 'Issued in error' })).status).toBe(200);
    expect((await anon.get(`/public/certificates/${code}/document`)).status).toBe(404);
    expect((await org.owner.post(`/certificates/${cert.id}/send`, { channel: 'EMAIL' })).status).toBe(422);
  });

  it('sends the links by itself: the diary after a visit, the certificate when it is issued', async () => {
    const org = await registerOrg();
    const f = await schedulingFixture(org);
    const auto = (await getApp()).get(AutomationsService);
    const client = await makeClient(org.owner, { email: 'owner@example.test' });
    const pet = await makePatient(org.owner, client.id, { name: 'Sheru' });

    // Off until the clinic switches them on (from Settings → Pet diary).
    expect((await org.owner.get('/diary-settings/automatic-sending')).body).toMatchObject({ diary: { exists: false, on: false }, certificate: { exists: false, on: false } });
    const desk = await staff(org, 'receptionist');
    expect((await desk.client.call('put', '/diary-settings/automatic-sending', { which: 'diary', on: true })).status).toBe(403);
    const state = (await org.owner.call('put', '/diary-settings/automatic-sending', { which: 'diary', on: true })).body;
    expect(state.diary).toMatchObject({ exists: true, on: true });
    await org.owner.call('put', '/diary-settings/automatic-sending', { which: 'certificate', on: true });
    // Switching off keeps the automation (so its wording stays) but stops it.
    expect((await org.owner.call('put', '/diary-settings/automatic-sending', { which: 'certificate', on: false })).body.certificate).toMatchObject({ exists: true, on: false });
    expect((await org.owner.call('put', '/diary-settings/automatic-sending', { which: 'certificate', on: true })).body.certificate.on).toBe(true);
    expect(await prisma().automation.count({ where: { organizationId: org.orgId, recipeKey: { in: ['diary-after-visit', 'certificate-issued'] } } })).toBe(2);

    // A certificate is issued: the owner is sent the link to it straight away.
    const cert = (await org.owner.post('/certificates', { kind: 'FITNESS_TO_TRAVEL', patientId: pet.id, inputs: { examDate: today(), destination: 'Dubai, UAE', travelMode: 'by air' } })).body;
    const cm = await prisma().outboundMessage.findFirstOrThrow({ where: { organizationId: org.orgId, purpose: 'AUTOMATION', recipient: 'owner@example.test' } });
    expect(cm.subject).toContain('Sheru');
    expect(cm.body).toContain(`/verify/${cert.verificationCode.replace(/-/g, '')}`);

    // A visit is finished: an hour later the owner is sent the link to the diary.
    const walk = await org.owner.post('/front-desk/walk-in', { branchId: org.branchId, clientId: client.id, patientId: pet.id, appointmentTypeId: f.typeId, clinicianId: f.vet.membershipId });
    expect((await org.owner.post(`/appointments/${walk.body.id}/status`, { action: 'complete' })).status).toBe(200);
    const run = await prisma().automationRun.findFirstOrThrow({ where: { organizationId: org.orgId, automation: { recipeKey: 'diary-after-visit' } } });
    expect(run.status).toBe('WAITING');
    await prisma().automationRun.update({ where: { id: run.id }, data: { runAt: new Date(Date.now() - 1000) } });
    await auto.runDue();
    const link = (await org.owner.get(`/patients/${pet.id}/diary/link`)).body;
    const dm = await prisma().outboundMessage.findFirstOrThrow({ where: { organizationId: org.orgId, purpose: 'AUTOMATION', body: { contains: '/d/' } } });
    expect(dm.body).toContain(link.url);
    expect(await prisma().patientDiaryLink.count({ where: { patientId: pet.id } })).toBe(1);
  });
});
