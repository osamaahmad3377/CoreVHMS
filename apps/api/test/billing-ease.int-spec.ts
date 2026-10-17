import { randomUUID } from 'node:crypto';
import { closeApp, makeClient, makePatient, prisma, registerOrg, staff } from './helpers';

// Prices are arbitrary test values.
describe('Billing ease of use: counter search, sellable sections, work grouped by client', () => {
  afterAll(closeApp);

  it('finds counter items by every word, including the shop category and section name', async () => {
    const org = await registerOrg();
    const cats = (await org.owner.get('/product-categories')).body as any[];
    const dry = cats.find((c) => c.name === 'Dry food');
    const toys = cats.find((c) => c.name === 'Toys');
    const kibble = (await org.owner.post('/products', { name: 'Adult chicken & rice', type: 'FOOD', categoryId: dry.id, brand: 'Happy Dogs', packSize: '3 kg bag', dispensingUnit: 'bag', minDispenseIncrement: 1, sellPriceMinor: 450000 })).body;
    const ball = (await org.owner.post('/products', { name: 'Rubber ball', type: 'ACCESSORY', categoryId: toys.id, dispensingUnit: 'piece', minDispenseIncrement: 1, sellPriceMinor: 50000 })).body;
    const ids = async (q: string) => ((await org.owner.get(`/pos/catalog?q=${encodeURIComponent(q)}`)).body.items as any[]).map((i) => i.id);

    expect(await ids('food')).toEqual([kibble.id]); // section "Food & treats" and category "Dry food"
    expect(await ids('dry food')).toEqual([kibble.id]); // shop category name
    expect(await ids('dogs food')).toEqual([kibble.id]); // brand word, plural, any order
    expect(await ids('food dog')).toEqual([kibble.id]);
    expect(await ids('toy')).toEqual([ball.id]); // category "Toys"
    expect(await ids('ball food')).toEqual([]); // every word must match
    expect((await org.owner.get('/pos/catalog?q=ADULT')).body.items.map((i: any) => i.id)).toEqual([kibble.id]);
  });

  it('lists only sections with something sellable and gives the default tax for other items', async () => {
    const org = await registerOrg();
    await org.owner.post('/tax-rates', { name: 'Test tax', rateBasisPoints: 1700, isDefault: true });
    await org.owner.post('/products', { name: 'Rx-only tabs', type: 'MEDICINE', strengthValue: 5, strengthUnit: 'mg', dispensingUnit: 'tablet', minDispenseIncrement: 1, requiresPrescription: true, sellPriceMinor: 100 });
    const cats = (await org.owner.get('/product-categories')).body as any[];
    await org.owner.post('/products', { name: 'Dog shampoo', type: 'GROOMING', categoryId: cats.find((c) => c.productType === 'GROOMING').id, dispensingUnit: 'bottle', minDispenseIncrement: 1, sellPriceMinor: 90000 });
    const cat = (await org.owner.get('/pos/catalog')).body;
    expect(cat.sellableTypes).toEqual(['GROOMING']); // the prescription-only medicine does not count
    expect(cat.defaultTaxRateBasisPoints).toBe(1700);

    // "+ Other item" is a CUSTOM line: needs billing.write, so a counter-only role cannot type in prices.
    const till = await staff(org, 'pharmacy');
    expect((await till.client.post('/invoices', { isPos: true, lines: [{ kind: 'CUSTOM', description: 'Bag of treats', quantity: 1, unitPriceMinor: 30000 }], issue: true })).status).toBe(403);
    const sale = await org.owner.post('/invoices', { isPos: true, lines: [{ kind: 'CUSTOM', description: 'Bag of treats', quantity: 1, unitPriceMinor: 30000 }], issue: true });
    expect(sale.status).toBe(201);
    expect(sale.body.lines[0]).toMatchObject({ kind: 'CUSTOM', description: 'Bag of treats', taxRateBasisPoints: 1700 });
  });

  it('groups work not yet invoiced by client, newest first, with item count and total', async () => {
    const org = await registerOrg();
    const a = await makeClient(org.owner, { firstName: 'Older' });
    const b = await makeClient(org.owner, { firstName: 'Newer' });
    const pa = await makePatient(org.owner, a.id, { name: 'Moti' });
    const base = { organizationId: org.orgId, branchId: org.branchId, sourceType: 'Manual', kind: 'CUSTOM' as const, taxRateBasisPoints: 0 };
    await prisma().charge.createMany({
      data: [
        { ...base, clientId: a.id, patientId: pa.id, sourceId: randomUUID(), description: 'Consultation', quantity: 1, unitPriceMinor: 150000, createdAt: new Date(Date.now() - 3 * 3600_000) },
        { ...base, clientId: a.id, patientId: pa.id, sourceId: randomUUID(), description: 'Tablets (RX-000010)', quantity: 2, unitPriceMinor: 2500, createdAt: new Date(Date.now() - 2 * 3600_000) },
        { ...base, clientId: b.id, sourceId: randomUUID(), description: 'Nail clip', quantity: 1, unitPriceMinor: 50000, createdAt: new Date(Date.now() - 3600_000) },
        { ...base, clientId: b.id, sourceId: randomUUID(), description: 'Waived item', quantity: 1, unitPriceMinor: 99999, status: 'WAIVED' },
      ],
    });
    const res = await org.owner.get('/charges/by-client');
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(2);
    expect(res.body.totalMinor).toBe(205000);
    expect(res.body.data).toEqual([
      expect.objectContaining({ client: { id: b.id, displayName: b.displayName }, itemCount: 1, totalMinor: 50000, patients: [] }),
      expect.objectContaining({ client: { id: a.id, displayName: a.displayName }, itemCount: 2, totalMinor: 155000, patients: ['Moti'] }),
    ]);
    expect((await org.owner.get(`/charges/by-client?q=${encodeURIComponent(a.displayName)}`)).body.data.map((g: any) => g.client.id)).toEqual([a.id]);

    // Another clinic sees none of it.
    const other = await registerOrg();
    expect((await other.owner.get('/charges/by-client')).body.meta.total).toBe(0);
  });
});
