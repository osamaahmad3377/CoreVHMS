import { closeApp, inDays, prisma, registerOrg, staff, stockFixture } from './helpers';

// Quantities and costs are arbitrary test values.
describe('Purchase requests & supplier returns', () => {
  afterAll(closeApp);

  it('returns recalled stock to its supplier: stock and the supplier balance fall, cost of goods does not change', async () => {
    const org = await registerOrg();
    const f = await stockFixture(org);
    const otherSupplier = (await org.owner.post('/suppliers', { name: 'Other Supplier' })).body;
    const grn = await org.owner.post('/stock/receipts', { supplierId: f.supplierId, locationId: f.locationId, lines: [{ productId: f.product.id, batchNumber: 'RET-1', expiryDate: inDays(200), quantity: 10, unitCostMinor: 150 }] });
    expect(grn.status).toBe(201);
    await org.owner.post('/stock/receipts', { supplierId: otherSupplier.id, locationId: f.locationId, lines: [{ productId: f.product.id, batchNumber: 'OTHER-1', expiryDate: inDays(200), quantity: 5, unitCostMinor: 90 }] });
    const batch = await prisma().stockBatch.findFirstOrThrow({ where: { organizationId: org.orgId, batchNumber: 'RET-1' } });
    const other = await prisma().stockBatch.findFirstOrThrow({ where: { organizationId: org.orgId, batchNumber: 'OTHER-1' } });
    expect((await org.owner.post(`/stock/batches/${batch.id}/status`, { status: 'RECALLED', reason: 'Manufacturer recall notice' })).status).toBe(200);

    const returnable = (await org.owner.get(`/supplier-returns/returnable?supplierId=${f.supplierId}&locationId=${f.locationId}`)).body;
    expect(returnable).toEqual([expect.objectContaining({ batchId: batch.id, batchNumber: 'RET-1', status: 'RECALLED', onHand: 10, unitCostMinor: 150 })]);
    const ret = await org.owner.post('/supplier-returns', { supplierId: f.supplierId, locationId: f.locationId, reason: 'Manufacturer recall', reference: 'RMA-77', lines: [{ batchId: batch.id, quantity: 4 }] });
    expect(ret.status).toBe(201);
    expect(ret.body).toMatchObject({ returnNo: expect.stringMatching(/^SRN-/), totalMinor: 600, lines: [expect.objectContaining({ quantity: 4, unitCostMinor: 150, totalMinor: 600 })] });
    const level = await prisma().stockLevel.findFirstOrThrow({ where: { batchId: batch.id, locationId: f.locationId } });
    expect(Number(level.quantity)).toBe(6);
    const mv = await prisma().stockMovement.findFirstOrThrow({ where: { referenceId: ret.body.id } });
    expect(mv).toMatchObject({ type: 'RETURN_TO_SUPPLIER', referenceType: 'SupplierReturn' });
    expect(Number(mv.quantity)).toBe(-4);

    const account = (await org.owner.get(`/suppliers/${f.supplierId}`)).body;
    expect(account).toMatchObject({ receivedMinor: 1500, returnedMinor: 600, balanceMinor: 900 });
    expect(account.returns).toHaveLength(1);
    expect((await org.owner.get(`/reports/financial-summary?from=${inDays(-1)}&to=${inDays(1)}`)).body.costOfGoodsMinor).toBe(0);

    // Refusals leave no partial return behind.
    const before = await prisma().supplierReturn.count({ where: { organizationId: org.orgId } });
    expect((await org.owner.post('/supplier-returns', { supplierId: f.supplierId, locationId: f.locationId, reason: 'Too many', lines: [{ batchId: batch.id, quantity: 7 }] })).body.error.code).toBe('INSUFFICIENT_STOCK');
    expect((await org.owner.post('/supplier-returns', { supplierId: f.supplierId, locationId: f.locationId, reason: 'Wrong supplier', lines: [{ batchId: other.id, quantity: 1 }] })).body.error.code).toBe('SUPPLIER_MISMATCH');
    expect(await prisma().supplierReturn.count({ where: { organizationId: org.orgId } })).toBe(before);

    // A return is a completed record: never edited or deleted.
    await expect(prisma().supplierReturn.update({ where: { id: ret.body.id }, data: { reason: 'changed' } })).rejects.toThrow(/append-only/);
    await expect(prisma().supplierReturnLine.deleteMany({ where: { supplierReturnId: ret.body.id } })).rejects.toThrow(/append-only/);

    // Permissions and clinic separation.
    const rec = await staff(org, 'receptionist');
    expect((await rec.client.post('/supplier-returns', { supplierId: f.supplierId, locationId: f.locationId, reason: 'x x x', lines: [{ batchId: batch.id, quantity: 1 }] })).status).toBe(403);
    const officer = await staff(org, 'inventory_officer');
    expect((await officer.client.get('/supplier-returns')).body).toHaveLength(1);
    const otherOrg = await registerOrg();
    expect((await otherOrg.owner.get('/supplier-returns')).body).toEqual([]);
    const loc2 = (await otherOrg.owner.post('/stock-locations', { branchId: otherOrg.branchId, name: 'Store', type: 'PHARMACY' })).body;
    const sup2 = (await otherOrg.owner.post('/suppliers', { name: 'Theirs' })).body;
    expect((await otherOrg.owner.post('/supplier-returns', { supplierId: sup2.id, locationId: loc2.id, reason: 'Steal', lines: [{ batchId: batch.id, quantity: 1 }] })).body.error.code).toBe('INVALID_BATCH');
  });

  it('turns staff requests into one draft purchase order; requests close only once', async () => {
    const org = await registerOrg();
    const f = await stockFixture(org);
    await org.owner.post('/stock/receipts', { supplierId: f.supplierId, locationId: f.locationId, lines: [{ productId: f.product.id, batchNumber: 'PRICE-1', expiryDate: inDays(200), quantity: 1, unitCostMinor: 275 }] });
    const nurse = await staff(org, 'nurse');
    const vet = await staff(org, 'veterinarian', { isClinician: true });
    const officer = await staff(org, 'inventory_officer');

    const r1 = await nurse.client.post('/purchase-requests', { productId: f.product.id, quantity: 20, reason: 'Ward running low', neededBy: inDays(5) });
    expect(r1.status).toBe(201);
    expect(r1.body).toMatchObject({ requestNo: expect.stringMatching(/^PR-/), status: 'OPEN', quantity: 20, requestedByName: 'Test nurse' });
    const r2 = (await vet.client.post('/purchase-requests', { productId: f.product.id, quantity: 5 })).body;
    // Asking is not ordering.
    expect((await nurse.client.post('/purchase-requests/order', { requestIds: [r1.body.id], supplierId: f.supplierId, locationId: f.locationId })).status).toBe(403);
    expect((await nurse.client.get('/purchase-orders')).status).toBe(403);
    expect((await nurse.client.post(`/purchase-requests/${r1.body.id}/reject`, { note: 'no thanks' })).status).toBe(403);

    const order = await officer.client.post('/purchase-requests/order', { requestIds: [r1.body.id, r2.id], supplierId: f.supplierId, locationId: f.locationId });
    expect(order.status).toBe(201);
    const po = (await officer.client.get(`/purchase-orders/${order.body.purchaseOrderId}`)).body;
    expect(po).toMatchObject({ status: 'DRAFT', totalMinor: 25 * 275, lines: [expect.objectContaining({ productId: f.product.id, quantity: 25, unitCostMinor: 275 })] });
    const listed = (await nurse.client.get('/purchase-requests')).body;
    expect(listed.filter((r: any) => r.status === 'ORDERED' && r.purchaseOrder?.id === po.id)).toHaveLength(2);
    expect((await officer.client.post('/purchase-requests/order', { requestIds: [r1.body.id], supplierId: f.supplierId, locationId: f.locationId })).body.error.code).toBe('INVALID_TRANSITION');
    expect((await officer.client.post(`/purchase-requests/${r1.body.id}/reject`, { note: 'too late' })).body.error.code).toBe('INVALID_TRANSITION');
    // The draft follows the normal approval rule (a different person approves).
    expect((await officer.client.post(`/purchase-orders/${po.id}/submit`)).status).toBe(200);
    expect((await org.owner.post(`/purchase-orders/${po.id}/approve`)).status).toBe(200);

    // Cancel your own request; others' only with procurement rights; rejection needs procurement rights.
    const r3 = (await nurse.client.post('/purchase-requests', { productId: f.product.id, quantity: 2 })).body;
    expect((await vet.client.post(`/purchase-requests/${r3.id}/cancel`, { note: 'not needed' })).body.error.code).toBe('NOT_YOUR_REQUEST');
    expect((await nurse.client.post(`/purchase-requests/${r3.id}/cancel`, { note: 'found some' })).body).toMatchObject({ status: 'CANCELLED' });
    const r4 = (await nurse.client.post('/purchase-requests', { productId: f.product.id, quantity: 2 })).body;
    expect((await officer.client.post(`/purchase-requests/${r4.id}/reject`, { note: 'use the substitute' })).body).toMatchObject({ status: 'REJECTED' });

    // Two people ordering the same request at the same moment: exactly one purchase order.
    const r5 = (await nurse.client.post('/purchase-requests', { productId: f.product.id, quantity: 3 })).body;
    const poCount = await prisma().purchaseOrder.count({ where: { organizationId: org.orgId } });
    const both = await Promise.all([
      officer.client.post('/purchase-requests/order', { requestIds: [r5.id], supplierId: f.supplierId, locationId: f.locationId }),
      org.owner.post('/purchase-requests/order', { requestIds: [r5.id], supplierId: f.supplierId, locationId: f.locationId }),
    ]);
    expect(both.map((r) => r.status).sort()).toEqual([201, 422]);
    expect(await prisma().purchaseOrder.count({ where: { organizationId: org.orgId } })).toBe(poCount + 1);

    // Another clinic sees none of this.
    const other = await registerOrg();
    expect((await other.owner.get('/purchase-requests')).body).toEqual([]);
    expect((await other.owner.post(`/purchase-requests/${r5.id}/cancel`, { note: 'hijack' })).status).toBe(404);
  });
});
