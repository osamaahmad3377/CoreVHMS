import { closeApp, makeClient, makePatient, prisma, registerOrg, staff } from './helpers';

/** Permanent delete of records added by mistake — only while they have no history; otherwise archive / switch off. */
describe('Deleting records added by mistake', () => {
  afterAll(closeApp);

  it('deletes an animal with no history, with its owner link, microchip, weight and alerts, and records who did it', async () => {
    const org = await registerOrg();
    const c = await makeClient(org.owner);
    const p = await makePatient(org.owner, c.id, { name: 'Mistake' });
    expect((await org.owner.post(`/patients/${p.id}/weights`, { weightKg: 12.5 })).status).toBe(201);
    expect((await org.owner.post(`/patients/${p.id}/alerts`, { type: 'BEHAVIOUR', severity: 'INFO', title: 'Shy' })).status).toBe(201);

    expect((await org.owner.get(`/patients/${p.id}/deletion-check`)).body).toMatchObject({ canDelete: true, usedBy: [] });
    expect((await org.owner.del(`/patients/${p.id}`)).status).toBe(200);
    expect((await org.owner.get(`/patients/${p.id}`)).status).toBe(404);
    const db = prisma();
    expect(await db.patientOwnership.count({ where: { patientId: p.id } })).toBe(0);
    expect(await db.weightRecord.count({ where: { patientId: p.id } })).toBe(0);
    // The owner stays.
    expect((await org.owner.get(`/clients/${c.id}`)).status).toBe(200);
    const audit = await db.auditEvent.findFirstOrThrow({ where: { organizationId: org.orgId, action: 'patient.deleted', entityId: p.id } });
    expect(audit.summary).toContain('Mistake');
  });

  it('refuses to delete an animal with history, says what it has and suggests archiving', async () => {
    const org = await registerOrg();
    const c = await makeClient(org.owner);
    const p = await makePatient(org.owner, c.id, { name: 'Bella' });
    const vet = await staff(org, 'veterinarian', { isClinician: true });
    expect((await vet.client.post('/encounters', { patientId: p.id, chiefComplaint: 'Check' })).status).toBe(201);

    const check = (await org.owner.get(`/patients/${p.id}/deletion-check`)).body;
    expect(check).toMatchObject({ canDelete: false, usedBy: ['1 visit'] });
    expect(check.instead).toMatch(/Archive/);
    const res = await org.owner.del(`/patients/${p.id}`);
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: 'IN_USE', details: { usedBy: ['1 visit'] } });
    expect(res.body.error.message).toMatch(/^Bella can’t be deleted: it is linked to 1 visit\. Archive/);
    expect((await org.owner.get(`/patients/${p.id}`)).status).toBe(200);
  });

  it('deletes a client together with their animals when none of it has history', async () => {
    const org = await registerOrg();
    const c = await makeClient(org.owner, { firstName: 'Wrong', lastName: 'Entry' });
    const a = await makePatient(org.owner, c.id, { name: 'Alpha' });
    const b = await makePatient(org.owner, c.id, { name: 'Beta' });
    expect((await org.owner.post(`/clients/${c.id}/contacts`, { role: 'EMERGENCY', name: 'Neighbour', phone: '0300 1112223' })).status).toBe(201);

    expect((await org.owner.get(`/clients/${c.id}/deletion-check`)).body).toMatchObject({ canDelete: true, animals: ['Alpha', 'Beta'] });
    expect((await org.owner.del(`/clients/${c.id}`)).body).toEqual({ ok: true, animalsDeleted: 2 });
    for (const id of [a.id, b.id]) expect((await org.owner.get(`/patients/${id}`)).status).toBe(404);
    expect((await org.owner.get(`/clients/${c.id}`)).status).toBe(404);
    const actions = (await prisma().auditEvent.findMany({ where: { organizationId: org.orgId, action: { in: ['client.deleted', 'patient.deleted'] } } })).map((x) => x.action).sort();
    expect(actions).toEqual(['client.deleted', 'patient.deleted', 'patient.deleted']);
  });

  it('keeps a client whose animal has history, naming the animal', async () => {
    const org = await registerOrg();
    const c = await makeClient(org.owner);
    const p = await makePatient(org.owner, c.id, { name: 'Coco' });
    const vet = await staff(org, 'veterinarian', { isClinician: true });
    await vet.client.post('/encounters', { patientId: p.id, chiefComplaint: 'Limp' });
    const check = (await org.owner.get(`/clients/${c.id}/deletion-check`)).body;
    expect(check.canDelete).toBe(false);
    expect(check.usedBy).toContain('Coco’s history (1 visit)');
    expect((await org.owner.del(`/clients/${c.id}`)).status).toBe(422);
    expect((await org.owner.get(`/patients/${p.id}`)).status).toBe(200);
  });

  it('lets owners and practice managers delete clients and animals, not reception', async () => {
    const org = await registerOrg();
    const reception = await staff(org, 'receptionist');
    const manager = await staff(org, 'practice_manager');
    const c = await makeClient(org.owner);
    const p = await makePatient(org.owner, c.id);
    expect((await reception.client.get(`/patients/${p.id}/deletion-check`)).status).toBe(403);
    expect((await reception.client.del(`/patients/${p.id}`)).status).toBe(403);
    expect((await reception.client.del(`/clients/${c.id}`)).status).toBe(403);
    expect((await manager.client.del(`/patients/${p.id}`)).status).toBe(200);
    expect((await manager.client.del(`/clients/${c.id}`)).status).toBe(200);
  });

  it('deletes unused set-up items and refuses ones in use, naming what uses them', async () => {
    const org = await registerOrg();
    const db = prisma();
    const svc = (code: string) => db.service.findFirstOrThrow({ where: { organizationId: org.orgId, code } });

    // A service an appointment type charges can't go; once the type is deleted, it can.
    const nails = await svc('GROOM-NAILS');
    expect((await org.owner.get(`/services/${nails.id}/deletion-check`)).body).toMatchObject({ canDelete: false, usedBy: ['1 appointment type'] });
    const type = await db.appointmentType.findFirstOrThrow({ where: { organizationId: org.orgId, name: 'Nail trim' } });
    expect((await org.owner.del(`/appointment-types/${type.id}`)).status).toBe(200);
    expect((await org.owner.del(`/services/${nails.id}`)).status).toBe(200);
    // The home-visit fee is set up in Settings → Home visits.
    const callout = await svc('HV-CALLOUT');
    expect((await org.owner.get(`/services/${callout.id}/deletion-check`)).body.usedBy).toEqual(['the home-visit fees (Settings → Home visits)']);
    expect((await org.owner.del(`/services/${(await svc('CERT')).id}`)).status).toBe(200);

    // Lab test, room, kennel, ward (with its cages) and a single cage.
    const test = await db.labTest.findFirstOrThrow({ where: { organizationId: org.orgId, code: 'GLU' } });
    expect((await org.owner.del(`/lab-tests/${test.id}`)).status).toBe(200);
    const room = await db.resource.findFirstOrThrow({ where: { organizationId: org.orgId, name: 'Ultrasound scanner' } });
    expect((await org.owner.del(`/resources/${room.id}`)).status).toBe(200);
    const kennel = await db.boardingUnit.findFirstOrThrow({ where: { organizationId: org.orgId, name: 'Kennel 4' } });
    expect((await org.owner.del(`/boarding/units/${kennel.id}`)).status).toBe(200);
    const isolation = await db.ward.findFirstOrThrow({ where: { organizationId: org.orgId, name: 'Isolation' } });
    expect((await org.owner.del(`/wards/${isolation.id}`)).status).toBe(200);
    expect(await db.cage.count({ where: { wardId: isolation.id } })).toBe(0);
    const cage = await db.cage.findFirstOrThrow({ where: { organizationId: org.orgId, ward: { name: 'General ward' } } });
    expect((await org.owner.del(`/cages/${cage.id}`)).status).toBe(200);

    const kinds = (await db.auditEvent.findMany({ where: { organizationId: org.orgId, action: { endsWith: '.deleted' } } })).map((a) => a.action).sort();
    expect(kinds).toEqual(['appointment_type.deleted', 'boarding_unit.deleted', 'cage.deleted', 'lab_test.deleted', 'resource.deleted', 'service.deleted', 'service.deleted', 'ward.deleted']);
  });

  it('deletes products, suppliers and store rooms until stock has gone through them', async () => {
    const org = await registerOrg();
    const db = prisma();
    const product = (await org.owner.post('/products', { name: 'Typo tablets', type: 'MEDICINE', dispensingUnit: 'tablet', strengthValue: 10, strengthUnit: 'mg', sellPriceMinor: 100 })).body;
    const used = (await org.owner.post('/products', { name: 'Kibble 2 kg', type: 'FOOD', dispensingUnit: 'bag', sellPriceMinor: 100000 })).body;
    const main = await db.stockLocation.findFirstOrThrow({ where: { branchId: org.branchId, isDefault: true } });
    const pharmacy = await db.stockLocation.findFirstOrThrow({ where: { branchId: org.branchId, name: 'Pharmacy' } });
    const local = await db.supplier.findFirstOrThrow({ where: { organizationId: org.orgId, name: 'Local Purchase' } });
    expect((await org.owner.post('/stock/receipts', { supplierId: local.id, locationId: pharmacy.id, lines: [{ productId: used.id, batchNumber: 'K1', quantity: 5, unitCostMinor: 50000 }] })).status).toBe(201);

    expect((await org.owner.del(`/products/${product.id}`)).status).toBe(200);
    const productCheck = (await org.owner.get(`/products/${used.id}/deletion-check`)).body;
    expect(productCheck).toMatchObject({ canDelete: false });
    expect(productCheck.usedBy).toEqual(expect.arrayContaining(['1 stock batch', '1 stock movement']));
    expect((await org.owner.del(`/products/${used.id}`)).status).toBe(422);
    expect((await org.owner.get(`/suppliers/${local.id}/deletion-check`)).body.usedBy).toEqual(expect.arrayContaining(['1 goods received note', '1 stock batch']));
    expect((await org.owner.del(`/stock-locations/${pharmacy.id}`)).status).toBe(422);

    // The empty default store can go; the remaining one becomes the default.
    expect((await org.owner.del(`/stock-locations/${main.id}`)).status).toBe(200);
    expect((await db.stockLocation.findUniqueOrThrow({ where: { id: pharmacy.id } })).isDefault).toBe(true);
    const spare = (await org.owner.post('/suppliers', { name: 'Typo supplier' })).body;
    expect((await org.owner.del(`/suppliers/${spare.id}`)).status).toBe(200);
  });
});
