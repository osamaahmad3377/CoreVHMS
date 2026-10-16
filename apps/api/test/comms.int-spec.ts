import { RequestContext } from '../src/common/context/request-context';
import { ChannelRegistry } from '../src/modules/comms/channels';
import { MessagesService } from '../src/modules/comms/messages.service';
import { RemindersService } from '../src/modules/comms/reminders.service';
import { booking, closeApp, getApp, mail, makeClient, makePatient, portalClient, prisma, registerOrg, schedulingFixture, staff } from './helpers';

const daysFrom = (d: number) => new Date(Date.now() + d * 86400_000).toISOString().slice(0, 10);
const runReminders = async (orgId: string) => RequestContext.runAs({ organizationId: orgId, userName: 'System' }, async () => (await getApp()).get(RemindersService).run());
const dispatch = async () => (await getApp()).get(MessagesService).dispatch();

describe('Communications and reminders', () => {
  afterAll(closeApp);

  it('sends one care reminder per client, respects opt-outs and channel availability, and never repeats', async () => {
    const org = await registerOrg();
    const email = `rem-${Date.now()}@example.test`;
    const a = await makeClient(org.owner, { email, preferredChannel: 'EMAIL' });
    const optedOut = await makeClient(org.owner, { email: `out-${Date.now()}@example.test`, remindersConsent: false });
    const smsOnly = await makeClient(org.owner, { preferredChannel: 'SMS' });
    const pets = [await makePatient(org.owner, a.id, { name: 'Rex' }), await makePatient(org.owner, a.id, { name: 'Bella' }), await makePatient(org.owner, optedOut.id), await makePatient(org.owner, smsOnly.id)];
    for (const p of pets) await org.owner.post('/care-items', { patientId: p.id, kind: 'VACCINATION', title: 'Annual booster', dueDate: daysFrom(5) });

    const first = await runReminders(org.orgId);
    expect(first.careDue).toBe(2); // client A (both pets in one message) + SMS client; opted-out client gets nothing
    const msgs = await prisma().outboundMessage.findMany({ where: { organizationId: org.orgId } });
    const toA = msgs.find((m) => m.clientId === a.id)!;
    expect(toA).toMatchObject({ channel: 'EMAIL', status: 'QUEUED', recipient: email, purpose: 'CARE_REMINDER' });
    expect(toA.body).toContain('Rex');
    expect(toA.body).toContain('Bella');
    expect(msgs.find((m) => m.clientId === smsOnly.id)).toMatchObject({ channel: 'SMS', status: 'SKIPPED', lastError: 'No SMS provider is configured' });
    expect(msgs.find((m) => m.clientId === optedOut.id)).toBeUndefined();
    expect(await prisma().careItem.count({ where: { patientId: { in: pets.map((p) => p.id) }, remindedAt: null } })).toBe(0);

    const [again1, again2] = await Promise.all([runReminders(org.orgId), runReminders(org.orgId)]);
    expect(again1.careDue + again2.careDue).toBe(0);
    expect(await prisma().outboundMessage.count({ where: { organizationId: org.orgId } })).toBe(2);
  });

  it('sends overdue and appointment reminders once', async () => {
    const org = await registerOrg();
    const f = await schedulingFixture(org);
    await org.owner.patch(`/clients/${f.client.id}`, { email: `appt-${Date.now()}@example.test`, preferredChannel: 'EMAIL' });
    await org.owner.post('/care-items', { patientId: f.patient.id, kind: 'DEWORMING', title: 'Deworming', dueDate: daysFrom(-10) });
    const appt = await org.owner.post('/appointments', booking(org, f, new Date(Date.now() + 20 * 3600_000).toISOString(), { allowOutsideHours: true }));
    expect(appt.status).toBe(201);
    const r = await runReminders(org.orgId);
    expect(r).toMatchObject({ careOverdue: 1, appointments: 1 });
    expect((await runReminders(org.orgId)).appointments).toBe(0);
    const m = await prisma().outboundMessage.findFirstOrThrow({ where: { organizationId: org.orgId, purpose: 'APPOINTMENT_REMINDER' } });
    expect(m.body).toContain('appointment');
  });

  it('delivers queued email exactly once, retries with back-off and gives up after the last attempt', async () => {
    const org = await registerOrg();
    const email = `disp-${Date.now()}@example.test`;
    const client = await makeClient(org.owner, { email });
    const sent = await org.owner.post('/messages', { clientId: client.id, channel: 'EMAIL', subject: 'Hello', body: 'Your results are ready to collect.' });
    expect(sent.body.status).toBe('QUEUED');
    const before = mail().outbox.filter((x) => x.to === email).length;
    await Promise.all([dispatch(), dispatch()]);
    expect(mail().outbox.filter((x) => x.to === email).length - before).toBe(1);
    expect((await prisma().outboundMessage.findUniqueOrThrow({ where: { id: sent.body.id } })).status).toBe('SENT');

    const registry = (await getApp()).get(ChannelRegistry);
    const spy = jest.spyOn(registry.get('EMAIL'), 'send').mockResolvedValue({ ok: false, error: 'SMTP down' });
    try {
      const m2 = await org.owner.post('/messages', { clientId: client.id, channel: 'EMAIL', body: 'Second' });
      await dispatch();
      let row = await prisma().outboundMessage.findUniqueOrThrow({ where: { id: m2.body.id } });
      expect(row).toMatchObject({ status: 'QUEUED', attempts: 1, lastError: 'SMTP down' });
      expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
      await prisma().outboundMessage.update({ where: { id: row.id }, data: { attempts: 4, nextAttemptAt: new Date() } });
      await dispatch();
      row = await prisma().outboundMessage.findUniqueOrThrow({ where: { id: row.id } });
      expect(row.status).toBe('FAILED');
      expect((await org.owner.post(`/messages/${row.id}/retry`)).body).toMatchObject({ status: 'QUEUED', attempts: 0 });
    } finally {
      spy.mockRestore();
    }
    const ward = await staff(org, 'ward_staff');
    expect((await ward.client.post('/messages', { clientId: client.id, channel: 'EMAIL', body: 'x' })).status).toBe(403);
    const log = (await org.owner.get(`/messages?clientId=${client.id}`)).body;
    expect(log.meta.total).toBe(2);
    expect(log.channels.find((c: any) => c.channel === 'SMS')).toMatchObject({ configured: false });
  });

  it('lets the clinic edit message wording and reminder timing', async () => {
    const org = await registerOrg();
    const list = (await org.owner.get('/message-templates')).body;
    expect(list.find((t: any) => t.purpose === 'CARE_REMINDER' && t.channel === 'EMAIL').body).toContain('{{items}}');
    await org.owner.call('put', '/message-templates', { purpose: 'GENERAL', channel: 'EMAIL', subject: 'From {{clinicName}}', body: 'CUSTOM: {{body}}', isActive: true });
    const client = await makeClient(org.owner, { email: `tpl-${Date.now()}@example.test` });
    const m = await org.owner.post('/messages', { clientId: client.id, channel: 'EMAIL', body: 'Hi' });
    expect(m.body.body).toBe('CUSTOM: Hi');
    const s = await org.owner.patch('/communications/settings', { reminderLeadDays: 21, overdueReminderDays: 3, appointmentReminderHours: 48, portalEnabled: true, portalCancelHours: 12 });
    expect(s.body).toMatchObject({ reminderLeadDays: 21, portalCancelHours: 12 });
    const rec = await staff(org, 'receptionist');
    expect((await rec.client.call('put', '/message-templates', { purpose: 'GENERAL', channel: 'EMAIL', body: 'x', isActive: true })).status).toBe(403);
  });

  it('keeps the client portal switched off unless CLIENT_PORTAL_ENABLED=true', async () => {
    const org = await registerOrg();
    const client = await makeClient(org.owner, { email: `off-${Date.now()}@example.test` });
    expect((await org.owner.get('/auth/session')).body.features).toEqual({ clientPortal: false });
    // Client-facing routes and the staff-side portal routes are not served at all.
    const anon = await portalClient();
    expect((await anon.post('/portal/auth/login', { email: 'x@example.test', password: 'whatever-123' })).status).toBe(404);
    expect((await org.owner.post(`/clients/${client.id}/portal-invite`)).status).toBe(404);
    expect((await org.owner.get('/client-messages')).status).toBe(404);
    expect((await org.owner.get('/appointment-requests')).status).toBe(404);
    expect((await org.owner.get('/dashboard')).body.widgets.communications).toMatchObject({ unreadMessages: 0, pendingRequests: 0 });
  });
});
