import { closeApp, makeClient, makePatient, prisma, registerOrg, speciesId, staff } from './helpers';

// Reference limits below are TEST FIXTURES, not clinical reference intervals.
async function setup() {
  const org = await registerOrg();
  const vet = await staff(org, 'veterinarian', { isClinician: true });
  const lab = await staff(org, 'lab_technician');
  const client = await makeClient(org.owner);
  const patient = await makePatient(org.owner, client.id, { sex: 'FEMALE_SPAYED', dateOfBirth: '2020-01-01' });
  const test = await org.owner.post('/lab-tests', {
    code: 'TPANEL',
    name: 'Test panel',
    category: 'BIOCHEMISTRY',
    sampleType: 'SERUM',
    analytes: [
      { code: 'AAA', name: 'Analyte A', unit: 'mmol/L', resultType: 'NUMERIC', decimals: 1 },
      { code: 'BBB', name: 'Analyte B', unit: 'U/L', resultType: 'NUMERIC', decimals: 0 },
      { code: 'APP', name: 'Appearance', resultType: 'OPTION', options: ['Clear', 'Haemolysed', 'Lipaemic'] },
    ],
  });
  if (test.status !== 201) throw new Error(JSON.stringify(test.body));
  const dog = await speciesId(org.owner);
  const [a, b] = test.body.analytes;
  await org.owner.post('/reference-intervals', { analyteId: a.id, speciesId: dog, low: 3, high: 6, criticalLow: 2, criticalHigh: 8, source: 'Fixture analyser' });
  await org.owner.post('/reference-intervals', { analyteId: a.id, speciesId: dog, sex: 'FEMALE', low: 4, high: 7, source: 'Fixture analyser (female)' });
  await org.owner.post('/reference-intervals', { analyteId: b.id, speciesId: dog, high: 100, source: 'Fixture analyser' });
  return { org, vet, lab, patient, test: test.body };
}

