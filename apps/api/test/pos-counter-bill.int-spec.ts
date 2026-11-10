import { closeApp, makeClient, makePatient, prisma, registerOrg, staff } from './helpers';

// Product strengths, doses and prices below are ARITHMETIC TEST FIXTURES, not clinical guidance.
describe('Consultation → shop counter bill', () => {
  afterAll(closeApp);

  it('lists who is ready to pay, shows the visit charges and the typed prescription, and sells shop medicine on it', async () => {
    const org = await registerOrg();
    const vet = await staff(org, 'veterinarian', { isClinician: true });
    const client = await makeClient(org.owner);
    const patient = await makePatient(org.owner, client.id, { initialWeightKg: 10 });
    const given = (await org.owner.post('/products', { name: 'Givenmycin 50 mg tablets', type: 'MEDICINE', form: 'TABLET', strengthValue: 50, strengthUnit: 'mg', dispensingUnit: 'tablet', minDispenseIncrement: 1, activeIngredients: ['Givenmycin'], sellPriceMinor: 3000 })).body;
    // A prescription-only medicine on the shop's shelf.
    const shelf = (await org.owner.post('/products', { name: 'Shelfomycin 250 mg tablets', type: 'MEDICINE', form: 'TABLET', strengthValue: 250, strengthUnit: 'mg', dispensingUnit: 'tablet', minDispenseIncrement: 1, activeIngredients: ['Shelfomycin'], sellPriceMinor: 1000, requiresPrescription: true })).body;
    expect(shelf.requiresPrescription).toBe(true);

    // The consultation: a consultation fee, a medicine given in the clinic, and a typed prescription (no stock item).
    const visit = await vet.client.post('/encounters', { patientId: patient.id });
    await prisma().charge.create({
      data: { organizationId: org.orgId, branchId: org.branchId, clientId: client.id, patientId: patient.id, encounterId: visit.body.id, sourceType: 'Encounter', sourceId: visit.body.id, kind: 'SERVICE', description: 'Consultation fee', quantity: 1, unitPriceMinor: 200000, taxRateBasisPoints: 0 },
    });
    expect((await vet.client.post('/administrations', { patientId: patient.id, encounterId: visit.body.id, productId: given.id, dose: 1, doseUnit: 'tablet', route: 'PO', billQuantity: 2, stockOverrideReason: 'Test stock' })).status).toBe(201);
    const rx = await vet.client.post('/prescriptions', {
      patientId: patient.id,
      encounterId: visit.body.id,
      authorize: true,
      items: [{ outsideName: 'Shelfomycin 250 mg tablets', route: 'PO', doseValue: 1, doseUnit: 'tablet', frequencyCode: 'BID', durationDays: 5, instructions: 'Give 1 tablet by mouth 2 times a day for 5 days.' }],
    });
    expect(rx.status).toBe(201);

    // The counter: the client is ready to pay.
    const waiting = await org.owner.get('/pos/waiting');
    expect(waiting.status).toBe(200);
    expect(waiting.body).toEqual([expect.objectContaining({ client: expect.objectContaining({ id: client.id }), patients: [patient.name], status: 'TO_PAY', charges: 2, prescribed: 1, invoices: [] })]);

    // Their bill: the visit charges in sections, and the prescription to read.
    const bill = (await org.owner.get(`/pos/bill/${client.id}`)).body;
    expect(bill.charges.map((c: { section: string; description: string }) => [c.section, c.description])).toEqual(
      expect.arrayContaining([
        ['SERVICES', 'Consultation fee'],
        ['GIVEN', expect.stringContaining('Givenmycin')],
      ]),
    );
    expect(bill.prescriptions).toEqual([
      expect.objectContaining({ id: rx.body.id, prescriber: expect.any(String), items: [expect.objectContaining({ name: 'Shelfomycin 250 mg tablets', productId: null, instructions: 'Give 1 tablet by mouth 2 times a day for 5 days.', quantity: 10 })] }),
    ]);

    // Prescription-only stock cannot be sold to someone without a prescription …
    const shelfLine = { kind: 'PRODUCT', productId: shelf.id, quantity: 6 };
    expect((await org.owner.post('/invoices', { isPos: true, clientId: client.id, lines: [shelfLine], issue: true })).body.error.code).toBe('PRESCRIPTION_REQUIRED');
    // … nor against another client's prescription.
    const other = await makeClient(org.owner);
    expect((await org.owner.post('/invoices', { isPos: true, clientId: other.id, lines: [{ ...shelfLine, prescriptionId: rx.body.id }], issue: true })).body.error.code).toBe('INVALID_PRESCRIPTION');

    // The cashier reads the prescription, adds 6 tablets from the shop, gives Rs 500 off the fee: one invoice.
    const fee = bill.charges.find((c: { description: string }) => c.description === 'Consultation fee');
    const inv = await org.owner.post('/invoices', {
      isPos: true,
      clientId: client.id,
      chargeIds: bill.charges.map((c: { id: string }) => c.id),
      chargeDiscounts: [{ chargeId: fee.id, discountMinor: 50000 }],
      lines: [{ ...shelfLine, prescriptionId: rx.body.id }],
      issue: true,
    });
    expect(inv.status).toBe(201);
    expect(inv.body.lines.find((l: { description: string }) => l.description === 'Consultation fee')).toMatchObject({ discountMinor: 50000 });
    // 2,000 − 500 + 2 × 30 + 6 × 10 (no tax in this clinic's test setup).
    expect(inv.body.totalMinor).toBe(200000 - 50000 + 2 * 3000 + 6 * 1000);
    expect(inv.body.notes).toContain(`Sold on prescription: Shelfomycin 250 mg tablets — ${rx.body.prescriptionNo}`);
    expect((await org.owner.get(`/pos/bill/${client.id}`)).body.charges).toEqual([]);
    // Checked out: the visit leaves the "to pay" list and shows as done, with its invoice, for the record.
    expect((await org.owner.get('/pos/waiting')).body).toEqual([
      expect.objectContaining({ client: expect.objectContaining({ id: client.id }), status: 'DONE', charges: 0, invoices: [expect.objectContaining({ id: inv.body.id, invoiceNo: inv.body.invoiceNo, totalMinor: inv.body.totalMinor })] }),
    ]);
    // Another prescription later in the day puts them back on the list until the next sale.
    const again = await vet.client.post('/prescriptions', { patientId: patient.id, authorize: true, items: [{ outsideName: 'Laterol drops', route: 'TOPICAL', doseValue: 2, doseUnit: 'drop', frequencyCode: 'BID', durationDays: 3, instructions: 'Two drops twice a day for 3 days.' }] });
    expect(again.status).toBe(201);
    expect((await org.owner.get('/pos/waiting')).body[0]).toMatchObject({ status: 'TO_PAY', prescribed: 2 });

    // Point-of-sale staff see who is ready to pay.
    const shop = await staff(org, 'pharmacy');
    expect((await shop.client.get('/pos/waiting')).status).toBe(200);
  });
});
