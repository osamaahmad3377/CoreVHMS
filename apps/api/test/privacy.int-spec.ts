import { MessagesService } from '../src/modules/comms/messages.service';
import { closeApp, getApp, inDays, makeClient, makePatient, prisma, registerOrg, staff } from './helpers';

describe('Client data export and anonymisation', () => {
  afterAll(closeApp);

  it('exports everything held about a client, from every module, and audits it', async () => {
    const org = await registerOrg();
    const client = await makeClient(org.owner, { email: `export-${Date.now()}@example.test` });
    const pet = await makePatient(org.owner, client.id, { name: 'Bruno' });
    await org.owner.post('/messages', { clientId: client.id, channel: 'EMAIL', body: 'Hello from the clinic' });
    await org.owner.post('/invoices', { clientId: client.id, lines: [{ kind: 'CUSTOM', description: 'Consult', quantity: 1, unitPriceMinor: 1000 }], issue: true });
    await org.owner.post('/care-items', { patientId: pet.id, kind: 'VACCINATION', title: 'Rabies', dueDate: inDays(30) });

    const res = await org.owner.get(`/clients/${client.id}/data-export`);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="client-\d+-export-/);
    expect(res.headers['cache-control']).toBe('no-store');
    const data = JSON.parse(res.text);
    expect(data).toMatchObject({ format: 'nextcore-vcms/client-export', client: { id: client.id }, patients: [{ id: pet.id, name: 'Bruno' }] });
    for (const k of ['clinical', 'prescriptions', 'diagnostics', 'preventiveCare', 'billing', 'communications', 'hospital', 'livestock', 'boardingAndGrooming', 'insuranceAndReferrals', 'appointments']) expect(data).toHaveProperty(k);
    expect(data.billing.invoices).toHaveLength(1);
    expect(data.communications.messagesSent[0].body).toBe('Hello from the clinic');
    expect(data.preventiveCare).toHaveLength(1);
    const audit = await prisma().auditEvent.findFirst({ where: { organizationId: org.orgId, action: 'client.data_exported', entityId: client.id } });
    expect(audit).toBeTruthy();

    // Only roles with the privacy permission can export.
    const rec = await staff(org, 'receptionist');
    expect((await rec.client.get(`/clients/${client.id}/data-export`)).status).toBe(403);
    // Other clinics cannot export this client.
    const other = await registerOrg();
    expect((await other.owner.get(`/clients/${client.id}/data-export`)).status).toBe(404);
  });

  it('anonymises a client on request, keeping clinical and financial records', async () => {
    const org = await registerOrg();
    const email = `anon-${Date.now()}@example.test`;
    const client = await makeClient(org.owner, { email, firstName: 'Ayesha', nationalId: '35202-1234567-1', notes: 'Prefers mornings' });
    const pet = await makePatient(org.owner, client.id, { name: 'Moti' });
    expect((await org.owner.post(`/clients/${client.id}/addresses`, { line1: '12 Mall Road', city: 'Lahore', isPrimary: true })).status).toBe(201);
    expect(await prisma().address.count({ where: { clientId: client.id } })).toBe(1);
    await org.owner.post('/messages', { clientId: client.id, channel: 'EMAIL', body: 'Your pet is due' });
    await (await getApp()).get(MessagesService).dispatch();
    // Portal correspondence (written directly: the portal is switched off in this suite).
    const fromClient = await prisma().clientMessage.create({ data: { organizationId: org.orgId, clientId: client.id, direction: 'INBOUND', subject: 'Moti limping', body: 'Call me on 0300 1112223', authorName: 'Ayesha Khan' } });
    const toClient = await prisma().clientMessage.create({ data: { organizationId: org.orgId, clientId: client.id, direction: 'OUTBOUND', body: 'Dear Ayesha, please bring Moti in', authorName: 'Dr Vet' } });
    await expect(prisma().clientMessage.update({ where: { id: fromClient.id }, data: { body: 'rewritten' } })).rejects.toThrow(/cannot be edited/);
    const inv = (await org.owner.post('/invoices', { clientId: client.id, patientId: pet.id, lines: [{ kind: 'CUSTOM', description: 'Consult', quantity: 1, unitPriceMinor: 5000 }], issue: true })).body;

    // An unpaid balance must be settled first.
    expect((await org.owner.post(`/clients/${client.id}/anonymise`, { reason: 'Owner requested erasure' })).body.error.code).toBe('BALANCE_NOT_SETTLED');
    await org.owner.post('/payments', { clientId: client.id, amountMinor: inv.totalMinor, method: 'CARD', allocations: [{ invoiceId: inv.id, amountMinor: inv.totalMinor }] });

    const rec = await staff(org, 'receptionist');
    expect((await rec.client.post(`/clients/${client.id}/anonymise`, { reason: 'x requested' })).status).toBe(403);

    const res = await org.owner.post(`/clients/${client.id}/anonymise`, { reason: 'Owner requested erasure by email' });
    expect(res.status).toBe(200);
    const after = (await org.owner.get(`/clients/${client.id}`)).body;
    expect(after).toMatchObject({ displayName: expect.stringMatching(/^Anonymised client C-/), firstName: null, email: null, mobilePhone: null, nationalId: null, notes: null, status: 'ARCHIVED' });
    expect(await prisma().address.count({ where: { clientId: client.id } })).toBe(0);
    const msg = await prisma().outboundMessage.findFirst({ where: { clientId: client.id } });
    expect(msg).toMatchObject({ recipient: 'removed', body: '[removed on anonymisation]' });
    expect(await prisma().clientMessage.findUnique({ where: { id: fromClient.id } })).toMatchObject({ subject: null, body: '[removed on anonymisation]', authorName: 'Anonymised client', direction: 'INBOUND' });
    expect(await prisma().clientMessage.findUnique({ where: { id: toClient.id } })).toMatchObject({ body: '[removed on anonymisation]', authorName: 'Dr Vet' });
    // The correspondence record stays locked against any other change or deletion.
    await expect(prisma().clientMessage.update({ where: { id: toClient.id }, data: { body: 'rewritten' } })).rejects.toThrow(/cannot be edited/);
    await expect(prisma().clientMessage.delete({ where: { id: toClient.id } })).rejects.toThrow(/cannot be deleted/);
    // Records the clinic must keep are still there and linked.
    expect((await org.owner.get(`/invoices/${inv.id}`)).body.status).toBe('PAID');
    expect((await org.owner.get(`/patients/${pet.id}`)).body.name).toBe('Moti');
    // The client can no longer be found by their old details, and it cannot be done twice.
    expect((await org.owner.get(`/clients?q=${encodeURIComponent(email)}`)).body.data).toHaveLength(0);
    expect((await org.owner.post(`/clients/${client.id}/anonymise`, { reason: 'again please' })).body.error.code).toBe('ALREADY_ANONYMISED');
    const audit = await prisma().auditEvent.findFirst({ where: { organizationId: org.orgId, action: 'client.anonymised', entityId: client.id } });
    expect(audit?.summary).not.toContain('Ayesha');
  });

  it('blocks anonymisation while an animal is boarding or in hospital', async () => {
    const org = await registerOrg();
    const client = await makeClient(org.owner);
    const pet = await makePatient(org.owner, client.id);
    const unit = (await org.owner.post('/boarding/units', { branchId: org.branchId, name: 'K1' })).body;
    const stay = (await org.owner.post('/boarding/stays', { patientId: pet.id, unitId: unit.id, startDate: inDays(0), endDate: inDays(2) })).body;
    expect((await org.owner.post(`/boarding/stays/${stay.id}/check-in`, {})).status).toBe(200);
    expect((await org.owner.post(`/clients/${client.id}/anonymise`, { reason: 'Owner requested erasure' })).body.error.code).toBe('BOARDING');
  });
});
