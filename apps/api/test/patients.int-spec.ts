import { closeApp, makeClient, makePatient, registerOrg, speciesId } from './helpers';

const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082',
  'hex',
);

describe('Patients', () => {
  afterAll(closeApp);

  it('registers a patient with identifiers and initial weight', async () => {
    const org = await registerOrg();
    const owner = await makeClient(org.owner);
    const p = await makePatient(org.owner, owner.id, {
      name: 'Sheru',
      identifiers: [{ type: 'MICROCHIP', value: '982 000 123 456 789' }],
      initialWeightKg: 24.5,
      dateOfBirth: '2021-03-01',
    });
    expect(p.patientNo).toBe('P-000001');
    const d = (await org.owner.get(`/patients/${p.id}`)).body;
    expect(d.identifiers[0].value).toBe('982000123456789');
    expect(d.latestWeightKg).toBe(24.5);
    expect(d.owner.id).toBe(owner.id);
  });

  it('rejects a microchip already registered to another patient', async () => {
    const org = await registerOrg();
    const owner = await makeClient(org.owner);
    await makePatient(org.owner, owner.id, { identifiers: [{ type: 'MICROCHIP', value: '111222333' }] });
    const res = await org.owner.post('/patients', {
      ownerId: owner.id, name: 'Copy', speciesId: await speciesId(org.owner), identifiers: [{ type: 'MICROCHIP', value: '111 222 333' }],
    });
    expect(res.status).toBe(409);
    const dup = (await org.owner.post('/patients/duplicates', { identifiers: ['111222333'] })).body;
    expect(dup).toHaveLength(1);
  });

  it('rejects a breed from a different species', async () => {
    const org = await registerOrg();
    const owner = await makeClient(org.owner);
    const cat = await speciesId(org.owner, 'Cat');
    const dogBreeds = (await org.owner.get(`/species/${await speciesId(org.owner, 'Dog')}/breeds`)).body;
    const res = await org.owner.post('/patients', { ownerId: owner.id, name: 'Mixed', speciesId: cat, breedId: dogBreeds[0].id });
    expect(res.status).toBe(422);
  });

  it('keeps latest weight in sync with the most recent measurement', async () => {
    const org = await registerOrg();
    const p = await makePatient(org.owner, (await makeClient(org.owner)).id);
    await org.owner.post(`/patients/${p.id}/weights`, { weightKg: 10, measuredAt: '2024-01-01T00:00:00Z' });
    await org.owner.post(`/patients/${p.id}/weights`, { weightKg: 12.25, measuredAt: '2025-01-01T00:00:00Z' });
    await org.owner.post(`/patients/${p.id}/weights`, { weightKg: 11, measuredAt: '2024-06-01T00:00:00Z' }); // back-dated
    const d = (await org.owner.get(`/patients/${p.id}`)).body;
    expect(d.latestWeightKg).toBe(12.25);
  });

  it('transfers ownership while preserving history', async () => {
    const org = await registerOrg();
    const a = await makeClient(org.owner, { lastName: 'First' });
    const b = await makeClient(org.owner, { lastName: 'Second' });
    const p = await makePatient(org.owner, a.id);
    expect((await org.owner.post(`/patients/${p.id}/transfer`, { newOwnerId: b.id, reason: 'Rehomed' })).status).toBe(200);
    const d = (await org.owner.get(`/patients/${p.id}`)).body;
    expect(d.owner.id).toBe(b.id);
    expect(d.ownershipHistory.some((o: any) => o.clientId === a.id && o.endedAt)).toBe(true);
    expect((await org.owner.post(`/patients/${p.id}/transfer`, { newOwnerId: b.id, reason: 'again' })).status).toBe(422);
  });

  it('records death and blocks it in the future', async () => {
    const org = await registerOrg();
    const p = await makePatient(org.owner, (await makeClient(org.owner)).id);
    const future = new Date(Date.now() + 86400_000).toISOString();
    expect((await org.owner.post(`/patients/${p.id}/deceased`, { deceasedAt: future })).status).toBe(422);
    const res = await org.owner.post(`/patients/${p.id}/deceased`, { deceasedAt: new Date().toISOString(), euthanasia: true });
    expect(res.body.status).toBe('DECEASED');
  });

  it('merges duplicate patients and moves their history', async () => {
    const org = await registerOrg();
    const owner = await makeClient(org.owner);
    const keep = await makePatient(org.owner, owner.id, { name: 'Tiger' });
    const dupe = await makePatient(org.owner, owner.id, { name: 'Tiger', identifiers: [{ type: 'MICROCHIP', value: '555' }] });
    await org.owner.post(`/patients/${dupe.id}/alerts`, { type: 'ALLERGY', severity: 'CRITICAL', title: 'Penicillin', substance: 'Penicillin' });
    const res = await org.owner.post('/patients/merge', { survivorId: keep.id, mergedId: dupe.id, reason: 'Duplicate' });
    expect(res.status).toBe(200);
    const d = (await org.owner.get(`/patients/${keep.id}`)).body;
    expect(d.identifiers.map((i: any) => i.value)).toContain('555');
    expect(d.alerts.map((a: any) => a.title)).toContain('Penicillin');
    expect(d.owner.id).toBe(owner.id);
    const m = (await org.owner.get(`/patients/${dupe.id}`)).body;
    expect(m.status).toBe('MERGED');
  });

  it('builds a unified timeline and logs record views', async () => {
    const org = await registerOrg();
    const p = await makePatient(org.owner, (await makeClient(org.owner)).id);
    await org.owner.post(`/patients/${p.id}/alerts`, { type: 'BEHAVIOUR', title: 'Bites when handled' });
    await org.owner.post(`/patients/${p.id}/weights`, { weightKg: 5 });
    const t = (await org.owner.get(`/patients/${p.id}/timeline`)).body;
    expect(t.events.map((e: any) => e.kind)).toEqual(expect.arrayContaining(['registration', 'alert', 'weight', 'ownership']));
    await org.owner.get(`/patients/${p.id}`);
    await new Promise((r) => setTimeout(r, 100));
    const views = (await org.owner.get(`/audit-events?entityId=${p.id}&action=patient.viewed`)).body;
    expect(views.meta.total).toBeGreaterThan(0);
  });

  it('uploads validated attachments, serves them only within the tenant and soft-deletes', async () => {
    const org = await registerOrg();
    const other = await registerOrg();
    const p = await makePatient(org.owner, (await makeClient(org.owner)).id);
    const up = await org.owner.upload('/attachments', { entityType: 'Patient', entityId: p.id, category: 'photo' }, { buffer: PNG, name: 'pet.png', type: 'image/png' });
    expect(up.status).toBe(201);
    const fake = await org.owner.upload('/attachments', { entityType: 'Patient', entityId: p.id }, { buffer: Buffer.from('not a png'), name: 'x.png', type: 'image/png' });
    expect(fake.status).toBe(422);
    const exe = await org.owner.upload('/attachments', { entityType: 'Patient', entityId: p.id }, { buffer: Buffer.from('MZ'), name: 'x.exe', type: 'application/octet-stream' });
    expect(exe.status).toBe(422);
    const dl = await org.owner.get(`/attachments/${up.body.id}/download`);
    expect(dl.status).toBe(200);
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
    expect((await other.owner.get(`/attachments/${up.body.id}/download`)).status).toBe(404);
    expect((await org.owner.post(`/patients/${p.id}/photo`, { attachmentId: up.body.id })).status).toBe(200);
    expect((await org.owner.del(`/attachments/${up.body.id}`)).status).toBe(204);
    expect((await org.owner.get(`/attachments/${up.body.id}/download`)).status).toBe(404);
  });
});
