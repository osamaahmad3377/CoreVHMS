import { randomUUID } from 'node:crypto';
import { booking, closeApp, futureDate, inDays, karachi, makeClient, makePatient, prisma, registerOrg, schedulingFixture, staff, stockFixture } from './helpers';

// All prices and tax rates are arbitrary test values.
async function setup(opts: { tax?: number } = {}) {
  const org = await registerOrg();
  const vet = await staff(org, 'veterinarian', { isClinician: true });
  const accountant = await staff(org, 'accountant');
  const client = await makeClient(org.owner);
  const patient = await makePatient(org.owner, client.id);
  if (opts.tax !== undefined) await org.owner.post('/tax-rates', { name: 'Test tax', rateBasisPoints: opts.tax, isDefault: true });
  const svc = await org.owner.post('/services', { code: 'CONS', name: 'Consultation', category: 'CONSULTATION', priceMinor: 10000 });
  const reg = await org.owner.post('/cash/registers', { branchId: org.branchId, name: 'Front desk' });
  return { org, vet, accountant, client, patient, service: svc.body, registerId: reg.body.id as string };
}

async function invoiceWith(s: Awaited<ReturnType<typeof setup>>, priceMinor = 10000, issue = true) {
  const inv = await s.org.owner.post('/invoices', { clientId: s.client.id, lines: [{ kind: 'CUSTOM', description: 'Procedure', quantity: 1, unitPriceMinor: priceMinor }], issue });
  if (inv.status !== 201) throw new Error(JSON.stringify(inv.body));
  return inv.body;
}

