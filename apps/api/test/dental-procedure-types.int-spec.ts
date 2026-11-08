import { DENTAL_PROCEDURES, OPTIONAL_MODULES } from '@vcms/shared';
import { booking, closeApp, futureDate, karachi, prisma, registerOrg, schedulingFixture } from './helpers';

// Prices are arbitrary test values.
type Type = { id: string; name: string; category: string; dentalProcedureCode: string | null; serviceId: string | null; categoryRef: { kind: string } | null; template: { name: string; _count: { questions: number } } | null };

describe('Dental procedures as appointment types', () => {
  afterAll(closeApp);

  it('adds each dental procedure once as a Dental appointment type, keeping its price; one price for the chart and the booking', async () => {
    const org = await registerOrg();
    const sp = (await org.owner.post('/services', { code: 'DSP', name: 'Dental scale & polish', category: 'DENTAL', priceMinor: 800000 })).body;
    const other = (await org.owner.post('/services', { code: 'DSP2', name: 'Scale and polish (large dog)', category: 'DENTAL', priceMinor: 1200000 })).body;
    // A price set the old way (Settings → Dental prices) before the types exist.
    await prisma().dentalProcedurePrice.upsert({ where: { organizationId_code: { organizationId: org.orgId, code: 'SP' } }, create: { organizationId: org.orgId, code: 'SP', serviceId: sp.id }, update: { serviceId: sp.id } });

    const types = (await org.owner.get('/appointment-types?all=true')).body as Type[];
    const procedures = types.filter((t) => t.dentalProcedureCode);
    expect(procedures.map((t) => t.dentalProcedureCode).sort()).toEqual(DENTAL_PROCEDURES.map((p) => p.code).sort());
    const scale = procedures.find((t) => t.dentalProcedureCode === 'SP')!;
    expect(scale).toMatchObject({ name: 'Scale and polish', category: 'DENTAL', categoryRef: { kind: 'DENTAL' }, serviceId: sp.id });

    // The type's price is the procedure's price, both ways.
    await org.owner.patch(`/appointment-types/${scale.id}`, { serviceId: other.id });
    expect(((await org.owner.get('/dental/prices')).body as any[]).find((p) => p.code === 'SP').service).toMatchObject({ id: other.id });
    await org.owner.call('put', '/dental/prices', { items: [{ code: 'SP', serviceId: sp.id }] });
    expect((await prisma().appointmentType.findUniqueOrThrow({ where: { id: scale.id } })).serviceId).toBe(sp.id);

    // Once only: a deleted procedure type does not come back.
    await prisma().appointmentType.delete({ where: { id: procedures.find((t) => t.dentalProcedureCode === 'WOLF')!.id } });
    const again = (await org.owner.get('/appointment-types?all=true')).body as Type[];
    expect(again.filter((t) => t.dentalProcedureCode)).toHaveLength(DENTAL_PROCEDURES.length - 1);
  });

  it('gives the dental appointment types dental questions once: procedures, horse procedures and the plain Dental type', async () => {
    const org = await registerOrg();
    // A clinic's own dental type with its own questions keeps them.
    const own = (await org.owner.post('/clinical-templates', { name: 'Our ortho questions', examSystems: [], questions: [{ ask: 'Bite?', answers: [{ label: 'Normal', text: 'Normal bite' }] }] })).body;
    const orthoRes = await org.owner.post('/appointment-types', { name: 'Orthodontic check', category: 'DENTAL', durationMinutes: 30, templateId: own.id });
    expect(orthoRes.body.error ?? null).toBeNull();
    const ortho = orthoRes.body;
    await org.owner.get('/clinical-templates');
    const types = (await org.owner.get('/appointment-types?all=true')).body as Type[];
    const byCode = (c: string) => types.find((t) => t.dentalProcedureCode === c)!;
    expect(byCode('SP').template).toMatchObject({ name: 'Dental procedure' });
    expect(byCode('SP').template!._count.questions).toBeGreaterThan(5);
    expect(byCode('FLOAT').template).toMatchObject({ name: 'Horse dental' });
    expect(types.find((t) => t.id === ortho.id)!.template).toMatchObject({ name: 'Our ortho questions' });
    const plain = types.find((t) => t.name === 'Dental');
    if (plain) expect(plain.template).toMatchObject({ name: 'Dental check' });
    // No appointment types of their own for the dental questions.
    expect(types.some((t) => t.name === 'Dental procedure' || t.name === 'Horse dental')).toBe(false);
    const horse = (await org.owner.get('/clinical-templates')).body.find((t: any) => t.name === 'Horse dental');
    expect(horse).toMatchObject({ speciesCategory: 'EQUINE', icon: 'tooth' });

    // Once only: questions taken off a type are not put back.
    await org.owner.patch(`/appointment-types/${byCode('X').id}`, { templateId: null });
    const again = (await org.owner.get('/appointment-types?all=true')).body as Type[];
    expect(again.find((t) => t.dentalProcedureCode === 'X')!.template).toBeNull();
    expect(((await org.owner.get('/clinical-templates')).body as any[]).filter((t) => t.name === 'Dental procedure')).toHaveLength(1);
  });

  it('charges a visit booked for a procedure once: by the dental chart when charted there, otherwise when the visit ends', async () => {
    const org = await registerOrg();
    const sp = (await org.owner.post('/services', { code: 'DSP', name: 'Dental scale & polish', category: 'DENTAL', priceMinor: 800000 })).body;
    const types = (await org.owner.get('/appointment-types?all=true')).body as Type[];
    const scale = types.find((t) => t.dentalProcedureCode === 'SP')!;
    await org.owner.patch(`/appointment-types/${scale.id}`, { serviceId: sp.id });
    const f = await schedulingFixture(org);
    const visit = async (day: number, chart: boolean) => {
      const a = await org.owner.post('/appointments', booking(org, f, karachi(futureDate(day), '10:00'), { appointmentTypeId: scale.id }));
      expect(a.status).toBe(201);
      await f.vet.client.post(`/appointments/${a.body.id}/status`, { action: 'start' });
      const enc = (await org.owner.get(`/encounters?status=OPEN&patientId=${f.patient.id}`)).body.data[0];
      if (chart) {
        const c = (await f.vet.client.post('/dental/charts', { patientId: f.patient.id, dentition: 'CANINE', encounterId: enc.id })).body;
        expect((await f.vet.client.post(`/dental/charts/${c.id}/procedures`, { code: 'SP' })).status).toBe(200);
      }
      await f.vet.client.post(`/encounters/${enc.id}/complete`);
      return ((await org.owner.get(`/charges?encounterId=${enc.id}`)).body.data as any[]).map((c) => [c.sourceType, c.unitPriceMinor]);
    };
    expect(await visit(3, true)).toEqual([['DentalProcedure', 800000]]);
    expect(await visit(4, false)).toEqual([['Encounter', 800000]]);
  });

  it('adds no dental appointment types while dental is switched off, and adds them once it is switched on', async () => {
    const org = await registerOrg();
    expect((await org.owner.call('put', '/setup/modules', { enabled: OPTIONAL_MODULES.filter((m) => m !== 'dental') })).status).toBe(200);
    const count = async () => ((await org.owner.get('/appointment-types?all=true')).body as Type[]).filter((t) => t.dentalProcedureCode).length;
    expect(await count()).toBe(0);
    await org.owner.call('put', '/setup/modules', { enabled: [...OPTIONAL_MODULES] });
    expect(await count()).toBe(DENTAL_PROCEDURES.length);
    const scale = ((await org.owner.get('/appointment-types?all=true')).body as Type[]).find((t) => t.dentalProcedureCode === 'SP')!;
    expect(scale.template).toMatchObject({ name: 'Dental procedure' });
  });
});
