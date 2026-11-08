import { booking, closeApp, futureDate, karachi, prisma, registerOrg, schedulingFixture } from './helpers';

// Prices are arbitrary test values.
type Type = { id: string; name: string; category: string; serviceId: string | null; requiresClinician: boolean; allowOnlineBooking: boolean; categoryRef: { kind: string } | null; service: { name: string; priceMinor: number } | null };

describe('Grooming appointment types', () => {
  afterAll(closeApp);

  it('adds the common grooming services once as Grooming types, keeping what the clinic has and its prices', async () => {
    const org = await registerOrg();
    // The clinic's own price for a cat groom, under a usual other name.
    const cat = (await org.owner.post('/services', { code: 'CATG', name: 'Cat grooming', category: 'GROOMING', priceMinor: 150000 })).body;
    const types = (await org.owner.get('/appointment-types?all=true')).body as Type[];
    const grooming = types.filter((t) => t.category === 'GROOMING');
    for (const name of ['Full groom', 'Bath & blow-dry', 'Nail trim', 'Dematting', 'Teeth brushing', 'Lion cut (cats)', 'Cat groom']) expect(grooming.map((t) => t.name)).toContain(name);
    expect(grooming.filter((t) => t.name === 'Full groom')).toHaveLength(1);
    expect(grooming.every((t) => t.categoryRef?.kind === 'GROOMING')).toBe(true);
    const catType = grooming.find((t) => t.name === 'Cat groom')!;
    expect(catType).toMatchObject({ requiresClinician: false, allowOnlineBooking: true, serviceId: cat.id });
    expect(grooming.find((t) => t.name === 'Dematting')!.service).toMatchObject({ name: 'Dematting', priceMinor: 0 });

    // Once only: a deleted grooming type does not come back.
    await prisma().appointmentType.delete({ where: { id: grooming.find((t) => t.name === 'Paw pad trim')!.id } });
    const again = (await org.owner.get('/appointment-types?all=true')).body as Type[];
    expect(again.some((t) => t.name === 'Paw pad trim')).toBe(false);
    expect(again.filter((t) => t.category === 'GROOMING')).toHaveLength(grooming.length - 1);
  });

  it('charges a booked groom once when the same service is also tapped in the consultation', async () => {
    const org = await registerOrg();
    const types = (await org.owner.get('/appointment-types?all=true')).body as Type[];
    const nails = types.find((t) => t.name === 'Nail trim')!;
    await prisma().service.update({ where: { id: nails.serviceId! }, data: { priceMinor: 50000 } });
    const f = await schedulingFixture(org);
    const a = await org.owner.post('/appointments', booking(org, f, karachi(futureDate(3), '10:00'), { appointmentTypeId: nails.id }));
    expect(a.status).toBe(201);
    await f.vet.client.post(`/appointments/${a.body.id}/status`, { action: 'start' });
    const enc = (await org.owner.get(`/encounters?status=OPEN&patientId=${f.patient.id}`)).body.data[0];
    expect((await f.vet.client.post(`/encounters/${enc.id}/services`, { serviceId: nails.serviceId })).status).toBe(201);
    await f.vet.client.post(`/encounters/${enc.id}/complete`);
    const charges = ((await org.owner.get(`/charges?encounterId=${enc.id}`)).body.data as any[]).map((c) => [c.sourceType, c.unitPriceMinor]);
    expect(charges).toEqual([['VisitService', 50000]]);
  });
});