describe('Laboratory & imaging', () => {
  afterAll(closeApp);

  it('orders, collects a barcoded sample, flags results against sex-specific intervals and raises critical alerts', async () => {
    const { org, vet, lab, patient, test } = await setup();
    const order = await vet.client.post('/lab-orders', { patientId: patient.id, testIds: [test.id], priority: 'URGENT', clinicalNotes: 'PU/PD' });
    expect(order.status).toBe(201);
    expect(order.body).toMatchObject({ status: 'ORDERED', priority: 'URGENT' });
    expect(order.body.orderNo).toMatch(/^LAB-\d{6}$/);
    const reception = await staff(org, 'receptionist');
    expect((await reception.client.post(`/lab-orders/${order.body.id}/samples`, { sampleType: 'SERUM' })).status).toBe(403);
    const sample = await lab.client.post(`/lab-orders/${order.body.id}/samples`, { sampleType: 'SERUM' });
    expect(sample.body.barcode).toMatch(/^S\d{8}$/);
    expect((await lab.client.post(`/lab-samples/${sample.body.id}/events`, { action: 'REJECTED' })).body.error.code).toBe('REASON_REQUIRED');
    await lab.client.post(`/lab-samples/${sample.body.id}/events`, { action: 'IN_ANALYSIS' });

    const detail = (await lab.client.get(`/lab-orders/${order.body.id}`)).body;
    const [a, b, app] = detail.items[0].test.analytes;
    expect(detail.referenceIntervals[a.id].source).toBe('Fixture analyser (female)');
    const itemId = detail.items[0].id;
    let r = await lab.client.call('put', `/lab-orders/${order.body.id}/results`, {
      results: [
        { orderItemId: itemId, analyteId: a.id, valueNumeric: 3.5 },
        { orderItemId: itemId, analyteId: b.id, valueNumeric: 250 },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('IN_PROGRESS');
    const res = r.body.items[0].results;
    expect(res.find((x: any) => x.analyteId === a.id)).toMatchObject({ flag: 'LOW', refLow: 4, refHigh: 7 });
    expect(res.find((x: any) => x.analyteId === b.id).flag).toBe('HIGH');
    expect((await lab.client.call('put', `/lab-orders/${order.body.id}/results`, { results: [{ orderItemId: itemId, analyteId: app.id, valueText: 'Cloudy' }] })).body.error.code).toBe('INVALID_OPTION');

    r = await lab.client.call('put', `/lab-orders/${order.body.id}/results`, {
      results: [
        { orderItemId: itemId, analyteId: a.id, valueNumeric: 1.5 },
        { orderItemId: itemId, analyteId: app.id, valueText: 'Haemolysed' },
      ],
    });
    expect(r.body.status).toBe('AWAITING_VALIDATION');
    expect(r.body.hasCritical).toBe(true);
    expect(r.body.items[0].results.find((x: any) => x.analyteId === a.id).flag).toBe('CRITICAL_LOW');
    const tasks = (await vet.client.get(`/tasks?patientId=${patient.id}`)).body.data;
    expect(tasks.some((t: any) => t.title.startsWith('CRITICAL lab value'))).toBe(true);
    expect((await vet.client.get(`/search?q=${sample.body.barcode}`)).body.results[0].href).toBe(`/lab/orders/${order.body.id}`);
  });

  it('only validators release results; released results are immutable and amendments keep the original', async () => {
    const { org, vet, lab, patient, test } = await setup();
    const order = (await vet.client.post('/lab-orders', { patientId: patient.id, testIds: [test.id] })).body;
    const [a, b, app] = order.items[0].test.analytes;
    const itemId = order.items[0].id;
    await lab.client.call('put', `/lab-orders/${order.id}/results`, { results: [{ orderItemId: itemId, analyteId: a.id, valueNumeric: 5 }] });
    expect((await org.owner.post(`/lab-orders/${order.id}/release`)).body.error.code).toBe('RESULTS_INCOMPLETE');
    await lab.client.call('put', `/lab-orders/${order.id}/results`, {
      results: [
        { orderItemId: itemId, analyteId: b.id, valueNumeric: 50 },
        { orderItemId: itemId, analyteId: app.id, valueText: 'Clear' },
      ],
    });
    expect((await lab.client.post(`/lab-orders/${order.id}/release`)).status).toBe(403);
    const released = await vet.client.post(`/lab-orders/${order.id}/release`);
    expect(released.body.status).toBe('RELEASED');
    const resA = released.body.items[0].results.find((x: any) => x.analyteId === a.id);
    expect(resA.status).toBe('FINAL');
    expect((await lab.client.call('put', `/lab-orders/${order.id}/results`, { results: [{ orderItemId: itemId, analyteId: a.id, valueNumeric: 9 }] })).body.error.code).toBe('ORDER_RELEASED');
    await expect(prisma().labResult.update({ where: { id: resA.id }, data: { valueNumeric: 9 } })).rejects.toThrow(/immutable/);

    const amended = await vet.client.post(`/lab-results/${resA.id}/amend`, { valueNumeric: 5.5, amendmentReason: 'Transcription error' });
    expect(amended.status).toBe(201);
    const all = amended.body.order.items[0].results.filter((x: any) => x.analyteId === a.id);
    expect(all.map((x: any) => x.status).sort()).toEqual(['FINAL', 'SUPERSEDED']);
    expect(all.find((x: any) => x.status === 'FINAL')).toMatchObject({ valueNumeric: 5.5, supersedesId: resA.id, amendmentReason: 'Transcription error' });
    expect((await vet.client.post(`/lab-results/${resA.id}/amend`, { valueNumeric: 6, amendmentReason: 'again' })).status).toBe(422);
  });

  it('handles imaging orders with a findings/conclusion report and no sample', async () => {
    const { org, vet, patient } = await setup();
    const xr = await org.owner.post('/lab-tests', { code: 'XR-THX', name: 'Thoracic radiographs', category: 'IMAGING', modality: 'XRAY', sampleType: 'NONE' });
    expect(xr.status).toBe(201);
    const order = (await vet.client.post('/lab-orders', { patientId: patient.id, testIds: [xr.body.id] })).body;
    expect(order.status).toBe('IN_PROGRESS');
    const rep = await vet.client.call('put', `/lab-orders/${order.id}/items/${order.items[0].id}/imaging-report`, {
      modality: 'XRAY',
      bodyRegion: 'Thorax',
      views: 'Right lateral, VD',
      findings: 'Normal cardiac silhouette.',
      conclusion: 'No significant abnormality detected.',
    });
    expect(rep.body.status).toBe('AWAITING_VALIDATION');
    expect((await vet.client.post(`/lab-orders/${order.id}/release`)).body.status).toBe('RELEASED');
  });

  it('refuses to delete analytes that have results and isolates orders between organizations', async () => {
    const { org, vet, lab, patient, test } = await setup();
    const order = (await vet.client.post('/lab-orders', { patientId: patient.id, testIds: [test.id] })).body;
    const [a] = order.items[0].test.analytes;
    await lab.client.call('put', `/lab-orders/${order.id}/results`, { results: [{ orderItemId: order.items[0].id, analyteId: a.id, valueNumeric: 5 }] });
    const res = await org.owner.patch(`/lab-tests/${test.id}`, { analytes: test.analytes.slice(1).map((x: any) => ({ ...x })) });
    expect(res.body.error.code).toBe('ANALYTE_IN_USE');
    const other = await registerOrg();
    expect((await other.owner.get(`/lab-orders/${order.id}`)).status).toBe(404);
    expect((await other.owner.post(`/lab-orders/${order.id}/release`)).status).toBe(404);
  });
});
