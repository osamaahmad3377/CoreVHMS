import { localParts, zonedToUtc } from '../src/common/time/tz';
import { closeApp, makeClient, makePatient, prisma, registerOrg, speciesId, staff } from './helpers';

// Intervals, ages and doses below are arbitrary test values, not veterinary recommendations.
// Test orgs are in Pakistan, so calendar dates are Karachi dates (UTC+5), not UTC ones.
const TZ = 'Asia/Karachi';
const daysFrom = (d: number) => localParts(new Date(Date.now() + d * 86400_000), TZ).date;

async function setup() {
  const org = await registerOrg();
  const vet = await staff(org, 'veterinarian', { isClinician: true });
  const client = await makeClient(org.owner, { email: `${Date.now()}@example.test` });
  const patient = await makePatient(org.owner, client.id, { dateOfBirth: daysFrom(-28) });
  const vaccine = await org.owner.post('/products', { name: 'Test vaccine', type: 'VACCINE', dispensingUnit: 'dose', minDispenseIncrement: 1, sellPriceMinor: 2000 });
  const protocol = await vet.client.post('/care-protocols', { name: 'Core vaccine', kind: 'VACCINATION', speciesId: await speciesId(org.owner), productId: vaccine.body.id, firstDueAgeWeeks: 8, intervalDays: 365, source: 'Test protocol (clinic policy document v1)' });
  return { org, vet, client, patient, vaccine: vaccine.body, protocol: protocol.body };
}

