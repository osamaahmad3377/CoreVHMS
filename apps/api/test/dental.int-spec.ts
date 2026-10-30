import { closeApp, makeClient, makePatient, prisma, registerOrg, speciesId, staff } from './helpers';

// Prices are arbitrary test values.
async function setup() {
  const org = await registerOrg();
  const vet = await staff(org, 'veterinarian', { isClinician: true });
  const nurse = await staff(org, 'nurse');
  const client = await makeClient(org.owner);
  const patient = await makePatient(org.owner, client.id);
  const sp = (await org.owner.post('/services', { code: 'DSP', name: 'Scale and polish', category: 'DENTAL', priceMinor: 800000 })).body;
  const xs = (await org.owner.post('/services', { code: 'DXS', name: 'Surgical extraction', category: 'DENTAL', priceMinor: 400000 })).body;
  const prices = await org.owner.call('put', '/dental/prices', { items: [{ code: 'SP', serviceId: sp.id }, { code: 'XS', serviceId: xs.id }] });
  expect(prices.status).toBe(200);
  expect(prices.body.find((p: any) => p.code === 'SP').service).toMatchObject({ id: sp.id });
  return { org, vet, nurse, client, patient, sp, xs };
}

describe('Dental charts', () => {
  afterAll(closeApp);

  it('records teeth, scores and procedures, charges procedures, and locks the chart when signed', async () => {
    const s = await setup();
    const created = await s.vet.client.post('/dental/charts', { patientId: s.patient.id, dentition: 'CANINE' });
    expect(created.status).toBe(201);
    const chart = created.body;
    expect(chart).toMatchObject({ status: 'DRAFT', dentition: 'CANINE', chartNo: expect.stringMatching(/^DEN-0+1$/), teeth: [], procedures: [] });

    // Teeth: findings and scores; a tooth that doesn't exist on a dog is refused.
    const teeth = await s.vet.client.call('put', `/dental/charts/${chart.id}/teeth`, {
      teeth: [
        { tooth: '108', findings: ['FX_CCF'], pdStage: 3, mobility: 2, probingMm: 6 },
        { tooth: '204', findings: ['TR'], trStage: 3 },
        { tooth: '309', state: 'MISSING' },
      ],
    });
    expect(teeth.status).toBe(200);
    expect(teeth.body.teeth.map((t: any) => t.tooth)).toEqual(['108', '204', '309']);
    expect(teeth.body.teeth[0]).toMatchObject({ findings: ['FX_CCF'], pdStage: 3, mobility: 2, probingMm: 6 });
    expect(teeth.body.worstToothStage).toBe(3);
    expect((await s.vet.client.call('put', `/dental/charts/${chart.id}/teeth`, { teeth: [{ tooth: '111' }] })).body.error.code).toBe('INVALID_TOOTH');
    expect((await s.vet.client.call('put', `/dental/charts/${chart.id}/teeth`, { teeth: [{ tooth: '104', trStage: 2 }] })).status).toBe(400);
    // Saving a tooth back to "nothing recorded" removes its row.
    const cleared = await s.vet.client.call('put', `/dental/charts/${chart.id}/teeth`, { teeth: [{ tooth: '309', state: 'PRESENT' }] });
    expect(cleared.body.teeth.map((t: any) => t.tooth)).toEqual(['108', '204']);

    // Procedures: whole-mouth vs per-tooth rules, and each one charged once with the mapped service.
    expect((await s.vet.client.post(`/dental/charts/${chart.id}/procedures`, { code: 'XS' })).body.error.code).toBe('TOOTH_REQUIRED');
    expect((await s.vet.client.post(`/dental/charts/${chart.id}/procedures`, { code: 'SP', teeth: ['108'] })).body.error.code).toBe('WHOLE_MOUTH');
    expect((await s.vet.client.post(`/dental/charts/${chart.id}/procedures`, { code: 'SP' })).status).toBe(200);
    const xs = await s.vet.client.post(`/dental/charts/${chart.id}/procedures`, { code: 'XS', teeth: ['108', '204'] });
    expect(xs.status).toBe(200);
    expect(xs.body.procedures).toHaveLength(3);
    expect(xs.body.extractedNow.sort()).toEqual(['108', '204']);
    expect((await s.vet.client.post(`/dental/charts/${chart.id}/procedures`, { code: 'X', teeth: ['108'] })).body.error.code).toBe('ALREADY_EXTRACTED');
    expect((await s.vet.client.call('put', `/dental/charts/${chart.id}/teeth`, { teeth: [{ tooth: '108', state: 'MISSING' }] })).body.error.code).toBe('EXTRACTED_TODAY');
    // A procedure without a price is recorded but not charged.
    const rp = await s.vet.client.post(`/dental/charts/${chart.id}/procedures`, { code: 'RP', teeth: ['107'] });
    expect(rp.body.procedures.find((p: any) => p.code === 'RP').charge).toBeNull();

    let charges = (await s.org.owner.get(`/charges?clientId=${s.client.id}`)).body;
    expect(charges.data.map((c: any) => c.description).sort()).toEqual([
      expect.stringMatching(/^Scale and polish \(DEN-/),
      expect.stringMatching(/^Surgical extraction — tooth 108 \(DEN-/),
      expect.stringMatching(/^Surgical extraction — tooth 204 \(DEN-/),
    ]);
    expect(charges.totalMinor).toBe(1600000);

    // Removing a procedure waives its unbilled charge.
    const spId = xs.body.procedures.find((p: any) => p.code === 'SP').id;
    expect((await s.vet.client.del(`/dental/charts/${chart.id}/procedures/${spId}`)).status).toBe(200);
    charges = (await s.org.owner.get(`/charges?clientId=${s.client.id}`)).body;
    expect(charges.totalMinor).toBe(800000);
    expect((await s.org.owner.get(`/charges?clientId=${s.client.id}&status=WAIVED`)).body.data[0].waivedReason).toContain('Dental procedure removed');

    const upd = await s.vet.client.patch(`/dental/charts/${chart.id}`, { periodontalStage: 3, occlusion: 'NORMAL', calculusIndex: 2, homeCare: 'Daily brushing', recheckDate: '2027-04-30', anaesthetised: true });
    expect(upd.body).toMatchObject({ periodontalStage: 3, occlusion: 'NORMAL', homeCare: 'Daily brushing', recheckDate: '2027-04-30', anaesthetised: true });

    // Only someone who can sign clinical records signs it; signing locks it.
    expect((await s.nurse.client.post(`/dental/charts/${chart.id}/sign`)).status).toBe(403);
    const signed = await s.vet.client.post(`/dental/charts/${chart.id}/sign`);
    expect(signed.status).toBe(200);
    expect(signed.body).toMatchObject({ status: 'SIGNED', signedByName: 'Test veterinarian', integrity: 'VERIFIED' });
    expect(signed.body.contentHash).toMatch(/^[0-9a-f]{64}$/);

    expect((await s.vet.client.patch(`/dental/charts/${chart.id}`, { notes: 'changed' })).body.error.code).toBe('CHART_SIGNED');
    expect((await s.vet.client.call('put', `/dental/charts/${chart.id}/teeth`, { teeth: [{ tooth: '101', findings: ['CA'] }] })).body.error.code).toBe('CHART_SIGNED');
    expect((await s.vet.client.post(`/dental/charts/${chart.id}/procedures`, { code: 'SP' })).body.error.code).toBe('CHART_SIGNED');
    expect((await s.vet.client.del(`/dental/charts/${chart.id}`)).body.error.code).toBe('CHART_SIGNED');
    // The database refuses changes too, even bypassing the app.
    await expect(prisma().dentalChart.update({ where: { id: chart.id }, data: { notes: 'tampered' } })).rejects.toThrow(/locked/);
    await expect(prisma().dentalChart.delete({ where: { id: chart.id } })).rejects.toThrow(/cannot be deleted/);
    await expect(prisma().dentalToothFinding.updateMany({ where: { chartId: chart.id }, data: { pdStage: 0 } })).rejects.toThrow(/locked/);
    await expect(prisma().dentalProcedure.create({ data: { organizationId: s.org.orgId, chartId: chart.id, code: 'SP', recordedByName: 'x' } })).rejects.toThrow(/locked/);

    // Later notes are addenda (append-only).
    expect((await s.vet.client.post(`/dental/charts/${chart.id}/addenda`, { text: 'Owner called: eating well.' })).status).toBe(200);
    const addenda = await prisma().dentalChartAddendum.findMany({ where: { chartId: chart.id } });
    expect(addenda).toHaveLength(1);
    await expect(prisma().dentalChartAddendum.update({ where: { id: addenda[0].id }, data: { text: 'x' } })).rejects.toThrow(/append-only/);

    const timeline = (await s.vet.client.get(`/patients/${s.patient.id}/timeline`)).body;
    const events = Array.isArray(timeline) ? timeline : timeline.data ?? timeline.events;
    expect(events.some((e: any) => e.kind === 'dental' && e.title === 'Dental chart signed' && e.detail.includes('2 extraction(s)'))).toBe(true);
    const actions = (await prisma().auditEvent.findMany({ where: { organizationId: s.org.orgId, action: { startsWith: 'dental.' } }, select: { action: true } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['dental.chart_started', 'dental.teeth_recorded', 'dental.procedure_added', 'dental.procedure_removed', 'dental.signed', 'dental.addendum']));
  });

  it('starts the next chart from the last one, and only discards drafts', async () => {
    const s = await setup();
    const first = (await s.vet.client.post('/dental/charts', { patientId: s.patient.id, dentition: 'CANINE' })).body;
    await s.vet.client.call('put', `/dental/charts/${first.id}/teeth`, { teeth: [{ tooth: '410', state: 'MISSING' }, { tooth: '101', findings: ['CA'] }] });
    await s.vet.client.post(`/dental/charts/${first.id}/procedures`, { code: 'XS', teeth: ['208'] });
    await s.vet.client.post(`/dental/charts/${first.id}/sign`);

    const next = await s.vet.client.post('/dental/charts', { patientId: s.patient.id, dentition: 'CANINE' });
    expect(next.status).toBe(201);
    expect(next.body.previous).toMatchObject({ id: first.id });
    // Missing and extracted teeth carry forward; ordinary findings don't.
    expect(next.body.teeth.map((t: any) => [t.tooth, t.state])).toEqual([['208', 'EXTRACTED'], ['410', 'MISSING']]);
    // A tooth gone already can't have a procedure.
    expect((await s.vet.client.post(`/dental/charts/${next.body.id}/procedures`, { code: 'XS', teeth: ['208'] })).body.error.code).toBe('TOOTH_ABSENT');

    const mine = (await s.vet.client.get(`/patients/${s.patient.id}/dental`)).body;
    expect(mine.suggestedDentition).toBe('CANINE');
    expect(mine.charts.map((c: any) => c.status)).toEqual(['DRAFT', 'SIGNED']);
    expect((await s.vet.client.get('/dental/charts?status=DRAFT')).body.data.map((c: any) => c.id)).toEqual([next.body.id]);

    // A draft can be discarded (its unbilled charges waived); then it's gone.
    await s.vet.client.post(`/dental/charts/${next.body.id}/procedures`, { code: 'SP' });
    expect((await s.vet.client.del(`/dental/charts/${next.body.id}`)).status).toBe(200);
    expect((await s.vet.client.get(`/dental/charts/${next.body.id}`)).status).toBe(404);
    const waived = (await s.org.owner.get(`/charges?clientId=${s.client.id}&status=WAIVED`)).body.data;
    expect(waived.some((c: any) => c.waivedReason.includes('discarded'))).toBe(true);
  });

  it('links a chart to a consultation, reopens its draft and bills on the visit', async () => {
    const s = await setup();
    const visit = (await s.vet.client.post('/encounters', { patientId: s.patient.id, chiefComplaint: 'Bad breath' })).body;
    expect((await s.vet.client.get(`/encounters/${visit.id}/dental`)).body).toEqual({ suggestedDentition: 'CANINE', charts: [] });
    const first = await s.vet.client.post('/dental/charts', { patientId: s.patient.id, dentition: 'CANINE', encounterId: visit.id });
    expect(first.body.encounterId).toBe(visit.id);
    // Starting again from the same visit opens the draft instead of a second chart.
    const again = await s.vet.client.post('/dental/charts', { patientId: s.patient.id, dentition: 'CANINE', encounterId: visit.id });
    expect(again.body.id).toBe(first.body.id);
    await s.vet.client.post(`/dental/charts/${first.body.id}/procedures`, { code: 'SP' });
    const forVisit = (await s.vet.client.get(`/encounters/${visit.id}/dental`)).body;
    expect(forVisit.charts.map((c: any) => [c.id, c.procedures.length])).toEqual([[first.body.id, 1]]);
    // The procedure's charge belongs to the consultation, so it is billed with the visit.
    expect((await s.org.owner.get(`/charges?encounterId=${visit.id}`)).body.data.map((c: any) => c.sourceType)).toEqual(['DentalProcedure']);
    // A chart can't be linked to another patient's consultation.
    const other = await makePatient(s.org.owner, s.client.id, { name: 'Other' });
    expect((await s.vet.client.post('/dental/charts', { patientId: other.id, dentition: 'CANINE', encounterId: visit.id })).body.error.code).toBe('INVALID_ENCOUNTER');
  });

  it('uses the right teeth for cats and horses, and keeps charts to their clinic', async () => {
    const s = await setup();
    const cat = await makePatient(s.org.owner, s.client.id, { name: 'Misty', speciesId: await speciesId(s.org.owner, 'Cat'), sex: 'FEMALE' });
    expect((await s.vet.client.get(`/patients/${cat.id}/dental`)).body.suggestedDentition).toBe('FELINE');
    const chart = (await s.vet.client.post('/dental/charts', { patientId: cat.id, dentition: 'FELINE', showDeciduous: true })).body;
    // Cats have no upper first premolar (105); baby teeth (5xx–8xx) can be charted.
    expect((await s.vet.client.call('put', `/dental/charts/${chart.id}/teeth`, { teeth: [{ tooth: '105', findings: ['CA'] }] })).body.error.code).toBe('INVALID_TOOTH');
    expect((await s.vet.client.call('put', `/dental/charts/${chart.id}/teeth`, { teeth: [{ tooth: '307', findings: ['TR'], trStage: 4 }, { tooth: '604', findings: ['RD'] }] })).status).toBe(200);
    // Horse-only procedures aren't offered on a cat; the chart type can't change once teeth are recorded on it.
    expect((await s.vet.client.post(`/dental/charts/${chart.id}/procedures`, { code: 'FLOAT' })).body.error.code).toBe('INVALID_PROCEDURE');
    expect((await s.vet.client.patch(`/dental/charts/${chart.id}`, { dentition: 'CANINE' })).status).toBe(200); // 307 and 604 exist on a dog too
    expect((await s.vet.client.patch(`/dental/charts/${chart.id}`, { dentition: 'EQUINE' })).body.error.code).toBe('DENTITION_IN_USE'); // a horse has no baby canine (604)

    // An empty chart can't be signed.
    const empty = (await s.vet.client.post('/dental/charts', { patientId: s.patient.id, dentition: 'CANINE', carryForward: false })).body;
    expect((await s.vet.client.post(`/dental/charts/${empty.id}/sign`)).body.error.code).toBe('EMPTY_CHART');

    const other = await registerOrg();
    expect((await other.owner.get(`/dental/charts/${chart.id}`)).status).toBe(404);
    expect((await other.owner.post('/dental/charts', { patientId: s.patient.id, dentition: 'CANINE' })).status).toBe(404);
    // Receptionists don't see clinical records.
    const desk = await staff(s.org, 'receptionist');
    expect((await desk.client.get(`/dental/charts/${chart.id}`)).status).toBe(403);
  });
});
