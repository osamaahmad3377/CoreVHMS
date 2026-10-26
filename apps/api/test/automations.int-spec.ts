// Google sign-in is offered only when the platform's OAuth app is configured.
process.env.GOOGLE_CLIENT_ID = 'test-google-client';
process.env.GOOGLE_CLIENT_SECRET = 'test-google-secret';

import { RequestContext } from '../src/common/context/request-context';
import { AutomationsService } from '../src/modules/automations/automations.service';
import { MessagesService } from '../src/modules/comms/messages.service';
import { EmailIntegrationService } from '../src/modules/integrations/email-integration.service';
import { closeApp, getApp, mail, makeClient, makePatient, prisma, registerOrg, schedulingFixture, speciesId, staff } from './helpers';

const svc = async <T>(cls: new (...a: any[]) => T) => (await getApp()).get(cls);

describe('Clinic email (Gmail / Outlook / SMTP) and automations', () => {
  afterAll(closeApp);

  it('connects a mailbox with an app password, sends client email from it, and falls back when it stops working', async () => {
    const org = await registerOrg();
    const sent: any[] = [];
    let failWith: string | null = null;
    EmailIntegrationService.transportFor = (o) =>
      ({
        verify: async () => {
          if (o.auth.pass === 'wrong') throw Object.assign(new Error('Invalid login'), { code: 'EAUTH', responseCode: 535 });
          return true;
        },
        sendMail: async (m: any) => {
          if (failWith) throw Object.assign(new Error(failWith), { code: 'EAUTH' });
          sent.push(m);
          return { messageId: `<${sent.length}@test>` };
        },
      }) as any;

    expect((await org.owner.get('/integrations/email')).body).toMatchObject({ connection: null, signIn: { GMAIL: true, OUTLOOK: false } });
    const bad = await org.owner.call('put', '/integrations/email/password', { provider: 'GMAIL', email: 'clinic@gmail.com', password: 'wrong' });
    expect(bad.body.error.code).toBe('EMAIL_LOGIN_FAILED');
    expect(bad.body.error.message).toMatch(/app password/i);

    const ok = await org.owner.call('put', '/integrations/email/password', { provider: 'GMAIL', email: 'Clinic@Gmail.com', fromName: 'Happy Paws', password: 'abcd efgh ijkl mnop' });
    expect(ok.status).toBe(200);
    expect(ok.body.connection).toMatchObject({ provider: 'GMAIL', method: 'PASSWORD', email: 'clinic@gmail.com', smtpHost: 'smtp.gmail.com', status: 'CONNECTED' });
    const row = await prisma().emailIntegration.findFirstOrThrow({ where: { organizationId: org.orgId } });
    expect(row.secretEnc).not.toContain('abcd');

    expect((await org.owner.post('/integrations/email/test', { to: 'owner@example.com' })).status).toBe(200);
    expect(sent[0]).toMatchObject({ to: 'owner@example.com', from: '"Happy Paws" <clinic@gmail.com>' });

    // Client emails go from the clinic's mailbox.
    const client = await makeClient(org.owner, { email: 'client@example.com', preferredChannel: 'EMAIL' });
    expect((await org.owner.post('/messages', { clientId: client.id, channel: 'EMAIL', subject: 'Hello', body: 'Your pet is ready' })).status).toBe(201);
    const messages = await svc(MessagesService);
    await messages.dispatch();
    expect(sent[sent.length - 1]).toMatchObject({ to: 'client@example.com', from: '"Happy Paws" <clinic@gmail.com>', subject: 'Hello' });
    const channels = (await org.owner.get('/messages')).body.channels;
    expect(channels.find((c: any) => c.channel === 'EMAIL').provider).toBe('Gmail (clinic@gmail.com)');

    // The mailbox stops accepting the password: marked for attention, and the email still reaches the client.
    failWith = 'Invalid login';
    const before = mail().outbox.length;
    await org.owner.post('/messages', { clientId: client.id, channel: 'EMAIL', subject: 'Second', body: 'Still delivered' });
    await messages.dispatch();
    expect(mail().outbox.length).toBe(before + 1);
    expect(mail().outbox[mail().outbox.length - 1]).toMatchObject({ to: 'client@example.com', subject: 'Second' });
    const after = (await org.owner.get('/integrations/email')).body.connection;
    expect(after).toMatchObject({ status: 'NEEDS_ATTENTION' });
    expect(after.lastError).toMatch(/app password/i);

    // Reception cannot touch the mailbox.
    const reception = await staff(org, 'receptionist');
    expect((await reception.client.get('/integrations/email')).status).toBe(403);
    expect((await org.owner.del('/integrations/email')).body.connection).toBeNull();
  });

  it('connects Gmail by signing in with Google and sends through the Gmail API', async () => {
    const org = await registerOrg();
    org.owner.headers = { origin: 'http://localhost:3000' };
    org.owner.host = 'localhost:3000';
    const start = await org.owner.post('/integrations/email/sign-in', { provider: 'GMAIL' });
    expect(start.status).toBe(200);
    const url = new URL(start.body.url);
    expect(url.searchParams.get('client_id')).toBe('test-google-client');
    expect(url.searchParams.get('scope')).toContain('gmail.send');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3000/api/v1/oauth/email/callback');
    const state = url.searchParams.get('state')!;
    expect((await org.owner.post('/integrations/email/sign-in', { provider: 'OUTLOOK' })).body.error.code).toBe('SIGN_IN_NOT_SET_UP');

    const idToken = ['x', Buffer.from(JSON.stringify({ email: 'Front.Desk@gmail.com' })).toString('base64url'), 'sig'].join('.');
    const calls: { url: string; init: any }[] = [];
    const spy = jest.spyOn(global, 'fetch').mockImplementation(async (input: any, init?: any) => {
      calls.push({ url: String(input), init });
      if (String(input).includes('oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600, id_token: idToken }), { status: 200 });
      if (String(input).includes('/gmail/v1/users/me/messages/send')) return new Response(JSON.stringify({ id: 'gmail-msg-1' }), { status: 200 });
      return new Response('{}', { status: 404 });
    });
    try {
      // Tampered state is refused.
      const forged = await org.owner.get(`/oauth/email/callback?code=abc&state=${state.slice(0, -2)}xx`);
      expect(forged.headers.location).toContain('email=expired');
      const back = await org.owner.get(`/oauth/email/callback?code=abc&state=${encodeURIComponent(state)}`);
      expect(back.status).toBe(302);
      expect(back.headers.location).toBe('http://localhost:3000/settings/integrations/email?email=connected');
      const conn = (await org.owner.get('/integrations/email')).body.connection;
      expect(conn).toMatchObject({ provider: 'GMAIL', method: 'OAUTH', email: 'front.desk@gmail.com', status: 'CONNECTED' });

      const client = await makeClient(org.owner, { email: 'owner2@example.com', preferredChannel: 'EMAIL' });
      await org.owner.post('/messages', { clientId: client.id, channel: 'EMAIL', subject: 'Results', body: 'Ready' });
      await (await svc(MessagesService)).dispatch();
      const send = calls.find((c) => c.url.includes('/messages/send'))!;
      expect(send.init.headers.Authorization).toBe('Bearer at-1');
      const raw = Buffer.from(JSON.parse(send.init.body).raw, 'base64url').toString('utf8');
      expect(raw).toContain('To: owner2@example.com');
      expect(raw).toContain('front.desk@gmail.com');
      const msg = await prisma().outboundMessage.findFirstOrThrow({ where: { organizationId: org.orgId, subject: 'Results' } });
      expect(msg).toMatchObject({ status: 'SENT', providerMessageId: 'gmail-msg-1' });
      // Cancelled at Google: back to the settings page with a reason.
      const cancelled = await org.owner.get(`/oauth/email/callback?error=access_denied&state=${encodeURIComponent(state)}`);
      expect(cancelled.headers.location).toContain('email=cancelled');
    } finally {
      spy.mockRestore();
    }
  });

  it('runs a workflow: when a visit is finished (dogs only) → message → wait → task, and stops runs that no longer apply', async () => {
    const org = await registerOrg();
    const f = await schedulingFixture(org);
    const dog = await speciesId(org.owner, 'Dog');
    const cat = await speciesId(org.owner, 'Cat');
    const auto = (await svc(AutomationsService));
    const base = {
      name: 'Thank you after a visit',
      trigger: 'APPOINTMENT_COMPLETED',
      conditions: [{ field: 'species', op: 'IS', values: [dog] }],
      steps: [
        { type: 'SEND_MESSAGE', channel: 'BEST', subject: 'Thank you', body: 'Thank you for bringing {{petName}} to {{clinicName}}.' },
        { type: 'WAIT', amount: 2, unit: 'HOURS' },
        { type: 'CREATE_TASK', title: 'Call about {{petName}}', dueInDays: 1 },
      ],
    };
    // Rules: no wait at the end; reception cannot manage automations.
    expect((await org.owner.post('/automations', { ...base, steps: [...base.steps, { type: 'WAIT', amount: 1, unit: 'DAYS' }] })).status).toBe(400);
    const reception = await staff(org, 'receptionist');
    expect((await reception.client.post('/automations', base)).status).toBe(403);
    const created = await org.owner.post('/automations', base);
    expect(created.status).toBe(201);
    await org.owner.post('/automations', { ...base, name: 'Cats only', conditions: [{ field: 'species', op: 'IS', values: [cat] }] });

    // Preview on a real record sends nothing.
    const client = await makeClient(org.owner, { email: 'dogowner@example.com' });
    const pet = await makePatient(org.owner, client.id, { name: 'Sheru' });
    const walk = await org.owner.post('/front-desk/walk-in', { branchId: org.branchId, clientId: client.id, patientId: pet.id, appointmentTypeId: f.typeId, clinicianId: f.vet.membershipId });
    expect(walk.status).toBe(201);
    const preview = (await org.owner.post('/automations/preview', { automation: base, sourceId: walk.body.id })).body;
    expect(preview.conditionsMet).toBe(true);
    expect(preview.steps[0]).toMatchObject({ type: 'SEND_MESSAGE', channel: 'EMAIL', recipient: 'dogowner@example.com', body: expect.stringContaining('Sheru') });

    // The visit finishes: the dog automation runs, the cat one does not.
    expect((await org.owner.post(`/appointments/${walk.body.id}/status`, { action: 'complete' })).status).toBe(200);
    const runs = await prisma().automationRun.findMany({ where: { organizationId: org.orgId }, include: { automation: true } });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: 'WAITING', nextStep: 2 });
    const msg = await prisma().outboundMessage.findFirstOrThrow({ where: { organizationId: org.orgId, purpose: 'AUTOMATION' } });
    expect(msg).toMatchObject({ channel: 'EMAIL', recipient: 'dogowner@example.com', subject: 'Thank you' });
    expect(msg.body).toContain('Sheru');

    // Two hours later: the task is created for the vet who saw the animal.
    await prisma().automationRun.update({ where: { id: runs[0].id }, data: { runAt: new Date(Date.now() - 1000) } });
    expect(await auto.runDue()).toBeGreaterThanOrEqual(1);
    const done = await prisma().automationRun.findUniqueOrThrow({ where: { id: runs[0].id } });
    expect(done.status).toBe('DONE');
    const task = await prisma().task.findFirstOrThrow({ where: { organizationId: org.orgId, title: 'Call about Sheru' } });
    expect(task).toMatchObject({ assigneeId: f.vet.membershipId, createdByName: 'Automation: Thank you after a visit' });
    // Once per visit.
    await RequestContext.runAs({ organizationId: org.orgId }, () => auto.onEvent({ type: 'APPOINTMENT_COMPLETED', appointmentId: walk.body.id }));
    expect(await prisma().automationRun.count({ where: { organizationId: org.orgId } })).toBe(1);

    // A client who asked for no messages is respected.
    const quiet = await makeClient(org.owner, { email: 'quiet@example.com', remindersConsent: false });
    const quietPet = await makePatient(org.owner, quiet.id, { name: 'Moti' });
    const w2 = await org.owner.post('/front-desk/walk-in', { branchId: org.branchId, clientId: quiet.id, patientId: quietPet.id, appointmentTypeId: f.typeId });
    await org.owner.post(`/appointments/${w2.body.id}/status`, { action: 'complete' });
    const quietRun = await prisma().automationRun.findFirstOrThrow({ where: { organizationId: org.orgId, sourceId: w2.body.id } });
    expect((quietRun.log as any[])[0]).toMatchObject({ ok: false, note: 'The client asked not to receive messages' });

    // A reminder waiting to go out stops when the appointment is cancelled.
    const booked = await org.owner.post('/automations', {
      name: 'Confirm then nudge',
      trigger: 'APPOINTMENT_BOOKED',
      steps: [{ type: 'WAIT', amount: 1, unit: 'HOURS' }, { type: 'SEND_MESSAGE', channel: 'EMAIL', subject: 'See you soon', body: 'See you soon, {{petName}}' }],
    });
    expect(booked.status).toBe(201);
    const startsAt = new Date(Date.now() + 3 * 86400_000);
    startsAt.setUTCHours(6, 0, 0, 0); // 11:00 in Karachi
    const appt = await org.owner.post('/appointments', { branchId: org.branchId, clientId: client.id, patientId: pet.id, appointmentTypeId: f.typeId, clinicianId: f.vet.membershipId, startsAt: startsAt.toISOString() });
    expect(appt.status).toBe(201);
    const apptId = appt.body.id ?? appt.body[0]?.id;
    const waiting = await prisma().automationRun.findFirstOrThrow({ where: { organizationId: org.orgId, automationId: booked.body.id } });
    expect(waiting.status).toBe('WAITING');
    await org.owner.post(`/appointments/${apptId}/status`, { action: 'cancel', reason: 'Owner travelling' });
    await prisma().automationRun.update({ where: { id: waiting.id }, data: { runAt: new Date(Date.now() - 1000) } });
    await auto.runDue();
    expect(await prisma().automationRun.findUniqueOrThrow({ where: { id: waiting.id } })).toMatchObject({ status: 'STOPPED', error: 'The appointment is now cancelled' });

    // "24 hours before": found by the scheduler once, not twice.
    const upcoming = await org.owner.post('/automations', { name: 'Day before', trigger: 'APPOINTMENT_UPCOMING', offset: 24, steps: [{ type: 'SEND_MESSAGE', channel: 'EMAIL', body: 'Tomorrow: {{petName}} at {{appointmentTime}}' }] });
    expect(upcoming.status).toBe(201);
    const soon = new Date(Date.now() + 20 * 3_600_000);
    const appt2 = await prisma().appointment.create({
      data: { organizationId: org.orgId, branchId: org.branchId, number: 99001, clientId: client.id, patientId: pet.id, appointmentTypeId: f.typeId, startsAt: soon, endsAt: new Date(soon.getTime() + 20 * 60_000), status: 'BOOKED', createdAt: new Date(Date.now() - 3 * 86400_000) },
    });
    expect(await auto.scanTimed()).toBeGreaterThanOrEqual(1);
    await auto.scanTimed();
    expect(await prisma().automationRun.count({ where: { automationId: upcoming.body.id, sourceId: appt2.id } })).toBe(1);

    const list = (await org.owner.get('/automations')).body;
    expect(list.find((a: any) => a.id === created.body.id)).toMatchObject({ runCount: 2 });
    const activity = (await org.owner.get('/automations/runs')).body;
    expect(activity.meta.total).toBeGreaterThanOrEqual(4);
  });
});
