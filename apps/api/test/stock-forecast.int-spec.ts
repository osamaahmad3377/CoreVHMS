import { closeApp, inDays, prisma, registerOrg, staff, stockFixture } from './helpers';

describe('Stock forecast: what runs out, supplier orders and branch transfers', () => {
  afterAll(closeApp);

  it('predicts the run-out, moves spare stock from another branch, and prepares the supplier order for the rest', async () => {
    const org = await registerOrg();
    const f = await stockFixture(org);
    const branchB = await org.owner.post('/branches', { name: 'Second branch', code: 'B2', timezone: 'Asia/Karachi' });
    expect(branchB.status).toBe(201);
    const locB = await org.owner.post('/stock-locations', { branchId: branchB.body.id, name: 'Store B', type: 'STORE', isDefault: true });
    expect(locB.status).toBe(201);

    // Branch A has 5 tablets and uses 2 a day; branch B has 30 and uses 1 a week.
    await org.owner.post('/stock/receipts', { supplierId: f.supplierId, locationId: f.locationId, lines: [{ productId: f.product.id, batchNumber: 'A-1', expiryDate: inDays(400), quantity: 5, unitCostMinor: 100 }] });
    await org.owner.post('/stock/receipts', { supplierId: f.supplierId, locationId: locB.body.id, lines: [{ productId: f.product.id, batchNumber: 'B-1', expiryDate: inDays(400), quantity: 30, unitCostMinor: 100 }] });
    const db = prisma();
    const batchA = await db.stockBatch.findFirstOrThrow({ where: { productId: f.product.id, batchNumber: 'A-1' } });
    const batchB = await db.stockBatch.findFirstOrThrow({ where: { productId: f.product.id, batchNumber: 'B-1' } });
    // Eight weeks of history written straight to the ledger (the API only records "now").
    const history = [];
    for (let w = 0; w < 8; w++) {
      const at = new Date(Date.now() - (w * 7 + 3) * 86400_000);
      history.push({ organizationId: org.orgId, branchId: org.branchId, productId: f.product.id, batchId: batchA.id, locationId: f.locationId, type: 'DISPENSE' as const, quantity: -14, balanceAfter: 0, createdAt: at });
      history.push({ organizationId: org.orgId, branchId: branchB.body.id, productId: f.product.id, batchId: batchB.id, locationId: locB.body.id, type: 'SALE' as const, quantity: -1, balanceAfter: 0, createdAt: at });
    }
    await db.stockMovement.createMany({ data: history });

    const fc = (await org.owner.get('/stock/forecast')).body;
    const a = fc.rows.find((r: any) => r.product.id === f.product.id && r.branch.id === org.branchId);
    const b = fc.rows.find((r: any) => r.product.id === f.product.id && r.branch.id === branchB.body.id);
    expect(a).toMatchObject({ status: 'RUNS_OUT', available: 5, weekly: 14, daysLeft: 2, supplier: { id: f.supplierId } });
    expect(b).toMatchObject({ status: 'OK', available: 30 });
    // Branch B can spare stock: moved first, the rest ordered from the supplier.
    const t = fc.transfers.find((x: any) => x.product.id === f.product.id);
    expect(t).toMatchObject({ reason: 'SHORTAGE', from: { id: branchB.body.id }, to: { id: org.branchId } });
    // A needs 17 days × 2 + 3 days' safety − 5 = 35; B keeps ~3 for itself and can spare 27.
    expect(a.need).toBe(35);
    expect(t.quantity).toBe(27);
    expect(a.transferIn).toBe(t.quantity);
    const order = fc.orders.find((o: any) => o.branch.id === org.branchId);
    expect(order.supplier.id).toBe(f.supplierId);
    expect(order.lines[0]).toMatchObject({ productId: f.product.id, quantity: 8, unitCostMinor: 100 });
    expect(fc.summary).toMatchObject({ runsOut: 1, transfers: 1 });
    // One branch only.
    const onlyB = (await org.owner.get(`/stock/forecast?branchId=${branchB.body.id}`)).body;
    expect(onlyB.rows.every((r: any) => r.branch.id === branchB.body.id)).toBe(true);
    expect(onlyB.transfers).toHaveLength(1);

    // Reception can look but not order or move stock.
    const reception = await staff(org, 'receptionist');
    expect((await reception.client.get('/stock/forecast')).status).toBe(200);
    expect((await reception.client.post('/stock/forecast/orders', { orders: [{ supplierId: f.supplierId, branchId: org.branchId, lines: order.lines }] })).status).toBe(403);
    expect((await reception.client.post('/stock/branch-transfers', { productId: f.product.id, fromBranchId: branchB.body.id, toBranchId: org.branchId, quantity: 1 })).status).toBe(403);

    // Move the spare stock.
    expect((await org.owner.post('/stock/branch-transfers', { productId: f.product.id, fromBranchId: branchB.body.id, toBranchId: org.branchId, quantity: 999 })).body.error.code).toBe('INSUFFICIENT_STOCK');
    const moved = await org.owner.post('/stock/branch-transfers', { productId: f.product.id, fromBranchId: branchB.body.id, toBranchId: org.branchId, quantity: t.quantity });
    expect(moved.status).toBe(201);
    expect(moved.body).toMatchObject({ quantity: t.quantity, batches: [{ batchNumber: 'B-1', quantity: t.quantity }] });
    const levels = await db.stockLevel.findMany({ where: { productId: f.product.id }, include: { location: true } });
    expect(Number(levels.find((l) => l.locationId === f.locationId && l.batchId === batchB.id)!.quantity)).toBe(t.quantity);
    expect(await db.stockMovement.count({ where: { productId: f.product.id, type: { in: ['TRANSFER_OUT', 'TRANSFER_IN'] } } })).toBe(2);

    // Prepare the supplier order: a draft purchase order delivered to branch A's store room.
    const prepared = await org.owner.post('/stock/forecast/orders', { orders: [{ supplierId: f.supplierId, branchId: org.branchId, lines: order.lines.map((l: any) => ({ productId: l.productId, quantity: l.quantity, unitCostMinor: l.unitCostMinor })) }] });
    expect(prepared.status).toBe(201);
    expect(prepared.body.created).toHaveLength(1);
    expect(prepared.body.created[0].poNo).toMatch(/^PO-\d{6}$/);
    const po = await db.purchaseOrder.findUniqueOrThrow({ where: { id: prepared.body.created[0].id }, include: { lines: true } });
    expect(po).toMatchObject({ status: 'DRAFT', locationId: f.locationId, branchId: org.branchId });
    expect(po.notes).toMatch(/stock forecast/);

    // After the move and the order, branch A no longer needs anything.
    const after = (await org.owner.get('/stock/forecast')).body;
    const a2 = after.rows.find((r: any) => r.product.id === f.product.id && r.branch.id === org.branchId);
    expect(a2.onOrder).toBe(Number(po.lines[0].quantity));
    expect(a2.order).toBe(0);
    expect(after.transfers.filter((x: any) => x.product.id === f.product.id && x.reason === 'SHORTAGE')).toHaveLength(0);
  });
});
