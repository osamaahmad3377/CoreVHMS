import { closeApp, makeClient, makePatient, registerOrg, staff } from './helpers';

describe('Weight and temperature units', () => {
  afterAll(closeApp);

  it('a clinic that chooses °F and lb gets them everywhere, while values stay stored in °C and kg', async () => {
    const org = await registerOrg();
    // Default: kg and °C.
    expect((await org.owner.get('/auth/session')).body.organization.units).toEqual({ weight: 'kg', temperature: 'C' });
    expect((await org.owner.patch('/organization', { weightUnit: 'lb', temperatureUnit: 'F' })).status).toBe(200);
    expect((await org.owner.get('/auth/session')).body.organization.units).toEqual({ weight: 'lb', temperature: 'F' });
    expect((await org.owner.patch('/organization', { weightUnit: 'stone' })).status).toBe(400);

    const vet = await staff(org, 'veterinarian', { isClinician: true });
    const client = await makeClient(org.owner);
    const patient = await makePatient(org.owner, client.id);
    const e = (await vet.client.post('/encounters', { patientId: patient.id, chiefComplaint: 'Check' })).body;
    // 101.5 °F typed in the app is sent as 38.61 °C and kept to two decimals, so it shows as 101.5 °F again.
    const v = await vet.client.post(`/encounters/${e.id}/vitals`, { temperatureC: 38.61, weightKg: 18.144 });
    expect(v.status).toBe(201);
    expect(Number(v.body.temperatureC)).toBe(38.61);
    await vet.client.post(`/patients/${patient.id}/weights`, { weightKg: 18.144 });

    // Text the system writes follows the clinic's units.
    const t = (await vet.client.get(`/patients/${patient.id}/timeline`)).body.events;
    expect(t.find((x: any) => x.kind === 'vitals').detail).toContain('T 101.5 °F');
    expect(t.find((x: any) => x.kind === 'weight').title).toBe('Weight 40.0 lb');
  });
});
