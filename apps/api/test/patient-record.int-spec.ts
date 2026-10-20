import { closeApp, inDays, makeClient, makePatient, prisma, registerOrg, staff } from './helpers';

describe('Complete patient record', () => {
  afterAll(closeApp);

  it('gathers everything held about a patient, limits sections by role, and audits the download', async () => {
    const org = await registerOrg();
    const client = await makeClient(org.owner);
    const pet = await makePatient(org.owner, client.id, { name: 'Bruno' });
    await org.owner.post('/care-items', { patientId: pet.id, kind: 'VACCINATION', title: 'Rabies', dueDate: inDays(30) });
    await org.owner.post('/invoices', { clientId: client.id, patientId: pet.id, lines: [{ kind: 'CUSTOM', description: 'Consult', quantity: 1, unitPriceMinor: 1000 }], issue: true });

    const view = await org.owner.get(`/patients/${pet.id}/record`);
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({ format: 'nextcore-vcms/patient-record', patient: { id: pet.id, name: 'Bruno' } });
    const names = view.body.sections.map((s: { name: string }) => s.name);
    for (const n of ['consultations', 'appointments', 'prescriptions', 'diagnostics', 'preventiveCare', 'billing', 'admissions', 'documents']) expect(names).toContain(n);
    expect(view.body.omitted).toHaveLength(0);
    expect(view.body.sections.find((s: { name: string }) => s.name === 'preventiveCare').data).toHaveLength(1);
    expect(view.body.sections.find((s: { name: string }) => s.name === 'billing').data.invoices).toHaveLength(1);

    // Downloading needs its own permission and is audited.
    const file = await org.owner.get(`/patients/${pet.id}/record-export`);
    expect(file.status).toBe(200);
    expect(file.headers['content-disposition']).toMatch(/attachment; filename="patient-record-Bruno-\d{4}-\d\d-\d\d\.json"/);
    expect(file.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(file.text).patient.id).toBe(pet.id);
    expect(await prisma().auditEvent.findFirst({ where: { organizationId: org.orgId, action: 'patient.record_exported', entityId: pet.id } })).toBeTruthy();

    // Reception sees the sections their role allows, with the rest listed as left out, and cannot download.
    const rec = await staff(org, 'receptionist');
    const recView = await rec.client.get(`/patients/${pet.id}/record`);
    expect(recView.status).toBe(200);
    expect(recView.body.omitted.length).toBeGreaterThan(0);
    expect(recView.body.sections.map((s: { name: string }) => s.name)).not.toContain('prescriptions');
    expect((await rec.client.get(`/patients/${pet.id}/record-export`)).status).toBe(403);

    // Another clinic cannot read this patient.
    const other = await registerOrg();
    expect((await other.owner.get(`/patients/${pet.id}/record`)).status).toBe(404);
    expect((await other.owner.get(`/patients/${pet.id}/record-export`)).status).toBe(404);
  });
});
