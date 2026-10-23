import { closeApp, makeClient, makePatient, prisma, registerOrg, speciesId, staff } from './helpers';

// All product strengths, doses and withdrawal periods below are ARITHMETIC TEST FIXTURES, not clinical guidance.
async function setup() {
  const org = await registerOrg();
  const vet = await staff(org, 'veterinarian', { isClinician: true });
  const client = await makeClient(org.owner);
  const patient = await makePatient(org.owner, client.id, { initialWeightKg: 12.4 });
  const tab = await org.owner.post('/products', {
    name: 'Testamycin 50 mg tablets',
    type: 'MEDICINE',
    form: 'TABLET',
    strengthValue: 50,
    strengthUnit: 'mg',
    dispensingUnit: 'tablet',
    minDispenseIncrement: 0.25,
    activeIngredients: ['Testamycin'],
    sellPriceMinor: 5000,
  });
  if (tab.status !== 201) throw new Error(JSON.stringify(tab.body));
  return { org, vet, client, patient, product: tab.body };
}

const item = (productId: string, extra: Record<string, unknown> = {}) => ({
  productId,
  route: 'PO',
  doseValue: 5,
  doseUnit: 'mg/kg',
  frequencyCode: 'BID',
  durationDays: 7,
  instructions: 'Give with food',
  ...extra,
});

