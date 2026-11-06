import { TestClient, closeApp, getApp, makeClient, makePatient, prisma, registerOrg, staff, stockFixture } from './helpers';

const day = (n = 0) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);

async function care(orgId: string, patientId: string, data: { kind: string; title: string; productName?: string; batchNumber?: string; completed?: boolean; dueIn?: number; previousItemId?: string; givenElsewhere?: boolean; administrationId?: string }) {
  return prisma().careItem.create({
    data: {
      organizationId: orgId,
      patientId,
      kind: data.kind as never,
      title: data.title,
      productName: data.productName,
      batchNumber: data.batchNumber,
      dueDate: new Date(`${day(data.dueIn ?? 0)}T00:00:00Z`),
      status: data.completed === false ? 'DUE' : 'COMPLETED',
      completedAt: data.completed === false ? null : new Date(),
      completedByName: data.completed === false ? null : 'Dr Test',
      previousItemId: data.previousItemId,
      givenElsewhere: data.givenElsewhere ?? false,
      administrationId: data.administrationId,
    },
  });
}

describe('Pet diary', () => {
  afterAll(closeApp);

  it('is read from the records, section by section', async () => {
    const org = await registerOrg('Happy Paws Clinic');
    const vet = await staff(org, 'veterinarian', { isClinician: true });
    const client = await makeClient(org.owner, { firstName: 'Ahmed', lastName: 'Khan', email: 'ahmed@example.test' });
    const patient = await makePatient(org.owner, client.id, { name: 'Bruno', sex: 'MALE_NEUTERED', colour: 'Golden', identifiers: [{ type: 'MICROCHIP', value: '900012345678901' }] });
    await org.owner.post(`/patients/${patient.id}/weights`, { weightKg: 31.5 });
    const f = await stockFixture(org);

    // Rabies (with its next dose due), another vaccine, deworming, tick & flea — and one of them given elsewhere.
    const rabies = await care(org.orgId, patient.id, { kind: 'VACCINATION', title: 'Rabies', productName: 'Rabisin', batchNumber: 'RB-1' });
    await care(org.orgId, patient.id, { kind: 'VACCINATION', title: 'Rabies booster', previousItemId: rabies.id, completed: false, dueIn: 365 });
    await care(org.orgId, patient.id, { kind: 'VACCINATION', title: 'DHPPi', productName: 'Nobivac DHPPi', batchNumber: 'NB-7' });
    await care(org.orgId, patient.id, { kind: 'DEWORMING', title: 'Deworming', productName: 'Drontal' });
    await care(org.orgId, patient.id, { kind: 'PARASITE_PREVENTION', title: 'Flea & tick', productName: 'NexGard', givenElsewhere: true });
    await care(org.orgId, patient.id, { kind: 'HEALTH_CHECK', title: 'Annual check' });
    // Medicine: one given on its own, one that belongs to the deworming (must not repeat under treatments).
    const own = await prisma().medicationAdministration.create({ data: { organizationId: org.orgId, patientId: patient.id, productId: f.product.id, dose: 2, doseUnit: 'mL', route: 'SC', administeredById: (await prisma().user.findFirstOrThrow({ where: { email: org.email } })).id, administeredByName: 'Dr Test', batchNumber: 'M-1' } });
    expect(own.id).toBeTruthy();

    const d = (await vet.client.get(`/patients/${patient.id}/diary`)).body;
    expect(d.clinic.name).toBe('Happy Paws Clinic');
    expect(d.patient).toMatchObject({ name: 'Bruno', species: 'Dog', sex: 'Male (neutered)', colour: 'Golden', weight: '31.5 kg', desexed: true });
    expect(d.owner).toMatchObject({ name: expect.stringContaining('Ahmed'), email: 'ahmed@example.test' });
    expect(d.identifiers).toEqual([expect.objectContaining({ typeLabel: 'Microchip', value: '900012345678901' })]);
    expect(d.rabies).toEqual([expect.objectContaining({ title: 'Rabies', detail: 'Rabisin', batch: 'RB-1', validUntil: day(365) })]);
    expect(d.vaccinations.map((v: any) => v.title)).toEqual(['DHPPi']); // not rabies, not the booster that is still due
    expect(d.deworming.map((v: any) => v.title)).toEqual(['Deworming']);
    expect(d.tickFlea).toEqual([expect.objectContaining({ title: 'Flea & tick', by: 'Given elsewhere', givenElsewhere: true })]);
    expect(d.treatments).toEqual([expect.objectContaining({ detail: '2 mL, SC', batch: 'M-1' })]);

    // Procedures: a completed surgery and a signed dental chart's procedures (a draft chart or a cancelled surgery is left out).
    const user = await prisma().user.findFirstOrThrow({ where: { email: org.email } });
    const surgeryBase = { organizationId: org.orgId, branchId: org.branchId, patientId: patient.id, clientId: client.id, scheduledAt: new Date(), durationMinutes: 60, createdById: user.id, createdByName: 'Dr Test' };
    await prisma().surgery.create({ data: { ...surgeryBase, number: 1, procedure: 'Castration', status: 'COMPLETED', completedAt: new Date(), completedByName: 'Dr Surgeon' } });
    await prisma().surgery.create({ data: { ...surgeryBase, number: 2, procedure: 'Lump removal', status: 'CANCELLED' } });
    const chart = (n: number, status: 'SIGNED' | 'DRAFT') => ({ organizationId: org.orgId, number: n, branchId: org.branchId, patientId: patient.id, clientId: client.id, dentition: 'CANINE' as const, examinedAt: new Date(), status, clinicianName: 'Dr Dental', createdById: user.id, ...(status === 'SIGNED' ? { signedAt: new Date(), signedByName: 'Dr Dental', contentHash: 'x'.repeat(64), signedById: user.id } : {}) });
    const signed = await prisma().dentalChart.create({ data: chart(1, 'DRAFT') });
    const draft = await prisma().dentalChart.create({ data: chart(2, 'DRAFT') });
    await prisma().dentalProcedure.create({ data: { organizationId: org.orgId, chartId: signed.id, code: 'SP', recordedByName: 'Dr Dental' } });
    await prisma().dentalProcedure.create({ data: { organizationId: org.orgId, chartId: draft.id, code: 'XS', tooth: '104', recordedByName: 'Dr Dental' } });
    await prisma().dentalChart.update({ where: { id: signed.id }, data: { status: 'SIGNED', signedAt: new Date(), signedByName: 'Dr Dental', signedById: user.id, contentHash: 'x'.repeat(64) } });
    expect((await vet.client.get(`/patients/${patient.id}/diary`)).body.procedures.map((x: any) => x.title).sort()).toEqual(['Castration', 'Dental: Scale and polish']);

    // Only people who can see vaccinations can read it; another clinic can't see this patient.
    const other = await registerOrg();
    expect((await other.owner.get(`/patients/${patient.id}/diary`)).status).toBe(404);
    const anon = new TestClient(await getApp());
    expect((await anon.get(`/patients/${patient.id}/diary`)).status).toBe(401);
  });

  it('records rabies antibody tests: planned, completed with a result, voided — never edited', async () => {
    const org = await registerOrg();
    const vet = await staff(org, 'veterinarian', { isClinician: true });
    const desk = await staff(org, 'receptionist');
    const client = await makeClient(org.owner);
    const patient = await makePatient(org.owner, client.id);

    // Needs the right answers.
    expect((await vet.client.post(`/patients/${patient.id}/serology`, { status: 'PLANNED' })).status).toBe(400);
    expect((await vet.client.post(`/patients/${patient.id}/serology`, { status: 'COMPLETED', sampleDate: day(-3) })).status).toBe(400);
    // Reception can read but not record.
    expect((await desk.client.post(`/patients/${patient.id}/serology`, { status: 'PLANNED', plannedFor: day(30) })).status).toBe(403);

    const planned = (await vet.client.post(`/patients/${patient.id}/serology`, { status: 'PLANNED', plannedFor: day(30), notes: 'Before travel to the UK' })).body;
    expect(planned).toMatchObject({ status: 'PLANNED', plannedFor: day(30) });
    let diary = (await desk.client.get(`/patients/${patient.id}/diary`)).body;
    expect(diary.futureTests).toEqual([expect.objectContaining({ id: planned.id, notes: 'Before travel to the UK' })]);
    expect(diary.serology).toEqual([]);

    // The planned test is done: completing it moves it from "future" to the results.
    const done = (await vet.client.patch(`/serology/${planned.id}`, { status: 'COMPLETED', sampleDate: day(-1), laboratory: 'Idexx Lahore', reference: 'LAB-221', resultValue: 1.8, resultUnit: 'IU/mL', outcome: 'SATISFACTORY', validFrom: day(89), validUntil: day(400) })).body;
    expect(done).toMatchObject({ status: 'COMPLETED', resultValue: 1.8, outcome: 'SATISFACTORY', laboratory: 'Idexx Lahore' });
    diary = (await vet.client.get(`/patients/${patient.id}/diary`)).body;
    expect(diary.futureTests).toEqual([]);
    expect(diary.serology).toEqual([expect.objectContaining({ id: planned.id, validFrom: day(89), validUntil: day(400) })]);
    // A recorded result can't be changed — in the app or in the database.
    expect((await vet.client.patch(`/serology/${planned.id}`, { status: 'COMPLETED', sampleDate: day(-1), outcome: 'UNSATISFACTORY' })).body.error.code).toBe('NOT_PLANNED');
    await expect(prisma().serologyTest.update({ where: { id: planned.id }, data: { resultValue: 9 } })).rejects.toThrow(/cannot be changed/);
    await expect(prisma().serologyTest.delete({ where: { id: planned.id } })).rejects.toThrow(/permanent/);

    // Voiding needs a reason and takes it off the diary, but the record stays.
    expect((await vet.client.post(`/serology/${planned.id}/void`, { reason: '' })).status).toBe(400);
    expect((await vet.client.post(`/serology/${planned.id}/void`, { reason: 'Wrong animal' })).status).toBe(200);
    expect((await vet.client.post(`/serology/${planned.id}/void`, { reason: 'again' })).body.error.code).toBe('ALREADY_VOIDED');
    expect((await vet.client.get(`/patients/${patient.id}/diary`)).body.serology).toEqual([]);
    expect((await vet.client.get(`/patients/${patient.id}/serology`)).body[0]).toMatchObject({ status: 'VOIDED', voidedReason: 'Wrong animal' });
    const audit = await prisma().auditEvent.findMany({ where: { organizationId: org.orgId, action: { startsWith: 'serology.' } }, orderBy: { createdAt: 'asc' } });
    expect(audit.map((a) => a.action)).toEqual(['serology.planned', 'serology.recorded', 'serology.voided']);
  });

  it('follows the patient when duplicates are merged and shows on the timeline', async () => {
    const org = await registerOrg();
    const vet = await staff(org, 'veterinarian', { isClinician: true });
    const client = await makeClient(org.owner);
    const a = await makePatient(org.owner, client.id, { name: 'Dup' });
    const keep = await makePatient(org.owner, client.id, { name: 'Keeper' });
    await vet.client.post(`/patients/${a.id}/serology`, { status: 'COMPLETED', sampleDate: day(-2), outcome: 'UNSATISFACTORY', resultValue: 0.2 });
    expect((await vet.client.get(`/patients/${a.id}/timeline`)).body.events.some((e: any) => e.kind === 'serology')).toBe(true);
    expect((await org.owner.post('/patients/merge', { survivorId: keep.id, mergedId: a.id, reason: 'duplicate' })).status).toBe(200);
    expect((await vet.client.get(`/patients/${keep.id}/diary`)).body.serology).toHaveLength(1);
  });

  it('writes the consultation’s past history from the animal’s own records', async () => {
    const org = await registerOrg();
    const vet = await staff(org, 'veterinarian', { isClinician: true });
    const client = await makeClient(org.owner);
    const patient = await makePatient(org.owner, client.id, { name: 'Simba' });
    await care(org.orgId, patient.id, { kind: 'VACCINATION', title: 'Rabies', productName: 'Rabisin' });
    await care(org.orgId, patient.id, { kind: 'DEWORMING', title: 'Deworming', productName: 'Drontal' });
    await care(org.orgId, patient.id, { kind: 'VACCINATION', title: 'DHPPi', completed: false, dueIn: 30 }); // still due: not history
    await prisma().problemListItem.create({ data: { organizationId: org.orgId, patientId: patient.id, term: 'Skin allergy', isChronic: true } });

    const h = (await vet.client.get(`/patients/${patient.id}/history-summary`)).body;
    expect(h.sections.map((x: any) => x.title)).toEqual(['Vaccinations', 'Deworming', 'Long-term problems']);
    expect(h.text).toMatch(/Vaccinations: Rabies \(Rabisin\) — \d+ \w{3} \d{4}\./);
    expect(h.text).toContain('Deworming: Deworming (Drontal)');
    expect(h.text).toContain('Long-term problems: Skin allergy (chronic).');
    expect(h.text).not.toContain('DHPPi');
    // This visit's own entries are left out, but records that belong to no visit stay in.
    const visit = (await vet.client.post('/encounters', { patientId: patient.id, chiefComplaint: 'Check' })).body;
    const withVisit = (await vet.client.get(`/patients/${patient.id}/history-summary?exclude=${visit.id}`)).body;
    expect(withVisit.text).toContain('Vaccinations: Rabies');
    // Nothing recorded: nothing invented.
    const bare = await makePatient(org.owner, client.id, { name: 'Nala' });
    expect((await vet.client.get(`/patients/${bare.id}/history-summary`)).body).toEqual({ sections: [], text: '' });
    // Another clinic cannot read it; neither can someone without clinical access.
    expect((await (await registerOrg()).owner.get(`/patients/${patient.id}/history-summary`)).status).toBe(404);
  });
});
