import { RequestContext } from '../src/common/context/request-context';
import { AdmissionsService } from '../src/modules/hospital/admissions.service';
import { closeApp, getApp, makeClient, makePatient, prisma, registerOrg, staff } from './helpers';

// Prices, doses and intervals here are arbitrary test values, not clinical guidance.
async function setup() {
  const org = await registerOrg();
  const vet = await staff(org, 'veterinarian', { isClinician: true });
  const client = await makeClient(org.owner);
  const patient = await makePatient(org.owner, client.id);
  const svc = await org.owner.post('/services', { code: 'HOSPDAY', name: 'Hospitalisation per day', category: 'HOSPITALISATION', priceMinor: 5000 });
  const ward = await org.owner.post('/wards', { branchId: org.branchId, name: 'General', type: 'GENERAL', dailyServiceId: svc.body.id });
  const icu = await org.owner.post('/wards', { branchId: org.branchId, name: 'ICU', type: 'ICU' });
  const k1 = await org.owner.post('/cages', { wardId: ward.body.id, name: 'K1' });
  const k2 = await org.owner.post('/cages', { wardId: ward.body.id, name: 'K2' });
  const product = await org.owner.post('/products', { name: 'Testamox 50 mg tablets', strengthValue: 50, strengthUnit: 'mg', dispensingUnit: 'tablet', minDispenseIncrement: 1, sellPriceMinor: 300, activeIngredients: ['testamox'] });
  return { org, vet, client, patient, wardId: ward.body.id as string, icuId: icu.body.id as string, k1: k1.body.id as string, k2: k2.body.id as string, product: product.body };
}

const admit = (s: Awaited<ReturnType<typeof setup>>, extra: Record<string, unknown> = {}) =>
  s.vet.client.post('/admissions', { patientId: s.patient.id, wardId: s.wardId, cageId: s.k1, reason: 'Observation after vomiting', responsibleClinicianId: s.vet.membershipId, ...extra });

const upkeep = async (orgId: string, now?: Date) => {
  const svc = (await getApp()).get(AdmissionsService);
  return RequestContext.runAs({ organizationId: orgId, userName: 'System' }, () => svc.upkeep(now));
};