describe('Prescriptions & pharmacy', () => {
  afterAll(closeApp);

  it('finds a prescription by its number in global search, only within the clinic', async () => {
    const { org, vet, patient, product } = await setup();
    const rx = await vet.client.post('/prescriptions', { patientId: patient.id, items: [item(product.id, { quantity: 10 })] });
    expect(rx.status).toBe(201);
    for (const q of [`RX-${rx.body.number}`, `rx${rx.body.number}`, `RX-${String(rx.body.number).padStart(6, '0')}`]) {
      const hits = (await org.owner.get(`/search?q=${encodeURIComponent(q)}`)).body.results.filter((h: any) => h.type === 'prescription');
      expect(hits).toEqual([expect.objectContaining({ id: rx.body.id, href: `/pharmacy/prescriptions/${rx.body.id}`, subtitle: expect.stringContaining(patient.name) })]);
    }
    const other = await registerOrg();
    expect((await other.owner.get(`/search?q=RX-${rx.body.number}`)).body.results.filter((h: any) => h.id === rx.body.id)).toEqual([]);
  });

  it('calculates the dose from weight and strength, rounds to the dispensable increment and totals the course', async () => {
    const { vet, patient, product } = await setup();
    const ev = await vet.client.post('/prescriptions/evaluate', { patientId: patient.id, item: item(product.id), weightKg: 12.4 });
    expect(ev.status).toBe(200);
    expect(ev.body.calculation).toMatchObject({ rawAmount: 1.24, amount: 1.25, deliveredDose: 62.5 });
    expect(ev.body.quantity).toBe(17.5);
    expect(ev.body.warnings.map((w: any) => w.code)).toContain('NO_REFERENCE');
    expect(ev.body.requiresOverride).toBe(false);

    const rx = await vet.client.post('/prescriptions', { patientId: patient.id, items: [item(product.id)], authorize: true });
    expect(rx.status).toBe(201);
    expect(rx.body).toMatchObject({ status: 'AUTHORIZED', weightKg: 12.4 });
    expect(rx.body.prescriptionNo).toMatch(/^RX-\d{6}$/);
    expect(rx.body.items[0]).toMatchObject({ amountPerDose: 1.25, quantity: 17.5, frequencyText: '2 times a day (BID)' });
    expect((await vet.client.get(`/prescriptions/${rx.body.id}/verify`)).body).toEqual({ authorized: true, valid: true });
  });

  it('requires a documented override reason when the patient has a matching allergy', async () => {
    const { org, vet, patient, product } = await setup();
    await org.owner.post(`/patients/${patient.id}/alerts`, { type: 'ALLERGY', severity: 'CRITICAL', title: 'Testamycin reaction', substance: 'testamycin' });
    const blocked = await vet.client.post('/prescriptions', { patientId: patient.id, items: [item(product.id)] });
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.code).toBe('SAFETY_OVERRIDE_REQUIRED');
    expect(blocked.body.error.details.warnings[0].code).toBe('ALLERGY');
    const ok = await vet.client.post('/prescriptions', { patientId: patient.id, items: [item(product.id, { overrideReason: 'Mild GI upset only; owner consents' })] });
    expect(ok.status).toBe(201);
    expect(ok.body.items[0].overrideReason).toBe('Mild GI upset only; owner consents');
    const audit = (await org.owner.get(`/audit-events?entityId=${ok.body.id}`)).body.data[0];
    expect(JSON.stringify(audit.changes)).toContain('owner consents');
  });

  it('matches an allergy to a drug family entered on the product, and checks again when a draft is authorised', async () => {
    const { org, vet, patient } = await setup();
    // Test data: the family is whatever the clinic types on the product; nothing is built in.
    const amox = await org.owner.post('/products', {
      name: 'Testcillin 250 mg tablets', type: 'MEDICINE', form: 'TABLET', strengthValue: 250, strengthUnit: 'mg', dispensingUnit: 'tablet',
      minDispenseIncrement: 0.5, activeIngredients: ['testcillin'], drugClass: 'Testicillins',
    });
    expect(amox.status).toBe(201);
    expect(amox.body.drugClass).toBe('Testicillins');
    expect((await org.owner.get(`/products/${amox.body.id}`)).body.drugClass).toBe('Testicillins');
    expect((await org.owner.patch(`/products/${amox.body.id}`, { drugClass: 'Testicillins, Beta-tests' })).body.drugClass).toBe('Testicillins, Beta-tests');

    // A draft written before the allergy was known…
    const draft = await vet.client.post('/prescriptions', { patientId: patient.id, items: [item(amox.body.id, { doseValue: 20 })] });
    expect(draft.status).toBe(201);
    await org.owner.post(`/patients/${patient.id}/alerts`, { type: 'ALLERGY', severity: 'CRITICAL', title: 'Drug allergy', substance: 'TESTICILLIN', reaction: 'Face swelling' });

    const ev = await vet.client.post('/prescriptions/evaluate', { patientId: patient.id, item: item(amox.body.id, { doseValue: 20 }) });
    const warning = ev.body.warnings.find((w: any) => w.code === 'ALLERGY');
    expect(warning.message).toContain('drug family Testicillins');
    expect(ev.body.requiresOverride).toBe(true);

    // …cannot be authorised without a reason now.
    const auth = await vet.client.post(`/prescriptions/${draft.body.id}/authorize`);
    expect(auth.status).toBe(422);
    expect(auth.body.error.code).toBe('SAFETY_OVERRIDE_REQUIRED');

    const blocked = await vet.client.post('/prescriptions', { patientId: patient.id, authorize: true, items: [item(amox.body.id, { doseValue: 20 })] });
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.code).toBe('SAFETY_OVERRIDE_REQUIRED');
    expect(blocked.body.error.details.warnings[0].code).toBe('ALLERGY');

    const ok = await vet.client.post('/prescriptions', { patientId: patient.id, authorize: true, items: [item(amox.body.id, { doseValue: 20, overrideReason: 'Skin test negative; owner informed' })] });
    expect(ok.status).toBe(201);
    expect(ok.body.status).toBe('AUTHORIZED');
    expect(ok.body.items[0].overrideReason).toBe('Skin test negative; owner informed');
    expect(ok.body.patient.alerts[0]).toMatchObject({ substance: 'TESTICILLIN', reaction: 'Face swelling' });
  });

  it('asks to confirm a large number of tablets per dose above the clinic setting (a prompt, not a limit)', async () => {
    const { org, vet, patient, product } = await setup();
    // 20 mg/kg × 12.4 kg ÷ 50 mg = 4.96 → 5 tablets; arithmetic fixture only.
    let ev = await vet.client.post('/prescriptions/evaluate', { patientId: patient.id, item: item(product.id, { doseValue: 20 }) });
    expect(ev.body.largeDose).toEqual({ amount: 5, unit: 'tablet', confirmAbove: 4 });
    expect(ev.body.requiresOverride).toBe(false);
    expect((await vet.client.patch('/pharmacy-settings', { confirmUnitsPerDoseAbove: 6 })).status).toBe(403);
    expect((await org.owner.patch('/pharmacy-settings', { confirmUnitsPerDoseAbove: 6 })).body).toEqual({ confirmUnitsPerDoseAbove: 6 });
    expect((await vet.client.get('/pharmacy-settings')).body).toEqual({ confirmUnitsPerDoseAbove: 6 });
    ev = await vet.client.post('/prescriptions/evaluate', { patientId: patient.id, item: item(product.id, { doseValue: 20 }) });
    expect(ev.body.largeDose).toBeNull();
  });

  it('uses only approved, sourced dose references and blocks out-of-range doses without a reason', async () => {
    const { org, vet, patient, product } = await setup();
    const pharm = await staff(org, 'pharmacy');
    const dog = await speciesId(org.owner);
    const ref = await pharm.client.post('/dose-references', { productId: product.id, speciesId: dog, route: 'PO', doseMin: 2, doseMax: 4, doseUnit: 'mg/kg', source: 'Test fixture source' });
    expect(ref.status).toBe(201);
    expect(ref.body.status).toBe('DRAFT');
    // draft references are ignored
    let ev = await vet.client.post('/prescriptions/evaluate', { patientId: patient.id, item: item(product.id) });
    expect(ev.body.warnings.map((w: any) => w.code)).toContain('NO_REFERENCE');
    // only someone holding clinical.sign + formulary.manage may approve
    expect((await pharm.client.post(`/dose-references/${ref.body.id}/approve`)).status).toBe(403);
    expect((await org.owner.post(`/dose-references/${ref.body.id}/approve`)).body.status).toBe('APPROVED');
    ev = await vet.client.post('/prescriptions/evaluate', { patientId: patient.id, item: item(product.id) });
    expect(ev.body.warnings.find((w: any) => w.code === 'DOSE_ABOVE_RANGE').message).toContain('Test fixture source');
    expect(ev.body.requiresOverride).toBe(true);
    const inRange = await vet.client.post('/prescriptions/evaluate', { patientId: patient.id, item: item(product.id, { doseValue: 3 }) });
    expect(inRange.body.requiresOverride).toBe(false);
  });

  it('lets nurses draft but only authorised prescribers authorise; controlled drugs need a prescriber', async () => {
    const { org, vet, patient, product } = await setup();
    const nurse = await staff(org, 'nurse');
    expect((await nurse.client.post('/prescriptions', { patientId: patient.id, items: [item(product.id)], authorize: true })).status).toBe(403);
    const draft = await nurse.client.post('/prescriptions', { patientId: patient.id, items: [item(product.id)] });
    expect(draft.status).toBe(201);
    expect((await nurse.client.post(`/prescriptions/${draft.body.id}/authorize`)).status).toBe(403);
    expect((await vet.client.post(`/prescriptions/${draft.body.id}/authorize`)).body.status).toBe('AUTHORIZED');

    const ctl = await org.owner.post('/products', { name: 'Controlled test injection', strengthValue: 10, strengthUnit: 'mg', dispensingUnit: 'mL', minDispenseIncrement: 0.1, isControlled: true, controlledSchedule: 'Test schedule' });
    const res = await nurse.client.post('/prescriptions', { patientId: patient.id, items: [item(ctl.body.id, { route: 'IM', frequencyCode: 'ONCE', durationDays: null })] });
    expect(res.status).toBe(403);
  });

  it('dispenses only authorised prescriptions, tracks partial dispensing and blocks over-dispensing', async () => {
    const { org, vet, patient, product } = await setup();
    const pharm = await staff(org, 'pharmacy');
    const reception = await staff(org, 'receptionist');
    const draft = await vet.client.post('/prescriptions', { patientId: patient.id, items: [item(product.id)] });
    const itemId = draft.body.items[0].id;
    expect((await pharm.client.post(`/prescriptions/${draft.body.id}/dispense`, { lines: [{ itemId, quantity: 5 }] })).body.error.code).toBe('NOT_DISPENSABLE');
    await vet.client.post(`/prescriptions/${draft.body.id}/authorize`);
    expect((await reception.client.post(`/prescriptions/${draft.body.id}/dispense`, { lines: [{ itemId, quantity: 5 }] })).status).toBe(403);
    const part = await pharm.client.post(`/prescriptions/${draft.body.id}/dispense`, { lines: [{ itemId, quantity: 10, batchNumber: 'B123', expiryDate: '2030-01-01' }] });
    expect(part.body.status).toBe('PARTIALLY_DISPENSED');
    expect(part.body.items[0].remaining).toBe(7.5);
    expect((await pharm.client.post(`/prescriptions/${draft.body.id}/dispense`, { lines: [{ itemId, quantity: 8 }] })).body.error.code).toBe('OVER_DISPENSE');
    expect((await pharm.client.post(`/prescriptions/${draft.body.id}/dispense`, { lines: [{ itemId, quantity: 1, expiryDate: '2020-01-01' }] })).body.error.code).toBe('EXPIRED_BATCH');
    const done = await pharm.client.post(`/prescriptions/${draft.body.id}/dispense`, { lines: [{ itemId, quantity: 7.5 }] });
    expect(done.body.status).toBe('DISPENSED');
    expect(done.body.items[0].dispensations).toHaveLength(2);
    // Handed out at the shop counter: the waiting charges are invoiced with the sale, once.
    const waiting = await vet.client.get(`/charges?clientId=${done.body.client.id}&status=PENDING&pageSize=50`);
    const fromRx = waiting.body.data.filter((c: { sourceType: string }) => c.sourceType === 'Dispensation');
    expect(fromRx).toHaveLength(2);
    const sale = await vet.client.post('/invoices', {
      isPos: true,
      clientId: done.body.client.id,
      chargeIds: fromRx.map((c: { id: string }) => c.id),
      lines: [{ kind: 'CUSTOM', description: 'Carrier box', quantity: 1, unitPriceMinor: 500 }],
      issue: true,
    });
    expect(sale.status).toBe(201);
    expect(sale.body.lines).toHaveLength(3);
    expect(sale.body.isPos).toBe(true);
    const after = await vet.client.get(`/charges?clientId=${done.body.client.id}&status=PENDING&pageSize=50`);
    expect(after.body.data.filter((c: { sourceType: string }) => c.sourceType === 'Dispensation')).toHaveLength(0);
    const again = await vet.client.post('/invoices', { isPos: true, clientId: done.body.client.id, chargeIds: [fromRx[0].id], lines: [], issue: true });
    expect(again.status).toBeGreaterThanOrEqual(400); // the same medicine is never billed twice
    expect((await vet.client.post(`/prescriptions/${draft.body.id}/cancel`, { reason: 'x' })).status).toBe(422);
    const rep = await vet.client.post(`/prescriptions/${draft.body.id}/repeat`);
    expect(rep.body).toMatchObject({ status: 'DRAFT', repeatOfId: draft.body.id });
    // The shop counter lists one client's prescriptions.
    const mine = await vet.client.get(`/prescriptions?clientId=${rep.body.client.id}&pageSize=50`);
    expect(mine.status).toBe(200);
    expect(mine.body.data.map((x: { id: string }) => x.id)).toContain(rep.body.id);
    expect((await vet.client.get('/prescriptions?clientId=00000000-0000-4000-8000-000000000000')).body.data).toHaveLength(0);
    // Repeated from inside a consultation: attached to that consultation, and only to this patient's.
    const visit = await vet.client.post('/encounters', { patientId: patient.id });
    expect(visit.status).toBe(201);
    const inVisit = await vet.client.post(`/prescriptions/${draft.body.id}/repeat`, { encounterId: visit.body.id });
    expect(inVisit.body).toMatchObject({ status: 'DRAFT', repeatOfId: draft.body.id, encounterId: visit.body.id });
    expect((await vet.client.post(`/prescriptions/${draft.body.id}/repeat`, { encounterId: '00000000-0000-4000-8000-000000000000' })).body.error.code).toBe('INVALID_ENCOUNTER');
  });

  it('freezes authorised prescription items at the database level', async () => {
    const { vet, patient, product } = await setup();
    const rx = await vet.client.post('/prescriptions', { patientId: patient.id, items: [item(product.id)], authorize: true });
    await expect(prisma().prescriptionItem.update({ where: { id: rx.body.items[0].id }, data: { doseValue: 50 } })).rejects.toThrow(/immutable/);
    await expect(prisma().prescriptionItem.delete({ where: { id: rx.body.items[0].id } })).rejects.toThrow(/cannot be removed/);
  });

  it('records in-clinic administration and starts withdrawal periods for food-producing animals', async () => {
    const org = await registerOrg();
    const vet = await staff(org, 'veterinarian', { isClinician: true });
    const farm = await makeClient(org.owner, { type: 'FARM', organizationName: 'Test Dairy', lastName: 'Farmer' });
    const cow = await makePatient(org.owner, farm.id, { name: 'Daisy', speciesId: await speciesId(org.owner, 'Cattle'), initialWeightKg: 450 });
    const inj = await org.owner.post('/products', { name: 'Test bovine injection', strengthValue: 100, strengthUnit: 'mg', dispensingUnit: 'mL', minDispenseIncrement: 0.5, targetSpecies: ['LIVESTOCK'] });
    expect((await org.owner.post(`/products/${inj.body.id}/withdrawals`, { speciesId: await speciesId(org.owner, 'Cattle'), meatDays: 28, milkHours: 96, source: 'Test label' })).status).toBe(201);
    const a = await vet.client.post('/administrations', { patientId: cow.id, productId: inj.body.id, dose: 20, doseUnit: 'mL', route: 'IM', batchNumber: 'L77' });
    expect(a.status).toBe(201);
    const w = (await vet.client.get(`/patients/${cow.id}/withdrawals`)).body;
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ meatActive: true, milkActive: true, source: 'Test label' });
    const meatDays = (new Date(w[0].meatClearAt).getTime() - new Date(w[0].treatedAt).getTime()) / 86400_000;
    expect(meatDays).toBe(28);
    // product labelled for livestock only → species warning for a dog
    const dogClient = await makeClient(org.owner);
    const dog = await makePatient(org.owner, dogClient.id, { initialWeightKg: 20 });
    const ev = await vet.client.post('/prescriptions/evaluate', { patientId: dog.id, item: item(inj.body.id, { route: 'IM' }) });
    expect(ev.body.warnings.map((x: any) => x.code)).toContain('SPECIES');
    expect((await vet.client.post('/administrations', { patientId: dog.id, productId: inj.body.id, dose: 1, doseUnit: 'mL', route: 'IM', status: 'NOT_GIVEN' })).body.error.code).toBe('REASON_REQUIRED');
  });

  it('charges an in-clinic dose recorded in mg in tablets, using the product strength', async () => {
    const { vet, patient, product } = await setup(); // 50 mg per tablet, smallest amount 0.25 tablet
    const a = await vet.client.post('/administrations', { patientId: patient.id, productId: product.id, dose: 100, doseUnit: 'mg', route: 'PO' });
    expect(a.status).toBe(201);
    const charge = await prisma().charge.findFirst({ where: { sourceType: 'Administration', sourceId: a.body.id } });
    expect(Number(charge?.quantity)).toBe(2);
    // 30 mg = 0.6 tablet → rounded up to the smallest dispensable amount (0.75)
    const b = await vet.client.post('/administrations', { patientId: patient.id, productId: product.id, dose: 30, doseUnit: 'mg', route: 'PO' });
    expect(Number((await prisma().charge.findFirst({ where: { sourceType: 'Administration', sourceId: b.body.id } }))?.quantity)).toBe(0.75);
    // A unit that cannot be converted is still billed (one selling unit) but not taken from stock.
    const movements = () => prisma().stockMovement.count({ where: { referenceType: 'Administration' } });
    const before = await movements();
    const c = await vet.client.post('/administrations', { patientId: patient.id, productId: product.id, dose: 1, doseUnit: 'mL', route: 'PO' });
    expect(Number((await prisma().charge.findFirst({ where: { sourceType: 'Administration', sourceId: c.body.id } }))?.quantity)).toBe(1);
    expect(await movements()).toBe(before);
    // The vet's own amount to bill wins; 0 means free of charge.
    const d = await vet.client.post('/administrations', { patientId: patient.id, productId: product.id, dose: 1, doseUnit: 'mL', route: 'PO', billQuantity: 3 });
    expect(d.body.error ?? null).toBeNull();
    expect(Number((await prisma().charge.findFirst({ where: { sourceType: 'Administration', sourceId: d.body.id } }))?.quantity)).toBe(3);
    const free = await vet.client.post('/administrations', { patientId: patient.id, productId: product.id, dose: 100, doseUnit: 'mg', route: 'PO', billQuantity: 0 });
    expect(await prisma().charge.count({ where: { sourceType: 'Administration', sourceId: free.body.id } })).toBe(0);
  });

  it('isolates prescriptions between organizations', async () => {
    const a = await setup();
    const b = await registerOrg();
    const rx = await a.vet.client.post('/prescriptions', { patientId: a.patient.id, items: [item(a.product.id)] });
    expect((await b.owner.get(`/prescriptions/${rx.body.id}`)).status).toBe(404);
    const bClient = await makeClient(b.owner);
    const bPatient = await makePatient(b.owner, bClient.id, { initialWeightKg: 10 });
    expect((await b.owner.post('/prescriptions', { patientId: bPatient.id, items: [item(a.product.id)] })).status).toBe(422);
  });
});
