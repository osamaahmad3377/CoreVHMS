import { closeApp, inDays, prisma, registerOrg, staff, stockFixture } from './helpers';

// Quantities and costs are arbitrary test values.
async function setup() {
  const org = await registerOrg();
  const f = await stockFixture(org);
  const ctl = (await org.owner.post('/products', { name: 'Controlled test injection', strengthValue: 10, strengthUnit: 'mg', dispensingUnit: 'mL', minDispenseIncrement: 0.1, isControlled: true, controlledSchedule: 'Test schedule' })).body;
  const grn = await org.owner.post('/stock/receipts', {
    supplierId: f.supplierId,
    locationId: f.locationId,
    lines: [
      { productId: f.product.id, batchNumber: 'OLD', expiryDate: inDays(5), quantity: 10, unitCostMinor: 100 },
      { productId: f.product.id, batchNumber: 'SOON', expiryDate: inDays(20), quantity: 6, unitCostMinor: 100 },
      { productId: f.product.id, batchNumber: 'FRESH', expiryDate: inDays(400), quantity: 50, unitCostMinor: 100 },
      { productId: ctl.id, batchNumber: 'CD1', expiryDate: inDays(10), quantity: 5, unitCostMinor: 2000 },
    ],
  });
  expect(grn.status).toBe(201);
  const batch = async (n: string) => prisma().stockBatch.findFirstOrThrow({ where: { organizationId: org.orgId, batchNumber: n } });
  // OLD has expired while still on the shelf (stock can't be received already expired).
  await prisma().stockBatch.update({ where: { id: (await batch('OLD')).id }, data: { expiryDate: new Date(inDays(-3)) } });
  return { org, f, ctl, batch };
}

