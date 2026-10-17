import { closeApp, makeClient, makePatient, registerOrg, speciesId, staff } from './helpers';

describe('Clinical activity report', () => {
  afterAll(closeApp);

  it('counts consultations, diagnoses, hospital stays and new patients for the period, per clinic', async () => {
    const org = await registerOrg();
    const vet = await staff(org, 'veterinarian', { isClinician: true });
    const client = await makeClient(org.owner);
    const dog = await makePatient(org.owner, client.id, { name: 'Report Dog' });
    const cat = await makePatient(org.owner, client.id, { name: 'Report Cat', speciesId: await speciesId(org.owner, 'Cat') });

    const e1 = (await vet.client.post('/encounters', { patientId: dog.id, chiefComplaint: 'Ear' })).body;
    const e2 = (await vet.client.post('/encounters', { patientId: cat.id, chiefComplaint: 'Ear' })).body;
    const e3 = (await vet.client.post('/encounters', { patientId: dog.id, chiefComplaint: 'Recheck' })).body;
    // The same diagnosis typed with different capitalisation counts as one.
    expect((await vet.client.post(`/encounters/${e1.id}/diagnoses`, { term: 'Otitis externa', type: 'CONFIRMED' })).status).toBe(201);
    expect((await vet.client.post(`/encounters/${e2.id}/diagnoses`, { term: 'otitis externa', type: 'PROVISIONAL' })).status).toBe(201);
    expect((await vet.client.post(`/encounters/${e3.id}/diagnoses`, { term: 'Dermatitis', type: 'PROVISIONAL' })).status).toBe(201);
    expect((await vet.client.post(`/encounters/${e1.id}/complete`)).status).toBe(200);

    const ward = (await org.owner.post('/wards', { branchId: org.branchId, name: 'Report ward', type: 'GENERAL' })).body;
    const cage = (await org.owner.post('/cages', { wardId: ward.id, name: 'R1' })).body;
    const adm = await vet.client.post('/admissions', { patientId: cat.id, wardId: ward.id, cageId: cage.id, reason: 'Observation', responsibleClinicianId: vet.membershipId });
    expect(adm.status).toBe(201);
    const dis = await vet.client.post(`/admissions/${adm.body.id}/discharge`, { outcome: 'DISCHARGED_HOME', dischargeSummary: 'Recovered well.', homeCareInstructions: 'Rest.' });
    expect(dis.status).toBe(200);

    // A different clinic's activity is never counted.
    const other = await registerOrg();
    const oc = await makeClient(other.owner);
    const op = await makePatient(other.owner, oc.id);
    await other.owner.post('/encounters', { patientId: op.id, chiefComplaint: 'Other clinic' });

    const from = new Date(Date.now() - 86_400_000).toISOString();
    const to = new Date(Date.now() + 86_400_000).toISOString();
    const res = await org.owner.get(`/reports/clinical-activity?from=${from}&to=${to}`);
    expect(res.status).toBe(200);
    const d = res.body;
    expect(d.consultations).toMatchObject({ total: 3, completed: 1, byClinician: [{ clinician: 'Test veterinarian', count: 3 }] });
    expect(d.consultations.bySpecies).toEqual([{ species: 'Dog', count: 2 }, { species: 'Cat', count: 1 }]);
    expect(d.diagnoses).toEqual([{ diagnosis: 'Otitis externa', count: 2, confirmed: 1 }, { diagnosis: 'Dermatitis', count: 1, confirmed: 0 }]);
    expect(d.hospital).toMatchObject({ admitted: 1, discharged: 1, outcomes: [{ outcome: 'DISCHARGED_HOME', count: 1 }] });
    expect(d.hospital.averageStayDays).toBeGreaterThanOrEqual(0);
    expect(d.surgery).toEqual({ completed: 0, withComplications: 0, byProcedure: [] });
    expect(d.newPatients).toEqual({ total: 2, bySpecies: [{ species: 'Cat', count: 1 }, { species: 'Dog', count: 1 }] });

    // Outside the period: nothing.
    const past = await org.owner.get(`/reports/clinical-activity?from=2020-01-01&to=2020-02-01`);
    expect(past.body.consultations.total).toBe(0);

    // CSV: one row per figure, formula-safe, and the download is audited.
    const csv = await org.owner.get(`/reports/clinical-activity?from=${from}&to=${to}&format=csv`);
    expect(csv.status).toBe(200);
    expect(csv.text.split('\r\n')[0]).toBe('\uFEFFSection,Item,Count,Detail');
    expect(csv.text).toContain('Diagnoses (top 15),Otitis externa,2,1 confirmed');
    expect((await org.owner.get('/audit-events?action=report.exported')).body.data[0].summary).toMatch(/^clinical-activity /);

    // Reception has no report permission.
    const rec = await staff(org, 'receptionist');
    expect((await rec.client.get(`/reports/clinical-activity?from=${from}&to=${to}`)).status).toBe(403);
  });
});
