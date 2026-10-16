import { closeApp, futureDate, inDays, karachi, makeClient, makePatient, mail, prisma, registerOrg, schedulingFixture, staff, unique } from './helpers';
import { MessagesService } from '../src/modules/comms/messages.service';
import { getApp } from './helpers';

// All prices are arbitrary test values.
async function boardingFixture() {
  const org = await registerOrg();
  const nightly = (await org.owner.post('/services', { code: unique('BRD').slice(0, 20), name: 'Boarding (per night)', category: 'BOARDING', priceMinor: 150000 })).body;
  const k1 = (await org.owner.post('/boarding/units', { branchId: org.branchId, name: 'Kennel 1', type: 'KENNEL', nightlyServiceId: nightly.id })).body;
  const k2 = (await org.owner.post('/boarding/units', { branchId: org.branchId, name: 'Kennel 2', type: 'KENNEL', nightlyServiceId: nightly.id })).body;
  const client = await makeClient(org.owner);
  const dog = await makePatient(org.owner, client.id, { name: 'Sheru' });
  const dog2 = await makePatient(org.owner, client.id, { name: 'Moti' });
  return { org, nightly, k1, k2, client, dog, dog2 };
}

describe('Boarding, grooming, insurance and referrals', () => {
  afterAll(closeApp);

  it('books kennels without double-booking, checks vaccinations at check-in and bills the nights stayed', async () => {
    const { org, k1, k2, client, dog, dog2 } = await boardingFixture();
    const rec = await staff(org, 'receptionist');
    const r = await rec.client.post('/boarding/stays', { patientId: dog.id, unitId: k1.id, startDate: inDays(-2), endDate: inDays(3), feedingInstructions: 'Own food, twice daily' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: 'RESERVED', nights: 5, nightlyRateMinor: 150000 });
    // Same kennel, overlapping dates: refused. Departure day = next arrival day is fine.
    const clash = await rec.client.post('/boarding/stays', { patientId: dog2.id, unitId: k1.id, startDate: inDays(1), endDate: inDays(4) });
    expect(clash.status).toBe(409);
    expect(clash.body.error.message).toContain('Sheru');
    expect((await rec.client.post('/boarding/stays', { patientId: dog2.id, unitId: k1.id, startDate: inDays(3), endDate: inDays(5) })).status).toBe(201);
    // The same animal cannot be booked twice for overlapping dates.
    expect((await rec.client.post('/boarding/stays', { patientId: dog.id, unitId: k2.id, startDate: inDays(0), endDate: inDays(2) })).status).toBe(409);
    expect((await rec.client.post('/boarding/stays', { patientId: dog.id, startDate: inDays(2), endDate: inDays(2) })).body.error.code).toBe('VALIDATION_ERROR');

    // Overdue vaccination: check-in needs a recorded reason.
    await org.owner.post('/care-items', { patientId: dog.id, kind: 'VACCINATION', title: 'Rabies vaccination', dueDate: inDays(-10) });
    const blocked = await rec.client.post(`/boarding/stays/${r.body.id}/check-in`, {});
    expect(blocked.body.error.code).toBe('VACCINATIONS_OVERDUE');
    const ci = await rec.client.post(`/boarding/stays/${r.body.id}/check-in`, { vaccinationOverride: 'Owner showing certificate from other clinic tomorrow' });
    expect(ci.status).toBe(200);
    expect(ci.body).toMatchObject({ status: 'CHECKED_IN', vaccinationOverride: 'Owner showing certificate from other clinic tomorrow' });
    expect((await rec.client.post(`/boarding/stays/${r.body.id}/check-in`, {})).body.error.code).toBe('NOT_RESERVED');
    expect((await rec.client.post(`/boarding/stays/${r.body.id}/logs`, { kind: 'FEEDING', text: 'Ate all breakfast' })).status).toBe(201);
    expect((await rec.client.post(`/boarding/stays/${r.body.id}/cancel`, { reason: 'x' })).body.error.code).toBe('NOT_RESERVED');
    const board = (await rec.client.get('/boarding/board')).body;
    expect(board.inHouse.map((s: any) => s.id)).toContain(r.body.id);
    expect(board.occupancy).toEqual({ units: 2, occupied: 1 });

    // Leaving early: billed for the nights actually stayed (2), at the rate fixed when booked.
    await org.owner.patch(`/services/${(await prisma().boardingUnit.findUniqueOrThrow({ where: { id: k1.id } })).nightlyServiceId}`, { priceMinor: 999999 });
    const out = await rec.client.post(`/boarding/stays/${r.body.id}/check-out`, {});
    expect(out.body).toMatchObject({ status: 'CHECKED_OUT', nightsCharged: 2 });
    const charges = (await org.owner.get(`/charges?clientId=${client.id}`)).body.data;
    expect(charges).toHaveLength(1);
    expect(charges[0]).toMatchObject({ quantity: 2, unitPriceMinor: 150000 });
    expect((await rec.client.post(`/boarding/stays/${r.body.id}/check-out`, {})).body.error.code).toBe('NOT_CHECKED_IN');
    await expect(prisma().boardingLog.updateMany({ where: { stayId: r.body.id }, data: { text: 'edited' } })).rejects.toThrow(/append-only/);
  });

  it('checks a booked grooming appointment in, bills services when ready and completes the appointment on collection', async () => {
    const org = await registerOrg();
    const f = await schedulingFixture(org);
    const type = (await org.owner.post('/appointment-types', { name: unique('Full groom'), durationMinutes: 60, category: 'GROOMING' })).body;
    const bath = (await org.owner.post('/services', { code: unique('BATH').slice(0, 20), name: 'Bath & blow-dry', category: 'GROOMING', priceMinor: 200000 })).body;
    const nails = (await org.owner.post('/services', { code: unique('NAIL').slice(0, 20), name: 'Nail trim', category: 'GROOMING', priceMinor: 50000 })).body;
    const day = futureDate(0);
    const appt = await org.owner.post('/appointments', { branchId: org.branchId, clientId: f.client.id, patientId: f.patient.id, appointmentTypeId: type.id, clinicianId: f.vet.membershipId, startsAt: karachi(day, '23:00'), allowOutsideHours: true, reason: 'Short summer cut' });
    expect(appt.status).toBe(201);
    let board = (await org.owner.get(`/grooming/board?date=${day}`)).body;
    expect(board.booked.map((b: any) => b.id)).toContain(appt.body.id);

    const job = await org.owner.post('/grooming/jobs', { appointmentId: appt.body.id, serviceIds: [] });
    expect(job.status).toBe(201);
    expect(job.body).toMatchObject({ status: 'WAITING', instructions: 'Short summer cut', groomer: { id: f.vet.membershipId } });
    expect((await org.owner.get(`/appointments/${appt.body.id}`)).body.status).toBe('CHECKED_IN');
    expect((await org.owner.post('/grooming/jobs', { appointmentId: appt.body.id })).status).toBe(409);
    board = (await org.owner.get(`/grooming/board?date=${day}`)).body;
    expect(board.booked.map((b: any) => b.id)).not.toContain(appt.body.id);

    expect((await org.owner.post(`/grooming/jobs/${job.body.id}/transition`, { action: 'ready' })).body.error.code).toBe('NO_SERVICES');
    await org.owner.post(`/grooming/jobs/${job.body.id}/services`, { serviceId: bath.id });
    await org.owner.post(`/grooming/jobs/${job.body.id}/transition`, { action: 'start' });
    const ready = await org.owner.post(`/grooming/jobs/${job.body.id}/transition`, { action: 'ready' });
    expect(ready.body.status).toBe('READY');
    // An extra added after the work is done is billed straight away.
    await org.owner.post(`/grooming/jobs/${job.body.id}/services`, { serviceId: nails.id });
    const charges = (await org.owner.get(`/charges?clientId=${f.client.id}`)).body;
    expect(charges.totalMinor).toBe(250000);
    expect((await org.owner.post(`/grooming/jobs/${job.body.id}/transition`, { action: 'cancel', reason: 'x' })).body.error.code).toBe('INVALID_TRANSITION');
    const done = await org.owner.post(`/grooming/jobs/${job.body.id}/transition`, { action: 'collected' });
    expect(done.body.status).toBe('COLLECTED');
    expect((await org.owner.get(`/appointments/${appt.body.id}`)).body.status).toBe('COMPLETED');
    expect((await org.owner.post(`/grooming/jobs/${job.body.id}/services`, { serviceId: nails.id })).body.error.code).toBe('JOB_CLOSED');
  });

  it('runs an insurance claim from invoice to insurer payment posted against the invoice', async () => {
    const org = await registerOrg();
    const client = await makeClient(org.owner);
    const pet = await makePatient(org.owner, client.id, { name: 'Bella' });
    const insurer = (await org.owner.post('/insurance/providers', { name: unique('PetCover'), claimsEmail: 'claims@petcover.test' })).body;
    expect((await org.owner.post('/insurance/providers', { name: insurer.name })).status).toBe(409);
    const policy = await org.owner.post('/insurance/policies', { providerId: insurer.id, patientId: pet.id, policyNumber: 'PC-1001', startDate: inDays(-100), endDate: inDays(265), excessMinor: 10000 });
    expect(policy.status).toBe(201);
    expect(policy.body).toMatchObject({ state: 'ACTIVE', clientId: client.id });
    expect((await org.owner.post('/insurance/policies', { providerId: insurer.id, patientId: pet.id, policyNumber: 'PC-1001', startDate: inDays(-1) })).status).toBe(409);

    // Pre-authorisation for planned surgery.
    const pa = (await org.owner.post('/insurance/pre-authorisations', { policyId: policy.body.id, procedure: 'Cruciate repair', estimateMinor: 300000 })).body;
    expect((await org.owner.post(`/insurance/pre-authorisations/${pa.id}/decision`, { decision: 'APPROVED', approvedMinor: 1 })).body.error.code).toBe('NOT_SUBMITTED');
    await org.owner.post(`/insurance/pre-authorisations/${pa.id}/submit`, {});
    expect((await org.owner.post(`/insurance/pre-authorisations/${pa.id}/decision`, { decision: 'APPROVED', approvedMinor: 400000 })).body.error.code).toBe('OVER_ESTIMATE');
    expect((await org.owner.post(`/insurance/pre-authorisations/${pa.id}/decision`, { decision: 'PARTIALLY_APPROVED', approvedMinor: 250000, insurerReference: 'PA-77' })).body.status).toBe('PARTIALLY_APPROVED');

    const inv = (await org.owner.post('/invoices', { clientId: client.id, patientId: pet.id, lines: [{ kind: 'CUSTOM', description: 'Cruciate surgery', quantity: 1, unitPriceMinor: 300000 }], issue: true })).body;
    const draft = (await org.owner.post('/invoices', { clientId: client.id, lines: [{ kind: 'CUSTOM', description: 'Draft', quantity: 1, unitPriceMinor: 100 }] })).body;
    expect((await org.owner.post('/insurance/claims', { policyId: policy.body.id, condition: 'Ruptured cruciate ligament', treatmentFrom: inDays(-3), treatmentTo: inDays(0), invoices: [{ invoiceId: draft.id }] })).body.error.code).toBe('INVOICE_NOT_ISSUED');
    expect((await org.owner.post('/insurance/claims', { policyId: policy.body.id, condition: 'x', treatmentFrom: inDays(-200), treatmentTo: inDays(0) })).body.error.code).toBe('OUTSIDE_COVER');
    const claim = await org.owner.post('/insurance/claims', { policyId: policy.body.id, condition: 'Ruptured cruciate ligament', treatmentFrom: inDays(-3), treatmentTo: inDays(0), invoices: [{ invoiceId: inv.id }] });
    expect(claim.status).toBe(201);
    expect(claim.body).toMatchObject({ status: 'DRAFT', claimedMinor: inv.totalMinor, payee: 'CLINIC' });
    expect((await org.owner.post('/insurance/claims', { policyId: policy.body.id, condition: 'dup', treatmentFrom: inDays(-3), treatmentTo: inDays(0), invoices: [{ invoiceId: inv.id }] })).status).toBe(409);

    expect((await org.owner.post(`/insurance/claims/${claim.body.id}/payment`, { amountMinor: 1 })).body.error.code).toBe('NOT_APPROVED');
    await org.owner.post(`/insurance/claims/${claim.body.id}/submit`, {});
    expect((await org.owner.patch(`/insurance/claims/${claim.body.id}`, { condition: 'changed' })).body.error.code).toBe('NOT_EDITABLE');
    // Insurer queries, clinic edits and resubmits, insurer approves part.
    await org.owner.post(`/insurance/claims/${claim.body.id}/decision`, { decision: 'QUERIED', decisionNotes: 'Please send the referral history' });
    expect((await org.owner.patch(`/insurance/claims/${claim.body.id}`, { clinicalSummary: 'Lameness 3 weeks; drawer test positive.' })).status).toBe(200);
    await org.owner.post(`/insurance/claims/${claim.body.id}/submit`, {});
    const approved = await org.owner.post(`/insurance/claims/${claim.body.id}/decision`, { decision: 'PARTIALLY_APPROVED', approvedMinor: 200000, insurerReference: 'CLM-9' });
    expect(approved.body).toMatchObject({ status: 'PARTIALLY_APPROVED', outstandingMinor: 200000 });

    expect((await org.owner.post(`/insurance/claims/${claim.body.id}/payment`, { amountMinor: 250000 })).body.error.code).toBe('OVER_APPROVED');
    const p1 = await org.owner.post(`/insurance/claims/${claim.body.id}/payment`, { amountMinor: 120000, reference: 'EFT-1' });
    expect(p1.body).toMatchObject({ paidMinor: 120000, status: 'PARTIALLY_APPROVED' });
    const p2 = await org.owner.post(`/insurance/claims/${claim.body.id}/payment`, { amountMinor: 80000 });
    expect(p2.body).toMatchObject({ paidMinor: 200000, status: 'PAID' });
    const invoice = (await org.owner.get(`/invoices/${inv.id}`)).body;
    expect(invoice.balanceMinor).toBe(inv.totalMinor - 200000);
    const pays = await prisma().payment.findMany({ where: { clientId: client.id } });
    expect(pays.map((p) => p.method)).toEqual(['INSURANCE', 'INSURANCE']);

    const form = (await org.owner.get(`/insurance/claims/${claim.body.id}/form`)).body;
    expect(form.lines).toHaveLength(1);
    expect(form.payments).toHaveLength(2);
    // Accountants can see claims but not change them.
    const acc = await staff(org, 'accountant');
    expect((await acc.client.get('/insurance/claims')).status).toBe(200);
    expect((await acc.client.post(`/insurance/claims/${claim.body.id}/submit`, {})).status).toBe(403);
  });

  it('sends an outgoing referral letter by email, tracks it to completion and records incoming referrals', async () => {
    const org = await registerOrg();
    const client = await makeClient(org.owner);
    const pet = await makePatient(org.owner, client.id, { name: 'Tiger' });
    const contact = (await org.owner.post('/referral-contacts', { name: 'Dr. Sara Ortho', practice: 'City Referral Hospital', specialty: 'Orthopaedics', email: `ortho-${Date.now()}@referral.test` })).body;
    expect((await org.owner.post('/referrals', { patientId: pet.id, reason: 'Fracture repair' })).body.error.code).toBe('VALIDATION_ERROR'); // who to refer to
    const ref = await org.owner.post('/referrals', { patientId: pet.id, contactId: contact.id, urgency: 'URGENT', reason: 'Comminuted femoral fracture for repair' });
    expect(ref.status).toBe(201);
    expect(ref.body).toMatchObject({ status: 'DRAFT', direction: 'OUTGOING' });
    expect((await org.owner.post(`/referrals/${ref.body.id}/transition`, { action: 'send' })).body.error.code).toBe('SUMMARY_REQUIRED');
    const summary = (await org.owner.get(`/referrals/draft-summary?patientId=${pet.id}`)).body;
    expect(summary).toHaveProperty('text');
    await org.owner.patch(`/referrals/${ref.body.id}`, { clinicalSummary: 'Hit by car 2 h ago. Stable. Radiographs attached.', questions: 'Surgical repair options?' });
    const sent = await org.owner.post(`/referrals/${ref.body.id}/transition`, { action: 'send', email: true });
    expect(sent.body).toMatchObject({ status: 'SENT' });
    expect((await org.owner.patch(`/referrals/${ref.body.id}`, { reason: 'changed' })).body.error.code).toBe('ALREADY_SENT');
    // Delivered through the logged outbound queue.
    await (await getApp()).get(MessagesService).dispatch();
    const msg = mail().outbox.find((m) => m.to === contact.email);
    expect(msg?.text).toContain('Comminuted femoral fracture');
    expect(msg?.text).toContain('Surgical repair options?');
    expect((await org.owner.get(`/messages?purpose=REFERRAL`)).body.data[0]).toMatchObject({ status: 'SENT', purpose: 'REFERRAL' });

    expect((await org.owner.post(`/referrals/${ref.body.id}/transition`, { action: 'complete' })).body.error.code).toBe('VALIDATION_ERROR');
    await org.owner.post(`/referrals/${ref.body.id}/transition`, { action: 'accept', appointmentAt: new Date(Date.now() + 86400_000).toISOString() });
    const done = await org.owner.post(`/referrals/${ref.body.id}/transition`, { action: 'complete', outcome: 'Plate fixation performed; recheck in 6 weeks.' });
    expect(done.body).toMatchObject({ status: 'COMPLETED', outcome: 'Plate fixation performed; recheck in 6 weeks.' });
    const letter = (await org.owner.get(`/referrals/${ref.body.id}/letter`)).body;
    expect(letter.referral.referralNo).toMatch(/^REF-/);

    const incoming = await org.owner.post('/referrals', { direction: 'INCOMING', patientId: pet.id, externalVet: 'Dr. Ali, Village Vet Clinic', reason: 'Second opinion: skin disease' });
    expect(incoming.body.status).toBe('RECEIVED');
    const timeline = (await org.owner.get(`/patients/${pet.id}/timeline`)).body;
    expect(JSON.stringify(timeline)).toContain('Referred to Dr. Sara Ortho');
  });
});
