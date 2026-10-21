import { createHmac } from 'node:crypto';
import request from 'supertest';
import { MessagesService } from '../src/modules/comms/messages.service';
import { booking, closeApp, futureDate, getApp, karachi, makeClient, prisma, registerOrg, schedulingFixture, staff } from './helpers';

/** A stand-in for Meta's Graph API: records requests and answers like WhatsApp Cloud API does. */
function fakeMeta() {
  const calls: { url: string; method: string; body: any }[] = [];
  let nextId = 0;
  const spy = jest.spyOn(global, 'fetch').mockImplementation(async (input: any, init?: any) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, method: init?.method ?? 'GET', body });
    const auth = String(init?.headers?.Authorization ?? '');
    const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
    if (auth.includes('bad-token')) return json(401, { error: { message: 'Invalid OAuth access token', code: 190 } });
    if (url.includes('/message_templates')) {
      return json(200, {
        data: [
          { name: 'appointment_reminder', language: 'en', status: 'APPROVED', category: 'UTILITY', components: [{ type: 'BODY', text: 'Hi {{1}}, {{2}} has an appointment on {{3}}.' }] },
          { name: 'promo_with_image', language: 'en', status: 'APPROVED', category: 'MARKETING', components: [{ type: 'HEADER', format: 'IMAGE' }, { type: 'BODY', text: 'Offer' }] },
        ],
      });
    }
    if (url.includes('/subscribed_apps')) return json(200, { success: true });
    if (url.endsWith('/messages')) {
      if (body?.to === '920000000000') return json(400, { error: { message: '(#131026) Message undeliverable', code: 131026 } });
      return json(200, { messaging_product: 'whatsapp', messages: [{ id: `wamid.TEST${++nextId}` }] });
    }
    if (/\/\d+\?fields=/.test(url)) return json(200, { id: '1111111111', display_phone_number: '+92 300 0000001', verified_name: 'Test Vet Clinic', quality_rating: 'GREEN' });
    return json(404, { error: { message: 'Unknown path', code: 100, error_subcode: 33 } });
  });
  return { calls, restore: () => spy.mockRestore() };
}

const CONNECT = { phoneNumberId: '1111111111', businessAccountId: '2222222222', accessToken: `EAAG${'x'.repeat(40)}`, appSecret: 'test-app-secret' };
const dispatch = async () => (await getApp()).get(MessagesService).dispatch();
const sign = (body: string) => `sha256=${createHmac('sha256', CONNECT.appSecret).update(body).digest('hex')}`;
async function webhook(key: string, payload: unknown, signature?: string) {
  const body = JSON.stringify(payload);
  return request((await getApp()).getHttpServer())
    .post(`/api/v1/webhooks/whatsapp/${key}`)
    .set('Content-Type', 'application/json')
    .set('x-hub-signature-256', signature ?? sign(body))
    .send(body);
}

