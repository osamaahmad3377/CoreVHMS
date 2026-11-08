import { booking, closeApp, futureDate, karachi, makeClient, makePatient, prisma, registerOrg, schedulingFixture, staff } from './helpers';

// Prices are arbitrary test values.
describe('Visit fees from the appointment types chosen in the consultation', () => {
  afterAll(closeApp);

  async function setup() {
    const org = await registerOrg();
    const vet = await staff(org, 'veterinarian', { isClinician: true });
    const patient = await makePatient(org.owner, (await makeClient(org.owner)).id);
    const consult = (await org.owner.post('/services', { code: 'T-CONS', name: 'Test consultation', category: 'CONSULTATION', priceMinor: 200000 })).body;
    const scale = (await org.owner.post('/services', { code: 'T-SP', name: 'Test scale & polish', category: 'DENTAL', priceMinor: 1200000 })).body;
    const types = (await org.owner.get('/appointment-types?all=true')).body as any[];
    const sp = types.find((t) => t.dentalProcedureCode === 'SP');
    await org.owner.patch(`/appointment-types/${sp.id}`, { serviceId: scale.id });
    const ear = (await org.owner.post('/appointment-types', { name: 'Test ear', category: 'CONSULTATION', durationMinutes: 15, serviceId: consult.id })).body;
    const skin = (await org.owner.post('/appointment-types', { name: 'Test skin', category: 'CONSULTATION', durationMinutes: 15, serviceId: consult.id })).body;
    return { org, vet, patient, sp, ear, skin };
  }
  const fees = async (org: any, encId: string) => ((await org.owner.get(`/charges?encounterId=${encId}`)).body.data as any[]).filter((c) => c.status !== 'WAIVED').map((c) => [c.description, c.unitPriceMinor]).sort();

  it('charges each chosen type once per price for a walk-in, when the consultation is finished', async () => {
    const s = await setup();
    const enc = (await s.vet.client.post('/encounters', { patientId: s.patient.id, chiefComplaint: '' })).body;
    const put = await s.vet.client.call('put', `/encounters/${enc.id}/visit-types`, { appointmentTypeIds: [s.sp.id, s.ear.id, s.skin.id] });
    expect(put.body).toEqual({ appointmentTypeIds: [s.sp.id, s.ear.id, s.skin.id] });
    expect((await s.vet.client.get(`/encounters/${enc.id}`)).body.visitTypes.map((v: any) => v.appointmentTypeId)).toEqual([s.sp.id, s.ear.id, s.skin.id]);
    // Changed mind: skin off.
    await s.vet.client.call('put', `/encounters/${enc.id}/visit-types`, { appointmentTypeIds: [s.sp.id, s.ear.id] });
    expect(await fees(s.org, enc.id)).toEqual([]);
    await s.vet.client.post(`/encounters/${enc.id}/complete`);
    expect(await fees(s.org, enc.id)).toEqual([['Test consultation', 200000], ['Test scale & polish', 1200000]]);
    // Closed: no more changes.
    expect((await s.vet.client.call('put', `/encounters/${enc.id}/visit-types`, { appointmentTypeIds: [] })).body.error.code).toBe('ENCOUNTER_CLOSED');
  });

  it('does not charge a chosen type again when it was charged on the dental chart', async () => {
    const s = await setup();
    const enc = (await s.vet.client.post('/encounters', { patientId: s.patient.id, chiefComplaint: '' })).body;
    await s.vet.client.call('put', `/encounters/${enc.id}/visit-types`, { appointmentTypeIds: [s.sp.id] });
    const chart = (await s.vet.client.post('/dental/charts', { patientId: s.patient.id, dentition: 'CANINE', encounterId: enc.id })).body;
    await s.vet.client.post(`/dental/charts/${chart.id}/procedures`, { code: 'SP' });
    await s.vet.client.post(`/encounters/${enc.id}/complete`);
    // Only the dental chart's charge: the chosen type's price is not added again.
    expect(await fees(s.org, enc.id)).toEqual([[`Test scale & polish (${chart.chartNo})`, 1200000]]);
  });

  it('charges a dental procedure with no usual price the price given for the visit, per tooth', async () => {
    const s = await setup();
    const enc = (await s.vet.client.post('/encounters', { patientId: s.patient.id, chiefComplaint: '' })).body;
    const chart = (await s.vet.client.post('/dental/charts', { patientId: s.patient.id, dentition: 'CANINE', encounterId: enc.id })).body;
    // Root canal has no usual price here.
    expect((await s.vet.client.post(`/dental/charts/${chart.id}/procedures`, { code: 'RCT', teeth: ['104', '204'], priceMinor: 900000 })).status).toBe(200);
    expect((await s.vet.client.post(`/dental/charts/${chart.id}/procedures`, { code: 'RP', teeth: ['108'] })).status).toBe(200);
    expect(await fees(s.org, enc.id)).toEqual([
      [`Root canal treatment — tooth 104 (${chart.chartNo})`, 900000],
      [`Root canal treatment — tooth 204 (${chart.chartNo})`, 900000],
    ]);
  });

  it('signs the consultation’s dental chart when the consultation is finished, and removes an empty draft', async () => {
    const s = await setup();
    const enc = (await s.vet.client.post('/encounters', { patientId: s.patient.id, chiefComplaint: '' })).body;
    const chart = (await s.vet.client.post('/dental/charts', { patientId: s.patient.id, dentition: 'CANINE', encounterId: enc.id })).body;
    await s.vet.client.call('put', `/dental/charts/${chart.id}/teeth`, { teeth: [{ tooth: '108', state: 'PRESENT', findings: ['FX_UCF'] }] });
    expect((await s.vet.client.post(`/encounters/${enc.id}/complete`)).status).toBe(200);
    const signed = (await s.vet.client.get(`/dental/charts/${chart.id}`)).body;
    expect(signed).toMatchObject({ status: 'SIGNED', integrity: 'VERIFIED' });
    const audit = await prisma().auditEvent.findFirstOrThrow({ where: { action: 'dental.signed', entityId: s.patient.id } });
    expect(audit.summary).toContain('signed with the consultation');

    // Nothing recorded: the empty draft goes.
    const enc2 = (await s.vet.client.post('/encounters', { patientId: s.patient.id, chiefComplaint: '' })).body;
    const empty = (await s.vet.client.post('/dental/charts', { patientId: s.patient.id, dentition: 'CANINE', encounterId: enc2.id })).body;
    await s.vet.client.post(`/encounters/${enc2.id}/complete`);
    expect((await s.vet.client.get(`/dental/charts/${empty.id}`)).status).toBe(404);
  });

  it('still charges the booked type when nothing was chosen', async () => {
    const s = await setup();
    const f = await schedulingFixture(s.org);
    await s.org.owner.patch(`/appointment-types/${f.typeId}`, { serviceId: (await s.org.owner.get('/services')).body.find((x: any) => x.code === 'T-CONS').id });
    const a = await s.org.owner.post('/appointments', booking(s.org, f, karachi(futureDate(3), '10:00')));
    await f.vet.client.post(`/appointments/${a.body.id}/status`, { action: 'start' });
    const enc = (await s.org.owner.get(`/encounters?status=OPEN&patientId=${f.patient.id}`)).body.data[0];
    await f.vet.client.post(`/encounters/${enc.id}/complete`);
    expect(await fees(s.org, enc.id)).toEqual([['Test consultation', 200000]]);
  });
});
