import { closeApp, inDays, makeClient, makePatient, prisma, registerOrg, staff, stockFixture } from './helpers';

const rxItem = (productId: string, extra: Record<string, unknown> = {}) => ({ productId, route: 'PO', doseValue: 1, doseUnit: 'tablet', frequencyCode: 'ONCE', instructions: 'Test', ...extra });

async function prescribeAndDispense(org: any, vet: any, productId: string, qty: number, patientId: string) {
  const rx = await vet.client.post('/prescriptions', { patientId, items: [rxItem(productId, { quantity: qty })], authorize: true });
  if (rx.status !== 201) throw new Error(JSON.stringify(rx.body));
  return org.owner.post(`/prescriptions/${rx.body.id}/dispense`, { lines: [{ itemId: rx.body.items[0].id, quantity: qty }] });
}

describe('Inventory & procurement', () => {
  afterAll(closeApp);

  it('receives batches and issues first-expiry-first-out, skipping expired and quarantined stock', async () => {
    const org = await registerOrg();
    const vet = await staff(org, 'veterinarian', { isClinician: true });
    const f = await stockFixture(org);
    const patient = await makePatient(org.owner, (await makeClient(org.owner)).id);
    const grn = await org.owner.post('/stock/receipts', {
      supplierId: f.supplierId,
      locationId: f.locationId,
      supplierInvoiceNo: 'SUP-1',
      lines: [
        { productId: f.product.id, batchNumber: 'LATE', expiryDate: inDays(300), quantity: 10, unitCostMinor: 200 },
        { productId: f.product.id, batchNumber: 'SOON', expiryDate: inDays(30), quantity: 4, unitCostMinor: 220 },
        { productId: f.product.id, batchNumber: 'QUAR', expiryDate: inDays(10), quantity: 5, unitCostMinor: 210 },
      ],
    });
    expect(grn.status).toBe(201);
    expect(grn.body).toMatchObject({ totalMinor: 10 * 200 + 4 * 220 + 5 * 210 });
    expect(grn.body.receiptNo).toMatch(/^GRN-\d{6}$/);
    expect((await org.owner.post('/stock/receipts', { supplierId: f.supplierId, locationId: f.locationId, lines: [{ productId: f.product.id, batchNumber: 'OLD', expiryDate: inDays(-1), quantity: 1, unitCostMinor: 1 }] })).body.error.code).toBe('EXPIRED_ON_RECEIPT');

    const stock = (await org.owner.get(`/stock/products/${f.product.id}`)).body;
    const quar = stock.batches.find((b: any) => b.batchNumber === 'QUAR');
    expect((await org.owner.post(`/stock/batches/${quar.id}/status`, { status: 'QUARANTINED' })).body.error.code).toBe('REASON_REQUIRED');
    await org.owner.post(`/stock/batches/${quar.id}/status`, { status: 'QUARANTINED', reason: 'Cold chain breach' });

    const d = await prescribeAndDispense(org, vet, f.product.id, 6, patient.id);
    expect(d.status).toBe(200);
    const ledger = (await org.owner.get(`/stock/movements?productId=${f.product.id}&type=DISPENSE`)).body.data;
    const taken = Object.fromEntries(ledger.map((m: any) => [m.batch.batchNumber, -m.quantity]));
    expect(taken).toEqual({ SOON: 4, LATE: 2 });
    const overview = (await org.owner.get('/stock')).body.data.find((p: any) => p.id === f.product.id);
    expect(overview).toMatchObject({ onHand: 13, available: 8, unusable: 5 });
  });

  it('records the batch actually issued on the dispensing record and rejects batches that are not in stock', async () => {
    const org = await registerOrg();
    const vet = await staff(org, 'veterinarian', { isClinician: true });
    const f = await stockFixture(org);
    const patient = await makePatient(org.owner, (await makeClient(org.owner)).id);
    await org.owner.post('/stock/receipts', { supplierId: f.supplierId, locationId: f.locationId, lines: [{ productId: f.product.id, batchNumber: 'REAL-1', expiryDate: inDays(200), quantity: 10, unitCostMinor: 100 }] });
    const rx = await vet.client.post('/prescriptions', { patientId: patient.id, items: [rxItem(f.product.id, { quantity: 4 })], authorize: true });
    const bad = await org.owner.post(`/prescriptions/${rx.body.id}/dispense`, { lines: [{ itemId: rx.body.items[0].id, quantity: 2, batchNumber: 'TYPO-9' }] });
    expect(bad.body.error.code).toBe('UNKNOWN_BATCH');
    expect((await org.owner.post(`/prescriptions/${rx.body.id}/dispense`, { lines: [{ itemId: rx.body.items[0].id, quantity: 2 }] })).status).toBe(200);
    const d = await prisma().dispensation.findFirstOrThrow({ where: { item: { prescriptionId: rx.body.id } } });
    expect(d.batchNumber).toBe('REAL-1');
    expect(d.expiryDate?.toISOString().slice(0, 10)).toBe(inDays(200));
  });

  it('blocks dispensing beyond usable stock unless the organization allows negative stock', async () => {
    const org = await registerOrg();
    const vet = await staff(org, 'veterinarian', { isClinician: true });
    const f = await stockFixture(org);
    const patient = await makePatient(org.owner, (await makeClient(org.owner)).id);
    await org.owner.post('/stock/receipts', { supplierId: f.supplierId, locationId: f.locationId, lines: [{ productId: f.product.id, batchNumber: 'B1', quantity: 3, unitCostMinor: 100 }] });
    const res = await prescribeAndDispense(org, vet, f.product.id, 5, patient.id);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
    // nothing was dispensed or charged
    expect((await org.owner.get('/charges?status=ALL')).body.meta.total).toBe(0);
    await org.owner.patch('/billing/settings', { allowNegativeStock: true });
    expect((await prescribeAndDispense(org, vet, f.product.id, 5, patient.id)).status).toBe(200);
    expect((await org.owner.get(`/stock/products/${f.product.id}`)).body.batches[0].onHand).toBe(-2);
  });

  it('prevents two concurrent issues from selling the same last units (row locks)', async () => {
    const org = await registerOrg();
    const vet = await staff(org, 'veterinarian', { isClinician: true });
    const f = await stockFixture(org);
    const patient = await makePatient(org.owner, (await makeClient(org.owner)).id);
    await org.owner.post('/stock/receipts', { supplierId: f.supplierId, locationId: f.locationId, lines: [{ productId: f.product.id, batchNumber: 'LAST', quantity: 5, unitCostMinor: 100 }] });
    const rxs = await Promise.all([1, 2].map(() => vet.client.post('/prescriptions', { patientId: patient.id, items: [rxItem(f.product.id, { quantity: 5 })], authorize: true })));
    const results = await Promise.all(rxs.map((rx) => org.owner.post(`/prescriptions/${rx.body.id}/dispense`, { lines: [{ itemId: rx.body.items[0].id, quantity: 5 }] })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 422]);
    expect((await org.owner.get(`/stock/products/${f.product.id}`)).body.batches[0].onHand).toBe(0);
  });

  it('adjusts, writes off, transfers and counts stock with an append-only ledger', async () => {
    const org = await registerOrg();
    const f = await stockFixture(org);
    const reception = await staff(org, 'receptionist');
    const ward = await org.owner.post('/stock-locations', { branchId: org.branchId, name: 'Ward', type: 'WARD' });
    await org.owner.post('/stock/receipts', { supplierId: f.supplierId, locationId: f.locationId, lines: [{ productId: f.product.id, batchNumber: 'A1', expiryDate: inDays(100), quantity: 20, unitCostMinor: 150 }] });
    const batch = (await org.owner.get(`/stock/products/${f.product.id}`)).body.batches[0];
    expect((await reception.client.post('/stock/adjustments', { batchId: batch.id, locationId: f.locationId, quantity: -1, reason: 'DAMAGED' })).status).toBe(403);
    expect((await org.owner.post('/stock/adjustments', { batchId: batch.id, locationId: f.locationId, quantity: 2, reason: 'DAMAGED' })).body.error.code).toBe('SIGN');
    expect((await org.owner.post('/stock/adjustments', { batchId: batch.id, locationId: f.locationId, quantity: -2, reason: 'DAMAGED', notes: 'Crushed' })).body.type).toBe('WRITE_OFF');
    expect((await org.owner.post('/stock/transfers', { batchId: batch.id, fromLocationId: f.locationId, toLocationId: ward.body.id, quantity: 5 })).status).toBe(201);
    expect((await org.owner.post('/stock/transfers', { batchId: batch.id, fromLocationId: f.locationId, toLocationId: ward.body.id, quantity: 50 })).body.error.code).toBe('INSUFFICIENT_STOCK');

    const count = await org.owner.post('/stock/counts', { locationId: f.locationId });
    const detail = (await org.owner.get(`/stock/counts/${count.body.id}`)).body;
    expect(detail.lines[0].expectedQty).toBe(13);
    expect((await org.owner.post(`/stock/counts/${count.body.id}/complete`)).body.error.code).toBe('COUNT_INCOMPLETE');
    await org.owner.patch(`/stock/counts/${count.body.id}`, { lines: [{ lineId: detail.lines[0].id, countedQty: 12 }] });
    const done = await org.owner.post(`/stock/counts/${count.body.id}/complete`);
    expect(done.body).toMatchObject({ status: 'COMPLETED', adjusted: 1 });
    const levels = (await org.owner.get(`/stock/products/${f.product.id}`)).body.batches[0].levels;
    expect(Object.fromEntries(levels.map((l: any) => [l.location.name, l.quantity]))).toMatchObject({ Ward: 5 });
    const mv = await prisma().stockMovement.findFirstOrThrow({ where: { productId: f.product.id } });
    await expect(prisma().stockMovement.update({ where: { id: mv.id }, data: { quantity: 999 } })).rejects.toThrow(/append-only/);
    const writeOffs = (await org.owner.get(`/reports/write-offs?from=${inDays(-1)}&to=${inDays(1)}`)).body;
    expect(writeOffs.totalMinor).toBe(300);
  });

  it('runs purchase orders with approval by a different person and partial receipt', async () => {
    const org = await registerOrg();
    const f = await stockFixture(org);
    const manager = await staff(org, 'practice_manager');
    const po = await org.owner.post('/purchase-orders', { supplierId: f.supplierId, locationId: f.locationId, lines: [{ productId: f.product.id, quantity: 10, unitCostMinor: 180 }] });
    expect(po.status).toBe(201);
    expect(po.body).toMatchObject({ status: 'DRAFT', totalMinor: 1800 });
    expect((await org.owner.post(`/purchase-orders/${po.body.id}/approve`)).body.error.code).toBe('INVALID_TRANSITION');
    await org.owner.post(`/purchase-orders/${po.body.id}/submit`);
    expect((await org.owner.post(`/purchase-orders/${po.body.id}/approve`)).status).toBe(403);
    expect((await manager.client.post(`/purchase-orders/${po.body.id}/approve`)).body.status).toBe('APPROVED');
    const lineId = po.body.lines[0].id;
    const r1 = await org.owner.post('/stock/receipts', { supplierId: f.supplierId, locationId: f.locationId, purchaseOrderId: po.body.id, lines: [{ productId: f.product.id, purchaseOrderLineId: lineId, batchNumber: 'P1', quantity: 6, unitCostMinor: 180 }] });
    expect(r1.status).toBe(201);
    expect((await org.owner.get(`/purchase-orders/${po.body.id}`)).body.status).toBe('PARTIALLY_RECEIVED');
    expect((await org.owner.post('/stock/receipts', { supplierId: f.supplierId, locationId: f.locationId, purchaseOrderId: po.body.id, lines: [{ productId: f.product.id, purchaseOrderLineId: lineId, batchNumber: 'P2', quantity: 5, unitCostMinor: 180 }] })).body.error.code).toBe('OVER_RECEIPT');
    await org.owner.post('/stock/receipts', { supplierId: f.supplierId, locationId: f.locationId, purchaseOrderId: po.body.id, lines: [{ productId: f.product.id, purchaseOrderLineId: lineId, batchNumber: 'P1', quantity: 4, unitCostMinor: 230 }] });
    const final = (await org.owner.get(`/purchase-orders/${po.body.id}`)).body;
    expect(final.status).toBe('RECEIVED');
    // weighted average cost of batch P1: (6×180 + 4×230) / 10 = 200
    expect((await org.owner.get(`/stock/products/${f.product.id}`)).body.batches[0].unitCostMinor).toBe(200);
    const bal = (await org.owner.get(`/suppliers/${f.supplierId}`)).body;
    expect(bal.receivedMinor).toBe(6 * 180 + 4 * 230);
  });

  it('leaves dispensing unaffected where inventory has not been set up, and isolates stock between organizations', async () => {
    const org = await registerOrg();
    const vet = await staff(org, 'veterinarian', { isClinician: true });
    const product = await org.owner.post('/products', { name: 'Untracked tabs', strengthValue: 10, strengthUnit: 'mg', dispensingUnit: 'tablet', minDispenseIncrement: 1 });
    const patient = await makePatient(org.owner, (await makeClient(org.owner)).id);
    expect((await prescribeAndDispense(org, vet, product.body.id, 2, patient.id)).status).toBe(200);
    const other = await registerOrg();
    expect((await other.owner.get(`/stock/products/${product.body.id}`)).status).toBe(404);
  });
});
