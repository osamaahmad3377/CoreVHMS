import { localParts } from '../src/common/time/tz';
import { closeApp, inDays, makeClient, prisma, registerOrg, speciesId, staff, stockFixture, unique } from './helpers';

const DAY = 86400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();

async function farmFixture() {
  const org = await registerOrg();
  const owner = await makeClient(org.owner, { type: 'FARM', organizationName: unique('Dairy Farm'), firstName: 'Aslam', lastName: 'Farmer' });
  const farm = (await org.owner.post('/farms', { clientId: owner.id, name: unique('Green Valley Dairy'), district: 'Sheikhupura' })).body;
  const cattle = await speciesId(org.owner, 'Cattle');
  const herd = (await org.owner.post('/animal-groups', { farmId: farm.id, name: 'Milking herd', kind: 'HERD', speciesId: cattle, purpose: 'DAIRY' })).body;
  return { org, owner, farm, cattle, herd };
}

describe('Livestock and farms', () => {
  afterAll(closeApp);

  it('registers a herd by ear tag, rejects duplicate tags and records moves, sales and deaths in the history', async () => {
    const { org, farm, cattle, herd } = await farmFixture();
    const tag = unique('PK').toUpperCase();
    const add = await org.owner.post('/livestock/animals/bulk', {
      groupId: herd.id,
      source: 'PURCHASE',
      counterparty: 'Cattle market',
      animals: [
        { tag: `${tag}-1`, name: 'Rani', sex: 'FEMALE' },
        { tag: `${tag}-2`, sex: 'FEMALE' },
        { tag: `${tag}-3`, name: 'Sultan', sex: 'MALE' },
      ],
    });
    expect(add.status).toBe(201);
    expect(add.body.created).toHaveLength(3);
    expect(add.body.created[1].name).toBe(`${tag}-2`); // unnamed animals are named by tag
    const dup = await org.owner.post('/livestock/animals/bulk', { groupId: herd.id, animals: [{ tag: `${tag}-1` }] });
    expect(dup.status).toBe(409);
    expect((await org.owner.post('/livestock/animals/bulk', { groupId: herd.id, animals: [{ tag: 'X1' }, { tag: 'x1' }] })).body.error.code).toBe('DUPLICATE_TAG');

    const g = (await org.owner.get(`/animal-groups/${herd.id}`)).body;
    expect(g.population).toBe(3);
    expect(g.animals.map((a: any) => a.tag).sort()).toEqual([`${tag}-1`, `${tag}-2`, `${tag}-3`]);
    const [rani, second, sultan] = add.body.created.map((c: any) => c.id);

    const heifers = (await org.owner.post('/animal-groups', { farmId: farm.id, name: 'Heifers', kind: 'PEN', speciesId: cattle })).body;
    expect((await org.owner.post('/livestock/movements', { type: 'MOVE', patientIds: [second], toGroupId: heifers.id, occurredAt: new Date().toISOString() })).status).toBe(201);
    expect((await org.owner.post('/livestock/movements', { type: 'SALE', patientIds: [sultan], occurredAt: new Date().toISOString(), counterparty: 'Neighbour farm', priceMinor: 25000000 })).status).toBe(201);
    expect((await org.owner.post('/livestock/movements', { type: 'DEATH', patientIds: [second], occurredAt: new Date().toISOString() })).body.error.code).toBe('VALIDATION_ERROR'); // cause required
    expect((await org.owner.post('/livestock/movements', { type: 'DEATH', patientIds: [second], occurredAt: new Date().toISOString(), reason: 'Bloat' })).status).toBe(201);
    // A sold or dead animal cannot be moved again.
    expect((await org.owner.post('/livestock/movements', { type: 'MOVE', patientIds: [sultan], toGroupId: herd.id, occurredAt: new Date().toISOString() })).body.error.code).toBe('PATIENT_INACTIVE');

    const p = (await org.owner.get(`/patients/${second}`)).body;
    expect(p).toMatchObject({ status: 'DECEASED', causeOfDeath: 'Bloat' });
    const hist = (await org.owner.get(`/livestock/movements?patientId=${second}`)).body;
    expect(hist.map((m: any) => m.type)).toEqual(['DEATH', 'MOVE', 'PURCHASE']);
    // Movement history is append-only at the database level.
    await expect(prisma().livestockMovement.update({ where: { id: hist[0].id }, data: { reason: 'edited' } })).rejects.toThrow(/cannot be changed/);
    // A group still holding animals cannot be closed.
    expect((await org.owner.post(`/animal-groups/${herd.id}/close`, { reason: 'Dispersed' })).body.error.code).toBe('GROUP_NOT_EMPTY');
    expect((await org.owner.post(`/animal-groups/${heifers.id}/close`, { reason: 'Pen emptied' })).status).toBe(200);

    const report = (await org.owner.get(`/farms/${farm.id}/report`)).body;
    expect(report.census.individuals).toBe(1);
    expect(report.movements).toMatchObject({ purchased: 3, sold: 1, deaths: 1, salesValueMinor: 25000000 });
    void rani;
  });

  it('tracks poultry batches by head count: placement, daily mortality, split and sale', async () => {
    const { org, farm } = await farmFixture();
    const chicken = await speciesId(org.owner, 'Chicken');
    const shed = (await org.owner.post('/animal-groups', { farmId: farm.id, name: 'Broiler shed 1', kind: 'BATCH', speciesId: chicken, purpose: 'BROILER', tracksIndividuals: false, initialCount: 5000, placedOn: inDays(-10) })).body;
    expect(shed).toMatchObject({ headCount: 5000, population: 5000, ageDays: 10 });
    expect((await org.owner.post('/animal-groups', { farmId: farm.id, name: 'No count', kind: 'BATCH', speciesId: chicken, tracksIndividuals: false })).body.error.code).toBe('VALIDATION_ERROR');
    // Batch groups do not take individual registrations.
    expect((await org.owner.post('/livestock/animals/bulk', { groupId: shed.id, animals: [{ tag: unique('B') }] })).body.error.code).toBe('BATCH_GROUP');

    const m1 = await org.owner.post('/production', { farmId: farm.id, groupId: shed.id, kind: 'MORTALITY', recordedOn: inDays(-1), quantity: 40 });
    expect(m1.status).toBe(201);
    await org.owner.post('/production', { farmId: farm.id, groupId: shed.id, kind: 'FEED', recordedOn: inDays(-1), quantity: 650 });
    await org.owner.post('/production', { farmId: farm.id, groupId: shed.id, kind: 'BATCH_WEIGHT', recordedOn: inDays(0), quantity: 1.42 });
    expect((await org.owner.post('/production', { farmId: farm.id, groupId: shed.id, kind: 'MORTALITY', recordedOn: inDays(0), quantity: 99999 })).body.error.code).toBe('INSUFFICIENT_HEAD');
    expect((await org.owner.post('/livestock/movements', { type: 'DEATH', groupId: shed.id, headCount: 5, occurredAt: new Date().toISOString(), reason: 'x' })).body.error.code).toBe('USE_MORTALITY');

    const shed2 = (await org.owner.post('/animal-groups', { farmId: farm.id, name: 'Broiler shed 2', kind: 'BATCH', speciesId: chicken, purpose: 'BROILER', tracksIndividuals: false, initialCount: 1 })).body;
    expect((await org.owner.post('/livestock/movements', { type: 'MOVE', groupId: shed.id, headCount: 960, toGroupId: shed2.id, occurredAt: new Date().toISOString() })).status).toBe(201);
    expect((await org.owner.post('/livestock/movements', { type: 'SALE', groupId: shed.id, headCount: 4000, occurredAt: new Date().toISOString(), counterparty: 'Processor', priceMinor: 100 })).status).toBe(201);
    let g = (await org.owner.get(`/animal-groups/${shed.id}`)).body;
    expect(g.headCount).toBe(0);
    expect((await org.owner.get(`/animal-groups/${shed2.id}`)).body.headCount).toBe(961);

    // Voiding mortality puts the birds back.
    expect((await org.owner.post(`/production/${m1.body.id}/void`, { reason: 'Entered on the wrong shed' })).status).toBe(200);
    g = (await org.owner.get(`/animal-groups/${shed.id}`)).body;
    expect(g.headCount).toBe(40);
    expect((await org.owner.post(`/production/${m1.body.id}/void`, { reason: 'again' })).body.error.code).toBe('ALREADY_VOIDED');
    await expect(prisma().productionRecord.update({ where: { id: m1.body.id }, data: { quantity: 1 } })).rejects.toThrow(/cannot be changed/);

    const report = (await org.owner.get(`/farms/${farm.id}/report?from=${daysAgo(30)}`)).body;
    const b = report.batches.find((x: any) => x.id === shed.id);
    expect(b).toMatchObject({ initialCount: 5000, headCount: 40, mortalityInPeriod: 0, feedKg: 650, latestAvgWeightKg: 1.42 });
  });

  it('records breeding with due dates from the configured gestation length and registers offspring at birth', async () => {
    const { org, herd, cattle } = await farmFixture();
    // Without a configured gestation length no due date is invented.
    const tag = unique('C').toUpperCase();
    const animals = (await org.owner.post('/livestock/animals/bulk', { groupId: herd.id, animals: [{ tag: `${tag}-COW`, name: 'Gori', sex: 'FEMALE' }, { tag: `${tag}-BULL`, name: 'Raja', sex: 'MALE' }] })).body.created;
    const [cow, bull] = animals.map((a: any) => a.id);
    const s1 = await org.owner.post('/breeding-events', { patientId: cow, type: 'INSEMINATION', occurredAt: daysAgo(200), sireText: 'AI sire HF-123', semenBatch: 'S-77' });
    expect(s1.status).toBe(201);
    expect(s1.body.expectedDueDate).toBeNull();
    expect((await org.owner.post(`/breeding-events/${s1.body.id}/void`, { reason: 'Wrong cow' })).status).toBe(200);

    // Gestation is configurable data with a source (settings permission).
    const vet = await staff(org, 'field_vet', { isClinician: true });
    expect((await vet.client.patch(`/livestock/species/${cattle}`, { gestationDays: 283, gestationSource: 'Clinic reference' })).status).toBe(403);
    expect((await org.owner.patch(`/livestock/species/${cattle}`, { gestationDays: 283 })).body.error.code).toBe('VALIDATION_ERROR');
    expect((await org.owner.patch(`/livestock/species/${cattle}`, { gestationDays: 283, gestationSource: 'Clinic reference (test)' })).status).toBe(200);

    expect((await vet.client.post('/breeding-events', { patientId: bull, type: 'HEAT', occurredAt: daysAgo(1) })).body.error.code).toBe('NOT_FEMALE');
    const service = await vet.client.post('/breeding-events', { patientId: cow, type: 'SERVICE', occurredAt: daysAgo(270), sireId: bull });
    expect(service.status).toBe(201);
    // Calendar day of the service in the branch (Karachi), plus the gestation length.
    const expected = localParts(new Date(Date.now() - 270 * DAY + 283 * DAY), 'Asia/Karachi').date;
    expect(service.body.expectedDueDate.slice(0, 10)).toBe(expected);
    expect(service.body.dueDateSource).toContain('283 days');
    await vet.client.post('/breeding-events', { patientId: cow, type: 'PREGNANCY_CHECK', occurredAt: daysAgo(220), result: 'PREGNANT', method: 'Rectal palpation' });
    let b = (await vet.client.get(`/livestock/animals/${cow}/breeding`)).body;
    expect(b.status.state).toBe('DUE_SOON');
    expect((await vet.client.get('/livestock/births-due?days=30')).body.map((r: any) => r.id)).toContain(cow);

    expect((await vet.client.post('/breeding-events', { patientId: cow, type: 'BIRTH', occurredAt: daysAgo(0), offspring: [] })).body.error.code).toBe('VALIDATION_ERROR');
    const birth = await vet.client.post('/breeding-events', { patientId: cow, type: 'BIRTH', occurredAt: daysAgo(0), offspring: [{ tag: `${tag}-CALF`, sex: 'FEMALE', alive: true }, { sex: 'MALE', alive: false }] });
    expect(birth.status).toBe(201);
    expect(birth.body).toMatchObject({ offspringCount: 2, liveCount: 1, sireId: bull });
    const calf = await vet.client.get(`/patients/${birth.body.offspring[0].id}`);
    expect(calf.body).toMatchObject({ damId: cow, sireId: bull, groupId: herd.id, status: 'ACTIVE' });
    expect((await vet.client.get(`/patients/${birth.body.offspring[1].id}`)).body).toMatchObject({ status: 'DECEASED', causeOfDeath: 'Stillborn' });
    b = (await vet.client.get(`/livestock/animals/${cow}/breeding`)).body;
    expect(b.status.state).toBe('OPEN');
    expect(b.pedigree.offspring).toHaveLength(2);
    expect((await vet.client.get(`/livestock/animals/${bull}/breeding`)).body.pedigree.offspring).toHaveLength(2);
    // Birth records register animals and cannot be voided.
    expect((await vet.client.post(`/breeding-events/${birth.body.id}/void`, { reason: 'x' })).body.error.code).toBe('BIRTH_RECORD');
    const fertility = (await vet.client.get(`/farms/${herd.farmId}/fertility`)).body;
    expect(fertility.find((f: any) => f.id === cow)).toMatchObject({ state: 'OPEN' });
  });

  it('treats a group: stock issued, product billed to the farm owner, withdrawal recorded for every animal', async () => {
    const { org, owner, farm, cattle, herd } = await farmFixture();
    const f = await stockFixture(org);
    await org.owner.post('/stock/receipts', { supplierId: f.supplierId, locationId: f.locationId, lines: [{ productId: f.product.id, batchNumber: 'OXY-1', expiryDate: inDays(300), quantity: 100, unitCostMinor: 200 }] });
    await org.owner.post(`/products/${f.product.id}/withdrawals`, { speciesId: cattle, meatDays: 28, milkHours: 96, source: 'Product label (test)' });
    const tag = unique('T').toUpperCase();
    await org.owner.post('/livestock/animals/bulk', { groupId: herd.id, animals: [{ tag: `${tag}-1`, sex: 'FEMALE' }, { tag: `${tag}-2`, sex: 'FEMALE' }] });

    expect((await org.owner.post('/group-treatments', { farmId: farm.id, groupId: herd.id, kind: 'TREATMENT', productId: f.product.id, headCount: 5, administeredAt: new Date().toISOString() })).body.error.code).toBe('HEAD_COUNT');
    const t = await org.owner.post('/group-treatments', { farmId: farm.id, groupId: herd.id, kind: 'TREATMENT', productId: f.product.id, headCount: 2, quantityIssued: 10, dosePerHead: 'per label', administeredAt: new Date().toISOString() });
    expect(t.status).toBe(201);
    expect(t.body).toMatchObject({ animalsWithWithdrawal: 2, withdrawalConfigured: true });
    expect(new Date(t.body.milkClearAt).getTime()).toBeGreaterThan(Date.now() + 95 * 3600_000);

    const board = (await org.owner.get(`/livestock/withdrawals?farmId=${farm.id}`)).body;
    expect(board).toHaveLength(2);
    expect(board[0]).toMatchObject({ subjectType: 'ANIMAL', meatActive: true, milkActive: true, source: 'Product label (test)' });
    const level = await prisma().stockLevel.findFirst({ where: { productId: f.product.id } });
    expect(Number(level!.quantity)).toBe(90);
    const charges = (await org.owner.get(`/charges?clientId=${owner.id}`)).body.data;
    expect(charges).toHaveLength(1);
    expect(charges[0]).toMatchObject({ quantity: 10, unitPriceMinor: 500 });
    // Group treatment records cannot be altered.
    await expect(prisma().groupTreatment.update({ where: { id: t.body.id }, data: { headCount: 1 } })).rejects.toThrow(/cannot be changed/);

    // Batch (poultry) treatment: the withdrawal is held on the batch itself.
    const chicken = await speciesId(org.owner, 'Chicken');
    await org.owner.post(`/products/${f.product.id}/withdrawals`, { speciesId: chicken, meatDays: 7, eggDays: 5, source: 'Product label (test)' });
    const shed = (await org.owner.post('/animal-groups', { farmId: farm.id, name: 'Layers', kind: 'FLOCK', speciesId: chicken, purpose: 'LAYER', tracksIndividuals: false, initialCount: 800 })).body;
    await org.owner.post('/group-treatments', { farmId: farm.id, groupId: shed.id, kind: 'TREATMENT', productId: f.product.id, headCount: 800, quantityIssued: 5, charge: false, administeredAt: new Date().toISOString() });
    const all = (await org.owner.get(`/livestock/withdrawals?farmId=${farm.id}`)).body;
    expect(all.find((w: any) => w.subjectType === 'BATCH')).toMatchObject({ eggActive: true, subject: { tag: '800 head' } });
    expect((await org.owner.get(`/charges?clientId=${owner.id}`)).body.data).toHaveLength(1); // second one not billed
  });

  it('runs a field visit: on-site services and products billed to the owner, call-out fee on completion, record locked', async () => {
    const { org, owner, farm } = await farmFixture();
    const f = await stockFixture(org);
    await org.owner.post('/stock/receipts', { supplierId: f.supplierId, locationId: f.locationId, lines: [{ productId: f.product.id, batchNumber: 'FV-1', quantity: 20, unitCostMinor: 100 }] });
    const callout = (await org.owner.post('/services', { code: unique('FARM').slice(0, 20), name: 'Farm visit call-out', category: 'FIELD_VISIT', priceMinor: 500000 })).body;
    const exam = (await org.owner.post('/services', { code: unique('HERD').slice(0, 20), name: 'Herd examination (per head)', category: 'FIELD_VISIT', priceMinor: 20000 })).body;
    const v = await org.owner.post('/field-visits', { farmId: farm.id, scheduledAt: new Date(Date.now() + 3600_000).toISOString(), purpose: 'Mastitis investigation', calloutServiceId: callout.id });
    expect(v.status).toBe(201);
    expect(v.body.visitNo).toMatch(/^FV-/);
    expect((await org.owner.post(`/field-visits/${v.body.id}/items`, { quantity: 1 })).body.error.code).toBe('VALIDATION_ERROR');
    expect((await org.owner.post(`/field-visits/${v.body.id}/items`, { serviceId: exam.id, quantity: 12 })).status).toBe(201);
    expect((await org.owner.post(`/field-visits/${v.body.id}/items`, { productId: f.product.id, quantity: 4 })).status).toBe(201);
    expect((await org.owner.post(`/field-visits/${v.body.id}/cancel`, { reason: 'Rain' })).body.error.code).toBe('VISIT_HAS_WORK');
    expect((await org.owner.post(`/field-visits/${v.body.id}/complete`, {})).body.error.code).toBe('VALIDATION_ERROR');
    const done = await org.owner.post(`/field-visits/${v.body.id}/complete`, { findings: 'Two cows with clinical mastitis; milk samples taken.', distanceKm: 18 });
    expect(done.status).toBe(200);
    const detail = (await org.owner.get(`/field-visits/${v.body.id}`)).body;
    expect(detail.status).toBe('COMPLETED');
    expect(detail.charges.map((c: any) => c.totalMinor).sort((a: number, b: number) => a - b)).toEqual([2000, 240000, 500000]);
    expect((await org.owner.patch(`/field-visits/${v.body.id}`, { findings: 'changed' })).body.error.code).toBe('VISIT_CLOSED');
    await expect(prisma().fieldVisit.update({ where: { id: v.body.id }, data: { findings: 'tampered' } })).rejects.toThrow(/cannot be changed/);
    // On-site billing: invoice the visit's charges for the farm owner.
    const inv = await org.owner.post('/invoices', { clientId: owner.id, chargeIds: detail.charges.map((c: any) => c.id), lines: [] });
    expect(inv.status).toBe(201);
    expect(inv.body.subtotalMinor ?? inv.body.totalMinor).toBeGreaterThanOrEqual(742000);
    const level = await prisma().stockLevel.findFirst({ where: { productId: f.product.id } });
    expect(Number(level!.quantity)).toBe(16);
  });

  it('logs disease outbreaks with counts that only go up, and closes them', async () => {
    const { org, farm } = await farmFixture();
    const o = await org.owner.post('/outbreaks', { farmId: farm.id, disease: 'Foot-and-mouth disease (suspected)', notifiable: true, firstSeenOn: inDays(-2), affectedCount: 4, populationAtRisk: 60 });
    expect(o.status).toBe(201);
    expect(o.body.outbreakNo).toMatch(/^OB-/);
    expect((await org.owner.post('/outbreaks', { farmId: farm.id, disease: 'x', firstSeenOn: inDays(0), affectedCount: 1, deathCount: 2 })).body.error.code).toBe('DEATHS_EXCEED_AFFECTED');
    expect((await org.owner.patch(`/outbreaks/${o.body.id}`, { affectedCount: 2 })).body.error.code).toBe('COUNT_DECREASE');
    const c = await org.owner.patch(`/outbreaks/${o.body.id}`, { status: 'CONFIRMED', affectedCount: 9, deathCount: 1, reportedToAuthorityOn: inDays(0), authorityReference: 'LIVESTOCK-DEPT-1' });
    expect(c.body).toMatchObject({ status: 'CONFIRMED', affectedCount: 9 });
    expect(c.body.confirmedOn).toBeTruthy();
    expect((await org.owner.get('/livestock/overview')).body.openOutbreaks).toBe(1);
    const closed = await org.owner.patch(`/outbreaks/${o.body.id}`, { status: 'CLOSED' });
    expect(closed.body.closedOn).toBeTruthy();
    expect((await org.owner.get('/outbreaks?status=OPEN')).body).toHaveLength(0);
  });

  it('enforces permissions and tenant isolation', async () => {
    const { org, farm, herd } = await farmFixture();
    const rec = await staff(org, 'receptionist');
    expect((await rec.client.get('/farms')).status).toBe(403);
    const fv = await staff(org, 'field_vet', { isClinician: true });
    expect((await fv.client.get(`/farms/${farm.id}`)).status).toBe(200);
    // Bulk registration also needs patient registration rights.
    const acc = await staff(org, 'accountant');
    expect((await acc.client.post('/livestock/animals/bulk', { groupId: herd.id, animals: [{ tag: 'Z' }] })).status).toBe(403);

    const other = await registerOrg();
    expect((await other.owner.get(`/farms/${farm.id}`)).status).toBe(404);
    expect((await other.owner.post('/animal-groups', { farmId: farm.id, name: 'Steal', kind: 'HERD', speciesId: herd.speciesId })).status).toBe(404);
    expect((await other.owner.get('/farms')).body).toHaveLength(0);
    // A farm can only be created for a client of the same clinic.
    expect((await other.owner.post('/farms', { clientId: farm.clientId, name: 'Nope' })).body.error.code).toBe('INVALID_CLIENT');
  });
});