describe('Billing, payments & finance', () => {
  afterAll(closeApp);

  it('captures each clinical charge exactly once (dispensing, lab, consultation) and waives cancelled tests', async () => {
    const s = await setup();
    const product = await s.org.owner.post('/products', { name: 'Billable tabs', strengthValue: 10, strengthUnit: 'mg', dispensingUnit: 'tablet', minDispenseIncrement: 1, sellPriceMinor: 250 });
    const rx = await s.vet.client.post('/prescriptions', { patientId: s.patient.id, items: [{ productId: product.body.id, route: 'PO', doseValue: 1, doseUnit: 'tablet', frequencyCode: 'ONCE', quantity: 4, instructions: 'x' }], authorize: true });
    await s.org.owner.post(`/prescriptions/${rx.body.id}/dispense`, { lines: [{ itemId: rx.body.items[0].id, quantity: 4 }] });
    const lab = await s.org.owner.post('/lab-tests', { code: 'T1', name: 'Test', category: 'HAEMATOLOGY', priceMinor: 3000, analytes: [{ code: 'A', name: 'A' }] });
    const order = await s.vet.client.post('/lab-orders', { patientId: s.patient.id, testIds: [lab.body.id] });
    let charges = (await s.org.owner.get(`/charges?clientId=${s.client.id}`)).body;
    expect(charges.data.map((c: any) => [c.kind, c.quantity, c.unitPriceMinor]).sort()).toEqual([['LAB', 1, 3000], ['PRODUCT', 4, 250]]);
    expect(charges.totalMinor).toBe(4000);
    await s.vet.client.post(`/lab-orders/${order.body.id}/cancel`, { reason: 'Owner declined' });
    charges = (await s.org.owner.get(`/charges?clientId=${s.client.id}&status=WAIVED`)).body;
    expect(charges.data[0]).toMatchObject({ kind: 'LAB', waivedReason: 'Diagnostic order cancelled' });

    // consultation fee from the appointment type's service
    const f = await schedulingFixture(s.org);
    await s.org.owner.patch(`/appointment-types/${f.typeId}`, { serviceId: s.service.id });
    const a = await s.org.owner.post('/appointments', booking(s.org, f, karachi(futureDate(3), '10:00')));
    await f.vet.client.post(`/appointments/${a.body.id}/status`, { action: 'start' });
    await f.vet.client.post(`/appointments/${a.body.id}/status`, { action: 'complete' });
    const consult = (await s.org.owner.get(`/charges?clientId=${f.client.id}`)).body.data;
    expect(consult).toHaveLength(1);
    expect(consult[0]).toMatchObject({ kind: 'SERVICE', unitPriceMinor: 10000, sourceType: 'Encounter' });
    expect(await prisma().charge.count({ where: { sourceType: 'Encounter', sourceId: consult[0].sourceId } })).toBe(1);
  });

  it('builds invoices from charges, numbers them only when issued, and freezes issued invoices', async () => {
    const s = await setup({ tax: 1000 });
    const product = await s.org.owner.post('/products', { name: 'Tabs', strengthValue: 1, strengthUnit: 'mg', dispensingUnit: 'tablet', minDispenseIncrement: 1, sellPriceMinor: 1000 });
    const rx = await s.vet.client.post('/prescriptions', { patientId: s.patient.id, items: [{ productId: product.body.id, route: 'PO', doseValue: 1, doseUnit: 'tablet', frequencyCode: 'ONCE', quantity: 3, instructions: 'x' }], authorize: true });
    await s.org.owner.post(`/prescriptions/${rx.body.id}/dispense`, { lines: [{ itemId: rx.body.items[0].id, quantity: 3 }] });
    const charge = (await s.org.owner.get(`/charges?clientId=${s.client.id}`)).body.data[0];
    const draft = await s.org.owner.post('/invoices', { clientId: s.client.id, chargeIds: [charge.id], lines: [{ kind: 'SERVICE', serviceId: s.service.id, quantity: 1 }] });
    expect(draft.status).toBe(201);
    expect(draft.body).toMatchObject({ status: 'DRAFT', number: null, subtotalMinor: 13000, taxMinor: 1300, totalMinor: 14300 });
    expect((await s.org.owner.post('/invoices', { clientId: s.client.id, chargeIds: [charge.id] })).body.error.code).toBe('CHARGE_NOT_PENDING');
    const issued = await s.org.owner.post(`/invoices/${draft.body.id}/issue`);
    expect(issued.body.status).toBe('ISSUED');
    expect(issued.body.invoiceNo).toMatch(/^INV-\d{6}$/);
    const second = await invoiceWith(s, 500);
    expect(second.number).toBe(issued.body.number + 1);
    await expect(prisma().invoiceLine.update({ where: { id: issued.body.lines[0].id }, data: { unitPriceMinor: 1 } })).rejects.toThrow(/cannot be changed/);
    await expect(prisma().invoice.update({ where: { id: issued.body.id }, data: { totalMinor: 1 } })).rejects.toThrow(/immutable/);
    expect((await s.org.owner.patch(`/invoices/${issued.body.id}`, { notes: 'x' })).body.error.code).toBe('NOT_DRAFT');
    expect((await s.org.owner.get(`/clients/${s.client.id}`)).body.balanceMinor).toBe(14300 + 550);
  });

  it('supports split payments, client credit, idempotent retries and blocks overpayment', async () => {
    const s = await setup();
    const inv = await invoiceWith(s, 10000);
    await s.org.owner.post('/cash/sessions', { registerId: s.registerId, openingFloatMinor: 5000 });
    const key = randomUUID();
    const p1 = await s.org.owner.post('/payments', { clientId: s.client.id, amountMinor: 4000, method: 'CASH', allocations: [{ invoiceId: inv.id, amountMinor: 4000 }], idempotencyKey: key });
    expect(p1.status).toBe(201);
    const retry = await s.org.owner.post('/payments', { clientId: s.client.id, amountMinor: 4000, method: 'CASH', allocations: [{ invoiceId: inv.id, amountMinor: 4000 }], idempotencyKey: key });
    expect(retry.body.id).toBe(p1.body.id);
    expect((await s.org.owner.get(`/invoices/${inv.id}`)).body).toMatchObject({ status: 'PARTIALLY_PAID', balanceMinor: 6000 });
    expect((await s.org.owner.post('/payments', { clientId: s.client.id, amountMinor: 7000, method: 'CARD', allocations: [{ invoiceId: inv.id, amountMinor: 7000 }] })).body.error.code).toBe('OVERPAYMENT');
    const p2 = await s.org.owner.post('/payments', { clientId: s.client.id, amountMinor: 8000, method: 'CARD', reference: 'AUTH123', allocations: [{ invoiceId: inv.id, amountMinor: 6000 }] });
    expect(p2.body).toMatchObject({ allocatedMinor: 6000, unallocatedMinor: 2000 });
    expect((await s.org.owner.get(`/invoices/${inv.id}`)).body.status).toBe('PAID');
    expect((await s.org.owner.get(`/clients/${s.client.id}`)).body.balanceMinor).toBe(-2000);
    const inv2 = await invoiceWith(s, 1500);
    await s.org.owner.post(`/payments/${p2.body.id}/allocate`, { allocations: [{ invoiceId: inv2.id, amountMinor: 1500 }] });
    expect((await s.org.owner.get(`/invoices/${inv2.id}`)).body.status).toBe('PAID');
    expect((await s.org.owner.get(`/clients/${s.client.id}`)).body.balanceMinor).toBe(-500);
    expect(await prisma().payment.count({ where: { idempotencyKey: key } })).toBe(1);
  });

  it('records a single payment when the same request is submitted twice at once, and numbers concurrent invoices without gaps', async () => {
    const s = await setup();
    const inv = await invoiceWith(s, 5000);
    const key = randomUUID();
    const body = { clientId: s.client.id, amountMinor: 5000, method: 'CARD', allocations: [{ invoiceId: inv.id, amountMinor: 5000 }], idempotencyKey: key };
    const [a, b] = await Promise.all([s.org.owner.post('/payments', body), s.org.owner.post('/payments', body)]);
    expect([a.status, b.status].every((x) => x === 201 || x === 200)).toBe(true);
    expect(a.body.id).toBe(b.body.id);
    expect((await s.org.owner.get(`/invoices/${inv.id}`)).body).toMatchObject({ status: 'PAID', paidMinor: 5000 });
    const issued = await Promise.all([1, 2, 3, 4].map(() => invoiceWith(s, 100)));
    const nums = issued.map((i) => i.number).sort((x, y) => x - y);
    expect(nums).toEqual([inv.number + 1, inv.number + 2, inv.number + 3, inv.number + 4]);
  });

  it('requires an open cash session for cash and reconciles the session on close', async () => {
    const s = await setup();
    const inv = await invoiceWith(s, 3000);
    expect((await s.org.owner.post('/payments', { clientId: s.client.id, amountMinor: 3000, method: 'CASH', allocations: [{ invoiceId: inv.id, amountMinor: 3000 }] })).body.error.code).toBe('NO_CASH_SESSION');
    const session = await s.org.owner.post('/cash/sessions', { registerId: s.registerId, openingFloatMinor: 10000 });
    expect((await s.org.owner.post('/cash/sessions', { registerId: s.registerId, openingFloatMinor: 0 })).status).toBe(409);
    const pay = await s.org.owner.post('/payments', { clientId: s.client.id, amountMinor: 3000, method: 'CASH', allocations: [{ invoiceId: inv.id, amountMinor: 3000 }] });
    await s.org.owner.post('/expenses', { date: inDays(0), category: 'OTHER', description: 'Taxi for samples', amountMinor: 500, method: 'CASH' });
    await s.org.owner.post(`/payments/${pay.body.id}/refunds`, { amountMinor: 1000, method: 'CASH', reason: 'Discount agreed' });
    const exp = (await s.org.owner.get(`/cash/sessions/${session.body.id}`)).body;
    expect(exp.expectedCashMinor).toBe(10000 + 3000 - 500 - 1000);
    expect((await s.org.owner.post(`/cash/sessions/${session.body.id}/close`, { countedCashMinor: 11400 })).body.error.code).toBe('VARIANCE_NOTE');
    const closed = await s.org.owner.post(`/cash/sessions/${session.body.id}/close`, { countedCashMinor: 11400, notes: 'Short by 100' });
    expect(closed.body).toMatchObject({ status: 'CLOSED', varianceMinor: -100 });
  });

  it('refunds from credit first, then from invoices; credit notes and voids return value to the client', async () => {
    const s = await setup();
    const inv = await invoiceWith(s, 10000);
    const pay = await s.org.owner.post('/payments', { clientId: s.client.id, amountMinor: 12000, method: 'BANK_TRANSFER', allocations: [{ invoiceId: inv.id, amountMinor: 10000 }] });
    expect((await s.org.owner.post(`/payments/${pay.body.id}/refunds`, { amountMinor: 20000, method: 'BANK_TRANSFER', reason: 'x' })).body.error.code).toBe('REFUND_TOO_LARGE');
    const reception = await staff(s.org, 'receptionist');
    expect((await reception.client.post(`/payments/${pay.body.id}/refunds`, { amountMinor: 100, method: 'BANK_TRANSFER', reason: 'x' })).status).toBe(403);
    let r = await s.accountant.client.post(`/payments/${pay.body.id}/refunds`, { amountMinor: 3000, method: 'BANK_TRANSFER', reason: 'Overpaid' });
    expect(r.body.payment).toMatchObject({ refundedMinor: 3000, allocatedMinor: 9000, unallocatedMinor: 0 });
    expect((await s.org.owner.get(`/invoices/${inv.id}`)).body).toMatchObject({ status: 'PARTIALLY_PAID', balanceMinor: 1000 });

    const cn = await s.accountant.client.post(`/invoices/${inv.id}/credit-notes`, { amountMinor: 4000, reason: 'Goodwill' });
    expect(cn.status).toBe(201);
    expect(cn.body.invoice).toMatchObject({ creditedMinor: 4000, balanceMinor: 0, status: 'PAID', paidMinor: 6000 });
    expect((await s.org.owner.get(`/clients/${s.client.id}`)).body.balanceMinor).toBe(-3000);

    const inv2 = await invoiceWith(s, 2000);
    await s.org.owner.post(`/payments/${pay.body.id}/allocate`, { allocations: [{ invoiceId: inv2.id, amountMinor: 2000 }] });
    expect((await reception.client.post(`/invoices/${inv2.id}/void`, { reason: 'x' })).status).toBe(403);
    const voided = await s.accountant.client.post(`/invoices/${inv2.id}/void`, { reason: 'Billed in error' });
    expect(voided.body).toMatchObject({ status: 'VOID', paidMinor: 0 });
    expect((await s.org.owner.get(`/clients/${s.client.id}`)).body.balanceMinor).toBe(-3000);
    const st = (await s.org.owner.get(`/clients/${s.client.id}/statement`)).body;
    expect(st.closingBalanceMinor).toBe(-3000);
    r = r; // eslint-friendly
  });

  it('handles counter sales: stock is issued at invoice issue, prescription-only medicines are refused, voids restock', async () => {
    const s = await setup();
    const f = await stockFixture(s.org);
    const retail = await s.org.owner.post('/products', { name: 'Chew toy', type: 'RETAIL', dispensingUnit: 'unit', minDispenseIncrement: 1, sellPriceMinor: 1200, requiresPrescription: false });
    await s.org.owner.post('/stock/receipts', { supplierId: f.supplierId, locationId: f.locationId, lines: [{ productId: retail.body.id, batchNumber: 'R1', quantity: 10, unitCostMinor: 600 }] });
    const blocked = await s.org.owner.post('/invoices', { isPos: true, lines: [{ kind: 'PRODUCT', productId: f.product.id, quantity: 1 }] });
    expect(blocked.body.error.code).toBe('PRESCRIPTION_REQUIRED');
    const vaccine = await s.org.owner.post('/products', { name: 'Test vaccine', type: 'VACCINE', dispensingUnit: 'dose', minDispenseIncrement: 1, sellPriceMinor: 2000 });
    expect((await s.org.owner.post('/invoices', { isPos: true, lines: [{ kind: 'PRODUCT', productId: vaccine.body.id, quantity: 1 }] })).body.error.code).toBe('PRESCRIPTION_REQUIRED');
    const till = await staff(s.org, 'pharmacy');
    expect((await till.client.post('/invoices', { lines: [{ kind: 'PRODUCT', productId: retail.body.id, quantity: 1, unitPriceMinor: 1 }], issue: true })).status).toBe(403);
    expect((await till.client.post('/invoices', { lines: [{ kind: 'CUSTOM', description: 'x', quantity: 1, unitPriceMinor: 1 }] })).status).toBe(403);
    const sale = await till.client.post('/invoices', { lines: [{ kind: 'PRODUCT', productId: retail.body.id, quantity: 3 }], issue: true });
    expect(sale.body.isPos).toBe(true);
    expect(sale.body).toMatchObject({ status: 'ISSUED', clientId: null, totalMinor: 3600 });
    expect((await s.org.owner.get(`/stock/products/${retail.body.id}`)).body.batches[0].onHand).toBe(7);
    expect((await s.org.owner.post('/payments', { amountMinor: 5000, method: 'CARD', allocations: [{ invoiceId: sale.body.id, amountMinor: 3600 }] })).body.error.code).toBe('UNALLOCATED_COUNTER_PAYMENT');
    expect((await s.org.owner.post('/payments', { amountMinor: 3600, method: 'CARD', allocations: [{ invoiceId: sale.body.id, amountMinor: 3600 }] })).status).toBe(201);
    const sale2 = await s.org.owner.post('/invoices', { isPos: true, lines: [{ kind: 'PRODUCT', productId: retail.body.id, quantity: 2 }], issue: true });
    await s.org.owner.post(`/invoices/${sale2.body.id}/void`, { reason: 'Customer changed mind' });
    expect((await s.org.owner.get(`/stock/products/${retail.body.id}`)).body.batches[0].onHand).toBe(7);
    const summary = (await s.org.owner.get(`/reports/financial-summary?from=${inDays(-1)}&to=${inDays(1)}`)).body;
    expect(summary).toMatchObject({ netRevenueMinor: 3600, costOfGoodsMinor: 3 * 600, grossProfitMinor: 1800 });
  });

  it('serves the POS catalogue with usable stock, tax, barcode lookup and prescription-only flags; lists today\'s sales', async () => {
    const s = await setup({ tax: 1000 });
    const f = await stockFixture(s.org);
    const retail = await s.org.owner.post('/products', { name: 'Squeaky ball', type: 'RETAIL', barcode: '9300000000017', dispensingUnit: 'unit', minDispenseIncrement: 1, sellPriceMinor: 800, requiresPrescription: false });
    await s.org.owner.post('/stock/receipts', { supplierId: f.supplierId, locationId: f.locationId, lines: [
      { productId: retail.body.id, batchNumber: 'OK', expiryDate: inDays(100), quantity: 5, unitCostMinor: 300 },
      { productId: retail.body.id, batchNumber: 'OLD', expiryDate: inDays(1), quantity: 4, unitCostMinor: 300 },
    ] });
    const old = (await s.org.owner.get(`/stock/products/${retail.body.id}`)).body.batches.find((b: any) => b.batchNumber === 'OLD');
    await s.org.owner.post(`/stock/batches/${old.id}/status`, { status: 'RECALLED', reason: 'Supplier recall' });

    const scan = (await s.org.owner.get('/pos/catalog?q=9300000000017')).body;
    expect(scan.exact).toMatchObject({ type: 'PRODUCT', name: 'Squeaky ball', available: 5, priceMinor: 800, taxRateBasisPoints: 1000, rxOnly: false });
    const all = (await s.org.owner.get('/pos/catalog')).body.items;
    expect(all.find((i: any) => i.id === f.product.id)).toMatchObject({ rxOnly: true });
    expect(all.find((i: any) => i.type === 'SERVICE' && i.code === 'CONS')).toMatchObject({ priceMinor: 10000, available: null });
    expect((await s.org.owner.get('/pos/catalog?category=SERVICE')).body.items.every((i: any) => i.type === 'SERVICE')).toBe(true);
    expect((await s.org.owner.get('/pos/catalog?q=CONS')).body.exact).toMatchObject({ type: 'SERVICE', code: 'CONS' });

    const sale = await s.org.owner.post('/invoices', { isPos: true, lines: [{ kind: 'PRODUCT', productId: retail.body.id, quantity: 2 }], issue: true });
    const recent = (await s.org.owner.get('/pos/recent')).body;
    expect(recent.map((r: any) => r.id)).toContain(sale.body.id);
    expect(recent[0].lines[0]).toMatchObject({ description: 'Squeaky ball', quantity: 2 });
    expect((await s.vet.client.get('/pos/catalog')).status).toBe(403);
  });

  it('extracts tax from tax-inclusive prices when configured', async () => {
    const s = await setup({ tax: 1000 });
    await s.org.owner.patch('/billing/settings', { pricesIncludeTax: true });
    const inv = await invoiceWith(s, 11000);
    expect(inv).toMatchObject({ pricesIncludeTax: true, subtotalMinor: 10000, taxMinor: 1000, totalMinor: 11000 });
  });

  it('isolates invoices and payments between organizations', async () => {
    const s = await setup();
    const inv = await invoiceWith(s, 1000);
    const other = await registerOrg();
    expect((await other.owner.get(`/invoices/${inv.id}`)).status).toBe(404);
    const otherClient = await makeClient(other.owner);
    expect((await other.owner.post('/payments', { clientId: otherClient.id, amountMinor: 1000, method: 'CARD', allocations: [{ invoiceId: inv.id, amountMinor: 1000 }] })).body.error.code).toBe('INVALID_INVOICE');
  });
});
