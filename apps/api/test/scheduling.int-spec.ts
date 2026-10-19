import { booking, closeApp, futureDate, karachi, makeClient, makePatient, registerOrg, schedulingFixture, staff } from './helpers';

describe('Scheduling', () => {
  afterAll(closeApp);

  it('books inside rostered hours and rejects bookings outside them unless explicitly overridden', async () => {
    const org = await registerOrg();
    const f = await schedulingFixture(org);
    const d = futureDate(5);
    const ok = await org.owner.post('/appointments', booking(org, f, karachi(d, '10:00')));
    expect(ok.status).toBe(201);
    expect(ok.body.appointmentNo).toMatch(/^A-\d{6}$/);
    expect(new Date(ok.body.endsAt).getTime() - new Date(ok.body.startsAt).getTime()).toBe(20 * 60_000);

    const late = await org.owner.post('/appointments', booking(org, f, karachi(d, '16:50')));
    expect(late.status).toBe(422);
    expect(late.body.error.code).toBe('OUTSIDE_WORKING_HOURS');
    expect((await org.owner.post('/appointments', booking(org, f, karachi(d, '16:50'), { allowOutsideHours: true }))).status).toBe(201);
  });

  it('prevents double-booking a clinician, allows explicit overbooking, and frees the slot on cancellation', async () => {
    const org = await registerOrg();
    const f = await schedulingFixture(org);
    const d = futureDate(6);
    const a = await org.owner.post('/appointments', booking(org, f, karachi(d, '11:00')));
    const clash = await org.owner.post('/appointments', booking(org, f, karachi(d, '11:10')));
    expect(clash.status).toBe(409);
    expect(clash.body.error.details.code).toBe('CLINICIAN_BUSY');
    // Same animal → worded as a duplicate booking.
    expect(clash.body.error.details.samePatient).toBe(true);
    expect(clash.body.error.message).toBe(`${f.patient.name} is already booked at this time (${a.body.appointmentNo} with Test veterinarian)`);
    expect((await org.owner.post('/appointments', booking(org, f, karachi(d, '11:10'), { allowOverbook: true }))).status).toBe(201);
    // back-to-back is fine (half-open intervals)
    expect((await org.owner.post('/appointments', booking(org, f, karachi(d, '11:20')))).status).toBe(201);

    expect((await org.owner.post(`/appointments/${a.body.id}/status`, { action: 'cancel' })).status).toBe(422);
    expect((await org.owner.post(`/appointments/${a.body.id}/status`, { action: 'cancel', reason: 'Owner unwell' })).status).toBe(200);
    expect((await org.owner.post('/appointments', booking(org, f, karachi(d, '11:00')))).status).toBe(201);
  });

  it('the database rejects concurrent double-bookings (exclusion constraint)', async () => {
    const org = await registerOrg();
    const f = await schedulingFixture(org);
    const d = futureDate(8);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => org.owner.post('/appointments', booking(org, f, karachi(d, '13:00')))),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(4);
  });

  it('blocks bookings during clinician leave and rooms that are already booked', async () => {
    const org = await registerOrg();
    const f = await schedulingFixture(org);
    const d = futureDate(9);
    const leave = await org.owner.post('/schedules/leave', { membershipId: f.vet.membershipId, type: 'TRAINING', startsAt: karachi(d, '09:00'), endsAt: karachi(d, '12:00') });
    expect(leave.status).toBe(201);
    const r = await org.owner.post('/appointments', booking(org, f, karachi(d, '10:00')));
    expect(r.body.error.code).toBe('CLINICIAN_ON_LEAVE');

    const room = await org.owner.post('/resources', { branchId: org.branchId, name: 'Consult 1', type: 'ROOM' });
    const vet2 = await staff(org, 'veterinarian', { isClinician: true });
    await org.owner.call('put', `/schedules/working-hours/${vet2.membershipId}`, { branchId: org.branchId, slots: [0, 1, 2, 3, 4, 5, 6].map((x) => ({ dayOfWeek: x, startMinute: 540, endMinute: 1020 })) });
    expect((await org.owner.post('/appointments', booking(org, f, karachi(d, '14:00'), { resourceIds: [room.body.id] }))).status).toBe(201);
    const roomClash = await org.owner.post('/appointments', booking(org, f, karachi(d, '14:05'), { clinicianId: vet2.membershipId, resourceIds: [room.body.id] }));
    expect(roomClash.status).toBe(409);
    expect(roomClash.body.error.details.code).toBe('RESOURCE_BUSY');
  });

  it('validates that the patient belongs to the client and the clinician works at the branch', async () => {
    const org = await registerOrg();
    const f = await schedulingFixture(org);
    const stranger = await makeClient(org.owner);
    const res = await org.owner.post('/appointments', booking(org, f, karachi(futureDate(5), '10:00'), { clientId: stranger.id }));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PATIENT_NOT_OWNED');
    const nurse = await staff(org, 'nurse');
    const res2 = await org.owner.post('/appointments', booking(org, f, karachi(futureDate(5), '10:00'), { clinicianId: nurse.membershipId }));
    expect(res2.body.error.code).toBe('INVALID_CLINICIAN');
  });

  it('reschedules with conflict checks and resets confirmation when the time changes', async () => {
    const org = await registerOrg();
    const f = await schedulingFixture(org);
    const d = futureDate(10);
    const a = await org.owner.post('/appointments', booking(org, f, karachi(d, '09:00')));
    const b = await org.owner.post('/appointments', booking(org, f, karachi(d, '10:00')));
    await org.owner.post(`/appointments/${a.body.id}/status`, { action: 'confirm' });
    expect((await org.owner.patch(`/appointments/${a.body.id}`, { startsAt: karachi(d, '10:10') })).status).toBe(409);
    const moved = await org.owner.patch(`/appointments/${a.body.id}`, { startsAt: karachi(d, '12:00') });
    expect(moved.status).toBe(200);
    expect(moved.body.status).toBe('BOOKED');
    expect(b.status).toBe(201);
  });

  it('runs the visit workflow: check-in → start (creates encounter) → complete', async () => {
    const org = await registerOrg();
    const f = await schedulingFixture(org);
    const a = await org.owner.post('/appointments', booking(org, f, karachi(futureDate(4), '15:00')));
    expect((await org.owner.post(`/appointments/${a.body.id}/status`, { action: 'complete' })).status).toBe(422);
    expect((await org.owner.post(`/appointments/${a.body.id}/status`, { action: 'no-show' })).body.error.code).toBe('NOT_YET_DUE');
    expect((await org.owner.post(`/appointments/${a.body.id}/status`, { action: 'check-in' })).body.status).toBe('CHECKED_IN');
    const started = await f.vet.client.post(`/appointments/${a.body.id}/status`, { action: 'start' });
    expect(started.status).toBe(200);
    expect(started.body.status).toBe('IN_CONSULTATION');
    expect(started.body.encounterId).toBeTruthy();
    const done = await f.vet.client.post(`/appointments/${a.body.id}/status`, { action: 'complete' });
    expect(done.body.status).toBe('COMPLETED');
    const enc = await f.vet.client.get(`/encounters/${started.body.encounterId}`);
    expect(enc.body.status).toBe('COMPLETED');
  });

  it('enforces workflow permissions server-side', async () => {
    const org = await registerOrg();
    const f = await schedulingFixture(org);
    const reception = await staff(org, 'receptionist');
    const lab = await staff(org, 'lab_technician');
    expect((await lab.client.post('/appointments', booking(org, f, karachi(futureDate(5), '10:00')))).status).toBe(403);
    const a = await reception.client.post('/appointments', booking(org, f, karachi(futureDate(5), '10:00')));
    expect(a.status).toBe(201);
    await reception.client.post(`/appointments/${a.body.id}/status`, { action: 'check-in' });
    expect((await reception.client.post(`/appointments/${a.body.id}/status`, { action: 'start' })).status).toBe(403);
    expect((await reception.client.post('/appointment-types', { name: 'X', durationMinutes: 10 })).status).toBe(403);
  });

  it('books recurring series all-or-nothing and reports conflicting occurrences', async () => {
    const org = await registerOrg();
    const f = await schedulingFixture(org);
    const d = futureDate(3);
    const blocker = new Date(new Date(karachi(d, '09:30')).getTime() + 14 * 86400_000).toISOString();
    await org.owner.post('/appointments', booking(org, f, blocker));
    const series = await org.owner.post('/appointments', booking(org, f, karachi(d, '09:30'), { repeat: { everyWeeks: 1, occurrences: 4 } }));
    expect(series.status).toBe(409);
    expect(series.body.error.details.problems).toHaveLength(1);
    const ok = await org.owner.post('/appointments', booking(org, f, karachi(d, '11:30'), { repeat: { everyWeeks: 1, occurrences: 4 } }));
    expect(ok.status).toBe(201);
    expect(ok.body.series).toHaveLength(4);
    expect(new Set(ok.body.series.map((s: any) => s.recurrenceGroupId)).size).toBe(1);
  });

  it('computes availability excluding booked time and leave', async () => {
    const org = await registerOrg();
    const f = await schedulingFixture(org);
    const d = futureDate(11);
    await org.owner.post('/appointments', booking(org, f, karachi(d, '09:00')));
    await org.owner.post('/schedules/leave', { membershipId: f.vet.membershipId, startsAt: karachi(d, '13:00'), endsAt: karachi(d, '17:00') });
    const res = await org.owner.get(`/appointments/availability?branchId=${org.branchId}&date=${d}&appointmentTypeId=${f.typeId}`);
    const mine = res.body.find((c: any) => c.clinicianId === f.vet.membershipId);
    expect(mine.slots).not.toContain(karachi(d, '09:00'));
    expect(mine.slots).not.toContain(karachi(d, '09:15'));
    expect(mine.slots).toContain(karachi(d, '09:30'));
    expect(mine.slots).toContain(karachi(d, '12:30'));
    expect(mine.slots).not.toContain(karachi(d, '12:45'));
    expect(mine.slots).not.toContain(karachi(d, '14:00'));
  });

  it('puts walk-ins in the queue and orders waiting patients by staff-assigned triage priority', async () => {
    const org = await registerOrg();
    const f = await schedulingFixture(org);
    const other = await makePatient(org.owner, f.client.id, { name: 'Second' });
    const w1 = await org.owner.post('/front-desk/walk-in', { branchId: org.branchId, clientId: f.client.id, patientId: f.patient.id, appointmentTypeId: f.typeId, reason: 'Limping' });
    expect(w1.status).toBe(201);
    expect(w1.body.status).toBe('CHECKED_IN');
    const w2 = await org.owner.post('/front-desk/walk-in', { branchId: org.branchId, clientId: f.client.id, patientId: other.id, appointmentTypeId: f.typeId });
    const t = await org.owner.post('/triage', { patientId: other.id, appointmentId: w2.body.id, priority: 'EMERGENT', presentingComplaint: 'Collapsed', heartRate: 190 });
    expect(t.status).toBe(201);
    const q = await org.owner.get(`/front-desk/queue?branchId=${org.branchId}`);
    expect(q.body.waiting.map((x: any) => x.id)).toEqual([w2.body.id, w1.body.id]);
    expect(q.body.waiting[0].effectivePriority).toBe('EMERGENT');
  });

  it('marks finished visits whose client still has work not yet invoiced, for the front desk Bill button', async () => {
    const org = await registerOrg();
    const f = await schedulingFixture(org);
    const types = (await org.owner.get('/appointment-types')).body as any[];
    const consult = types.find((t) => t.name === 'Consultation' && t.serviceId);
    // Starter prices are 0 (not charged) until the clinic sets them.
    const svc = ((await org.owner.get('/services')).body as any[]).find((x) => x.id === consult.serviceId);
    expect((await org.owner.patch(`/services/${svc.id}`, { code: svc.code, name: svc.name, category: svc.category, priceMinor: 250000 })).status).toBe(200);
    const w = await org.owner.post('/front-desk/walk-in', { branchId: org.branchId, clientId: f.client.id, patientId: f.patient.id, appointmentTypeId: consult.id, clinicianId: f.vet.membershipId });
    const started = await f.vet.client.post(`/appointments/${w.body.id}/status`, { action: 'start' });
    expect((await f.vet.client.post(`/encounters/${started.body.encounterId}/complete`)).status).toBe(200);
    const done = (await org.owner.get(`/front-desk/queue?branchId=${org.branchId}`)).body.done.find((x: any) => x.id === w.body.id);
    expect(done.status).toBe('COMPLETED');
    expect(done.unbilledCharges).toBe(1);

    const charges = (await org.owner.get(`/charges?clientId=${f.client.id}&status=PENDING`)).body;
    const inv = await org.owner.post('/invoices', { clientId: f.client.id, chargeIds: (charges.data ?? charges).map((c: any) => c.id), lines: [], issue: true });
    expect(inv.status).toBe(201);
    const after = (await org.owner.get(`/front-desk/queue?branchId=${org.branchId}`)).body.done.find((x: any) => x.id === w.body.id);
    expect(after.unbilledCharges).toBe(0);
  });

  it('starting a walk-in assigns the starting clinician and seeds the consultation from triage', async () => {
    const org = await registerOrg();
    const f = await schedulingFixture(org);
    // The vet already has a booking now, so taking the walk-in must not trip the no-overlap constraint.
    const now = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
    expect((await org.owner.post('/appointments', booking(org, f, now, { allowOutsideHours: true }))).status).toBe(201);
    const w = await org.owner.post('/front-desk/walk-in', { branchId: org.branchId, clientId: f.client.id, patientId: f.patient.id, appointmentTypeId: f.typeId, reason: 'Vomiting' });
    expect(w.body.clinician).toBeNull();
    await org.owner.post('/triage', { patientId: f.patient.id, appointmentId: w.body.id, priority: 'URGENT', presentingComplaint: 'Vomiting since last night', temperatureC: 39.6, heartRate: 140, painScore: 3 });
    const started = await f.vet.client.post(`/appointments/${w.body.id}/status`, { action: 'start' });
    expect(started.status).toBe(200);
    expect(started.body.clinician?.id).toBe(f.vet.membershipId);
    const enc = await f.vet.client.get(`/encounters/${started.body.encounterId}`);
    expect(enc.body.clinician?.id).toBe(f.vet.membershipId);
    expect(enc.body.chiefComplaint).toBe('Vomiting since last night');
    expect(enc.body.vitals).toHaveLength(1);
    expect(Number(enc.body.vitals[0].temperatureC)).toBe(39.6);
    expect(enc.body.vitals[0].heartRate).toBe(140);
    expect(enc.body.vitals[0].painScore).toBe(3);

    // Without triage the walk-in reason becomes the chief complaint and no vitals are invented.
    const other = await makePatient(org.owner, f.client.id, { name: 'Third' });
    const w2 = await org.owner.post('/front-desk/walk-in', { branchId: org.branchId, clientId: f.client.id, patientId: other.id, appointmentTypeId: f.typeId, reason: 'Ear scratching' });
    const s2 = await f.vet.client.post(`/appointments/${w2.body.id}/status`, { action: 'start' });
    const enc2 = await f.vet.client.get(`/encounters/${s2.body.encounterId}`);
    expect(enc2.body.chiefComplaint).toBe('Ear scratching');
    expect(enc2.body.vitals).toHaveLength(0);

    // An unassigned regular booking overlapping the vet's own booking is flagged as overbooked rather than failing.
    const open = await org.owner.post('/appointment-types', { name: 'Nurse clinic', durationMinutes: 20, requiresClinician: false });
    const b = await org.owner.post('/appointments', booking(org, f, now, { appointmentTypeId: open.body.id, clinicianId: null, patientId: other.id }));
    expect(b.status).toBe(201);
    const s3 = await f.vet.client.post(`/appointments/${b.body.id}/status`, { action: 'start' });
    expect(s3.status).toBe(200);
    expect(s3.body.clinician?.id).toBe(f.vet.membershipId);
    expect(s3.body.isOverbooked).toBe(true);
  });

  it('isolates appointments between organizations', async () => {
    const a = await registerOrg();
    const b = await registerOrg();
    const f = await schedulingFixture(a);
    const appt = await a.owner.post('/appointments', booking(a, f, karachi(futureDate(5), '10:00')));
    expect((await b.owner.get(`/appointments/${appt.body.id}`)).status).toBe(404);
    expect((await b.owner.post(`/appointments/${appt.body.id}/status`, { action: 'cancel', reason: 'x' })).status).toBe(404);
    const bType = await b.owner.post('/appointment-types', { name: 'B', durationMinutes: 10 });
    const res = await b.owner.post('/appointments', { ...booking(a, f, karachi(futureDate(5), '10:00')), appointmentTypeId: bType.body.id });
    expect(res.status).toBe(422);
  });
});