describe('Hospitalisation', () => {
  afterAll(closeApp);

  it('admits into a cage, prevents double occupancy and double admission (also under concurrency)', async () => {
    const s = await setup();
    const p2 = await makePatient(s.org.owner, s.client.id);
    const p3 = await makePatient(s.org.owner, s.client.id);
    const a = await admit(s);
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ status: 'ADMITTED', admissionNo: expect.stringMatching(/^HOSP-\d{6}$/), cage: { name: 'K1' }, responsibleClinician: { id: s.vet.membershipId } });
    expect((await admit(s, { cageId: s.k2 })).status).toBe(409); // already in hospital
    expect((await admit(s, { patientId: p2.id })).status).toBe(409); // cage K1 occupied
    const race = await Promise.all([p2, p3].map((p) => admit(s, { patientId: p.id, cageId: s.k2 })));
    expect(race.map((r) => r.status).sort()).toEqual([201, 409]);
    const board = (await s.org.owner.get('/hospital/flowboard')).body;
    expect(board.summary.inpatients).toBe(2);
    expect(board.wards.find((w: any) => w.name === 'General').cages.every((c: any) => c.admissionId)).toBe(true);
    const other = await registerOrg();
    expect((await other.owner.get(`/admissions/${a.body.id}`)).status).toBe(404);
    expect((await other.owner.get('/hospital/flowboard')).body.summary.inpatients).toBe(0);
  });

  it('charges one day per started 24 hours at the ward rate, exactly once', async () => {
    const s = await setup();
    const a = await admit(s);
    const dayCharges = () => prisma().charge.findMany({ where: { sourceType: 'HospitalDay', patientId: s.patient.id }, orderBy: { description: 'asc' } });
    expect(await dayCharges()).toHaveLength(1);
    await prisma().admission.update({ where: { id: a.body.id }, data: { admittedAt: new Date(Date.now() - 50 * 3600_000) } });
    await upkeep(s.org.orgId);
    await upkeep(s.org.orgId);
    const charges = await dayCharges();
    expect(charges.map((c) => c.description)).toEqual(['Hospitalisation per day — day 1 (General)', 'Hospitalisation per day — day 2 (General)', 'Hospitalisation per day — day 3 (General)']);
    expect(charges.every((c) => c.unitPriceMinor === 5000)).toBe(true);
    // ICU has no daily rate: moving keeps the days already charged and adds none.
    expect((await s.vet.client.post(`/admissions/${a.body.id}/move`, { wardId: s.icuId })).body.ward.name).toBe('ICU');
    await upkeep(s.org.orgId, new Date(Date.now() + 48 * 3600_000));
    expect(await dayCharges()).toHaveLength(3);
  });

  it('runs the treatment sheet: scheduled doses via pharmacy, one recording per task, allergy checks, PRN and stop', async () => {
    const s = await setup();
    const a = await admit(s);
    const ward = await staff(s.org, 'ward_staff');
    const medOrder = { kind: 'MEDICATION', schedule: 'INTERVAL', intervalHours: 8, description: 'Testamox', productId: s.product.id, dose: 1, doseUnit: 'tablet', route: 'PO' };
    expect((await ward.client.post(`/admissions/${a.body.id}/orders`, medOrder)).status).toBe(403); // prescribing decision
    const order = await s.vet.client.post(`/admissions/${a.body.id}/orders`, medOrder);
    expect(order.status).toBe(201);
    const sheet = (await s.vet.client.get(`/admissions/${a.body.id}/sheet?to=${new Date(Date.now() + 40 * 3600_000).toISOString()}`)).body;
    const tasks = sheet.orders[0].tasks;
    expect(tasks).toHaveLength(5); // 0, 8, 16, 24, 32 h within the 36 h horizon
    const both = await Promise.all([1, 2].map(() => ward.client.post(`/treatment-tasks/${tasks[0].id}/complete`, { status: 'DONE' })));
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await prisma().medicationAdministration.count({ where: { patientId: s.patient.id } })).toBe(1);
    expect(await prisma().charge.count({ where: { sourceType: 'Administration', patientId: s.patient.id } })).toBe(1);
    expect((await ward.client.post(`/treatment-tasks/${tasks[1].id}/complete`, { status: 'SKIPPED' })).status).toBe(400);
    expect((await ward.client.post(`/treatment-tasks/${tasks[1].id}/complete`, { status: 'SKIPPED', skipReason: 'Patient vomiting' })).body.status).toBe('SKIPPED');
    await expect(prisma().treatmentTask.update({ where: { id: tasks[0].id }, data: { notes: 'edited' } })).rejects.toThrow(/cannot be changed/);

    // Allergy: the pharmacy safety check applies to the treatment sheet.
    await s.vet.client.post(`/patients/${s.patient.id}/alerts`, { type: 'ALLERGY', severity: 'CRITICAL', title: 'Testamox allergy', substance: 'testamox' });
    const blocked = await ward.client.post(`/treatment-tasks/${tasks[2].id}/complete`, { status: 'DONE' });
    expect(blocked.body.error.code).toBe('SAFETY_OVERRIDE_REQUIRED');
    expect((await prisma().treatmentTask.findUniqueOrThrow({ where: { id: tasks[2].id } })).status).toBe('DUE');

    const prn = await s.vet.client.post(`/admissions/${a.body.id}/orders`, { kind: 'NURSING', schedule: 'AS_NEEDED', description: 'Walk outside' });
    expect((await ward.client.post(`/treatment-orders/${prn.body.id}/give`, { status: 'DONE', value: 'Urinated' })).body).toMatchObject({ status: 'DONE', value: 'Urinated' });
    await s.vet.client.post(`/treatment-orders/${order.body.id}/stop`, { reason: 'Course changed' });
    const future = await prisma().treatmentTask.findMany({ where: { orderId: order.body.id, dueAt: { gt: new Date() } } });
    expect(future.filter((t) => t.status === 'DUE')).toHaveLength(0); // recorded ones (the skipped dose) are kept
    expect(future.filter((t) => t.status === 'CANCELLED').length).toBeGreaterThan(0);
  });

  it('records observations against the stay and escalates critical patients to the responsible vet', async () => {
    const s = await setup();
    const a = await admit(s);
    expect((await s.vet.client.post(`/admissions/${a.body.id}/vitals`, { temperatureC: 39.4, heartRate: 120 })).status).toBe(201);
    const v = (await s.vet.client.get(`/admissions/${a.body.id}/vitals`)).body.vitals;
    expect(v).toHaveLength(1);
    await s.vet.client.patch(`/admissions/${a.body.id}`, { condition: 'CRITICAL' });
    const alert = await prisma().task.findFirstOrThrow({ where: { patientId: s.patient.id, type: 'HOSPITAL_ALERT' } });
    expect(alert).toMatchObject({ assigneeId: s.vet.membershipId, status: 'OPEN' });
    await s.vet.client.post(`/admissions/${a.body.id}/escalate`, { reason: 'Breathing harder' });
    expect(await prisma().task.count({ where: { patientId: s.patient.id, type: 'HOSPITAL_ALERT' } })).toBe(2);
    const detail = (await s.vet.client.get(`/admissions/${a.body.id}`)).body;
    expect(detail.notes.map((n: any) => n.type)).toEqual(expect.arrayContaining(['ALERT', 'PROGRESS']));
    expect((await s.vet.client.get(`/patients/${s.patient.id}/hospital-status`)).body.admission).toMatchObject({ condition: 'CRITICAL', cage: 'K1' });
  });

  it('discharges with a summary, frees the cage, records death and locks the stay', async () => {
    const s = await setup();
    const a = await admit(s);
    await s.vet.client.post(`/admissions/${a.body.id}/orders`, { kind: 'FEEDING', schedule: 'INTERVAL', intervalHours: 6, description: 'Recovery diet' });
    expect((await s.vet.client.post(`/admissions/${a.body.id}/discharge`, { outcome: 'DISCHARGED_HOME' })).status).toBe(400);
    const d = await s.vet.client.post(`/admissions/${a.body.id}/discharge`, { outcome: 'EUTHANASED', dischargeSummary: 'Humane euthanasia at owner request after poor response to treatment.' });
    expect(d.body).toMatchObject({ status: 'DISCHARGED', outcome: 'EUTHANASED' });
    expect((await prisma().patient.findUniqueOrThrow({ where: { id: s.patient.id } })).status).toBe('DECEASED');
    expect(await prisma().treatmentTask.count({ where: { admissionId: a.body.id, status: 'DUE' } })).toBe(0);
    await expect(prisma().admission.update({ where: { id: a.body.id }, data: { dischargeSummary: 'changed' } })).rejects.toThrow(/cannot be changed/);
    const p2 = await makePatient(s.org.owner, s.client.id);
    expect((await admit(s, { patientId: p2.id })).status).toBe(201); // K1 is free again
    expect((await s.vet.client.post(`/admissions/${a.body.id}/notes`, { text: 'late' })).status).toBe(422);
  });

  it('cancels an admission made in error and waives its day charge, unless treatments were recorded', async () => {
    const s = await setup();
    const a = await admit(s);
    const c = await s.vet.client.post(`/admissions/${a.body.id}/cancel`, { reason: 'Wrong patient selected' });
    expect(c.body.status).toBe('CANCELLED');
    expect((await prisma().charge.findFirstOrThrow({ where: { sourceType: 'HospitalDay', patientId: s.patient.id } })).status).toBe('WAIVED');
    const b = await admit(s);
    const o = await s.vet.client.post(`/admissions/${b.body.id}/orders`, { kind: 'NURSING', schedule: 'AS_NEEDED', description: 'Clean bedding' });
    await s.vet.client.post(`/treatment-orders/${o.body.id}/give`, { status: 'DONE' });
    expect((await s.vet.client.post(`/admissions/${b.body.id}/cancel`, { reason: 'x' })).body.error.code).toBe('HAS_TREATMENTS');
  });
});
