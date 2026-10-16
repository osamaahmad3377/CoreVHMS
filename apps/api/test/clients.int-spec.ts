import { closeApp, makeClient, makePatient, registerOrg } from './helpers';

describe('Clients', () => {
  afterAll(closeApp);

  it('validates input and requires a way to contact the client', async () => {
    const org = await registerOrg();
    const res = await org.owner.post('/clients', { type: 'INDIVIDUAL', lastName: 'Ali' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const bad = await org.owner.post('/clients', { lastName: 'Ali', email: 'not-an-email' });
    expect(bad.status).toBe(400);
  });

  it('creates clients with sequential numbers, primary address and audit trail', async () => {
    const org = await registerOrg();
    const c = await makeClient(org.owner, {
      lastName: 'Hussain',
      firstName: 'Bilal',
      address: { line1: '12 Mall Road', city: 'Lahore', country: 'PK' },
    });
    expect(c.clientNo).toMatch(/^C-\d{6}$/);
    expect(c.displayName).toBe('Hussain, Bilal');
    const detail = (await org.owner.get(`/clients/${c.id}`)).body;
    expect(detail.addresses[0]).toMatchObject({ line1: '12 Mall Road', isPrimary: true });
    const audit = (await org.owner.get(`/audit-events?entityId=${c.id}`)).body.data;
    expect(audit[0].action).toBe('client.created');
  });

  it('records field-level changes and consent timestamps on update', async () => {
    const org = await registerOrg();
    const c = await makeClient(org.owner);
    const res = await org.owner.patch(`/clients/${c.id}`, { marketingConsent: true, email: 'new@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.consentUpdatedAt).toBeTruthy();
    const audit = (await org.owner.get(`/audit-events?entityId=${c.id}&action=client.updated`)).body.data;
    expect(audit[0].changes.email).toEqual({ from: null, to: 'new@example.com' });
  });

  it('finds duplicates by phone (local vs international format), email and similar name', async () => {
    const org = await registerOrg();
    const c = await makeClient(org.owner, { firstName: 'Fatima', lastName: 'Siddiqui', mobilePhone: '0321 4567890', email: 'fatima@example.com' });
    const dup = (await org.owner.post('/clients/duplicates', { mobilePhone: '+92 321 4567890' })).body;
    expect(dup[0]).toMatchObject({ id: c.id, reasons: ['Same mobile number'] });
    const byName = (await org.owner.post('/clients/duplicates', { firstName: 'Fatima', lastName: 'Sidiqui' })).body;
    expect(byName.map((d: any) => d.id)).toContain(c.id);
    const byEmail = (await org.owner.post('/clients/duplicates', { email: 'FATIMA@example.com' })).body;
    expect(byEmail[0].reasons).toContain('Same email');
  });

  it('searches by name, number and phone digits', async () => {
    const org = await registerOrg();
    const c = await makeClient(org.owner, { lastName: 'Qureshi', mobilePhone: '0333 7654321' });
    for (const q of ['qures', c.clientNo, '7654321']) {
      const res = (await org.owner.get(`/clients?q=${encodeURIComponent(q)}`)).body;
      expect(res.data.map((x: any) => x.id)).toContain(c.id);
    }
  });

  it('merges duplicates, moving patients and contacts, and prevents double merges', async () => {
    const org = await registerOrg();
    const keep = await makeClient(org.owner, { lastName: 'Keep' });
    const dupe = await makeClient(org.owner, { lastName: 'Dupe' });
    const pet = await makePatient(org.owner, dupe.id, { name: 'Moti' });
    await org.owner.post(`/clients/${dupe.id}/contacts`, { role: 'EMERGENCY', name: 'Neighbour', phone: '0300 1112223' });
    const res = await org.owner.post('/clients/merge', { survivorId: keep.id, mergedId: dupe.id, reason: 'Registered twice' });
    expect(res.status).toBe(200);
    expect(res.body.moved.patientOwnerships).toBe(1);
    const k = (await org.owner.get(`/clients/${keep.id}`)).body;
    expect(k.patients.map((p: any) => p.id)).toContain(pet.id);
    expect(k.contacts).toHaveLength(1);
    const d = (await org.owner.get(`/clients/${dupe.id}`)).body;
    expect(d.status).toBe('MERGED');
    expect(d.mergedInto.id).toBe(keep.id);
    expect((await org.owner.post('/clients/merge', { survivorId: keep.id, mergedId: dupe.id, reason: 'again' })).status).toBe(422);
    expect((await org.owner.patch(`/clients/${dupe.id}`, { notes: 'x' })).status).toBe(422);
  });

  it('archives and restores with a reason; archived clients are hidden from the default list', async () => {
    const org = await registerOrg();
    const c = await makeClient(org.owner, { lastName: 'Archivable' });
    expect((await org.owner.post(`/clients/${c.id}/archive`, {})).status).toBe(400);
    expect((await org.owner.post(`/clients/${c.id}/archive`, { reason: 'Moved city' })).status).toBe(200);
    expect((await org.owner.get('/clients?q=Archivable')).body.meta.total).toBe(0);
    expect((await org.owner.get('/clients?q=Archivable&status=ARCHIVED')).body.meta.total).toBe(1);
    expect((await org.owner.post(`/clients/${c.id}/restore`)).status).toBe(200);
  });

  it('exports CSV with formula-injection protection and logs the export', async () => {
    const org = await registerOrg();
    await makeClient(org.owner, { lastName: '=HYPERLINK("http://evil")', firstName: 'Mallory' });
    const res = await org.owner.get('/clients/export.csv');
    expect(res.status).toBe(200);
    expect(res.text).toContain(`"'=HYPERLINK(""http://evil""), Mallory"`);
    const audit = (await org.owner.get('/audit-events?action=client.exported')).body.data;
    expect(audit).toHaveLength(1);
  });

  it('manages contacts, addresses (single primary) and notes', async () => {
    const org = await registerOrg();
    const c = await makeClient(org.owner);
    const a1 = (await org.owner.post(`/clients/${c.id}/addresses`, { line1: 'Farm road', country: 'PK' })).body;
    expect(a1.isPrimary).toBe(true);
    const a2 = (await org.owner.post(`/clients/${c.id}/addresses`, { line1: 'City flat', country: 'PK', isPrimary: true })).body;
    const detail = (await org.owner.get(`/clients/${c.id}`)).body;
    expect(detail.addresses.filter((a: any) => a.isPrimary).map((a: any) => a.id)).toEqual([a2.id]);
    expect((await org.owner.del(`/clients/${c.id}/addresses/${a2.id}`)).status).toBe(204);
    const after = (await org.owner.get(`/clients/${c.id}`)).body;
    expect(after.addresses[0]).toMatchObject({ id: a1.id, isPrimary: true });
    const note = await org.owner.post(`/clients/${c.id}/notes`, { body: 'Prefers morning calls', isPinned: true });
    expect(note.body.authorName).toBe('Olivia Owner');
  });
});
