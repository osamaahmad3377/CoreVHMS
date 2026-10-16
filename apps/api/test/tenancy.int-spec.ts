import { closeApp, makeClient, makePatient, registerOrg, speciesId } from './helpers';

describe('Multi-tenant isolation', () => {
  afterAll(closeApp);

  it('never exposes or modifies another organization’s data', async () => {
    const a = await registerOrg('Alpha Vets');
    const b = await registerOrg('Beta Vets');
    const clientA = await makeClient(a.owner, { lastName: 'Isolated' });
    const patientA = await makePatient(a.owner, clientA.id, { name: 'SecretPet' });

    // reads
    expect((await b.owner.get(`/clients/${clientA.id}`)).status).toBe(404);
    expect((await b.owner.get(`/patients/${patientA.id}`)).status).toBe(404);
    expect((await b.owner.get(`/patients/${patientA.id}/timeline`)).status).toBe(404);
    const listB = (await b.owner.get('/clients?q=Isolated')).body;
    expect(listB.meta.total).toBe(0);
    const search = (await b.owner.get('/search?q=SecretPet')).body;
    expect(search.results).toHaveLength(0);

    // writes
    expect((await b.owner.patch(`/clients/${clientA.id}`, { notes: 'hijack' })).status).toBe(404);
    expect((await b.owner.post(`/patients/${patientA.id}/weights`, { weightKg: 10 })).status).toBe(404);
    expect((await b.owner.post(`/clients/${clientA.id}/notes`, { body: 'x' })).status).toBe(404);

    // cross-tenant foreign keys are rejected
    const bClient = await makeClient(b.owner);
    const aDog = await speciesId(a.owner);
    const res = await b.owner.post('/patients', { ownerId: bClient.id, name: 'X', speciesId: aDog });
    expect(res.status).toBe(422);
    const res2 = await b.owner.post('/patients', { ownerId: clientA.id, name: 'X', speciesId: await speciesId(b.owner) });
    expect(res2.status).toBe(422);
    const res3 = await b.owner.post('/clients/merge', { survivorId: bClient.id, mergedId: clientA.id, reason: 'x' });
    expect(res3.status).toBe(404);

    // audit logs are scoped
    const auditB = (await b.owner.get(`/audit-events?entityId=${clientA.id}`)).body;
    expect(auditB.meta.total).toBe(0);
  });

  it('isolates counters: each organization numbers its own clients from 1', async () => {
    const a = await registerOrg();
    const b = await registerOrg();
    const ca = await makeClient(a.owner);
    const cb = await makeClient(b.owner);
    expect(ca.number).toBe(1);
    expect(cb.number).toBe(1);
  });
});