describe('Disposal of expired and unusable stock', () => {
  afterAll(closeApp);

  it('lists expired, expiring and recalled stock, and disposes of it with a permanent record', async () => {
    const s = await setup();
    const recalled = await s.batch('FRESH');
    await s.org.owner.post(`/stock/batches/${recalled.id}/status`, { status: 'RECALLED', reason: 'Manufacturer recall 12/26' });

    const c = (await s.org.owner.get('/stock/disposals/candidates?days=30')).body;
    expect(c.rows.map((r: any) => [r.batchNumber, r.state, r.quantity])).toEqual([
      ['OLD', 'EXPIRED', 10],
      ['CD1', 'EXPIRING', 5],
      ['SOON', 'EXPIRING', 6],
      ['FRESH', 'RECALLED', 50],
    ]);
    expect(c.summary.expired).toEqual({ count: 1, valueMinor: 1000 });
    // A shorter window leaves out what expires later.
    expect((await s.org.owner.get('/stock/disposals/candidates?days=7')).body.rows.map((r: any) => r.batchNumber)).toEqual(['OLD', 'FRESH']);

    const old = await s.batch('OLD');
    const soon = await s.batch('SOON');
    const d = await s.org.owner.post('/stock/disposals', {
      locationId: s.f.locationId,
      reason: 'EXPIRED',
      method: 'WASTE_CONTRACTOR',
      contractor: 'Green Med Waste',
      reference: 'CN-4471',
      lines: [{ batchId: old.id, quantity: 10 }, { batchId: soon.id, quantity: 2 }],
    });
    expect(d.status).toBe(201);
    expect(d.body).toMatchObject({ disposalNo: expect.stringMatching(/^DSP-0+1$/), totalMinor: 1200, hasControlled: false, witnessName: null, reasonLabel: 'Expired', createdByName: 'Olivia Owner' });
    expect(d.body.lines.map((l: any) => [l.batch.batchNumber, l.quantity, l.wasExpired])).toEqual(expect.arrayContaining([['OLD', 10, true], ['SOON', 2, false]]));

    // The stock is gone, written off in the history with a link back to the record.
    const stock = (await s.org.owner.get(`/stock/products/${s.f.product.id}`)).body;
    expect(stock.batches.find((b: any) => b.batchNumber === 'OLD').onHand).toBe(0);
    expect(stock.batches.find((b: any) => b.batchNumber === 'SOON').onHand).toBe(4);
    const moves = (await s.org.owner.get(`/stock/movements?productId=${s.f.product.id}&type=WRITE_OFF`)).body.data;
    expect(moves).toHaveLength(2);
    expect(moves[0]).toMatchObject({ referenceType: 'StockDisposal', reference: { label: expect.stringMatching(/^Disposal DSP-/), href: `/inventory/disposals/${d.body.id}` } });
    expect((await s.org.owner.get('/stock/disposals/candidates?days=30')).body.rows.map((r: any) => r.batchNumber)).toEqual(['CD1', 'SOON', 'FRESH']);

    expect((await s.org.owner.post('/stock/disposals', { locationId: s.f.locationId, reason: 'EXPIRED', method: 'WASTE_CONTRACTOR', lines: [{ batchId: soon.id, quantity: 1 }] })).status).toBe(400);
    // Never more than is on the shelf; each batch once.
    expect((await s.org.owner.post('/stock/disposals', { locationId: s.f.locationId, reason: 'EXPIRED', method: 'INCINERATION', lines: [{ batchId: soon.id, quantity: 5 }] })).body.error.code).toBe('INSUFFICIENT_STOCK');
    expect((await s.org.owner.post('/stock/disposals', { locationId: s.f.locationId, reason: 'EXPIRED', method: 'INCINERATION', lines: [{ batchId: soon.id, quantity: 1 }, { batchId: soon.id, quantity: 1 }] })).body.error.code).toBe('DUPLICATE_BATCH');

    const list = (await s.org.owner.get('/stock/disposals')).body;
    expect(list.meta.total).toBe(1);
    expect(list.thisMonthMinor).toBe(1200);
    // Permanent record.
    await expect(prisma().stockDisposal.update({ where: { id: d.body.id }, data: { notes: 'x' } })).rejects.toThrow(/append-only/);
    await expect(prisma().stockDisposalLine.deleteMany({ where: { disposalId: d.body.id } })).rejects.toThrow(/append-only/);
    const audit = await prisma().auditEvent.findFirstOrThrow({ where: { organizationId: s.org.orgId, action: 'stock.disposed' } });
    expect(audit.summary).toContain('collected by a licensed pharmaceutical waste contractor');
  });

  it('needs another member of staff to witness controlled medicines, and checks permissions', async () => {
    const s = await setup();
    const cd = await s.batch('CD1');
    const nurse = await staff(s.org, 'nurse');
    const manager = await staff(s.org, 'practice_manager');
    const base = { locationId: s.f.locationId, reason: 'SHORT_DATED', method: 'DENATURED', lines: [{ batchId: cd.id, quantity: 2 }] };

    expect((await s.org.owner.post('/stock/disposals', base)).body.error.code).toBe('WITNESS_REQUIRED');
    const witnesses = (await s.org.owner.get('/stock/disposals/witnesses')).body;
    expect(witnesses.map((w: any) => w.name).sort()).toEqual(['Test nurse', 'Test practice_manager']);
    const ownerMembership = await prisma().membership.findFirstOrThrow({ where: { organizationId: s.org.orgId, user: { email: s.org.email } } });
    expect((await s.org.owner.post('/stock/disposals', { ...base, witnessMembershipId: ownerMembership.id })).body.error.code).toBe('INVALID_WITNESS');

    const ok = await s.org.owner.post('/stock/disposals', { ...base, witnessMembershipId: nurse.membershipId });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ hasControlled: true, witnessName: 'Test nurse', totalMinor: 4000 });
    // It is in the controlled-drugs register, with the witness.
    const reg = (await s.org.owner.get(`/stock/controlled-register?from=${new Date(Date.now() - 3600_000).toISOString()}&to=${new Date(Date.now() + 3600_000).toISOString()}`)).body;
    expect(reg.find((m: any) => m.type === 'WRITE_OFF')).toMatchObject({ quantity: -2, reason: expect.stringContaining('witnessed by Test nurse') });
    // The database refuses a controlled disposal without a witness, even bypassing the app.
    await expect(
      prisma().stockDisposal.create({ data: { organizationId: s.org.orgId, branchId: s.org.branchId, number: 999, locationId: s.f.locationId, reason: 'EXPIRED', method: 'OTHER', hasControlled: true, totalMinor: 0, disposedAt: new Date(), createdById: ownerMembership.userId, createdByName: 'x' } }),
    ).rejects.toThrow(/witness_for_controlled/);

    // Nurses can't dispose of stock; managers (stock adjustments) can.
    expect((await nurse.client.post('/stock/disposals', { ...base, witnessMembershipId: ok.body.witnessId })).status).toBe(403);
    expect((await manager.client.post('/stock/disposals', { ...base, lines: [{ batchId: cd.id, quantity: 1 }], witnessMembershipId: nurse.membershipId })).status).toBe(201);

    const other = await registerOrg();
    expect((await other.owner.get(`/stock/disposals/${ok.body.id}`)).status).toBe(404);
    expect((await other.owner.post('/stock/disposals', { ...base, witnessMembershipId: nurse.membershipId })).body.error.code).toBe('INVALID_LOCATION');
  });
});
