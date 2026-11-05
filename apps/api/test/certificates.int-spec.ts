import { defaultCertificateLayout } from '@vcms/shared';
import { TestClient, closeApp, getApp, makeClient, makePatient, prisma, registerOrg, staff } from './helpers';

const today = () => new Date().toISOString().slice(0, 10);
const inDays = (n: number) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);

async function setup() {
  const org = await registerOrg();
  const vet = await staff(org, 'veterinarian', { isClinician: true });
  const client = await makeClient(org.owner, { firstName: 'Ahmed', lastName: 'Khan' });
  const patient = await makePatient(org.owner, client.id, { name: 'Bruno', identifiers: [{ type: 'MICROCHIP', value: '900012345678901' }] });
  return { org, vet, client, patient };
}

/** A vaccination given at the clinic (the preventive module records these). */
async function vaccinate(org: Awaited<ReturnType<typeof registerOrg>>, patientId: string, title: string, product: string, batch: string) {
  return prisma().careItem.create({
    data: { organizationId: org.orgId, patientId, kind: 'VACCINATION', title, productName: product, batchNumber: batch, dueDate: new Date(), status: 'COMPLETED', completedAt: new Date(), completedByName: 'Dr Test' },
  });
}

describe('Certificates', () => {
  afterAll(closeApp);

  it('issues patient certificates from the records, numbered and verifiable, and never changes them', async () => {
    const { org, vet, patient } = await setup();
    const rabies = await vaccinate(org, patient.id, 'Rabies', 'Rabisin', 'RB-1');
    await vaccinate(org, patient.id, 'DHPPi', 'Nobivac DHPPi', 'NB-7');

    // The form is pre-filled from the records.
    const pre = (await vet.client.get(`/certificates/prefill?kind=RABIES_VACCINATION&subjectId=${patient.id}`)).body;
    expect(pre.inputs).toMatchObject({ vaccine: 'Rabisin', batch: 'RB-1', vaccinationDate: today() });
    expect(pre.vaccinations).toHaveLength(2);
    expect((await vet.client.get(`/certificates/prefill?kind=MICROCHIP&subjectId=${patient.id}`)).body.inputs.microchip).toBe('900012345678901');

    // Required answers are checked.
    const missing = await vet.client.post('/certificates', { kind: 'FITNESS_TO_TRAVEL', patientId: patient.id, inputs: { examDate: today() } });
    expect(missing.status).toBe(400);

    const travel = await vet.client.post('/certificates', {
      kind: 'FITNESS_TO_TRAVEL',
      patientId: patient.id,
      inputs: { examDate: today(), destination: 'Dubai, UAE', travelMode: 'by air' },
      validUntil: inDays(10),
    });
    expect(travel.status).toBe(201);
    const c = travel.body;
    expect(c).toMatchObject({ certificateNo: 'CERT-000001', kind: 'FITNESS_TO_TRAVEL', title: 'Fitness to Travel Certificate', subjectName: 'Bruno', state: 'VALID', templateName: 'Built-in design' });
    expect(c.verificationCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(c.verifyUrl).toMatch(/\/verify\/[A-Z2-9]{12}$/);
    expect(c.data.fields).toMatchObject({ 'patient.name': 'Bruno', 'patient.microchip': '900012345678901', 'owner.name': expect.stringContaining('Ahmed'), 'input.destination': 'Dubai, UAE' });
    expect(c.data.fields['certificate.statement']).toMatch(/found it fit to travel by air to Dubai, UAE/);
    expect(c.data.fields['certificate.validity']).toMatch(/^Valid until \d+ \w{3} \d{4}$/);
    expect(c.layout.elements.some((e: any) => e.type === 'qr')).toBe(true);

    // The vaccination certificate lists what was chosen.
    const vacc = await vet.client.post('/certificates', { kind: 'VACCINATION', patientId: patient.id, vaccinationIds: [rabies.id], inputs: {} });
    expect(vacc.status).toBe(201);
    expect(vacc.body.data.table).toEqual([expect.objectContaining({ vaccine: 'Rabies', product: 'Rabisin', batch: 'RB-1' })]);

    // Anyone can check it by its code; the owner's family name is shortened.
    const anon = Object.assign(new TestClient(await getApp()), {});
    const code = c.verificationCode.replace(/-/g, '');
    const v = (await anon.get(`/public/certificates/${code}`)).body;
    expect(v).toMatchObject({ found: true, status: 'VALID', number: 'CERT-000001', subject: expect.stringMatching(/^Bruno — /), owner: 'Ahmed K.', issuedBy: expect.any(String) });
    expect((await anon.get(`/public/certificates/${c.verificationCode.toLowerCase()}`)).body.found).toBe(true);
    expect((await anon.get('/public/certificates/ZZZZZZZZZZZZ')).body).toEqual({ found: false });

    // A correction replaces it: the old one is revoked in the same step, and says by which.
    const fixed = await vet.client.post('/certificates', { kind: 'FITNESS_TO_TRAVEL', patientId: patient.id, inputs: { examDate: today(), destination: 'Doha, Qatar' }, replacesId: c.id });
    expect(fixed.status).toBe(201);
    expect(fixed.body.replaces).toMatchObject({ id: c.id });
    const old = (await vet.client.get(`/certificates/${c.id}`)).body;
    expect(old).toMatchObject({ status: 'REVOKED', state: 'REVOKED', revokedReason: `Replaced by ${fixed.body.certificateNo}`, replacedBy: { id: fixed.body.id } });
    expect((await anon.get(`/public/certificates/${code}`)).body).toMatchObject({ status: 'REVOKED', replacedBy: fixed.body.certificateNo });
    expect((await vet.client.post('/certificates', { kind: 'FITNESS_TO_TRAVEL', patientId: patient.id, inputs: { examDate: today(), destination: 'X' }, replacesId: c.id })).body.error.code).toBe('NOT_REPLACEABLE');

    // Revoking needs a reason, and happens once.
    expect((await vet.client.post(`/certificates/${vacc.body.id}/revoke`, { reason: '' })).status).toBe(400);
    expect((await vet.client.post(`/certificates/${vacc.body.id}/revoke`, { reason: 'Issued for the wrong pet' })).body).toMatchObject({ state: 'REVOKED', revokedReason: 'Issued for the wrong pet' });
    expect((await vet.client.post(`/certificates/${vacc.body.id}/revoke`, { reason: 'again' })).body.error.code).toBe('ALREADY_REVOKED');

    // Permanent, even bypassing the app.
    await expect(prisma().certificate.update({ where: { id: fixed.body.id }, data: { title: 'Changed' } })).rejects.toThrow(/cannot be changed/);
    await expect(prisma().certificate.delete({ where: { id: fixed.body.id } })).rejects.toThrow(/permanent/);
    await expect(prisma().certificate.update({ where: { id: c.id }, data: { status: 'ISSUED' } })).rejects.toThrow(/stays revoked/);

    // On the patient's timeline, and in the list with filters.
    const timeline = (await vet.client.get(`/patients/${patient.id}/timeline`)).body.events;
    expect(timeline.filter((e: any) => e.kind === 'certificate')).toHaveLength(3);
    const list = (await vet.client.get(`/certificates?patientId=${patient.id}&status=REVOKED`)).body;
    expect(list.meta.total).toBe(2);
    expect((await vet.client.get('/certificates?q=CERT-000002')).body.data.map((x: any) => x.certificateNo)).toEqual(['CERT-000002']);
    const audit = await prisma().auditEvent.count({ where: { organizationId: org.orgId, action: { in: ['certificate.issued', 'certificate.revoked'] } } });
    expect(audit).toBe(5);
  });

  it('keeps staff certificates to those who manage staff, and checks who may issue what', async () => {
    const { org, vet, patient } = await setup();
    const nurse = await staff(org, 'nurse');
    const desk = await staff(org, 'receptionist');

    const emp = await org.owner.post('/certificates', { kind: 'EMPLOYMENT', membershipId: nurse.membershipId, inputs: { purpose: 'a visa application' } });
    expect(emp.status).toBe(201);
    expect(emp.body.data.fields).toMatchObject({ 'staff.name': 'Test nurse', 'staff.jobTitle': expect.any(String) });
    expect(emp.body.data.fields['certificate.statement']).toMatch(/has been employed at .* since .* for a visa application\.$/);

    // A vet issues patient certificates but not staff ones; reception reads patient certificates only.
    expect((await vet.client.post('/certificates', { kind: 'EMPLOYMENT', membershipId: nurse.membershipId, inputs: {} })).status).toBe(403);
    expect((await desk.client.post('/certificates', { kind: 'HEALTH', patientId: patient.id, inputs: { examDate: today() } })).status).toBe(403);
    const health = await vet.client.post('/certificates', { kind: 'HEALTH', patientId: patient.id, inputs: { examDate: today() } });
    expect((await desk.client.get(`/certificates/${health.body.id}`)).status).toBe(200);
    expect((await desk.client.get(`/certificates/${emp.body.id}`)).status).toBe(404);
    expect((await desk.client.get('/certificates')).body.data.map((x: any) => x.subject)).toEqual(['PATIENT']);
    expect((await desk.client.post(`/certificates/${health.body.id}/revoke`, { reason: 'no' })).status).toBe(403);

    // The System account and other clinics' people can't be the subject.
    const sys = await prisma().membership.findFirstOrThrow({ where: { organizationId: org.orgId, user: { isSystemAccount: true } } });
    expect((await org.owner.post('/certificates', { kind: 'EMPLOYMENT', membershipId: sys.id, inputs: {} })).body.error.code).toBe('INVALID_STAFF');
    const other = await registerOrg();
    expect((await other.owner.post('/certificates', { kind: 'HEALTH', patientId: patient.id, inputs: { examDate: today() } })).body.error.code).toBe('INVALID_PATIENT');
    expect((await other.owner.get(`/certificates/${health.body.id}`)).status).toBe(404);
  });

  it('designs templates: the first of a kind becomes the default, used ones can only be switched off', async () => {
    const { org, vet, patient } = await setup();
    const nurse = await staff(org, 'nurse');
    const layout = defaultCertificateLayout('HEALTH', 'modern');
    expect((await nurse.client.post('/certificate-templates', { kind: 'HEALTH', name: 'Ours', layout })).status).toBe(403);
    expect((await org.owner.post('/certificate-templates', { kind: 'HEALTH', name: 'Broken', layout: { ...layout, elements: [{ id: 'x', type: 'text' }] } })).status).toBe(400);

    const t = await org.owner.post('/certificate-templates', { kind: 'HEALTH', name: 'Green health', layout });
    expect(t.status).toBe(201);
    expect(t.body).toMatchObject({ isDefault: true, isActive: true, used: 0 });
    const second = (await org.owner.post('/certificate-templates', { kind: 'HEALTH', name: 'Plain health', layout: defaultCertificateLayout('HEALTH', 'classic') })).body;
    expect(second.isDefault).toBe(false);

    // Issuing without choosing uses the default; the certificate keeps its own copy of the design.
    const c = (await vet.client.post('/certificates', { kind: 'HEALTH', patientId: patient.id, inputs: { examDate: today() } })).body;
    expect(c.templateName).toBe('Green health');
    await org.owner.patch(`/certificate-templates/${t.body.id}`, { layout: { ...layout, elements: layout.elements.slice(0, 3) } });
    expect((await vet.client.get(`/certificates/${c.id}`)).body.layout.elements).toHaveLength(layout.elements.length);
    // A template of another kind can't be used.
    expect((await vet.client.post('/certificates', { kind: 'FITNESS', patientId: patient.id, templateId: t.body.id, inputs: { examDate: today(), purpose: 'boarding' } })).body.error.code).toBe('INVALID_TEMPLATE');

    expect((await org.owner.post(`/certificate-templates/${second.id}/default`)).body.isDefault).toBe(true);
    expect((await org.owner.get(`/certificate-templates/${t.body.id}`)).body).toMatchObject({ isDefault: false, used: 1 });
    expect((await org.owner.del(`/certificate-templates/${t.body.id}`)).body.error.code).toBe('IN_USE');
    expect((await org.owner.patch(`/certificate-templates/${second.id}`, { isActive: false })).body).toMatchObject({ isActive: false, isDefault: false });
    expect((await org.owner.del(`/certificate-templates/${second.id}`)).status).toBe(200);
    // Vets can see the templates to choose one, but not change them.
    expect((await vet.client.get('/certificate-templates?kind=HEALTH')).body.map((x: any) => x.name)).toEqual(['Green health']);
  });

  it('moves certificates with the patient when duplicates are merged', async () => {
    const { org, vet, client, patient } = await setup();
    const keep = await makePatient(org.owner, client.id, { name: 'Bruno (keep)' });
    await vet.client.post('/certificates', { kind: 'HEALTH', patientId: patient.id, inputs: { examDate: today() } });
    expect((await org.owner.post('/patients/merge', { survivorId: keep.id, mergedId: patient.id, reason: 'duplicate' })).status).toBe(200);
    expect((await vet.client.get(`/certificates?patientId=${keep.id}`)).body.meta.total).toBe(1);
  });
});
