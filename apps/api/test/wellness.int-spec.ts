import { computeBenefit } from '../src/modules/wellness/wellness-benefit';
import { closeApp, makeClient, makePatient, prisma, registerOrg, speciesId, staff } from './helpers';

// Prices and discounts are arbitrary test values.
async function setup() {
  const org = await registerOrg();
  const vet = await staff(org, 'veterinarian', { isClinician: true });
  const desk = await staff(org, 'receptionist');
  const client = await makeClient(org.owner);
  const patient = await makePatient(org.owner, client.id);
  const sp = (await org.owner.post('/services', { code: 'DSP', name: 'Scale and polish', category: 'DENTAL', priceMinor: 800000 })).body;
  await org.owner.call('put', '/dental/prices', { items: [{ code: 'SP', serviceId: sp.id }] });
  const lab = (await org.owner.post('/lab-tests', { code: 'CBC', name: 'Blood count', category: 'HAEMATOLOGY', priceMinor: 300000, analytes: [{ code: 'A', name: 'A' }] })).body;
  const product = (await org.owner.post('/products', { name: 'Wellness tabs', strengthValue: 10, strengthUnit: 'mg', dispensingUnit: 'tablet', minDispenseIncrement: 1, sellPriceMinor: 1000 })).body;
  const plan = await org.owner.post('/wellness/plans', {
    name: 'Gold',
    description: 'Yearly care for adult dogs',
    speciesId: await speciesId(org.owner, 'Dog'),
    durationMonths: 12,
    priceMinor: 1200000,
    monthlyPriceMinor: 110000,
    joiningFeeMinor: 50000,
    serviceDiscountBp: 1000,
    productDiscountBp: 500,
    items: [
      { kind: 'SERVICE', serviceId: sp.id, quantity: 1 },
      { kind: 'LAB', labTestId: lab.id, quantity: 1 },
    ],
  });
  expect(plan.status).toBe(201);
  return { org, vet, desk, client, patient, sp, lab, product, plan: plan.body };
}

/** A whole-mouth scale and polish on a new dental chart: one SERVICE charge for the patient. */
async function scaleAndPolish(s: Awaited<ReturnType<typeof setup>>, patientId = s.patient.id) {
  const chart = (await s.vet.client.post('/dental/charts', { patientId, dentition: 'CANINE' })).body;
  const r = await s.vet.client.post(`/dental/charts/${chart.id}/procedures`, { code: 'SP' });
  expect(r.status).toBe(200);
  return r.body.procedures[0].charge;
}

const chargesOf = async (s: Awaited<ReturnType<typeof setup>>, status = 'PENDING') => (await s.org.owner.get(`/charges?clientId=${s.client.id}&status=${status}&pageSize=100`)).body;

