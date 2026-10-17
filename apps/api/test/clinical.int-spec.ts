import { closeApp, makeClient, makePatient, prisma, registerOrg, speciesId, staff } from './helpers';

const SOAP = { subjective: 'Vomiting x2 days', objective: 'T 39.6, mild dehydration', assessment: 'Acute gastritis', plan: 'Fluids, bland diet, recheck 3 days' };

async function encounterFor(org: Awaited<ReturnType<typeof registerOrg>>) {
  const vet = await staff(org, 'veterinarian', { isClinician: true });
  const client = await makeClient(org.owner);
  const patient = await makePatient(org.owner, client.id);
  const e = await vet.client.post('/encounters', { patientId: patient.id, chiefComplaint: 'Vomiting' });
  if (e.status !== 201) throw new Error(JSON.stringify(e.body));
  return { vet, client, patient, encounter: e.body };
}

describe('Clinical records', () => {
  afterAll(closeApp);

  it('drafts, signs and locks a SOAP note with a verifiable content hash', async () => {
    const org = await registerOrg();
    const { vet, encounter } = await encounterFor(org);
    expect(encounter.encounterNo).toMatch(/^E-\d{6}$/);
    const empty = await vet.client.post(`/encounters/${encounter.id}/notes`, {});
    expect((await vet.client.post(`/notes/${empty.body.id}/sign`)).body.error.code).toBe('NOTE_EMPTY');
    await vet.client.del(`/notes/${empty.body.id}`);

    const n = await vet.client.post(`/encounters/${encounter.id}/notes`, SOAP);
    expect(n.body.status).toBe('DRAFT');
    expect((await vet.client.patch(`/notes/${n.body.id}`, { plan: SOAP.plan + ', metronidazole per formulary' })).status).toBe(200);
    const signed = await vet.client.post(`/notes/${n.body.id}/sign`);
    expect(signed.body.status).toBe('SIGNED');
    expect(signed.body.contentHash).toHaveLength(64);
    expect((await vet.client.get(`/notes/${n.body.id}/verify`)).body).toEqual({ signed: true, valid: true });

    const edit = await vet.client.patch(`/notes/${n.body.id}`, { assessment: 'Changed' });
    expect(edit.status).toBe(422);
    expect(edit.body.error.code).toBe('NOTE_SIGNED');
    expect((await vet.client.del(`/notes/${n.body.id}`)).status).toBe(422);
  });

  it('the database itself refuses to alter or delete a signed note', async () => {
    const org = await registerOrg();
    const { vet, encounter } = await encounterFor(org);
    const n = await vet.client.post(`/encounters/${encounter.id}/notes`, SOAP);
    await vet.client.post(`/notes/${n.body.id}/sign`);
    await expect(prisma().clinicalNote.update({ where: { id: n.body.id }, data: { assessment: 'tampered' } })).rejects.toThrow(/immutable/);
    await expect(prisma().clinicalNote.delete({ where: { id: n.body.id } })).rejects.toThrow(/cannot be deleted/);
  });

  it('amends a signed note as a new version and supersedes the original only when the amendment is signed', async () => {
    const org = await registerOrg();
    const { vet, encounter } = await encounterFor(org);
    const v1 = await vet.client.post(`/encounters/${encounter.id}/notes`, SOAP);
    await vet.client.post(`/notes/${v1.body.id}/sign`);
    expect((await vet.client.post(`/notes/${v1.body.id}/amend`, { assessment: 'Gastroenteritis' })).status).toBe(400); // reason required
    const v2 = await vet.client.post(`/notes/${v1.body.id}/amend`, { assessment: 'Acute gastroenteritis', amendmentReason: 'Diarrhoea reported after signing' });
    expect(v2.status).toBe(201);
    expect(v2.body).toMatchObject({ version: 2, status: 'DRAFT', amendsId: v1.body.id, subjective: SOAP.subjective });
    expect((await vet.client.post(`/notes/${v1.body.id}/amend`, { amendmentReason: 'again' })).status).toBe(409);

    let e = (await vet.client.get(`/encounters/${encounter.id}`)).body;
    expect(e.notes.find((x: any) => x.id === v1.body.id).status).toBe('SIGNED');
    await vet.client.post(`/notes/${v2.body.id}/sign`);
    e = (await vet.client.get(`/encounters/${encounter.id}`)).body;
    const orig = e.notes.find((x: any) => x.id === v1.body.id);
    expect(orig.status).toBe('SUPERSEDED');
    expect(orig.assessment).toBe(SOAP.assessment);
    expect((await vet.client.get(`/notes/${v1.body.id}/verify`)).body.valid).toBe(true);
    const audit = (await org.owner.get(`/audit-events?entityId=${encounter.id}&action=note.`)).body.data.map((x: any) => x.action);
    expect(audit).toEqual(expect.arrayContaining(['note.signed', 'note.amendment_started', 'note.amendment_signed']));
  });

  it('separates drafting, signing and amending permissions', async () => {
    const org = await registerOrg();
    const { vet, encounter } = await encounterFor(org);
    const nurse = await staff(org, 'nurse');
    const reception = await staff(org, 'receptionist');
    const field = await staff(org, 'field_vet');
    const n = await nurse.client.post(`/encounters/${encounter.id}/notes`, SOAP);
    expect(n.status).toBe(201);
    expect((await nurse.client.post(`/notes/${n.body.id}/sign`)).status).toBe(403);
    expect((await reception.client.get(`/encounters/${encounter.id}`)).status).toBe(403);
    expect((await vet.client.post(`/notes/${n.body.id}/review`)).body.status).toBe('REVIEWED');
    // editing a reviewed note invalidates the review
    expect((await nurse.client.patch(`/notes/${n.body.id}`, { plan: 'x' })).body.status).toBe('DRAFT');
    await vet.client.post(`/notes/${n.body.id}/sign`);
    expect((await field.client.post(`/notes/${n.body.id}/amend`, { amendmentReason: 'x' })).status).toBe(403);
  });

  it('flags vitals against the organization’s sourced reference ranges and feeds weight history', async () => {
    const org = await registerOrg();
    const { vet, patient, encounter } = await encounterFor(org);
    const dog = await speciesId(org.owner);
    expect((await org.owner.post('/vital-references', { speciesId: dog, parameter: 'heartRate', low: 60, high: 140, unit: 'bpm' })).status).toBe(400); // source required
    expect((await org.owner.post('/vital-references', { speciesId: dog, parameter: 'heartRate', low: 60, high: 140, unit: 'bpm', source: 'Test reference' })).status).toBe(201);
    const v = await vet.client.post(`/encounters/${encounter.id}/vitals`, { heartRate: 180, temperatureC: 38.5, weightKg: 21.4 });
    expect(v.status).toBe(201);
    expect(v.body.flags.heartRate).toMatchObject({ flag: 'HIGH', source: 'Test reference' });
    expect(v.body.flags.temperatureC).toBeUndefined(); // no reference configured → no invented flag
    const p = (await vet.client.get(`/patients/${patient.id}`)).body;
    expect(p.latestWeightKg).toBe(21.4);
    expect((await vet.client.post(`/encounters/${encounter.id}/vitals`, { notes: 'nothing' })).body.error.code).toBe('EMPTY_VITALS');
    // A typing slip (398 for 39.8) comes back as a plain message for that field.
    const slip = await vet.client.post(`/encounters/${encounter.id}/vitals`, { temperatureC: 398 });
    expect(slip.status).toBe(400);
    expect(slip.body.error.details).toEqual([expect.objectContaining({ path: 'temperatureC', message: 'Temperature must be between 25 and 46 °C' })]);
  });

  it('records diagnoses, maintains the problem list and closes the encounter', async () => {
    const org = await registerOrg();
    const { vet, patient, encounter } = await encounterFor(org);
    const d = await vet.client.post(`/encounters/${encounter.id}/diagnoses`, { term: 'Chronic kidney disease', type: 'CONFIRMED', addToProblemList: true });
    expect(d.status).toBe(201);
    const problems = (await vet.client.get(`/patients/${patient.id}/problems`)).body;
    expect(problems[0]).toMatchObject({ term: 'Chronic kidney disease', status: 'ACTIVE', sourceDiagnosisId: d.body.id });
    const resolved = await vet.client.patch(`/patients/${patient.id}/problems/${problems[0].id}`, { status: 'RESOLVED' });
    expect(resolved.body.resolvedDate).toBeTruthy();

    await vet.client.post(`/encounters/${encounter.id}/notes`, SOAP);
    const done = await vet.client.post(`/encounters/${encounter.id}/complete`);
    expect(done.body.unsignedNotes).toBe(1);
    expect((await vet.client.post(`/encounters/${encounter.id}/complete`)).status).toBe(422);
  });

  it('cannot cancel an encounter once a note is signed', async () => {
    const org = await registerOrg();
    const { vet, encounter } = await encounterFor(org);
    const n = await vet.client.post(`/encounters/${encounter.id}/notes`, SOAP);
    await vet.client.post(`/notes/${n.body.id}/sign`);
    expect((await vet.client.post(`/encounters/${encounter.id}/cancel`, { reason: 'mistake' })).body.error.code).toBe('HAS_SIGNED_NOTES');
  });

  it('shows consultations and vitals on the patient timeline and keeps signed notes through a patient merge', async () => {
    const org = await registerOrg();
    const { vet, client, patient, encounter } = await encounterFor(org);
    const n = await vet.client.post(`/encounters/${encounter.id}/notes`, SOAP);
    await vet.client.post(`/notes/${n.body.id}/sign`);
    await vet.client.post(`/encounters/${encounter.id}/vitals`, { temperatureC: 39.1 });
    const t = (await vet.client.get(`/patients/${patient.id}/timeline`)).body;
    expect(t.kinds).toEqual(expect.arrayContaining(['consultation', 'vitals', 'appointment']));
    expect(t.events.some((e: any) => e.kind === 'consultation' && e.href === `/consultations/${encounter.id}`)).toBe(true);

    const keep = await makePatient(org.owner, client.id, { name: 'Keeper' });
    const m = await org.owner.post('/patients/merge', { survivorId: keep.id, mergedId: patient.id, reason: 'dup' });
    expect(m.status).toBe(200);
    expect(m.body.moved.clinicalNotes).toBe(1);
    expect((await vet.client.get(`/notes/${n.body.id}/verify`)).body.valid).toBe(true);
  });

  it('manages follow-up tasks', async () => {
    const org = await registerOrg();
    const { vet, patient, encounter } = await encounterFor(org);
    const t = await vet.client.post('/tasks', { title: 'Call owner re: recheck', dueAt: new Date(Date.now() - 3600_000).toISOString(), patientId: patient.id, encounterId: encounter.id });
    expect(t.status).toBe(201);
    const overdue = (await vet.client.get('/tasks?overdue=true')).body;
    expect(overdue.data.map((x: any) => x.id)).toContain(t.body.id);
    expect((await vet.client.post(`/tasks/${t.body.id}/status`, { status: 'DONE' })).body.completedByName).toBe('Test veterinarian');
    const dash = (await vet.client.get('/dashboard')).body.widgets;
    expect(dash.clinicalWork).toBeDefined();
    expect(dash.appointmentsToday).toBeDefined();
  });
});
