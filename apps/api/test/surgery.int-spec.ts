import { closeApp, futureDate, karachi, prisma, registerOrg, schedulingFixture, staff, stockFixture } from './helpers';

async function setup() {
  const org = await registerOrg();
  const f = await schedulingFixture(org);
  const type = await org.owner.post('/appointment-types', { name: 'Surgery admission', category: 'SURGERY', durationMinutes: 60 });
  const theatre = await org.owner.post('/resources', { branchId: org.branchId, name: 'Theatre 1', type: 'THEATRE' });
  const svc = await org.owner.post('/services', { code: 'SPAY', name: 'Ovariohysterectomy', category: 'SURGERY', priceMinor: 40000 });
  return { org, f, typeId: type.body.id as string, theatreId: theatre.body.id as string, serviceId: svc.body.id as string };
}

const schedule = (s: Awaited<ReturnType<typeof setup>>, at: string, extra: Record<string, unknown> = {}) =>
  s.f.vet.client.post('/surgeries', { patientId: s.f.patient.id, appointmentTypeId: s.typeId, surgeonId: s.f.vet.membershipId, theatreId: s.theatreId, startsAt: at, durationMinutes: 60, procedure: 'Spay', serviceId: s.serviceId, ...extra });

describe('Surgery & anaesthesia', () => {
  afterAll(closeApp);

  it('books the theatre through the calendar and refuses double-booking the theatre', async () => {
    const s = await setup();
    const date = futureDate(3);
    const a = await schedule(s, karachi(date, '10:00'));
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ status: 'SCHEDULED', surgeryNo: expect.stringMatching(/^SURG-\d{6}$/), theatre: { name: 'Theatre 1' }, team: [{ role: 'SURGEON' }] });
    expect(a.body.checklist.length).toBeGreaterThanOrEqual(10);
    const appt = await prisma().appointment.findUniqueOrThrow({ where: { id: a.body.appointmentId } });
    expect(appt.status).toBe('BOOKED');
    const vet2 = await staff(s.org, 'veterinarian', { isClinician: true });
    await s.org.owner.call('put', `/schedules/working-hours/${vet2.membershipId}`, { branchId: s.org.branchId, slots: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startMinute: 540, endMinute: 1020 })) });
    const clash = await schedule(s, karachi(date, '10:30'), { surgeonId: vet2.membershipId });
    expect(clash.status).toBe(409);
    expect(await prisma().surgery.count({ where: { patientId: s.f.patient.id } })).toBe(1);
    const consult = await s.org.owner.post('/surgeries', { patientId: s.f.patient.id, appointmentTypeId: s.f.typeId, surgeonId: s.f.vet.membershipId, startsAt: karachi(date, '14:00'), durationMinutes: 30, procedure: 'x' });
    expect(consult.body.error.code).toBe('INVALID_TYPE');
  });

  it('enforces consent, ASA grade and the safety checklist before starting, and the sign-out before recovery', async () => {
    const s = await setup();
    const sx = (await schedule(s, karachi(futureDate(2), '11:00'))).body;
    const go = (action: string, reason?: string) => s.f.vet.client.post(`/surgeries/${sx.id}/status`, { action, reason });
    expect((await go('start')).body.error.code).toBe('CONSENT_REQUIRED');
    await s.f.vet.client.post(`/surgeries/${sx.id}/consent`, { givenBy: 'Owner (Mrs Test)' });
    expect((await go('start')).body.error.code).toBe('ASA_REQUIRED');
    await s.f.vet.client.patch(`/surgeries/${sx.id}`, { asaGrade: 'II', preOpAssessment: 'Bright, alert, healthy', fastingConfirmed: true });
    const blocked = await go('start');
    expect(blocked.body.error.code).toBe('CHECKLIST_INCOMPLETE');
    for (const item of sx.checklist.filter((i: any) => i.phase !== 'SIGN_OUT')) await s.f.vet.client.post(`/surgeries/${sx.id}/checklist`, { key: item.key, checked: true });
    const started = await go('start');
    expect(started.body).toMatchObject({ status: 'IN_PROGRESS', encounterId: expect.any(String) });
    expect((await go('recovery')).body.error.code).toBe('CHECKLIST_INCOMPLETE');
    for (const item of sx.checklist.filter((i: any) => i.phase === 'SIGN_OUT')) await s.f.vet.client.post(`/surgeries/${sx.id}/checklist`, { key: item.key, checked: true });
    expect((await go('recovery')).body.status).toBe('RECOVERY');
    expect((await go('complete')).body.error.code).toBe('NOTES_REQUIRED');
  });

  it('records anaesthesia readings, consumables (stock + charge), completes with the fee, and locks the record', async () => {
    const s = await setup();
    const stock = await stockFixture(s.org);
    const suture = await s.org.owner.post('/products', { name: 'Suture 3-0', type: 'CONSUMABLE', dispensingUnit: 'pack', minDispenseIncrement: 1, sellPriceMinor: 1500, requiresPrescription: false });
    await s.org.owner.post('/stock/receipts', { supplierId: stock.supplierId, locationId: stock.locationId, lines: [{ productId: suture.body.id, batchNumber: 'SU1', quantity: 10, unitCostMinor: 500 }] });
    const sx = (await schedule(s, karachi(futureDate(2), '12:00'), { followUpAt: undefined })).body;
    await s.f.vet.client.post(`/surgeries/${sx.id}/consent`, { givenBy: 'Owner' });
    await s.f.vet.client.patch(`/surgeries/${sx.id}`, { asaGrade: 'I', followUpAt: new Date(Date.now() + 10 * 86400_000).toISOString() });
    for (const item of sx.checklist) await s.f.vet.client.post(`/surgeries/${sx.id}/checklist`, { key: item.key, checked: true });
    await s.f.vet.client.post(`/surgeries/${sx.id}/status`, { action: 'start' });
    expect((await s.f.vet.client.post(`/surgeries/${sx.id}/readings`, {})).body.error.code).toBe('EMPTY_READING');
    const r = await s.f.vet.client.post(`/surgeries/${sx.id}/readings`, { heartRate: 96, spo2: 98, etco2: 40, agentPercent: 1.8 });
    expect(r.status).toBe(201);
    await expect(prisma().anaesthesiaReading.update({ where: { id: r.body.id }, data: { heartRate: 1 } })).rejects.toThrow(/append-only/);
    expect((await s.f.vet.client.post(`/surgeries/${sx.id}/items`, { productId: suture.body.id, quantity: 2 })).status).toBe(201);
    expect((await s.org.owner.get(`/stock/products/${suture.body.id}`)).body.batches[0].onHand).toBe(8);
    await s.f.vet.client.post(`/surgeries/${sx.id}/status`, { action: 'recovery' });
    await s.f.vet.client.post(`/surgeries/${sx.id}/readings`, { phase: 'RECOVERY', temperatureC: 37.2, painScore: 2 });
    await s.f.vet.client.patch(`/surgeries/${sx.id}`, { surgicalNotes: 'Routine midline approach, closure in three layers.', complications: 'None' });
    const done = await s.f.vet.client.post(`/surgeries/${sx.id}/status`, { action: 'complete' });
    expect(done.body.status).toBe('COMPLETED');
    const charges = await prisma().charge.findMany({ where: { patientId: s.f.patient.id }, orderBy: { sourceType: 'asc' } });
    expect(charges.map((c) => [c.sourceType, c.unitPriceMinor])).toEqual(expect.arrayContaining([['Surgery', 40000], ['SurgeryItem', 1500]]));
    expect((await prisma().appointment.findUniqueOrThrow({ where: { id: sx.appointmentId } })).status).toBe('COMPLETED');
    expect(await prisma().task.count({ where: { patientId: s.f.patient.id, type: 'RECHECK' } })).toBe(1);
    expect((await s.f.vet.client.patch(`/surgeries/${sx.id}`, { surgicalNotes: 'rewrite' })).body.error.code).toBe('LOCKED');
    await expect(prisma().surgery.update({ where: { id: sx.id }, data: { surgicalNotes: 'rewrite' } })).rejects.toThrow(/locked/);
    expect((await s.f.vet.client.post(`/surgeries/${sx.id}/addenda`, { text: 'Owner reports good recovery by phone.' })).status).toBe(201);
    const rec = await staff(s.org, 'receptionist');
    expect((await rec.client.post(`/surgeries/${sx.id}/addenda`, { text: 'x' })).status).toBe(403);
  });

  it('cancels a scheduled surgery together with its calendar booking', async () => {
    const s = await setup();
    const sx = (await schedule(s, karachi(futureDate(4), '09:00'))).body;
    expect((await s.org.owner.post(`/surgeries/${sx.id}/status`, { action: 'cancel' })).body.error.code).toBe('REASON_REQUIRED');
    expect((await s.org.owner.post(`/surgeries/${sx.id}/status`, { action: 'cancel', reason: 'Owner postponed' })).body.status).toBe('CANCELLED');
    expect((await prisma().appointment.findUniqueOrThrow({ where: { id: sx.appointmentId } })).status).toBe('CANCELLED');
    const other = await registerOrg();
    expect((await other.owner.get(`/surgeries/${sx.id}`)).status).toBe(404);
  });
});
