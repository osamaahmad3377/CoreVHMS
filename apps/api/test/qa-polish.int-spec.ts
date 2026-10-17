import { closeApp, inDays, makeClient, makePatient, registerOrg, staff, stockFixture } from './helpers';

// Prices, quantities and costs are arbitrary test values.
describe('Everyday polish: readable statements, reports, stock history and reordering', () => {
  afterAll(closeApp);

  it('files charge-based invoices against the animal and describes payments in plain words on the statement', async () => {
    const org = await registerOrg();
    const vet = await staff(org, 'veterinarian', { isClinician: true });
    const client = await makeClient(org.owner);
    const patient = await makePatient(org.owner, client.id);
    const product = (await org.owner.post('/products', { name: 'Statement tabs', strengthValue: 10, strengthUnit: 'mg', dispensingUnit: 'tablet', minDispenseIncrement: 1, sellPriceMinor: 250 })).body;
    const rx = await vet.client.post('/prescriptions', { patientId: patient.id, items: [{ productId: product.id, route: 'PO', doseValue: 1, doseUnit: 'tablet', frequencyCode: 'ONCE', quantity: 4, instructions: 'x' }], authorize: true });
    await org.owner.post(`/prescriptions/${rx.body.id}/dispense`, { lines: [{ itemId: rx.body.items[0].id, quantity: 4 }] });
    const charges = (await org.owner.get(`/charges?clientId=${client.id}`)).body.data;

    const inv = await org.owner.post('/invoices', { clientId: client.id, chargeIds: charges.map((c: any) => c.id), issue: true });
    expect(inv.status).toBe(201);
    expect(inv.body.patientId).toBe(patient.id);

    await org.owner.post('/payments', { clientId: client.id, amountMinor: 600, method: 'CARD', allocations: [{ invoiceId: inv.body.id, amountMinor: 600 }] });
    const onAccount = await org.owner.post('/payments', { clientId: client.id, amountMinor: 300, method: 'BANK_TRANSFER', allocations: [] });
    expect(onAccount.status).toBe(201);
    const lines = (await org.owner.get(`/clients/${client.id}/statement`)).body.lines;
    const payments = lines.filter((l: any) => l.type === 'PAYMENT').map((l: any) => l.description);
    expect(payments).toEqual([`Card payment for ${inv.body.invoiceNo}`, 'Bank transfer payment on account']);
  });

  it('names sales by item from the catalogue, totals them, and exports a spreadsheet-ready CSV', async () => {
    const org = await registerOrg();
    const svc = (await org.owner.post('/services', { code: 'EXAM', name: 'Health exam', category: 'CONSULTATION', priceMinor: 150000 })).body;
    const sale = await org.owner.post('/invoices', { isPos: true, lines: [{ kind: 'SERVICE', serviceId: svc.id, quantity: 1, description: 'Exam (renamed on the line)' }, { kind: 'SERVICE', serviceId: svc.id, quantity: 1 }], issue: true });
    expect(sale.status).toBe(201);
    const from = new Date(Date.now() - 86_400_000).toISOString();
    const to = new Date(Date.now() + 86_400_000).toISOString();

    const report = (await org.owner.get(`/reports/sales-by-item?from=${from}&to=${to}`)).body;
    expect(report.rows).toEqual([expect.objectContaining({ item: 'Health exam', code: 'EXAM', type: 'Service', quantity: 2 })]);
    expect(report.totals.netMinor).toBe(report.rows[0].netMinor);

    const csv = await org.owner.get(`/reports/sales-by-item?from=${from}&to=${to}&format=csv`);
    const rows = csv.text.replace(/^﻿/, '').trim().split('\r\n');
    expect(rows[0]).toBe('Item,Code,Type,Quantity,Net sales (PKR),Tax (PKR),Total incl. tax (PKR)');
    expect(rows[1]).toMatch(/^Health exam,EXAM,Service,2,3000\.00,/); // major units, not 300000
    expect(rows.at(-1)).toMatch(/^Total,,,,3000\.00,/);
    expect(csv.headers['content-disposition']).toMatch(/filename="sales-by-item_\d{4}-\d\d-\d\d_to_\d{4}-\d\d-\d\d\.csv"/);

    // An empty period still has its header row.
    const empty = await org.owner.get('/reports/write-offs?from=2020-01-01&to=2020-01-02&format=csv');
    expect(empty.text.replace(/^﻿/, '').trim()).toBe('Date,Product,Batch,Quantity written off,Unit,Reason,Cost (PKR)');
  });

  it('traces stock movements to what caused them and suggests reorders with the last cost and supplier', async () => {
    const org = await registerOrg();
    const f = await stockFixture(org);
    // A shop item (no prescription needed) sold at the counter.
    const collar = (await org.owner.post('/products', { name: 'Reflective collar', type: 'ACCESSORY', dispensingUnit: 'piece', minDispenseIncrement: 1, sellPriceMinor: 500 })).body;
    f.product = collar;
    await org.owner.post('/stock/receipts', { supplierId: f.supplierId, locationId: f.locationId, lines: [{ productId: f.product.id, batchNumber: 'LOT-1', expiryDate: inDays(200), quantity: 10, unitCostMinor: 120 }] });
    const sale = await org.owner.post('/invoices', { isPos: true, lines: [{ kind: 'PRODUCT', productId: f.product.id, quantity: 8 }], issue: true });
    expect(sale.status).toBe(201);

    const moves = (await org.owner.get(`/stock/movements?productId=${f.product.id}`)).body.data;
    const sold = moves.find((m: any) => m.type === 'SALE');
    expect(sold.reference).toEqual({ label: `Counter sale ${sale.body.invoiceNo}`, href: `/billing/invoices/${sale.body.id}` });
    expect(moves.find((m: any) => m.type === 'RECEIPT').reference.label).toMatch(/^Delivery GRN-\d+$/);

    await org.owner.patch(`/stock/products/${f.product.id}/settings`, { reorderLevel: 5, reorderQuantity: 20 });
    const suggestions = (await org.owner.get('/purchase-orders/reorder-suggestions')).body;
    expect(suggestions).toEqual([expect.objectContaining({ productId: f.product.id, available: 2, suggested: 20, lastCostMinor: 120, lastSupplier: expect.objectContaining({ id: f.supplierId }) })]);
  });
});