describe('WhatsApp integration', () => {
  afterAll(closeApp);

  it('connects a clinic number after checking it with Meta, keeps the token secret, and only for permitted staff', async () => {
    const meta = fakeMeta();
    try {
      const org = await registerOrg();
      const bad = await org.owner.call('put', '/integrations/whatsapp', { ...CONNECT, accessToken: `bad-token-${'y'.repeat(30)}` });
      expect(bad.status).toBe(422);
      expect(bad.body.error.message).toMatch(/access token is not valid/i);

      const ok = await org.owner.call('put', '/integrations/whatsapp', CONNECT);
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ connected: true, enabled: false, displayPhoneNumber: '+92 300 0000001', verifiedName: 'Test Vet Clinic', hasAppSecret: true });
      expect(JSON.stringify(ok.body)).not.toContain(CONNECT.accessToken);
      const row = await prisma().whatsAppIntegration.findUniqueOrThrow({ where: { organizationId: org.orgId } });
      expect(row.accessTokenEnc).not.toContain(CONNECT.accessToken);

      const templates = await org.owner.get('/integrations/whatsapp/templates');
      expect(templates.body).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'appointment_reminder', paramCount: 3, supported: true }), expect.objectContaining({ name: 'promo_with_image', supported: false })]));

      const reception = await staff(org, 'receptionist');
      expect((await reception.client.get('/integrations/whatsapp')).status).toBe(403);
    } finally {
      meta.restore();
    }
  });

  it('sends by WhatsApp with the linked template, records delivery and reads, stores replies, and falls back to email', async () => {
    const meta = fakeMeta();
    try {
      const org = await registerOrg();
      const connected = await org.owner.call('put', '/integrations/whatsapp', CONNECT);
      const key = connected.body.webhookPath.split('/').pop();
      // Sending is off until switched on.
      const client = await makeClient(org.owner, { firstName: 'Sana', lastName: 'Malik', mobilePhone: '0300 7654321', email: `wa-${Date.now()}@example.test`, preferredChannel: 'WHATSAPP' });
      const off = await org.owner.post('/messages', { clientId: client.id, channel: 'WHATSAPP', body: 'Hello' });
      expect(off.body).toMatchObject({ status: 'SKIPPED', lastError: expect.stringMatching(/not connected/i) });

      expect((await org.owner.patch('/integrations/whatsapp/settings', { enabled: true, sendPolicy: 'ALL_MOBILE' })).body).toMatchObject({ enabled: true, sendPolicy: 'ALL_MOBILE' });
      const link = await org.owner.call('put', '/integrations/whatsapp/template-links', { purpose: 'GENERAL', templateName: 'clinic_message', language: 'en', params: ['clientName', 'body'] });
      expect(link.body.links).toEqual([expect.objectContaining({ purpose: 'GENERAL', templateName: 'clinic_message', params: ['clientName', 'body'] })]);
      expect((await org.owner.call('put', '/integrations/whatsapp/template-links', { purpose: 'GENERAL', templateName: 'x', language: 'en', params: ['password'] })).status).toBe(422);

      const sent = await org.owner.post('/messages', { clientId: client.id, channel: 'WHATSAPP', body: 'Bella is ready to collect.' });
      expect(sent.body).toMatchObject({ status: 'QUEUED', recipient: '923007654321' });
      await dispatch();
      const call = meta.calls.find((c) => c.url.endsWith('/1111111111/messages') && c.body?.to === '923007654321');
      expect(call?.body).toMatchObject({ type: 'template', template: { name: 'clinic_message', language: { code: 'en' }, components: [{ type: 'body', parameters: [{ type: 'text', text: 'Sana Malik' }, { type: 'text', text: 'Bella is ready to collect.' }] }] } });
      const row = await prisma().outboundMessage.findUniqueOrThrow({ where: { id: sent.body.id } });
      expect(row).toMatchObject({ status: 'SENT', providerMessageId: expect.stringMatching(/^wamid\./) });

      // Meta's receipts: unsigned calls are refused; signed ones mark delivered and read.
      const receipt = { object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: '1111111111' }, statuses: [{ id: row.providerMessageId, status: 'delivered', timestamp: '1760000000' }, { id: row.providerMessageId, status: 'read', timestamp: '1760000060' }] } }] }] };
      expect((await webhook(key, receipt, 'sha256=forged')).status).toBe(403);
      expect((await webhook(key, receipt)).body).toMatchObject({ ok: true, statuses: 2 });
      expect(await prisma().outboundMessage.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ deliveredAt: expect.any(Date), readAt: expect.any(Date) });

      // The client's reply lands in Messages, and a staff reply within 24 hours goes back on WhatsApp.
      const reply = { entry: [{ changes: [{ value: { metadata: { phone_number_id: '1111111111' }, contacts: [{ wa_id: '923007654321', profile: { name: 'Sana' } }], messages: [{ from: '923007654321', id: 'wamid.IN1', timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'Thank you, coming at 5' } }] } }] }] };
      expect((await webhook(key, reply)).body).toMatchObject({ replies: 1 });
      const inbound = await prisma().clientMessage.findFirstOrThrow({ where: { clientId: client.id, direction: 'INBOUND' } });
      expect(inbound).toMatchObject({ kind: 'WHATSAPP', body: 'Thank you, coming at 5', authorName: 'Sana (WhatsApp)' });
      const staffReply = await org.owner.post('/client-messages', { clientId: client.id, body: 'See you then!' });
      expect(staffReply.status).toBe(201);
      expect(await prisma().outboundMessage.findFirst({ where: { clientId: client.id, channel: 'WHATSAPP', sourceType: 'ClientMessage' } })).toMatchObject({ recipient: '923007654321', body: 'See you then!' });

      // Undeliverable number: fails at once (no retries) and goes by email instead.
      const noWa = await makeClient(org.owner, { mobilePhone: '0311 1111111', email: `fb-${Date.now()}@example.test`, preferredChannel: 'WHATSAPP' });
      const m2 = await org.owner.post('/messages', { clientId: noWa.id, channel: 'WHATSAPP', body: 'Hi' });
      expect(m2.body.status).toBe('QUEUED');
      // The fake Meta treats this number as "not on WhatsApp".
      await prisma().outboundMessage.update({ where: { id: m2.body.id }, data: { recipient: '920000000000' } });
      await dispatch();
      expect(await prisma().outboundMessage.findUniqueOrThrow({ where: { id: m2.body.id } })).toMatchObject({ status: 'FAILED', attempts: 1, lastError: expect.stringMatching(/cannot receive WhatsApp.*sent by email instead/) });
      expect(await prisma().outboundMessage.findFirst({ where: { dedupeKey: `whatsapp-fallback:${m2.body.id}`, channel: 'EMAIL' } })).toBeTruthy();

      // Meta's one-time webhook check.
      const verify = await request((await getApp()).getHttpServer()).get(`/api/v1/webhooks/whatsapp/${key}`).query({ 'hub.mode': 'subscribe', 'hub.verify_token': connected.body.verifyToken, 'hub.challenge': '12345' });
      expect(verify.text).toBe('12345');
      expect((await request((await getApp()).getHttpServer()).get(`/api/v1/webhooks/whatsapp/${key}`).query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': '1' })).status).toBe(403);

      // Disconnecting stops WhatsApp; the log stays.
      expect((await org.owner.del('/integrations/whatsapp')).body.connected).toBe(false);
      expect(await prisma().outboundMessage.count({ where: { organizationId: org.orgId, channel: 'WHATSAPP' } })).toBeGreaterThan(0);
    } finally {
      meta.restore();
    }
  });

  it('notifies clients on WhatsApp when appointments are booked, moved and cancelled and when they pay, following the clinic’s choices', async () => {
    const meta = fakeMeta();
    try {
      const org = await registerOrg();
      const f = await schedulingFixture(org);
      await prisma().client.update({ where: { id: f.client.id }, data: { mobilePhone: '0301 2223334', email: `n-${Date.now()}@example.test`, preferredChannel: 'WHATSAPP' } });
      const day = futureDate(5);
      const forClient = () => prisma().outboundMessage.findMany({ where: { clientId: f.client.id }, orderBy: { createdAt: 'asc' } });

      // Not connected: nothing goes out (email is off by default).
      const before = await org.owner.post('/appointments', booking(org, f, karachi(day, '09:00')));
      expect(before.status).toBe(201);
      expect(await forClient()).toHaveLength(0);

      await org.owner.call('put', '/integrations/whatsapp', CONNECT);
      await org.owner.patch('/integrations/whatsapp/settings', { enabled: true });
      expect((await org.owner.get('/client-notifications')).body).toMatchObject({ whatsapp: { connected: true, active: true }, rules: expect.arrayContaining([{ event: 'APPOINTMENT_BOOKED', whatsapp: true, email: false, updatedByName: null }]) });

      const a = await org.owner.post('/appointments', booking(org, f, karachi(day, '10:00')));
      let msgs = await forClient();
      expect(msgs).toEqual([expect.objectContaining({ purpose: 'APPOINTMENT_BOOKED', channel: 'WHATSAPP', recipient: '923012223334', status: 'QUEUED', sourceId: a.body.id })]);
      expect(msgs[0].body).toContain(f.patient.name);
      expect(msgs[0].templateVars).toMatchObject({ petName: f.patient.name, appointmentType: expect.any(String), branchName: 'Main Clinic' });

      await org.owner.patch(`/appointments/${a.body.id}`, { startsAt: karachi(day, '11:00') });
      await org.owner.patch(`/appointments/${a.body.id}`, { notes: 'Bring vaccination card' }); // not a time change: no message
      await org.owner.post(`/appointments/${a.body.id}/status`, { action: 'cancel', reason: 'Clinic closed' });
      msgs = await forClient();
      expect(msgs.map((m) => m.purpose)).toEqual(['APPOINTMENT_BOOKED', 'APPOINTMENT_RESCHEDULED', 'APPOINTMENT_CANCELLED']);

      // The clinic switches a notification off, and turns email on for payments; a client who prefers email gets email.
      expect((await org.owner.call('put', '/client-notifications', { event: 'APPOINTMENT_BOOKED', whatsapp: false, email: false })).status).toBe(200);
      await org.owner.post('/appointments', booking(org, f, karachi(day, '13:00')));
      expect((await forClient()).filter((m) => m.purpose === 'APPOINTMENT_BOOKED')).toHaveLength(1);

      await org.owner.post('/cash/registers', { branchId: org.branchId, name: 'Desk' }).then((r) => org.owner.post('/cash/sessions', { registerId: r.body.id, openingFloatMinor: 0 }));
      await prisma().client.update({ where: { id: f.client.id }, data: { preferredChannel: 'EMAIL' } });
      await org.owner.call('put', '/client-notifications', { event: 'PAYMENT_RECEIVED', whatsapp: true, email: true });
      const paid = await org.owner.post('/payments', { clientId: f.client.id, amountMinor: 150000, method: 'CASH', allocations: [] });
      expect(paid.status).toBe(201);
      const receipt = (await forClient()).find((m) => m.purpose === 'PAYMENT_RECEIVED');
      expect(receipt).toMatchObject({ channel: 'EMAIL', subject: expect.stringMatching(/^Payment received — RCPT-/) });
      expect(receipt?.body).toMatch(/1,500/);

      // A vaccination given here tells the owner the next due date (on WhatsApp: email is off for this one).
      const vac = await org.owner.post('/care-items', { patientId: f.patient.id, kind: 'VACCINATION', title: 'Rabies vaccination', dueDate: futureDate(0), repeatEvery: 1, repeatUnit: 'YEAR' });
      await org.owner.post(`/care-items/${vac.body.id}/complete`, { mode: 'DONE' });
      const given = (await forClient()).find((m) => m.purpose === 'VACCINATION_GIVEN');
      expect(given).toMatchObject({ channel: 'WHATSAPP', templateVars: expect.objectContaining({ vaccineName: 'Rabies vaccination', nextDueDate: expect.stringMatching(/\d{4}$/) }) });

      // Staff without settings rights cannot change notifications.
      const reception = await staff(org, 'receptionist');
      expect((await reception.client.call('put', '/client-notifications', { event: 'PAYMENT_RECEIVED', whatsapp: false, email: false })).status).toBe(403);
    } finally {
      meta.restore();
    }
  });
});