describe('Preventive care', () => {
  afterAll(closeApp);

  it('requires a source and a vet review before a protocol is used', async () => {
    const s = await setup();
    expect((await s.vet.client.post('/care-protocols', { name: 'x', kind: 'DEWORMING', intervalDays: 90 })).status).toBe(400);
    expect(s.protocol.status).toBe('DRAFT');
    expect((await s.vet.client.post(`/patients/${s.patient.id}/care-plan/apply`, {})).body.created).toBe(0); // drafts are never applied
    const nurse = await staff(s.org, 'nurse');
    expect((await nurse.client.post(`/care-protocols/${s.protocol.id}/status`, { status: 'APPROVED' })).body.error.code).toBe('REVIEW_REQUIRED');
    const ok = await s.vet.client.post(`/care-protocols/${s.protocol.id}/status`, { status: 'APPROVED' });
    expect(ok.body).toMatchObject({ status: 'APPROVED', reviewedByName: expect.any(String) });
    // Editing an approved protocol sends it back for review.
    const edited = await s.vet.client.patch(`/care-protocols/${s.protocol.id}`, { name: 'Core vaccine v2', kind: 'VACCINATION', intervalDays: 365, firstDueAgeWeeks: 8, source: 'Policy v2' });
    expect(edited.body.status).toBe('DRAFT');
  });

  it('builds a care plan by age, never duplicates open items, and schedules the next one on completion', async () => {
    const s = await setup();
    await s.vet.client.post(`/care-protocols/${s.protocol.id}/status`, { status: 'APPROVED' });
    const both = await Promise.all([1, 2].map(() => s.vet.client.post(`/patients/${s.patient.id}/care-plan/apply`, {})));
    expect(both.map((r) => r.body.created ?? 0).reduce((a, b) => a + b, 0)).toBe(1);
    const plan = (await s.vet.client.get(`/patients/${s.patient.id}/care-plan`)).body;
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]).toMatchObject({ status: 'DUE', dueDate: expect.stringContaining(daysFrom(28)) }); // 8 weeks of age
    expect(plan.availableProtocols).toHaveLength(0);

    const done = await s.vet.client.post(`/care-items/${plan.items[0].id}/complete`, { mode: 'ADMINISTER', productId: s.vaccine.id, dose: 1, doseUnit: 'dose', route: 'SC', batchNumber: 'VB-1' });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ status: 'COMPLETED', administrationId: expect.any(String) });
    const after = (await s.vet.client.get(`/patients/${s.patient.id}/care-plan`)).body.items;
    const next = after.find((i: any) => i.status === 'DUE');
    expect(next.dueDate.slice(0, 10)).toBe(daysFrom(365));
    expect(await prisma().charge.count({ where: { sourceType: 'Administration', patientId: s.patient.id } })).toBe(1);
    const cert = (await s.vet.client.get(`/patients/${s.patient.id}/vaccination-certificate`)).body;
    expect(cert.given[0]).toMatchObject({ product: 'Test vaccine', batchNumber: 'VB-1' });
    expect(cert.nextDue[0].dueDate.slice(0, 10)).toBe(daysFrom(365));
    await expect(prisma().careItem.update({ where: { id: plan.items[0].id }, data: { title: 'changed' } })).rejects.toThrow(/cannot be changed/);
    expect((await s.vet.client.post(`/care-items/${plan.items[0].id}/complete`, { mode: 'DONE' })).body.error.code).toBe('NOT_OPEN');
  });

  it('counts the next due date from the local calendar day it was given, even just after local midnight', async () => {
    const s = await setup();
    await s.vet.client.post(`/care-protocols/${s.protocol.id}/status`, { status: 'APPROVED' });
    await s.vet.client.post(`/patients/${s.patient.id}/care-plan/apply`, {});
    const item = (await s.vet.client.get(`/patients/${s.patient.id}/care-plan`)).body.items[0];
    // 00:30 yesterday in Karachi is still the day before in UTC.
    const givenAt = zonedToUtc(daysFrom(-1), 30, TZ);
    expect(givenAt.toISOString().slice(0, 10)).toBe(daysFrom(-2));
    const done = await s.vet.client.post(`/care-items/${item.id}/complete`, { mode: 'DONE', completedAt: givenAt.toISOString() });
    expect(done.status).toBe(200);
    const next = (await s.vet.client.get(`/patients/${s.patient.id}/care-plan`)).body.items.find((i: any) => i.status === 'DUE');
    expect(next.dueDate.slice(0, 10)).toBe(daysFrom(364)); // yesterday + 365 days
  });

  it('completes the care item automatically when the vaccine is given elsewhere in the system', async () => {
    const s = await setup();
    await s.vet.client.post(`/care-protocols/${s.protocol.id}/status`, { status: 'APPROVED' });
    await s.vet.client.post(`/patients/${s.patient.id}/care-plan/apply`, {});
    const r = await s.vet.client.post('/administrations', { patientId: s.patient.id, productId: s.vaccine.id, status: 'GIVEN', dose: 1, doseUnit: 'dose', route: 'SC' });
    expect(r.status).toBe(201);
    const items = (await s.vet.client.get(`/patients/${s.patient.id}/care-plan`)).body.items;
    expect(items.find((i: any) => i.status === 'COMPLETED')).toMatchObject({ administrationId: r.body.id });
    expect(items.filter((i: any) => i.status === 'DUE')).toHaveLength(1);
  });

  it('defers, cancels, records care given elsewhere, and reports compliance and overdue work', async () => {
    const s = await setup();
    await s.vet.client.post(`/care-protocols/${s.protocol.id}/status`, { status: 'APPROVED' });
    const deworm = await s.vet.client.post('/care-items', { patientId: s.patient.id, kind: 'DEWORMING', title: 'Deworming', dueDate: daysFrom(-10) });
    expect(deworm.status).toBe(201);
    const overdue = (await s.vet.client.get('/care-items?range=overdue')).body;
    expect(overdue.data.map((i: any) => i.id)).toContain(deworm.body.id);
    expect(overdue.data.find((i: any) => i.id === deworm.body.id)).toMatchObject({ overdue: true, owner: { id: s.client.id } });
    expect((await s.vet.client.post(`/care-items/${deworm.body.id}/defer`, { until: daysFrom(-1), reason: 'x' })).body.error.code).toBe('INVALID_DATE');
    const d = await s.vet.client.post(`/care-items/${deworm.body.id}/defer`, { until: daysFrom(14), reason: 'Patient unwell' });
    expect(d.body).toMatchObject({ status: 'DEFERRED', overdue: false });
    const elsewhere = await s.vet.client.post(`/care-items/${deworm.body.id}/complete`, { mode: 'ELSEWHERE', productName: 'Brand X' });
    expect(elsewhere.body).toMatchObject({ status: 'COMPLETED', givenElsewhere: true, productName: 'Brand X' });
    await s.vet.client.post(`/patients/${s.patient.id}/care-plan/apply`, {});
    const vac = (await s.vet.client.get(`/patients/${s.patient.id}/care-plan`)).body.items.find((i: any) => i.status === 'DUE');
    expect((await s.vet.client.post(`/care-items/${vac.id}/cancel`, { reason: 'Owner declined' })).body.status).toBe('CANCELLED');
    const compliance = (await s.vet.client.get('/preventive/compliance')).body;
    expect(compliance[0]).toMatchObject({ name: 'Core vaccine', patientsInScope: 1, inPlan: 0, notInPlan: 1 });
    const rec = await staff(s.org, 'receptionist');
    expect((await rec.client.post(`/care-items/${vac.id}/complete`, { mode: 'DONE' })).status).toBe(403);
    const other = await registerOrg();
    expect((await other.owner.get(`/patients/${s.patient.id}/care-plan`)).status).toBe(404);
  });

  it('repeats an item on its own schedule until its end, and can stop a protocol from repeating', async () => {
    const s = await setup();
    // Every 2 weeks, 1 more dose after this one.
    const first = await s.vet.client.post('/care-items', { patientId: s.patient.id, kind: 'VACCINATION', title: 'Puppy booster', dueDate: daysFrom(0), repeatEvery: 2, repeatUnit: 'WEEK', repeatTimes: 1 });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ repeatEvery: 2, repeatUnit: 'WEEK', repeatTimes: 1 });
    expect((await s.vet.client.post(`/care-items/${first.body.id}/complete`, { mode: 'DONE' })).status).toBe(200);
    let plan = (await s.vet.client.get(`/patients/${s.patient.id}/care-plan`)).body;
    const second = plan.items.find((i: any) => i.status === 'DUE' && i.title === 'Puppy booster');
    expect(second).toMatchObject({ dueDate: expect.stringContaining(daysFrom(14)), repeatEvery: 2, repeatUnit: 'WEEK', repeatTimes: 0 });
    // The last dose: nothing more is scheduled.
    await s.vet.client.post(`/care-items/${second.id}/complete`, { mode: 'DONE' });
    plan = (await s.vet.client.get(`/patients/${s.patient.id}/care-plan`)).body;
    expect(plan.items.filter((i: any) => i.title === 'Puppy booster' && i.status === 'DUE')).toHaveLength(0);

    // A protocol item told not to repeat stops after this dose.
    await s.vet.client.post(`/care-protocols/${s.protocol.id}/status`, { status: 'APPROVED' });
    const once = await s.vet.client.post('/care-items', { patientId: s.patient.id, protocolId: s.protocol.id, kind: 'VACCINATION', title: 'Core vaccine', dueDate: daysFrom(0) });
    const stop = await s.vet.client.post(`/care-items/${once.body.id}/repeat`, { repeatEvery: 0 });
    expect(stop.body.repeatEvery).toBe(0);
    await s.vet.client.post(`/care-items/${once.body.id}/complete`, { mode: 'DONE' });
    plan = (await s.vet.client.get(`/patients/${s.patient.id}/care-plan`)).body;
    expect(plan.items.filter((i: any) => i.protocolId === s.protocol.id && i.status === 'DUE')).toHaveLength(0);

    // An end date before the next dose ends the series; a bad repeat is refused.
    const monthly = await s.vet.client.post('/care-items', { patientId: s.patient.id, kind: 'DEWORMING', title: 'Monthly worming', dueDate: daysFrom(0), repeatEvery: 1, repeatUnit: 'MONTH', repeatUntil: daysFrom(10) });
    await s.vet.client.post(`/care-items/${monthly.body.id}/complete`, { mode: 'DONE' });
    plan = (await s.vet.client.get(`/patients/${s.patient.id}/care-plan`)).body;
    expect(plan.items.filter((i: any) => i.title === 'Monthly worming' && i.status === 'DUE')).toHaveLength(0);
    expect((await s.vet.client.post('/care-items', { patientId: s.patient.id, kind: 'VACCINATION', title: 'x', dueDate: daysFrom(0), repeatEvery: 3 })).status).toBe(400);
  });
});