describe('Wellness plans', () => {
  afterAll(closeApp);

  it('works out what a plan takes off a charge', () => {
    expect(computeBenefit({ quantity: 1, unitPriceMinor: 1000, remaining: 1, discountBp: 1000 })).toMatchObject({ usedUnits: 1, discountMinor: 1000 });
    expect(computeBenefit({ quantity: 1, unitPriceMinor: 1000, remaining: 0, discountBp: 1000 })).toMatchObject({ usedUnits: 0, discountMinor: 100 });
    expect(computeBenefit({ quantity: 3, unitPriceMinor: 1000, remaining: 2, discountBp: 1000 })).toMatchObject({ usedUnits: 2, includedMinor: 2000, memberMinor: 100, discountMinor: 2100 });
    expect(computeBenefit({ quantity: 0.5, unitPriceMinor: 1000, remaining: 1, discountBp: 0 })).toMatchObject({ usedUnits: 1, discountMinor: 500 });
    expect(computeBenefit({ quantity: 2, unitPriceMinor: 1000, remaining: null, discountBp: 0 })).toMatchObject({ discountMinor: 0 });
  });

  it('manages plans: managers create and retire them; others can only look', async () => {
    const s = await setup();
    expect(s.plan).toMatchObject({ name: 'Gold', status: 'ACTIVE', includedValueMinor: 1100000 });
    expect(s.plan.items.map((i: any) => [i.label, i.quantity])).toEqual([['Scale and polish', 1], ['Blood count', 1]]);
    expect((await s.org.owner.post('/wellness/plans', { name: 'Gold', priceMinor: 1, serviceDiscountBp: 100 })).status).toBe(409);
    expect((await s.org.owner.post('/wellness/plans', { name: 'Nothing', priceMinor: 1 })).status).toBe(400);
    expect((await s.desk.client.post('/wellness/plans', { name: 'Desk plan', priceMinor: 1, serviceDiscountBp: 100 })).status).toBe(403);
    expect((await s.desk.client.get('/wellness/plans')).body.map((p: any) => p.name)).toEqual(['Gold']);

    const silver = (await s.org.owner.post('/wellness/plans', { name: 'Silver', priceMinor: 500000, serviceDiscountBp: 500 })).body;
    expect((await s.org.owner.post(`/wellness/plans/${silver.id}/status`, { status: 'RETIRED' })).body.status).toBe('RETIRED');
    expect((await s.org.owner.get('/wellness/plans')).body.map((p: any) => p.name)).toEqual(['Gold']);
    expect((await s.org.owner.get('/wellness/plans?all=true')).body.map((p: any) => p.name)).toEqual(['Gold', 'Silver']);
    expect((await s.desk.client.post('/wellness/enrolments', { planId: silver.id, patientId: s.patient.id })).body.error.code).toBe('PLAN_RETIRED');
    // A dog plan isn't offered for a cat.
    const cat = await makePatient(s.org.owner, s.client.id, { name: 'Misty', speciesId: await speciesId(s.org.owner, 'Cat'), sex: 'FEMALE' });
    expect((await s.desk.client.post('/wellness/enrolments', { planId: s.plan.id, patientId: cat.id })).body.error.code).toBe('WRONG_SPECIES');
    expect((await s.desk.client.get(`/patients/${cat.id}/wellness`)).body.availablePlans).toEqual([]);
  });

  it('enrols a patient, bills the plan, and covers included items then gives the member discount', async () => {
    const s = await setup();
    // Work done before joining today is covered too: the plan is often sold at the visit.
    const before = await scaleAndPolish(s);
    expect(before).toMatchObject({ discountMinor: 0 });

    const e = await s.desk.client.post('/wellness/enrolments', { planId: s.plan.id, patientId: s.patient.id, billing: 'UPFRONT' });
    expect(e.status).toBe(201);
    expect(e.body).toMatchObject({ state: 'ACTIVE', billing: 'UPFRONT', totalMinor: 1250000, enrolmentNo: expect.stringMatching(/^WP-0+1$/), planName: 'Gold' });
    expect(Date.parse(e.body.endDate) - Date.parse(e.body.startDate)).toBeGreaterThan(363 * 86400_000);
    expect(e.body.instalments).toEqual([expect.objectContaining({ seq: 1, amountMinor: 1250000, status: 'BILLED', chargeStatus: 'PENDING' })]);
    // The scale and polish from before is now included (1 of 1 used).
    expect(e.body.entitlements.map((x: any) => [x.label, x.used, x.remaining])).toEqual([['Scale and polish', 1, 0], ['Blood count', 0, 1]]);
    expect((await s.desk.client.post('/wellness/enrolments', { planId: s.plan.id, patientId: s.patient.id })).body.error.code).toBe('ALREADY_ENROLLED');

    let pending = await chargesOf(s);
    const planCharge = pending.data.find((c: any) => c.sourceType === 'WellnessInstalment');
    expect(planCharge).toMatchObject({ kind: 'CUSTOM', unitPriceMinor: 1250000, discountMinor: 0, description: expect.stringContaining('Gold wellness plan') });
    expect(pending.data.find((c: any) => c.id === before.id || c.sourceType === 'DentalProcedure')).toMatchObject({ discountMinor: 800000, discountNote: 'Included in Gold (1 of 1 used)' });

    // The second scale and polish isn't included any more: 10% member discount.
    const second = await scaleAndPolish(s);
    expect(second).toMatchObject({ discountMinor: 80000, discountNote: 'Gold member discount 10%' });
    // A lab test: included once.
    const order = await s.vet.client.post('/lab-orders', { patientId: s.patient.id, testIds: [s.lab.id] });
    expect(order.status).toBe(201);
    // A product: 5% member discount (4 × 1000 = 4000 → 200 off).
    const rx = await s.vet.client.post('/prescriptions', { patientId: s.patient.id, items: [{ productId: s.product.id, route: 'PO', doseValue: 1, doseUnit: 'tablet', frequencyCode: 'ONCE', quantity: 4, instructions: 'x' }], authorize: true });
    await s.org.owner.post(`/prescriptions/${rx.body.id}/dispense`, { lines: [{ itemId: rx.body.items[0].id, quantity: 4 }] });

    pending = await chargesOf(s);
    const by = (t: string) => pending.data.filter((c: any) => c.sourceType === t);
    expect(by('DiagnosticOrderItem')[0]).toMatchObject({ discountMinor: 300000, discountNote: 'Included in Gold (1 of 1 used)' });
    expect(by('Dispensation')[0]).toMatchObject({ discountMinor: 200, discountNote: 'Gold member discount 5%' });
    // Unbilled total is what's left to pay: 1,250,000 plan + 0 + 720,000 + 0 + 3,800.
    expect(pending.totalMinor).toBe(1250000 + 720000 + 3800);

    // Invoiced: each line shows the full price, the discount and why.
    const inv = await s.org.owner.post('/invoices', { clientId: s.client.id, chargeIds: pending.data.map((c: any) => c.id), issue: true });
    expect(inv.status).toBe(201);
    const line = inv.body.lines.find((l: any) => l.description.startsWith('Scale and polish') && l.discountMinor === 800000);
    expect(line).toMatchObject({ unitPriceMinor: 800000, netMinor: 0, description: expect.stringContaining('— Included in Gold (1 of 1 used)') });
    expect(inv.body.discountMinor).toBe(800000 + 80000 + 300000 + 200);
    expect(inv.body.totalMinor).toBe(1250000 + 720000 + 3800);

    const d = (await s.desk.client.get(`/wellness/enrolments/${e.body.id}`)).body;
    expect(d.savedMinor).toBe(800000 + 80000 + 300000 + 200);
    expect(d.instalments[0]).toMatchObject({ chargeStatus: 'INVOICED', invoice: expect.objectContaining({ status: 'ISSUED' }) });
    // A benefit on an issued invoice can't be taken back.
    const usage = d.usages.find((u: any) => u.kind === 'INCLUDED');
    expect((await s.desk.client.post(`/wellness/usages/${usage.id}/reverse`, { reason: 'test' })).body.error.code).toBe('ALREADY_INVOICED');

    const actions = (await prisma().auditEvent.findMany({ where: { organizationId: s.org.orgId, action: { startsWith: 'wellness.' } }, select: { action: true } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['wellness.plan_created', 'wellness.enrolled', 'wellness.benefit_applied']));
  });

  it('gives a benefit back when its charge is waived, and records items used outside billing', async () => {
    const s = await setup();
    const e = (await s.desk.client.post('/wellness/enrolments', { planId: s.plan.id, patientId: s.patient.id })).body;
    const covered = await scaleAndPolish(s);
    expect(covered.discountMinor).toBe(800000);

    const waived = await s.org.owner.post(`/charges/${covered.id}/waive`, { reason: 'Goodwill' });
    expect(waived.body.error ?? waived.body.status).toBe('WAIVED');
    let d = (await s.desk.client.get(`/wellness/enrolments/${e.id}`)).body;
    expect(d.entitlements[0]).toMatchObject({ used: 0, remaining: 1 });
    expect(d.usages[0]).toMatchObject({ reversedReason: 'Charge waived: Goodwill' });
    // Restored: the benefit is applied again.
    const restored = await s.org.owner.post(`/charges/${covered.id}/restore`);
    expect(restored.body).toMatchObject({ status: 'PENDING', discountMinor: 800000 });
    d = (await s.desk.client.get(`/wellness/enrolments/${e.id}`)).body;
    expect(d.entitlements[0]).toMatchObject({ used: 1, remaining: 0 });

    // Reversing an unbilled benefit puts the full price back on the charge.
    const active = d.usages.find((u: any) => !u.reversedAt);
    expect((await s.desk.client.post(`/wellness/usages/${active.id}/reverse`, { reason: 'Wrong patient' })).status).toBe(200);
    expect((await chargesOf(s)).data.find((c: any) => c.id === covered.id)).toMatchObject({ discountMinor: 0, discountNote: null });
    // "Apply to unbilled items" puts it back.
    expect((await s.desk.client.post(`/wellness/enrolments/${e.id}/apply`)).body).toEqual({ applied: 1 });

    // An included item used without a charge (e.g. done at the counter).
    const blood = d.entitlements.find((x: any) => x.label === 'Blood count');
    const used = await s.desk.client.post(`/wellness/enrolments/${e.id}/usage`, { entitlementId: blood.id, quantity: 1, note: 'Done during vaccination visit' });
    expect(used.status).toBe(200);
    expect(used.body.entitlements.find((x: any) => x.id === blood.id)).toMatchObject({ used: 1, remaining: 0 });
    expect((await s.desk.client.post(`/wellness/enrolments/${e.id}/usage`, { entitlementId: blood.id, quantity: 1, note: 'again' })).body.error.code).toBe('NOTHING_LEFT');

    // Benefits are never deleted or rewritten in the database.
    const u = await prisma().wellnessUsage.findFirstOrThrow({ where: { enrolmentId: e.id } });
    await expect(prisma().wellnessUsage.delete({ where: { id: u.id } })).rejects.toThrow(/cannot be deleted/);
    await expect(prisma().wellnessUsage.update({ where: { id: u.id }, data: { savedMinor: 1 } })).rejects.toThrow();
  });

  it('bills monthly payments as they fall due, and settles up on cancelling', async () => {
    const s = await setup();
    const e = await s.desk.client.post('/wellness/enrolments', { planId: s.plan.id, patientId: s.patient.id, billing: 'MONTHLY', autoRenew: true });
    expect(e.status).toBe(201);
    expect(e.body.instalments).toHaveLength(12);
    expect(e.body.instalments[0]).toMatchObject({ amountMinor: 160000, status: 'BILLED' }); // 110,000 + 50,000 joining fee
    expect(e.body.instalments[1]).toMatchObject({ amountMinor: 110000, status: 'SCHEDULED' });
    expect(e.body.nextPayment).toMatchObject({ amountMinor: 110000, dueDate: e.body.instalments[1].dueDate });
    expect(e.body.totalMinor).toBe(160000 + 11 * 110000);

    // Payment 2 falls due (pretend): "Bill payments due" charges it, once.
    await prisma().wellnessInstalment.update({ where: { id: e.body.instalments[1].id }, data: { dueDate: new Date(Date.now() - 86400_000) } });
    expect((await s.desk.client.post('/wellness/bill-due')).body).toEqual({ billed: 1 });
    expect((await s.desk.client.post('/wellness/bill-due')).body).toEqual({ billed: 0 });
    const plan = (await chargesOf(s)).data.filter((c: any) => c.sourceType === 'WellnessInstalment');
    expect(plan.map((c: any) => c.unitPriceMinor).sort()).toEqual([110000, 160000]);

    // Invoice payment 1 only; use the scale and polish (worth 800,000).
    const first = plan.find((c: any) => c.unitPriceMinor === 160000);
    await s.org.owner.post('/invoices', { clientId: s.client.id, chargeIds: [first.id], issue: true });
    await scaleAndPolish(s);

    const settle = (await s.desk.client.get(`/wellness/enrolments/${e.body.id}/settlement`)).body;
    expect(settle).toMatchObject({ billedMinor: 160000, unbilledChargesMinor: 110000, scheduledMinor: 10 * 110000, usedValueMinor: 800000, shortfallMinor: 640000, unusedMinor: 0 });

    expect((await s.desk.client.post(`/wellness/enrolments/${e.body.id}/cancel`, {})).status).toBe(400);
    const cancelled = await s.desk.client.post(`/wellness/enrolments/${e.body.id}/cancel`, { reason: 'Moving abroad', chargeShortfall: true });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({ state: 'CANCELLED', autoRenew: false, cancelReason: 'Moving abroad', cancelledByName: 'Test receptionist' });
    expect(cancelled.body.instalments.filter((i: any) => i.status === 'CANCELLED')).toHaveLength(11);
    const after = (await chargesOf(s)).data;
    expect(after.filter((c: any) => c.sourceType === 'WellnessInstalment')).toHaveLength(0); // payment 2 waived
    expect(after.find((c: any) => c.sourceType === 'WellnessCancellation')).toMatchObject({ unitPriceMinor: 640000 });
    expect((await s.desk.client.post(`/wellness/enrolments/${e.body.id}/cancel`, { reason: 'again' })).body.error.code).toBe('CANCELLED');
    // No benefits after cancelling.
    expect((await scaleAndPolish(s)).discountMinor).toBe(0);
    // The patient can join again.
    expect((await s.desk.client.post('/wellness/enrolments', { planId: s.plan.id, patientId: s.patient.id })).status).toBe(201);
  });

  it('renews onto the next term, keeps members on what they bought, and lists members', async () => {
    const s = await setup();
    const e = (await s.desk.client.post('/wellness/enrolments', { planId: s.plan.id, patientId: s.patient.id })).body;
    // Changing the plan doesn't change what existing members have.
    await s.org.owner.patch(`/wellness/plans/${s.plan.id}`, { name: 'Gold', priceMinor: 1500000, serviceDiscountBp: 2000, items: [{ kind: 'SERVICE', serviceId: s.sp.id, quantity: 2 }] });
    const still = (await s.desk.client.get(`/wellness/enrolments/${e.id}`)).body;
    expect(still.entitlements.map((x: any) => x.quantity)).toEqual([1, 1]);
    expect(still.serviceDiscountBp).toBe(1000);

    const renewed = await s.desk.client.post(`/wellness/enrolments/${e.id}/renew`, {});
    expect(renewed.status).toBe(200);
    const dayAfter = new Date(Date.parse(e.endDate) + 86400_000).toISOString().slice(0, 10);
    expect(renewed.body).toMatchObject({ state: 'UPCOMING', startDate: dayAfter, renewedFrom: expect.objectContaining({ id: e.id }), joiningFeeMinor: 0, totalMinor: 1500000 });
    expect(renewed.body.entitlements.map((x: any) => x.quantity)).toEqual([2]);
    expect(renewed.body.instalments[0]).toMatchObject({ status: 'SCHEDULED' }); // billed when the new term starts
    expect((await s.desk.client.post(`/wellness/enrolments/${e.id}/renew`, {})).body.error.code).toBe('ALREADY_RENEWED');

    const forPatient = (await s.desk.client.get(`/patients/${s.patient.id}/wellness`)).body;
    expect(forPatient.current.id).toBe(e.id);
    expect(forPatient.upcoming.id).toBe(renewed.body.id);
    expect((await s.desk.client.get('/wellness/members?status=ACTIVE')).body.data.map((m: any) => m.id)).toEqual([e.id]);
    expect((await s.desk.client.get('/wellness/members?status=UPCOMING')).body.data.map((m: any) => m.id)).toEqual([renewed.body.id]);
    expect((await s.desk.client.get(`/wellness/members?status=ALL&q=${encodeURIComponent(s.patient.name)}`)).body.meta.total).toBe(2);
    const overview = (await s.desk.client.get('/wellness/overview')).body;
    expect(overview).toMatchObject({ activeMembers: 1, endingSoon: 0, plans: [expect.objectContaining({ name: 'Gold', activeMembers: 1 })] });

    // The database allows only one active plan at a time per patient.
    const copy = await prisma().wellnessEnrolment.findUniqueOrThrow({ where: { id: e.id } });
    await expect(
      prisma().wellnessEnrolment.create({ data: { ...copy, id: undefined, number: 999, renewedFromId: null, createdAt: undefined, updatedAt: undefined } as any }),
    ).rejects.toThrow(/WellnessEnrolment_no_overlap/);

    const timeline = (await s.desk.client.get(`/patients/${s.patient.id}/timeline`)).body;
    const events = Array.isArray(timeline) ? timeline : timeline.data ?? timeline.events;
    expect(events.filter((x: any) => x.kind === 'wellness').map((x: any) => x.title).sort()).toEqual(['Joined wellness plan: Gold', 'Wellness plan renewed: Gold']);

    const other = await registerOrg();
    expect((await other.owner.get(`/wellness/enrolments/${e.id}`)).status).toBe(404);
    expect((await other.owner.post('/wellness/enrolments', { planId: s.plan.id, patientId: s.patient.id })).status).toBe(404);
    // A nurse can see plans but not enrol.
    const nurse = await staff(s.org, 'nurse');
    expect((await nurse.client.get(`/patients/${s.patient.id}/wellness`)).status).toBe(200);
    const another = await makePatient(s.org.owner, (await makeClient(s.org.owner)).id);
    expect((await nurse.client.post('/wellness/enrolments', { planId: s.plan.id, patientId: another.id })).status).toBe(403);
  });
});
