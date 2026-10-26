// Google sign-in is offered only when the platform's OAuth app is configured.
process.env.GOOGLE_CLIENT_ID = 'test-google-client';
process.env.GOOGLE_CLIENT_SECRET = 'test-google-secret';

import { RequestContext } from '../src/common/context/request-context';
import { AutomationsService } from '../src/modules/automations/automations.service';
import { MessagesService } from '../src/modules/comms/messages.service';
import { EmailIntegrationService } from '../src/modules/integrations/email-integration.service';
import { zonedToUtc } from '../src/common/time/tz';
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

  it('more triggers: overdue invoice with a "still unpaid" check, admitted to hospital, and not seen for a year with a "not booked" check', async () => {
    const org = await registerOrg();
    const f = await schedulingFixture(org);
    const auto = await svc(AutomationsService);
    const db = prisma();
    const owner = await db.membership.findFirstOrThrow({ where: { organizationId: org.orgId }, orderBy: { createdAt: 'asc' } });
    const client = await makeClient(org.owner, { email: 'payer@example.com' });
    const pet = await makePatient(org.owner, client.id, { name: 'Raja' });

    // Overdue invoice: 7 days after the due date → reminder → wait → only if still unpaid → second reminder + task.
    const overdue = await org.owner.post('/automations', {
      name: 'Overdue',
      trigger: 'INVOICE_OVERDUE',
      offset: 7,
      steps: [
        { type: 'SEND_MESSAGE', channel: 'EMAIL', subject: 'Invoice {{invoiceNumber}}', body: '{{amountDue}} still to pay (due {{dueDate}})' },
        { type: 'WAIT', amount: 7, unit: 'DAYS' },
        { type: 'CHECK', check: 'STILL_UNPAID' },
        { type: 'SEND_MESSAGE', channel: 'EMAIL', subject: 'Second reminder', body: 'Still {{amountDue}}' },
        { type: 'CREATE_TASK', title: 'Call about {{invoiceNumber}}' },
      ],
    });
    expect(overdue.status).toBe(201);
    // A check that does not fit the trigger is refused.
    expect((await org.owner.post('/automations', { name: 'Bad', trigger: 'APPOINTMENT_COMPLETED', steps: [{ type: 'SEND_MESSAGE', body: 'x' }, { type: 'CHECK', check: 'STILL_UNPAID' }, { type: 'SEND_MESSAGE', body: 'y' }] })).status).toBe(400);
    const dueAt = new Date(Date.now() - 7 * 86_400_000);
    const mkInvoice = (number: number) =>
      db.invoice.create({ data: { organizationId: org.orgId, branchId: org.branchId, number, clientId: client.id, patientId: pet.id, currency: 'PKR', status: 'ISSUED', totalMinor: 650000, balanceMinor: 650000, dueAt, createdById: owner.userId, createdByName: 'Test' } });
    const unpaid = await mkInvoice(91001);
    const paidLater = await mkInvoice(91002);
    expect(await auto.scanTimed()).toBeGreaterThanOrEqual(2);
    const first = await db.outboundMessage.findMany({ where: { organizationId: org.orgId, purpose: 'AUTOMATION', sourceType: 'Invoice' } });
    expect(first).toHaveLength(2);
    expect(first.find((m) => m.sourceId === unpaid.id)!.body).toMatch(/6,500.*still to pay/);
    // One gets paid during the week; the other does not.
    await db.invoice.update({ where: { id: paidLater.id }, data: { status: 'PAID', balanceMinor: 0, paidMinor: 650000 } });
    await db.automationRun.updateMany({ where: { automationId: overdue.body.id }, data: { runAt: new Date(Date.now() - 1000) } });
    await auto.runDue();
    const runs = await db.automationRun.findMany({ where: { automationId: overdue.body.id } });
    expect(runs.find((r) => r.sourceId === paidLater.id)).toMatchObject({ status: 'STOPPED', error: 'The invoice has been paid or voided' });
    expect(runs.find((r) => r.sourceId === unpaid.id)).toMatchObject({ status: 'DONE' });
    expect(await db.outboundMessage.count({ where: { organizationId: org.orgId, subject: 'Second reminder' } })).toBe(1);
    expect(await db.task.count({ where: { organizationId: org.orgId, title: 'Call about INV-091001' } })).toBe(1);

    // Admitted to hospital → reassuring message.
    await org.owner.post('/automations', { name: 'Admitted', trigger: 'PATIENT_ADMITTED', steps: [{ type: 'SEND_MESSAGE', channel: 'EMAIL', subject: '{{petName}} is in our care', body: '{{petName}} was admitted at {{branchName}}.' }] });
    const adm = await org.owner.post('/admissions', { patientId: pet.id, reason: 'Observation', condition: 'STABLE' });
    expect(adm.status).toBe(201);
    expect(await db.outboundMessage.count({ where: { organizationId: org.orgId, subject: 'Raja is in our care' } })).toBe(1);

    // Not seen for 12 months → message with the booking link → wait → only if still not booked.
    const lapsed = await org.owner.post('/automations', {
      name: 'Recall',
      trigger: 'PATIENT_LAPSED',
      offset: 12,
      steps: [
        { type: 'SEND_MESSAGE', channel: 'EMAIL', subject: 'Check-up for {{petName}}', body: '{{monthsSince}} months since {{lastVisitDate}}. {{bookingLine}}' },
        { type: 'WAIT', amount: 14, unit: 'DAYS' },
        { type: 'CHECK', check: 'NOT_BOOKED' },
        { type: 'SEND_MESSAGE', channel: 'EMAIL', subject: 'Reminder for {{petName}}', body: 'Still time to book' },
      ],
    });
    expect(lapsed.status).toBe(201);
    const c2 = await makeClient(org.owner, { email: 'lapsed@example.com' });
    const old = await makePatient(org.owner, c2.id, { name: 'Lali' });
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(new Date());
    const [y, m, d] = today.split('-').map(Number);
    const lastVisit = zonedToUtc(new Date(Date.UTC(y, m - 1 - 12, d)).toISOString().slice(0, 10), 12 * 60, 'Asia/Karachi');
    await db.appointment.create({ data: { organizationId: org.orgId, branchId: org.branchId, number: 99101, clientId: c2.id, patientId: old.id, appointmentTypeId: f.typeId, startsAt: lastVisit, endsAt: new Date(lastVisit.getTime() + 20 * 60_000), status: 'COMPLETED' } });
    await auto.scanTimed();
    const recall = await db.automationRun.findFirstOrThrow({ where: { automationId: lapsed.body.id, sourceId: old.id } });
    expect(recall.status).toBe('WAITING');
    const msg = await db.outboundMessage.findFirstOrThrow({ where: { organizationId: org.orgId, subject: 'Check-up for Lali' } });
    expect(msg.body).toMatch(/^12 months since/);
    // The client books in the meantime: the follow-up is not sent.
    const soon = new Date(Date.now() + 5 * 86_400_000);
    await db.appointment.create({ data: { organizationId: org.orgId, branchId: org.branchId, number: 99102, clientId: c2.id, patientId: old.id, appointmentTypeId: f.typeId, startsAt: soon, endsAt: new Date(soon.getTime() + 20 * 60_000), status: 'BOOKED' } });
    await db.automationRun.update({ where: { id: recall.id }, data: { runAt: new Date(Date.now() - 1000) } });
    await auto.runDue();
    const ended = await db.automationRun.findUniqueOrThrow({ where: { id: recall.id } });
    expect(ended.status).toBe('DONE');
    expect((ended.log as any[]).pop()).toMatchObject({ type: 'CHECK', note: 'The client has booked — no need to continue' });
    expect(await db.outboundMessage.count({ where: { organizationId: org.orgId, subject: 'Reminder for Lali' } })).toBe(0);
  });

  it('even more: check-in token, first visit, once per client per N days, estimate follow-up, duplicate and headline numbers', async () => {
    const org = await registerOrg();
    const f = await schedulingFixture(org);
    const auto = await svc(AutomationsService);
    const db = prisma();
    const client = await makeClient(org.owner, { email: 'tokens@example.com' });
    const pet = await makePatient(org.owner, client.id, { name: 'Moti', sex: 'FEMALE_SPAYED' });

    // Checked in → token number; not again for the same client within 30 days.
    const token = await org.owner.post('/automations', { name: 'Token', trigger: 'APPOINTMENT_CHECKED_IN', cooldownDays: 30, conditions: [{ field: 'patientSex', op: 'IS', values: ['FEMALE'] }], steps: [{ type: 'SEND_MESSAGE', channel: 'EMAIL', subject: 'Token {{tokenNumber}}', body: '{{petName}} has token {{tokenNumber}}' }] });
    expect(token.status).toBe(201);
    // First visit only.
    const firstOnly = await org.owner.post('/automations', { name: 'Welcome after first visit', trigger: 'APPOINTMENT_COMPLETED', conditions: [{ field: 'firstVisit', op: 'IS', values: ['FIRST'] }], steps: [{ type: 'SEND_MESSAGE', channel: 'EMAIL', subject: 'Welcome {{clientName}}', body: 'Thanks for your first visit' }] });
    const w1 = await org.owner.post('/front-desk/walk-in', { branchId: org.branchId, clientId: client.id, patientId: pet.id, appointmentTypeId: f.typeId });
    expect(w1.status).toBe(201);
    const tokenMsg = await db.outboundMessage.findFirstOrThrow({ where: { organizationId: org.orgId, subject: { startsWith: 'Token ' } } });
    expect(tokenMsg.body).toBe(`Moti has token ${w1.body.tokenNumber}`);
    await org.owner.post(`/appointments/${w1.body.id}/status`, { action: 'complete' });
    const w2 = await org.owner.post('/front-desk/walk-in', { branchId: org.branchId, clientId: client.id, patientId: pet.id, appointmentTypeId: f.typeId });
    await org.owner.post(`/appointments/${w2.body.id}/status`, { action: 'complete' });
    expect(await db.automationRun.count({ where: { automationId: token.body.id } })).toBe(1);
    expect(await db.automationRun.count({ where: { automationId: firstOnly.body.id } })).toBe(1);

    // Estimate given → wait 3 days → only if still not answered → follow-up.
    const est = await org.owner.post('/automations', {
      name: 'Estimate follow-up',
      trigger: 'ESTIMATE_SENT',
      steps: [{ type: 'WAIT', amount: 3, unit: 'DAYS' }, { type: 'CHECK', check: 'ESTIMATE_OPEN' }, { type: 'SEND_MESSAGE', channel: 'EMAIL', subject: 'About {{estimateNumber}}', body: '{{estimateTotal}} until {{validUntil}}' }],
    });
    expect(est.status).toBe(201);
    const mkEstimate = async () => {
      const e = await org.owner.post('/estimates', { clientId: client.id, patientId: pet.id, lines: [{ kind: 'CUSTOM', description: 'Dental scale and polish', quantity: 1, unitPriceMinor: 3500000 }] });
      expect(e.status).toBe(201);
      expect((await org.owner.post(`/estimates/${e.body.id}/status`, { status: 'SENT' })).status).toBeLessThan(300);
      return e.body.id as string;
    };
    const open = await mkEstimate();
    const answered = await mkEstimate();
    await org.owner.post(`/estimates/${answered}/status`, { status: 'ACCEPTED' });
    await db.automationRun.updateMany({ where: { automationId: est.body.id }, data: { runAt: new Date(Date.now() - 1000) } });
    await auto.runDue();
    const estRuns = await db.automationRun.findMany({ where: { automationId: est.body.id } });
    expect(estRuns.find((r) => r.sourceId === open)).toMatchObject({ status: 'DONE' });
    expect(estRuns.find((r) => r.sourceId === answered)?.status).toBe('STOPPED');
    const follow = await db.outboundMessage.findFirstOrThrow({ where: { organizationId: org.orgId, subject: { startsWith: 'About EST-' } } });
    expect(follow.body).toMatch(/35,000/);

    // Duplicate (switched off) and the headline numbers.
    const copy = await org.owner.post(`/automations/${token.body.id}/duplicate`);
    expect(copy.status).toBe(201);
    expect(copy.body).toMatchObject({ name: 'Token (copy)', isActive: false, cooldownDays: 30 });
    const stats = (await org.owner.get('/automations/stats')).body;
    expect(stats).toMatchObject({ total: 4, active: 3 });
    expect(stats.runs).toBeGreaterThanOrEqual(4);
    // Sending hours must make sense.
    expect((await org.owner.post('/automations', { name: 'x', trigger: 'CLIENT_REGISTERED', sendFromHour: 20, sendToHour: 9, steps: [{ type: 'SEND_MESSAGE', body: 'x' }] })).status).toBe(400);
  });
});
